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
      expect(result.current.explainingNodeId).toBe("n1")

      await act(async () => {
        resolveSynth?.({ status: "success", prose: "authenticate calls logout." })
        await Promise.resolve()
      })
      await waitFor(() => expect(result.current.explainingNodeId).toBeNull())
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

    it("marks the node as failed when synthesis itself fails, and clears any prior unsaved flag on retry", async () => {
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
      await waitFor(() => expect(result.current.failedNodeId).toBe("n1"))
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

      await waitFor(() => expect(result.current.unsavedNodeId).toBe("n1"))
      expect(result.current.explanations.get("n1")).toBe("authenticate calls logout.")
    })
  })
})
