# Question Surface: Inline Result Panel, Files and Evidence, Honesty Banners — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship TBR-70 — the "Draft this Answer from the graph" action on a Question, its inline result panel with the Files/Evidence variant switcher, and the honesty banners (`degraded`, `truncated`, `lowConfidence`).

**Architecture:** All new code lives in `src/features/companion/` alongside the existing companion client/hooks (TBR-68's package). Pure ranking/grouping logic is split into small, independently-testable files (matching this codebase's existing `staleness.ts` / `stateNotice.ts` pattern). One orchestration hook (`useQuestionGraphDraft`) owns the query mutation and variant state; two presentational components (`QuestionGraphAction`, `QuestionGraphPanel`) consume it and are wired into the existing Question route (`c/$ctxId/index.tsx`). No changes to the companion package (`packages/companion`) — the `query` op, its defaults, and its response shape already match `companion-api.md` §4.4 exactly.

**Tech Stack:** React, TanStack Router/Query, Vitest + Testing Library, Tailwind.

**Spec:** `docs/specs/graph-gui.md` §2 (Question surface) and §3 (retrieval behaviour); `docs/adr/0004-the-lna-permission-prompt-fires-only-from-an-explicit-connect-flow.md`; `docs/specs/companion-api.md` §4.4/§4.7 (query op, context block).

## Global Constraints

- The Question surface expresses exactly two states: `connected` (button enabled) and everything else (button disabled + one line) — graph-gui.md §2.2. Never render the graph page's full eight-state machine here.
- The permission prompt never fires from this surface (ADR-0004) — reading `useCompanionConnection` only ever calls `navigator.permissions.query` (introspection) and, when already `granted`, a `ping`/`status` fetch; it never fetches while permission is `prompt`.
- Default bounds are `depth: 1`, `maxNodes: 60`, `seeds: 5` — these are the companion's own defaults (`packages/companion/src/ops.ts`), so the initial request must **omit** those fields rather than restate them. Depth 2 is only ever sent by an explicit "Expand" action.
- `degraded` and `truncated` banners render above the variant switcher, omitted entirely when absent — never rendered as "none" (graph-gui.md §3.3).
- `lowConfidence` replaces the subgraph with "nothing convincing matched" — graph-gui.md §3.2. This is a UI-level suppression: the response may still carry a real `subgraph`, but it must not be rendered.
- The switcher's fixed order is Files · Evidence · Draft · Canvas, Files default (graph-gui.md §2.3). This ticket ships Files and Evidence; Draft and Canvas render as disabled segments (TBR-71 enables them) — the switcher itself, and the state above it, are this ticket's own deliverable per the Linear description.
- Editor links appear in Files and Evidence, built the same way as the graph page's (`buildEditorLink` from `src/lib/editorScheme.ts`) — never restate that logic.
- Copy-for-agent copies `result.context.markdown` verbatim — no added role, framing, or instructions (companion-api.md §4.7).
- **Known data gap, resolved here:** graph-gui.md §2.4 says Files rank "by seed count, then summed score," but `QueryResult.subgraph.seeds` is `Array<string>` (ids only, in score-descending order) — the companion never exposes raw per-node scores to a client, only the internal seed-score-floor check. `rankFiles` (Task 2) uses each file's best seed's position in that array as the tiebreak proxy for "score," documented inline. This is a client-side approximation, not a wire change to the companion.

---

## File structure

- `src/features/companion/questionGraphNotice.ts` (+ test) — pure function: the Question surface's two-state copy.
- `src/features/companion/rankFiles.ts` (+ test) — pure function: groups subgraph nodes by `sourceFile`, ranks by seed count then seed rank.
- `src/features/companion/groupEvidence.ts` (+ test) — pure function: groups subgraph nodes by community, seed-first within each group.
- `src/features/companion/hooks.ts` (modify) — add `useCompanionQuery`.
- `src/features/companion/hooks.test.tsx` (modify) — test `useCompanionQuery`.
- `src/features/companion/questionGraphDraft.ts` (+ test) — `useQuestionGraphDraft`, the orchestration hook owning connection state, the query mutation, and variant state.
- `src/features/companion/QuestionGraphAction.tsx` (+ test) — the button + disabled-explainer line, mounted beside "Post Answer".
- `src/features/companion/QuestionGraphPanel.tsx` (+ test) — the inline result panel: banners, stamp line, switcher, Files/Evidence bodies, copy-for-agent footer, Expand action.
- `src/routes/dashboard/_layout/o/$organizationId/p/$projectId/r/$repoId/c/$ctxId/index.tsx` (modify) — wire the two components in.

---

### Task 1: `questionGraphNotice` — the Question surface's two-state copy

**Files:**
- Create: `src/features/companion/questionGraphNotice.ts`
- Test: `src/features/companion/questionGraphNotice.test.ts`

**Interfaces:**
- Consumes: `ConnectionState` from `./types`
- Produces: `questionGraphNotice(state: ConnectionState | undefined): { message: string; link: boolean } | null`, consumed by Task 6 (`QuestionGraphAction`)

- [ ] **Step 1: Write the failing test**

```ts
// src/features/companion/questionGraphNotice.test.ts
import { describe, expect, it } from "vitest"

import { questionGraphNotice } from "./questionGraphNotice"

describe("questionGraphNotice", () => {
  it("returns null when connected — the button just renders enabled", () => {
    expect(questionGraphNotice("connected")).toBeNull()
  })

  it("returns the unsupported line with no link — the graph page can't help a Safari/Brave user", () => {
    expect(questionGraphNotice("unsupported")).toEqual({
      message: "Graph features need Chrome or Firefox.",
      link: false,
    })
  })

  it("returns the same 'not connected' line, with a link, for every other state", () => {
    const states = [
      "unpaired",
      "needs-permission",
      "blocked",
      "unreachable",
      "outdated",
      "unauthorized",
      "mismatched",
    ] as const

    for (const state of states) {
      expect(questionGraphNotice(state)).toEqual({
        message: "Companion not connected — ",
        link: true,
      })
    }
  })

  it("treats an undetermined (loading) state the same as not connected", () => {
    expect(questionGraphNotice(undefined)).toEqual({
      message: "Companion not connected — ",
      link: true,
    })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bunx vitest run src/features/companion/questionGraphNotice.test.ts`
Expected: FAIL — `Cannot find module './questionGraphNotice'`

- [ ] **Step 3: Write minimal implementation**

