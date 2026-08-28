// Thin fetch client for the Notex Worker's REST API (docs/specs/notex-mcp-server.md §2.3-2.4),
// authenticated by `x-api-key` (§7). This is the only module in the companion that talks to the
// *remote* Notex API — everything else here reads a local graphify-out/graph.json. Kept
// transport-free of MCP: mcpTools.ts maps `OpError`s to CallToolResults, same split as ops.ts.

import { ERROR_CODES, OpError } from "./types.ts"

export type NotexContext = { id: string; repositoryId: string; question: string; createdAt: string }

export type NotexFile = {
  id: string
  contextId: string
  name: string
  contentType: "text" | "upload"
  content: string
  createdAt: string
}

export type NotexRepository = { id: string; projectId: string; name: string; description: string | null }

export type NotexClientConfig = { baseUrl: string; apiKey: string }

type FetchImpl = typeof fetch

const DEFAULT_API_URL = "http://localhost:3000"

/** `NOTEX_API_URL` overrides the default — there is no production Notex origin baked into this
 * package yet, and `.notex/notex.json` (notex-mcp-server.md §4) deliberately carries no URL. */
export function resolveApiUrl(env: { NOTEX_API_URL?: string } = process.env as { NOTEX_API_URL?: string }): string {
  return env.NOTEX_API_URL?.trim() || DEFAULT_API_URL
}

async function request<T>(config: NotexClientConfig, fetchImpl: FetchImpl, method: string, path: string, body?: unknown): Promise<T> {
  let res: Response
  try {
    res = await fetchImpl(`${config.baseUrl}${path}`, {
      method,
      headers: {
        "x-api-key": config.apiKey,
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
  } catch (err) {
    throw new OpError(ERROR_CODES.notexApiError, `Could not reach the Notex API at ${config.baseUrl}`, err)
  }

  if (res.status === 401) throw new OpError(ERROR_CODES.unauthorized, "Notex rejected the API key")
  if (res.status === 403) throw new OpError(ERROR_CODES.forbidden, "Not authorized for this Project")
  if (res.status === 404) throw new OpError(ERROR_CODES.notFound, "Not found in Notex")
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } }
    throw new OpError(ERROR_CODES.notexApiError, body.error?.message ?? `Notex API error (HTTP ${res.status})`)
  }

  return (await res.json()) as T
}

const enc = (id: string) => encodeURIComponent(id)

export function createNotexClient(config: NotexClientConfig, fetchImpl: FetchImpl = fetch) {
  return {
    /** Used by `link.ts` (TBR-85) to validate organizationId/repositoryId/apiKey together before
     * writing `.notex/notex.json` — the returned `projectId` is checked against the one the user
     * supplied, since no route accepts all three ids at once. */
    getRepository: (organizationId: string, id: string) =>
      request<NotexRepository>(config, fetchImpl, "GET", `/api/v1/organizations/${enc(organizationId)}/repositories/${enc(id)}`),

    listContexts: (organizationId: string, repositoryId: string) =>
      request<Array<NotexContext>>(
        config,
        fetchImpl,
        "GET",
        `/api/v1/organizations/${enc(organizationId)}/repositories/${enc(repositoryId)}/contexts`,
      ),

    getContext: (organizationId: string, id: string) =>
      request<NotexContext>(config, fetchImpl, "GET", `/api/v1/organizations/${enc(organizationId)}/contexts/${enc(id)}`),

    createContext: (organizationId: string, repositoryId: string, question: string) =>
      request<NotexContext>(
        config,
        fetchImpl,
        "POST",
        `/api/v1/organizations/${enc(organizationId)}/repositories/${enc(repositoryId)}/contexts`,
        { question },
      ),

    listFiles: (organizationId: string, contextId: string) =>
      request<Array<NotexFile>>(
        config,
        fetchImpl,
        "GET",
        `/api/v1/organizations/${enc(organizationId)}/contexts/${enc(contextId)}/files`,
      ),

    getFile: (organizationId: string, id: string) =>
      request<NotexFile>(config, fetchImpl, "GET", `/api/v1/organizations/${enc(organizationId)}/files/${enc(id)}`),

    createFile: (organizationId: string, contextId: string, file: { name: string; contentType: "text" | "upload"; content: string }) =>
      request<NotexFile>(
        config,
        fetchImpl,
        "POST",
        `/api/v1/organizations/${enc(organizationId)}/contexts/${enc(contextId)}/files`,
        file,
      ),

    /** Used only for best-effort rollback of a Question just created by notex_save_answer when
     * its Answer write then fails — never exposed as its own MCP tool (§2.4/§9: no delete tool). */
    deleteContext: (organizationId: string, id: string) =>
      request<{ success: true }>(config, fetchImpl, "DELETE", `/api/v1/organizations/${enc(organizationId)}/contexts/${enc(id)}`),
  }
}

export type NotexClient = ReturnType<typeof createNotexClient>
