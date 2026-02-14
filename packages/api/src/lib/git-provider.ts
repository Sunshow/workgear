/**
 * Git provider abstraction for creating pull requests across different platforms.
 */

export interface CreatePullRequestParams {
  owner: string
  repo: string
  title: string
  head: string // feature branch
  base: string // target branch
  body?: string
}

export interface PullRequestResult {
  url: string
  number: number
}

export interface GitProvider {
  /**
   * Create a pull request.
   * @throws Error if PR creation fails
   */
  createPullRequest(params: CreatePullRequestParams): Promise<PullRequestResult>

  /**
   * Parse owner and repo from a Git URL.
   * @returns { owner, repo } or null if not parseable
   */
  parseRepoUrl(url: string): { owner: string; repo: string } | null
}
