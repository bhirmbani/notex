// The graph page's "Connect companion" flow (graph-gui.md §5). The permission prompt only
// ever fires from here (ADR-0004) — never from a Question. Four entry modes share this one
// component because they share the same real network call (connectAttempt.ts):
//
// - `pair`      unpaired: explainer -> paste the startup pairing line -> preview -> confirm
//               the checkout binding -> persist.
// - `reconnect` needs-permission: pairing already exists; explainer -> re-attempt with the
//               stored pairing (this is the fetch that shows the browser's native prompt) ->
//               connected directly, no new binding to confirm.
// - `repair` (reason: "unauthorized")  the stored token was rejected — permission is already
//               granted, so no explainer; straight to paste a fresh line -> preview -> confirm.
// - `repair` (reason: "mismatched")    the stored token still works, only the checkout
//               differs (graph-gui.md §5.3 row 8: "Re-confirm the binding OR re-pair") ->
//               re-attempt with the existing pairing first -> straight to confirm on success;
//               only falls back to pasting a new line if that attempt turns out unauthorized.
//
// A definite 401 always routes to the paste form, regardless of mode or how we got here —
// the stored token is confirmed bad, so re-pasting is the only productive next step.

import { useState } from "react"

import { attemptConnect } from "./connectAttempt"
import { confirmPairing } from "./pairingFlow"
import { parsePairingLine } from "./pairing"
import type { ConnectAttemptFailure } from "./connectAttempt"
import type { PairingRecord } from "./types"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"

type Mode = "pair" | "reconnect" | "repair"
type RepairReason = "unauthorized" | "mismatched"

type Props = {
  repositoryId: string
  mode: Mode
  /** Required when `mode` is `"repair"`. */
  repairReason?: RepairReason
  /** Required for `reconnect`, and for `repair` with reason `"mismatched"`. */
  existingPairing?: PairingRecord | null
  onConnected: () => void
  onCancel: () => void
}

type Step =
  | "explainer"
  | "recheck"
  | "paste"
  | "attempting"
  | "confirm"
  | "failed"

/** Failures that never resolve into the paste form — `unauthorized` is handled separately. */
type TerminalFailure = Exclude<ConnectAttemptFailure, "unauthorized">

const FAILURE_COPY: Record<TerminalFailure, string> = {
  blocked:
    "Local network access is blocked for this site. Notex can't ask again — clear it in your browser's site settings, then retry.",
  unreachable:
    "Companion isn't running. Start it with `npx notex-companion` in your checkout, then retry.",
  outdated:
    "This companion is too old for Notex. Update with `npm i -g notex-companion`, then retry.",
}

function initialStep(mode: Mode, repairReason: RepairReason | undefined): Step {
  if (mode === "repair")
    return repairReason === "mismatched" ? "recheck" : "paste"
  return "explainer"
}

