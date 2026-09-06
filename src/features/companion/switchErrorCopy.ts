// The instance-picker's per-error-code copy (TBR-143's satellite_not_registered/
// hub_key_required/write_failed, plus hub_key_required's Notex-API-validation counterparts
// unauthorized/forbidden/not_found — TBR-144). Mirrors stateNotice.ts's own pattern: a pure,
// unit-tested lookup in this app's developer-direct tone (graph-gui.md §5.2) — not the
// companion's own OpError text forwarded verbatim, which is aimed at whatever called the REST
// op directly (a CLI, an MCP host: e.g. hub_key_required's server message literally reads "call
// POST /v1/hub-key first"), not a person reading a browser panel.

export type SwitchErrorCopy = {
  message: string
  /** "hub-key" renders the inline apiKey form (this error's fix is a corrected/new key);
   * "retry" offers a plain retry button. */
  action: "hub-key" | "retry"
}

const KNOWN_CODES: Record<string, SwitchErrorCopy> = {
  satellite_not_registered: {
    message: "That checkout isn't registered with the hub anymore — it may have quit. Refresh the page and try again.",
    action: "retry",
  },
  hub_key_required: {
    message: "The hub doesn't have a Notex API key yet to link this checkout with.",
    action: "hub-key",
  },
  unauthorized: {
    message: "Notex rejected the hub's API key. Generate a new one and enter it below.",
    action: "hub-key",
  },
  forbidden: {
    message: "That API key's owner doesn't hold a Grant on this Project.",
    action: "hub-key",
  },
  not_found: {
    message: "Notex couldn't find a matching repository for this binding — check the ids from Notex Settings.",
    action: "retry",
  },
  write_failed: {
    message: "Couldn't write .notex/notex.json in that checkout. Check the companion's own logs.",
    action: "retry",
  },
}

const FALLBACK: SwitchErrorCopy = { message: "Couldn't switch to that checkout.", action: "retry" }

export function switchErrorCopy(code: string | null): SwitchErrorCopy {
  if (!code) return FALLBACK
  return KNOWN_CODES[code] ?? FALLBACK
}
