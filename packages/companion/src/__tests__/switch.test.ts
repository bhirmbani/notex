import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it, mock } from "bun:test"
import { InstanceRegistry } from "../registry.ts"
import { switchInstance } from "../switch.ts"
import type { RegisterRequest } from "../registry.ts"

function fakeFetch(status: number, body: unknown) {
  return mock(async () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })) as unknown as typeof fetch
}

function hubSelf() {
  return {
    instanceId: "hub-1",
    checkoutPath: "/checkout/hub",
    port: 7717,
    gitRemote: null,
    headSha: null,
    link: null,
    registeredAt: new Date().toISOString(),
  }
}

function registerRequest(checkoutPath: string, overrides: Partial<RegisterRequest> = {}): RegisterRequest {
  return {
    instanceId: "sat-1",
    checkoutPath,
    port: 54321,
    pid: 4242,
    gitRemote: "git@example.com:org/sat.git",
    headSha: "bbb222",
    token: "satellite-own-token",
    link: null,
    ...overrides,
  }
}

const REQ = { instanceId: "sat-1", organizationId: "org_1", projectId: "proj_1", repositoryId: "repo_1" }

describe("switchInstance", () => {
  let checkoutPath: string

  afterEach(() => {
    if (checkoutPath) rmSync(checkoutPath, { recursive: true, force: true })
  })

  it("throws satellite_not_registered for an unknown instanceId", async () => {
    const registry = new InstanceRegistry(hubSelf())
    await expect(switchInstance(registry, "hub_key", REQ)).rejects.toMatchObject({ code: "satellite_not_registered" })
  })

  it("throws hub_key_required when the link doesn't match and no hub key is persisted", async () => {
    checkoutPath = mkdtempSync(join(tmpdir(), "notex-switch-test-"))
    const registry = new InstanceRegistry(hubSelf())
    registry.register(registerRequest(checkoutPath))

    await expect(switchInstance(registry, undefined, REQ)).rejects.toMatchObject({ code: "hub_key_required" })
  })

  it("fast path: succeeds with no hub key when already linked to exactly the requested ids", async () => {
    checkoutPath = mkdtempSync(join(tmpdir(), "notex-switch-test-"))
    const registry = new InstanceRegistry(hubSelf())
    registry.register(
      registerRequest(checkoutPath, {
        link: { organizationId: "org_1", projectId: "proj_1", repositoryId: "repo_1" },
      }),
    )

    const result = await switchInstance(registry, undefined, REQ)
    expect(result).toEqual({
      baseUrl: "http://127.0.0.1:54321",
      token: "satellite-own-token",
      checkoutPath,
      gitRemote: "git@example.com:org/sat.git",
      headSha: "bbb222",
    })
  })

  it("fast path never writes .notex/notex.json", async () => {
    checkoutPath = mkdtempSync(join(tmpdir(), "notex-switch-test-"))
    const registry = new InstanceRegistry(hubSelf())
    registry.register(
      registerRequest(checkoutPath, {
        link: { organizationId: "org_1", projectId: "proj_1", repositoryId: "repo_1" },
      }),
    )

    await switchInstance(registry, undefined, REQ)
    expect(() => readFileSync(join(checkoutPath, ".notex", "notex.json"))).toThrow()
  })

  it("validates against the Notex API and writes .notex/notex.json when unlinked, with a hub key", async () => {
    checkoutPath = mkdtempSync(join(tmpdir(), "notex-switch-test-"))
    const registry = new InstanceRegistry(hubSelf())
    registry.register(registerRequest(checkoutPath))
    const fetchImpl = fakeFetch(200, { id: "repo_1", projectId: "proj_1", name: "notex", description: null })

    const result = await switchInstance(registry, "hub_key", REQ, fetchImpl)

    expect(result.baseUrl).toBe("http://127.0.0.1:54321")
    expect(result.token).toBe("satellite-own-token")

    const configPath = join(checkoutPath, ".notex", "notex.json")
    expect(statSync(configPath).mode & 0o777).toBe(0o600)
    expect(JSON.parse(readFileSync(configPath, "utf8"))).toEqual({
      organizationId: "org_1",
      projectId: "proj_1",
      repositoryId: "repo_1",
      apiKey: "hub_key",
    })
  })

  it("updates the registry's in-memory link after a successful validated write", async () => {
    checkoutPath = mkdtempSync(join(tmpdir(), "notex-switch-test-"))
    const registry = new InstanceRegistry(hubSelf())
    registry.register(registerRequest(checkoutPath))
    const fetchImpl = fakeFetch(200, { id: "repo_1", projectId: "proj_1", name: "notex", description: null })

    await switchInstance(registry, "hub_key", REQ, fetchImpl)

    expect(registry.get("sat-1")?.link).toEqual({ organizationId: "org_1", projectId: "proj_1", repositoryId: "repo_1" })
  })

  it("a second switch against the now-matching link takes the fast path (no fetch call)", async () => {
    checkoutPath = mkdtempSync(join(tmpdir(), "notex-switch-test-"))
    const registry = new InstanceRegistry(hubSelf())
    registry.register(registerRequest(checkoutPath))
    const fetchImpl = fakeFetch(200, { id: "repo_1", projectId: "proj_1", name: "notex", description: null })

    await switchInstance(registry, "hub_key", REQ, fetchImpl)
    expect(fetchImpl).toHaveBeenCalledTimes(1)

    await switchInstance(registry, undefined, REQ)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it("rejects and writes nothing when the repository belongs to a different project", async () => {
    checkoutPath = mkdtempSync(join(tmpdir(), "notex-switch-test-"))
    const registry = new InstanceRegistry(hubSelf())
    registry.register(registerRequest(checkoutPath))
    const fetchImpl = fakeFetch(200, { id: "repo_1", projectId: "proj_other", name: "notex", description: null })

    await expect(switchInstance(registry, "hub_key", REQ, fetchImpl)).rejects.toMatchObject({
      code: "not_found",
      message: expect.stringContaining("belongs to project proj_other"),
    })
    expect(() => readFileSync(join(checkoutPath, ".notex", "notex.json"))).toThrow()
    expect(registry.get("sat-1")?.link).toBeNull()
  })

  it("surfaces an actionable message when the hub's API key is rejected", async () => {
    checkoutPath = mkdtempSync(join(tmpdir(), "notex-switch-test-"))
    const registry = new InstanceRegistry(hubSelf())
    registry.register(registerRequest(checkoutPath))
    const fetchImpl = fakeFetch(401, { error: { code: "UNAUTHORIZED", message: "bad key" } })

    await expect(switchInstance(registry, "hub_key", REQ, fetchImpl)).rejects.toMatchObject({
      code: "unauthorized",
      message: expect.stringContaining("rejected the API key"),
    })
  })

  it("surfaces an actionable message when not authorized for the repository", async () => {
    checkoutPath = mkdtempSync(join(tmpdir(), "notex-switch-test-"))
    const registry = new InstanceRegistry(hubSelf())
    registry.register(registerRequest(checkoutPath))
    const fetchImpl = fakeFetch(403, { error: { code: "FORBIDDEN", message: "no grant" } })

    await expect(switchInstance(registry, "hub_key", REQ, fetchImpl)).rejects.toMatchObject({
      code: "forbidden",
      message: expect.stringContaining("Not authorized"),
    })
  })

  it("surfaces an actionable message when the repository id is not found", async () => {
    checkoutPath = mkdtempSync(join(tmpdir(), "notex-switch-test-"))
    const registry = new InstanceRegistry(hubSelf())
    registry.register(registerRequest(checkoutPath))
    const fetchImpl = fakeFetch(404, { error: { code: "NOT_FOUND", message: "gone" } })

    await expect(switchInstance(registry, "hub_key", REQ, fetchImpl)).rejects.toMatchObject({
      code: "not_found",
      message: expect.stringContaining("was not found"),
    })
  })

  it("throws write_failed when atomicWriteFile fails (e.g. checkout path no longer exists)", async () => {
    const registry = new InstanceRegistry(hubSelf())
    registry.register(registerRequest("/no/such/checkout/at/all"))
    const fetchImpl = fakeFetch(200, { id: "repo_1", projectId: "proj_1", name: "notex", description: null })

    // mkdirSync(dirname, {recursive:true}) inside atomicWriteFile will throw for an
    // unwritable/nonexistent root — asserting write_failed rather than an unhandled OpError.
    await expect(switchInstance(registry, "hub_key", REQ, fetchImpl)).rejects.toMatchObject({ code: "write_failed" })
  })
})
