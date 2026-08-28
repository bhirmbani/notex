// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, renderHook, waitFor } from "@testing-library/react"

import { DEFAULT_DRAFT_NAME, useQuestionGraphDraft } from "./questionGraphDraft"
import * as connectionState from "./connectionState"
import * as client from "./client"
import type { ReactNode } from "react"

afterEach(() => {
  vi.restoreAllMocks()
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
    const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ id: "f1" }),
    } as Response)

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

    expect(fetchSpy).toHaveBeenCalledWith(
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

    let resolveFetch!: (value: Response) => void
    const fetchPromise = new Promise<Response>((resolve) => {
      resolveFetch = resolve
    })
    vi.spyOn(global, "fetch").mockReturnValue(fetchPromise)

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
      resolveFetch({ ok: true, json: () => Promise.resolve({ id: "f1" }) } as Response)
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
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ id: "f1" }),
    } as Response)

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
})
