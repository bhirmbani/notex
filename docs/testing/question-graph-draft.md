# Manual test: "Draft this Answer from the graph" on a Question

The Question surface's graph action (TBR-70) has no automated coverage end-to-end — each
component is unit-tested against mocked companion responses, but nothing exercises a real
companion process, a real retrieval, or a real clipboard write. This is the procedure for
walking it by hand, written against `docs/specs/graph-gui.md` §2–3 and worth re-running whenever
`src/features/companion/QuestionGraphAction.tsx`, `QuestionGraphPanel.tsx`,
`questionGraphDraft.ts`, or the companion's `query` op change.

Unlike the [connect-companion flow](companion-connect-flow.md), **this can be run entirely in
local dev** (`bun run dev`). `localhost:3000 → 127.0.0.1:7717` is loopback→loopback, so no Local
Network Access prompt fires and pairing short-circuits straight to `granted` (TBR-56 trap 1) —
there is no origin to burn here. Read the connect-companion doc first if you don't already have a
paired companion; the LNA grant/deny paths themselves stay covered there, on a deployed origin.

## What you need

- A Checkout with `graphify-out/graph.json` — this repo has one, built from its own `src/`.
- `npx notex-companion@latest` (or `node packages/companion/dist/cli.js` for the working-tree
  build) running against that checkout, with `bun run dev` also running.
- A Repository in the app whose checkout is bound to that companion (pair it from the Repository's
  graph page — see the connect-companion doc §1–4; local dev makes this a formality since no
  prompt fires).
- A Question (`…/r/$repoId/c/$ctxId`) under that Repository. Any existing Question works, or
  create one whose text loosely matches something in this repo's own code, e.g. "how does the
  companion resolve connection state".

## 1. The disabled state, before pairing

On a Repository whose companion isn't paired, open a Question and check the Answers header:

- "Draft this Answer from the graph" renders **disabled**.
- Beneath it: *"Companion not connected — [set it up](…)"*, linking to that Repository's graph
  page.
- No entry appears in DevTools → Network for `/v1/status` or `/v1/query` — the button must not
  probe the companion on its own (ADR-0004).

Open the same Question in Safari or Brave: the line changes to *"Graph features need Chrome or
Firefox."* with **no link** (the graph page can't help there either).

## 2. Pair, then confirm the button enables

Pair the companion from the graph page (connect-companion doc §4, steps 1–4 — in local dev step 2
completes with no visible browser prompt). Return to the Question: the button must now be enabled
with no line beneath it.

## 3. A well-matched question — Files, then Evidence

Click **Draft this Answer from the graph**.

- The panel appears **above the Answer cards**, Files selected by default.
- The stamp line reads `graph built <date> · <N> nodes · <hash> · at <sha>`.
- Files are listed as expandable rows (`<details>`); click one open to see its nodes. Each node's
  source path is a link — click one and confirm it opens your editor at the right file and line
  (set your scheme first if you haven't: it's a per-browser `localStorage` preference, no UI for it
  yet beyond what `src/lib/editorScheme.ts` defaults to — `vscode`).
- Click the **Evidence** segment: nodes regroup by community, seed nodes carry a "seed" badge and
  sort first within their group. Open the **Relations** disclosure at the bottom — edges read
  `A —relation→ B`, with a confidence tag only when it isn't `EXTRACTED`.
- Switch back to **Files**. Watch DevTools → Network while switching: there must be **no** new
  `/v1/query` call — a variant switch is local state, never a new retrieval.
- **Draft** and **Canvas** segments render but are inert — clicking them does nothing (they're
  TBR-71's own deliverable).

## 4. Expand

Click **Expand (depth 2)**. Confirm a new `POST /v1/query` fires with `"depth": 2` in its body,
and the "N nodes · M edges" count updates (usually upward). The initial click in step 3 should NOT
have sent `depth` at all — check that request's body too, to confirm the default (`depth: 1`) came
from the companion, not the client.

## 5. Copy for your agent

Click **Copy for your agent**, then paste the clipboard contents somewhere. It must be *exactly*
the `context` markdown block — a `# <question>` header, `built <date> · <N> nodes`, nodes grouped
by community, a `## Relations` section if any edges exist — **nothing else**: no role, no framing
sentence, no instructions. The button label should flip to "Copied" briefly.

To see the failure path, revoke the site's clipboard-write permission (Chrome: page-info icon →
Site settings → Clipboard → Block) and click again — the button should show a visible error
message instead of silently doing nothing.

## 6. Honesty banners

| Banner | How to force it | What you should see |
|---|---|---|
| `degraded` | Nothing special — the Question surface never sends pre-expanded `terms`, so **every** draft from this button carries this banner today. | *"Matched literally — your agent can do better."* above the switcher, on both variants. |
| `truncated` | Ask a very broad question that matches many nodes (a common word that appears all over the codebase) so the 60-node default cap bites. | *"Results were capped (maxNodes) — N related nodes may be missing."* |
| `lowConfidence` | Ask something with **no** exact token match — nonsense text, or a real question about something this codebase doesn't do (e.g. "how do we handle rate limiting"). | The switcher and variant body **disappear entirely**, replaced by *"Nothing convincing matched."* The banners above it and the Copy button below it still render. |

Both `degraded` and `truncated` can co-occur; confirm both banners stack rather than one hiding
the other.

## 7. Companion drops mid-session

With a result already on screen, stop the companion process (Ctrl-C). Per
`docs/specs/graph-gui.md` §6.2:

- The rendered panel **stays** — banners, stamp, nodes, everything already drawn remains valid.
- Clicking **Draft this Answer from the graph** again should fail visibly rather than silently
  (the mutation's error path renders *"Couldn't draft from the graph. …"* in place of the panel).
- The page must not auto-retry or silently poll — leave it idle with Network open for a minute and
  confirm nothing fires on its own.

## Known, accepted quirks (not bugs — don't file these)

- The `degraded` banner shown in §6 is permanent on this surface until a future ticket adds
  vocabulary expansion (`terms`) to the Question action. It's accurate, not a defect.
- Editing the Question's text in place after drafting doesn't clear the panel — it'll still show
  results for the old wording until you draft again.
- The two-node picker's `path` op and free `search` box live only on the graph page, not here —
  that's `docs/specs/graph-gui.md` §4.2's own scope line, not something to test for on a Question.
