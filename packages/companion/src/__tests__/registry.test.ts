import { describe, expect, it } from "bun:test"
import { InstanceRegistry } from "../registry.ts"
import type { RegisterRequest } from "../registry.ts"

function hubSelf() {
  return {
    instanceId: "hub-1",
    checkoutPath: "/checkout/hub",
    port: 7717,
    gitRemote: "git@example.com:org/hub.git",
    headSha: "aaa111",
    link: null,
    registeredAt: new Date().toISOString(),
  }
}

function registerRequest(overrides: Partial<RegisterRequest> = {}): RegisterRequest {
  return {
    instanceId: "sat-1",
    checkoutPath: "/checkout/sat",
    port: 54321,
    pid: 4242,
    gitRemote: "git@example.com:org/sat.git",
    headSha: "bbb222",
    token: "satellite-own-token",
    link: null,
    ...overrides,
  }
}

describe("InstanceRegistry", () => {
  it("always lists the hub itself, even with no satellites registered", () => {
    const registry = new InstanceRegistry(hubSelf())
    expect(registry.list()).toEqual([
      {
        instanceId: "hub-1",
        checkoutPath: "/checkout/hub",
        port: 7717,
        role: "hub",
        registeredAt: registry.list()[0]!.registeredAt,
        lastHeartbeatAt: registry.list()[0]!.registeredAt,
        gitRemote: "git@example.com:org/hub.git",
        headSha: "aaa111",
        link: null,
      },
    ])
  })

  it("lists a registered satellite alongside the hub, with correct role", () => {
    const registry = new InstanceRegistry(hubSelf())
    registry.register(registerRequest())

    const list = registry.list()
    expect(list).toHaveLength(2)
    expect(list.map((i) => i.role)).toEqual(["hub", "satellite"])
    const satellite = list.find((i) => i.instanceId === "sat-1")
    expect(satellite).toMatchObject({
      checkoutPath: "/checkout/sat",
      port: 54321,
      role: "satellite",
      gitRemote: "git@example.com:org/sat.git",
      headSha: "bbb222",
      link: null,
    })
  })

  it("never includes a token field anywhere in the listed output", () => {
    const registry = new InstanceRegistry(hubSelf())
    registry.register(registerRequest({ link: { organizationId: "org1", projectId: "proj1", repositoryId: "repo1" } }))

    const serialized = JSON.stringify(registry.list())
    expect(serialized).not.toContain("token")
    expect(serialized).not.toContain("satellite-own-token")
  })

  it("carries the link field through when the satellite's checkout is linked", () => {
    const registry = new InstanceRegistry(hubSelf())
    const link = { organizationId: "org1", projectId: "proj1", repositoryId: "repo1" }
    registry.register(registerRequest({ link }))

    expect(registry.list().find((i) => i.instanceId === "sat-1")?.link).toEqual(link)
  })

  it("updates lastHeartbeatAt on heartbeat without touching registeredAt", async () => {
    const registry = new InstanceRegistry(hubSelf())
    registry.register(registerRequest())
    const before = registry.list().find((i) => i.instanceId === "sat-1")!

    await new Promise((r) => setTimeout(r, 5))
    const ok = registry.heartbeat("sat-1")
    expect(ok).toBe(true)

    const after = registry.list().find((i) => i.instanceId === "sat-1")!
    expect(after.registeredAt).toBe(before.registeredAt)
    expect(new Date(after.lastHeartbeatAt).getTime()).toBeGreaterThan(new Date(before.lastHeartbeatAt).getTime())
  })

  it("returns false from heartbeat for an unknown instanceId", () => {
    const registry = new InstanceRegistry(hubSelf())
    expect(registry.heartbeat("does-not-exist")).toBe(false)
  })

  it("removes a satellite from the listing immediately on deregister", () => {
    const registry = new InstanceRegistry(hubSelf())
    registry.register(registerRequest())
    expect(registry.list().map((i) => i.instanceId)).toContain("sat-1")

    registry.deregister("sat-1")

    expect(registry.list().map((i) => i.instanceId)).toEqual(["hub-1"])
  })

  it("deregistering an unknown instanceId is a harmless no-op", () => {
    const registry = new InstanceRegistry(hubSelf())
    expect(() => registry.deregister("never-registered")).not.toThrow()
  })

  // ------------------------------------------------- get / updateLink (TBR-143)

  it("get() returns the full record, including the token list() never exposes", () => {
    const registry = new InstanceRegistry(hubSelf())
    registry.register(registerRequest())

    expect(registry.get("sat-1")).toMatchObject({ instanceId: "sat-1", token: "satellite-own-token" })
  })

  it("get() returns undefined for an unknown instanceId", () => {
    const registry = new InstanceRegistry(hubSelf())
    expect(registry.get("does-not-exist")).toBeUndefined()
  })

  it("get() prunes a stale satellite rather than returning it", async () => {
    const registry = new InstanceRegistry(hubSelf(), 20)
    registry.register(registerRequest())

    await new Promise((r) => setTimeout(r, 100))

    expect(registry.get("sat-1")).toBeUndefined()
  })

  it("updateLink() replaces a satellite's link in place", () => {
    const registry = new InstanceRegistry(hubSelf())
    registry.register(registerRequest({ link: { organizationId: "o1", projectId: "p1", repositoryId: "r1" } }))

    const newLink = { organizationId: "o2", projectId: "p2", repositoryId: "r2" }
    registry.updateLink("sat-1", newLink)

    expect(registry.get("sat-1")?.link).toEqual(newLink)
    expect(registry.list().find((i) => i.instanceId === "sat-1")?.link).toEqual(newLink)
  })

  it("updateLink() for an unknown instanceId is a harmless no-op", () => {
    const registry = new InstanceRegistry(hubSelf())
    expect(() => registry.updateLink("never-registered", null)).not.toThrow()
  })

  // ------------------------------------------- staleness pruning (TBR-142)

  // Margins below are generous (tens of ms of slack either side of the configured timeout) —
  // `setTimeout` is a minimum delay, not an exact one, and a tight margin here would make these
  // flaky under scheduler contention (a loaded CI runner, e.g.) rather than testing anything real
  // about the pruning logic itself (TBR-142 code review).

  it("keeps a satellite listed before its heartbeat-timeout window has elapsed", async () => {
    const registry = new InstanceRegistry(hubSelf(), 100)
    registry.register(registerRequest())

    await new Promise((r) => setTimeout(r, 10))

    expect(registry.list().map((i) => i.instanceId)).toContain("sat-1")
  })

  it("prunes a satellite that missed its heartbeat-timeout window, next time list() is called", async () => {
    const registry = new InstanceRegistry(hubSelf(), 20)
    registry.register(registerRequest())

    await new Promise((r) => setTimeout(r, 100))

    const list = registry.list()
    expect(list.map((i) => i.instanceId)).not.toContain("sat-1")
    expect(list.map((i) => i.role)).toEqual(["hub"])
  })

  it("does not prune a satellite that keeps heartbeating within the timeout window", async () => {
    const registry = new InstanceRegistry(hubSelf(), 100)
    registry.register(registerRequest())

    await new Promise((r) => setTimeout(r, 30))
    registry.heartbeat("sat-1")
    await new Promise((r) => setTimeout(r, 30))

    expect(registry.list().map((i) => i.instanceId)).toContain("sat-1")
  })
})
