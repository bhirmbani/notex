// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"

import { QuestionGraphPanel } from "./QuestionGraphPanel"
import type { OpResponse, QueryResult } from "notex-companion/client"
import { EDITOR_SCHEME_STORAGE_KEY } from "@/lib/editorScheme"

afterEach(() => {
  cleanup()
  localStorage.clear()
})

const STAMP = {
  builtAt: "2026-08-15T00:00:00.000Z",
  graphHash: "abcdef0123456789",
  nodeCount: 462,
  edgeCount: 1220,
  communityCount: 12,
  checkoutPath: "/Users/dev/notex",
  headSha: "1234567890abcdef",
  graphRoot: "/Users/dev/notex/src",
  rootPrefix: "src",
}

const NODE_A = {
  id: "n1",
  label: "authenticate",
  sourceFile: "api/middleware/auth.ts",
  sourceLocation: "L18",
  fileType: "code",
  community: { id: 1, name: "Auth" },
}
const NODE_B = {
  id: "n2",
  label: "logout",
  // Deliberately a different file from NODE_A: both share the "Auth" community, so both
  // render as separate rows there. If they also shared a sourceFile, GraphNodeRow's
  // aria-label ("Open <sourceFile> in editor", no location) would collide across rows —
  // an ambiguity in the editor-link test below, not something any implementation choice
  // consistent with that aria-label pattern can resolve while two same-file nodes coexist.
  sourceFile: "api/middleware/session.ts",
  sourceLocation: "L40",
  fileType: "code",
  community: { id: 1, name: "Auth" },
}

function baseResult(overrides: Partial<OpResponse<QueryResult>> = {}): OpResponse<QueryResult> {
  return {
    graph: STAMP,
    subgraph: { nodes: [NODE_A, NODE_B], edges: [], seeds: ["n1"] },
    context: { markdown: "# question\n\nevidence", sources: [] },
    ...overrides,
  }
}

function renderPanel(overrides: Partial<Parameters<typeof QuestionGraphPanel>[0]> = {}) {
  const onVariantChange = vi.fn()
  const onExpand = vi.fn()
  render(
    <QuestionGraphPanel
      result={baseResult()}
      isPending={false}
      error={null}
      variant="files"
      onVariantChange={onVariantChange}
      onExpand={onExpand}
      {...overrides}
    />
  )
  return { onVariantChange, onExpand }
}

describe("QuestionGraphPanel", () => {
  it("renders nothing before a draft has been run", () => {
    const { container } = render(
      <QuestionGraphPanel
        result={undefined}
        isPending={false}
        error={null}
        variant="files"
        onVariantChange={vi.fn()}
        onExpand={vi.fn()}
      />
    )
    expect(container.firstChild).toBeNull()
  })

  it("renders the Files variant by default, ranked by file", () => {
    renderPanel()
    expect(screen.getByText("api/middleware/auth.ts")).toBeTruthy()
  })

  it("switches to Evidence on click, grouped by community", () => {
    const { onVariantChange } = renderPanel()
    fireEvent.click(screen.getByRole("tab", { name: "evidence" }))
    expect(onVariantChange).toHaveBeenCalledWith("evidence")
  })

  it("renders Evidence grouped by community when the evidence variant is active", () => {
    renderPanel({ variant: "evidence" })
    expect(screen.getByText("Auth")).toBeTruthy()
    expect(screen.getByText("authenticate")).toBeTruthy()
  })

  it("disables the Draft and Canvas segments", () => {
    renderPanel()
    expect(
      screen.getByRole<HTMLButtonElement>("tab", { name: "draft" }).disabled
    ).toBe(true)
    expect(
      screen.getByRole<HTMLButtonElement>("tab", { name: "canvas" }).disabled
    ).toBe(true)
  })

  it("shows the degraded banner only when the response sets it", () => {
    renderPanel({ result: baseResult({ degraded: { expansion: "none" } }) })
    expect(screen.getByText(/Matched literally/)).toBeTruthy()
  })

  it("omits the degraded banner when absent", () => {
    renderPanel()
    expect(screen.queryByText(/Matched literally/)).toBeNull()
  })

  it("shows the truncated banner only when the response sets it", () => {
    renderPanel({
      result: baseResult({ truncated: { reason: "maxNodes", omittedCount: 12 } }),
    })
    expect(screen.getByText(/12 related nodes may be missing/)).toBeTruthy()
  })

  it("renders 'nothing convincing matched' instead of a subgraph when lowConfidence is set", () => {
    renderPanel({
      result: baseResult({ lowConfidence: { topScore: 1.5 } }),
    })
    expect(screen.getByText("Nothing convincing matched.")).toBeTruthy()
    expect(screen.queryByRole("tab", { name: "files" })).toBeNull()
    expect(screen.queryByText("api/middleware/auth.ts")).toBeNull()
  })

  it("calls onExpand from the Expand affordance", () => {
    const { onExpand } = renderPanel()
    fireEvent.click(screen.getByRole("button", { name: /Expand/ }))
    expect(onExpand).toHaveBeenCalledTimes(1)
  })

  it("copies the context markdown verbatim, and nothing else, to the clipboard", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.assign(navigator, { clipboard: { writeText } })

    renderPanel()
    fireEvent.click(screen.getByRole("button", { name: "Copy for your agent" }))

    await waitFor(() => expect(writeText).toHaveBeenCalledWith("# question\n\nevidence"))
  })

  it("shows a clipboard error message when the copy fails", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("denied"))
    Object.assign(navigator, { clipboard: { writeText } })

    renderPanel()
    fireEvent.click(screen.getByRole("button", { name: "Copy for your agent" }))

    expect(
      await screen.findByText(
        "Could not copy to your clipboard. Try again, or check your browser's clipboard permission."
      )
    ).toBeTruthy()
  })

  it("builds an editor link from checkoutPath + sourceFile honouring the stored scheme", () => {
    localStorage.setItem(EDITOR_SCHEME_STORAGE_KEY, "cursor")
    renderPanel({ variant: "evidence" })

    const link = screen.getByLabelText<HTMLAnchorElement>(
      "Open api/middleware/auth.ts in editor"
    )
    expect(link.href).toBe("cursor://file/Users/dev/notex/api/middleware/auth.ts:18:1")
  })
})
