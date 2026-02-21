import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Artifact, FlowRun } from '@/lib/types'

// ─── Mocks ───

const mockGet = vi.fn()

vi.mock('@/lib/api', () => ({
  api: {
    get: (...args: any[]) => {
      mockGet(...args)
      return { json: () => mockGet._jsonImpl?.(...args) ?? Promise.resolve([]) }
    },
  },
}))

vi.mock('@/components/artifact-preview-card', () => ({
  ArtifactPreviewCard: ({ artifact, onEdit, onFullscreen }: {
    artifact: Artifact
    onEdit?: (a: Artifact, content: string, version: number) => void
    onFullscreen?: (title: string, content: string) => void
  }) => (
    <div data-testid={`artifact-card-${artifact.id}`}>
      <span data-testid="artifact-title">{artifact.title}</span>
      <span data-testid="artifact-type">{artifact.type}</span>
    </div>
  ),
}))

vi.mock('@/components/artifact-editor-dialog', () => ({
  ArtifactEditorDialog: () => null,
}))

// Import after mocks
import { ArtifactsTab } from '../artifacts-tab'

// ─── Test Data Factories ───

function makeArtifact(overrides: Partial<Artifact> = {}): Artifact {
  return {
    id: 'artifact-1',
    taskId: 'task-1',
    flowRunId: 'flow-run-1',
    nodeRunId: 'node-run-1',
    type: 'proposal',
    title: 'Test Proposal',
    filePath: null,
    createdAt: '2026-02-18T00:00:00Z',
    ...overrides,
  }
}

function makeFlowRun(overrides: Partial<FlowRun> = {}): FlowRun {
  return {
    id: 'flow-run-1',
    taskId: 'task-1',
    workflowId: 'wf-1',
    status: 'running',
    error: null,
    dslSnapshot: null,
    variables: null,
    branchName: null,
    prUrl: null,
    prNumber: null,
    prMergedAt: null,
    mergeCommitSha: null,
    startedAt: '2026-02-18T00:00:00Z',
    completedAt: null,
    createdAt: '2026-02-18T00:00:00Z',
    ...overrides,
  }
}

// ─── Tests ───

describe('ArtifactsTab', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGet._jsonImpl = undefined
  })

  it('shows loading skeleton initially', () => {
    mockGet._jsonImpl = () => new Promise(() => {}) // never resolves
    render(<ArtifactsTab taskId="task-1" />)

    // Skeleton elements should be visible
    const skeletons = document.querySelectorAll('.animate-pulse, [class*="skeleton"]')
    expect(skeletons.length).toBeGreaterThan(0)
  })

  it('shows empty state when no artifacts exist', async () => {
    mockGet._jsonImpl = (url: string) => {
      if (url.startsWith('artifacts?taskId=')) return Promise.resolve([])
      if (url.startsWith('flow-runs?taskId=')) return Promise.resolve([])
      return Promise.resolve([])
    }

    render(<ArtifactsTab taskId="task-1" />)

    await waitFor(() => {
      expect(screen.getByText('No artifacts to review')).toBeInTheDocument()
    })

    expect(
      screen.getByText('Artifacts will appear here when upstream nodes produce them')
    ).toBeInTheDocument()
  })

  it('shows error state with retry button on API failure', async () => {
    mockGet._jsonImpl = () => Promise.reject(new Error('Network error'))

    render(<ArtifactsTab taskId="task-1" />)

    await waitFor(() => {
      expect(screen.getByText('Failed to load artifacts')).toBeInTheDocument()
    })

    expect(screen.getByText('Network error')).toBeInTheDocument()
    expect(screen.getByText('Retry')).toBeInTheDocument()
  })

  it('retries loading when retry button is clicked', async () => {
    let callCount = 0
    mockGet._jsonImpl = (url: string) => {
      callCount++
      if (callCount <= 2) {
        // First call (artifacts + flow-runs) fails
        return Promise.reject(new Error('Network error'))
      }
      // Retry succeeds
      if (url.startsWith('artifacts?taskId=')) return Promise.resolve([])
      if (url.startsWith('flow-runs?taskId=')) return Promise.resolve([])
      return Promise.resolve([])
    }

    render(<ArtifactsTab taskId="task-1" />)

    await waitFor(() => {
      expect(screen.getByText('Retry')).toBeInTheDocument()
    })

    const user = userEvent.setup()
    await user.click(screen.getByText('Retry'))

    await waitFor(() => {
      expect(screen.getByText('No artifacts to review')).toBeInTheDocument()
    })
  })

  it('renders artifact cards when artifacts exist', async () => {
    const artifacts = [
      makeArtifact({ id: 'a1', title: 'Proposal Doc', type: 'proposal' }),
      makeArtifact({ id: 'a2', title: 'Design Doc', type: 'design' }),
    ]

    const flowRun = makeFlowRun()

    mockGet._jsonImpl = (url: string) => {
      if (url.startsWith('artifacts?taskId=')) return Promise.resolve(artifacts)
      if (url.startsWith('flow-runs?taskId=')) return Promise.resolve([flowRun])
      if (url.match(/^flow-runs\/[^/]+\/nodes$/)) return Promise.resolve([])
      return Promise.resolve([])
    }

    render(<ArtifactsTab taskId="task-1" />)

    await waitFor(() => {
      expect(screen.getByTestId('artifact-card-a1')).toBeInTheDocument()
      expect(screen.getByTestId('artifact-card-a2')).toBeInTheDocument()
    })
  })

  it('groups artifacts by flow run', async () => {
    const artifacts = [
      makeArtifact({ id: 'a1', flowRunId: 'flow-run-1', title: 'Artifact 1' }),
      makeArtifact({ id: 'a2', flowRunId: 'flow-run-1', title: 'Artifact 2' }),
    ]

    const flowRun = makeFlowRun({ id: 'flow-run-1' })

    mockGet._jsonImpl = (url: string) => {
      if (url.startsWith('artifacts?taskId=')) return Promise.resolve(artifacts)
      if (url.startsWith('flow-runs?taskId=')) return Promise.resolve([flowRun])
      if (url.match(/^flow-runs\/[^/]+\/nodes$/)) return Promise.resolve([])
      return Promise.resolve([])
    }

    render(<ArtifactsTab taskId="task-1" />)

    await waitFor(() => {
      expect(screen.getByText('流程执行')).toBeInTheDocument()
    })
  })

  it('shows unlinked artifacts section when artifacts have no flowRunId', async () => {
    const artifacts = [
      makeArtifact({ id: 'a1', flowRunId: null, title: 'Unlinked Artifact' }),
    ]

    mockGet._jsonImpl = (url: string) => {
      if (url.startsWith('artifacts?taskId=')) return Promise.resolve(artifacts)
      if (url.startsWith('flow-runs?taskId=')) return Promise.resolve([])
      return Promise.resolve([])
    }

    render(<ArtifactsTab taskId="task-1" />)

    await waitFor(() => {
      expect(screen.getByText('其他产物')).toBeInTheDocument()
      expect(screen.getByTestId('artifact-card-a1')).toBeInTheDocument()
    })
  })
})
