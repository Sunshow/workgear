import type { FastifyInstance } from 'fastify'
import { eq } from 'drizzle-orm'
import { db } from '../db/index.js'
import { projects } from '../db/schema.js'
import { execFile } from 'child_process'
import { promisify } from 'util'
import fs from 'fs/promises'
import path from 'path'
import os from 'os'
import { authenticate } from '../middleware/auth.js'
import { GitHubProvider } from '../lib/github-provider.js'

const execFileAsync = promisify(execFile)

export async function openspecRoutes(app: FastifyInstance) {
  // 所有 OpenSpec 路由都需要登录
  app.addHook('preHandler', authenticate)
  // 获取 change 下所有 artifact 文件列表和内容
  app.get<{
    Params: { projectId: string; changeName: string }
    Querystring: { branch?: string }
  }>('/changes/:changeName', async (request, reply) => {
    const { projectId, changeName } = request.params
    const branch = request.query.branch || 'main'

    const project = await getProject(projectId)
    if (!project) return reply.status(404).send({ error: 'Project not found' })
    if (!project.gitRepoUrl) return reply.status(400).send({ error: 'Project has no Git repo configured' })
    const repoUrl = getAuthenticatedRepoUrl(project)!

    const basePath = `openspec/changes/${changeName}`
    const files = await listGitFiles(repoUrl, branch, basePath)

    if (files.length === 0) {
      return reply.status(404).send({ error: `No OpenSpec change found: ${changeName}` })
    }

    // Fetch content for each file
    const artifacts = await Promise.all(
      files.map(async (filePath) => {
        const content = await getGitFileContent(repoUrl, branch, filePath)
        return {
          path: filePath,
          relativePath: filePath.replace(`${basePath}/`, ''),
          content,
        }
      })
    )

    return { changeName, branch, artifacts }
  })

  // 获取 Source of Truth specs 文件列表
  app.get<{
    Params: { projectId: string }
    Querystring: { branch?: string }
  }>('/specs', async (request, reply) => {
    const { projectId } = request.params
    const branch = request.query.branch || 'main'

    const project = await getProject(projectId)
    if (!project) return reply.status(404).send({ error: 'Project not found' })
    if (!project.gitRepoUrl) return reply.status(400).send({ error: 'Project has no Git repo configured' })
    const repoUrl = getAuthenticatedRepoUrl(project)!

    const basePath = 'openspec/specs'
    const files = await listGitFiles(repoUrl, branch, basePath)

    const specs = await Promise.all(
      files.map(async (filePath) => {
        const content = await getGitFileContent(repoUrl, branch, filePath)
        return {
          path: filePath,
          relativePath: filePath.replace(`${basePath}/`, ''),
          content,
        }
      })
    )

    return { branch, specs }
  })

  // 获取指定 artifact 文件内容
  app.get<{
    Params: { projectId: string; changeName: string; '*': string }
    Querystring: { branch?: string }
  }>('/changes/:changeName/artifacts/*', async (request, reply) => {
    const { projectId, changeName } = request.params
    const artifactPath = request.params['*']
    const branch = request.query.branch || 'main'

    const project = await getProject(projectId)
    if (!project) return reply.status(404).send({ error: 'Project not found' })
    if (!project.gitRepoUrl) return reply.status(400).send({ error: 'Project has no Git repo configured' })
    const repoUrl = getAuthenticatedRepoUrl(project)!

    const fullPath = `openspec/changes/${changeName}/${artifactPath}`
    const content = await getGitFileContent(repoUrl, branch, fullPath)

    if (content === null) {
      return reply.status(404).send({ error: `File not found: ${fullPath}` })
    }

    return { path: fullPath, content }
  })

  // 获取所有 changes 列表
  app.get<{
    Params: { projectId: string }
    Querystring: { branch?: string }
  }>('/changes', async (request, reply) => {
    const { projectId } = request.params
    const branch = request.query.branch || 'main'

    const project = await getProject(projectId)
    if (!project) return reply.status(404).send({ error: 'Project not found' })
    if (!project.gitRepoUrl) return reply.status(400).send({ error: 'Project has no Git repo configured' })
    const repoUrl = getAuthenticatedRepoUrl(project)!

    const files = await listGitFiles(repoUrl, branch, 'openspec/changes')

    // Extract unique change names from file paths
    const changeNames = new Set<string>()
    for (const filePath of files) {
      const relative = filePath.replace('openspec/changes/', '')
      const parts = relative.split('/')
      if (parts.length > 0 && parts[0] !== 'archive') {
        changeNames.add(parts[0])
      }
    }

    return { branch, changes: Array.from(changeNames) }
  })

  // 更新 artifact 文件内容（人工编辑后 commit 回 Git）
  app.put<{
    Params: { projectId: string; changeName: string; '*': string }
    Body: { content: string; branch?: string; commitMessage?: string }
  }>('/changes/:changeName/artifacts/*', async (request, reply) => {
    const { projectId, changeName } = request.params
    const artifactPath = request.params['*']
    const { content, branch = 'main', commitMessage } = request.body

    const project = await getProject(projectId)
    if (!project) return reply.status(404).send({ error: 'Project not found' })
    if (!project.gitRepoUrl) return reply.status(400).send({ error: 'Project has no Git repo configured' })
    if (!project.gitAccessToken) return reply.status(400).send({ error: 'Project has no Git access token configured' })
    
    const repoUrl = getAuthenticatedRepoUrl(project)!
    const fullPath = `openspec/changes/${changeName}/${artifactPath}`
    const msg = commitMessage || `docs: update ${fullPath}`

    try {
      const result = await updateGitFileWithPR(
        repoUrl,
        branch,
        fullPath,
        content,
        msg,
        project.gitRepoUrl,
        project.gitAccessToken,
        project.autoMergePr
      )
      return { 
        success: true, 
        path: fullPath, 
        commitMessage: msg,
        prUrl: result.prUrl,
        prNumber: result.prNumber,
        merged: result.merged,
        mergeError: result.mergeError,
      }
    } catch (err) {
      app.log.error(err, 'Failed to update artifact file')
      return reply.status(500).send({ error: 'Failed to update file in Git repo' })
    }
  })
}

