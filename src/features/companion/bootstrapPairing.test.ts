// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest"

import { resolveBootstrapPairing } from "./bootstrapPairing"
import { CompanionRequestError } from "./client"

const HUB_PAIRING = {
  baseUrl: "http://127.0.0.1:7717",
  token: "hub-tok",
  checkoutId: "hub-c",
}

const SATELLITE_PAIRING = {
  baseUrl: "http://127.0.0.1:8888",
  token: "sat-tok",
  checkoutId: "sat-c",
}

describe("resolveBootstrapPairing", () => {
  it("returns null without calling the client when there are no pairings anywhere", async () => {
    const fetchInstances = vi.fn()

    const result = await resolveBootstrapPairing("repo-fresh", {
      listPairings: () => [],
      fetchInstances,
    })

    expect(result).toBeNull()
    expect(fetchInstances).not.toHaveBeenCalled()
  })

  it("skips a candidate pairing that belongs to a satellite (not_found) and tries the next", async () => {
    const fetchInstances = vi
      .fn()
      .mockRejectedValueOnce(new CompanionRequestError(404, "not_found", "not found"))
      .mockResolvedValueOnce({ instances: [] })

    const result = await resolveBootstrapPairing("repo-fresh", {
      listPairings: () => [
        { repositoryId: "repo-other-satellite", record: SATELLITE_PAIRING },
        { repositoryId: "repo-other-hub", record: HUB_PAIRING },
      ],
      fetchInstances,
    })

    expect(result).toEqual({ pairing: HUB_PAIRING, instances: [] })
    expect(fetchInstances).toHaveBeenCalledTimes(2)
    expect(fetchInstances).toHaveBeenNthCalledWith(1, SATELLITE_PAIRING.baseUrl, SATELLITE_PAIRING.token)
    expect(fetchInstances).toHaveBeenNthCalledWith(2, HUB_PAIRING.baseUrl, HUB_PAIRING.token)
  })

  it("returns the first candidate that resolves to a hub without trying further candidates", async () => {
    const fetchInstances = vi.fn().mockResolvedValue({ instances: [] })

    const result = await resolveBootstrapPairing("repo-fresh", {
      listPairings: () => [
        { repositoryId: "repo-other-hub", record: HUB_PAIRING },
        { repositoryId: "repo-another", record: SATELLITE_PAIRING },
      ],
      fetchInstances,
    })

    expect(result).toEqual({ pairing: HUB_PAIRING, instances: [] })
    expect(fetchInstances).toHaveBeenCalledTimes(1)
  })

  it("returns null, without surfacing an error, when every candidate fails", async () => {
    const fetchInstances = vi
      .fn()
      .mockRejectedValue(new CompanionRequestError(404, "not_found", "not found"))

    const result = await resolveBootstrapPairing("repo-fresh", {
      listPairings: () => [{ repositoryId: "repo-other", record: SATELLITE_PAIRING }],
      fetchInstances,
    })

    expect(result).toBeNull()
  })

  it("excludes a candidate pairing that belongs to the repository itself", async () => {
    const fetchInstances = vi.fn()

    const result = await resolveBootstrapPairing("repo-fresh", {
      listPairings: () => [{ repositoryId: "repo-fresh", record: HUB_PAIRING }],
      fetchInstances,
    })

    expect(result).toBeNull()
    expect(fetchInstances).not.toHaveBeenCalled()
  })
})
