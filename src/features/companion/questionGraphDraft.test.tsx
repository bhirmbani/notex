// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, cleanup, renderHook, waitFor } from "@testing-library/react"

import { DEFAULT_DRAFT_NAME, useQuestionGraphDraft } from "./questionGraphDraft"
import * as connectionState from "./connectionState"
import * as client from "./client"
import type { ReactNode } from "react"
import type { GraphGenerationDTO } from "./persistenceTypes"
import type { ProviderConfig } from "@/features/provider-keys/types"
import type { DraftExpansionOutcome } from "@/features/vocabulary-expansion/expandForDraft"
import type { DraftSynthesisOutcome } from "@/features/draft-synthesis/synthesizeForDraft"
import * as providerKeyStorage from "@/features/provider-keys/storage"
import * as expandForDraftModule from "@/features/vocabulary-expansion/expandForDraft"
import * as synthesizeForDraftModule from "@/features/draft-synthesis/synthesizeForDraft"

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as Response
}

/**
 * A minimal in-memory stand-in for the `graph_generations`/`files` persistence endpoints
 * (TBR-117), installed on `global.fetch` fresh before every test. `useQuestionGraphDraft` is
 * cache-first (TBR-118) — its rendered `result` is sourced from a GET against this backend, not
 * from a companion result directly — so any test that checks `.result` needs it wired up.
 */
function installBackend() {
  let generations: Array<GraphGenerationDTO> = []
  let saveFileImpl: () => Response | Promise<Response> = () => jsonResponse({ id: "f1" })
  let deferredSave: { promise: Promise<Response>; resolve: (r: Response) => void } | null = null
  let deferredPut: { promise: Promise<Response>; resolve: (r: Response) => void } | null = null
  let nextPatchFails = false

  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const method = init?.method ?? "GET"

    if (url.endsWith("/graph-generations") && method === "GET") {
      return jsonResponse(generations)
    }

    const genMatch = url.match(/\/graph-generations\/([^/]+)$/)
    if (genMatch && method === "PUT") {
      const graphHash = decodeURIComponent(genMatch[1] ?? "")
      const body = JSON.parse(String(init?.body)) as Omit<
        GraphGenerationDTO,
        "graphHash" | "createdAt" | "updatedAt"
      >
      const existing = generations.find((g) => g.graphHash === graphHash)
      const now = Date.now()
      const row: GraphGenerationDTO = {
        graphHash,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
        ...body,
      }
      // The server-side write always lands immediately — only the HTTP response back to the
      // client is (optionally) held up, modelling the round-trip window `activeGraphHash`
      // guards against.
      generations = [row, ...generations.filter((g) => g.graphHash !== graphHash)]
      if (deferredPut) {
        const d = deferredPut
        deferredPut = null
        return d.promise
      }
      return jsonResponse(row)
    }
    if (genMatch && method === "PATCH") {
      if (nextPatchFails) {
        nextPatchFails = false
        return jsonResponse({ error: { code: "INTERNAL" } }, 500)
      }
      const graphHash = decodeURIComponent(genMatch[1] ?? "")
      const existing = generations.find((g) => g.graphHash === graphHash)
      if (!existing) return jsonResponse({ error: { code: "NOT_FOUND" } }, 404)
      const body = JSON.parse(String(init?.body)) as { draftText?: string; draftName?: string }
      const row = { ...existing, ...body, updatedAt: Date.now() }
      generations = generations.map((g) => (g.graphHash === graphHash ? row : g))
      return jsonResponse(row)
    }

    if (url.endsWith("/files") && method === "POST") {
      if (deferredSave) {
        const d = deferredSave
        deferredSave = null
        return d.promise
      }
      return saveFileImpl()
    }

    throw new Error(`Unhandled fetch in test: ${method} ${url}`)
  })
  vi.spyOn(global, "fetch").mockImplementation(fetchMock as unknown as typeof fetch)

  return {
    fetchMock,
    seed(rows: Array<GraphGenerationDTO>) {
      generations = rows
    },
    get generations() {
      return generations
    },
    setSaveFileImpl(impl: () => Response | Promise<Response>) {
      saveFileImpl = impl
    },
    deferNextSave() {
      let resolve!: (r: Response) => void
      const promise = new Promise<Response>((res) => {
        resolve = res
      })
      deferredSave = { promise, resolve }
      return { resolve }
    },
    deferNextPut() {
      let resolve!: (r: Response) => void
      const promise = new Promise<Response>((res) => {
        resolve = res
      })
      deferredPut = { promise, resolve }
      return { resolve }
    },
    failNextPatch() {
      nextPatchFails = true
    },
  }
}

let backend: ReturnType<typeof installBackend>

beforeEach(() => {
  backend = installBackend()
})

afterEach(() => {
  // Unmounts every hook rendered in the test, running each effect's own cleanup (notably the
  // autosave effect's `clearTimeout`) — without this, a real 1s autosave timer left pending by
  // one test can fire mid-run of a later test and hit that test's freshly (re)installed fetch
  // mock, corrupting its call count.
  cleanup()
  vi.restoreAllMocks()
  localStorage.clear()
})

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
}

const PAIRING = { baseUrl: "http://127.0.0.1:7717", token: "tok", checkoutId: "c1" }
const STATUS = { graph: { checkoutPath: "/repo" } } as never

function connectAsConnected() {
  vi.spyOn(connectionState, "resolveConnectionState").mockResolvedValue({
    state: "connected",
    pairing: PAIRING,
    status: STATUS,
  })
}

function seedGeneration(overrides: Partial<GraphGenerationDTO> = {}): GraphGenerationDTO {
  return {
    graphHash: "hash-a",
    builtAt: "2026-08-29T00:00:00.000Z",
    headSha: null,
    nodeCount: 1,
    edgeCount: 0,
    communityCount: 1,
    questionAtGeneration: "how does auth work?",
    subgraph: { nodes: [], edges: [], seeds: [] },
    context: { markdown: "persisted evidence", sources: [] },
    footer: null,
    lowConfidence: null,
    draftText: "persisted draft",
    draftName: "Graph draft",
    expansionBanner: null,
    synthesisBanner: null,
    createdAt: 1000,
    updatedAt: 1000,
    ...overrides,
  }
}

