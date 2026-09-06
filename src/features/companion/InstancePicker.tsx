// Browser one-click switch (TBR-137's Variant B, TBR-139's binding confirmation, wired to the
// real TBR-143 ops — TBR-144). Renders in place of ConnectionSection's plain notice+CTA whenever
// `GET /v1/instances` succeeds against whatever companion this Repository already has paired
// (typically the hub, per TBR-138's shared pairing line) — the caller decides that by only
// rendering this once it has a non-empty instances list; this component owns the picker and the
// per-row switch/confirm/error flow only.
//
// Row click -> confirm panel (using the list's own checkoutPath/gitRemote/headSha, no extra
// fetch) -> "Confirm" calls POST /v1/switch and, on success, persists the direct-handoff
// pairing (confirmPairing, same function ConnectFlow's manual path already uses) plus a
// confirmed-binding record (switchConfirmation.ts) — the switch only completes once confirmed,
// same human gate ADR-0003 already requires of manual pairing. A later click on the *same*
// checkout with an unchanged reported git identity (isSwitchConfirmed) skips straight to the
// switch call, no panel — TBR-139's "skip confirmation silently unless drifted" rule.

import { useState } from "react"
import { Link } from "@tanstack/react-router"
import { RiLoader4Line } from "@remixicon/react"

import { linkMatches } from "notex-companion/client"
import { CompanionRequestError, setHubKey, switchInstance } from "./client"
import { confirmPairing } from "./pairingFlow"
import { computeCheckoutId } from "./checkoutId"
import { isSwitchConfirmed, setConfirmedSwitchBinding } from "./switchConfirmation"
import { switchErrorCopy } from "./switchErrorCopy"
import type { InstanceLink, InstanceSummary } from "notex-companion/client"
import type { PairingRecord } from "./types"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"

type Props = {
  repositoryId: string
  organizationId: string
  projectId: string
  pairing: PairingRecord
  instances: Array<InstanceSummary>
  onSwitched: () => void
  /** Omitted (not just a no-op) by the caller once already `connected` — the fallback link is a
   * bootstrap path into this component in the first place, meaningless when there's already a
   * live connection to switch away from via the list itself. */
  onManualPair?: () => void
}

type Step = "idle" | "confirm" | "switching" | "error"

function RoleBadge({ role }: { role: InstanceSummary["role"] }) {
  return (
    <span
      className={cn(
        "rounded-full px-1.5 py-0.5 text-[10px] font-semibold tracking-wide uppercase",
        role === "hub" ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground"
      )}
    >
      {role}
    </span>
  )
}

function LinkBadge({ link, isCurrent }: { link: InstanceLink; isCurrent: boolean }) {
  if (isCurrent) {
    return (
      <span className="rounded-full bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700 dark:text-emerald-400">
        this Repository
      </span>
    )
  }
  if (!link) {
    return (
      <span className="rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700 dark:text-amber-400">
        unlinked
      </span>
    )
  }
  return (
    <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
      linked elsewhere
    </span>
  )
}

function errorCode(error: unknown): string | null {
  return error instanceof CompanionRequestError ? error.code : null
}

/** Whether `pairing` — this Repository's *actual* live connection — is presently talking to
 * `instance`, distinct from `linkMatches` (whether that instance's own persisted `.notex/
 * notex.json` happens to name this Repository). The two can disagree: a satellite can be
 * correctly linked to this Repository while the browser is still paired directly to the hub
 * (e.g. an earlier manual "Connect companion" paste that self-confirmed against the hub's own
 * checkout). Every `baseUrl` this app ever stores is `http://127.0.0.1:<port>` (pairing.ts's
 * parse, switch.ts's own handoff), so comparing ports is exact — wrapped in try/catch since
 * `pairing` comes from localStorage, which a user can hand-edit into something unparsable. */
function isLiveConnection(pairing: PairingRecord, instance: InstanceSummary): boolean {
  try {
    return new URL(pairing.baseUrl).port === String(instance.port)
  } catch {
    return false
  }
}

