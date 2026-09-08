// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { renderHook, waitFor } from "@testing-library/react"

import {
  useBootstrapPairing,
  useCompanionBrowse,
  useCompanionConnection,
  useCompanionInstances,
  useCompanionPath,
  useCompanionQuery,
  useCompanionSearch,
  useCompanionSuggestedQuestions,
  useDebouncedCompanionSearch,
} from "./hooks"
import * as bootstrapPairing from "./bootstrapPairing"
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

describe("useCompanionConnection", () => {
  it("resolves the connection state once and does not poll or auto-retry", async () => {
    const resolveSpy = vi
      .spyOn(connectionState, "resolveConnectionState")
      .mockResolvedValue({ state: "unpaired" })

    const { result } = renderHook(() => useCompanionConnection("repo-1"), {
      wrapper,
    })

    await waitFor(() =>
      expect(result.current.data).toEqual({ state: "unpaired" })
    )
    expect(resolveSpy).toHaveBeenCalledTimes(1)
    expect(resolveSpy).toHaveBeenCalledWith("repo-1", undefined)
  })

  it("exposes a manual retry that re-invokes resolution", async () => {
    const resolveSpy = vi
      .spyOn(connectionState, "resolveConnectionState")
      .mockResolvedValueOnce({ state: "unreachable" })
      .mockResolvedValueOnce({
        state: "connected",
        pairing: { baseUrl: "x", token: "y", checkoutId: "z" },
        status: {} as never,
      })

    const { result } = renderHook(() => useCompanionConnection("repo-1"), {
      wrapper,
    })

    await waitFor(() =>
      expect(result.current.data).toEqual({ state: "unreachable" })
    )
    expect(resolveSpy).toHaveBeenCalledTimes(1)

    await result.current.retry()

    await waitFor(() => expect(result.current.data?.state).toBe("connected"))
    expect(resolveSpy).toHaveBeenCalledTimes(2)
  })

  // TBR-149: without this, `useBootstrapPairing`'s `enabled` flag stays `true` across a Retry
  // click (no false→true edge to trigger a refetch), so a bootstrap candidate that only became
  // live *after* the first failed attempt would never be discovered until an unrelated remount.
  it("retry also invalidates the bootstrap-pairing and instances queries, not just its own", async () => {
    vi.spyOn(connectionState, "resolveConnectionState").mockResolvedValue({ state: "unreachable" })
    const bootstrapSpy = vi
      .spyOn(bootstrapPairing, "resolveBootstrapPairing")
      .mockResolvedValue({ pairing: PAIRING, instances: [] })

    const { result } = renderHook(
      () => ({
        connection: useCompanionConnection("repo-1"),
        bootstrap: useBootstrapPairing("repo-1", PAIRING, { alsoTryWhenUnreachable: true }),
      }),
      { wrapper }
    )

    await waitFor(() => expect(bootstrapSpy).toHaveBeenCalledTimes(1))

    await result.current.connection.retry()

    await waitFor(() => expect(bootstrapSpy).toHaveBeenCalledTimes(2))
  })
})

const PAIRING = {
  baseUrl: "http://127.0.0.1:7717",
  token: "tok",
  checkoutId: "c1",
}

describe("useCompanionSearch", () => {
  it("calls the search op with the pairing's baseUrl/token, on demand", async () => {
    const searchSpy = vi
      .spyOn(client, "search")
      .mockResolvedValue({ graph: {} as never, results: [] })

    const { result } = renderHook(() => useCompanionSearch(PAIRING), {
      wrapper,
    })
    await result.current.mutateAsync("auth")

    expect(searchSpy).toHaveBeenCalledWith(PAIRING.baseUrl, PAIRING.token, {
      q: "auth",
    })
  })

  it("rejects without calling the client when there is no pairing", async () => {
    const searchSpy = vi.spyOn(client, "search")
    const { result } = renderHook(() => useCompanionSearch(null), { wrapper })

    await expect(result.current.mutateAsync("auth")).rejects.toThrow()
    expect(searchSpy).not.toHaveBeenCalled()
  })
})

describe("useCompanionPath", () => {
  it("calls the path op with the pairing's baseUrl/token, on demand", async () => {
    const pathSpy = vi.spyOn(client, "path").mockResolvedValue({
      graph: {} as never,
      found: true,
      nodes: [],
      edges: [],
    })

    const { result } = renderHook(() => useCompanionPath(PAIRING), { wrapper })
    await result.current.mutateAsync({ from: "a", to: "b" })

    expect(pathSpy).toHaveBeenCalledWith(PAIRING.baseUrl, PAIRING.token, {
      from: "a",
      to: "b",
    })
  })

  it("rejects without calling the client when there is no pairing", async () => {
    const pathSpy = vi.spyOn(client, "path")
    const { result } = renderHook(() => useCompanionPath(null), { wrapper })

    await expect(
      result.current.mutateAsync({ from: "a", to: "b" })
    ).rejects.toThrow()
    expect(pathSpy).not.toHaveBeenCalled()
  })
})

