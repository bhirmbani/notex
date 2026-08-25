import { useState } from "react"

import type { EditorScheme } from "@/lib/editorScheme"
import { Label } from "@/components/ui/label"
import {
  EDITOR_SCHEMES,
  getStoredEditorScheme,
  setStoredEditorScheme,
} from "@/lib/editorScheme"

/**
 * The per-user IDE-scheme preference (graph-gui.md §1 surface map, §2.6) — lives in
 * Settings, alongside API keys, since the graph page has no other settings surface yet.
 */
export function EditorSchemeSetting() {
  const [scheme, setScheme] = useState<EditorScheme>(getStoredEditorScheme)

  return (
    <div className="rounded-lg border bg-card p-4">
      <Label htmlFor="editor-scheme" className="mb-2">
        Editor links
      </Label>
      <p className="mb-3 text-xs text-muted-foreground">
        How the graph page's source links open your editor.
      </p>
      <select
        id="editor-scheme"
        value={scheme}
        onChange={(e) => {
          const next = e.target.value as EditorScheme
          setScheme(next)
          setStoredEditorScheme(next)
        }}
        className="h-8 w-full rounded-md border bg-background px-2 text-sm"
      >
        {EDITOR_SCHEMES.map((s) => (
          <option key={s.value} value={s.value}>
            {s.label}
          </option>
        ))}
      </select>
    </div>
  )
}
