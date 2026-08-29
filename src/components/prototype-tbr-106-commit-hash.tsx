// PROTOTYPE — TBR-106 "Show the deployed commit hash in the UI"
//
// Question: where should the commit hash live? Three structurally different
// placements, switchable via `?variant=A|B|C` on any /dashboard route (the
// floating bar in the bottom-centre, or the URL directly).
//
// Not wired to the real VITE_COMMIT_SHA build-time value yet — that plumbing
// (scripts/deploy-env.mjs) is unambiguous per the issue and isn't the thing
// being judged here. MOCK_SHA stands in so every variant renders identically.
//
// VERDICT: none of A/B/C won outright. The user picked a fourth placement —
// bottom of the left Sidebar (env + hash, `bottom of the left sidebar` per
// feedback on 2026-08-29) — closest in spirit to Variant A (persistent,
// always-on) but scoped to the sidebar's own footer instead of a full-width
// app shell row. Folded into src/components/Sidebar.tsx on main; this file
// and its two call sites in dashboard/_layout.tsx were dropped from main and
// live only here for reference.

import { useEffect, useState } from 'react'
import { RiInformationLine } from '@remixicon/react'

const MOCK_SHA = 'a1b2c3d'
const VARIANTS = ['A', 'B', 'C'] as const
type Variant = (typeof VARIANTS)[number]

const VARIANT_NAMES: Record<Variant, string> = {
  A: 'Footer bar',
  B: 'Header badge',
  C: 'Wordmark disclosure',
}

function cycleVariant(current: Variant, delta: number): Variant {
  const index = VARIANTS.indexOf(current)
  return VARIANTS[(index + delta + VARIANTS.length) % VARIANTS.length] as Variant
}

function readVariant(): Variant {
  if (typeof window === 'undefined') return 'A'
  const raw = new URLSearchParams(window.location.search).get('variant')
  return (VARIANTS as readonly string[]).includes(raw ?? '') ? (raw as Variant) : 'A'
}

function writeVariant(next: Variant) {
  const url = new URL(window.location.href)
  url.searchParams.set('variant', next)
  window.history.replaceState(null, '', url)
}

// --- Variant A: persistent footer bar --------------------------------------
// New chrome region, always visible, lowest-effort to notice, costs a row of
// vertical space on every screen.

export function CommitHashFooterVariant() {
  return (
    <footer className="flex h-8 shrink-0 items-center justify-end border-t px-6 font-mono text-[11px] text-muted-foreground">
      notex · {MOCK_SHA}
    </footer>
  )
}

// --- Variant B: inline header badge -----------------------------------------
// Reuses the existing header row instead of adding one; smallest footprint,
// but competes for space with the icons already there.

export function CommitHashHeaderBadge() {
  return (
    <span
      className="rounded border px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground"
      title="Deployed commit"
    >
      {MOCK_SHA}
    </span>
  )
}

// --- Variant C: wordmark disclosure -----------------------------------------
// Hidden by default, revealed on demand next to the "Notex" wordmark. Has
// room to carry more than just the hash (environment, build time) without
// competing for permanent chrome space.

export function CommitHashAboutTrigger() {
  const [open, setOpen] = useState(false)

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label="Build info"
        aria-expanded={open}
        className="text-muted-foreground hover:text-foreground"
      >
        <RiInformationLine className="size-4" />
      </button>
      {open && (
        <div className="absolute left-0 top-6 z-10 w-56 rounded-md border bg-background p-3 text-xs shadow-md">
          <p className="font-medium">Build info</p>
          <dl className="mt-1.5 space-y-1 text-muted-foreground">
            <div className="flex justify-between">
              <dt>Commit</dt>
              <dd className="font-mono">{MOCK_SHA}</dd>
            </div>
            <div className="flex justify-between">
              <dt>Environment</dt>
              <dd className="font-mono">dev</dd>
            </div>
          </dl>
        </div>
      )}
    </div>
  )
}

// --- Switcher ----------------------------------------------------------------

export function useCommitHashPrototypeVariant() {
  const [variant, setVariant] = useState<Variant>('A')

  useEffect(() => {
    setVariant(readVariant())
  }, [])

  const set = (next: Variant) => {
    setVariant(next)
    writeVariant(next)
  }

  return { variant, set }
}

export function CommitHashPrototypeSwitcher({
  variant,
  onChange,
}: {
  variant: Variant
  onChange: (next: Variant) => void
}) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
        return
      }
      if (e.key === 'ArrowLeft') {
        onChange(cycleVariant(variant, -1))
      } else if (e.key === 'ArrowRight') {
        onChange(cycleVariant(variant, 1))
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [variant, onChange])

  const cycle = (delta: number) => onChange(cycleVariant(variant, delta))

  return (
    <div className="fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-full border bg-foreground px-4 py-2 text-background shadow-lg">
      <button onClick={() => cycle(-1)} aria-label="Previous variant" className="text-lg leading-none">
        ‹
      </button>
      <span className="whitespace-nowrap font-mono text-xs">
        {variant} — {VARIANT_NAMES[variant]}
      </span>
      <button onClick={() => cycle(1)} aria-label="Next variant" className="text-lg leading-none">
        ›
      </button>
    </div>
  )
}
