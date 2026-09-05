// PROTOTYPE — TBR-137 ("Browser instance-picker UI"). Throwaway, not for production.
//
// Three radically different takes on presenting the hub's registered-instance list
// (TBR-135's `GET /v1/instances`) and the one-click switch action (`POST /v1/switch`) on
// the Repository graph page, next to the real ConnectionSection above. In the real
// implementation, whichever variant wins REPLACES/EXTENDS ConnectionSection's non-connected
// branch above — it doesn't render as a second block below it. Rendered here as an addition
// only so this stays a small diff on top of the real page rather than a rewrite of it.
//
// Switch via `?variant=A|B|C` in the URL, or the floating bar's arrows. Force a stub outcome
// (success / one of TBR-135's error codes) via the bar's dropdown before clicking a row's
// switch button.

import { useState } from "react"
import {
  RiArrowLeftSLine,
  RiArrowRightSLine,
  RiCheckLine,
  RiErrorWarningLine,
  RiLoader4Line,
} from "@remixicon/react"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

// ---- Stub data + stub backend (TBR-135's shapes, no real network call) --------------------

type PrototypeInstance = {
  instanceId: string
  checkoutPath: string
  port: number
  role: "hub" | "satellite"
  registeredAt: string
  lastHeartbeatAt: string
  gitRemote: string | null
  headSha: string | null
  link: { organizationId: string; projectId: string; repositoryId: string } | null
}

function makeInstances(currentRepositoryId: string): Array<PrototypeInstance> {
  return [
    {
      instanceId: "inst-hub-a1",
      checkoutPath: "/Users/dev/repo/notex",
      port: 7717,
      role: "hub",
      registeredAt: "2026-09-04T09:12:00Z",
      lastHeartbeatAt: "2026-09-05T10:03:12Z",
      gitRemote: "git@github.com:acme/notex.git",
      headSha: "9103a5a2c1e4",
      link: { organizationId: "org_1", projectId: "proj_1", repositoryId: currentRepositoryId },
    },
    {
      instanceId: "inst-sat-b2",
      checkoutPath: "/Users/dev/repo/billing-service",
      port: 51234,
      role: "satellite",
      registeredAt: "2026-09-05T08:41:00Z",
      lastHeartbeatAt: "2026-09-05T10:03:05Z",
      gitRemote: "git@github.com:acme/billing-service.git",
      headSha: "e6c1b3db61e2",
      link: { organizationId: "org_1", projectId: "proj_2", repositoryId: "repo_billing" },
    },
    {
      instanceId: "inst-sat-c3",
      checkoutPath: "/Users/dev/repo/growth-experiments",
      port: 51890,
      role: "satellite",
      registeredAt: "2026-09-05T09:58:00Z",
      lastHeartbeatAt: "2026-09-05T10:03:09Z",
      gitRemote: "git@github.com:acme/growth-experiments.git",
      headSha: null,
      link: null, // "Project B" from the original ask — running, never linked
    },
  ]
}

type StubOutcome = "success" | "satellite_not_registered" | "hub_key_required" | "forbidden" | "write_failed"

const OUTCOME_LABEL: Record<StubOutcome, string> = {
  success: "success",
  satellite_not_registered: "satellite_not_registered (404)",
  hub_key_required: "hub_key_required (428)",
  forbidden: "forbidden (Notex API)",
  write_failed: "write_failed (500)",
}

const OUTCOME_MESSAGE: Record<Exclude<StubOutcome, "success">, string> = {
  satellite_not_registered:
    "That checkout isn't registered with the hub anymore — it may have quit. Refresh the list.",
  hub_key_required:
    "The hub doesn't have an apiKey to link with yet — add one from Settings → API keys.",
  forbidden:
    "That apiKey's owner doesn't hold a Grant on this Project — check Settings → API keys.",
  write_failed:
    "Couldn't write .notex/notex.json in that checkout. Check the companion's own logs.",
}

function useSwitchStub(forcedOutcome: StubOutcome) {
  const [pendingId, setPendingId] = useState<string | null>(null)
  const [result, setResult] = useState<{ instanceId: string; outcome: StubOutcome } | null>(null)

  async function switchTo(instanceId: string) {
    setPendingId(instanceId)
    setResult(null)
    await new Promise((r) => setTimeout(r, 700))
    setPendingId(null)
    setResult({ instanceId, outcome: forcedOutcome })
  }

  return { switchTo, pendingId, result }
}

