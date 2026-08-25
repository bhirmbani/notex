// Mermaid is loaded through a dynamic import so it never enters the SSR bundle.
//
// A static `import mermaid from 'mermaid'` in the diagram route made the whole library
// and its dep stack (langium, chevrotain, cytoscape, d3, roughjs, the vscode-language-
// server packages) statically reachable from the server entry — the bulk of the Worker
// upload, parsed on every cold start, for a library that only ever renders in a browser.
// It also dragged `node:os` into the SSR router chunk, which is what broke the deployed
// Worker in TBR-75. Keeping the import dynamic leaves mermaid in its own chunk that only
// the client ever pulls in.
//
// Call this from client-side code only (an effect, an event handler) — never from render
// or module scope, or the chunk gets requested during SSR.

// Type-only, so it is erased at compile time and adds no runtime import.
import type { Mermaid } from 'mermaid'

let mermaidPromise: Promise<Mermaid> | null = null

function loadMermaid(): Promise<Mermaid> {
  // Cache the promise rather than the module, so renders that race the first load all
  // await the same import instead of each kicking off their own `initialize`.
  mermaidPromise ??= import('mermaid').then(({ default: mermaid }) => {
    mermaid.initialize({ startOnLoad: false, theme: 'default' })
    return mermaid
  })
  return mermaidPromise
}

/**
 * Renders `content` as an SVG string under `id`. Rejects when mermaid can't parse the
 * content, leaving the cached module intact for the next attempt.
 */
export async function renderMermaid(
  id: string,
  content: string,
): Promise<string> {
  const mermaid = await loadMermaid()
  const { svg } = await mermaid.render(id, content)
  return svg
}