describe("useQuestionGraphDraft", () => {
  it("cannot draft when not connected, and issues no query", async () => {
    vi.spyOn(connectionState, "resolveConnectionState").mockResolvedValue({
      state: "unpaired",
    })
    const querySpy = vi.spyOn(client, "query")

    const { result } = renderHook(
      () => useQuestionGraphDraft("repo-1", "how does auth work?", "org-1", "ctx-1"),
      { wrapper }
    )

    await waitFor(() => expect(result.current.connectionState).toBe("unpaired"))
    expect(result.current.canDraft).toBe(false)

    result.current.run()
    expect(querySpy).not.toHaveBeenCalled()
  })

  it("runs the default-bounds query on `run`, defaulting to the Files variant", async () => {
    connectAsConnected()
    const querySpy = vi.spyOn(client, "query").mockResolvedValue({
      graph: {} as never,
      subgraph: { nodes: [], edges: [], seeds: [] },
    })

    const { result } = renderHook(
      () => useQuestionGraphDraft("repo-1", "how does auth work?", "org-1", "ctx-1"),
      { wrapper }
    )

    await waitFor(() => expect(result.current.canDraft).toBe(true))

    act(() => result.current.run())

    await waitFor(() => expect(result.current.result).toBeTruthy())
    expect(querySpy).toHaveBeenCalledWith(PAIRING.baseUrl, PAIRING.token, {
      question: "how does auth work?",
      include: ["subgraph", "context", "footer"],
    })
    expect(result.current.variant).toBe("files")
  })

  it("sends depth: 2 on `expand`, and nothing else beyond the default request", async () => {
    connectAsConnected()
    const querySpy = vi.spyOn(client, "query").mockResolvedValue({
      graph: {} as never,
      subgraph: { nodes: [], edges: [], seeds: [] },
    })

    const { result } = renderHook(
      () => useQuestionGraphDraft("repo-1", "how does auth work?", "org-1", "ctx-1"),
      { wrapper }
    )

    await waitFor(() => expect(result.current.canDraft).toBe(true))

    act(() => result.current.expand())

    await waitFor(() =>
      expect(querySpy).toHaveBeenCalledWith(PAIRING.baseUrl, PAIRING.token, {
        question: "how does auth work?",
        include: ["subgraph", "context", "footer"],
        depth: 2,
      })
    )
  })

  it("pre-fills draftText from context.markdown, and a new retrieval replaces it", async () => {
    connectAsConnected()
    const querySpy = vi
      .spyOn(client, "query")
      .mockResolvedValueOnce({
        graph: {} as never,
        subgraph: { nodes: [], edges: [], seeds: [] },
        context: { markdown: "first draft body", sources: [] },
      })
      .mockResolvedValueOnce({
        graph: {} as never,
        subgraph: { nodes: [], edges: [], seeds: [] },
        context: { markdown: "second draft body", sources: [] },
      })

    const { result } = renderHook(
      () => useQuestionGraphDraft("repo-1", "how does auth work?", "org-1", "ctx-1"),
      { wrapper }
    )
    await waitFor(() => expect(result.current.canDraft).toBe(true))

    act(() => result.current.run())
    await waitFor(() => expect(result.current.draftText).toBe("first draft body"))

    // The known trap (graph-gui.md §2.5): switching variants must never touch draftText.
    act(() => result.current.setVariant("canvas"))
    act(() => result.current.setDraftText("first draft body, edited by hand"))
    act(() => result.current.setVariant("draft"))
    expect(result.current.draftText).toBe("first draft body, edited by hand")

    // A new retrieval — not a variant switch — is the only thing allowed to replace it.
    act(() => result.current.run())
    await waitFor(() => expect(result.current.draftText).toBe("second draft body"))
    expect(querySpy).toHaveBeenCalledTimes(2)
  })

  it("does not reset a custom draftName on a later retrieval (Expand is not a rename)", async () => {
    connectAsConnected()
    vi.spyOn(client, "query")
      .mockResolvedValueOnce({
        graph: {} as never,
        subgraph: { nodes: [], edges: [], seeds: [] },
        context: { markdown: "first draft body", sources: [] },
      })
      .mockResolvedValueOnce({
        graph: {} as never,
        subgraph: { nodes: [], edges: [], seeds: [] },
        context: { markdown: "wider draft body", sources: [] },
      })

    const { result } = renderHook(
      () => useQuestionGraphDraft("repo-1", "how does auth work?", "org-1", "ctx-1"),
      { wrapper }
    )
    await waitFor(() => expect(result.current.canDraft).toBe(true))

    act(() => result.current.run())
    await waitFor(() => expect(result.current.draftText).toBe("first draft body"))

    act(() => result.current.setDraftName("Auth flow explainer"))
    act(() => result.current.expand())

    await waitFor(() => expect(result.current.draftText).toBe("wider draft body"))
    expect(result.current.draftName).toBe("Auth flow explainer")
  })

  it("keeps the last result available (with error set alongside it) when a retry fails — graph-gui.md §6.2", async () => {
    connectAsConnected()
    const querySpy = vi
      .spyOn(client, "query")
      .mockResolvedValueOnce({
        graph: {} as never,
        subgraph: { nodes: [], edges: [], seeds: [] },
        context: { markdown: "first draft body", sources: [] },
      })
      .mockRejectedValueOnce(new Error("companion unreachable"))

    const { result } = renderHook(
      () => useQuestionGraphDraft("repo-1", "how does auth work?", "org-1", "ctx-1"),
      { wrapper }
    )
    await waitFor(() => expect(result.current.canDraft).toBe(true))

    act(() => result.current.run())
    await waitFor(() => expect(result.current.result).toBeTruthy())

    act(() => result.current.expand())
    await waitFor(() => expect(result.current.error).toBeTruthy())

    // The whole point: a failed retry must not blank out the last good result.
    expect(result.current.result?.context?.markdown).toBe("first draft body")
    expect(querySpy).toHaveBeenCalledTimes(2)
  })

  it("save() posts the draft text plus the footer verbatim as a new text Answer", async () => {
    connectAsConnected()
    vi.spyOn(client, "query").mockResolvedValue({
      graph: {} as never,
      subgraph: { nodes: [], edges: [], seeds: [] },
      context: { markdown: "evidence body", sources: [] },
      footer: "\n---\nDrafted from the code graph on 2026-08-28.",
    })

    const { result } = renderHook(
      () => useQuestionGraphDraft("repo-1", "how does auth work?", "org-1", "ctx-1"),
      { wrapper }
    )
    await waitFor(() => expect(result.current.canDraft).toBe(true))

    act(() => result.current.run())
    await waitFor(() => expect(result.current.draftText).toBe("evidence body"))
    act(() => result.current.setDraftText("edited prose"))

    await act(async () => {
      await result.current.save()
    })

    expect(backend.fetchMock).toHaveBeenCalledWith(
      "/api/v1/organizations/org-1/contexts/ctx-1/files",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          name: DEFAULT_DRAFT_NAME,
          contentType: "text",
          content: "edited prose\n---\nDrafted from the code graph on 2026-08-28.",
        }),
      })
    )
    expect(result.current.saved).toBe(true)
  })

  it("does not show 'Saved' for a save that a newer retrieval outran", async () => {
    connectAsConnected()
    vi.spyOn(client, "query")
      .mockResolvedValueOnce({
        graph: {} as never,
        subgraph: { nodes: [], edges: [], seeds: [] },
        context: { markdown: "evidence body", sources: [] },
        footer: "",
      })
      .mockResolvedValueOnce({
        graph: {} as never,
        subgraph: { nodes: [], edges: [], seeds: [] },
        context: { markdown: "newer evidence body", sources: [] },
        footer: "",
      })

    const { resolve: resolveFetch } = backend.deferNextSave()

    const { result } = renderHook(
      () => useQuestionGraphDraft("repo-1", "how does auth work?", "org-1", "ctx-1"),
      { wrapper }
    )
    await waitFor(() => expect(result.current.canDraft).toBe(true))
    act(() => result.current.run())
    await waitFor(() => expect(result.current.draftText).toBe("evidence body"))

    // Save is in flight (fetch not yet resolved) when a newer retrieval lands.
    let savePromise!: Promise<void>
    act(() => {
      savePromise = result.current.save()
    })
    act(() => result.current.expand())
    await waitFor(() => expect(result.current.draftText).toBe("newer evidence body"))

    await act(async () => {
      resolveFetch(jsonResponse({ id: "f1" }))
      await savePromise
    })

    expect(result.current.saved).toBe(false)
  })

  it("editing the draft after a successful save clears the saved confirmation", async () => {
    connectAsConnected()
    vi.spyOn(client, "query").mockResolvedValue({
      graph: {} as never,
      subgraph: { nodes: [], edges: [], seeds: [] },
      context: { markdown: "evidence body", sources: [] },
      footer: "",
    })

    const { result } = renderHook(
      () => useQuestionGraphDraft("repo-1", "how does auth work?", "org-1", "ctx-1"),
      { wrapper }
    )
    await waitFor(() => expect(result.current.canDraft).toBe(true))
    act(() => result.current.run())
    await waitFor(() => expect(result.current.draftText).toBe("evidence body"))

    await act(async () => {
      await result.current.save()
    })
    expect(result.current.saved).toBe(true)

    act(() => result.current.setDraftText("evidence body, more edits"))
    expect(result.current.saved).toBe(false)
  })

  // TBR-118, TBR-124: cache-first load, regenerate resetting the version selector, a version
  // switch cancelling a stale pending autosave, and a failed autosave surfacing the indicator.
  describe("cache-first load, regenerate, autosave, version switching", () => {
    it("renders the last persisted generation on mount with no companion call", async () => {
      connectAsConnected()
      backend.seed([seedGeneration()])
      const querySpy = vi.spyOn(client, "query")

      const { result } = renderHook(
        () => useQuestionGraphDraft("repo-1", "how does auth work?", "org-1", "ctx-1"),
        { wrapper }
      )

      await waitFor(() =>
        expect(result.current.result?.context?.markdown).toBe("persisted evidence")
      )
      expect(result.current.draftText).toBe("persisted draft")
      expect(result.current.hasGeneration).toBe(true)
      expect(querySpy).not.toHaveBeenCalled()
    })

    it("renders the persisted generation even with the companion disconnected — only Regenerate is unavailable", async () => {
      vi.spyOn(connectionState, "resolveConnectionState").mockResolvedValue({ state: "unpaired" })
      backend.seed([seedGeneration()])

      const { result } = renderHook(
        () => useQuestionGraphDraft("repo-1", "how does auth work?", "org-1", "ctx-1"),
        { wrapper }
      )

      await waitFor(() => expect(result.current.hasGeneration).toBe(true))
      expect(result.current.result?.context?.markdown).toBe("persisted evidence")
      expect(result.current.canDraft).toBe(false)
    })

    it("resets selectedGraphHash to null (follow latest) when regenerate is called", async () => {
      connectAsConnected()
      backend.seed([
        seedGeneration({ graphHash: "hash-a", builtAt: "2026-08-29T00:00:00.000Z" }),
        seedGeneration({ graphHash: "hash-b", builtAt: "2026-08-20T00:00:00.000Z" }),
      ])
      vi.spyOn(client, "query").mockResolvedValue({
        graph: {} as never,
        subgraph: { nodes: [], edges: [], seeds: [] },
        context: { markdown: "fresh evidence", sources: [] },
      })

      const { result } = renderHook(
        () => useQuestionGraphDraft("repo-1", "how does auth work?", "org-1", "ctx-1"),
        { wrapper }
      )
      await waitFor(() => expect(result.current.hasGeneration).toBe(true))

      act(() => result.current.selectVersion("hash-b"))
      expect(result.current.selectedGraphHash).toBe("hash-b")

      act(() => result.current.run())
      expect(result.current.selectedGraphHash).toBeNull()
    })

    it("cancels a pending autosave from a previous version on a version switch — it must never write into the wrong row", async () => {
      connectAsConnected()
      backend.seed([
        seedGeneration({ graphHash: "hash-a", draftText: "version a draft" }),
        seedGeneration({
          graphHash: "hash-b",
          draftText: "version b draft",
          builtAt: "2026-08-20T00:00:00.000Z",
        }),
      ])

      const { result } = renderHook(
        () => useQuestionGraphDraft("repo-1", "how does auth work?", "org-1", "ctx-1"),
        { wrapper }
      )
      await waitFor(() => expect(result.current.draftText).toBe("version a draft"))

      act(() => result.current.setDraftText("edited on version a"))
      act(() => result.current.selectVersion("hash-b"))
      await waitFor(() => expect(result.current.draftText).toBe("version b draft"))

      // Give version a's 1s autosave debounce plenty of time to have fired if the switch above
      // hadn't cancelled it.
      await new Promise((resolve) => setTimeout(resolve, 1300))

      const patchCalls = backend.fetchMock.mock.calls.filter(
        ([, init]) => (init)?.method === "PATCH"
      )
      expect(patchCalls).toHaveLength(0)
      expect(result.current.draftText).toBe("version b draft")
    }, 10000)

    it("sets autosaveState to 'failed' when the autosave PATCH fails, without discarding the edit", async () => {
      connectAsConnected()
      backend.seed([seedGeneration()])
      backend.failNextPatch()

      const { result } = renderHook(
        () => useQuestionGraphDraft("repo-1", "how does auth work?", "org-1", "ctx-1"),
        { wrapper }
      )
      await waitFor(() => expect(result.current.draftText).toBe("persisted draft"))

      act(() => result.current.setDraftText("an edit that fails to autosave"))

      // Real time, matching the 1s autosave debounce — see the version-switch test above for
      // why `waitFor`'s own polling timeout isn't used to race against it.
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 1500))
      })

      expect(result.current.autosaveState).toBe("failed")
      expect(result.current.draftText).toBe("an edit that fails to autosave")
    }, 10000)

    it("autosaves a Draft edit and clears to 'saved'", async () => {
      connectAsConnected()
      backend.seed([seedGeneration()])

      const { result } = renderHook(
        () => useQuestionGraphDraft("repo-1", "how does auth work?", "org-1", "ctx-1"),
        { wrapper }
      )
      await waitFor(() => expect(result.current.draftText).toBe("persisted draft"))

      act(() => result.current.setDraftText("an autosaved edit"))
      expect(result.current.autosaveState).toBe("pending")

      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 1500))
      })

      expect(result.current.autosaveState).toBe("saved")
      expect(backend.generations.find((g) => g.graphHash === "hash-a")?.draftText).toBe(
        "an autosaved edit"
      )
    }, 10000)

    it("resets autosaveState back to idle on a version switch — a stale 'failed'/'saved' must not describe the newly shown version", async () => {
      connectAsConnected()
      backend.seed([
        seedGeneration({ graphHash: "hash-a", draftText: "version a draft" }),
        seedGeneration({
          graphHash: "hash-b",
          draftText: "version b draft",
          builtAt: "2026-08-20T00:00:00.000Z",
        }),
      ])
      backend.failNextPatch()

      const { result } = renderHook(
        () => useQuestionGraphDraft("repo-1", "how does auth work?", "org-1", "ctx-1"),
        { wrapper }
      )
      await waitFor(() => expect(result.current.draftText).toBe("version a draft"))

      act(() => result.current.setDraftText("an edit that will fail to autosave"))
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 1500))
      })
      expect(result.current.autosaveState).toBe("failed")

      act(() => result.current.selectVersion("hash-b"))
      await waitFor(() => expect(result.current.draftText).toBe("version b draft"))
      expect(result.current.autosaveState).toBe("idle")
    }, 10000)

    it("PATCHes the version a regenerate just produced, not the still-shown previous one, when an edit lands before the regenerate's own persist round-trips", async () => {
      connectAsConnected()
      backend.seed([seedGeneration({ graphHash: "hash-old", draftText: "old version draft" })])
      vi.spyOn(client, "query").mockResolvedValue({
        graph: { graphHash: "hash-new", builtAt: "2026-08-30T00:00:00.000Z" } as never,
        subgraph: { nodes: [], edges: [], seeds: [] },
        context: { markdown: "fresh evidence", sources: [] },
      })

      const { result } = renderHook(
        () => useQuestionGraphDraft("repo-1", "how does auth work?", "org-1", "ctx-1"),
        { wrapper }
      )
      await waitFor(() => expect(result.current.draftText).toBe("old version draft"))

      // Hold up the regenerate's own PUT response — `shown` (still `hash-old`) won't catch up
      // to `hash-new` until it resolves, but `draftText` already has.
      const { resolve: resolvePut } = backend.deferNextPut()
      act(() => result.current.run())
      await waitFor(() => expect(result.current.draftText).toBe("fresh evidence"))

      // The user edits while `shown` is still the old version.
      act(() => result.current.setDraftText("edited before the PUT round-tripped"))

      resolvePut(jsonResponse({}))
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 1500))
      })

      const patchCalls = backend.fetchMock.mock.calls.filter(
        ([, init]) => (init)?.method === "PATCH"
      )
      expect(patchCalls).toHaveLength(1)
      expect(String(patchCalls[0]?.[0])).toContain("/graph-generations/hash-new")
      expect(
        backend.generations.find((g) => g.graphHash === "hash-old")?.draftText
      ).toBe("old version draft")
      expect(
        backend.generations.find((g) => g.graphHash === "hash-new")?.draftText
      ).toBe("edited before the PUT round-tripped")
    }, 10000)

    it("carries the traversal-cap ('truncated') notice from a fresh regenerate into the rendered result", async () => {
      connectAsConnected()
      vi.spyOn(client, "query").mockResolvedValue({
        graph: { graphHash: "hash-a", builtAt: "2026-08-30T00:00:00.000Z" } as never,
        subgraph: { nodes: [], edges: [], seeds: [] },
        context: { markdown: "evidence", sources: [] },
        truncated: { reason: "maxNodes", omittedCount: 7 },
      })

      const { result } = renderHook(
        () => useQuestionGraphDraft("repo-1", "how does auth work?", "org-1", "ctx-1"),
        { wrapper }
      )
      await waitFor(() => expect(result.current.canDraft).toBe(true))

      act(() => result.current.run())

      await waitFor(() => expect(result.current.result?.truncated).toEqual({
        reason: "maxNodes",
        omittedCount: 7,
      }))
    })

    it("clears a stale truncated notice on a version switch to a generation it wasn't captured for", async () => {
      connectAsConnected()
      backend.seed([
        seedGeneration({ graphHash: "hash-a" }),
        seedGeneration({ graphHash: "hash-b", builtAt: "2026-08-20T00:00:00.000Z" }),
      ])
      vi.spyOn(client, "query").mockResolvedValue({
        graph: { graphHash: "hash-a", builtAt: "2026-08-30T00:00:00.000Z" } as never,
        subgraph: { nodes: [], edges: [], seeds: [] },
        context: { markdown: "evidence", sources: [] },
        truncated: { reason: "maxNodes", omittedCount: 3 },
      })

      const { result } = renderHook(
        () => useQuestionGraphDraft("repo-1", "how does auth work?", "org-1", "ctx-1"),
        { wrapper }
      )
      await waitFor(() => expect(result.current.hasGeneration).toBe(true))

      act(() => result.current.run())
      await waitFor(() => expect(result.current.result?.truncated).toBeTruthy())

      act(() => result.current.selectVersion("hash-b"))
      await waitFor(() => expect(result.current.draftText).toBe("persisted draft"))
      expect(result.current.result?.truncated).toBeUndefined()
    })

    it("resets every per-Question field when contextId changes — the route reuses this hook instance across Questions", async () => {
      connectAsConnected()
      backend.seed([seedGeneration({ graphHash: "hash-a", draftText: "question A's draft" })])

      const { result, rerender } = renderHook(
        ({ ctxId }) => useQuestionGraphDraft("repo-1", "how does auth work?", "org-1", ctxId),
        { wrapper, initialProps: { ctxId: "ctx-1" } }
      )
      await waitFor(() => expect(result.current.draftText).toBe("question A's draft"))
      act(() => result.current.selectVersion("hash-a"))

      // A second Question, with nothing persisted yet — same hook instance, new contextId, the
      // way TanStack Router reuses a component across a param-only navigation.
      backend.seed([])
      rerender({ ctxId: "ctx-2" })

      expect(result.current.draftText).toBe("")
      expect(result.current.selectedGraphHash).toBeNull()
      expect(result.current.hasGeneration).toBe(false)
      expect(result.current.result).toBeUndefined()
    })
  })

  // docs/specs/vocabulary-expansion.md §1, §5 — TBR-98.
  describe("vocabulary expansion wiring", () => {
    const ANTHROPIC_PROVIDER: ProviderConfig = {
      id: "p1",
      adapter: "anthropic",
      apiKey: "sk-ant-test",
      model: "claude-haiku-test",
    }

    it("with no Provider key configured, queries with no terms[] — byte-identical to today's degraded path (regression guard)", async () => {
      connectAsConnected()
      const querySpy = vi.spyOn(client, "query").mockResolvedValue({
        graph: {} as never,
        subgraph: { nodes: [], edges: [], seeds: [] },
        degraded: { expansion: "none" },
      })
      const expandSpy = vi.spyOn(expandForDraftModule, "expandForDraft")

      const { result } = renderHook(
        () => useQuestionGraphDraft("repo-1", "how does auth work?", "org-1", "ctx-1"),
        { wrapper }
      )
      await waitFor(() => expect(result.current.canDraft).toBe(true))

      act(() => result.current.run())

      await waitFor(() => expect(result.current.result).toBeTruthy())
      expect(querySpy).toHaveBeenCalledWith(PAIRING.baseUrl, PAIRING.token, {
        question: "how does auth work?",
        include: ["subgraph", "context", "footer"],
      })
      expect(expandSpy).not.toHaveBeenCalled()
      expect(result.current.expansionBanner).toBe("noProvider")
    })

    it("with a valid key and a successful expansion, queries with terms[] and clears the banner", async () => {
      connectAsConnected()
      vi.spyOn(providerKeyStorage, "getActiveProviderKey").mockReturnValue(ANTHROPIC_PROVIDER)
      vi.spyOn(expandForDraftModule, "expandForDraft").mockResolvedValue({
        status: "success",
        terms: ["auth", "session"],
      })
      const querySpy = vi.spyOn(client, "query").mockResolvedValue({
        graph: {} as never,
        subgraph: { nodes: [], edges: [], seeds: [] },
      })

      const { result } = renderHook(
        () => useQuestionGraphDraft("repo-1", "how does auth work?", "org-1", "ctx-1"),
        { wrapper }
      )
      await waitFor(() => expect(result.current.canDraft).toBe(true))

      act(() => result.current.run())

      await waitFor(() => expect(result.current.result).toBeTruthy())
      expect(querySpy).toHaveBeenCalledWith(PAIRING.baseUrl, PAIRING.token, {
        question: "how does auth work?",
        include: ["subgraph", "context", "footer"],
        terms: ["auth", "session"],
      })
      expect(result.current.expansionBanner).toBeUndefined()
    })

    it("on expansion failure (transport or LLM-level), queries with no terms[] and surfaces 'expansion failed', never 'no provider'", async () => {
      connectAsConnected()
      vi.spyOn(providerKeyStorage, "getActiveProviderKey").mockReturnValue(ANTHROPIC_PROVIDER)
      vi.spyOn(expandForDraftModule, "expandForDraft").mockResolvedValue({
        status: "failed",
        message: "provider responded 500",
      })
      const querySpy = vi.spyOn(client, "query").mockResolvedValue({
        graph: {} as never,
        subgraph: { nodes: [], edges: [], seeds: [] },
        degraded: { expansion: "none" },
      })

      const { result } = renderHook(
        () => useQuestionGraphDraft("repo-1", "how does auth work?", "org-1", "ctx-1"),
        { wrapper }
      )
      await waitFor(() => expect(result.current.canDraft).toBe(true))

      act(() => result.current.run())

      await waitFor(() => expect(result.current.result).toBeTruthy())
      expect(querySpy).toHaveBeenCalledWith(PAIRING.baseUrl, PAIRING.token, {
        question: "how does auth work?",
        include: ["subgraph", "context", "footer"],
      })
      expect(result.current.expansionBanner).toBe("expansionFailed")
    })

    it("wires the same expansion flow into `expand`, alongside depth: 2", async () => {
      connectAsConnected()
      vi.spyOn(providerKeyStorage, "getActiveProviderKey").mockReturnValue(ANTHROPIC_PROVIDER)
      vi.spyOn(expandForDraftModule, "expandForDraft").mockResolvedValue({
        status: "success",
        terms: ["auth"],
      })
      const querySpy = vi.spyOn(client, "query").mockResolvedValue({
        graph: {} as never,
        subgraph: { nodes: [], edges: [], seeds: [] },
      })

      const { result } = renderHook(
        () => useQuestionGraphDraft("repo-1", "how does auth work?", "org-1", "ctx-1"),
        { wrapper }
      )
      await waitFor(() => expect(result.current.canDraft).toBe(true))

      act(() => result.current.expand())

      await waitFor(() =>
        expect(querySpy).toHaveBeenCalledWith(PAIRING.baseUrl, PAIRING.token, {
          question: "how does auth work?",
          include: ["subgraph", "context", "footer"],
          terms: ["auth"],
          depth: 2,
        })
      )
    })

    it("ignores a superseded expansion attempt — a stale outcome must not override a newer call's banner or query", async () => {
      connectAsConnected()
      vi.spyOn(providerKeyStorage, "getActiveProviderKey").mockReturnValue(ANTHROPIC_PROVIDER)

      let resolveStale!: (outcome: DraftExpansionOutcome) => void
      const stalePromise = new Promise<DraftExpansionOutcome>((resolve) => {
        resolveStale = resolve
      })
      vi.spyOn(expandForDraftModule, "expandForDraft")
        .mockReturnValueOnce(stalePromise)
        .mockResolvedValueOnce({ status: "success", terms: ["auth"] })

      const querySpy = vi.spyOn(client, "query").mockResolvedValue({
        graph: {} as never,
        subgraph: { nodes: [], edges: [], seeds: [] },
      })

      const { result } = renderHook(
        () => useQuestionGraphDraft("repo-1", "how does auth work?", "org-1", "ctx-1"),
        { wrapper }
      )
      await waitFor(() => expect(result.current.canDraft).toBe(true))

      // First call (`run`) is left in flight; the second (`expand`) resolves right away and
      // wins — it's the newer, currently-relevant attempt.
      act(() => result.current.run())
      act(() => result.current.expand())

      await waitFor(() => expect(querySpy).toHaveBeenCalledTimes(1))
      expect(result.current.expansionBanner).toBeUndefined()

      // The stale first call finally settles (as a failure) after the newer one already won —
      // it must be a no-op: no second query, no banner flip, no isPending stuck true.
      await act(async () => {
        resolveStale({ status: "failed", message: "stale" })
        await Promise.resolve()
      })

      expect(querySpy).toHaveBeenCalledTimes(1)
      expect(result.current.expansionBanner).toBeUndefined()
      await waitFor(() => expect(result.current.isPending).toBe(false))
    })
  })

  // docs/adr/0007-draft-synthesis-runs-in-the-browser-not-the-companion.md, TBR-102.
  describe("draft synthesis wiring", () => {
    const ANTHROPIC_PROVIDER: ProviderConfig = {
      id: "p1",
      adapter: "anthropic",
      apiKey: "sk-ant-test",
      model: "claude-haiku-test",
    }

    it("with no Provider key configured, never attempts synthesis — raw-evidence Draft stays byte-identical (regression guard)", async () => {
      connectAsConnected()
      vi.spyOn(client, "query").mockResolvedValue({
        graph: {} as never,
        subgraph: { nodes: [], edges: [], seeds: ["n1"] },
        context: { markdown: "raw evidence body", sources: [] },
      })
      const synthesizeSpy = vi.spyOn(synthesizeForDraftModule, "synthesizeForDraft")

      const { result } = renderHook(
        () => useQuestionGraphDraft("repo-1", "how does auth work?", "org-1", "ctx-1"),
        { wrapper }
      )
      await waitFor(() => expect(result.current.canDraft).toBe(true))

      act(() => result.current.run())

      await waitFor(() => expect(result.current.draftText).toBe("raw evidence body"))
      expect(synthesizeSpy).not.toHaveBeenCalled()
      expect(result.current.synthesisBanner).toBeUndefined()
    })

    it("with a Provider key and a successful non-lowConfidence query, seeds draftText with the synthesized prose", async () => {
      connectAsConnected()
      vi.spyOn(providerKeyStorage, "getActiveProviderKey").mockReturnValue(ANTHROPIC_PROVIDER)
      vi.spyOn(expandForDraftModule, "expandForDraft").mockResolvedValue({
        status: "success",
        terms: ["auth"],
      })
      const context = { markdown: "raw evidence body", sources: [{ file: "a.ts", location: "L1" }] }
      vi.spyOn(client, "query").mockResolvedValue({
        graph: {} as never,
        subgraph: { nodes: [], edges: [], seeds: ["n1"] },
        context,
      })
      const synthesizeSpy = vi
        .spyOn(synthesizeForDraftModule, "synthesizeForDraft")
        .mockResolvedValue({ status: "success", prose: "Cited prose (a.ts:L1)." })

      const { result } = renderHook(
        () => useQuestionGraphDraft("repo-1", "how does auth work?", "org-1", "ctx-1"),
        { wrapper }
      )
      await waitFor(() => expect(result.current.canDraft).toBe(true))

      act(() => result.current.run())

      await waitFor(() => expect(result.current.draftText).toBe("Cited prose (a.ts:L1)."))
      expect(synthesizeSpy).toHaveBeenCalledWith("how does auth work?", context, ANTHROPIC_PROVIDER)
      expect(result.current.synthesisBanner).toBeUndefined()
    })

    it("on synthesis failure, falls back to the raw-evidence draftText and sets 'synthesisFailed'", async () => {
      connectAsConnected()
      vi.spyOn(providerKeyStorage, "getActiveProviderKey").mockReturnValue(ANTHROPIC_PROVIDER)
      vi.spyOn(expandForDraftModule, "expandForDraft").mockResolvedValue({
        status: "success",
        terms: ["auth"],
      })
      vi.spyOn(client, "query").mockResolvedValue({
        graph: {} as never,
        subgraph: { nodes: [], edges: [], seeds: ["n1"] },
        context: { markdown: "raw evidence body", sources: [] },
      })
      vi.spyOn(synthesizeForDraftModule, "synthesizeForDraft").mockResolvedValue({
        status: "failed",
        message: "provider timed out",
      })

      const { result } = renderHook(
        () => useQuestionGraphDraft("repo-1", "how does auth work?", "org-1", "ctx-1"),
        { wrapper }
      )
      await waitFor(() => expect(result.current.canDraft).toBe(true))

      act(() => result.current.run())

      await waitFor(() => expect(result.current.synthesisBanner).toBe("synthesisFailed"))
      expect(result.current.draftText).toBe("raw evidence body")
    })

    it("retains the specific failure message from a failed synthesis call", async () => {
      connectAsConnected()
      vi.spyOn(providerKeyStorage, "getActiveProviderKey").mockReturnValue(ANTHROPIC_PROVIDER)
      vi.spyOn(expandForDraftModule, "expandForDraft").mockResolvedValue({
        status: "success",
        terms: ["auth"],
      })
      vi.spyOn(client, "query").mockResolvedValue({
        graph: { graphHash: "hash-a", builtAt: "2026-08-30T00:00:00.000Z" } as never,
        subgraph: { nodes: [], edges: [], seeds: ["n1"] },
        context: { markdown: "raw evidence body", sources: [] },
      })
      vi.spyOn(synthesizeForDraftModule, "synthesizeForDraft").mockResolvedValue({
        status: "failed",
        message: "answer cites a source outside the retrieved evidence",
      })

      const { result } = renderHook(
        () => useQuestionGraphDraft("repo-1", "how does auth work?", "org-1", "ctx-1"),
        { wrapper }
      )
      await waitFor(() => expect(result.current.canDraft).toBe(true))

      act(() => result.current.run())

      await waitFor(() =>
        expect(result.current.synthesisFailureMessage).toBe(
          "answer cites a source outside the retrieved evidence"
        )
      )
    })

    it("clears a stale failure message once a fresh regenerate lands a new result", async () => {
      connectAsConnected()
      vi.spyOn(providerKeyStorage, "getActiveProviderKey").mockReturnValue(ANTHROPIC_PROVIDER)
      vi.spyOn(expandForDraftModule, "expandForDraft").mockResolvedValue({
        status: "success",
        terms: ["auth"],
      })
      vi.spyOn(client, "query")
        .mockResolvedValueOnce({
          graph: { graphHash: "hash-a", builtAt: "2026-08-30T00:00:00.000Z" } as never,
          subgraph: { nodes: [], edges: [], seeds: ["n1"] },
          context: { markdown: "raw evidence body", sources: [] },
        })
        .mockResolvedValueOnce({
          graph: { graphHash: "hash-a", builtAt: "2026-08-30T00:01:00.000Z" } as never,
          subgraph: { nodes: [], edges: [], seeds: ["n1"] },
          context: { markdown: "fresh evidence body", sources: [] },
        })
      const synthesizeSpy = vi.spyOn(synthesizeForDraftModule, "synthesizeForDraft")
      synthesizeSpy.mockResolvedValueOnce({ status: "failed", message: "provider timed out" })

      const { result } = renderHook(
        () => useQuestionGraphDraft("repo-1", "how does auth work?", "org-1", "ctx-1"),
        { wrapper }
      )
      await waitFor(() => expect(result.current.canDraft).toBe(true))

      act(() => result.current.run())
      await waitFor(() => expect(result.current.synthesisFailureMessage).toBe("provider timed out"))

      synthesizeSpy.mockResolvedValueOnce({ status: "success", prose: "cited answer." })
      act(() => result.current.run())
      await waitFor(() => expect(result.current.draftText).toBe("cited answer."))
      expect(result.current.synthesisFailureMessage).toBeUndefined()
    })

    it("exposes isSynthesizing while the call is in flight and clears it once it settles (TBR-110)", async () => {
      connectAsConnected()
      vi.spyOn(providerKeyStorage, "getActiveProviderKey").mockReturnValue(ANTHROPIC_PROVIDER)
      vi.spyOn(expandForDraftModule, "expandForDraft").mockResolvedValue({
        status: "success",
        terms: ["auth"],
      })
      vi.spyOn(client, "query").mockResolvedValue({
        graph: {} as never,
        subgraph: { nodes: [], edges: [], seeds: ["n1"] },
        context: { markdown: "raw evidence body", sources: [] },
      })

      let resolveSynthesis!: (outcome: DraftSynthesisOutcome) => void
      const synthesisPromise = new Promise<DraftSynthesisOutcome>((resolve) => {
        resolveSynthesis = resolve
      })
      vi.spyOn(synthesizeForDraftModule, "synthesizeForDraft").mockReturnValue(synthesisPromise)

      const { result } = renderHook(
        () => useQuestionGraphDraft("repo-1", "how does auth work?", "org-1", "ctx-1"),
        { wrapper }
      )
      await waitFor(() => expect(result.current.canDraft).toBe(true))

      expect(result.current.isSynthesizing).toBe(false)
      act(() => result.current.run())

      // The companion result has already landed (draftText seeded with raw evidence), but
      // synthesis is still in flight — this is exactly the window QuestionGraphPanel's old
      // `isPending && !result` gate could never see, since `result` is truthy by this point.
      await waitFor(() => expect(result.current.draftText).toBe("raw evidence body"))
      expect(result.current.isSynthesizing).toBe(true)

      await act(async () => {
        resolveSynthesis({ status: "success", prose: "Cited prose." })
        await Promise.resolve()
      })

      expect(result.current.isSynthesizing).toBe(false)
    })

    it("fires synthesis even when the preceding expansion call itself failed", async () => {
      connectAsConnected()
      vi.spyOn(providerKeyStorage, "getActiveProviderKey").mockReturnValue(ANTHROPIC_PROVIDER)
      vi.spyOn(expandForDraftModule, "expandForDraft").mockResolvedValue({
        status: "failed",
        message: "expansion provider error",
      })
      vi.spyOn(client, "query").mockResolvedValue({
        graph: {} as never,
        subgraph: { nodes: [], edges: [], seeds: ["n1"] },
        context: { markdown: "raw evidence body", sources: [] },
        degraded: { expansion: "none" },
      })
      const synthesizeSpy = vi
        .spyOn(synthesizeForDraftModule, "synthesizeForDraft")
        .mockResolvedValue({ status: "success", prose: "Synthesized anyway." })

      const { result } = renderHook(
        () => useQuestionGraphDraft("repo-1", "how does auth work?", "org-1", "ctx-1"),
        { wrapper }
      )
      await waitFor(() => expect(result.current.canDraft).toBe(true))

      act(() => result.current.run())

      await waitFor(() => expect(result.current.expansionBanner).toBe("expansionFailed"))
      await waitFor(() => expect(result.current.draftText).toBe("Synthesized anyway."))
      expect(synthesizeSpy).toHaveBeenCalledTimes(1)
    })

    it("never attempts synthesis on a lowConfidence result — nothing sensible to synthesize", async () => {
      connectAsConnected()
      vi.spyOn(providerKeyStorage, "getActiveProviderKey").mockReturnValue(ANTHROPIC_PROVIDER)
      vi.spyOn(expandForDraftModule, "expandForDraft").mockResolvedValue({
        status: "success",
        terms: ["auth"],
      })
      vi.spyOn(client, "query").mockResolvedValue({
        graph: {} as never,
        subgraph: { nodes: [], edges: [], seeds: [] },
        context: { markdown: "", sources: [] },
        lowConfidence: { topScore: 0 },
      })
      const synthesizeSpy = vi.spyOn(synthesizeForDraftModule, "synthesizeForDraft")

      const { result } = renderHook(
        () => useQuestionGraphDraft("repo-1", "how does auth work?", "org-1", "ctx-1"),
        { wrapper }
      )
      await waitFor(() => expect(result.current.canDraft).toBe(true))

      act(() => result.current.run())

      await waitFor(() => expect(result.current.result).toBeTruthy())
      expect(synthesizeSpy).not.toHaveBeenCalled()
      expect(result.current.synthesisBanner).toBeUndefined()
    })

    it("ignores a superseded synthesis attempt — a stale outcome must not override a newer retrieval's draftText or banner", async () => {
      connectAsConnected()
      vi.spyOn(providerKeyStorage, "getActiveProviderKey").mockReturnValue(ANTHROPIC_PROVIDER)
      vi.spyOn(expandForDraftModule, "expandForDraft").mockResolvedValue({
        status: "success",
        terms: ["auth"],
      })
      vi.spyOn(client, "query")
        .mockResolvedValueOnce({
          graph: {} as never,
          subgraph: { nodes: [], edges: [], seeds: ["n1"] },
          context: { markdown: "first evidence", sources: [] },
        })
        .mockResolvedValueOnce({
          graph: {} as never,
          subgraph: { nodes: [], edges: [], seeds: ["n1"] },
          context: { markdown: "second evidence", sources: [] },
        })

      let resolveStale!: (outcome: DraftSynthesisOutcome) => void
      const stalePromise = new Promise<DraftSynthesisOutcome>((resolve) => {
        resolveStale = resolve
      })
      vi.spyOn(synthesizeForDraftModule, "synthesizeForDraft")
        .mockReturnValueOnce(stalePromise)
        .mockResolvedValueOnce({ status: "success", prose: "second prose" })

      const { result } = renderHook(
        () => useQuestionGraphDraft("repo-1", "how does auth work?", "org-1", "ctx-1"),
        { wrapper }
      )
      await waitFor(() => expect(result.current.canDraft).toBe(true))

      act(() => result.current.run())
      await waitFor(() => expect(result.current.draftText).toBe("first evidence"))

      act(() => result.current.expand())
      await waitFor(() => expect(result.current.draftText).toBe("second prose"))

      // The stale first synthesis call finally settles after the newer one already won.
      await act(async () => {
        resolveStale({ status: "success", prose: "stale prose — must not apply" })
        await Promise.resolve()
      })

      expect(result.current.draftText).toBe("second prose")
      expect(result.current.synthesisBanner).toBeUndefined()
    })

    it("drops a synthesis result that resolves after the user has already edited the seeded draft (TBR-105)", async () => {
      connectAsConnected()
      vi.spyOn(providerKeyStorage, "getActiveProviderKey").mockReturnValue(ANTHROPIC_PROVIDER)
      vi.spyOn(expandForDraftModule, "expandForDraft").mockResolvedValue({
        status: "success",
        terms: ["auth"],
      })
      vi.spyOn(client, "query").mockResolvedValue({
        graph: {} as never,
        subgraph: { nodes: [], edges: [], seeds: ["n1"] },
        context: { markdown: "raw evidence body", sources: [] },
      })

      let resolveSynthesis!: (outcome: DraftSynthesisOutcome) => void
      const synthesisPromise = new Promise<DraftSynthesisOutcome>((resolve) => {
        resolveSynthesis = resolve
      })
      vi.spyOn(synthesizeForDraftModule, "synthesizeForDraft").mockReturnValue(synthesisPromise)

      const { result } = renderHook(
        () => useQuestionGraphDraft("repo-1", "how does auth work?", "org-1", "ctx-1"),
        { wrapper }
      )
      await waitFor(() => expect(result.current.canDraft).toBe(true))

      // Draft still seeds with raw evidence immediately, while synthesis is in flight.
      act(() => result.current.run())
      await waitFor(() => expect(result.current.draftText).toBe("raw evidence body"))

      // The user starts editing before synthesis resolves.
      act(() => result.current.setDraftText("the user's own edit"))

      // Synthesis now resolves — its result must be dropped, not overwrite the user's edit.
      await act(async () => {
        resolveSynthesis({ status: "success", prose: "synthesized prose — must not apply" })
        await Promise.resolve()
      })

      expect(result.current.draftText).toBe("the user's own edit")
    })

    it("drops a synthesis failure banner too, once the user has edited away from the raw evidence it would describe (TBR-105)", async () => {
      connectAsConnected()
      vi.spyOn(providerKeyStorage, "getActiveProviderKey").mockReturnValue(ANTHROPIC_PROVIDER)
      vi.spyOn(expandForDraftModule, "expandForDraft").mockResolvedValue({
        status: "success",
        terms: ["auth"],
      })
      vi.spyOn(client, "query").mockResolvedValue({
        graph: {} as never,
        subgraph: { nodes: [], edges: [], seeds: ["n1"] },
        context: { markdown: "raw evidence body", sources: [] },
      })

      let resolveSynthesis!: (outcome: DraftSynthesisOutcome) => void
      const synthesisPromise = new Promise<DraftSynthesisOutcome>((resolve) => {
        resolveSynthesis = resolve
      })
      vi.spyOn(synthesizeForDraftModule, "synthesizeForDraft").mockReturnValue(synthesisPromise)

      const { result } = renderHook(
        () => useQuestionGraphDraft("repo-1", "how does auth work?", "org-1", "ctx-1"),
        { wrapper }
      )
      await waitFor(() => expect(result.current.canDraft).toBe(true))

      act(() => result.current.run())
      await waitFor(() => expect(result.current.draftText).toBe("raw evidence body"))

      act(() => result.current.setDraftText("the user's own edit"))

      await act(async () => {
        resolveSynthesis({ status: "failed", message: "provider timed out" })
        await Promise.resolve()
      })

      // draftText is the user's own prose now, not raw evidence — the "showing raw evidence,
      // synthesis failed" banner would be a lie if shown here.
      expect(result.current.draftText).toBe("the user's own edit")
      expect(result.current.synthesisBanner).toBeUndefined()
    })

    it("invalidates an earlier in-flight synthesis attempt even when the newer result doesn't itself start a new one", async () => {
      connectAsConnected()
      // First run has a Provider key (synthesis starts, left unresolved); the key is then
      // "removed" before the second run, so its own result never starts a new synthesis call.
      vi.spyOn(providerKeyStorage, "getActiveProviderKey")
        .mockReturnValueOnce(ANTHROPIC_PROVIDER) // runQuery's own expansion-routing check
        .mockReturnValueOnce(ANTHROPIC_PROVIDER) // the mutation.data effect's synthesis check
        .mockReturnValue(null) // every call from the second run() onward
      vi.spyOn(expandForDraftModule, "expandForDraft").mockResolvedValue({
        status: "success",
        terms: ["auth"],
      })
      vi.spyOn(client, "query")
        .mockResolvedValueOnce({
          graph: {} as never,
          subgraph: { nodes: [], edges: [], seeds: ["n1"] },
          context: { markdown: "first evidence", sources: [] },
        })
        .mockResolvedValueOnce({
          graph: {} as never,
          subgraph: { nodes: [], edges: [], seeds: ["n1"] },
          context: { markdown: "second evidence", sources: [] },
        })

      let resolveStale!: (outcome: DraftSynthesisOutcome) => void
      const stalePromise = new Promise<DraftSynthesisOutcome>((resolve) => {
        resolveStale = resolve
      })
      vi.spyOn(synthesizeForDraftModule, "synthesizeForDraft").mockReturnValueOnce(stalePromise)

      const { result } = renderHook(
        () => useQuestionGraphDraft("repo-1", "how does auth work?", "org-1", "ctx-1"),
        { wrapper }
      )
      await waitFor(() => expect(result.current.canDraft).toBe(true))

      act(() => result.current.run())
      await waitFor(() => expect(result.current.draftText).toBe("first evidence"))

      // No Provider key this time — the second result never starts its own synthesis attempt.
      act(() => result.current.expand())
      await waitFor(() => expect(result.current.draftText).toBe("second evidence"))
      // The second result is ineligible for synthesis (no provider) — isSynthesizing must clear
      // immediately, not stay stuck true from the first (now-superseded) call that never got its
      // own .finally() to run, since that call's version check bails out (TBR-110 regression).
      expect(result.current.isSynthesizing).toBe(false)

      // The first run's synthesis call finally settles — it must not clobber the second,
      // unrelated result's draftText just because nothing newer replaced it.
      await act(async () => {
        resolveStale({ status: "success", prose: "stale prose — must not apply" })
        await Promise.resolve()
      })

      expect(result.current.draftText).toBe("second evidence")
      expect(result.current.synthesisBanner).toBeUndefined()
    })

    it("pairs a landed query result with the question it was issued for, not the hook's possibly-since-changed `question` prop", async () => {
      connectAsConnected()
      vi.spyOn(providerKeyStorage, "getActiveProviderKey").mockReturnValue(ANTHROPIC_PROVIDER)
      vi.spyOn(expandForDraftModule, "expandForDraft").mockResolvedValue({
        status: "success",
        terms: ["auth"],
      })

      let resolveQuery!: (data: {
        graph: never
        subgraph: { nodes: Array<never>; edges: Array<never>; seeds: Array<string> }
        context: { markdown: string; sources: Array<never> }
      }) => void
      const queryPromise = new Promise<Parameters<typeof resolveQuery>[0]>((resolve) => {
        resolveQuery = resolve
      })
      vi.spyOn(client, "query").mockReturnValueOnce(queryPromise as never)

      const synthesizeSpy = vi
        .spyOn(synthesizeForDraftModule, "synthesizeForDraft")
        .mockResolvedValue({ status: "success", prose: "synthesized" })

      const { result, rerender } = renderHook(
        ({ question }) => useQuestionGraphDraft("repo-1", question, "org-1", "ctx-1"),
        { wrapper, initialProps: { question: "first question?" } }
      )
      await waitFor(() => expect(result.current.canDraft).toBe(true))

      // Issues the companion query for "first question?" and leaves it in flight.
      act(() => result.current.run())

      // The surface navigates to a different Question while that request is still pending —
      // same hook instance, new `question` prop.
      rerender({ question: "second question?" })

      await act(async () => {
        resolveQuery({
          graph: {} as never,
          subgraph: { nodes: [], edges: [], seeds: ["n1"] },
          context: { markdown: "first-question evidence", sources: [] },
        })
        await Promise.resolve()
      })

      // Synthesis must be paired with "first question?" — the question that produced this
      // evidence — never with "second question?", which is only the hook's current prop value.
      await waitFor(() => expect(synthesizeSpy).toHaveBeenCalled())
      expect(synthesizeSpy).toHaveBeenCalledWith(
        "first question?",
        { markdown: "first-question evidence", sources: [] },
        ANTHROPIC_PROVIDER
      )
    })
  })
})