function RoleBadge({ role }: { role: PrototypeInstance["role"] }) {
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

function LinkBadge({ link, isCurrent }: { link: PrototypeInstance["link"]; isCurrent: boolean }) {
  if (isCurrent)
    return (
      <span className="rounded-full bg-green-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-green-700 dark:text-green-400">
        this Repository
      </span>
    )
  if (!link)
    return (
      <span className="rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700 dark:text-amber-400">
        unlinked
      </span>
    )
  return (
    <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
      linked elsewhere
    </span>
  )
}

function OutcomeLine({ instanceId, pendingId, result }: {
  instanceId: string
  pendingId: string | null
  result: { instanceId: string; outcome: StubOutcome } | null
}) {
  if (pendingId === instanceId)
    return (
      <p className="mt-1.5 flex items-center gap-1 text-xs text-muted-foreground">
        <RiLoader4Line className="size-3.5 animate-spin" /> Switching…
      </p>
    )
  if (result?.instanceId === instanceId) {
    if (result.outcome === "success")
      return (
        <p className="mt-1.5 flex items-center gap-1 text-xs text-green-700 dark:text-green-400">
          <RiCheckLine className="size-3.5" /> Switched — this Repository now uses that checkout.
        </p>
      )
    return (
      <p className="mt-1.5 flex items-center gap-1 text-xs text-destructive">
        <RiErrorWarningLine className="size-3.5 shrink-0" /> {OUTCOME_MESSAGE[result.outcome]}
      </p>
    )
  }
  return null
}

// ---- Variant A — secondary disclosure inline in the existing notice card -----------------

function VariantA({
  instances,
  currentRepositoryId,
  forcedOutcome,
}: {
  instances: Array<PrototypeInstance>
  currentRepositoryId: string
  forcedOutcome: StubOutcome
}) {
  const [expanded, setExpanded] = useState(false)
  const { switchTo, pendingId, result } = useSwitchStub(forcedOutcome)
  const others = instances.filter((i) => i.link?.repositoryId !== currentRepositoryId)

  return (
    <div className="rounded-xl border bg-card p-5">
      <p className="text-sm">No companion connected for this Repository.</p>
      <div className="mt-4 flex items-center gap-3">
        <Button size="sm">Connect companion</Button>
        {others.length > 0 && (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="text-xs font-medium text-muted-foreground underline hover:text-foreground"
          >
            {expanded ? "Hide" : `Or switch from ${others.length} running checkout${others.length === 1 ? "" : "s"} ▾`}
          </button>
        )}
      </div>
      {expanded && (
        <div className="mt-3 divide-y rounded-lg border px-3">
          {others.map((inst) => (
            <div key={inst.instanceId} className="flex items-center justify-between gap-3 py-2.5">
              <div className="min-w-0">
                <p className="truncate font-mono text-xs">{inst.checkoutPath}</p>
                <div className="mt-1 flex items-center gap-1.5">
                  <RoleBadge role={inst.role} />
                  <LinkBadge link={inst.link} isCurrent={false} />
                </div>
                <OutcomeLine instanceId={inst.instanceId} pendingId={pendingId} result={result} />
              </div>
              <Button
                size="sm"
                variant="outline"
                disabled={pendingId !== null}
                onClick={() => void switchTo(inst.instanceId)}
              >
                Use this
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ---- Variant B — instance list is primary, manual pairing demoted -----------------------

function VariantB({
  instances,
  currentRepositoryId,
  forcedOutcome,
}: {
  instances: Array<PrototypeInstance>
  currentRepositoryId: string
  forcedOutcome: StubOutcome
}) {
  const { switchTo, pendingId, result } = useSwitchStub(forcedOutcome)

  return (
    <div className="rounded-xl border bg-card p-5">
      <h2 className="mb-1 text-xs font-semibold tracking-widest text-muted-foreground uppercase">
        Companion instances on this machine
      </h2>
      <p className="mb-3 text-xs text-muted-foreground">
        Pick a running checkout to serve this Repository's graph.
      </p>
      <div className="divide-y rounded-lg border px-3">
        {instances.map((inst) => {
          const isCurrent = inst.link?.repositoryId === currentRepositoryId
          return (
            <div key={inst.instanceId} className="flex items-center justify-between gap-3 py-2.5">
              <div className="min-w-0">
                <p className="truncate font-mono text-xs">{inst.checkoutPath}</p>
                <div className="mt-1 flex items-center gap-1.5">
                  <RoleBadge role={inst.role} />
                  <LinkBadge link={inst.link} isCurrent={isCurrent} />
                </div>
                <OutcomeLine instanceId={inst.instanceId} pendingId={pendingId} result={result} />
              </div>
              <Button
                size="sm"
                variant={isCurrent ? "outline" : "default"}
                disabled={isCurrent || pendingId !== null}
                onClick={() => void switchTo(inst.instanceId)}
              >
                {isCurrent ? "Current" : "Connect this checkout"}
              </Button>
            </div>
          )
        })}
      </div>
      <button
        type="button"
        className="mt-3 text-xs font-medium text-muted-foreground underline hover:text-foreground"
      >
        Or pair a new companion manually
      </button>
    </div>
  )
}

// ---- Variant C — separate persistent table, existing notice card left untouched ----------

function VariantC({
  instances,
  currentRepositoryId,
  forcedOutcome,
}: {
  instances: Array<PrototypeInstance>
  currentRepositoryId: string
  forcedOutcome: StubOutcome
}) {
  const { switchTo, pendingId, result } = useSwitchStub(forcedOutcome)

  return (
    <div className="rounded-xl border bg-card p-5">
      <h2 className="mb-3 text-xs font-semibold tracking-widest text-muted-foreground uppercase">
        Companion instances
      </h2>
      <table className="w-full text-left text-xs">
        <thead>
          <tr className="text-[10px] text-muted-foreground uppercase">
            <th className="pb-2 font-semibold">Checkout</th>
            <th className="pb-2 font-semibold">Role</th>
            <th className="pb-2 font-semibold">Linked</th>
            <th className="pb-2 font-semibold">Last seen</th>
            <th className="pb-2" />
          </tr>
        </thead>
        <tbody className="divide-y">
          {instances.map((inst) => {
            const isCurrent = inst.link?.repositoryId === currentRepositoryId
            return (
              <tr key={inst.instanceId}>
                <td className="max-w-40 truncate py-2 font-mono">{inst.checkoutPath}</td>
                <td className="py-2">
                  <RoleBadge role={inst.role} />
                </td>
                <td className="py-2">
                  <LinkBadge link={inst.link} isCurrent={isCurrent} />
                </td>
                <td className="py-2 text-muted-foreground">
                  {new Date(inst.lastHeartbeatAt).toLocaleTimeString("en-US")}
                </td>
                <td className="py-2 text-right">
                  <Button
                    size="xs"
                    variant={isCurrent ? "outline" : "default"}
                    disabled={isCurrent || pendingId !== null}
                    onClick={() => void switchTo(inst.instanceId)}
                  >
                    {isCurrent ? "Current" : "Switch here"}
                  </Button>
                  <div className="mt-1">
                    <OutcomeLine instanceId={inst.instanceId} pendingId={pendingId} result={result} />
                  </div>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// ---- Switcher bar (dev-only) ---------------------------------------------------------------

const VARIANTS = ["A", "B", "C"] as const
type VariantKey = (typeof VARIANTS)[number]
const VARIANT_NAMES: Record<VariantKey, string> = {
  A: "Secondary disclosure",
  B: "List is primary",
  C: "Persistent table",
}

function readVariantFromUrl(): VariantKey {
  const v = new URLSearchParams(window.location.search).get("variant")
  return v === "A" || v === "B" || v === "C" ? v : "A"
}

function PrototypeBar({
  variant,
  setVariant,
  forcedOutcome,
  setForcedOutcome,
}: {
  variant: VariantKey
  setVariant: (v: VariantKey) => void
  forcedOutcome: StubOutcome
  setForcedOutcome: (o: StubOutcome) => void
}) {
  function cycle(dir: 1 | -1) {
    const i = VARIANTS.indexOf(variant)
    const next = VARIANTS[(i + dir + VARIANTS.length) % VARIANTS.length] ?? VARIANTS[0]
    setVariant(next)
    const url = new URL(window.location.href)
    url.searchParams.set("variant", next)
    window.history.replaceState(null, "", url.toString())
  }

  return (
    <div className="fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-full border bg-foreground px-4 py-2 text-background shadow-lg">
      <button aria-label="Previous variant" onClick={() => cycle(-1)}>
        <RiArrowLeftSLine className="size-4" />
      </button>
      <span className="text-xs font-medium whitespace-nowrap">
        {variant} — {VARIANT_NAMES[variant]}
      </span>
      <button aria-label="Next variant" onClick={() => cycle(1)}>
        <RiArrowRightSLine className="size-4" />
      </button>
      <span className="mx-1 h-4 w-px bg-background/30" />
      <select
        value={forcedOutcome}
        onChange={(e) => setForcedOutcome(e.target.value as StubOutcome)}
        className="rounded bg-background/10 px-1.5 py-0.5 text-xs"
      >
        {(Object.keys(OUTCOME_LABEL) as Array<StubOutcome>).map((o) => (
          <option key={o} value={o} className="text-foreground">
            {OUTCOME_LABEL[o]}
          </option>
        ))}
      </select>
    </div>
  )
}

// ---- Entry point ----------------------------------------------------------------------

export function InstancePickerPrototype({ repositoryId }: { repositoryId: string }) {
  const [variant, setVariant] = useState<VariantKey>(readVariantFromUrl)
  const [forcedOutcome, setForcedOutcome] = useState<StubOutcome>("success")
  const instances = makeInstances(repositoryId)

  if (process.env.NODE_ENV === "production") return null

  return (
    <div className="mt-4 space-y-1.5">
      <p className="text-[10px] font-semibold tracking-wide text-amber-600 uppercase dark:text-amber-400">
        Prototype — TBR-137, not real data
      </p>
      {variant === "A" && (
        <VariantA instances={instances} currentRepositoryId={repositoryId} forcedOutcome={forcedOutcome} />
      )}
      {variant === "B" && (
        <VariantB instances={instances} currentRepositoryId={repositoryId} forcedOutcome={forcedOutcome} />
      )}
      {variant === "C" && (
        <VariantC instances={instances} currentRepositoryId={repositoryId} forcedOutcome={forcedOutcome} />
      )}
      <PrototypeBar
        variant={variant}
        setVariant={setVariant}
        forcedOutcome={forcedOutcome}
        setForcedOutcome={setForcedOutcome}
      />
    </div>
  )
}
