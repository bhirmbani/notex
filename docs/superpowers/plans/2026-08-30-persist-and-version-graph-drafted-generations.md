# Persist and Version Graph-Drafted Generations — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. This plan may also be split into vertical-slice tickets via `/to-tickets` — Tasks 1–2 (schema + API) have no UI dependency and can ship as one slice; Tasks 3–7 (hooks + panel + wiring) are a second slice that depends on the first.

**Goal:** Persist the Question surface's graph-drafted generation — the Files, Evidence, Draft, and Canvas variants driven by `useQuestionGraphDraft` — plus the Canvas node-explain feature (TBR-114), so navigating away and back never discards a generation and never forces re-running the companion query/expansion/synthesis. Persisted generations are grouped and versioned by the companion's `GraphStamp.graphHash`; regenerating is always an explicit user action.

**Architecture:** Two new D1 tables (`graph_generations`, `graph_node_explanations`) hold what the companion already returns plus the Draft's own text — a pure cache/store, not a wire-shape change to `packages/companion`. A new Hono route module exposes them under the existing `/organizations/:organizationId/...` REST convention. `useQuestionGraphDraft` is rebuilt around a `useQuery` over the generations list as its source of truth, with the existing browser→companion orchestration (expansion → query → synthesis) unchanged and a persistence write appended at its tail. A new sibling hook, `useGraphNodeExplanations`, does the same for the Canvas node-explain cache. Both hooks are owned at the route level and threaded down as controlled props — the same discipline `QuestionGraphPanel.tsx` already documents for `draftText`.

**Tech Stack:** React, TanStack Router/Query, Hono, Drizzle/D1, Vitest + Testing Library, Tailwind.