// ─── Helpers ───

async function getProject(projectId: string) {
  const result = await db.select().from(projects).where(eq(projects.id, projectId))
  return result[0] || null
}

/**
 * Get the authenticated Git repo URL by injecting access token into HTTPS URL.
 */
function getAuthenticatedRepoUrl(project: { gitRepoUrl: string | null; gitAccessToken: string | null }): string | null {
  if (!project.gitRepoUrl) return null
  if (!project.gitAccessToken) return project.gitRepoUrl
  const url = project.gitRepoUrl
  if (!url.toLowerCase().startsWith('https://')) return url
  const rest = url.slice('https://'.length)
  const atIdx = rest.indexOf('@')
  const slashIdx = rest.indexOf('/')
  // If @ exists before the first /, strip existing credentials
  const host = (atIdx >= 0 && (slashIdx < 0 || atIdx < slashIdx))
    ? rest.slice(atIdx + 1)
    : rest
  return `https://${project.gitAccessToken}@${host}`
}

/**
 * List files in a Git repo at a given path using git ls-tree via a shallow clone.
 */
async function listGitFiles(repoUrl: string, branch: string, dirPath: string): Promise<string[]> {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'workgear-git-'))
  try {
    await execFileAsync('git', ['clone', '--depth', '1', '--branch', branch, '--no-checkout', repoUrl, tmpDir], {
      timeout: 30000,
    })
    const { stdout } = await execFileAsync('git', ['ls-tree', '-r', '--name-only', 'HEAD', dirPath], {
      cwd: tmpDir,
      timeout: 10000,
    })
    return stdout.trim().split('\n').filter(Boolean)
  } catch {
    return []
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {})
  }
}

/**
 * Get file content from a Git repo using git show.
 */
async function getGitFileContent(repoUrl: string, branch: string, filePath: string): Promise<string | null> {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'workgear-git-'))
  try {
    await execFileAsync('git', ['clone', '--depth', '1', '--branch', branch, '--no-checkout', repoUrl, tmpDir], {
      timeout: 30000,
    })
    const { stdout } = await execFileAsync('git', ['show', `HEAD:${filePath}`], {
      cwd: tmpDir,
      timeout: 10000,
    })
    return stdout
  } catch {
    return null
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {})
  }
}

/**
 * Update a file in a Git repo using PR workflow: clone, write, commit, push to feature branch, create PR.
 */
async function updateGitFileWithPR(
  repoUrl: string,
  baseBranch: string,
  filePath: string,
  content: string,
  commitMessage: string,
  rawRepoUrl: string,
  accessToken: string,
  autoMerge: boolean = false
): Promise<{ prUrl?: string; prNumber?: number; merged?: boolean; mergeError?: string }> {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'workgear-git-'))
  try {
    // Clone base branch
    await execFileAsync('git', ['clone', '--depth', '1', '--branch', baseBranch, repoUrl, tmpDir], {
      timeout: 30000,
    })
    await execFileAsync('git', ['config', 'user.email', 'workgear@workgear.dev'], { cwd: tmpDir })
    await execFileAsync('git', ['config', 'user.name', 'WorkGear'], { cwd: tmpDir })

    // Create feature branch
    const featureBranch = `workgear/edit-${Date.now()}`
    await execFileAsync('git', ['checkout', '-b', featureBranch], { cwd: tmpDir })

    // Write file
    const fullPath = path.join(tmpDir, filePath)
    await fs.mkdir(path.dirname(fullPath), { recursive: true })
    await fs.writeFile(fullPath, content, 'utf-8')

    // Commit and push
    await execFileAsync('git', ['add', filePath], { cwd: tmpDir })
    await execFileAsync('git', ['commit', '-m', commitMessage], { cwd: tmpDir })
    await execFileAsync('git', ['push', 'origin', featureBranch], { cwd: tmpDir, timeout: 30000 })

    // Create PR via GitHub API
    const provider = new GitHubProvider(accessToken)
    const repoInfo = provider.parseRepoUrl(rawRepoUrl)
    
    if (!repoInfo) {
      throw new Error(`Could not parse GitHub repo from URL: ${rawRepoUrl}`)
    }

    const prResult = await provider.createPullRequest({
      owner: repoInfo.owner,
      repo: repoInfo.repo,
      title: `[WorkGear] ${commitMessage}`,
      head: featureBranch,
      base: baseBranch,
      body: `Automated update from WorkGear.\n\nFile: \`${filePath}\``,
    })

    // Auto-merge if enabled
    if (autoMerge) {
      const mergeResult = await provider.mergePullRequest({
        owner: repoInfo.owner,
        repo: repoInfo.repo,
        pullNumber: prResult.number,
        mergeMethod: 'squash',
        commitTitle: `[WorkGear] ${commitMessage}`,
      })

      if (mergeResult.merged) {
        // Clean up feature branch after successful merge
        await provider.deleteBranch(repoInfo.owner, repoInfo.repo, featureBranch).catch(() => {})
      }

      return {
        prUrl: prResult.url,
        prNumber: prResult.number,
        merged: mergeResult.merged,
        mergeError: mergeResult.merged ? undefined : mergeResult.message,
      }
    }

    return {
      prUrl: prResult.url,
      prNumber: prResult.number,
      merged: false,
    }
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {})
  }
}
