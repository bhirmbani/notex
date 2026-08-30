// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, cleanup, renderHook, waitFor } from "@testing-library/react"

import { useGraphNodeExplanations } from "./graphNodeExplanations"
import type { ReactNode } from "react"
import type { NodeExplanationDTO } from "./persistenceTypes"
import type { ProviderConfig } from "@/features/provider-keys/types"
import type { NodeExplanationContext } from "@/features/draft-synthesis/synthesizeNodeExplanation"
import * as providerKeyStorage from "@/features/provider-keys/storage"
import * as synthesizeNodeExplanationModule from "@/features/draft-synthesis/synthesizeNodeExplanation"

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as Response
}

/**
 * A minimal in-memory stand-in for the `graph-generations/:graphHash/node-explanations`
 * endpoints (TBR-117), mirroring questionGraphDraft.test.tsx's `installBackend` shape.
 */
function installBackend() {
  let rows: Array<NodeExplanationDTO> = []
  let nextPutFails = false

  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const method = init?.method ?? "GET"

    if (url.endsWith("/node-explanations") && method === "GET") {
      return jsonResponse(rows)
    }
    const putMatch = url.match(/\/node-explanations\/([^/]+)$/)
    if (putMatch && method === "PUT") {
      if (nextPutFails) {
        nextPutFails = false
        return jsonResponse({ error: { code: "INTERNAL" } }, 500)
      }
      const nodeId = decodeURIComponent(putMatch[1] ?? "")
      const { explanation } = JSON.parse(String(init?.body)) as { explanation: string }
      const now = Date.now()
      const row: NodeExplanationDTO = { nodeId, explanation, createdAt: now, updatedAt: now }
      rows = [...rows.filter((r) => r.nodeId !== nodeId), row]
      return jsonResponse(row)
    }

    throw new Error(`Unhandled fetch in test: ${method} ${url}`)
  })
  vi.spyOn(global, "fetch").mockImplementation(fetchMock as unknown as typeof fetch)

  return {
    fetchMock,
    seed(seeded: Array<NodeExplanationDTO>) {
      rows = seeded
    },
    failNextPut() {
      nextPutFails = true
    },
  }
}

let backend: ReturnType<typeof installBackend>

