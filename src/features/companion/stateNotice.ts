// The eight states' user-facing copy, verbatim from graph-gui.md §5.3 / companion-api.md §6.
// Pulled out of the graph page as a pure lookup so the copy itself is unit-testable.

import type { ConnectionResult } from "./connectionState"

export type StateNotice = {
  message: string
  /** Whether the graph page should offer a "Connect companion" / re-pair CTA for this state. */
  cta: "connect" | "reconnect" | "repair" | "retry" | "none"
}

export function stateNotice(result: ConnectionResult): StateNotice {
  switch (result.state) {
    case "unsupported":
      return {
        message:
          "Safari and Brave can't reach a local companion. Graph features need Chrome 142+ or Firefox 151+.",
        cta: "none",
      }
    case "unpaired":
      return {
        message: "No companion connected for this Repository.",
        cta: "connect",
      }
    case "needs-permission":
      return {
        message:
          "This Repository is paired — your browser still needs to grant local network access.",
        cta: "reconnect",
      }
    case "blocked":
      return {
        message:
          "Local network access is blocked for this site. Notex can't ask again — clear it in your browser's site settings, then retry.",
        cta: "retry",
      }
    case "unreachable":
      return {
        message:
          "Companion isn't running. Start it with `npx notex-companion` in your checkout.",
        cta: "retry",
      }
    case "outdated":
      return {
        message:
          "This companion is too old for Notex. Update with `npm i -g notex-companion`.",
        cta: "retry",
      }
    case "unauthorized":
      return {
        message:
          "The pairing token was rejected. Re-pair with the line the companion prints at startup.",
        cta: "repair",
      }
    case "mismatched":
      return {
        message: `This companion is serving a different checkout (\`${result.checkoutPath}\`). Re-confirm the binding or start the companion in the right directory.`,
        cta: "repair",
      }
    case "connected":
      return { message: "Connected.", cta: "none" }
  }
}