describe("useCompanionQuery", () => {
  it("calls the query op with the pairing's baseUrl/token, on demand", async () => {
    const querySpy = vi.spyOn(client, "query").mockResolvedValue({
      graph: {} as never,
      subgraph: { nodes: [], edges: [], seeds: [] },
    })

    const { result } = renderHook(() => useCompanionQuery(PAIRING), { wrapper })
    await result.current.mutateAsync({ question: "how does auth work?" })

    expect(querySpy).toHaveBeenCalledWith(PAIRING.baseUrl, PAIRING.token, {
      question: "how does auth work?",
    })
  })

  it("rejects without calling the client when there is no pairing", async () => {
    const querySpy = vi.spyOn(client, "query")
    const { result } = renderHook(() => useCompanionQuery(null), { wrapper })

    await expect(
      result.current.mutateAsync({ question: "x" })
    ).rejects.toThrow()
    expect(querySpy).not.toHaveBeenCalled()
  })
})

describe("useCompanionBrowse", () => {
  it("does not call the client when disabled", () => {
    const browseSpy = vi.spyOn(client, "browse")
    renderHook(() => useCompanionBrowse(PAIRING, false), { wrapper })

    expect(browseSpy).not.toHaveBeenCalled()
  })

  it("calls the browse op with the pairing's baseUrl/token once enabled", async () => {
    const browseSpy = vi
      .spyOn(client, "browse")
      .mockResolvedValue({ graph: {} as never, groups: [] })

    renderHook(() => useCompanionBrowse(PAIRING, true), { wrapper })

    await waitFor(() =>
      expect(browseSpy).toHaveBeenCalledWith(PAIRING.baseUrl, PAIRING.token, {})
    )
  })

  it("does not call the client when there is no pairing, even if enabled", () => {
    const browseSpy = vi.spyOn(client, "browse")
    renderHook(() => useCompanionBrowse(null, true), { wrapper })

    expect(browseSpy).not.toHaveBeenCalled()
  })
})

describe("useCompanionInstances", () => {
  it("does not call the client when there is no pairing", () => {
    const spy = vi.spyOn(client, "fetchInstances")
    renderHook(() => useCompanionInstances(null), { wrapper })

    expect(spy).not.toHaveBeenCalled()
  })

  it("calls fetchInstances with the pairing's baseUrl/token when a pairing is present", async () => {
    const spy = vi.spyOn(client, "fetchInstances").mockResolvedValue({ instances: [] })

    const { result } = renderHook(() => useCompanionInstances(PAIRING), { wrapper })

    await waitFor(() => expect(spy).toHaveBeenCalledWith(PAIRING.baseUrl, PAIRING.token))
    await waitFor(() => expect(result.current.data).toEqual({ instances: [] }))
  })

  it("does not retry on a failed fetch (e.g. the paired companion isn't the hub)", async () => {
    const spy = vi.spyOn(client, "fetchInstances").mockRejectedValue(new Error("not_found"))

    const { result } = renderHook(() => useCompanionInstances(PAIRING), { wrapper })

    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(spy).toHaveBeenCalledTimes(1)
  })
})

