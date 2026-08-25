// The per-user editor preference behind the graph page's editor links
// (graph-gui.md §2.6, §1 surface map — "the IDE-scheme preference, alongside API keys").
// Client-only (localStorage), mirroring src/lib/theme.ts's storage pattern.

export type EditorScheme = "vscode" | "cursor" | "none"

export const EDITOR_SCHEME_STORAGE_KEY = "notex-editor-scheme"

export const EDITOR_SCHEMES: Array<{ value: EditorScheme; label: string }> = [
  { value: "vscode", label: "VS Code" },
  { value: "cursor", label: "Cursor" },
  { value: "none", label: "No editor links" },
]

export function getStoredEditorScheme(): EditorScheme {
  if (typeof window === "undefined") return "vscode"
  const stored = localStorage.getItem(EDITOR_SCHEME_STORAGE_KEY)
  if (stored === "vscode" || stored === "cursor" || stored === "none")
    return stored
  return "vscode"
}

export function setStoredEditorScheme(scheme: EditorScheme) {
  localStorage.setItem(EDITOR_SCHEME_STORAGE_KEY, scheme)
}

/**
 * checkoutPath is GraphStamp.checkoutPath (absolute); sourceFile is checkout-relative
 * (companion-api.md §2.2) — joining them is the whole fix, not a guess.
 */
export function buildEditorLink({
  scheme,
  checkoutPath,
  sourceFile,
  sourceLocation,
}: {
  scheme: EditorScheme
  checkoutPath: string
  sourceFile: string
  sourceLocation: string
}): string | null {
  if (scheme === "none") return null

  const absolutePath = `${checkoutPath.replace(/\/$/, "")}/${sourceFile}`
  const line = Number.parseInt(sourceLocation.replace(/^L/, ""), 10)
  const suffix = Number.isFinite(line) ? `:${line}:1` : ""
  return `${scheme}://file${absolutePath}${suffix}`
}
