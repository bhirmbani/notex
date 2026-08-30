// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"

import { QuestionGraphPanel } from "./QuestionGraphPanel"
import type { OpResponse, QueryResult } from "notex-companion/client"
import type { GraphGenerationDTO } from "./persistenceTypes"
import { EDITOR_SCHEME_STORAGE_KEY } from "@/lib/editorScheme"
import * as providerKeyStorage from "@/features/provider-keys/storage"

// No route tree exists in an isolated component test — mock Link as a plain anchor, matching
// QuestionGraphAction.test.tsx's precedent rather than mounting a real TanStack Router.
vi.mock("@tanstack/react-router", () => ({
  Link: ({ to, children, ...props }: { to: string; children: React.ReactNode }) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
}))

afterEach(() => {
  cleanup()
  localStorage.clear()
  vi.restoreAllMocks()
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
  const onSelectVersion = vi.fn()
  const onExplainNode = vi.fn()
  render(
    <QuestionGraphPanel
      result={baseResult()}
      generations={[]}
      selectedGraphHash={null}
      onSelectVersion={onSelectVersion}
      isStale={false}
      autosaveState="idle"
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
      nodeExplanations={new Map()}
      explainingNodeIds={new Set()}
      failedNodeIds={new Set()}
      unsavedNodeIds={new Set()}
      explainFailureMessages={new Map()}
      onExplainNode={onExplainNode}
      {...overrides}
    />
  )
  return {
    onVariantChange,
    onExpand,
    onDraftTextChange,
    onDraftNameChange,
    onSave,
    onSelectVersion,
    onExplainNode,
  }
}

describe("QuestionGraphPanel", () => {
  it("renders nothing before a draft has been run", () => {
    const { container } = render(
      <QuestionGraphPanel
        result={undefined}
        generations={[]}
        selectedGraphHash={null}
        onSelectVersion={vi.fn()}
        isStale={false}
        autosaveState="idle"
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
        nodeExplanations={new Map()}
        explainingNodeIds={new Set()}
        failedNodeIds={new Set()}
        unsavedNodeIds={new Set()}
        explainFailureMessages={new Map()}
        onExplainNode={vi.fn()}
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
          generations={[]}
          selectedGraphHash={null}
          onSelectVersion={vi.fn()}
          isStale={false}
          autosaveState="idle"
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
          nodeExplanations={new Map()}
          explainingNodeIds={new Set()}
          failedNodeIds={new Set()}
          unsavedNodeIds={new Set()}
          explainFailureMessages={new Map()}
          onExplainNode={vi.fn()}
        />
      )
      fireEvent.click(screen.getByLabelText("Show authenticate in the graph"))
      expect(screen.getByText("authenticate", { selector: "p" })).toBeTruthy()

      const OTHER_NODE = { ...NODE_A, id: "n3", label: "other-node" }
      rerender(
        <QuestionGraphPanel
          result={baseResult({ subgraph: { nodes: [OTHER_NODE], edges: [], seeds: ["n3"] } })}
          generations={[]}
          selectedGraphHash={null}
          onSelectVersion={vi.fn()}
          isStale={false}
          autosaveState="idle"
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
          nodeExplanations={new Map()}
          explainingNodeIds={new Set()}
          failedNodeIds={new Set()}
          unsavedNodeIds={new Set()}
          explainFailureMessages={new Map()}
          onExplainNode={vi.fn()}
        />
      )

      expect(screen.queryByText("authenticate", { selector: "p" })).toBeNull()
      expect(screen.getByText("Click a node to see its source and neighbours.")).toBeTruthy()
    })

    describe("Explain action, cache-first (TBR-114, TBR-119)", () => {
      const EDGE = {
        source: "n1",
        target: "n2",
        relation: "calls",
        weight: 1,
        confidence: "EXTRACTED",
        sourceFile: "api/middleware/auth.ts",
        sourceLocation: "L18",
      }

      function selectNodeA() {
        fireEvent.click(screen.getByLabelText("Show authenticate in the graph"))
      }

      it("is absent from view before a node is selected", () => {
        renderPanel({ variant: "canvas" })
        expect(screen.queryByRole("button", { name: "Explain" })).toBeNull()
      })

      it("is disabled with a one-line reason when no Provider key is configured", () => {
        vi.spyOn(providerKeyStorage, "getActiveProviderKey").mockReturnValue(null)
        renderPanel({ variant: "canvas" })
        selectNodeA()

        const button = screen.getByRole<HTMLButtonElement>("button", { name: "Explain" })
        expect(button.disabled).toBe(true)
        expect(button.title).toBe("Configure a model provider to explain this node.")
      })

      it("renders a cached explanation instantly when nodeExplanations already has the selected node — no explain call", () => {
        const onExplainNode = vi.fn()
        renderPanel({
          variant: "canvas",
          nodeExplanations: new Map([["n1", "authenticate calls logout."]]),
          onExplainNode,
        })
        selectNodeA()

        expect(screen.getByText("authenticate calls logout.")).toBeTruthy()
        expect(onExplainNode).not.toHaveBeenCalled()
        // Already-explained nodes offer "Regenerate", not "Explain".
        expect(screen.getByRole("button", { name: "Regenerate" })).toBeTruthy()
      })

      it("calls onExplainNode with the node id and a context built from the node, its neighbours, and degree", () => {
        vi.spyOn(providerKeyStorage, "getActiveProviderKey").mockReturnValue({
          id: "p1",
          adapter: "anthropic",
          apiKey: "sk-ant-test",
          model: "claude-haiku-test",
        })
        const { onExplainNode } = renderPanel({
          variant: "canvas",
          result: baseResult({ subgraph: { nodes: [NODE_A, NODE_B], edges: [EDGE], seeds: ["n1"] } }),
        })
        selectNodeA()

        fireEvent.click(screen.getByRole("button", { name: "Explain" }))

        expect(onExplainNode).toHaveBeenCalledWith(
          "n1",
          expect.objectContaining({
            label: "authenticate",
            file: "api/middleware/auth.ts",
            location: "L18",
            community: "Auth",
            degree: 1,
            neighbours: [
              expect.objectContaining({
                label: "logout",
                file: "api/middleware/session.ts",
                location: "L40",
                relation: "calls",
                confidence: "EXTRACTED",
              }),
            ],
          })
        )
      })

      it("shows 'Explaining…' and disables the button while the selected node is in flight", () => {
        renderPanel({ variant: "canvas", explainingNodeIds: new Set(["n1"]) })
        selectNodeA()

        const button = screen.getByRole<HTMLButtonElement>("button", { name: "Explaining…" })
        expect(button.disabled).toBe(true)
      })

      it("shows a failure banner for the selected node when its last explain attempt failed, with the raw rows still visible", () => {
        renderPanel({ variant: "canvas", failedNodeIds: new Set(["n1"]) })
        selectNodeA()

        expect(screen.getByText(/synthesis failed/)).toBeTruthy()
        expect(screen.getByText("authenticate", { selector: "p" })).toBeTruthy()
      })

      it("shows the specific explain failure message when available, instead of the generic text", () => {
        renderPanel({
          variant: "canvas",
          failedNodeIds: new Set(["n1"]),
          explainFailureMessages: new Map([
            ["n1", "explanation cites a source outside the node and its neighbours"],
          ]),
        })
        selectNodeA()

        expect(
          screen.getByText(
            "Couldn't explain this node — synthesis failed (explanation cites a source outside the node and its neighbours). Raw evidence above is still accurate."
          )
        ).toBeTruthy()
      })

      it("shows the failure banner even when the node already has a cached explanation — a failed Regenerate must still surface an error", () => {
        renderPanel({
          variant: "canvas",
          nodeExplanations: new Map([["n1", "authenticate calls logout."]]),
          failedNodeIds: new Set(["n1"]),
        })
        selectNodeA()

        expect(screen.getByText(/synthesis failed/)).toBeTruthy()
        // The old prose stays visible alongside the failure — a failed Regenerate never discards it.
        expect(screen.getByText("authenticate calls logout.")).toBeTruthy()
      })

      it("shows a 'Not saved' note alongside the prose when the persistence write failed, without discarding the prose", () => {
        renderPanel({
          variant: "canvas",
          nodeExplanations: new Map([["n1", "authenticate calls logout."]]),
          unsavedNodeIds: new Set(["n1"]),
        })
        selectNodeA()

        expect(screen.getByText("authenticate calls logout.")).toBeTruthy()
        expect(screen.getByText("Not saved")).toBeTruthy()
      })

      it("never shows a cached explanation, in-flight state, or failure banner for a node other than the one selected", () => {
        renderPanel({
          variant: "canvas",
          result: baseResult({ subgraph: { nodes: [NODE_A, NODE_B], edges: [EDGE], seeds: ["n1"] } }),
          nodeExplanations: new Map([["n2", "logout ends the session."]]),
          explainingNodeIds: new Set(["n2"]),
          failedNodeIds: new Set(["n2"]),
        })
        selectNodeA()

        expect(screen.queryByText("logout ends the session.")).toBeNull()
        expect(screen.queryByRole("button", { name: "Explaining…" })).toBeNull()
        expect(screen.queryByText(/synthesis failed/)).toBeNull()
        expect(screen.getByRole("button", { name: "Explain" })).toBeTruthy()
      })
    })
  })

  it("shows the 'configure a provider' banner with a Settings link when no Provider key is configured", () => {
    renderPanel({
      result: baseResult({ degraded: { expansion: "none" } }),
      expansionBanner: "noProvider",
    })
    expect(
      screen.getByText(/Matched literally — configure a model provider to do better/)
    ).toBeTruthy()
    const link = screen.getByRole<HTMLAnchorElement>("link", { name: "Set it up" })
    expect(link.getAttribute("href")).toBe("/dashboard/settings/provider-keys")
  })

  it("shows the 'expansion failed' banner, with no action offered, when a configured key's call fails", () => {
    renderPanel({
      result: baseResult({ degraded: { expansion: "none" } }),
      expansionBanner: "expansionFailed",
    })
    expect(
      screen.getByText(/Matched literally — vocabulary expansion failed this time/)
    ).toBeTruthy()
    expect(screen.queryByRole("link", { name: "Set it up" })).toBeNull()
  })

  it("omits both expansion banners when neither applies", () => {
    renderPanel()
    expect(screen.queryByText(/Matched literally/)).toBeNull()
  })

  it("shows the 'synthesis failed' banner when set", () => {
    renderPanel({ synthesisBanner: "synthesisFailed" })
    expect(screen.getByText(/Showing raw evidence — synthesis failed this time/)).toBeTruthy()
  })

  it("shows the specific synthesis failure message when available, instead of the generic text", () => {
    renderPanel({
      synthesisBanner: "synthesisFailed",
      synthesisFailureMessage: "answer cites a source outside the retrieved evidence",
    })
    expect(
      screen.getByText(
        "Showing raw evidence — synthesis failed (answer cites a source outside the retrieved evidence)."
      )
    ).toBeTruthy()
    expect(screen.queryByText(/synthesis failed this time/)).toBeNull()
  })

  it("strips a message's own trailing period so it doesn't collide with the closing parenthesis", () => {
    renderPanel({
      synthesisBanner: "synthesisFailed",
      synthesisFailureMessage: "NetworkError when attempting to fetch resource.",
    })
    expect(
      screen.getByText(
        "Showing raw evidence — synthesis failed (NetworkError when attempting to fetch resource)."
      )
    ).toBeTruthy()
  })

  it("omits the synthesis banner when it doesn't apply", () => {
    renderPanel()
    expect(screen.queryByText(/synthesis failed/)).toBeNull()
  })

  it("stacks the synthesis banner alongside an expansion banner — docs/adr/0007", () => {
    renderPanel({ expansionBanner: "expansionFailed", synthesisBanner: "synthesisFailed" })
    expect(
      screen.getByText(/Matched literally — vocabulary expansion failed this time/)
    ).toBeTruthy()
    expect(screen.getByText(/Showing raw evidence — synthesis failed this time/)).toBeTruthy()
  })

  it("shows a synthesizing indicator while isSynthesizing is true (TBR-110)", () => {
    renderPanel({ isSynthesizing: true })
    expect(screen.getByText(/Synthesizing/)).toBeTruthy()
  })

  it("omits the synthesizing indicator once isSynthesizing is false, even with a result already on screen", () => {
    renderPanel({ isSynthesizing: false })
    expect(screen.queryByText(/Synthesizing/)).toBeNull()
  })

  it("never shows the synthesizing indicator alongside the settled synthesis-failed banner", () => {
    renderPanel({ isSynthesizing: false, synthesisBanner: "synthesisFailed" })
    expect(screen.getByText(/Showing raw evidence — synthesis failed this time/)).toBeTruthy()
    expect(screen.queryByText(/Synthesizing/)).toBeNull()
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

  // TBR-131: a second, separately-labeled action — the plain "Copy for your agent" button above
  // must stay evidence-only (packages/companion/src/context.ts's own contract), so the save
  // instruction is appended only here, client-side, never inside buildContext/context.markdown.
  describe("'Copy with save instructions' (TBR-131)", () => {
    it("copies the original evidence markdown plus an appended save-instruction block", async () => {
      const writeText = vi.fn().mockResolvedValue(undefined)
      Object.assign(navigator, { clipboard: { writeText } })

      renderPanel()
      fireEvent.click(screen.getByRole("button", { name: "Copy with save instructions" }))

      await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1))
      const copied = writeText.mock.calls[0]?.[0] as string
      expect(copied.startsWith("# question\n\nevidence")).toBe(true)
      expect(copied).toContain("notex_save_answer")
      // The pasted evidence's node ids belong to a different (browser-side) session — the
      // instruction must tell the agent not to treat them as usable sourceNodeIds directly.
      expect(copied).toMatch(/own (tool calls|session)/i)
    })

    it("does not alter the plain 'Copy for your agent' button's own payload", async () => {
      const writeText = vi.fn().mockResolvedValue(undefined)
      Object.assign(navigator, { clipboard: { writeText } })

      renderPanel()
      fireEvent.click(screen.getByRole("button", { name: "Copy for your agent" }))

      await waitFor(() => expect(writeText).toHaveBeenCalledWith("# question\n\nevidence"))
    })

    it("shows its own clipboard error message when the copy fails, independent of the other button", async () => {
      const writeText = vi.fn().mockRejectedValue(new Error("denied"))
      Object.assign(navigator, { clipboard: { writeText } })

      renderPanel()
      fireEvent.click(screen.getByRole("button", { name: "Copy with save instructions" }))

      expect(
        await screen.findByText(
          "Could not copy to your clipboard. Try again, or check your browser's clipboard permission."
        )
      ).toBeTruthy()
    })
  })

  describe("version switcher, stale banner, autosave indicator (TBR-118, TBR-124)", () => {
    function generation(overrides: Partial<GraphGenerationDTO> = {}): GraphGenerationDTO {
      return {
        graphHash: "abcdef0123456789",
        builtAt: "2026-08-30T00:00:00.000Z",
        headSha: null,
        nodeCount: 2,
        edgeCount: 0,
        communityCount: 1,
        questionAtGeneration: "how does auth work?",
        subgraph: { nodes: [], edges: [], seeds: [] },
        context: null,
        footer: null,
        lowConfidence: null,
        draftText: "",
        draftName: "Graph draft",
        expansionBanner: null,
        synthesisBanner: null,
        createdAt: 0,
        updatedAt: 0,
        ...overrides,
      }
    }
    const GENERATIONS = [
      generation({ graphHash: "abcdef0123456789", builtAt: "2026-08-30T00:00:00.000Z" }),
      generation({ graphHash: "0123456789abcdef", builtAt: "2026-08-15T00:00:00.000Z" }),
    ]

    it("renders every generation in the version switcher and calls onSelectVersion on pick", () => {
      const { onSelectVersion } = renderPanel({ generations: GENERATIONS })
      const select = screen.getByLabelText<HTMLSelectElement>("Graph version")
      expect(select.querySelectorAll("option").length).toBe(2)

      fireEvent.change(select, { target: { value: "0123456789abcdef" } })
      expect(onSelectVersion).toHaveBeenCalledWith("0123456789abcdef")
    })

    it("omits the version switcher when there are no persisted generations", () => {
      renderPanel({ generations: [] })
      expect(screen.queryByLabelText("Graph version")).toBeNull()
    })

    it("shows the stale banner when isStale is true", () => {
      renderPanel({ isStale: true })
      expect(
        screen.getByText(/The graph has changed since this was drafted/)
      ).toBeTruthy()
    })

    it("omits the stale banner when isStale is false", () => {
      renderPanel({ isStale: false })
      expect(screen.queryByText(/The graph has changed since this was drafted/)).toBeNull()
    })

    it("shows 'Saving…' while autosaveState is pending", () => {
      renderPanel({ variant: "draft", autosaveState: "pending" })
      expect(screen.getByText("Saving…")).toBeTruthy()
    })

    it("shows 'Not saved' when autosaveState is failed", () => {
      renderPanel({ variant: "draft", autosaveState: "failed" })
      expect(screen.getByText("Not saved")).toBeTruthy()
    })

    it("shows no autosave indicator when idle or saved", () => {
      renderPanel({ variant: "draft", autosaveState: "idle" })
      expect(screen.queryByText("Saving…")).toBeNull()
      expect(screen.queryByText("Not saved")).toBeNull()

      cleanup()
      renderPanel({ variant: "draft", autosaveState: "saved" })
      expect(screen.queryByText("Saving…")).toBeNull()
      expect(screen.queryByText("Not saved")).toBeNull()
    })
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
