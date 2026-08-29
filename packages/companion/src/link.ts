// `npx notex-companion link` (TBR-85) — writes `.notex/notex.json` (docs/specs/notex-mcp-server.md
// §4), the sole source `loadNotexConfig` (TBR-69, notexConfig.ts) reads. Validates the ids and key
// against the Notex API before writing, per the ticket's acceptance criteria: a typo should fail
// loudly here rather than silently produce a `.notex/notex.json` that only breaks on the first
// real `notex_*` call.
//
// The write itself goes through atomicWrite.ts's shared helper, same as pairing.ts's token file,
// so re-running `link` (rotation / re-pairing) never leaves the file at a looser permission, even
// momentarily. Unlike pairing.ts's token, there is no exclusive-create path here: `link` is a
// deliberate, user-invoked rewrite every time, not a lazy first-run creation.

import { atomicWriteFile } from "./atomicWrite.ts"
import { CliUsageError } from "./cliErrors.ts"
import { configFilePath, type NotexConfig } from "./notexConfig.ts"
import { createNotexClient, resolveApiUrl } from "./notexClient.ts"
import { ERROR_CODES, OpError } from "./types.ts"

export type LinkArgs = { organizationId: string; projectId: string; repositoryId: string; apiKey: string }

const REQUIRED_FLAGS = ["--organization-id", "--project-id", "--repository-id", "--api-key"]

export function parseLinkArgs(args: Array<string>): LinkArgs {
  let organizationId: string | undefined
  let projectId: string | undefined
  let repositoryId: string | undefined
  let apiKey: string | undefined

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    switch (arg) {
      case "--organization-id":
        organizationId = args[++i]
        if (!organizationId) throw new CliUsageError("--organization-id needs a value")
        break
      case "--project-id":
        projectId = args[++i]
        if (!projectId) throw new CliUsageError("--project-id needs a value")
        break
      case "--repository-id":
        repositoryId = args[++i]
        if (!repositoryId) throw new CliUsageError("--repository-id needs a value")
        break
      case "--api-key":
        apiKey = args[++i]
        if (!apiKey) throw new CliUsageError("--api-key needs a value")
        break
      default:
        throw new CliUsageError(`unrecognised option "${arg}"`)
    }
  }

  if (!organizationId || !projectId || !repositoryId || !apiKey) {
    throw new CliUsageError(`link needs ${REQUIRED_FLAGS.join(", ")}, all required`)
  }

  return { organizationId, projectId, repositoryId, apiKey }
}

function writeNotexConfig(checkoutPath: string, config: NotexConfig): void {
  atomicWriteFile(configFilePath(checkoutPath), JSON.stringify(config, null, 2), 0o600)
}

/** Turns a failed validation call into the actionable message `link` prints — never the raw
 * `OpError`, whose wording is aimed at a `notex_*` tool call, not a person running a CLI. */
function describeValidationFailure(err: unknown, args: LinkArgs): string {
  if (err instanceof OpError) {
    switch (err.code) {
      case ERROR_CODES.unauthorized:
        return "Notex rejected the API key — generate a new one from Notex Settings → API keys and try again."
      case ERROR_CODES.forbidden:
        return `Not authorized for repository ${args.repositoryId} in organization ${args.organizationId} — check the ids, or that your API key's owner holds a Grant on this Project.`
      case ERROR_CODES.notFound:
        return `Repository ${args.repositoryId} was not found in organization ${args.organizationId} — check the ids from Notex Settings.`
      default:
        return `Could not verify with the Notex API: ${err.message}`
    }
  }
  return `Could not verify with the Notex API: ${err instanceof Error ? err.message : String(err)}`
}

/**
 * Validates `args` against the Notex API, then writes `.notex/notex.json`. Throws `CliUsageError`
 * with an actionable message on bad input; writes nothing in that case.
 */
export async function link(args: LinkArgs, opts: { checkoutPath: string; fetchImpl?: typeof fetch } = { checkoutPath: process.cwd() }): Promise<void> {
  const client = createNotexClient({ baseUrl: resolveApiUrl(), apiKey: args.apiKey }, opts.fetchImpl)

  let repository: Awaited<ReturnType<typeof client.getRepository>>
  try {
    repository = await client.getRepository(args.organizationId, args.repositoryId)
  } catch (err) {
    throw new CliUsageError(describeValidationFailure(err, args))
  }

  // No route accepts organizationId/projectId/repositoryId together (docs/specs/notex-mcp-server.md
  // §4) — getRepository only proves the org+repo+key combination, so the project id supplied
  // separately is cross-checked here against the one the repository actually belongs to.
  if (repository.projectId !== args.projectId) {
    throw new CliUsageError(
      `Repository ${args.repositoryId} belongs to project ${repository.projectId}, not ${args.projectId} — check the ids from Notex Settings.`,
    )
  }

  writeNotexConfig(opts.checkoutPath, {
    organizationId: args.organizationId,
    projectId: args.projectId,
    repositoryId: args.repositoryId,
    apiKey: args.apiKey,
  })
}