export function InstancePicker({
  repositoryId,
  organizationId,
  projectId,
  pairing,
  instances,
  onSwitched,
  onManualPair,
}: Props) {
  const [activeInstanceId, setActiveInstanceId] = useState<string | null>(null)
  const [step, setStep] = useState<Step>("idle")
  const [error, setError] = useState<unknown>(null)
  const [apiKeyInput, setApiKeyInput] = useState("")

  function reset() {
    setActiveInstanceId(null)
    setStep("idle")
    setError(null)
    setApiKeyInput("")
  }

  async function performSwitch(instance: InstanceSummary) {
    setActiveInstanceId(instance.instanceId)
    setStep("switching")
    setError(null)
    try {
      const result = await switchInstance(pairing.baseUrl, pairing.token, {
        instanceId: instance.instanceId,
        organizationId,
        projectId,
        repositoryId,
      })
      confirmPairing(repositoryId, {
        baseUrl: result.baseUrl,
        token: result.token,
        checkoutPath: result.checkoutPath,
      })
      setConfirmedSwitchBinding(repositoryId, {
        checkoutId: computeCheckoutId(result.checkoutPath),
        gitRemote: result.gitRemote,
        headSha: result.headSha,
      })
      reset()
      onSwitched()
    } catch (err) {
      setError(err)
      setStep("error")
    }
  }

  function handleRowClick(instance: InstanceSummary) {
    if (isSwitchConfirmed(repositoryId, instance)) {
      void performSwitch(instance)
      return
    }
    setActiveInstanceId(instance.instanceId)
    setStep("confirm")
    setError(null)
  }

  async function handleSubmitHubKey(e: React.FormEvent, instance: InstanceSummary) {
    e.preventDefault()
    const apiKey = apiKeyInput.trim()
    if (!apiKey) return
    setStep("switching")
    setError(null)
    try {
      await setHubKey(pairing.baseUrl, pairing.token, apiKey)
    } catch (err) {
      setError(err)
      setStep("error")
      return
    }
    setApiKeyInput("")
    await performSwitch(instance)
  }

  return (
    <div className="rounded-xl border bg-card p-5">
      <h2 className="mb-1 text-xs font-semibold tracking-widest text-muted-foreground uppercase">
        Companion instances on this machine
      </h2>
      <p className="mb-3 text-xs text-muted-foreground">
        Pick a running checkout to serve this Repository&apos;s graph.
      </p>
      <div className="divide-y rounded-lg border px-3">
        {instances.map((instance) => {
          const isLinked = linkMatches(instance.link, { organizationId, projectId, repositoryId })
          const isLive = isLiveConnection(pairing, instance)
          // The hub is a broker, never a switch target — switchInstance's registry lookup only
          // ever finds satellites, so a hub row can never do anything but 404. Disabled rather
          // than omitted: seeing it (with its own link/role badges) is still useful context.
          const isHub = instance.role === "hub"
          const isActive = instance.instanceId === activeInstanceId
          const isSwitchingThis = isActive && step === "switching"

          return (
            <div key={instance.instanceId} className="py-2.5">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate font-mono text-xs">{instance.checkoutPath}</p>
                  <div className="mt-1 flex items-center gap-1.5">
                    <RoleBadge role={instance.role} />
                    <LinkBadge link={instance.link} isCurrent={isLinked} />
                  </div>
                </div>
                <Button
                  size="sm"
                  variant={isLive ? "outline" : "default"}
                  disabled={isLive || isHub || (activeInstanceId !== null && !isActive) || isSwitchingThis}
                  title={isHub && !isLive ? "The hub itself can't be a switch target — connect a satellite checkout instead." : undefined}
                  onClick={() => handleRowClick(instance)}
                >
                  {isLive ? (
                    "Current"
                  ) : isHub ? (
                    "Hub"
                  ) : isSwitchingThis ? (
                    <>
                      <RiLoader4Line className="size-3.5 animate-spin" /> Switching…
                    </>
                  ) : (
                    "Connect this checkout"
                  )}
                </Button>
              </div>

              {isActive && step === "confirm" && (
                <div className="mt-2 space-y-2 rounded-lg border bg-muted/30 p-3 text-xs">
                  <dl className="space-y-1">
                    <div className="flex justify-between gap-4">
                      <dt className="text-muted-foreground">Checkout path</dt>
                      <dd className="truncate font-mono">{instance.checkoutPath}</dd>
                    </div>
                    <div className="flex justify-between gap-4">
                      <dt className="text-muted-foreground">Git remote</dt>
                      <dd className="truncate font-mono">{instance.gitRemote ?? "none"}</dd>
                    </div>
                    <div className="flex justify-between gap-4">
                      <dt className="text-muted-foreground">HEAD</dt>
                      <dd className="font-mono">
                        {instance.headSha ? instance.headSha.slice(0, 7) : "not a git checkout"}
                      </dd>
                    </div>
                  </dl>
                  <div className="flex justify-end gap-2">
                    <Button size="xs" variant="ghost" onClick={reset}>
                      Cancel
                    </Button>
                    <Button size="xs" onClick={() => void performSwitch(instance)}>
                      Confirm
                    </Button>
                  </div>
                </div>
              )}

              {isActive && step === "error" && switchErrorCopy(errorCode(error)).action === "hub-key" && (
                <form
                  onSubmit={(e) => void handleSubmitHubKey(e, instance)}
                  className="mt-2 space-y-1.5 rounded-lg border bg-muted/30 p-2.5"
                >
                  <p className="text-xs text-destructive">{switchErrorCopy(errorCode(error)).message}</p>
                  <div className="flex gap-2">
                    <Input
                      value={apiKeyInput}
                      onChange={(e) => setApiKeyInput(e.target.value)}
                      placeholder="Notex API key"
                      type="password"
                      className="h-7 text-xs"
                      autoFocus
                    />
                    <Button type="submit" size="sm" disabled={!apiKeyInput.trim()}>
                      Save &amp; retry
                    </Button>
                  </div>
                  <p className="text-xs">
                    <Link to="/dashboard/settings/api-keys" className="text-muted-foreground underline hover:text-foreground">
                      Get a key from Settings → API keys
                    </Link>
                  </p>
                </form>
              )}

              {isActive && step === "error" && switchErrorCopy(errorCode(error)).action === "retry" && (
                <div className="mt-2 flex items-center gap-2">
                  <p className="text-xs text-destructive">{switchErrorCopy(errorCode(error)).message}</p>
                  <Button size="xs" variant="outline" onClick={() => void performSwitch(instance)}>
                    Retry
                  </Button>
                  <Button size="xs" variant="ghost" onClick={reset}>
                    Cancel
                  </Button>
                </div>
              )}
            </div>
          )
        })}
      </div>
      {onManualPair && (
        <button
          type="button"
          onClick={onManualPair}
          className="mt-3 text-xs font-medium text-muted-foreground underline hover:text-foreground"
        >
          Or pair a new companion manually
        </button>
      )}
    </div>
  )
}