describe("useBootstrapPairing", () => {
  it("does not resolve a bootstrap pairing when this Repository already has its own pairing", () => {
    const spy = vi.spyOn(bootstrapPairing, "resolveBootstrapPairing")
    renderHook(() => useBootstrapPairing("repo-1", PAIRING), { wrapper })

    expect(spy).not.toHaveBeenCalled()
  })

  it("resolves a bootstrap pairing when this Repository has never been paired", async () => {
    const spy = vi
      .spyOn(bootstrapPairing, "resolveBootstrapPairing")
      .mockResolvedValue({ pairing: PAIRING, instances: [] })

    const { result } = renderHook(() => useBootstrapPairing("repo-1", null), {
      wrapper,
    })

    await waitFor(() => expect(spy).toHaveBeenCalledWith("repo-1"))
    await waitFor(() =>
      expect(result.current.data).toEqual({
        pairing: PAIRING,
        instances: [],
      })
    )
  })

  // TBR-149: a direct-handoff pairing that's gone stale (satellite restarted, new ephemeral
  // port) still has a non-null `ownPairing` — without an opt-in, this stays disabled exactly
  // like the has-a-pairing case above, so a caller must explicitly ask for it.
  it("still does not resolve when this Repository has its own pairing and alsoTryWhenUnreachable is false", () => {
    const spy = vi.spyOn(bootstrapPairing, "resolveBootstrapPairing")
    renderHook(
      () => useBootstrapPairing("repo-1", PAIRING, { alsoTryWhenUnreachable: false }),
      { wrapper }
    )

    expect(spy).not.toHaveBeenCalled()
  })

  it("resolves a bootstrap pairing when this Repository's own pairing exists but is unreachable and alsoTryWhenUnreachable is true", async () => {
    const spy = vi
      .spyOn(bootstrapPairing, "resolveBootstrapPairing")
      .mockResolvedValue({ pairing: PAIRING, instances: [] })

    const { result } = renderHook(
      () => useBootstrapPairing("repo-1", PAIRING, { alsoTryWhenUnreachable: true }),
      { wrapper }
    )

    await waitFor(() => expect(spy).toHaveBeenCalledWith("repo-1"))
    await waitFor(() =>
      expect(result.current.data).toEqual({ pairing: PAIRING, instances: [] })
    )
  })

  // Broadening `enabled` beyond "never paired" means the exclusion `resolveBootstrapPairing`
  // applies (skip candidates stored under this exact repositoryId) now genuinely differs per
  // repository — a shared, non-repository-keyed cache entry would let one repository's stale
  // result leak into another's. Two different repositories sharing one QueryClient (as a real
  // page navigation would, via the app's single QueryClientProvider) must each resolve their
  // own candidates.
  it("keys the cached result per repositoryId, so two different repositories don't share one bootstrap result", async () => {
    const spy = vi
      .spyOn(bootstrapPairing, "resolveBootstrapPairing")
      .mockImplementation((repositoryId) =>
        Promise.resolve({
          pairing: { ...PAIRING, checkoutId: repositoryId },
          instances: [],
        })
      )

    const { result } = renderHook(
      () => ({
        a: useBootstrapPairing("repo-a", null),
        b: useBootstrapPairing("repo-b", null),
      }),
      { wrapper }
    )

    await waitFor(() => expect(result.current.a.data).toBeTruthy())
    await waitFor(() => expect(result.current.b.data).toBeTruthy())

    expect(spy).toHaveBeenCalledWith("repo-a")
    expect(spy).toHaveBeenCalledWith("repo-b")
    expect(result.current.a.data?.pairing.checkoutId).toBe("repo-a")
    expect(result.current.b.data?.pairing.checkoutId).toBe("repo-b")
  })
})

describe("useCompanionSuggestedQuestions", () => {
  it("does not call the client when disabled", () => {
    const spy = vi.spyOn(client, "fetchSuggestedQuestions")
    renderHook(() => useCompanionSuggestedQuestions(PAIRING, false), { wrapper })

    expect(spy).not.toHaveBeenCalled()
  })

  it("calls fetchSuggestedQuestions with the pairing's baseUrl/token once enabled", async () => {
    const spy = vi
      .spyOn(client, "fetchSuggestedQuestions")
      .mockResolvedValue({ graph: {} as never, questions: [] })

    renderHook(() => useCompanionSuggestedQuestions(PAIRING, true), { wrapper })

    await waitFor(() =>
      expect(spy).toHaveBeenCalledWith(PAIRING.baseUrl, PAIRING.token)
    )
  })

  it("does not call the client when there is no pairing, even if enabled", () => {
    const spy = vi.spyOn(client, "fetchSuggestedQuestions")
    renderHook(() => useCompanionSuggestedQuestions(null, true), { wrapper })

    expect(spy).not.toHaveBeenCalled()
  })
})

describe("useDebouncedCompanionSearch", () => {
  it("debounces the search op and does not call it before the delay elapses", async () => {
    const searchSpy = vi
      .spyOn(client, "search")
      .mockResolvedValue({ graph: {} as never, results: [] })

    const { result } = renderHook(
      () => useDebouncedCompanionSearch(PAIRING, 10),
      { wrapper }
    )

    result.current.setQuery("auth")
    expect(searchSpy).not.toHaveBeenCalled()

    await waitFor(() =>
      expect(searchSpy).toHaveBeenCalledWith(PAIRING.baseUrl, PAIRING.token, {
        q: "auth",
      })
    )
  })

  it("never searches for an empty or whitespace-only query", async () => {
    const searchSpy = vi.spyOn(client, "search")

    const { result } = renderHook(
      () => useDebouncedCompanionSearch(PAIRING, 10),
      { wrapper }
    )

    result.current.setQuery("   ")
    await new Promise((resolve) => setTimeout(resolve, 30))

    expect(searchSpy).not.toHaveBeenCalled()
  })
})
