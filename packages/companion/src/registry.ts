// The hub's in-memory record of every registered satellite (TBR-141, TBR-133's resolution).
// Registration is satellite -> hub only for this ticket's happy path; staleness-based pruning
// after missed heartbeats is TBR-142's crash/restart-recovery job, not this one's — a clean
// shutdown removes an entry immediately via `deregister`, and that is the only removal path
// implemented here.

export type InstanceLink = { organizationId: string; projectId: string; repositoryId: string } | null

export type RegisterRequest = {
  instanceId: string
  checkoutPath: string
  port: number
  pid: number
  gitRemote: string | null
  headSha: string | null
  /** The satellite's own persistent pairing token (`.notex/companion.json`) — kept on the
   * in-memory record for TBR-143's future switch/relink handoff. Never leaves the hub: `list()`
   * projects it away, and it's excluded from every op response (companion-api.md never puts a
   * token in a response body). */
  token: string
  link: InstanceLink
}

export type InstanceSummary = {
  instanceId: string
  checkoutPath: string
  port: number
  role: "hub" | "satellite"
  registeredAt: string
  lastHeartbeatAt: string
  gitRemote: string | null
  headSha: string | null
  link: InstanceLink
}

export type HubSelf = {
  instanceId: string
  checkoutPath: string
  port: number
  gitRemote: string | null
  headSha: string | null
  link: InstanceLink
  registeredAt: string
}

type SatelliteRecord = RegisterRequest & { registeredAt: string; lastHeartbeatAt: string }

/** Holds the hub's own record plus every registered satellite. `list()` is what `GET
 * /v1/instances` (companion-api.md, hub-only) echoes verbatim — its shape is deliberately a
 * strict subset of what's stored, so a token can never leak through a response. */
export class InstanceRegistry {
  private readonly satellites = new Map<string, SatelliteRecord>()

  constructor(private readonly hub: HubSelf) {}

  register(req: RegisterRequest): void {
    const now = new Date().toISOString()
    this.satellites.set(req.instanceId, { ...req, registeredAt: now, lastHeartbeatAt: now })
  }

  /** Returns `false` for an unknown instanceId (e.g. a heartbeat that arrives after this hub
   * process restarted) — the caller decides whether that's worth surfacing; this ticket doesn't
   * need it to be. */
  heartbeat(instanceId: string): boolean {
    const record = this.satellites.get(instanceId)
    if (!record) return false
    record.lastHeartbeatAt = new Date().toISOString()
    return true
  }

  deregister(instanceId: string): void {
    this.satellites.delete(instanceId)
  }

  list(): Array<InstanceSummary> {
    const hubSummary: InstanceSummary = {
      instanceId: this.hub.instanceId,
      checkoutPath: this.hub.checkoutPath,
      port: this.hub.port,
      role: "hub",
      registeredAt: this.hub.registeredAt,
      lastHeartbeatAt: this.hub.registeredAt,
      gitRemote: this.hub.gitRemote,
      headSha: this.hub.headSha,
      link: this.hub.link,
    }
    const satelliteSummaries = [...this.satellites.values()].map(
      (record): InstanceSummary => ({
        instanceId: record.instanceId,
        checkoutPath: record.checkoutPath,
        port: record.port,
        role: "satellite",
        registeredAt: record.registeredAt,
        lastHeartbeatAt: record.lastHeartbeatAt,
        gitRemote: record.gitRemote,
        headSha: record.headSha,
        link: record.link,
      }),
    )
    return [hubSummary, ...satelliteSummaries]
  }
}
