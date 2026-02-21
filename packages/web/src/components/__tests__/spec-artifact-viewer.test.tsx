import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

// ─── Mocks ───

const mockFetch = vi.fn()
global.fetch = mockFetch

vi.mock('@/components/markdown-renderer', () => ({
  MarkdownRenderer: ({ content }: { content: string }) => (
    <div data-testid="markdown-renderer">{content}</div>
  ),
}))

// Import after mocks
import { SpecArtifactViewer } from '@/components/spec-artifact-viewer'

// ─── Test Data ───

const mockArtifacts = [
  { path: '/project/openspec/changes/test/proposal.md', relativePath: 'proposal.md', content: '# Proposal\nThis is a proposal.' },
  { path: '/project/openspec/changes/test/design.md', relativePath: 'design.md', content: '# Design\nThis is a design.' },
  { path: '/project/openspec/changes/test/tasks.md', relativePath: 'tasks.md', content: '# Tasks\n- [ ] Task 1' },
  { path: '/project/openspec/changes/test/specs/spec1.md', relativePath: 'specs/spec1.md', content: '# Spec 1\nSpec content.' },
]

function setupFetchSuccess(artifacts = mockArtifacts) {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    json: () => Promise.resolve({ artifacts }),
  })
}

function setupFetchError(statusText = 'Internal Server Error') {
  mockFetch.mockResolvedValueOnce({
    ok: false,
    statusText,
  })
}

// ─── Tests ───

describe('SpecArtifactViewer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('shows loading state initially', () => {
    mockFetch.mockReturnValueOnce(new Promise(() => {})) // never resolves
    render(
      <SpecArtifactViewer projectId="proj-1" changeName="test-change" />
    )

    expect(screen.getByText('加载 OpenSpec 文档...')).toBeInTheDocument()
  })

  it('shows error state when fetch fails', async () => {
    setupFetchError('Not Found')

    render(
      <SpecArtifactViewer projectId="proj-1" changeName="test-change" />
    )

    await waitFor(() => {
      expect(screen.getByText(/加载失败/)).toBeInTheDocument()
    })
  })

  it('shows empty state when no artifacts returned', async () => {
    setupFetchSuccess([])

    render(
      <SpecArtifactViewer projectId="proj-1" changeName="test-change" />
    )

    await waitFor(() => {
      expect(screen.getByText('未找到 OpenSpec 文档')).toBeInTheDocument()
    })
  })

  it('renders tabs for proposal, specs, design, tasks', async () => {
    setupFetchSuccess()

    render(
      <SpecArtifactViewer projectId="proj-1" changeName="test-change" />
    )

    await waitFor(() => {
      expect(screen.getByText('Proposal')).toBeInTheDocument()
      expect(screen.getByText('Specs')).toBeInTheDocument()
      expect(screen.getByText('Design')).toBeInTheDocument()
      expect(screen.getByText('Tasks')).toBeInTheDocument()
    })
  })

  it('renders proposal content with markdown renderer', async () => {
    setupFetchSuccess()

    render(
      <SpecArtifactViewer projectId="proj-1" changeName="test-change" />
    )

    await waitFor(() => {
      // The mock MarkdownRenderer renders content as text
      const renderers = screen.getAllByTestId('markdown-renderer')
      expect(renderers.length).toBeGreaterThan(0)
      expect(renderers[0].textContent).toContain('Proposal')
    })
  })

  it('shows specs count badge', async () => {
    setupFetchSuccess()

    render(
      <SpecArtifactViewer projectId="proj-1" changeName="test-change" />
    )

    await waitFor(() => {
      expect(screen.getByText('1')).toBeInTheDocument() // 1 spec file
    })
  })

  it('shows edit button when editable is true', async () => {
    setupFetchSuccess()

    render(
      <SpecArtifactViewer
        projectId="proj-1"
        changeName="test-change"
        editable={true}
        onSave={vi.fn()}
      />
    )

    await waitFor(() => {
      expect(screen.getByText('编辑')).toBeInTheDocument()
    })
  })

  it('does not show edit button when editable is false', async () => {
    setupFetchSuccess()

    render(
      <SpecArtifactViewer projectId="proj-1" changeName="test-change" editable={false} />
    )

    await waitFor(() => {
      expect(screen.getByText('proposal.md')).toBeInTheDocument()
    })

    expect(screen.queryByText('编辑')).not.toBeInTheDocument()
  })

  it('shows fullscreen button when onFullscreen is provided', async () => {
    setupFetchSuccess()

    render(
      <SpecArtifactViewer
        projectId="proj-1"
        changeName="test-change"
        onFullscreen={vi.fn()}
      />
    )

    await waitFor(() => {
      expect(screen.getByText('全屏')).toBeInTheDocument()
    })
  })

  it('enters edit mode when edit button is clicked', async () => {
    setupFetchSuccess()

    render(
      <SpecArtifactViewer
        projectId="proj-1"
        changeName="test-change"
        editable={true}
        onSave={vi.fn()}
      />
    )

    await waitFor(() => {
      expect(screen.getByText('编辑')).toBeInTheDocument()
    })

    const user = userEvent.setup()
    await user.click(screen.getByText('编辑'))

    // Should show save and cancel buttons
    expect(screen.getByText('保存')).toBeInTheDocument()
    expect(screen.getByText('取消')).toBeInTheDocument()
  })

  it('cancels edit mode when cancel button is clicked', async () => {
    setupFetchSuccess()

    render(
      <SpecArtifactViewer
        projectId="proj-1"
        changeName="test-change"
        editable={true}
        onSave={vi.fn()}
      />
    )

    await waitFor(() => {
      expect(screen.getByText('编辑')).toBeInTheDocument()
    })

    const user = userEvent.setup()
    await user.click(screen.getByText('编辑'))
    await user.click(screen.getByText('取消'))

    // Should be back to view mode
    expect(screen.getByText('编辑')).toBeInTheDocument()
    expect(screen.queryByText('保存')).not.toBeInTheDocument()
  })

  it('calls onSave when save button is clicked', async () => {
    setupFetchSuccess()
    const onSave = vi.fn().mockResolvedValue(undefined)

    render(
      <SpecArtifactViewer
        projectId="proj-1"
        changeName="test-change"
        editable={true}
        onSave={onSave}
      />
    )

    await waitFor(() => {
      expect(screen.getByText('编辑')).toBeInTheDocument()
    })

    const user = userEvent.setup()
    await user.click(screen.getByText('编辑'))
    await user.click(screen.getByText('保存'))

    await waitFor(() => {
      expect(onSave).toHaveBeenCalled()
    })
  })

  it('fetches artifacts with correct URL', async () => {
    setupFetchSuccess()

    render(
      <SpecArtifactViewer
        projectId="proj-1"
        changeName="test-change"
        branch="feature-branch"
      />
    )

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        '/api/projects/proj-1/openspec/changes/test-change?branch=feature-branch'
      )
    })
  })

  it('renders content as markdown for all artifact types', async () => {
    setupFetchSuccess()

    render(
      <SpecArtifactViewer projectId="proj-1" changeName="test-change" />
    )

    await waitFor(() => {
      // Proposal tab is default, should render markdown
      const renderers = screen.getAllByTestId('markdown-renderer')
      expect(renderers.length).toBeGreaterThan(0)
    })
  })
})