```ts
// src/features/companion/questionGraphNotice.ts
// The Question surface's two-state copy (graph-gui.md §2.2). Collapses the graph page's
// eight-state machine into "enabled" vs one disabled line — diagnosing all eight states
// mid-task is a burden at the moment the user wants to draft an Answer, and every fix for
// a non-connected state lives on the graph page, not here.

import type { ConnectionState } from "./types"

export type QuestionGraphNotice = {
  message: string
  /** When true, the caller appends a "set it up" link pointing at the graph page. */
  link: boolean
}

export function questionGraphNotice(
  state: ConnectionState | undefined
): QuestionGraphNotice | null {
  if (state === "connected") return null
  if (state === "unsupported") {
    return { message: "Graph features need Chrome or Firefox.", link: false }
  }
  return { message: "Companion not connected — ", link: true }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bunx vitest run src/features/companion/questionGraphNotice.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/features/companion/questionGraphNotice.ts src/features/companion/questionGraphNotice.test.ts
git commit -m "feat(companion): Question surface's two-state connection notice (TBR-70)"
```

---

### Task 2: `rankFiles` — Files variant ranking

**Files:**
- Create: `src/features/companion/rankFiles.ts`
- Test: `src/features/companion/rankFiles.test.ts`

**Interfaces:**
- Consumes: `GraphNode` from `notex-companion/client`
- Produces: `rankFiles(nodes: Array<GraphNode>, seeds: Array<string>): Array<FileGroup>` where `FileGroup = { sourceFile: string; fileType: string; seedCount: number; nodes: Array<GraphNode> }`, consumed by Task 7 (`QuestionGraphPanel`'s Files variant)

- [ ] **Step 1: Write the failing test**

```ts
// src/features/companion/rankFiles.test.ts
import { describe, expect, it } from "vitest"

import { rankFiles } from "./rankFiles"
import type { GraphNode } from "notex-companion/client"

function node(overrides: Partial<GraphNode>): GraphNode {
  return {
    id: "n1",
    label: "n1",
    sourceFile: "src/a.ts",
    sourceLocation: "L1",
    fileType: "code",
    community: null,
    ...overrides,
  }
}

describe("rankFiles", () => {
  it("groups nodes by sourceFile", () => {
    const nodes = [
      node({ id: "n1", sourceFile: "src/a.ts" }),
      node({ id: "n2", sourceFile: "src/a.ts" }),
      node({ id: "n3", sourceFile: "src/b.ts" }),
    ]

    const groups = rankFiles(nodes, [])

    expect(groups).toHaveLength(2)
    expect(groups.find((g) => g.sourceFile === "src/a.ts")?.nodes).toHaveLength(2)
    expect(groups.find((g) => g.sourceFile === "src/b.ts")?.nodes).toHaveLength(1)
  })

  it("ranks the file with more seeds first", () => {
    const nodes = [
      node({ id: "n1", sourceFile: "src/one-seed.ts" }),
      node({ id: "n2", sourceFile: "src/two-seeds.ts" }),
      node({ id: "n3", sourceFile: "src/two-seeds.ts" }),
    ]
    const seeds = ["n1", "n2", "n3"]

    const groups = rankFiles(nodes, seeds)

    expect(groups[0]?.sourceFile).toBe("src/two-seeds.ts")
    expect(groups[0]?.seedCount).toBe(2)
    expect(groups[1]?.sourceFile).toBe("src/one-seed.ts")
    expect(groups[1]?.seedCount).toBe(1)
  })

  it("breaks a seed-count tie by which file holds the earlier (higher-scored) seed", () => {
    const nodes = [
      node({ id: "n1", sourceFile: "src/later.ts" }),
      node({ id: "n2", sourceFile: "src/earlier.ts" }),
    ]
    // seeds are score-descending; n2 outranks n1
    const seeds = ["n2", "n1"]

    const groups = rankFiles(nodes, seeds)

    expect(groups.map((g) => g.sourceFile)).toEqual([
      "src/earlier.ts",
      "src/later.ts",
    ])
  })

  it("falls back to alphabetical order for a fully tied pair", () => {
    const nodes = [
      node({ id: "n1", sourceFile: "src/z.ts" }),
      node({ id: "n2", sourceFile: "src/a.ts" }),
    ]

    const groups = rankFiles(nodes, [])

    expect(groups.map((g) => g.sourceFile)).toEqual(["src/a.ts", "src/z.ts"])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bunx vitest run src/features/companion/rankFiles.test.ts`
Expected: FAIL — `Cannot find module './rankFiles'`

- [ ] **Step 3: Write minimal implementation**

```ts
// src/features/companion/rankFiles.ts
// The Files variant's ranking (graph-gui.md §2.4): "ranked by seed count, then summed
// score." `query`'s subgraph carries seed ids in score-descending order but never raw
// per-node scores (those live only inside the companion, for the seed-score-floor check) —
// so the tiebreak here uses each file's best (lowest-index = highest-scored) seed rank as a
// proxy for "score" rather than a real numeric sum. A client-side approximation, not a
// companion wire change.

import type { GraphNode } from "notex-companion/client"

export type FileGroup = {
  sourceFile: string
  fileType: string
  seedCount: number
  nodes: Array<GraphNode>
}

export function rankFiles(
  nodes: Array<GraphNode>,
  seeds: Array<string>
): Array<FileGroup> {
  const seedRank = new Map(seeds.map((id, i) => [id, i]))
  const byFile = new Map<string, FileGroup>()

  for (const n of nodes) {
    let group = byFile.get(n.sourceFile)
    if (!group) {
      group = { sourceFile: n.sourceFile, fileType: n.fileType, seedCount: 0, nodes: [] }
      byFile.set(n.sourceFile, group)
    }
    group.nodes.push(n)
    if (seedRank.has(n.id)) group.seedCount++
  }

  const bestRank = (group: FileGroup) =>
    Math.min(...group.nodes.map((n) => seedRank.get(n.id) ?? Number.POSITIVE_INFINITY))

  return [...byFile.values()].sort((a, b) => {
    if (b.seedCount !== a.seedCount) return b.seedCount - a.seedCount
    const rankDiff = bestRank(a) - bestRank(b)
    if (rankDiff !== 0) return rankDiff
    return a.sourceFile.localeCompare(b.sourceFile)
  })
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bunx vitest run src/features/companion/rankFiles.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/features/companion/rankFiles.ts src/features/companion/rankFiles.test.ts
git commit -m "feat(companion): rank Files variant by seed count then seed rank (TBR-70)"
```

---

### Task 3: `groupEvidence` — Evidence variant grouping

**Files:**
- Create: `src/features/companion/groupEvidence.ts`
- Test: `src/features/companion/groupEvidence.test.ts`

**Interfaces:**
- Consumes: `GraphNode` from `notex-companion/client`
- Produces: `groupEvidence(nodes: Array<GraphNode>, seeds: Array<string>): Array<EvidenceGroup>` where `EvidenceGroup = { name: string; nodes: Array<{ node: GraphNode; isSeed: boolean }> }`, consumed by Task 7

- [ ] **Step 1: Write the failing test**

```ts
// src/features/companion/groupEvidence.test.ts
import { describe, expect, it } from "vitest"

import { groupEvidence } from "./groupEvidence"
import type { GraphNode } from "notex-companion/client"

function node(overrides: Partial<GraphNode>): GraphNode {
  return {
    id: "n1",
    label: "n1",
    sourceFile: "src/a.ts",
    sourceLocation: "L1",
    fileType: "code",
    community: null,
    ...overrides,
  }
}

describe("groupEvidence", () => {
  it("groups nodes by community name", () => {
    const nodes = [
      node({ id: "n1", community: { id: 1, name: "Auth" } }),
      node({ id: "n2", community: { id: 2, name: "Billing" } }),
      node({ id: "n3", community: { id: 1, name: "Auth" } }),
    ]

    const groups = groupEvidence(nodes, [])

    expect(groups.map((g) => g.name).sort()).toEqual(["Auth", "Billing"])
    expect(groups.find((g) => g.name === "Auth")?.nodes).toHaveLength(2)
  })

  it("falls back to 'Ungrouped' for a null community, sorted last", () => {
    const nodes = [
      node({ id: "n1", community: null }),
      node({ id: "n2", community: { id: 1, name: "Auth" } }),
    ]

    const groups = groupEvidence(nodes, [])

    expect(groups.map((g) => g.name)).toEqual(["Auth", "Ungrouped"])
  })

  it("sorts seed nodes first within a group, then alphabetically", () => {
    const nodes = [
      node({ id: "n1", label: "zeta", community: { id: 1, name: "Auth" } }),
      node({ id: "n2", label: "alpha", community: { id: 1, name: "Auth" } }),
      node({ id: "n3", label: "middle-seed", community: { id: 1, name: "Auth" } }),
    ]

    const groups = groupEvidence(nodes, ["n3"])

    expect(groups[0]?.nodes.map((n) => n.node.label)).toEqual([
      "middle-seed",
      "alpha",
      "zeta",
    ])
    expect(groups[0]?.nodes[0]?.isSeed).toBe(true)
    expect(groups[0]?.nodes[1]?.isSeed).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bunx vitest run src/features/companion/groupEvidence.test.ts`
Expected: FAIL — `Cannot find module './groupEvidence'`

- [ ] **Step 3: Write minimal implementation**

```ts
// src/features/companion/groupEvidence.ts
// The Evidence variant's grouping (graph-gui.md §2.4): "Nodes grouped by community,
// seed-first." Community ids/names are display grouping only, then discarded — they
// reshuffle across rebuilds (TBR-48) — so nothing here persists a community id anywhere.

import type { GraphNode } from "notex-companion/client"

export type EvidenceGroup = {
  name: string
  nodes: Array<{ node: GraphNode; isSeed: boolean }>
}

export function groupEvidence(
  nodes: Array<GraphNode>,
  seeds: Array<string>
): Array<EvidenceGroup> {
  const seedSet = new Set(seeds)
  const byName = new Map<string, Array<{ node: GraphNode; isSeed: boolean }>>()

  for (const n of nodes) {
    const name = n.community?.name ?? "Ungrouped"
    if (!byName.has(name)) byName.set(name, [])
    byName.get(name)!.push({ node: n, isSeed: seedSet.has(n.id) })
  }

  const names = [...byName.keys()].sort((a, b) =>
    a === "Ungrouped" ? 1 : b === "Ungrouped" ? -1 : a.localeCompare(b)
  )

  return names.map((name) => ({
    name,
    nodes: [...byName.get(name)!].sort((a, b) => {
      if (a.isSeed !== b.isSeed) return a.isSeed ? -1 : 1
      return a.node.label.localeCompare(b.node.label)
    }),
  }))
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bunx vitest run src/features/companion/groupEvidence.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/features/companion/groupEvidence.ts src/features/companion/groupEvidence.test.ts
git commit -m "feat(companion): group Evidence variant by community, seed-first (TBR-70)"
```

---

### Task 4: `useCompanionQuery` hook

**Files:**
- Modify: `src/features/companion/hooks.ts`
- Modify: `src/features/companion/hooks.test.tsx`

**Interfaces:**
- Consumes: `query` from `./client`, `QueryRequest`/`QueryResult` from `notex-companion/client`, `PairingRecord` from `./types`
- Produces: `useCompanionQuery(pairing: PairingRecord | null)` — a `useMutation` result whose `mutate`/`mutateAsync` take a `QueryRequest`, consumed by Task 5

- [ ] **Step 1: Write the failing test**

Add to `src/features/companion/hooks.test.tsx` (after the `useCompanionPath` describe block):

```tsx
describe("useCompanionQuery", () => {
  it("calls the query op with the pairing's baseUrl/token, on demand", async () => {
    const querySpy = vi.spyOn(client, "query").mockResolvedValue({
      graph: {} as never,
      subgraph: { nodes: [], edges: [], seeds: [] },
    })

    const { result } = renderHook(() => useCompanionQuery(PAIRING), { wrapper })
    await result.current.mutateAsync({ question: "how does auth work?" })

    expect(querySpy).toHaveBeenCalledWith(PAIRING.baseUrl, PAIRING.token, {
      question: "how does auth work?",
    })
  })

  it("rejects without calling the client when there is no pairing", async () => {
    const querySpy = vi.spyOn(client, "query")
    const { result } = renderHook(() => useCompanionQuery(null), { wrapper })

    await expect(
      result.current.mutateAsync({ question: "x" })
    ).rejects.toThrow()
    expect(querySpy).not.toHaveBeenCalled()
  })
})
```

Also add `useCompanionQuery` to the existing import from `"./hooks"` at the top of the file.

- [ ] **Step 2: Run test to verify it fails**

Run: `bunx vitest run src/features/companion/hooks.test.tsx`
Expected: FAIL — `useCompanionQuery is not exported` / `is not a function`

- [ ] **Step 3: Write minimal implementation**

Add to `src/features/companion/hooks.ts`:

```ts
import { browse as browseOp, path as pathOp, query as queryOp, search as searchOp } from "./client"
// (replaces the existing `import { browse as browseOp, path as pathOp, search as searchOp } from "./client"` line)
```

```ts
import type { PathRequest, QueryRequest } from "notex-companion/client"
// (replaces the existing `import type { PathRequest } from "notex-companion/client"` line)
```

```ts
/**
 * The Question surface's "Draft this Answer from the graph" retrieval (companion-api.md
 * §4.4, graph-gui.md §2). Bounds default to the companion's own defaults (depth 1 /
 * maxNodes 60 / 5 seeds) by omission — a caller only ever sets `depth` explicitly for the
 * "expand" action (graph-gui.md §3.1).
 */
export function useCompanionQuery(pairing: PairingRecord | null) {
  return useMutation({
    mutationFn: (req: QueryRequest) => {
      if (!pairing) return Promise.reject(new Error("not connected"))
      return queryOp(pairing.baseUrl, pairing.token, req)
    },
  })
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bunx vitest run src/features/companion/hooks.test.tsx`
Expected: PASS (all tests, including the two new ones)

- [ ] **Step 5: Commit**

```bash
git add src/features/companion/hooks.ts src/features/companion/hooks.test.tsx
git commit -m "feat(companion): add useCompanionQuery for the Question surface's draft action (TBR-70)"
```

---

### Task 5: `useQuestionGraphDraft` orchestration hook

**Files:**
- Create: `src/features/companion/questionGraphDraft.ts`
- Test: `src/features/companion/questionGraphDraft.test.tsx`

**Interfaces:**
- Consumes: `useCompanionConnection`, `useCompanionQuery` from `./hooks`; `ConnectionState` from `./types`; `OpResponse`, `QueryResult` from `notex-companion/client`
- Produces:
  ```ts
  export type GraphVariant = "files" | "evidence"
  export function useQuestionGraphDraft(repositoryId: string, question: string | undefined): {
    connectionState: ConnectionState | undefined
    canDraft: boolean
    checkoutPath: string | null
    variant: GraphVariant
    setVariant: (v: GraphVariant) => void
    run: () => void
    expand: () => void
    result: OpResponse<QueryResult> | undefined
    isPending: boolean
    error: Error | null
  }
  ```
  Consumed by Task 6 and Task 7 via Task 8's wiring.

- [ ] **Step 1: Write the failing test**

```tsx
// src/features/companion/questionGraphDraft.test.tsx
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { renderHook, waitFor } from "@testing-library/react"
import type { ReactNode } from "react"

import { useQuestionGraphDraft } from "./questionGraphDraft"
import * as connectionState from "./connectionState"
import * as client from "./client"

afterEach(() => {
  vi.restoreAllMocks()
})

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
}

const PAIRING = { baseUrl: "http://127.0.0.1:7717", token: "tok", checkoutId: "c1" }
const STATUS = { graph: { checkoutPath: "/repo" } } as never

describe("useQuestionGraphDraft", () => {
  it("cannot draft when not connected, and issues no query", async () => {
    vi.spyOn(connectionState, "resolveConnectionState").mockResolvedValue({
      state: "unpaired",
    })
    const querySpy = vi.spyOn(client, "query")

    const { result } = renderHook(
      () => useQuestionGraphDraft("repo-1", "how does auth work?"),
      { wrapper }
    )

    await waitFor(() => expect(result.current.connectionState).toBe("unpaired"))
    expect(result.current.canDraft).toBe(false)
    expect(result.current.checkoutPath).toBeNull()

    result.current.run()
    expect(querySpy).not.toHaveBeenCalled()
  })

  it("runs the default-bounds query on `run`, defaulting to the Files variant", async () => {
    vi.spyOn(connectionState, "resolveConnectionState").mockResolvedValue({
      state: "connected",
      pairing: PAIRING,
      status: STATUS,
    })
    const querySpy = vi.spyOn(client, "query").mockResolvedValue({
      graph: {} as never,
      subgraph: { nodes: [], edges: [], seeds: [] },
    })

    const { result } = renderHook(
      () => useQuestionGraphDraft("repo-1", "how does auth work?"),
      { wrapper }
    )

    await waitFor(() => expect(result.current.canDraft).toBe(true))
    expect(result.current.checkoutPath).toBe("/repo")

    result.current.run()

    await waitFor(() => expect(result.current.result).toBeTruthy())
    expect(querySpy).toHaveBeenCalledWith(PAIRING.baseUrl, PAIRING.token, {
      question: "how does auth work?",
      include: ["subgraph", "context"],
    })
    expect(result.current.variant).toBe("files")
  })

  it("sends depth: 2 on `expand`, and nothing else beyond the default request", async () => {
    vi.spyOn(connectionState, "resolveConnectionState").mockResolvedValue({
      state: "connected",
      pairing: PAIRING,
      status: STATUS,
    })
    const querySpy = vi.spyOn(client, "query").mockResolvedValue({
      graph: {} as never,
      subgraph: { nodes: [], edges: [], seeds: [] },
    })

    const { result } = renderHook(
      () => useQuestionGraphDraft("repo-1", "how does auth work?"),
      { wrapper }
    )

    await waitFor(() => expect(result.current.canDraft).toBe(true))

    result.current.expand()

    await waitFor(() =>
      expect(querySpy).toHaveBeenCalledWith(PAIRING.baseUrl, PAIRING.token, {
        question: "how does auth work?",
        include: ["subgraph", "context"],
        depth: 2,
      })
    )
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bunx vitest run src/features/companion/questionGraphDraft.test.tsx`
Expected: FAIL — `Cannot find module './questionGraphDraft'`

- [ ] **Step 3: Write minimal implementation**

```ts
// src/features/companion/questionGraphDraft.ts
// Orchestrates the Question surface's "Draft this Answer from the graph" action
// (graph-gui.md §2): owns connection state, the query mutation, and which variant is
// showing. `QuestionGraphAction` (the button) and `QuestionGraphPanel` (the result) are
// both driven by one instance of this hook so a click in the header updates the panel
// below the Answer cards.

import { useState } from "react"

import { useCompanionConnection, useCompanionQuery } from "./hooks"
import type { ConnectionState } from "./types"
import type { OpResponse, QueryResult } from "notex-companion/client"

export type GraphVariant = "files" | "evidence"

export function useQuestionGraphDraft(
  repositoryId: string,
  question: string | undefined
) {
  const connection = useCompanionConnection(repositoryId)
  const pairing =
    connection.data?.state === "connected" ? connection.data.pairing : null
  const checkoutPath =
    connection.data?.state === "connected"
      ? connection.data.status.graph.checkoutPath
      : null
  const mutation = useCompanionQuery(pairing)
  const [variant, setVariant] = useState<GraphVariant>("files")

  const run = () => {
    if (!question) return
    setVariant("files")
    mutation.mutate({ question, include: ["subgraph", "context"] })
  }

  const expand = () => {
    if (!question) return
    mutation.mutate({ question, include: ["subgraph", "context"], depth: 2 })
  }

  return {
    connectionState: connection.data?.state as ConnectionState | undefined,
    canDraft: connection.data?.state === "connected" && !!question,
    checkoutPath,
    variant,
    setVariant,
    run,
    expand,
    result: mutation.data as OpResponse<QueryResult> | undefined,
    isPending: mutation.isPending,
    error: mutation.error,
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bunx vitest run src/features/companion/questionGraphDraft.test.tsx`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/features/companion/questionGraphDraft.ts src/features/companion/questionGraphDraft.test.tsx
git commit -m "feat(companion): useQuestionGraphDraft orchestration hook (TBR-70)"
```

---

### Task 6: `QuestionGraphAction` — the button and disabled explainer

**Files:**
- Create: `src/features/companion/QuestionGraphAction.tsx`
- Test: `src/features/companion/QuestionGraphAction.test.tsx`

**Interfaces:**
- Consumes: `questionGraphNotice` from `./questionGraphNotice`; `ConnectionState` from `./types`; `Button` from `@/components/ui/button`; `Link` from `@tanstack/react-router`
- Produces: `<QuestionGraphAction organizationId projectId repoId canDraft connectionState isPending onDraft />`, consumed by Task 8

- [ ] **Step 1: Write the failing test**

```tsx
// src/features/companion/QuestionGraphAction.test.tsx
// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from "@tanstack/react-router"

import { QuestionGraphAction } from "./QuestionGraphAction"

function renderWithRouter(canDraft: boolean, connectionState: string | undefined, onDraft = vi.fn()) {
  const rootRoute = createRootRoute({
    component: () => (
      <QuestionGraphAction
        organizationId="org-1"
        projectId="proj-1"
        repoId="repo-1"
        canDraft={canDraft}
        connectionState={connectionState as never}
        isPending={false}
        onDraft={onDraft}
      />
    ),
  })
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: ["/"] }),
  })
  render(<RouterProvider router={router} />)
  return { onDraft }
}

