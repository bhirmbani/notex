// Hub-side write path (TBR-143, TBR-135's resolution) behind `POST /v1/switch`: validates a
// requested organizationId/projectId/repositoryId against the Notex API and writes the target
// satellite's `.notex/notex.json`, or skips both entirely when the satellite is already linked
// to exactly those ids (the fast path — no apiKey needed at all). Mirrors link.ts's own
// getRepository + projectId cross-check, including its actionable failure wording, rather than
// reinventing validation: this is link.ts's same operation, just triggered from the hub instead
// of the CLI, against a satellite's checkout instead of the caller's own.
//
// `POST /v1/hub-key`'s own persistence lives in hubIdentity.ts (same file as the hub token) —
// this module only consumes it, via the `hubApiKey` parameter its caller (http.ts) resolves.

import { atomicWriteFile } from "./atomicWrite.ts"
import { configFilePath } from "./notexConfig.ts"
import { createNotexClient, resolveApiUrl } from "./notexClient.ts"
import { ERROR_CODES, OpError } from "./types.ts"
import type { NotexConfig, NotexLinkIds } from "./notexConfig.ts"
import type { InstanceLink, InstanceRegistry } from "./registry.ts"

/** The organizationId/projectId/repositoryId trio is `NotexLinkIds` (notexConfig.ts) everywhere
 * else it travels together — reused here rather than re-declared a third time. */
export type SwitchRequest = { instanceId: string } & NotexLinkIds

export type SwitchResult = {
  baseUrl: string
  token: string
  checkoutPath: string
  gitRemote: string | null
  headSha: string | null
}

function linkMatches(link: InstanceLink, req: SwitchRequest): boolean {
  return (
    link !== null &&
    link.organizationId === req.organizationId &&
    link.projectId === req.projectId &&
    link.repositoryId === req.repositoryId
  )
}

/** Mirrors link.ts's `describeValidationFailure` — same wording, since this is the identical
 * validation against the Notex API, just triggered by a browser switch instead of the CLI. */
function describeValidationFailure(err: unknown, req: SwitchRequest): OpError {
  if (err instanceof OpError) {
    switch (err.code) {
      case ERROR_CODES.unauthorized:
        return new OpError(
          ERROR_CODES.unauthorized,
          "Notex rejected the API key — generate a new one from Notex Settings → API keys and try again.",
        )
      case ERROR_CODES.forbidden:
        return new OpError(
          ERROR_CODES.forbidden,
          `Not authorized for repository ${req.repositoryId} in organization ${req.organizationId} — check the ids, or that your API key's owner holds a Grant on this Project.`,
        )
      case ERROR_CODES.notFound:
        return new OpError(
          ERROR_CODES.notFound,
          `Repository ${req.repositoryId} was not found in organization ${req.organizationId} — check the ids from Notex Settings.`,
        )
      default:
        return err
    }
  }
  return new OpError(
    ERROR_CODES.notexApiError,
    `Could not verify with the Notex API: ${err instanceof Error ? err.message : String(err)}`,
  )
}

/**
 * Validates + writes (or, on the fast path, does neither) then hands back the target satellite's
 * own `baseUrl`/`token` for direct post-switch handoff — the hub stays a broker, not a proxy.
 */
export async function switchInstance(
  registry: InstanceRegistry,
  hubApiKey: string | undefined,
  req: SwitchRequest,
  fetchImpl?: typeof fetch,
): Promise<SwitchResult> {
  const record = registry.get(req.instanceId)
  if (!record) {
    throw new OpError(ERROR_CODES.satelliteNotRegistered, `No registered satellite instance: ${req.instanceId}`)
  }

  if (!linkMatches(record.link, req)) {
    if (!hubApiKey) {
      throw new OpError(ERROR_CODES.hubKeyRequired, "No hub API key persisted yet — call POST /v1/hub-key first")
    }

    const client = createNotexClient({ baseUrl: resolveApiUrl(), apiKey: hubApiKey }, fetchImpl)
    let repository: Awaited<ReturnType<typeof client.getRepository>>
    try {
      repository = await client.getRepository(req.organizationId, req.repositoryId)
    } catch (err) {
      throw describeValidationFailure(err, req)
    }

    // No route accepts organizationId/projectId/repositoryId together (link.ts's own comment) —
    // getRepository only proves the org+repo+key combination, so the project id is cross-checked
    // separately against the one the repository actually belongs to.
    if (repository.projectId !== req.projectId) {
      throw new OpError(
        ERROR_CODES.notFound,
        `Repository ${req.repositoryId} belongs to project ${repository.projectId}, not ${req.projectId} — check the ids from Notex Settings.`,
      )
    }

    const config: NotexConfig = {
      organizationId: req.organizationId,
      projectId: req.projectId,
      repositoryId: req.repositoryId,
      apiKey: hubApiKey,
    }
    try {
      atomicWriteFile(configFilePath(record.checkoutPath), JSON.stringify(config, null, 2), 0o600)
    } catch (err) {
      throw new OpError(
        ERROR_CODES.writeFailed,
        `Could not write .notex/notex.json at ${record.checkoutPath}: ${err instanceof Error ? err.message : String(err)}`,
      )
    }

    registry.updateLink(req.instanceId, {
      organizationId: req.organizationId,
      projectId: req.projectId,
      repositoryId: req.repositoryId,
    })
  }

  return {
    baseUrl: `http://127.0.0.1:${record.port}`,
    token: record.token,
    checkoutPath: record.checkoutPath,
    gitRemote: record.gitRemote,
    headSha: record.headSha,
  }
}
