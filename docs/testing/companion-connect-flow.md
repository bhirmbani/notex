# Manual test: the connect-companion flow on a deployed origin

The Local Network Access (LNA) permission prompt **cannot be exercised locally** — a
`http://localhost:3000` page calling `http://127.0.0.1:7717` is loopback→loopback, which fires no
prompt at all. Everything in the permission half of this feature therefore has to be verified
against a real `https://` origin, by hand. This is the procedure (written for TBR-68's acceptance
criteria, and worth re-running whenever `src/features/companion/` or the Companion's CORS/pairing
surface changes).

Background: [ADR-0004](../adr/0004-the-lna-permission-prompt-fires-only-from-an-explicit-connect-flow.md)
(why the prompt only fires from an explicit Connect action), `docs/specs/graph-gui.md` §4–5 (the
page and its copy), `docs/specs/companion-api.md` §5–6 (CORS posture, the eight connection states).

## What you need

- **Chrome 142+ or Firefox 151+.** Safari and Brave resolve to `unsupported` by design.
- A Checkout containing `graphify-out/graph.json` — this repo has one.
- A deployed origin. `https://notex-dev.bm.workers.dev` (the `notex-dev` Worker) is the normal one.

⚠ **Read [§6 Deny path](#6-deny-path--do-this-last) before you start.** A denied prompt is a
persisted per-origin block that Chrome will never re-ask for. Deny once in your everyday profile and
that origin is burnt until you reset it in site settings.

## 0. (Optional) refresh the deploy

```bash
bun run deploy:dev          # vite build with the env's VITE_APP_URL, then wrangler deploy
bun run db:migrate:dev      # only if migrations/ has anything unapplied
```

Never plain `wrangler deploy`: it bypasses `scripts/deploy-env.mjs` and strips the Worker's vars
(TBR-80). Check what is actually live with:

```bash
npx wrangler deployments list --name notex-dev
curl -s https://notex-dev.bm.workers.dev/api/auth/ok      # {"ok":true} means auth is wired
```

## 1. Start the Companion with the deployed origin allowlisted

**This is the step that bites.** The Companion's CORS allowlist is exact-match, and defaults to
`http://localhost:3000` plus whatever `VITE_APP_URL` is set to *in the Companion's own shell*
(`packages/companion/src/cors.ts` → `resolveOrigins`). Run it bare and every call from the deployed
page fails preflight, which reaches the client as an opaque `TypeError` — so the page reports
`unreachable` and it looks like the feature is broken.

From a Checkout with a graph:

```bash
npx notex-companion@latest --origin https://notex-dev.bm.workers.dev
```

To test the working-tree build instead of the published version, from the repo root:

```bash
node packages/companion/dist/cli.js --origin https://notex-dev.bm.workers.dev
```

Copy the pairing line it prints — `http://127.0.0.1:7717/#token=…`.

## 2. Confirm the browser can do LNA at all

On the deployed page's console:

```js
await navigator.permissions.query({ name: 'loopback-network' })
```

- `state: "prompt"` — you have a fresh shot.
- throws — the page will only ever show `unsupported`.
- `state: "denied"` — this origin is already burnt in this profile; see §6.

## 3. Reach the page

Sign in on the deployed origin, then create or open an Organization → Project → Repository. The
Repository header carries the **connection-state chip**, which links to
`/dashboard/o/$organizationId/p/$projectId/r/$repoId/graph`. The chip should read unpaired, and
clicking it must **not** fire any prompt (ADR-0004).

## 4. Grant path

1. **Connect companion** → the explainer. Diff it word for word against `docs/specs/graph-gui.md`
   §5.2; the sticky-denial warning must appear *before* the prompt, not after.
2. Paste the pairing line. This is the fetch that raises Chrome's native prompt ("…wants to look
   for and connect to any device on your local network").
3. **Allow** → the preview appears with the Checkout path, HEAD sha, and node/edge counts.
4. **Confirm** the Checkout ↔ Repository binding → state becomes `connected`; the binding card and
   the staleness line render (`"This graph was built N days ago, at commit abc1234. Re-run
   graphify…"`).
5. Exercise `search` (typeahead) and `path` (the two-node picker — this page is the only place
   `path` exists).
6. Return to the Repository view: the chip must show connected there too.
7. Leave the page idle with DevTools → Network open. There must be **no repeat calls to
   127.0.0.1** — the page never auto-retries or polls.

## 5. Cheap extra states

Each is reversible, and none burns the origin.

| State | How to force it |
|---|---|
| `unreachable` | Ctrl-C the Companion, reload the graph page |
| `unauthorized` | Restart it with `--rotate-token`, reload → "The pairing token was rejected", CTA "Re-pair companion" |
| `mismatched` | Copy `graphify-out/` into another directory, run the Companion there on 7717, reload → shows the other Checkout path, CTA "Fix companion binding" |
| `unpaired` | `localStorage.removeItem('notex:companion:<repositoryId>')`, reload |
| `needs-permission` | Pair first, then reset *only* the local-network permission in site settings — the pairing stays in `localStorage` |
| `unsupported` | Open the same URL in Safari or Brave |

`outdated` needs a Companion reporting an incompatible `apiVersion`, which no published build does —
`src/features/companion/apiVersion.test.ts` covers that boundary instead.

## 6. Deny path — do this last

Two ways to get a clean shot at the prompt:

- **A separate Chrome profile** (or Guest) — recommended. The permission is per profile + origin, so
  a fresh profile gives a fresh prompt on the same origin while your main profile keeps working.
- **A fresh origin** via `npx wrangler versions upload`, which prints
  `https://<prefix>-notex-dev.bm.workers.dev`. Caveat: `VITE_APP_URL` is inlined at build time and
  `BETTER_AUTH_URL` is a Worker var, both pointing at the canonical origin, so on a preview URL the
  auth calls go cross-origin and sign-in will likely fail. Fine for an unauthenticated smoke test,
  awkward for a full run.

What to verify: deny the prompt → the page resolves to **`blocked`**, not `unreachable`, showing
*"Local network access is blocked for this site. Notex can't ask again — clear it in your browser's
site settings, then retry."* with a **Retry** CTA and no "Connect companion" button (it must never
try to re-prompt).

Recovering a burnt profile: lock icon → Site settings → reset the local-network permission, or
`chrome://settings/content/all` → search the origin → Delete data. Real users get the
clear-site-data path; as a tester the permission reset is enough.
