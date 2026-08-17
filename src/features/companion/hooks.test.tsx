// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { renderHook, waitFor } from "@testing-library/react"
import type { ReactNode } from "react"

import { useCompanionConnection } from "./hooks"
import * as connectionState from "./connectionState"

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
