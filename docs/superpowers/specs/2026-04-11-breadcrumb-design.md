# Breadcrumb Navigation — Design Spec

**Date:** 2026-04-11  
**Status:** Approved

## Overview

Add consistent, clickable full-path breadcrumb navigation to all dashboard routes. Each breadcrumb segment links to its route except the last (current page), which is plain text.

## Component

**File:** `src/components/Breadcrumb.tsx`

```tsx
type BreadcrumbItem = {
  label: string        // entity name or static label; use "…" while loading
  to?: string          // TanStack Router path string; omit for plain text
  params?: Record<string, string>
}

<Breadcrumb items={BreadcrumbItem[]} />
```

- Items with `to` render as TanStack Router `<Link>`
- Last item always renders as plain text (current page), regardless of whether `to` is provided
- Separator: `/`
- Styling: `font-mono text-[10px] tracking-wide text-muted-foreground`; links get `hover:text-foreground transition-colors`
- While entity names are loading, pass `label: "…"`

## Breadcrumb per Route

| Route | Items |
|---|---|
| `/p/$projectId` | `Projects` (link → `/dashboard`) / `ProjectName` |
| `/p/$projectId/r/$repoId` | `Projects` / `ProjectName` (link) / `RepoName` |
| `/p/$projectId/r/$repoId/c/$ctxId` | `Projects` / `ProjectName` (link) / `RepoName` (link) / `ContextQuestion` |
| `/p/$projectId/r/$repoId/c/$ctxId/f/$fileId` | `Projects` / `ProjectName` (link) / `RepoName` (link) / `ContextQuestion` (link) / `FileName` |
| `/p/$projectId/notes/$noteId` | `Projects` / `ProjectName` (link) / `Notes` / `NoteName` |
| `/p/$projectId/mermaid/$diagId` | `Projects` / `ProjectName` (link) / `Mermaid` / `DiagramName` |
| `/p/$projectId/mindmap` | `Projects` / `ProjectName` (link) / `Mind Map` |

`Notes`, `Mermaid` are static plain-text labels (no index pages exist).

## File Changes

1. **New:** `src/components/Breadcrumb.tsx` — shared component
2. **`p/$projectId/index.tsx`** — add breadcrumb above project header
3. **`p/$projectId/r/$repoId/index.tsx`** — add breadcrumb above repo header; requires `useProject(projectId)` hook
4. **`p/$projectId/r/$repoId/c/$ctxId/index.tsx`** — replace existing inline breadcrumb (lines 131–141) with shared component; extend from `repo / ctx` to `Projects / project / repo / ctx`; requires `useProject(projectId)` hook
5. **`p/$projectId/r/$repoId/c/$ctxId/f/$fileId.tsx`** — add breadcrumb; remove the entire `div` at lines 63–76 (back-link + Post Answer row); move the "Post Answer" button into the existing file header actions `div` (currently holds Link and Delete buttons); requires `useProject`, `useRepository` hooks
6. **`p/$projectId/notes/$noteId.tsx`** — add breadcrumb; requires `useProject(projectId)` hook
7. **`p/$projectId/mermaid/$diagId.tsx`** — add breadcrumb; requires `useProject(projectId)` hook
8. **`p/$projectId/mindmap.tsx`** — add breadcrumb; requires `useProject(projectId)` hook

## Data Dependencies

Each page already fetches its primary entity. Some pages need to additionally fetch ancestor entities to get their display names:

- Repo page: needs `useProject(projectId)` for project name
- Context page: needs `useProject(projectId)` for project name (already has `useRepository`)
- File page: needs `useProject(projectId)` and `useRepository(repoId)` for ancestor names (already has `useContext`)
- Note/Mermaid/Mindmap pages: need `useProject(projectId)` for project name

All hooks already exist in the features directory.
