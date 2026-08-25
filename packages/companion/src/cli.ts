// The published `notex-companion` bin (TBR-66). Dispatches the two entry points
// docs/specs/notex-mcp-server.md §1 and companion-api.md describe as one command each:
//
//   notex-companion [serve] [options]   Start the loopback HTTP server (default)
//   notex-companion mcp                 Start the stdio MCP server (stub until TBR-69)
//
// `main()` here is invoked from `bin.ts`, not from this file — npm installs `bin` targets as
// symlinks, and an "am I the entry point" check comparing `process.argv[1]` (the invoked,
// still-symlinked path) against `import.meta.url` (which Node resolves through the symlink to
// the real path) reliably disagrees, silently skipping the invocation. Splitting the runnable
// entry into its own file sidesteps that class of bug rather than trying to out-clever it.

import { existsSync } from "node:fs"
import { resolve } from "node:path"
import { serve } from "./serve.ts"
import { startMcpStub } from "./mcp.ts"

const HELP = `notex-companion — local retrieval companion over a checkout's graphify-out/graph.json

Usage:
  notex-companion [serve] [options]   Start the loopback HTTP server (default command)
  notex-companion mcp                 Start the stdio MCP server

Options for serve:
  --port <n>       Port to bind (default 7717)
  --origin <url>   Additional allowed CORS origin, beyond the built-in defaults. Repeatable.
  --rotate-token   Generate a new pairing token, invalidating the old one
  -h, --help       Show this message
`

/** Thrown by argument parsing on bad input — `main()` turns it into a stderr message + exit 1. */
export class CliUsageError extends Error {}

export type ServeArgs = { port: number | undefined; origins: Array<string>; rotateToken: boolean }

export function parseServeArgs(args: Array<string>): ServeArgs {
  const origins: Array<string> = []
  let port: number | undefined
  let rotateToken = false

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    switch (arg) {
      case "--port": {
        const value = args[++i]
        const parsed = value === undefined ? NaN : Number(value)
        if (!Number.isInteger(parsed) || parsed < 0 || parsed > 65535) {
          throw new CliUsageError(`--port needs an integer between 0 and 65535, got ${value ?? "(nothing)"}`)
        }
        port = parsed
        break
      }
      case "--origin": {
        const value = args[++i]
        if (!value) throw new CliUsageError("--origin needs a value")
        origins.push(value)
        break
      }
      case "--rotate-token":
        rotateToken = true
        break
      default:
        throw new CliUsageError(`unrecognised option "${arg}"`)
    }
  }

  return { port, origins, rotateToken }
}

function runServe(args: Array<string>): void {
  const { port, origins, rotateToken } = parseServeArgs(args)
  const checkoutPath = process.cwd()
  const graphPath = resolve(checkoutPath, "graphify-out/graph.json")

  if (!existsSync(graphPath)) {
    console.error(
      `notex-companion: no graphify-out/graph.json found in ${checkoutPath}\n` +
        `Generate a graph for this checkout before running notex-companion.`,
    )
    process.exit(1)
  }

  const handle = serve({
    checkoutPath,
    port,
    origins,
    rotateToken,
    onGraphState: (state) => {
      if (state.kind === "ready") {
        const { stamp } = state.index
        console.log(`graph: ${stamp.nodeCount} nodes, ${stamp.edgeCount} edges, ${stamp.communityCount} communities (built ${stamp.builtAt})`)
      } else if (state.kind === "error") {
        console.error(`notex-companion: graph.json could not be read: ${state.error.message}`)
      }
    },
  })

  console.log(`notex-companion serving ${checkoutPath}`)
  console.log(handle.pairingLine)
}

export function main(argv: Array<string> = process.argv.slice(2)): void {
  const [command, ...rest] = argv

  if (command === "-h" || command === "--help") {
    console.log(HELP)
    return
  }

  try {
    if (command === "mcp") {
      startMcpStub()
    } else if (command === undefined || command === "serve" || command.startsWith("-")) {
      runServe(command === "serve" ? rest : argv)
    } else {
      throw new CliUsageError(`unknown command "${command}"`)
    }
  } catch (err) {
    if (err instanceof CliUsageError) {
      console.error(`notex-companion: ${err.message}\n\n${HELP}`)
      process.exit(1)
    }
    throw err
  }
}
