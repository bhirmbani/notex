// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"

import { EditorSchemeSetting } from "./EditorSchemeSetting"
import { EDITOR_SCHEME_STORAGE_KEY } from "@/lib/editorScheme"

afterEach(() => {
  cleanup()
  localStorage.clear()
})

describe("EditorSchemeSetting", () => {
  it("defaults the select to VS Code", () => {
    render(<EditorSchemeSetting />)
    expect(
      screen.getByLabelText<HTMLSelectElement>(/editor links/i).value
    ).toBe("vscode")
  })

  it("loads a previously stored scheme", () => {
    localStorage.setItem(EDITOR_SCHEME_STORAGE_KEY, "cursor")
    render(<EditorSchemeSetting />)
    expect(
      screen.getByLabelText<HTMLSelectElement>(/editor links/i).value
    ).toBe("cursor")
  })

  it("persists the selection to localStorage", () => {
    render(<EditorSchemeSetting />)
    fireEvent.change(screen.getByLabelText(/editor links/i), {
      target: { value: "none" },
    })
    expect(localStorage.getItem(EDITOR_SCHEME_STORAGE_KEY)).toBe("none")
  })
})