**Spec:** `docs/specs/graph-gui.md` §2 (Question surface) and §3 (retrieval behaviour); `docs/specs/companion-api.md` §4.4/§4.7 (query op, context block); [Map: Persist and version graph-drafted generations](https://linear.app/bmbn/issue/TBR-115) and its closed decision tickets [TBR-116](https://linear.app/bmbn/issue/TBR-116) (schema), [TBR-117](https://linear.app/bmbn/issue/TBR-117) (API), [TBR-118](https://linear.app/bmbn/issue/TBR-118) (hook redesign), [TBR-119](https://linear.app/bmbn/issue/TBR-119) (Canvas redesign) — every decision below is sourced from one of these, not invented here.

## Global Constraints

(Verbatim from TBR-115's Notes — settled by grilling on 2026-08-30, not reopened here.)

- **Storage**: server-side D1, not client-only — shared across devices/teammates with a Grant on the Project.
- **Version key**: the companion's `GraphStamp.graphHash` — one persisted generation set per `(contextId, graphHash)`.
- **Regenerate** is explicit and **overwrites** the existing row for that `graphHash` — no history of repeated regenerations within one version.
- **Draft-text autosave**: manual edits autosave (debounced) into `graph_generations`; "Save" stays the separate, unchanged action that promotes draft text into a permanent Answer (`files` row).
- **One version switcher** for the whole panel — switching versions swaps Files/Evidence/Draft together and scopes which node explanations show as cached.
- **Stale-version default**: on load, show the latest persisted generation with a "graph has changed" banner — never a blank panel.
- Canvas camera/pan/selected-node position stays **ephemeral**, not persisted. `variant` (which tab is open) is likewise pure local UI state, never persisted.
- **No retention/pruning policy** — keep every version. No DELETE route.
- Everything persisted **renders without a live companion connection**; only Regenerate and explaining a not-yet-cached node are connection-gated.
- Query/expansion/synthesis orchestration **stays browser→companion** (ADR-0003 — the companion token never reaches Notex); persistence is only an added browser→Notex write.
- **No UI prototype** — the version switcher and stale banner extend two idioms already in `QuestionGraphPanel.tsx` (the variant-tab switcher, and the one-line text banners).
- **Autosave / persist failures** show a small inline "not saved" indicator — never a silent drop.

## File structure

- `src/db/schema.ts` (modify) — add `graphGenerations`, `graphNodeExplanations`.
- `drizzle/` migration (generated) — adds the two tables.
- `src/features/companion/persistenceApi.ts` (create) — Hono routes for both tables.
- `src/api/index.ts` (modify) — mount `persistenceApi`.
- `src/features/companion/persistenceClient.ts` (create) — fetch/put/patch functions + TanStack Query key helpers, consumed by both hooks below.
- `src/features/companion/questionGraphDraft.ts` (modify) — cache-first load, `regenerate`, autosave, version switching (TBR-118).
- `src/features/companion/graphNodeExplanations.ts` (create) — `useGraphNodeExplanations` (TBR-119).
- `src/features/companion/QuestionGraphPanel.tsx` (modify) — version switcher, stale banner, autosave indicator; `CanvasVariant` cache-first explain + per-node Regenerate.
- `src/routes/dashboard/_layout/o/$organizationId/p/$projectId/r/$repoId/c/$ctxId/index.tsx` (modify) — wire the new hook and props in.

---

### Task 1: D1 schema — `graph_generations` and `graph_node_explanations`

**Files:**
- Modify: `src/db/schema.ts`

**Decision source:** [TBR-116](https://linear.app/bmbn/issue/TBR-116) resolution comment.

- [ ] **Step 1:** Add `real` to the existing `drizzle-orm/sqlite-core` import.

- [ ] **Step 2:** Add both tables, placed after `entityLinks`:

```ts
export const graphGenerations = sqliteTable(
  'graph_generations',
  {
    id: text('id').primaryKey(),
    contextId: text('context_id')
      .notNull()
      .references(() => contexts.id, { onDelete: 'cascade' }),
    graphHash: text('graph_hash').notNull(),
    builtAt: text('built_at').notNull(),
    headSha: text('head_sha'),
    nodeCount: integer('node_count').notNull(),
    edgeCount: integer('edge_count').notNull(),
    communityCount: integer('community_count').notNull(),
    questionAtGeneration: text('question_at_generation').notNull(),
    subgraph: text('subgraph').notNull(), // JSON: QueryResult['subgraph']
    context: text('context'), // JSON: QueryResult['context'] | null
    footer: text('footer'),
    lowConfidenceTopScore: real('low_confidence_top_score'),
    draftText: text('draft_text').notNull().default(''),
    draftName: text('draft_name').notNull().default('Graph draft'),
    expansionBanner: text('expansion_banner', { enum: ['noProvider', 'expansionFailed'] }),
    synthesisBanner: text('synthesis_banner', { enum: ['synthesisFailed'] }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => ({
    contextGraphHashUnique: uniqueIndex('graph_generations_context_graph_hash_unique').on(
      table.contextId,
      table.graphHash,
    ),
    contextIdIdx: index('graph_generations_context_id_idx').on(table.contextId),
  }),
)

export const graphNodeExplanations = sqliteTable(
  'graph_node_explanations',
  {
    id: text('id').primaryKey(),
    contextId: text('context_id')
      .notNull()
      .references(() => contexts.id, { onDelete: 'cascade' }),
    graphHash: text('graph_hash').notNull(),
    nodeId: text('node_id').notNull(),
    explanation: text('explanation').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => ({
    contextGraphHashNodeUnique: uniqueIndex(
      'graph_node_explanations_context_graph_hash_node_unique',
    ).on(table.contextId, table.graphHash, table.nodeId),
    contextGraphHashIdx: index('graph_node_explanations_context_graph_hash_idx').on(
      table.contextId,
      table.graphHash,
    ),
  }),
)
```

- [ ] **Step 3:** Add both to the `schema` export object.

- [ ] **Step 4:** Generate the migration: `bunx drizzle-kit generate` (or this repo's equivalent script — check `package.json`). Review the generated SQL for the two `CREATE TABLE` statements and the two unique indexes.

- [ ] **Step 5:** Run the typechecker (`bunx tsc --noEmit`) — confirms every existing `schema.*` reference still resolves.

- [ ] **Step 6: Commit**

```bash
git add src/db/schema.ts drizzle/
git commit -m "feat(db): add graph_generations and graph_node_explanations tables (TBR-116)"
```

---

### Task 2: Persistence API routes

**Files:**
- Create: `src/features/companion/persistenceApi.ts`
- Modify: `src/api/index.ts`

**Decision source:** [TBR-117](https://linear.app/bmbn/issue/TBR-117) resolution comment. Follows `src/features/files/api.ts`'s exact pattern: `checkProjectOrganizationAccess(db, { contextId }, organizationId, auth.user.id)` gates every route.

**Interfaces:**
- Produces: `GET/PUT/PATCH /organizations/:organizationId/contexts/:contextId/graph-generations[/:graphHash]` and `GET/PUT /organizations/:organizationId/contexts/:contextId/graph-generations/:graphHash/node-explanations[/:nodeId]`, consumed by Task 3.

- [ ] **Step 1:** Write `persistenceApi.ts`, mirroring `filesApi`'s structure:

```ts
import { Hono } from 'hono'
import { and, desc, eq } from 'drizzle-orm'

import type { ApiAuthEnv } from '@/api/middleware/auth'
import { getDb, schema } from '@/db'
import { forbiddenResponse } from '@/api/middleware/auth'
import { checkProjectOrganizationAccess } from '@/api/ownership'

export const persistenceApi = new Hono<ApiAuthEnv>()

function toDTO(row: typeof schema.graphGenerations.$inferSelect) {
  return {
    graphHash: row.graphHash,
    builtAt: row.builtAt,
    headSha: row.headSha,
    nodeCount: row.nodeCount,
    edgeCount: row.edgeCount,
    communityCount: row.communityCount,
    questionAtGeneration: row.questionAtGeneration,
    subgraph: JSON.parse(row.subgraph),
    context: row.context ? JSON.parse(row.context) : null,
    footer: row.footer,
    lowConfidence: row.lowConfidenceTopScore !== null ? { topScore: row.lowConfidenceTopScore } : null,
    draftText: row.draftText,
    draftName: row.draftName,
    expansionBanner: row.expansionBanner,
    synthesisBanner: row.synthesisBanner,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

persistenceApi.get(
  '/organizations/:organizationId/contexts/:contextId/graph-generations',
  async (c) => {
    const auth = c.get('auth')
    const db = getDb(c.env.DB)
    const { organizationId, contextId } = c.req.param()

    const access = await checkProjectOrganizationAccess(db, { contextId }, organizationId, auth.user.id)
    if (access.status === 'not-found') return c.json({ error: { code: 'NOT_FOUND', message: 'Context not found' } }, 404)
    if (access.status === 'no-access') return forbiddenResponse()

    const rows = await db
      .select()
      .from(schema.graphGenerations)
      .where(eq(schema.graphGenerations.contextId, contextId))
      .orderBy(desc(schema.graphGenerations.builtAt))

    return c.json(rows.map(toDTO))
  },
)

persistenceApi.put(
  '/organizations/:organizationId/contexts/:contextId/graph-generations/:graphHash',
  async (c) => {
    const auth = c.get('auth')
    const db = getDb(c.env.DB)
    const { organizationId, contextId, graphHash } = c.req.param()
    const body = await c.req.json<Omit<ReturnType<typeof toDTO>, 'graphHash' | 'createdAt' | 'updatedAt'>>()

    const access = await checkProjectOrganizationAccess(db, { contextId }, organizationId, auth.user.id)
    if (access.status === 'not-found') return c.json({ error: { code: 'NOT_FOUND', message: 'Context not found' } }, 404)
    if (access.status === 'no-access' || access.level !== 'write') return forbiddenResponse()

    const now = new Date()
    const [existing] = await db
      .select({ id: schema.graphGenerations.id })
      .from(schema.graphGenerations)
      .where(and(eq(schema.graphGenerations.contextId, contextId), eq(schema.graphGenerations.graphHash, graphHash)))

    const values = {
      contextId,
      graphHash,
      builtAt: body.builtAt,
      headSha: body.headSha,
      nodeCount: body.nodeCount,
      edgeCount: body.edgeCount,
      communityCount: body.communityCount,
      questionAtGeneration: body.questionAtGeneration,
      subgraph: JSON.stringify(body.subgraph),
      context: body.context ? JSON.stringify(body.context) : null,
      footer: body.footer,
      lowConfidenceTopScore: body.lowConfidence?.topScore ?? null,
      draftText: body.draftText,
      draftName: body.draftName,
      expansionBanner: body.expansionBanner,
      synthesisBanner: body.synthesisBanner,
      updatedAt: now,
    }

    if (existing) {
      await db.update(schema.graphGenerations).set(values).where(eq(schema.graphGenerations.id, existing.id))
    } else {
      await db.insert(schema.graphGenerations).values({ id: crypto.randomUUID(), createdAt: now, ...values })
    }

    const [row] = await db
      .select()
      .from(schema.graphGenerations)
      .where(and(eq(schema.graphGenerations.contextId, contextId), eq(schema.graphGenerations.graphHash, graphHash)))

    return c.json(toDTO(row))
  },
)

persistenceApi.patch(
  '/organizations/:organizationId/contexts/:contextId/graph-generations/:graphHash',
  async (c) => {
    const auth = c.get('auth')
    const db = getDb(c.env.DB)
    const { organizationId, contextId, graphHash } = c.req.param()
    const body = await c.req.json<{ draftText?: string; draftName?: string }>()

    const access = await checkProjectOrganizationAccess(db, { contextId }, organizationId, auth.user.id)
    if (access.status === 'not-found') return c.json({ error: { code: 'NOT_FOUND', message: 'Context not found' } }, 404)
    if (access.status === 'no-access' || access.level !== 'write') return forbiddenResponse()

    const [existing] = await db
      .select()
      .from(schema.graphGenerations)
      .where(and(eq(schema.graphGenerations.contextId, contextId), eq(schema.graphGenerations.graphHash, graphHash)))
    if (!existing) return c.json({ error: { code: 'NOT_FOUND', message: 'Generation not found' } }, 404)

    await db
      .update(schema.graphGenerations)
      .set({
        ...(body.draftText !== undefined && { draftText: body.draftText }),
        ...(body.draftName !== undefined && { draftName: body.draftName }),
        updatedAt: new Date(),
      })
      .where(eq(schema.graphGenerations.id, existing.id))

    return c.json(toDTO({ ...existing, ...body }))
  },
)

persistenceApi.get(
  '/organizations/:organizationId/contexts/:contextId/graph-generations/:graphHash/node-explanations',
  async (c) => {
    const auth = c.get('auth')
    const db = getDb(c.env.DB)
    const { organizationId, contextId, graphHash } = c.req.param()

    const access = await checkProjectOrganizationAccess(db, { contextId }, organizationId, auth.user.id)
    if (access.status === 'not-found') return c.json({ error: { code: 'NOT_FOUND', message: 'Context not found' } }, 404)
    if (access.status === 'no-access') return forbiddenResponse()

    const rows = await db
      .select()
      .from(schema.graphNodeExplanations)
      .where(and(eq(schema.graphNodeExplanations.contextId, contextId), eq(schema.graphNodeExplanations.graphHash, graphHash)))

    return c.json(
      rows.map((r) => ({ nodeId: r.nodeId, explanation: r.explanation, createdAt: r.createdAt, updatedAt: r.updatedAt })),
    )
  },
)

persistenceApi.put(
  '/organizations/:organizationId/contexts/:contextId/graph-generations/:graphHash/node-explanations/:nodeId',
  async (c) => {
    const auth = c.get('auth')
    const db = getDb(c.env.DB)
    const { organizationId, contextId, graphHash, nodeId } = c.req.param()
    const body = await c.req.json<{ explanation: string }>()

    const access = await checkProjectOrganizationAccess(db, { contextId }, organizationId, auth.user.id)
    if (access.status === 'not-found') return c.json({ error: { code: 'NOT_FOUND', message: 'Context not found' } }, 404)
    if (access.status === 'no-access' || access.level !== 'write') return forbiddenResponse()

    const now = new Date()
    const [existing] = await db
      .select({ id: schema.graphNodeExplanations.id })
      .from(schema.graphNodeExplanations)
      .where(
        and(
          eq(schema.graphNodeExplanations.contextId, contextId),
          eq(schema.graphNodeExplanations.graphHash, graphHash),
          eq(schema.graphNodeExplanations.nodeId, nodeId),
        ),
      )

    if (existing) {
      await db
        .update(schema.graphNodeExplanations)
        .set({ explanation: body.explanation, updatedAt: now })
        .where(eq(schema.graphNodeExplanations.id, existing.id))
    } else {
      await db.insert(schema.graphNodeExplanations).values({
        id: crypto.randomUUID(),
        contextId,
        graphHash,
        nodeId,
        explanation: body.explanation,
        createdAt: now,
        updatedAt: now,
      })
    }

    return c.json({ nodeId, explanation: body.explanation, createdAt: now, updatedAt: now })
  },
)
```

- [ ] **Step 2:** Mount it in `src/api/index.ts`, alongside the other feature routes:

```ts
import { persistenceApi } from '@/features/companion/persistenceApi'
// ...
api.route('/', persistenceApi)
```

- [ ] **Step 3:** Write route tests mirroring `src/api/ownership.test.ts`'s / `filesApi`'s existing coverage style: 404 on unknown context, 403 on no-Grant and read-only-Grant-attempting-write, successful GET/PUT/PATCH round-trips, and the PATCH-404-when-no-generation-exists-yet case (TBR-118 depends on this exact behavior).

- [ ] **Step 4:** Run the suite and typechecker.

- [ ] **Step 5: Commit**

```bash
git add src/features/companion/persistenceApi.ts src/api/index.ts
git commit -m "feat(companion): persistence API for graph generations and node explanations (TBR-117)"
```

---

### Task 3: Client fetch functions and query keys

**Files:**
- Create: `src/features/companion/persistenceClient.ts`

**Interfaces:**
- Produces: `graphGenerationKeys`, `graphNodeExplanationKeys`, `fetchGraphGenerations`, `putGraphGeneration`, `patchGraphGeneration`, `fetchNodeExplanations`, `putNodeExplanation` — consumed by Task 4 and Task 5.

- [ ] **Step 1:** Write it, mirroring `src/features/files/hooks.ts`'s `fetchJson`/`orgBase` pattern:

```ts
import type { GraphGenerationDTO, NodeExplanationDTO, PutGraphGenerationBody, PatchGraphGenerationBody } from './persistenceTypes'

function orgBase(organizationId: string) {
  return `/api/v1/organizations/${organizationId}`
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json() as Promise<T>
}

export const graphGenerationKeys = {
  all: ['graphGenerations'] as const,
  list: (contextId: string) => [...graphGenerationKeys.all, 'list', contextId] as const,
}
export const graphNodeExplanationKeys = {
  all: ['graphNodeExplanations'] as const,
  list: (contextId: string, graphHash: string) =>
    [...graphNodeExplanationKeys.all, 'list', contextId, graphHash] as const,
}

export function fetchGraphGenerations(organizationId: string, contextId: string) {
  return fetchJson<Array<GraphGenerationDTO>>(`${orgBase(organizationId)}/contexts/${contextId}/graph-generations`)
}

export function putGraphGeneration(
  organizationId: string,
  contextId: string,
  graphHash: string,
  body: PutGraphGenerationBody,
) {
  return fetchJson<GraphGenerationDTO>(
    `${orgBase(organizationId)}/contexts/${contextId}/graph-generations/${graphHash}`,
    { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) },
  )
}

export function patchGraphGeneration(
  organizationId: string,
  contextId: string,
  graphHash: string,
  body: PatchGraphGenerationBody,
) {
  return fetchJson<GraphGenerationDTO>(
    `${orgBase(organizationId)}/contexts/${contextId}/graph-generations/${graphHash}`,
    { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) },
  )
}

export function fetchNodeExplanations(organizationId: string, contextId: string, graphHash: string) {
  return fetchJson<Array<NodeExplanationDTO>>(
    `${orgBase(organizationId)}/contexts/${contextId}/graph-generations/${graphHash}/node-explanations`,
  )
}

export function putNodeExplanation(
  organizationId: string,
  contextId: string,
  graphHash: string,
  nodeId: string,
  explanation: string,
) {
  return fetchJson<NodeExplanationDTO>(
    `${orgBase(organizationId)}/contexts/${contextId}/graph-generations/${graphHash}/node-explanations/${nodeId}`,
    { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ explanation }) },
  )
}
```

Also create `persistenceTypes.ts` with the `GraphGenerationDTO`/`NodeExplanationDTO`/`PutGraphGenerationBody`/`PatchGraphGenerationBody` types, exactly as specified in TBR-117's resolution comment.

- [ ] **Step 2:** Unit test each function against a mocked `fetch`, mirroring `files/hooks`'s existing test coverage.

- [ ] **Step 3: Commit**

```bash
git add src/features/companion/persistenceClient.ts src/features/companion/persistenceTypes.ts
git commit -m "feat(companion): client fetch functions for graph generation persistence (TBR-117)"
```

---

### Task 4: Redesign `useQuestionGraphDraft`

**Files:**
- Modify: `src/features/companion/questionGraphDraft.ts`

**Decision source:** [TBR-118](https://linear.app/bmbn/issue/TBR-118) resolution comment — reproduced there in full (state shape, reseed triggers, `regenerate`, autosave). Implement exactly as specified there:

- [ ] **Step 1:** Add the `generationsQuery` (`useQuery` over `graphGenerationKeys.list(contextId)`), `selectedGraphHash` state, and the derived `shown`/`liveGraphHash`/`isStale`/`hasGeneration` values.
- [ ] **Step 2:** Delete `lastResult` and its `useEffect` on `mutation.data`; replace with the two reseed triggers (version-switch `useEffect` keyed on `shown?.graphHash`, and the imperative reseed inside `regenerate()`'s success path) exactly as TBR-118 specifies.
- [ ] **Step 3:** Rename `run`'s/`expand`'s shared body to `regenerate(extra)`; append the trailing `PUT` (or the initial insert) after the synthesis outcome settles, with `resultVersion`/`queriedQuestion`/`expansionVersion`/`synthesisVersion` guarding it exactly as today.
- [ ] **Step 4:** Add the debounced autosave `useEffect` and `autosaveState` exactly as specified.
- [ ] **Step 5:** Update the hook's return shape per TBR-118's "Return shape changes" section.
- [ ] **Step 6:** Update `questionGraphDraft.test.tsx` to cover: cache-first render with no companion call when a generation already exists, `regenerate()` resetting `selectedGraphHash` to `null`, a version-switch not clobbering an in-progress edit, and an autosave PATCH failure setting `autosaveState: "failed"`.
- [ ] **Step 7:** Run the suite and typechecker.

- [ ] **Step 8: Commit**

```bash
git add src/features/companion/questionGraphDraft.ts src/features/companion/questionGraphDraft.test.tsx
git commit -m "feat(companion): cache-first load, regenerate, and autosave for useQuestionGraphDraft (TBR-118)"
```

---

### Task 5: `useGraphNodeExplanations`

**Files:**
- Create: `src/features/companion/graphNodeExplanations.ts`
- Test: `src/features/companion/graphNodeExplanations.test.tsx`

**Decision source:** [TBR-119](https://linear.app/bmbn/issue/TBR-119) resolution comment.

- [ ] **Step 1:** Write the hook exactly as specified in TBR-119's resolution: a `useQuery` over `graphNodeExplanationKeys.list(contextId, graphHash)` (enabled only when `graphHash` is defined), reducing to a `Map<nodeId, explanation>`.
- [ ] **Step 2:** Write tests: empty map when `graphHash` is undefined (no fetch), map populated from the list response, refetch when `graphHash` changes.
- [ ] **Step 3: Commit**

```bash
git add src/features/companion/graphNodeExplanations.ts src/features/companion/graphNodeExplanations.test.tsx
git commit -m "feat(companion): useGraphNodeExplanations cache hook (TBR-119)"
```

---

### Task 6: Redesign `QuestionGraphPanel` — version switcher, stale banner, autosave indicator, Canvas cache-first explain

**Files:**
- Modify: `src/features/companion/QuestionGraphPanel.tsx`

**Interfaces:**
- New `Props` fields: `generations: Array<GraphGenerationDTO>`, `selectedGraphHash: string | null`, `onSelectVersion: (graphHash: string) => void`, `isStale: boolean`, `autosaveState: "idle" | "pending" | "saved" | "failed"`, `nodeExplanations: Map<string, string>`, `explainingNodeId: string | null`, `onExplainNode: (nodeId: string, context: NodeExplanationContext) => void`.

- [ ] **Step 1:** Add the version switcher — a small control in the panel header (near the existing stamp line at the top of the file's `QuestionGraphPanel` body) listing `generations` by `builtAt`/`graphHash`, calling `onSelectVersion` on pick. No new visual idiom (per TBR-115's Notes) — style it as a lightweight dropdown/segmented control consistent with the existing variant-tab switcher.
- [ ] **Step 2:** Add the stale banner — one more line alongside the existing `degraded`/`truncated` banners, rendered when `isStale` is true: "The graph has changed since this was drafted — Regenerate to refresh." Never rendered when `false` (same omit-don't-render-none rule as the existing banners).
- [ ] **Step 3:** Add the autosave indicator near the Draft textarea, rendered from `autosaveState`: nothing when `"idle"`/`"saved"`, a small "Saving…" while `"pending"`, a small "Not saved" note when `"failed"` — same visual weight as the existing `saved`/`isSaving` "Save as Answer" indicator, kept as a visually distinct, separate element (they're different actions).
- [ ] **Step 4:** In `CanvasVariant`, apply TBR-119's changes exactly as specified: thread `nodeExplanations`/`explainingNodeId`/`onExplainNode` down as new props (replacing the direct `synthesizeNodeExplanation` import and local `explainState`/`explainVersion` machinery — that logic moves up into `useGraphNodeExplanations` and the route-level wiring per TBR-119); the reset-on-`[selectedId]` effect now seeds from the `nodeExplanations` map instead of always `{status:"idle"}`; the button label becomes `"Regenerate"`/`"Explain"` based on whether prose is already showing.
- [ ] **Step 5:** Update `QuestionGraphPanel.test.tsx` and add a `CanvasVariant`-focused test file: version switcher renders every generation and calls `onSelectVersion`; stale banner shows/hides on `isStale`; autosave indicator reflects each `autosaveState` value; Canvas renders a cached explanation instantly (no `synthesizeNodeExplanation` call) when `nodeExplanations` already has the selected node.
- [ ] **Step 6:** Run the suite and typechecker.

- [ ] **Step 7: Commit**

```bash
git add src/features/companion/QuestionGraphPanel.tsx src/features/companion/QuestionGraphPanel.test.tsx
git commit -m "feat(companion): version switcher, stale banner, autosave indicator, cache-first Canvas explain (TBR-118, TBR-119)"
```

---

### Task 7: Wire into the Question route

**Files:**
- Modify: `src/routes/dashboard/_layout/o/$organizationId/p/$projectId/r/$repoId/c/$ctxId/index.tsx`

Current wiring (as of this plan) calls `useQuestionGraphDraft(repoId, ctx?.question, organizationId, ctxId)` at line 137 and passes its fields into `QuestionGraphAction`/`QuestionGraphPanel` at lines 200–235.

- [ ] **Step 1:** Add the import: `import { useGraphNodeExplanations } from "@/features/companion/graphNodeExplanations"`.
- [ ] **Step 2:** Right after the existing `const draft = useQuestionGraphDraft(...)` line, add:

```tsx
  const nodeExplanations = useGraphNodeExplanations(organizationId, ctxId, draft.shown?.graphHash)
```

- [ ] **Step 3:** Update the `QuestionGraphPanel` element to pass the new props alongside the existing ones:

```tsx
      {(draft.result || draft.hasGeneration || draft.isPending || draft.error) && (
        <QuestionGraphPanel
          result={draft.result}
          generations={draft.generations}
          selectedGraphHash={draft.selectedGraphHash}
          onSelectVersion={draft.selectVersion}
          isStale={draft.isStale}
          autosaveState={draft.autosaveState}
          isPending={draft.isPending}
          error={draft.error}
          variant={draft.variant}
          onVariantChange={draft.setVariant}
          onExpand={draft.expand}
          draftText={draft.draftText}
          onDraftTextChange={draft.setDraftText}
          draftName={draft.draftName}
          onDraftNameChange={draft.setDraftName}
          onSave={draft.save}
          isSaving={draft.isSaving}
          saveError={draft.saveError}
          saved={draft.saved}
          canRetrieve={draft.canDraft}
          expansionBanner={draft.expansionBanner}
          synthesisBanner={draft.synthesisBanner}
          isSynthesizing={draft.isSynthesizing}
          nodeExplanations={nodeExplanations.explanations}
          explainingNodeId={nodeExplanations.explainingNodeId}
          onExplainNode={nodeExplanations.explainNode}
        />
      )}
```

(`draft.result` in TBR-118's redesign is the renamed/repointed `shown` — keep the prop name `result` on `QuestionGraphPanel` unchanged per TBR-118's return-shape note, so this line and Task 6 need no further renaming churn.)

- [ ] **Step 4:** Update the `QuestionGraphAction` button's `onDraft` — still `draft.run`, unchanged (Task 4 keeps `run`/`expand` as thin wrappers over `regenerate`).
- [ ] **Step 5:** Run the full suite: `bunx vitest run`.
- [ ] **Step 6:** Run the typechecker: `bunx tsc --noEmit`.
- [ ] **Step 7: Manual verification in the dev server**

Run: `bun run dev`, open a Repository's Question page.

- Draft an Answer from the graph, navigate away, navigate back: confirm the panel shows the same content instantly, with no `/v1/query` request in the network tab.
- Edit the Draft text, wait ~1s, refresh the page: confirm the edit survived (autosaved).
- Click "Regenerate": confirm a fresh companion call fires and the panel updates.
- With more than one persisted version (regenerate after `graphify` rebuilds locally, or manually insert a second row for testing): confirm the version switcher lists both, and switching shows each version's own Files/Evidence/Draft/Canvas content with no additional network request.
- Disconnect the companion (stop it), reload the Question page: confirm the panel still renders the last persisted generation, and only Regenerate/new-node-Explain are disabled.
- On the Canvas variant, explain a node, reload the page, reselect the same node: confirm the explanation renders instantly with no `synthesizeNodeExplanation` call, then click "Regenerate" on it and confirm it overwrites without affecting a second, previously-explained node.

- [ ] **Step 8: Commit**

```bash
git add "src/routes/dashboard/_layout/o/\$organizationId/p/\$projectId/r/\$repoId/c/\$ctxId/index.tsx"
git commit -m "feat(companion): wire persisted generations and node explanations into the Question route (TBR-118, TBR-119)"
```

---

## Self-review notes

- **Decision coverage:** [TBR-116](https://linear.app/bmbn/issue/TBR-116) → Task 1 (schema, verbatim). [TBR-117](https://linear.app/bmbn/issue/TBR-117) → Task 2 (routes) and Task 3 (client). [TBR-118](https://linear.app/bmbn/issue/TBR-118) → Task 4 (hook redesign). [TBR-119](https://linear.app/bmbn/issue/TBR-119) → Task 5 (new hook) and Task 6 Step 4 (Canvas). Global Constraints (TBR-115's Notes) → Task 6 Steps 1–3 (version switcher, stale banner, autosave indicator) and the "no DELETE route" / "no retention policy" omissions throughout Task 2.
- **Type consistency:** `GraphGenerationDTO`/`NodeExplanationDTO`/`PutGraphGenerationBody`/`PatchGraphGenerationBody` defined once in `persistenceTypes.ts` (Task 3), consumed by Task 2 (server-side, mirrored shape), Task 4, Task 5, and Task 6. `graphGenerationKeys`/`graphNodeExplanationKeys` defined once in `persistenceClient.ts`, consumed by Tasks 4–6.
- **No invented scope:** every schema field, route, and hook behavior above is transcribed from TBR-116/117/118/119's resolution comments — this plan adds no decision beyond what the map already settled. The only net-new content here is Hono/Drizzle boilerplate (query construction, upsert existence-check pattern) needed to make the already-decided shapes executable, following `src/features/files/api.ts`'s existing pattern throughout.
