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
  const onDraftTextChange = vi.fn()
  const onDraftNameChange = vi.fn()
  const onSave = vi.fn()
  render(
    <QuestionGraphPanel
      result={baseResult()}
      isPending={false}
      error={null}
      variant="files"
      onVariantChange={onVariantChange}
      onExpand={onExpand}
      draftText=""
      onDraftTextChange={onDraftTextChange}
      draftName="Graph draft"
      onDraftNameChange={onDraftNameChange}
      onSave={onSave}
      isSaving={false}
      saveError={null}
      saved={false}
      canRetrieve={true}
      {...overrides}
    />
  )
  return { onVariantChange, onExpand, onDraftTextChange, onDraftNameChange, onSave }
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
        draftText=""
        onDraftTextChange={vi.fn()}
        draftName=""
        onDraftNameChange={vi.fn()}
        onSave={vi.fn()}
        isSaving={false}
        saveError={null}
        saved={false}
        canRetrieve={true}
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

  it("enables all four segments", () => {
    renderPanel()
    expect(screen.getByRole<HTMLButtonElement>("tab", { name: "draft" }).disabled).toBe(false)
    expect(screen.getByRole<HTMLButtonElement>("tab", { name: "canvas" }).disabled).toBe(false)
  })

  it("switches to Draft and Canvas on click", () => {
    const { onVariantChange } = renderPanel()
    fireEvent.click(screen.getByRole("tab", { name: "draft" }))
    expect(onVariantChange).toHaveBeenCalledWith("draft")
    fireEvent.click(screen.getByRole("tab", { name: "canvas" }))
    expect(onVariantChange).toHaveBeenCalledWith("canvas")
  })

  describe("Draft variant", () => {
    it("renders the draft text in an editable textarea", () => {
      renderPanel({ variant: "draft", draftText: "the drafted prose" })
      expect(screen.getByRole<HTMLTextAreaElement>("textbox", { name: /draft/i }).value).toBe(
        "the drafted prose"
      )
    })

    it("calls onDraftTextChange verbatim as the user types — no reformatting", () => {
      const { onDraftTextChange } = renderPanel({ variant: "draft", draftText: "" })
      fireEvent.change(screen.getByRole("textbox", { name: /draft/i }), {
        target: { value: "edited prose" },
      })
      expect(onDraftTextChange).toHaveBeenCalledWith("edited prose")
    })

    it("has no editor links — its text is saved verbatim (graph-gui.md §2.6)", () => {
      renderPanel({ variant: "draft", draftText: "prose" })
      expect(screen.queryByLabelText(/Open .* in editor/)).toBeNull()
    })

    it("previews the provenance footer that will be appended on save, separate from the editable text", () => {
      renderPanel({
        variant: "draft",
        draftText: "prose",
        result: baseResult({ footer: "\n---\nDrafted from the code graph on 2026-08-28." }),
      })
      expect(screen.getByText(/Drafted from the code graph on 2026-08-28/)).toBeTruthy()
      expect(screen.getByRole<HTMLTextAreaElement>("textbox", { name: /draft/i }).value).toBe(
        "prose"
      )
    })

    it("calls onSave when 'Save as Answer' is clicked", () => {
      const { onSave } = renderPanel({ variant: "draft", draftText: "prose" })
      fireEvent.click(screen.getByRole("button", { name: "Save as Answer" }))
      expect(onSave).toHaveBeenCalledTimes(1)
    })

    it("disables Save when the draft is empty", () => {
      renderPanel({ variant: "draft", draftText: "   " })
      expect(
        screen.getByRole<HTMLButtonElement>("button", { name: "Save as Answer" }).disabled
      ).toBe(true)
    })

    it("disables Save when the name is empty, even with draft text present", () => {
      renderPanel({ variant: "draft", draftText: "prose", draftName: "   " })
      expect(
        screen.getByRole<HTMLButtonElement>("button", { name: "Save as Answer" }).disabled
      ).toBe(true)
    })

    it("shows Saving… while the save is in flight", () => {
      renderPanel({ variant: "draft", draftText: "prose", isSaving: true })
      expect(screen.getByRole("button", { name: "Saving…" })).toBeTruthy()
    })

    it("shows a confirmation once saved", () => {
      renderPanel({ variant: "draft", draftText: "prose", saved: true })
      expect(screen.getByRole("button", { name: "Saved" })).toBeTruthy()
    })

    it("shows a visible error when the save fails", () => {
      renderPanel({
        variant: "draft",
        draftText: "prose",
        saveError: new Error("network down"),
      })
      expect(screen.getByText(/Couldn.t save\. network down/)).toBeTruthy()
    })
  })

  describe("Canvas variant", () => {
    it("renders a node-link diagram with one mark per node", () => {
      renderPanel({ variant: "canvas" })
      const svg = document.querySelector("svg")
      expect(svg).toBeTruthy()
      expect(svg?.querySelectorAll("circle").length).toBe(2)
    })

    it("shows a detail panel with an editor link when a node is clicked", () => {
      localStorage.setItem(EDITOR_SCHEME_STORAGE_KEY, "cursor")
      renderPanel({ variant: "canvas" })

      fireEvent.click(screen.getByLabelText("Show authenticate in the graph"))

      const link = screen.getByLabelText<HTMLAnchorElement>(
        "Open api/middleware/auth.ts in editor"
      )
      expect(link.href).toBe("cursor://file/Users/dev/notex/api/middleware/auth.ts:18:1")
    })

    it("selects a node from the keyboard (Enter), not just a mouse click", () => {
      renderPanel({ variant: "canvas" })
      fireEvent.keyDown(screen.getByLabelText("Show authenticate in the graph"), {
        key: "Enter",
      })
      expect(screen.getByText("authenticate", { selector: "p" })).toBeTruthy()
    })

    it("clears the selected node once a new retrieval hands down a different subgraph", () => {
      const { rerender } = render(
        <QuestionGraphPanel
          result={baseResult()}
          isPending={false}
          error={null}
          variant="canvas"
          onVariantChange={vi.fn()}
          onExpand={vi.fn()}
          draftText=""
          onDraftTextChange={vi.fn()}
          draftName="Graph draft"
          onDraftNameChange={vi.fn()}
          onSave={vi.fn()}
          isSaving={false}
          saveError={null}
          saved={false}
          canRetrieve={true}
        />
      )
      fireEvent.click(screen.getByLabelText("Show authenticate in the graph"))
      expect(screen.getByText("authenticate", { selector: "p" })).toBeTruthy()

      const OTHER_NODE = { ...NODE_A, id: "n3", label: "other-node" }
      rerender(
        <QuestionGraphPanel
          result={baseResult({ subgraph: { nodes: [OTHER_NODE], edges: [], seeds: ["n3"] } })}
          isPending={false}
          error={null}
          variant="canvas"
          onVariantChange={vi.fn()}
          onExpand={vi.fn()}
          draftText=""
          onDraftTextChange={vi.fn()}
          draftName="Graph draft"
          onDraftNameChange={vi.fn()}
          onSave={vi.fn()}
          isSaving={false}
          saveError={null}
          saved={false}
          canRetrieve={true}
        />
      )

      expect(screen.queryByText("authenticate", { selector: "p" })).toBeNull()
      expect(screen.getByText("Click a node to see its source and neighbours.")).toBeTruthy()
    })
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

  it("disables Expand when the companion isn't connected (graph-gui.md §6.2)", () => {
    renderPanel({ canRetrieve: false })
    expect(
      screen.getByRole<HTMLButtonElement>("button", { name: /Expand/ }).disabled
    ).toBe(true)
  })

  it("keeps a rendered result on screen when a later retrieval errors — never destroys work in progress", () => {
    // graph-gui.md §6.2: results already on screen stay valid even after the companion drops
    // mid-session; a failed Expand (or a failed re-draft) must not blank out what's already
    // shown. `result` staying populated alongside a stale `error` is exactly what a react-query
    // mutation does after a prior success is followed by a failed retry — the panel must not
    // treat that as "nothing to show".
    renderPanel({ error: new Error("companion unreachable") })
    expect(screen.getByText("api/middleware/auth.ts")).toBeTruthy()
    expect(screen.queryByText(/Couldn.t draft from the graph/)).toBeNull()
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
