# Context & File Q&A View — Design Spec

**Date:** 2026-04-10  
**Status:** Approved

---

## Overview

Redesign the context/file views to express a Stack Overflow-style question-answer relationship. A **context** is a question; its **files** are answers. The schema already supports this (1 context → many files via `files.contextId` FK).

---

## Visual Direction

**Aesthetic:** Editorial reference tool. Warm parchment surfaces, IBM Plex type family (Serif for questions, Mono for filenames/code, Sans for body), amber accent (`#c4a44a`). Borders-only depth — no drop shadows. Left rail stripe on answer cards activates to amber on hover.

**Token names in the existing Tailwind/CSS-variable system:** work within existing `bg-background`, `bg-card`, `border`, `text-foreground`, `text-muted-foreground` tokens. The amber accent and serif question font are additive, scoped to these new components only.

---

## Pages & Components

### 1. Context Page — Q&A Thread (`$ctxId.tsx`)

**Layout:**
- **Breadcrumb** — `repo name / question text` in monospace, small
- **Question zone** — "QUESTION" eyebrow (mono, amber), question text in serif display weight, metadata row (date added, answer count). Separated from answers by a 1.5px rule.
- **Answers header** — `N Answers` count (left) + `+ Post Answer` button (right)
- **Answer cards** — vertical stack, one per file:
  - 3px left rail, goes amber on card hover
  - Filename in IBM Plex Mono, content-type badge (text/upload)
  - Inline content preview for `text` files (monospace, max ~5 lines, fade-out)
  - Upload files show an icon + "click Open to view" label — no preview
  - `Open →` link navigates to the file detail route
  - Link and Delete action buttons
- **Post Answer area** — dashed border row at bottom, opens existing `AddFileModal`

**Interaction changes from current:**
- Remove the accordion expand on card click — clicking the card body navigates to file detail instead
- `Open →` is the explicit navigation trigger
- Delete/Link actions remain as icon buttons

---

### 2. File Detail Page — Answer View (`$ctxId/f/$fileId.tsx`) — **NEW ROUTE**

**Route:** `/dashboard/p/$projectId/r/$repoId/c/$ctxId/f/$fileId`

**Layout:**
- **Amber back-link pill** at top: `← [question text]` — navigates back to context
- **File header:** "ANSWER" eyebrow, filename in IBM Plex Mono (large), type badge, date metadata, Link + Delete actions
- **Content area:** `bg-card` surface with a toolbar row (label + line count) and full file content rendered in monospace with line numbers

**Text files:** full content displayed read-only. (Editing is out of scope for this spec — files are answers, not notes.)

**Upload files:** show filename, type badge, and a message that uploaded binary content cannot be previewed inline.

---

### 3. Sidebar — Files Under Active Context

**Change:** `RepoItem` currently expands to show contexts. Contexts now expand further to show their files.

**Behavior:**
- Each context item becomes expandable (chevron toggle)
- When expanded, fetches and shows its files as sub-items
- File items show a file icon + filename (mono, small), navigate to the file detail route
- Only the active context auto-expands; others start collapsed
- Active file item gets the same amber left-border highlight as other active items

**Data:** Uses existing `useFiles(ctxId)` hook — only called when the context is expanded (lazy).

---

## Route Structure

```
c/$ctxId.tsx            → context Q&A page (modified)
c/$ctxId/f/$fileId.tsx  → file detail page (new)
```

TanStack Router file-based routing: `$ctxId.tsx` becomes a layout shell with `<Outlet />`. The context Q&A content moves to `$ctxId/index.tsx`. The file detail is `$ctxId/f/$fileId.tsx`.

---

## Scope

**In scope:**
- Redesign `$ctxId.tsx` → split into layout + `index.tsx`
- New `f/$fileId.tsx` file detail route
- Sidebar `RepoItem` updated to show files under expanded contexts
- Route tree regeneration (TanStack Router auto-generates on save)

**Out of scope:**
- Editing file content (files are static answers)
- Syntax highlighting library (line numbers + monospace only)
- Upload file preview/download
- Voting, ordering, or marking an answer as accepted
