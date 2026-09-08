# Manual test: highlight a Project's already-connected checkout (TBR-148)

`siblingPromotion.test.ts` covers `findSiblingPromotion` in isolation (org/project/repository
matching, hub exclusion, stale-link handling) and `InstancePicker.test.tsx` covers the promoted
row's rendering, ordering, and the mid-interaction reorder freeze — all against synthetic
`InstanceSummary`/`Repository` data, no real companion or browser involved. This is the procedure
for seeing the actual promoted-row UI against a live hub/satellite pair, worth re-running whenever
`src/features/companion/{siblingPromotion,InstancePicker}.tsx` or the picker's wiring in
`graph.tsx` changes.

Read [`hub-satellite-switch-manual-test.md`](hub-satellite-switch-manual-test.md) first if you
haven't exercised the plain instance picker before — this doc assumes that flow already works and
focuses on what TBR-148's promotion adds on top of it. Background:
[TBR-146](https://linear.app/bmbn/issue/TBR-146), [TBR-147](https://linear.app/bmbn/issue/TBR-147).

## What you need

- Everything `hub-satellite-switch-manual-test.md` lists: `bun run dev` running, this checkout
  already linked, a second checkout directory to act as the satellite, an API key for the
  `hub_key_required` step.
- **Two Repositories in the same Project** — call them **Repo A** and **Repo B**. Repo A will end
  up linked to the satellite; Repo B stays unpaired until step 3. (A third Repository in a
  *different* Project is useful for step 5's baseline check, but not required.)

## 1. Start the hub and a satellite

Same as `hub-satellite-switch-manual-test.md` step 1: `notex-companion serve` in this repo root
(hub, `:7717`), then again in the satellite checkout directory (registers as satellite, same
pairing line).

## 2. Link the satellite to Repo A

Open **Repo A**'s graph page, **Connect companion**, paste the pairing line, confirm the
self-consistent first pairing (same as the other doc's step 3). From the instance picker that
appears, click the satellite row's **Connect this checkout** → **Confirm** → paste the API key if
prompted (`hub_key_required`). Repo A should land on `connected`, showing the satellite's checkout
path. This is the "sibling" link TBR-148 promotes elsewhere.

## 3. See the promoted row on Repo B

Open **Repo B**'s graph page — never paired, so TBR-147 bootstraps its picker via the pairing
already stored for Repo A. Expect:

- The satellite's row sits **first** in the list, above a highlighted "Already connected to
  Repo A in this Project" label.
- The hub's row (and any other instance) still renders below it, unremoved and unhidden — only
  reordered, not filtered.
- The label uses Repo A's actual name (from the Project's own repository list, not just its id).

## 4. Promoted row's action is the real switch flow

Click **Connect this checkout** on the promoted row. Expect the same confirm panel (checkout
path/git remote/HEAD) and `POST /v1/switch` flow as any other row — no separate write path. Confirm
lands Repo B on `connected` against the satellite's checkout, same as `hub-satellite-switch-
manual-test.md` step 4 describes for a plain (non-promoted) row.

## 5. Baseline — no sibling, no promotion

Open a Repository whose Project has no sibling Repository linked to anything (the third Project's
Repository, or Repo A's Project before step 2). The instance list should render exactly as
TBR-147's baseline — plain, unpromoted, no "Already connected to…" label anywhere.

## 6. Reorder doesn't jump mid-interaction

Harder to force by hand (the automated race-condition test in `InstancePicker.test.tsx` covers
this directly), but worth a sanity check: on a slow connection, open Repo B's graph page and click
a row's **Connect this checkout** *before* the promoted label has had a chance to render. The row
you clicked should keep its confirm panel open and its position in the list — it must not jump
under you if the sibling promotion resolves a moment later.

## Known, accepted quirks (not bugs — don't file these)

- Everything `hub-satellite-switch-manual-test.md`'s own "Known, accepted quirks" section lists
  still applies unchanged — TBR-148 only reorders/labels rows within whatever list TBR-147/144
  already produce; it doesn't change when the picker itself becomes reachable.
- The promoted label only ever names **one** sibling, even if more than one instance qualifies —
  `findSiblingPromotion` returns the first match in list order. A Project with two Repositories
  each linked to a different satellite will only see one of them promoted; this is expected, not a
  bug to file.