export function ConnectFlow({
  repositoryId,
  mode,
  repairReason,
  existingPairing,
  onConnected,
  onCancel,
}: Props) {
  const [step, setStep] = useState<Step>(() => initialStep(mode, repairReason))
  const [pastedLine, setPastedLine] = useState("")
  const [parseError, setParseError] = useState<string | null>(null)
  const [parsed, setParsed] = useState<{
    baseUrl: string
    token: string
  } | null>(null)
  const [statusPreview, setStatusPreview] = useState<{
    checkoutPath: string
    headSha: string | null
    nodeCount: number
    edgeCount: number
  } | null>(null)
  const [failure, setFailure] = useState<TerminalFailure | null>(null)

  /** Whether a successful attempt should land on `confirm` (a new/changed binding) or go
   *  straight to `connected` (reconnecting an already-confirmed one). */
  async function runAttempt(
    baseUrl: string,
    token: string,
    skipConfirm: boolean
  ) {
    setStep("attempting")
    setFailure(null)
    setParsed({ baseUrl, token })
    const result = await attemptConnect(baseUrl, token)

    if (!result.ok) {
      if (result.failure === "unauthorized") {
        setParseError(
          "The pairing token was rejected. Paste a fresh line from the companion's startup output."
        )
        setStep("paste")
        return
      }
      setFailure(result.failure)
      setStep("failed")
      return
    }

    if (skipConfirm) {
      onConnected()
      return
    }

    setStatusPreview({
      checkoutPath: result.status.graph.checkoutPath,
      headSha: result.status.graph.headSha,
      nodeCount: result.status.graph.nodeCount,
      edgeCount: result.status.graph.edgeCount,
    })
    setStep("confirm")
  }

  function handlePasteSubmit(e: React.FormEvent) {
    e.preventDefault()
    const line = parsePairingLine(pastedLine)
    if (!line) {
      setParseError(
        "That doesn't look like a companion pairing line. It should look like http://127.0.0.1:7717/#token=..."
      )
      return
    }
    setParseError(null)
    void runAttempt(line.baseUrl, line.token, false)
  }

  function handleConfirmBinding() {
    if (!parsed || !statusPreview) return
    confirmPairing(repositoryId, {
      baseUrl: parsed.baseUrl,
      token: parsed.token,
      checkoutPath: statusPreview.checkoutPath,
    })
    onConnected()
  }

  function retryLastAttempt() {
    if (parsed)
      void runAttempt(parsed.baseUrl, parsed.token, mode === "reconnect")
    else if (existingPairing)
      void runAttempt(
        existingPairing.baseUrl,
        existingPairing.token,
        mode === "reconnect"
      )
    else setStep(initialStep(mode, repairReason))
  }

  return (
    <div className="rounded-xl border bg-card p-5">
      {step === "explainer" && (
        <div className="space-y-4">
          <div className="space-y-2">
            <h3 className="text-sm font-semibold">Connect your companion</h3>
            <p className="text-sm text-muted-foreground">
              Your browser will ask for permission to{" "}
              <em>
                &quot;look for and connect to any device on your local
                network.&quot;
              </em>{" "}
              That wording is Chrome&apos;s, and it&apos;s broader than what
              happens: Notex talks to{" "}
              <code className="rounded bg-muted px-1 py-0.5 text-xs">
                127.0.0.1:7717
              </code>{" "}
              on this machine and nothing else. No scanning, no other addresses.
            </p>
            <p className="text-sm text-muted-foreground">
              Requires Chrome 142+ or Firefox 151+.{" "}
              <strong>If you deny it, the block sticks</strong> — clearing it
              means resetting site permissions in your browser settings.
            </p>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={onCancel}>
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={() => {
                if (mode === "reconnect" && existingPairing) {
                  void runAttempt(
                    existingPairing.baseUrl,
                    existingPairing.token,
                    true
                  )
                } else {
                  setStep("paste")
                }
              }}
            >
              Continue
            </Button>
          </div>
        </div>
      )}

      {step === "recheck" && (
        <div className="space-y-4">
          <p className="text-sm">
            This companion is reporting a different checkout than the one bound
            to this Repository. Re-check it, or pair a different companion
            instead.
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={onCancel}>
              Cancel
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setStep("paste")}
            >
              Paste a different line
            </Button>
            <Button
              size="sm"
              onClick={() => {
                if (existingPairing)
                  void runAttempt(
                    existingPairing.baseUrl,
                    existingPairing.token,
                    false
                  )
              }}
            >
              Re-check this checkout
            </Button>
          </div>
        </div>
      )}

      {step === "paste" && (
        <form onSubmit={handlePasteSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="pairing-line" className="text-xs">
              Pairing line
            </Label>
            <p className="text-xs text-muted-foreground">
              Paste the line the companion printed at startup —{" "}
              <code className="rounded bg-muted px-1 py-0.5">
                http://127.0.0.1:7717/#token=...
              </code>
            </p>
            <Textarea
              id="pairing-line"
              value={pastedLine}
              onChange={(e) => setPastedLine(e.target.value)}
              placeholder="http://127.0.0.1:7717/#token=..."
              autoFocus
              rows={2}
              className="font-mono text-xs"
            />
            {parseError && (
              <p className="text-xs text-destructive">{parseError}</p>
            )}
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={!pastedLine.trim()}>
              Continue
            </Button>
          </div>
        </form>
      )}

      {step === "attempting" && (
        <p className="text-sm text-muted-foreground">Connecting…</p>
      )}

      {step === "failed" && failure && (
        <div className="space-y-4">
          <p className="text-sm text-destructive">{FAILURE_COPY[failure]}</p>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={onCancel}>
              Close
            </Button>
            <Button size="sm" onClick={retryLastAttempt}>
              Retry
            </Button>
          </div>
        </div>
      )}

      {step === "confirm" && statusPreview && (
        <div className="space-y-4">
          <div className="space-y-1">
            <h3 className="text-sm font-semibold">Confirm this checkout</h3>
            <p className="text-xs text-muted-foreground">
              The companion reports the following. Confirm it&apos;s the
              checkout for this Repository.
            </p>
          </div>
          <dl className="space-y-1.5 rounded-lg border bg-muted/30 p-3 text-xs">
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">Checkout path</dt>
              <dd className="truncate font-mono">
                {statusPreview.checkoutPath}
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">HEAD</dt>
              <dd className="font-mono">
                {statusPreview.headSha
                  ? statusPreview.headSha.slice(0, 7)
                  : "not a git checkout"}
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">Graph</dt>
              <dd>
                {statusPreview.nodeCount} nodes · {statusPreview.edgeCount}{" "}
                edges
              </dd>
            </div>
          </dl>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={onCancel}>
              Cancel
            </Button>
            <Button size="sm" onClick={handleConfirmBinding}>
              Confirm binding
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
