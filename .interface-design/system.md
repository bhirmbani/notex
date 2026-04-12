# Notex — Interface Design System

## Direction

Reference archive / knowledge catalog. The product is for technical knowledge workers building structured Q&A knowledge bases. Every page should feel like a well-organized reference index — purposeful, quiet, indexed. Not a dashboard, not a task manager.

## Feel

Dense enough to hold real information, spacious enough to scan quickly. Mono-spaced numerals and dates signal precision. Interactions are quiet — opacity transitions rather than color shifts or border changes.

## Depth strategy

**Borders only.** No box shadows on interactive elements. A single `border` defines surfaces. Hover states use `bg-muted/30` fills — no outline changes, no dramatic shifts. The system feels like it belongs on paper.

## Max width

All content pages: `mx-auto max-w-3xl`

## Spacing

Internal component padding: `px-5 py-4` for list rows, `p-6` for modals.

---

## Signature element

**Zero-padded catalog index numbers** on every list row: `01`, `02`, `03`...

```tsx
<span className="w-5 shrink-0 select-none font-mono text-xs tabular-nums text-muted-foreground/40">
  {String(i + 1).padStart(2, '0')}
</span>
```

Mono-spaced, `text-muted-foreground/40`, non-selectable, fixed `w-5` column. This is the visual fingerprint of the product.

---

## Surface elevation

| Surface | Classes |
|---|---|
| Page canvas | `bg-background` |
| Sidebar | `bg-background border-r` (same surface, border-separated) |
| List container | `rounded-xl border divide-y` |
| Modal | `bg-card rounded-xl border shadow-xl` + `backdrop-blur-sm` overlay |

---

## Typography

| Role | Classes |
|---|---|
| Page title | `text-2xl font-semibold tracking-tight` |
| Section label | `text-xs font-semibold uppercase tracking-widest text-muted-foreground` |
| List item primary | `text-sm font-medium` |
| List item secondary | `text-xs text-muted-foreground` |
| Mono data (dates, index) | `font-mono text-xs tabular-nums` |
| Stat values | `font-medium tabular-nums text-foreground` |

---

## Catalog list pattern

The primary content pattern. Used on project home (repos) and repo page (contexts).

```tsx
<div className="divide-y rounded-xl border">
  {items.map((item, i) => (
    <div
      key={item.id}
      className="group relative flex cursor-pointer items-start gap-4 px-5 py-4 transition-colors hover:bg-muted/30 first:rounded-t-xl last:rounded-b-xl"
      onClick={() => navigate(...)}
    >
      {/* Index */}
      <span className="mt-0.5 w-5 shrink-0 select-none font-mono text-xs tabular-nums text-muted-foreground/40">
        {String(i + 1).padStart(2, '0')}
      </span>

      {/* Content */}
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{item.name}</p>
        {item.description && (
          <p className="mt-1 line-clamp-1 text-xs text-muted-foreground">{item.description}</p>
        )}
      </div>

      {/* Date — hidden on mobile */}
      <span className="hidden shrink-0 font-mono text-xs tabular-nums text-muted-foreground/50 sm:block">
        {formatDate(item.createdAt)}
      </span>

      {/* Actions */}
      <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
        <button
          className="rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
          aria-label="Link"
        >
          <RiLinkM className="size-3.5" />
        </button>
        <button
          className="rounded p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
          aria-label="Delete"
        >
          <RiDeleteBinLine className="size-3.5" />
        </button>
      </div>

      {/* Nav arrow */}
      <RiArrowRightSLine className="size-4 shrink-0 text-muted-foreground/30 transition-colors group-hover:text-muted-foreground/60" />
    </div>
  ))}
</div>
```

**For question/long-text rows** (contexts): use `line-clamp-2` on the text, `items-start` alignment, and `mt-0.5` on the index number to align with the first line.

---

## Page header pattern

Used at the top of every entity page (project, repo, context).

```tsx
<div className="mb-8 border-b pb-6">
  {entity ? (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">{entity.name}</h1>
      {entity.description && (
        <p className="mt-1.5 text-sm text-muted-foreground">{entity.description}</p>
      )}
    </>
  ) : (
    /* Skeleton */
    <>
      <div className="h-8 w-48 animate-pulse rounded bg-muted/50" />
      <div className="mt-2 h-4 w-72 animate-pulse rounded bg-muted/40" />
    </>
  )}
  {/* Optional stats row */}
  <div className="mt-4 flex items-center gap-5">
    {stats.map(s => (
      <div key={s.label} className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <s.icon className="size-3.5 shrink-0" />
        <span className="font-medium tabular-nums text-foreground">{s.value}</span>
        <span>{s.label}</span>
      </div>
    ))}
  </div>
</div>
```

---

## Skeleton loading

Pulse skeletons inside the actual container shape — never plain "Loading..." text.

```tsx
/* Header skeleton */
<div className="h-8 w-48 animate-pulse rounded bg-muted/50" />
<div className="mt-2 h-4 w-72 animate-pulse rounded bg-muted/40" />

/* Row skeleton — repeat 3x inside divide-y container */
<div className="flex items-center gap-4 px-5 py-4">
  <div className="h-3 w-5 animate-pulse rounded bg-muted/50" />
  <div className="flex-1 space-y-1.5">
    <div className="h-3.5 w-32 animate-pulse rounded bg-muted/50" />
    <div className="h-3 w-48 animate-pulse rounded bg-muted/40" />
  </div>
</div>
```

---

## Empty state pattern

```tsx
<div className="flex flex-col items-center justify-center rounded-xl border border-dashed py-20 text-center">
  <div className="mb-3 flex size-11 items-center justify-center rounded-full bg-muted/50">
    <Icon className="size-5 text-muted-foreground" />
  </div>
  <p className="text-sm font-medium">No X yet</p>
  <p className="mt-1 max-w-xs text-xs text-muted-foreground">Supporting description.</p>
  <Button className="mt-5" size="sm" onClick={...}>
    <RiAddLine className="mr-1.5 size-3.5" />
    Create your first X
  </Button>
</div>
```

---

## Modal pattern

```tsx
<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
  <div className="w-full max-w-sm rounded-xl border bg-card p-6 shadow-xl">
    <h2 className="mb-1 text-base font-semibold tracking-tight">Title</h2>
    <p className="mb-5 text-xs text-muted-foreground">Supporting description.</p>
    <form className="space-y-4">
      ...
      <div className="flex justify-end gap-2 pt-1">
        <Button type="button" variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
        <Button type="submit" size="sm">Create X</Button>
      </div>
    </form>
  </div>
</div>
```

---

## Section header pattern

```tsx
<div className="mb-4 flex items-center justify-between">
  <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
    Section name
  </h2>
  <Button onClick={...} size="sm" variant="outline">
    <RiAddLine className="mr-1.5 size-3.5" />
    New
  </Button>
</div>
```
