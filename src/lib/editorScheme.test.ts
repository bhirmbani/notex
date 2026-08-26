// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest"

import {
  EDITOR_SCHEME_STORAGE_KEY,
  buildEditorLink,
  getStoredEditorScheme,
  setStoredEditorScheme,
} from "./editorScheme"

afterEach(() => {
  localStorage.clear()
})

describe("getStoredEditorScheme", () => {
  it("defaults to vscode when nothing is stored", () => {
    expect(getStoredEditorScheme()).toBe("vscode")
  })

  it("returns a validly stored scheme", () => {
    localStorage.setItem(EDITOR_SCHEME_STORAGE_KEY, "cursor")
    expect(getStoredEditorScheme()).toBe("cursor")
  })

  it("falls back to vscode for a corrupt stored value", () => {
    localStorage.setItem(EDITOR_SCHEME_STORAGE_KEY, "not-a-scheme")
    expect(getStoredEditorScheme()).toBe("vscode")
  })
})

describe("setStoredEditorScheme", () => {
  it("persists the scheme under the storage key", () => {
    setStoredEditorScheme("none")
    expect(localStorage.getItem(EDITOR_SCHEME_STORAGE_KEY)).toBe("none")
  })
})

describe("buildEditorLink", () => {
  it("builds a vscode:// link from checkoutPath + sourceFile + sourceLocation", () => {
    expect(
      buildEditorLink({
        scheme: "vscode",
        checkoutPath: "/Users/dev/notex",
        sourceFile: "api/middleware/auth.ts",
        sourceLocation: "L18",
      })
    ).toBe("vscode://file/Users/dev/notex/api/middleware/auth.ts:18:1")
  })

  it("builds a cursor:// link for the cursor scheme", () => {
    expect(
      buildEditorLink({
        scheme: "cursor",
        checkoutPath: "/Users/dev/notex",
        sourceFile: "src/index.ts",
        sourceLocation: "L1",
      })
    ).toBe("cursor://file/Users/dev/notex/src/index.ts:1:1")
  })

  it("returns null for scheme 'none'", () => {
    expect(
      buildEditorLink({
        scheme: "none",
        checkoutPath: "/Users/dev/notex",
        sourceFile: "src/index.ts",
        sourceLocation: "L1",
      })
    ).toBeNull()
  })

  it("strips a trailing slash on checkoutPath", () => {
    expect(
      buildEditorLink({
        scheme: "vscode",
        checkoutPath: "/Users/dev/notex/",
        sourceFile: "src/index.ts",
        sourceLocation: "L1",
      })
    ).toBe("vscode://file/Users/dev/notex/src/index.ts:1:1")
  })

  it("omits the line suffix when sourceLocation doesn't carry a line number", () => {
    expect(
      buildEditorLink({
        scheme: "vscode",
        checkoutPath: "/Users/dev/notex",
        sourceFile: "src/index.ts",
        sourceLocation: "",
      })
    ).toBe("vscode://file/Users/dev/notex/src/index.ts")
  })

  it("returns null instead of throwing when sourceFile is null (unvalidated companion data)", () => {
    expect(
      buildEditorLink({
        scheme: "vscode",
        checkoutPath: "/Users/dev/notex",
        sourceFile: null,
        sourceLocation: "L1",
      })
    ).toBeNull()
  })

  it("omits the line suffix instead of throwing when sourceLocation is null", () => {
    expect(
      buildEditorLink({
        scheme: "vscode",
        checkoutPath: "/Users/dev/notex",
        sourceFile: "src/index.ts",
        sourceLocation: null,
      })
    ).toBe("vscode://file/Users/dev/notex/src/index.ts")
  })
})
