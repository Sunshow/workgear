import type { GitProvider, CreatePullRequestParams, PullRequestResult, MergePullRequestParams, MergePullRequestResult } from './git-provider.js'

export class GitHubProvider implements GitProvider {
  constructor(private token: string) {}

  async createPullRequest(params: CreatePullRequestParams): Promise<PullRequestResult> {
    const { owner, repo, title, head, base, body } = params

    const url = `https://api.github.com/repos/${owner}/${repo}/pulls`
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.token}`,
        'Accept': 'application/vnd.github+json',
        'Content-Type': 'application/json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      body: JSON.stringify({
        title,
        head,
        base,
        body: body || '',
      }),
    })

    if (!response.ok) {
      // 422 means PR already exists (idempotent)
      if (response.status === 422) {
        const error = await response.json().catch(() => ({})) as any
        // Check if it's a "pull request already exists" error
        if (error.errors?.some((e: any) => e.message?.includes('pull request already exists'))) {
          // Find existing PR
          const existingPR = await this.findExistingPR(owner, repo, head, base)
          if (existingPR) {
            return existingPR
          }
        }
      }
      const errorText = await response.text()
      throw new Error(`GitHub API error (${response.status}): ${errorText}`)
    }

    const data = await response.json() as any
    return {
      url: data.html_url,
      number: data.number,
    }
  }

  private async findExistingPR(
    owner: string,
    repo: string,
    head: string,
    base: string
  ): Promise<PullRequestResult | null> {
    const url = `https://api.github.com/repos/${owner}/${repo}/pulls?head=${owner}:${head}&base=${base}&state=open`
    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${this.token}`,
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    })

    if (!response.ok) return null

    const data = await response.json()
    if (Array.isArray(data) && data.length > 0) {
      return {
        url: data[0].html_url,
        number: data[0].number,
      }
    }

    return null
  }

  async mergePullRequest(params: MergePullRequestParams): Promise<MergePullRequestResult> {
    const { owner, repo, pullNumber, mergeMethod = 'squash', commitTitle } = params

    const url = `https://api.github.com/repos/${owner}/${repo}/pulls/${pullNumber}/merge`
    const response = await fetch(url, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${this.token}`,
        'Accept': 'application/vnd.github+json',
        'Content-Type': 'application/json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      body: JSON.stringify({
        merge_method: mergeMethod,
        ...(commitTitle && { commit_title: commitTitle }),
      }),
    })

    if (response.ok) {
      const data = await response.json() as any
      return { merged: true, sha: data.sha, message: data.message }
    }

    // 405: not mergeable (e.g. review required), 409: conflict
    if (response.status === 405 || response.status === 409) {
      const data = await response.json().catch(() => ({})) as any
      return { merged: false, message: data.message || `Merge failed (${response.status})` }
    }

    const errorText = await response.text()
    return { merged: false, message: `GitHub API error (${response.status}): ${errorText}` }
  }

  async deleteBranch(owner: string, repo: string, branch: string): Promise<boolean> {
    const url = `https://api.github.com/repos/${owner}/${repo}/git/refs/heads/${branch}`
    const response = await fetch(url, {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${this.token}`,
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    })
    return response.status === 204
  }

  parseRepoUrl(url: string): { owner: string; repo: string } | null {
    // Support formats:
    // https://github.com/owner/repo.git
    // https://github.com/owner/repo
    // https://token@github.com/owner/repo.git
    // git@github.com:owner/repo.git

    // HTTPS format
    const httpsMatch = url.match(/github\.com[/:]([\w-]+)\/([\w.-]+?)(\.git)?$/)
    if (httpsMatch) {
      return {
        owner: httpsMatch[1],
        repo: httpsMatch[2],
      }
    }

    return null
  }
}
