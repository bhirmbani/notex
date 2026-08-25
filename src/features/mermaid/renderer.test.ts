import { beforeEach, describe, expect, it, vi } from 'vitest'

const initialize = vi.fn()
const render = vi.fn((id: string) => Promise.resolve({ svg: `<svg id="${id}" />` }))

// The renderer reaches mermaid through a dynamic import, so the whole library —
// and the browser-only globals it touches — stays out of this test's module graph.
vi.mock('mermaid', () => ({ default: { initialize, render } }))

// The loader caches its promise at module scope, so each test needs a fresh copy.
async function freshRenderer() {
  vi.resetModules()
  initialize.mockClear()
  render.mockClear()
  return import('./renderer')
}

describe('renderMermaid', () => {
  beforeEach(() => {
    render.mockImplementation((id: string) =>
      Promise.resolve({ svg: `<svg id="${id}" />` }),
    )
  })

  it('returns the svg mermaid rendered for the given id and content', async () => {
    const { renderMermaid } = await freshRenderer()

    await expect(renderMermaid('diagram-1', 'graph TD')).resolves.toBe(
      '<svg id="diagram-1" />',
    )
    expect(render).toHaveBeenCalledWith('diagram-1', 'graph TD')
  })

  it('initializes mermaid once across sequential renders', async () => {
    const { renderMermaid } = await freshRenderer()

    await renderMermaid('diagram-1', 'graph TD')
    await renderMermaid('diagram-2', 'graph LR')

    expect(initialize).toHaveBeenCalledTimes(1)
    expect(initialize).toHaveBeenCalledWith({
      startOnLoad: false,
      theme: 'default',
    })
  })

  it('initializes mermaid once when renders race the first load', async () => {
    const { renderMermaid } = await freshRenderer()

    await Promise.all([
      renderMermaid('diagram-1', 'graph TD'),
      renderMermaid('diagram-2', 'graph LR'),
      renderMermaid('diagram-3', 'graph RL'),
    ])

    expect(initialize).toHaveBeenCalledTimes(1)
    expect(render).toHaveBeenCalledTimes(3)
  })

  it('propagates render failures so callers can keep the last valid diagram', async () => {
    const { renderMermaid } = await freshRenderer()
    render.mockRejectedValueOnce(new Error('Parse error'))

    await expect(renderMermaid('diagram-1', 'not a diagram')).rejects.toThrow(
      'Parse error',
    )

    // A failed parse must not poison the cached module for later renders.
    await expect(renderMermaid('diagram-2', 'graph TD')).resolves.toBe(
      '<svg id="diagram-2" />',
    )
    expect(initialize).toHaveBeenCalledTimes(1)
  })
})