describe("QuestionGraphAction", () => {
  it("enables the button and shows no notice when connected", () => {
    renderWithRouter(true, "connected")

    const button = screen.getByRole<HTMLButtonElement>("button", {
      name: "Draft this Answer from the graph",
    })
    expect(button.disabled).toBe(false)
    expect(screen.queryByText(/Companion not connected/)).toBeNull()
  })

  it("disables the button and shows the browser-unsupported line, with no link", () => {
    renderWithRouter(false, "unsupported")

    expect(
      screen.getByRole<HTMLButtonElement>("button", {
        name: "Draft this Answer from the graph",
      }).disabled
    ).toBe(true)
    expect(
      screen.getByText("Graph features need Chrome or Firefox.")
    ).toBeTruthy()
    expect(screen.queryByRole("link")).toBeNull()
  })

  it("disables the button and links to the graph page for any other non-connected state", () => {
    renderWithRouter(false, "unreachable")

    expect(screen.getByText(/Companion not connected/)).toBeTruthy()
    const link = screen.getByRole<HTMLAnchorElement>("link", { name: "set it up" })
    expect(link.getAttribute("href")).toBe(
      "/dashboard/o/org-1/p/proj-1/r/repo-1/graph"
    )
  })

  it("calls onDraft when clicked while enabled", () => {
    const { onDraft } = renderWithRouter(true, "connected")

    fireEvent.click(
      screen.getByRole("button", { name: "Draft this Answer from the graph" })
    )

    expect(onDraft).toHaveBeenCalledTimes(1)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bunx vitest run src/features/companion/QuestionGraphAction.test.tsx`
Expected: FAIL — `Cannot find module './QuestionGraphAction'`

- [ ] **Step 3: Write minimal implementation**

```tsx
// src/features/companion/QuestionGraphAction.tsx
// The Question surface's "Draft this Answer from the graph" action (graph-gui.md §2.1,
// §2.2) — sits beside "Post Answer" in the Answers header. Disabled-with-explainer when
// not connected; never triggers the LNA prompt itself (ADR-0004) since it only ever reads
// the already-resolved connection state, never fetches on its own.

import { Link } from "@tanstack/react-router"

import { questionGraphNotice } from "./questionGraphNotice"
import { Button } from "@/components/ui/button"
import type { ConnectionState } from "./types"

type Props = {
  organizationId: string
  projectId: string
  repoId: string
  canDraft: boolean
  connectionState: ConnectionState | undefined
  isPending: boolean
  onDraft: () => void
}

export function QuestionGraphAction({
  organizationId,
  projectId,
  repoId,
  canDraft,
  connectionState,
  isPending,
  onDraft,
}: Props) {
  const notice = questionGraphNotice(connectionState)

  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        size="sm"
        variant="outline"
        disabled={!canDraft || isPending}
        onClick={onDraft}
      >
        Draft this Answer from the graph
      </Button>
      {notice && (
        <p className="text-right text-xs text-muted-foreground">
          {notice.message}
          {notice.link && (
            <>
              <Link
                to="/dashboard/o/$organizationId/p/$projectId/r/$repoId/graph"
                params={{ organizationId, projectId, repoId }}
                className="underline hover:text-foreground"
              >
                set it up
              </Link>
              .
            </>
          )}
        </p>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bunx vitest run src/features/companion/QuestionGraphAction.test.tsx`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/features/companion/QuestionGraphAction.tsx src/features/companion/QuestionGraphAction.test.tsx
git commit -m "feat(companion): Question surface's draft action button and explainer (TBR-70)"
```

---

### Task 7: `QuestionGraphPanel` — the inline result panel

**Files:**
- Create: `src/features/companion/QuestionGraphPanel.tsx`
- Test: `src/features/companion/QuestionGraphPanel.test.tsx`

**Interfaces:**
- Consumes: `rankFiles` (Task 2), `groupEvidence` (Task 3), `GraphVariant` (Task 5), `buildEditorLink`/`getStoredEditorScheme` from `@/lib/editorScheme`, `cn` from `@/lib/utils`, `Button` from `@/components/ui/button`, `OpResponse`/`QueryResult`/`GraphNode`/`GraphEdge` from `notex-companion/client`
- Produces: `<QuestionGraphPanel checkoutPath result isPending error variant onVariantChange onExpand />`, plus named exports `FilesVariant` and `EvidenceVariant` (for direct testing, mirroring `graph.tsx`'s `SearchPanel`/`PathPanel` export pattern), consumed by Task 8

- [ ] **Step 1: Write the failing test**

```tsx
// src/features/companion/QuestionGraphPanel.test.tsx
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"

import { QuestionGraphPanel } from "./QuestionGraphPanel"
import { EDITOR_SCHEME_STORAGE_KEY } from "@/lib/editorScheme"
import type { OpResponse, QueryResult } from "notex-companion/client"

afterEach(() => {
  cleanup()
  localStorage.clear()
})

const STAMP = {
  builtAt: "2026-08-15T00:00:00.000Z",
  graphHash: "abcdef0123456789",
  nodeCount: 462,
  edgeCount: 1220,
  communityCount: 12,
  checkoutPath: "/Users/dev/notex",
  headSha: "1234567890abcdef",
  graphRoot: "/Users/dev/notex/src",
  rootPrefix: "src",
}

const NODE_A = {
  id: "n1",
  label: "authenticate",
  sourceFile: "api/middleware/auth.ts",
  sourceLocation: "L18",
  fileType: "code",
  community: { id: 1, name: "Auth" },
}
const NODE_B = {
  id: "n2",
  label: "logout",
  sourceFile: "api/middleware/auth.ts",
  sourceLocation: "L40",
  fileType: "code",
  community: { id: 1, name: "Auth" },
}

function baseResult(overrides: Partial<OpResponse<QueryResult>> = {}): OpResponse<QueryResult> {
  return {
    graph: STAMP,
    subgraph: { nodes: [NODE_A, NODE_B], edges: [], seeds: ["n1"] },
    context: { markdown: "# question\n\nevidence", sources: [] },
    ...overrides,
  }
}

function renderPanel(overrides: Partial<Parameters<typeof QuestionGraphPanel>[0]> = {}) {
  const onVariantChange = vi.fn()
  const onExpand = vi.fn()
  render(
    <QuestionGraphPanel
      checkoutPath="/Users/dev/notex"
      result={baseResult()}
      isPending={false}
      error={null}
      variant="files"
      onVariantChange={onVariantChange}
      onExpand={onExpand}
      {...overrides}
    />
  )
  return { onVariantChange, onExpand }
}

describe("QuestionGraphPanel", () => {
  it("renders nothing before a draft has been run", () => {
    const { container } = render(
      <QuestionGraphPanel
        checkoutPath="/Users/dev/notex"
        result={undefined}
        isPending={false}
        error={null}
        variant="files"
        onVariantChange={vi.fn()}
        onExpand={vi.fn()}
      />
    )
    expect(container.firstChild).toBeNull()
  })

  it("renders the Files variant by default, ranked by file", () => {
    renderPanel()
    expect(screen.getByText("api/middleware/auth.ts")).toBeTruthy()
  })

  it("switches to Evidence on click, grouped by community", () => {
    const { onVariantChange } = renderPanel()
    fireEvent.click(screen.getByRole("tab", { name: "evidence" }))
    expect(onVariantChange).toHaveBeenCalledWith("evidence")
  })

  it("renders Evidence grouped by community when the evidence variant is active", () => {
    renderPanel({ variant: "evidence" })
    expect(screen.getByText("Auth")).toBeTruthy()
    expect(screen.getByText("authenticate")).toBeTruthy()
  })

  it("disables the Draft and Canvas segments", () => {
    renderPanel()
    expect(
      screen.getByRole<HTMLButtonElement>("tab", { name: "draft" }).disabled
    ).toBe(true)
    expect(
      screen.getByRole<HTMLButtonElement>("tab", { name: "canvas" }).disabled
    ).toBe(true)
  })

  it("shows the degraded banner only when the response sets it", () => {
    renderPanel({ result: baseResult({ degraded: { expansion: "none" } }) })
    expect(screen.getByText(/Matched literally/)).toBeTruthy()
  })

  it("omits the degraded banner when absent", () => {
    renderPanel()
    expect(screen.queryByText(/Matched literally/)).toBeNull()
  })

  it("shows the truncated banner only when the response sets it", () => {
    renderPanel({
      result: baseResult({ truncated: { reason: "maxNodes", omittedCount: 12 } }),
    })
    expect(screen.getByText(/12 related nodes may be missing/)).toBeTruthy()
  })

  it("renders 'nothing convincing matched' instead of a subgraph when lowConfidence is set", () => {
    renderPanel({
      result: baseResult({ lowConfidence: { topScore: 1.5 } }),
    })
    expect(screen.getByText("Nothing convincing matched.")).toBeTruthy()
    expect(screen.queryByRole("tab", { name: "files" })).toBeNull()
    expect(screen.queryByText("api/middleware/auth.ts")).toBeNull()
  })

  it("calls onExpand from the Expand affordance", () => {
    const { onExpand } = renderPanel()
    fireEvent.click(screen.getByRole("button", { name: /Expand/ }))
    expect(onExpand).toHaveBeenCalledTimes(1)
  })

  it("copies the context markdown verbatim, and nothing else, to the clipboard", () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.assign(navigator, { clipboard: { writeText } })

    renderPanel()
    fireEvent.click(screen.getByRole("button", { name: "Copy for your agent" }))

    expect(writeText).toHaveBeenCalledWith("# question\n\nevidence")
  })

  it("builds an editor link from checkoutPath + sourceFile honouring the stored scheme", () => {
    localStorage.setItem(EDITOR_SCHEME_STORAGE_KEY, "cursor")
    renderPanel({ variant: "evidence" })

    const link = screen.getByLabelText<HTMLAnchorElement>(
      "Open api/middleware/auth.ts in editor"
    )
    expect(link.href).toBe("cursor://file/Users/dev/notex/api/middleware/auth.ts:18:1")
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bunx vitest run src/features/companion/QuestionGraphPanel.test.tsx`
Expected: FAIL — `Cannot find module './QuestionGraphPanel'`

- [ ] **Step 3: Write minimal implementation**

```tsx
// src/features/companion/QuestionGraphPanel.tsx
// The Question surface's inline result panel (graph-gui.md §2.3). Renders above the
// Answer cards. Draft and Canvas are TBR-71's own deliverable — their segments render
// disabled here so the switcher's final shape (and order) lands with this ticket.

import { RiExternalLinkLine } from "@remixicon/react"

import { rankFiles } from "./rankFiles"
import { groupEvidence } from "./groupEvidence"
import { buildEditorLink, getStoredEditorScheme } from "@/lib/editorScheme"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import type { GraphVariant } from "./questionGraphDraft"
import type { EditorScheme } from "@/lib/editorScheme"
import type { GraphEdge, GraphNode, OpResponse, QueryResult } from "notex-companion/client"

type Props = {
  checkoutPath: string | null
  result: OpResponse<QueryResult> | undefined
  isPending: boolean
  error: Error | null
  variant: GraphVariant
  onVariantChange: (v: GraphVariant) => void
  onExpand: () => void
}

const SEGMENTS = ["files", "evidence", "draft", "canvas"] as const

export function QuestionGraphPanel({
  checkoutPath,
  result,
  isPending,
  error,
  variant,
  onVariantChange,
  onExpand,
}: Props) {
  if (isPending && !result) {
    return <div className="mb-6 h-24 animate-pulse rounded-xl border bg-muted/30" />
  }
  if (error) {
    return (
      <div className="mb-6 rounded-xl border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
        Couldn&apos;t draft from the graph. {error.message}
      </div>
    )
  }
  if (!result || !checkoutPath) return null

  const scheme = getStoredEditorScheme()
  const builtDate = result.graph.builtAt.slice(0, 10)

  return (
    <div className="mb-6 rounded-xl border bg-card">
      <div className="space-y-2 border-b p-4">
        {result.degraded && (
          <p className="rounded-md bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
            Matched literally — your agent can do better.
          </p>
        )}
        {result.truncated && (
          <p className="rounded-md bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
            Results were capped ({result.truncated.reason}) — {result.truncated.omittedCount}{" "}
            related nodes may be missing.
          </p>
        )}
        <p className="font-mono text-[11px] text-muted-foreground">
          graph built {builtDate} · {result.graph.nodeCount} nodes · {result.graph.graphHash}
          {result.graph.headSha ? ` · at ${result.graph.headSha.slice(0, 7)}` : ""}
        </p>
      </div>

      {result.lowConfidence ? (
        <div className="p-4">
          <p className="text-sm font-medium">Nothing convincing matched.</p>
          <p className="mt-1 text-xs text-muted-foreground">
            No result cleared an exact match for this question — copy the evidence below for
            your own agent instead of trusting a subgraph built on a guess.
          </p>
        </div>
      ) : (
        <>
          <div className="flex items-center justify-between border-b px-4 py-2">
            <div className="flex gap-1" role="tablist" aria-label="Result variant">
              {SEGMENTS.map((seg) => {
                const disabled = seg === "draft" || seg === "canvas"
                return (
                  <button
                    key={seg}
                    type="button"
                    role="tab"
                    aria-selected={variant === seg}
                    disabled={disabled}
                    onClick={() => {
                      if (seg === "files" || seg === "evidence") onVariantChange(seg)
                    }}
                    className={cn(
                      "rounded-md px-2.5 py-1 text-xs font-medium capitalize",
                      disabled
                        ? "cursor-not-allowed text-muted-foreground/40"
                        : variant === seg
                          ? "bg-foreground text-background"
                          : "text-muted-foreground hover:bg-muted"
                    )}
                  >
                    {seg}
                  </button>
                )
              })}
            </div>
            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              <span>
                {result.subgraph.nodes.length} nodes · {result.subgraph.edges.length} edges
              </span>
              <button
                type="button"
                onClick={onExpand}
                className="underline hover:text-foreground"
              >
                Expand (depth 2)
              </button>
            </div>
          </div>

          <div className="p-4">
            {variant === "files" ? (
              <FilesVariant
                nodes={result.subgraph.nodes}
                seeds={result.subgraph.seeds}
                checkoutPath={checkoutPath}
                scheme={scheme}
              />
            ) : (
              <EvidenceVariant
                nodes={result.subgraph.nodes}
                edges={result.subgraph.edges}
                seeds={result.subgraph.seeds}
                checkoutPath={checkoutPath}
                scheme={scheme}
              />
            )}
          </div>
        </>
      )}

      <div className="flex items-center justify-between gap-4 border-t p-4">
        <Button
          size="sm"
          variant="outline"
          disabled={!result.context}
          onClick={() => {
            if (result.context) void navigator.clipboard.writeText(result.context.markdown)
          }}
        >
          Copy for your agent
        </Button>
        <p className="text-right text-[11px] text-muted-foreground">
          Evidence only — no role, framing, or instructions added.
        </p>
      </div>
    </div>
  )
}

function GraphNodeRow({
  node,
  checkoutPath,
  scheme,
  badge,
}: {
  node: GraphNode
  checkoutPath: string
  scheme: EditorScheme
  badge?: React.ReactNode
}) {
  const href = buildEditorLink({
    scheme,
    checkoutPath,
    sourceFile: node.sourceFile,
    sourceLocation: node.sourceLocation,
  })

  return (
    <div className="flex items-center justify-between gap-3 px-3 py-2 text-xs">
      <div className="min-w-0">
        <p className="truncate font-medium">{node.label}</p>
        {href ? (
          <a
            href={href}
            className="inline-flex items-center gap-1 truncate font-mono text-[11px] text-muted-foreground hover:text-foreground hover:underline"
            aria-label={`Open ${node.sourceFile} in editor`}
          >
            {node.sourceFile}:{node.sourceLocation}
            <RiExternalLinkLine className="size-3 shrink-0" />
          </a>
        ) : (
          <p className="truncate font-mono text-[11px] text-muted-foreground">
            {node.sourceFile}:{node.sourceLocation}
          </p>
        )}
      </div>
      {badge}
    </div>
  )
}

export function FilesVariant({
  nodes,
  seeds,
  checkoutPath,
  scheme,
}: {
  nodes: Array<GraphNode>
  seeds: Array<string>
  checkoutPath: string
  scheme: EditorScheme
}) {
  const files = rankFiles(nodes, seeds)
  if (files.length === 0) {
    return <p className="text-xs text-muted-foreground">No results.</p>
  }

  return (
    <div className="divide-y rounded-lg border">
      {files.map((f) => (
        <details key={f.sourceFile}>
          <summary className="flex cursor-pointer items-center justify-between px-3 py-2 text-sm">
            <span className="truncate font-mono text-xs">{f.sourceFile}</span>
            <span className="shrink-0 text-[10px] text-muted-foreground">
              {f.seedCount} seed{f.seedCount === 1 ? "" : "s"} · {f.nodes.length} nodes
            </span>
          </summary>
          <div className="divide-y border-t bg-muted/20">
            {f.nodes.map((n) => (
              <GraphNodeRow key={n.id} node={n} checkoutPath={checkoutPath} scheme={scheme} />
            ))}
          </div>
        </details>
      ))}
    </div>
  )
}

export function EvidenceVariant({
  nodes,
  edges,
  seeds,
  checkoutPath,
  scheme,
}: {
  nodes: Array<GraphNode>
  edges: Array<GraphEdge>
  seeds: Array<string>
  checkoutPath: string
  scheme: EditorScheme
}) {
  const groups = groupEvidence(nodes, seeds)
  const labelById = new Map(nodes.map((n) => [n.id, n.label]))

  return (
    <div className="space-y-4">
      {groups.map((g) => (
        <div key={g.name}>
          <p className="mb-1.5 text-[10px] font-semibold tracking-wide text-muted-foreground uppercase">
            {g.name}
          </p>
          <div className="divide-y rounded-lg border">
            {g.nodes.map(({ node, isSeed }) => (
              <GraphNodeRow
                key={node.id}
                node={node}
                checkoutPath={checkoutPath}
                scheme={scheme}
                badge={
                  isSeed ? (
                    <span className="shrink-0 rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-400">
                      seed
                    </span>
                  ) : undefined
                }
              />
            ))}
          </div>
        </div>
      ))}
      {edges.length > 0 && (
        <details>
          <summary className="cursor-pointer text-xs font-medium text-muted-foreground hover:text-foreground">
            Relations ({edges.length})
          </summary>
          <ul className="mt-2 space-y-1 rounded-lg border p-3 font-mono text-[11px]">
            {edges.map((e, i) => (
              <li key={i}>
                {labelById.get(e.source) ?? e.source} —{e.relation}→{" "}
                {labelById.get(e.target) ?? e.target}
                {e.confidence !== "EXTRACTED" && (
                  <span className="ml-1 rounded bg-muted px-1 text-[10px] uppercase text-muted-foreground">
                    {e.confidence}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  )
}
```

Note: this file uses the `React.ReactNode` type for the `badge` prop — add `import type { ReactNode } from "react"` and use `ReactNode` directly (not `React.ReactNode`) to match this codebase's import style (see `graph.tsx`'s `PickerPopover`).

- [ ] **Step 4: Run test to verify it passes**

Run: `bunx vitest run src/features/companion/QuestionGraphPanel.test.tsx`
Expected: PASS (12 tests)

- [ ] **Step 5: Commit**

```bash
git add src/features/companion/QuestionGraphPanel.tsx src/features/companion/QuestionGraphPanel.test.tsx
git commit -m "feat(companion): Question surface's inline result panel — Files, Evidence, honesty banners (TBR-70)"
```

---

### Task 8: Wire into the Question route

**Files:**
- Modify: `src/routes/dashboard/_layout/o/$organizationId/p/$projectId/r/$repoId/c/$ctxId/index.tsx`

**Interfaces:**
- Consumes: `useQuestionGraphDraft` (Task 5), `QuestionGraphAction` (Task 6), `QuestionGraphPanel` (Task 7)
- Produces: nothing new — this is the integration point; no existing route-level component in this codebase has its own test (see `graph.tsx`/`graph.test.tsx`, which only test extracted sub-components), so this task is verified by the full suite plus a manual dev-server check rather than a new test file.

- [ ] **Step 1: Add the imports**

At the top of `index.tsx`, alongside the existing `@/features/companion` import that doesn't yet exist in this file — add:

```tsx
import { QuestionGraphAction } from "@/features/companion/QuestionGraphAction"
import { QuestionGraphPanel } from "@/features/companion/QuestionGraphPanel"
import { useQuestionGraphDraft } from "@/features/companion/questionGraphDraft"
```

- [ ] **Step 2: Call the hook in `ContextPage`**

Inside `function ContextPage()`, right after the existing `const updateCtx = ...` line:

```tsx
  const draft = useQuestionGraphDraft(repoId, ctx?.question)
```

- [ ] **Step 3: Add the action button beside "Post Answer"**

Replace the existing Answers header block:

```tsx
      {/* Answers header */}
      <div className="mb-3 flex items-center justify-between">
        <p className="font-mono text-xs text-muted-foreground">
          <strong className="font-semibold text-foreground">
            {files?.length ?? 0}
          </strong>{" "}
          Answers
        </p>
        <Button size="sm" onClick={() => setShowAdd(true)}>
          <RiAddLine className="mr-1.5 size-4" />
          Post Answer
        </Button>
      </div>
```

with:

```tsx
      {/* Answers header */}
      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="font-mono text-xs text-muted-foreground">
          <strong className="font-semibold text-foreground">
            {files?.length ?? 0}
          </strong>{" "}
          Answers
        </p>
        <div className="flex items-center gap-2">
          <QuestionGraphAction
            organizationId={organizationId}
            projectId={projectId}
            repoId={repoId}
            canDraft={draft.canDraft}
            connectionState={draft.connectionState}
            isPending={draft.isPending}
            onDraft={draft.run}
          />
          <Button size="sm" onClick={() => setShowAdd(true)}>
            <RiAddLine className="mr-1.5 size-4" />
            Post Answer
          </Button>
        </div>
      </div>
```

- [ ] **Step 4: Render the panel above the Answer cards**

Immediately after the Answers header block (before the `{/* Answer cards */}` comment), add:

```tsx
      {(draft.result || draft.isPending || draft.error) && (
        <QuestionGraphPanel
          checkoutPath={draft.checkoutPath}
          result={draft.result}
          isPending={draft.isPending}
          error={draft.error}
          variant={draft.variant}
          onVariantChange={draft.setVariant}
          onExpand={draft.expand}
        />
      )}
```

- [ ] **Step 5: Run the full test suite**

Run: `bunx vitest run`
Expected: PASS — no existing test regresses, and every test added in Tasks 1–7 still passes.

- [ ] **Step 6: Run the typechecker**

Run: `bunx tsc --noEmit`
Expected: no errors. Pay particular attention to `QuestionGraphPanel.tsx`'s `ReactNode` import (Task 7's note) — a missing import here is the most likely typecheck failure.

- [ ] **Step 7: Manual verification in the dev server**

Run: `bun run dev`, open a Repository's Question page (`…/r/$repoId/c/$ctxId`).

- With no companion paired: confirm "Draft this Answer from the graph" is disabled and reads "Companion not connected — set it up." linking to the graph page.
- Pair a companion (via the graph page's Connect flow, as in TBR-68), return to the Question page: confirm the button is enabled, click it, confirm the panel appears above the Answer cards with Files selected by default.
- Click "evidence" in the switcher: confirm it switches without re-fetching (no network tab entry for `/v1/query`).
- Click "Expand (depth 2)": confirm a new `/v1/query` request fires with `depth: 2`.
- Click "Copy for your agent": confirm the clipboard contains exactly the `context.markdown` text (paste it somewhere to check — no added preamble).
- Ask a question with no plausible match in the graph (e.g. something entirely absent from the codebase): confirm "Nothing convincing matched." renders instead of a subgraph.

- [ ] **Step 8: Commit**

```bash
git add "src/routes/dashboard/_layout/o/\$organizationId/p/\$projectId/r/\$repoId/c/\$ctxId/index.tsx"
git commit -m "feat(companion): wire the graph draft action and result panel into the Question route (TBR-70)"
```

---

## Self-review notes

- **Spec coverage:** §2.1 placement (Task 8), §2.2 two-state notice (Task 1, 6), §2.3 panel layout/banners (Task 7), §2.4 four variants with Files/Evidence shipped and Draft/Canvas disabled (Task 7), §2.5 draft-state-above-switcher concern (not applicable — Draft doesn't exist yet in this ticket, noted as a TBR-71 trap), §2.6 editor links (Task 7, reusing `buildEditorLink`), §3.1 default bounds by omission + explicit expand (Task 5), §3.2 seed-score floor / lowConfidence suppression (Task 7), §3.3 honesty banners (Task 7), companion-api.md §4.7 context-block-verbatim copy (Task 7), ADR-0004 no-prompt-from-Question (Task 1/5/6, by construction of `useCompanionConnection`).
- **Type consistency:** `GraphVariant` defined once in Task 5 (`questionGraphDraft.ts`) and imported by Task 7; `QuestionGraphNotice` defined once in Task 1 and consumed by Task 6; `FileGroup`/`EvidenceGroup` defined in Tasks 2/3 and consumed only inside Task 7's variant renderers (not exposed further).
