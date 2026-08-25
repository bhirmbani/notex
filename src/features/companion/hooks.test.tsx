// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { renderHook, waitFor } from "@testing-library/react"

import {
  useCompanionConnection,
  useCompanionPath,
  useCompanionSearch,
  useDebouncedCompanionSearch,
} from "./hooks"
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
