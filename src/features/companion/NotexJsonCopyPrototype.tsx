// PROTOTYPE — TBR-89. Throwaway. Three variants answering: how should a user get
// organizationId/projectId/repositoryId onto their clipboard for .notex/notex.json?
// Switchable via ?variant= on the existing repo graph page. See the Linear issue for the
// verdict and the throwaway branch this lives on once a shape is chosen.
//
// - A: three individual labeled copy rows, in their own card below "Connect companion".
// - B: one "copy snippet" button, merged into the Connect companion / checkout-binding card.
// - C: hybrid — one primary "copy snippet" button with individual ids behind a disclosure,
//      in their own card.

import { useEffect, useState } from "react"
import { RiCheckLine, RiFileCopyLine } from "@remixicon/react"

import { Button } from "@/components/ui/button"

export type NotexJsonVariant = "A" | "B" | "C"

export const NOTEX_JSON_VARIANTS: ReadonlyArray<NotexJsonVariant> = ["A", "B", "C"]

export const NOTEX_JSON_VARIANT_LABELS: Record<NotexJsonVariant, string> = {
  A: "Individual ids, separate card",
  B: "Combined snippet, merged into Connect companion",
  C: "Hybrid — snippet + expandable ids",
}

export type Ids = {
  organizationId: string
  projectId: string
  repositoryId: string
}

function buildSnippet(ids: Ids) {
  return JSON.stringify(
    {
      organizationId: ids.organizationId,
      projectId: ids.projectId,
      repositoryId: ids.repositoryId,
      apiKey: "",
    },
    null,
    2
  )
}

function useCopy() {
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState(false)

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setError(false)
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      setError(true)
    }
  }

  return { copied, error, copy }
}

function IdRow({ label, value }: { label: string; value: string }) {
  const { copied, error, copy } = useCopy()
  return (
    <div className="flex items-center justify-between gap-3 py-2">
      <div className="min-w-0">
        <p className="text-[10px] font-semibold tracking-wide text-muted-foreground uppercase">
          {label}
        </p>
        <p className="truncate font-mono text-xs">{value}</p>
      </div>
      <Button
        size="icon"
        variant="outline"
        onClick={() => void copy(value)}
        aria-label={`Copy ${label}`}
      >
        {copied ? (
          <RiCheckLine className="size-4 text-primary" />
        ) : (
          <RiFileCopyLine className="size-4" />
        )}
      </Button>
      {error && (
        <p role="alert" className="sr-only">
          Could not copy {label}.
        </p>
      )}
    </div>
  )
}

const MCP_DOC_LINK_TEXT = "Settings → API keys"

export function NotexJsonVariantA({ ids }: { ids: Ids }) {
  return (
    <div className="mb-8 rounded-xl border bg-card p-5">
      <h2 className="mb-1 text-xs font-semibold tracking-widest text-muted-foreground uppercase">
        MCP setup — .notex/notex.json
      </h2>
      <p className="mb-3 text-xs text-muted-foreground">
        Copy each id into your checkout&apos;s{" "}
        <code className="rounded bg-muted px-1 py-0.5 font-mono">.notex/notex.json</code>. The
        API key comes from a separate step: {MCP_DOC_LINK_TEXT}.
      </p>
      <div className="divide-y rounded-lg border px-3">
        <IdRow label="Organization ID" value={ids.organizationId} />
        <IdRow label="Project ID" value={ids.projectId} />
        <IdRow label="Repository ID" value={ids.repositoryId} />
      </div>
    </div>
  )
}

/** Rendered inside the existing Connect-companion / checkout-binding card, not in a card of
 * its own — this is the "merged" placement candidate for question 2. */
export function NotexJsonVariantBSlot({ ids }: { ids: Ids }) {
  const { copied, error, copy } = useCopy()
  const snippet = buildSnippet(ids)

  return (
    <div className="mt-4 border-t pt-4">
      <p className="mb-2 text-xs text-muted-foreground">
        Setting up MCP by hand? Copy a starter{" "}
        <code className="rounded bg-muted px-1 py-0.5 font-mono">.notex/notex.json</code> —
        add your API key from Settings → API keys after pasting.
      </p>
      <Button size="sm" variant="outline" onClick={() => void copy(snippet)}>
        {copied ? "Copied" : "Copy .notex/notex.json snippet"}
      </Button>
      {error && (
        <p role="alert" className="mt-2 text-xs text-destructive">
          Could not copy automatically — select and copy manually.
        </p>
      )}
    </div>
  )
}

export function NotexJsonVariantC({ ids }: { ids: Ids }) {
  const [expanded, setExpanded] = useState(false)
  const { copied, error, copy } = useCopy()
  const snippet = buildSnippet(ids)

  return (
    <div className="mb-8 rounded-xl border bg-card p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-xs font-semibold tracking-widest text-muted-foreground uppercase">
            .notex/notex.json
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            For your MCP setup. The API key comes from a separate step: {MCP_DOC_LINK_TEXT}.
          </p>
        </div>
        <Button size="sm" onClick={() => void copy(snippet)} className="shrink-0">
          {copied ? "Copied" : "Copy snippet"}
        </Button>
      </div>
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="mt-3 text-xs font-medium text-muted-foreground underline hover:text-foreground"
      >
        {expanded ? "Hide" : "Show"} individual ids
      </button>
      {expanded && (
        <div className="mt-2 divide-y rounded-lg border px-3">
          <IdRow label="Organization ID" value={ids.organizationId} />
          <IdRow label="Project ID" value={ids.projectId} />
          <IdRow label="Repository ID" value={ids.repositoryId} />
        </div>
      )}
      {error && (
        <p role="alert" className="mt-2 text-xs text-destructive">
          Could not copy automatically — select and copy manually.
        </p>
      )}
    </div>
  )
}

/** Floating bottom-centre switcher, shared by every UI prototype in this repo. Hidden in
 * production builds so a stray merge to main can't ship it to users. */
export function PrototypeSwitcher<TVariant extends string>({
  variants,
  labels,
  current,
  onChange,
}: {
  variants: ReadonlyArray<TVariant>
  labels: Record<TVariant, string>
  current: TVariant
  onChange: (v: TVariant) => void
}) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        return
      }
      const idx = variants.indexOf(current)
      if (e.key === "ArrowLeft") {
        onChange(variants[(idx - 1 + variants.length) % variants.length]!)
      } else if (e.key === "ArrowRight") {
        onChange(variants[(idx + 1) % variants.length]!)
      }
    }
    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
  }, [variants, current, onChange])

  if (import.meta.env.PROD) return null

  const idx = variants.indexOf(current)
  const cycle = (dir: 1 | -1) => onChange(variants[(idx + dir + variants.length) % variants.length]!)

  return (
    <div className="fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-full border bg-foreground px-4 py-2 text-background shadow-lg">
      <button
        type="button"
        onClick={() => cycle(-1)}
        aria-label="Previous variant"
        className="text-base leading-none"
      >
        ←
      </button>
      <span className="text-xs font-medium whitespace-nowrap">
        {current} — {labels[current]}
      </span>
      <button
        type="button"
        onClick={() => cycle(1)}
        aria-label="Next variant"
        className="text-base leading-none"
      >
        →
      </button>
    </div>
  )
}