beforeEach(() => {
  backend = installBackend()
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
}

const PROVIDER: ProviderConfig = {
  id: "p1",
  adapter: "anthropic",
  apiKey: "sk-ant-test",
  model: "claude-haiku-test",
}

const CONTEXT: NodeExplanationContext = {
  label: "authenticate",
  file: "api/middleware/auth.ts",
  location: "L18",
  fileType: "code",
  community: "Auth",
  degree: 1,
  neighbours: [],
}

describe("useGraphNodeExplanations", () => {
  it("returns an empty map and never fetches when graphHash is undefined", () => {
    const { result } = renderHook(
      () => useGraphNodeExplanations("org1", "ctx1", undefined),
      { wrapper }
    )
    expect(result.current.explanations.size).toBe(0)
    expect(backend.fetchMock).not.toHaveBeenCalled()
  })

  it("populates the map from the list response, keyed by nodeId", async () => {
    backend.seed([
      { nodeId: "n1", explanation: "explains n1", createdAt: 1, updatedAt: 1 },
      { nodeId: "n2", explanation: "explains n2", createdAt: 1, updatedAt: 1 },
    ])
    const { result } = renderHook(
      () => useGraphNodeExplanations("org1", "ctx1", "hash-a"),
      { wrapper }
    )
    await waitFor(() => expect(result.current.explanations.get("n1")).toBe("explains n1"))
    expect(result.current.explanations.get("n2")).toBe("explains n2")
  })

  it("refetches a fresh (initially empty) map when graphHash changes", async () => {
    backend.seed([{ nodeId: "n1", explanation: "v1 explanation", createdAt: 1, updatedAt: 1 }])
    const { result, rerender } = renderHook(
      ({ graphHash }: { graphHash: string }) =>
        useGraphNodeExplanations("org1", "ctx1", graphHash),
      { wrapper, initialProps: { graphHash: "hash-a" } }
    )
    await waitFor(() => expect(result.current.explanations.get("n1")).toBe("v1 explanation"))

    backend.seed([])
    rerender({ graphHash: "hash-b" })
    await waitFor(() => expect(result.current.explanations.size).toBe(0))
  })

  describe("explainNode", () => {
    it("does nothing when no Provider key is configured", () => {
      vi.spyOn(providerKeyStorage, "getActiveProviderKey").mockReturnValue(null)
      const explainSpy = vi.spyOn(synthesizeNodeExplanationModule, "synthesizeNodeExplanation")
      const { result } = renderHook(
        () => useGraphNodeExplanations("org1", "ctx1", "hash-a"),
        { wrapper }
      )
      act(() => result.current.explainNode("n1", CONTEXT))
      expect(explainSpy).not.toHaveBeenCalled()
    })

    it("shows the node as explaining while synthesis is in flight, then clears it", async () => {
      vi.spyOn(providerKeyStorage, "getActiveProviderKey").mockReturnValue(PROVIDER)
      let resolveSynth: ((o: { status: "success"; prose: string }) => void) | undefined
      vi.spyOn(synthesizeNodeExplanationModule, "synthesizeNodeExplanation").mockReturnValue(
        new Promise((resolve) => {
          resolveSynth = resolve
        })
      )
      const { result } = renderHook(
        () => useGraphNodeExplanations("org1", "ctx1", "hash-a"),
        { wrapper }
      )

      act(() => result.current.explainNode("n1", CONTEXT))
      expect(result.current.explainingNodeIds.has("n1")).toBe(true)

      await act(async () => {
        resolveSynth?.({ status: "success", prose: "authenticate calls logout." })
        await Promise.resolve()
      })
      await waitFor(() => expect(result.current.explainingNodeIds.has("n1")).toBe(false))
    })

    it("on synthesis success, writes the explanation and updates the map without waiting for a refetch", async () => {
      vi.spyOn(providerKeyStorage, "getActiveProviderKey").mockReturnValue(PROVIDER)
      vi.spyOn(synthesizeNodeExplanationModule, "synthesizeNodeExplanation").mockResolvedValue({
        status: "success",
        prose: "authenticate calls logout.",
      })
      const { result } = renderHook(
        () => useGraphNodeExplanations("org1", "ctx1", "hash-a"),
        { wrapper }
      )
      // Let the mount's own (empty) GET settle first, so it can't race the optimistic write
      // below and clobber it with a stale, already-superseded cache snapshot.
      await waitFor(() => expect(backend.fetchMock).toHaveBeenCalledTimes(1))

      await act(async () => {
        result.current.explainNode("n1", CONTEXT)
        await Promise.resolve()
        await Promise.resolve()
      })

      await waitFor(() =>
        expect(result.current.explanations.get("n1")).toBe("authenticate calls logout.")
      )
      expect(backend.fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/node-explanations/n1"),
        expect.objectContaining({ method: "PUT" })
      )
    })

    it("regenerating one node's explanation never touches another node's cached row", async () => {
      backend.seed([{ nodeId: "n2", explanation: "n2 explanation", createdAt: 1, updatedAt: 1 }])
      vi.spyOn(providerKeyStorage, "getActiveProviderKey").mockReturnValue(PROVIDER)
      vi.spyOn(synthesizeNodeExplanationModule, "synthesizeNodeExplanation").mockResolvedValue({
        status: "success",
        prose: "n1 explanation",
      })
      const { result } = renderHook(
        () => useGraphNodeExplanations("org1", "ctx1", "hash-a"),
        { wrapper }
      )
      await waitFor(() => expect(result.current.explanations.get("n2")).toBe("n2 explanation"))

      await act(async () => {
        result.current.explainNode("n1", CONTEXT)
        await Promise.resolve()
        await Promise.resolve()
      })

      await waitFor(() => expect(result.current.explanations.get("n1")).toBe("n1 explanation"))
      expect(result.current.explanations.get("n2")).toBe("n2 explanation")
    })

    it("marks the node as failed when synthesis itself fails", async () => {
      vi.spyOn(providerKeyStorage, "getActiveProviderKey").mockReturnValue(PROVIDER)
      vi.spyOn(synthesizeNodeExplanationModule, "synthesizeNodeExplanation").mockResolvedValue({
        status: "failed",
        message: "provider responded 500",
      })
      const { result } = renderHook(
        () => useGraphNodeExplanations("org1", "ctx1", "hash-a"),
        { wrapper }
      )
      await waitFor(() => expect(backend.fetchMock).toHaveBeenCalledTimes(1))

      await act(async () => {
        result.current.explainNode("n1", CONTEXT)
        await Promise.resolve()
      })
      await waitFor(() => expect(result.current.failedNodeIds.has("n1")).toBe(true))
      expect(result.current.explanations.get("n1")).toBeUndefined()
    })

    it("keeps the synthesized prose visible and flags it unsaved when the persistence write fails", async () => {
      vi.spyOn(providerKeyStorage, "getActiveProviderKey").mockReturnValue(PROVIDER)
      vi.spyOn(synthesizeNodeExplanationModule, "synthesizeNodeExplanation").mockResolvedValue({
        status: "success",
        prose: "authenticate calls logout.",
      })
      backend.failNextPut()
      const { result } = renderHook(
        () => useGraphNodeExplanations("org1", "ctx1", "hash-a"),
        { wrapper }
      )
      await waitFor(() => expect(backend.fetchMock).toHaveBeenCalledTimes(1))

      await act(async () => {
        result.current.explainNode("n1", CONTEXT)
        await Promise.resolve()
        await Promise.resolve()
        await Promise.resolve()
      })

      await waitFor(() => expect(result.current.unsavedNodeIds.has("n1")).toBe(true))
      expect(result.current.explanations.get("n1")).toBe("authenticate calls logout.")
    })

    it("a retry that fails at synthesis never clobbers a prior 'unsaved' flag for that node's still-displayed prose", async () => {
      vi.spyOn(providerKeyStorage, "getActiveProviderKey").mockReturnValue(PROVIDER)
      const synthSpy = vi.spyOn(
        synthesizeNodeExplanationModule,
        "synthesizeNodeExplanation"
      )
      backend.failNextPut()
      synthSpy.mockResolvedValueOnce({ status: "success", prose: "first attempt prose." })
      const { result } = renderHook(
        () => useGraphNodeExplanations("org1", "ctx1", "hash-a"),
        { wrapper }
      )
      await waitFor(() => expect(backend.fetchMock).toHaveBeenCalledTimes(1))

      await act(async () => {
        result.current.explainNode("n1", CONTEXT)
        await Promise.resolve()
        await Promise.resolve()
        await Promise.resolve()
      })
      await waitFor(() => expect(result.current.unsavedNodeIds.has("n1")).toBe(true))

      synthSpy.mockResolvedValueOnce({ status: "failed", message: "provider responded 500" })
      await act(async () => {
        result.current.explainNode("n1", CONTEXT)
        await Promise.resolve()
      })

      await waitFor(() => expect(result.current.failedNodeIds.has("n1")).toBe(true))
      // The retry never produced new prose, so the old (still-unpersisted) prose and its
      // "unsaved" flag must both still describe what's on screen.
      expect(result.current.unsavedNodeIds.has("n1")).toBe(true)
      expect(result.current.explanations.get("n1")).toBe("first attempt prose.")
    })

    it("explaining two different nodes concurrently tracks each one's in-flight/failed state independently", async () => {
      vi.spyOn(providerKeyStorage, "getActiveProviderKey").mockReturnValue(PROVIDER)
      let resolveN1: ((o: { status: "failed"; message: string }) => void) | undefined
      let resolveN2: ((o: { status: "success"; prose: string }) => void) | undefined
      vi.spyOn(synthesizeNodeExplanationModule, "synthesizeNodeExplanation").mockImplementation(
        (context) =>
          new Promise((resolve) => {
            if (context.label === "authenticate") resolveN1 = resolve as never
            else resolveN2 = resolve as never
          })
      )
      const { result } = renderHook(
        () => useGraphNodeExplanations("org1", "ctx1", "hash-a"),
        { wrapper }
      )
      await waitFor(() => expect(backend.fetchMock).toHaveBeenCalledTimes(1))

      act(() => {
        result.current.explainNode("n1", CONTEXT)
        result.current.explainNode("n2", { ...CONTEXT, label: "logout" })
      })
      expect(result.current.explainingNodeIds.has("n1")).toBe(true)
      expect(result.current.explainingNodeIds.has("n2")).toBe(true)

      await act(async () => {
        resolveN1?.({ status: "failed", message: "boom" })
        await Promise.resolve()
      })
      // n1 failing must not clear n2's still-in-flight state, and must not mark n2 as failed.
      expect(result.current.failedNodeIds.has("n1")).toBe(true)
      expect(result.current.failedNodeIds.has("n2")).toBe(false)
      expect(result.current.explainingNodeIds.has("n2")).toBe(true)

      await act(async () => {
        resolveN2?.({ status: "success", prose: "logout ends the session." })
        await Promise.resolve()
        await Promise.resolve()
        await Promise.resolve()
      })
      await waitFor(() =>
        expect(result.current.explanations.get("n2")).toBe("logout ends the session.")
      )
      // n1's failure must still be visible — n2 resolving doesn't touch it.
      expect(result.current.failedNodeIds.has("n1")).toBe(true)
    })

    it("clears every in-flight/failed/unsaved flag when the graphHash (version switch) changes", async () => {
      vi.spyOn(providerKeyStorage, "getActiveProviderKey").mockReturnValue(PROVIDER)
      vi.spyOn(synthesizeNodeExplanationModule, "synthesizeNodeExplanation").mockResolvedValue({
        status: "failed",
        message: "boom",
      })
      const { result, rerender } = renderHook(
        ({ graphHash }: { graphHash: string }) =>
          useGraphNodeExplanations("org1", "ctx1", graphHash),
        { wrapper, initialProps: { graphHash: "hash-a" } }
      )
      await waitFor(() => expect(backend.fetchMock).toHaveBeenCalledTimes(1))

      await act(async () => {
        result.current.explainNode("n1", CONTEXT)
        await Promise.resolve()
      })
      await waitFor(() => expect(result.current.failedNodeIds.has("n1")).toBe(true))

      rerender({ graphHash: "hash-b" })
      expect(result.current.failedNodeIds.has("n1")).toBe(false)
    })
  })
})
