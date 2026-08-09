# Issue tracker: Linear

Issues and specs for this repo live in Linear, team **TBR** (Engineering), project **Notex**.

## Conventions

- **Create an issue**: use the Linear MCP server's create-issue tool, targeting team `TBR` and project `Notex`. Always write the `description` using the issue template below — don't omit sections, even if brief. Always set an `estimate` (see below) — never leave it unset.
- **Read / list issues**: use the Linear MCP server's search/list/get tools, scoped to team `TBR`, project `Notex`.
- **Comment on an issue**: use the Linear MCP server's comment tool.
- **Update status / labels**: use the Linear MCP server's update tool.

If the Linear MCP server isn't connected in the current session, ask the user to connect it (or to supply the issue ID/URL directly) rather than guessing at issue content.

## Issue template

Every new issue's `description` must follow this structure:

```markdown
## Description

## Acceptance criteria

## Impact & Risk Assessment
```

Fill each section in with real content — don't leave a section as just the heading.

## Estimates

Estimate points are enabled on team TBR. Every issue must be created with an `estimate` — don't leave it unset, and don't defer it to a later edit.

- Set `estimate` on **leaf/slice issues** (the ones actually implemented) based on scope — a single vertical slice, sized to fit one context window, is typically small (1–3).
- **Parent/epic issues** (ones that exist only to group sub-issues) get `estimate: 0` — Linear doesn't roll sub-issue estimates up automatically, and a manually-set non-zero parent estimate would just go stale as sub-issues change.
- If a ticket's scope is genuinely unclear, that's a sign it needs to be split further (see `/to-tickets` below) — not a reason to guess at an estimate or skip it.

## When a skill says "publish to the issue tracker"

Create a Linear issue in team TBR, project Notex.

## When a skill says "fetch the relevant ticket"

Look it up in Linear, team TBR, project Notex, via the MCP server.

## Breaking a feature into tickets (`/to-tickets`)

When a feature is broken into multiple vertical-slice tickets:

- **Create a parent issue** for the feature (using the template above), then create each slice as a **sub-issue** of it (`parentId` set to the parent). Don't create a flat list of unrelated issues — the parent groups them and carries the overall acceptance criteria.
- **Use Linear's native blocking relation** (`blockedBy`/`blocks`) to encode dependency order between sub-issues — not a prose "Blocked by" section. Prose is still fine as a one-line explanation of *why* a dependency exists (e.g. "shares the same file, sequenced to avoid merge conflicts"), but the actual relation must be set on the issue itself so the dependency is queryable and enforced in the UI.
- **Apply the `ready-for-agent` label** to each sub-issue (create the label in team TBR if it doesn't exist yet) — it marks the ticket as scoped and grabbable by an agent without further clarification. Don't apply it to the parent issue itself, only to the leaf/slice tickets.

## Implementing tickets (`/implement`)

When implementing a parent issue that has sub-issues, implement each sub-issue individually — never implement the parent as one big change.

- **One branch per sub-issue.** Before starting a sub-issue's work, create a new branch off the current base branch using the sub-issue's Linear-provided `gitBranchName` (returned on the issue, e.g. `feature/tbr-19-build-inline-edit-primitive-wire-project-name-editing`) — don't invent your own branch name.
- **Respect the blocking order.** Implement sub-issues in an order consistent with their `blockedBy` relations — a blocked sub-issue's branch should start from a base that already contains its blocker's changes (merge/rebase the blocker's branch in, or branch from it directly) rather than from a stale base.
- **Commit and stop per branch.** Finish, typecheck, test, and commit each sub-issue on its own branch before moving to the next — don't accumulate multiple sub-issues' changes uncommitted across branches.
- **Open a stacked PR per sub-issue as soon as its branch is committed** — don't batch PR creation until the end. The PR's base branch is whatever branch it was actually created *from* in git (its blocker's branch), not always `main`:
  - The first sub-issue in the chain (no blockers, or whose blocker is already on `main`) opens its PR with base `main`.
  - Every subsequent sub-issue opens its PR with base set to its blocker's branch — i.e. the PR chain mirrors the actual git branch topology, not a flattened "everything targets main" list.
  - Merge sequentially, oldest first. **Delete each branch when its PR merges** (`gh pr merge --delete-branch`, or the "Delete branch" button on GitHub) — auto-retargeting of downstream PRs to the next base only fires on branch deletion, not on merge alone. Skipping this silently strands downstream PRs pointed at a now-stale branch: they'll still merge "successfully," but their commits land on that stale branch instead of flowing to `main`, and nobody notices until someone checks whether `main` actually has everything.
  - If two sub-issues share the same blocker but not each other (siblings, e.g. both only blocked by the primitive-building ticket), they branch from and PR against that same shared blocker branch, not against each other.
  - **After the last PR in a chain merges, verify `main` actually contains every sub-issue's commit** (e.g. `git merge-base --is-ancestor <sub-issue-commit> origin/main` for each) rather than assuming a "merged" PR state means the code reached `main` — a PR can show as merged while its commits are stuck on a stale intermediate branch, exactly as above.
