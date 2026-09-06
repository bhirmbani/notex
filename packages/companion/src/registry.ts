// The hub's in-memory record of every registered satellite (TBR-141, TBR-133's resolution).
// A clean shutdown removes an entry immediately via `deregister`; a satellite that exits
// uncleanly (`kill -9`, crash) instead goes stale, and TBR-134's resolution prunes it after a
// few missed heartbeats (default 45s = 3 misses at the default 15s interval) rather than
// leaving a dead entry in `GET /v1/instances` forever.
//
// Pruning happens lazily, inside `list()`, rather than on its own timer: the only consumer of
// this state is that one read path, so there's nothing to prune eagerly for and nobody to
// notice a stale entry linger a little past its deadline until the next read.

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

/** Exported for TBR-143's switch op — the one caller outside this module that needs the fields
 * `list()` deliberately projects away (`token`, in particular, to hand off to a browser on a
 * successful switch). */
export type SatelliteRecord = RegisterRequest & { registeredAt: string; lastHeartbeatAt: string }

/** 3 misses at the default 15s heartbeat interval (TBR-133's resolution) — TBR-134/TBR-142. */
export const DEFAULT_HEARTBEAT_TIMEOUT_MS = 45_000

/** Holds the hub's own record plus every registered satellite. `list()` is what `GET
 * /v1/instances` (companion-api.md, hub-only) echoes verbatim — its shape is deliberately a
 * strict subset of what's stored, so a token can never leak through a response. */
export class InstanceRegistry {
  private readonly satellites = new Map<string, SatelliteRecord>()

  constructor(
    private readonly hub: HubSelf,
    private readonly heartbeatTimeoutMs: number = DEFAULT_HEARTBEAT_TIMEOUT_MS,
  ) {}

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

  /** The full record for one registered satellite (TBR-143's switch op) — `undefined` for an
   * unknown or already-pruned `instanceId`. Prunes first so a satellite that just went stale
   * can't still be switched to as if it were live. Never looks at the hub's own record: a switch
   * targets a satellite, not the hub itself (`satellite_not_registered` is the error either way). */
  get(instanceId: string): SatelliteRecord | undefined {
    this.pruneStale()
    return this.satellites.get(instanceId)
  }

  /** Updates a registered satellite's `link` in place after TBR-143's switch op writes a new
   * `.notex/notex.json` at its checkout — without this, `GET /v1/instances` and a follow-up
   * switch's fast path would keep reporting the pre-switch link until the satellite happens to
   * restart and re-register. A no-op for an unknown `instanceId`, mirroring `deregister`. */
  updateLink(instanceId: string, link: InstanceLink): void {
    const record = this.satellites.get(instanceId)
    if (record) record.link = link
  }

  /** A satellite that missed its last few heartbeats (crashed, `kill -9`) is indistinguishable
   * from one about to heartbeat again this instant — `heartbeatTimeoutMs` is how long `list()`
   * waits before treating silence as proof it's gone, not a hint. */
  private pruneStale(): void {
    const now = Date.now()
    for (const [instanceId, record] of this.satellites) {
      if (now - new Date(record.lastHeartbeatAt).getTime() > this.heartbeatTimeoutMs) {
        this.satellites.delete(instanceId)
      }
    }
  }

  list(): Array<InstanceSummary> {
    this.pruneStale()
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
