// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { renderHook, waitFor } from "@testing-library/react"

import { useQuestionGraphDraft } from "./questionGraphDraft"
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

describe("useQuestionGraphDraft", () => {
  it("cannot draft when not connected, and issues no query", async () => {
    vi.spyOn(connectionState, "resolveConnectionState").mockResolvedValue({
      state: "unpaired",
    })
    const querySpy = vi.spyOn(client, "query")

    const { result } = renderHook(
      () => useQuestionGraphDraft("repo-1", "how does auth work?"),
      { wrapper }
    )

    await waitFor(() => expect(result.current.connectionState).toBe("unpaired"))
    expect(result.current.canDraft).toBe(false)

    result.current.run()
    expect(querySpy).not.toHaveBeenCalled()
  })

  it("runs the default-bounds query on `run`, defaulting to the Files variant", async () => {
    vi.spyOn(connectionState, "resolveConnectionState").mockResolvedValue({
      state: "connected",
      pairing: PAIRING,
      status: STATUS,
    })
    const querySpy = vi.spyOn(client, "query").mockResolvedValue({
      graph: {} as never,
      subgraph: { nodes: [], edges: [], seeds: [] },
    })

    const { result } = renderHook(
      () => useQuestionGraphDraft("repo-1", "how does auth work?"),
      { wrapper }
    )

    await waitFor(() => expect(result.current.canDraft).toBe(true))

    result.current.run()

    await waitFor(() => expect(result.current.result).toBeTruthy())
    expect(querySpy).toHaveBeenCalledWith(PAIRING.baseUrl, PAIRING.token, {
      question: "how does auth work?",
      include: ["subgraph", "context"],
    })
    expect(result.current.variant).toBe("files")
  })

  it("sends depth: 2 on `expand`, and nothing else beyond the default request", async () => {
    vi.spyOn(connectionState, "resolveConnectionState").mockResolvedValue({
      state: "connected",
      pairing: PAIRING,
      status: STATUS,
    })
    const querySpy = vi.spyOn(client, "query").mockResolvedValue({
      graph: {} as never,
      subgraph: { nodes: [], edges: [], seeds: [] },
    })

    const { result } = renderHook(
      () => useQuestionGraphDraft("repo-1", "how does auth work?"),
      { wrapper }
    )

    await waitFor(() => expect(result.current.canDraft).toBe(true))

    result.current.expand()

    await waitFor(() =>
      expect(querySpy).toHaveBeenCalledWith(PAIRING.baseUrl, PAIRING.token, {
        question: "how does auth work?",
        include: ["subgraph", "context"],
        depth: 2,
      })
    )
  })
})
