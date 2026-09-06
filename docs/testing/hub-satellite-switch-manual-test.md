# Manual test: hub/satellite one-click switch (TBR-140)

`packages/companion`'s test suite covers every op (`register`/`heartbeat`/`deregister`/`instances`/
`hub-key`/`switch`) against an in-process `InstanceRegistry`, and `src/features/companion`'s covers
`InstancePicker.tsx`'s supporting logic (`switchConfirmation.ts`, `switchErrorCopy.ts`, the client
functions) in isolation. Nothing in either suite starts two real `notex-companion serve` processes
and races them for the hub, or drives the picker against a live one. This is the procedure for that,
written for TBR-140's second acceptance criterion — worth re-running whenever `packages/companion/
src/{registry,serve,switch,hubIdentity,http}.ts` or `src/features/companion/InstancePicker.tsx`
changes.

Background: `docs/specs/companion-api.md` §3 (pairing) and §6 (connection states),
[ADR-0004](../adr/0004-the-lna-permission-prompt-fires-only-from-an-explicit-connect-flow.md),
and the resolution comments on TBR-133 (registration protocol), TBR-134 (staleness/re-election),
TBR-135 (switch/hub-key schemas), TBR-138 (startup banners), and TBR-139 (binding confirmation).
Read [`companion-connect-flow.md`](companion-connect-flow.md) first if you haven't exercised plain
single-instance pairing before — this doc assumes that flow already works and focuses on what
hub/satellite adds on top of it.

## What you need

- `bun run dev` running (`http://localhost:3000`), signed in.
- This checkout, already linked (`.notex/notex.json` at the repo root) — real for this repo, no
  setup needed.
- A **second Repository** in the same account that has never been paired with any companion —
  create a throwaway one if you don't have a spare.
- A **second checkout directory** to act as the satellite. It only needs *some*
  `graphify-out/graph.json` to start — content doesn't matter for this test:
  ```bash
  mkdir -p /tmp/sat-checkout/graphify-out
  echo '{"directed":false,"multigraph":false,"graph":{},"nodes":[],"links":[]}' \
    > /tmp/sat-checkout/graphify-out/graph.json
  ```
- **Settings → API keys**: a key whose owner holds a Grant on the second Repository's Project (for
  the `hub_key_required` step).

LNA won't actually prompt against `localhost:3000` — see `companion-connect-flow.md`'s own note.
Everything below still exercises fully; only the permission dialog itself needs a deployed origin.

## 1. Start the hub and a satellite

From the repo root:

```bash
./node_modules/.bin/notex-companion serve
```

Expect the `hub —` banner, bound to `127.0.0.1:7717`, and a pairing line. In a second terminal:

```bash
cd /tmp/sat-checkout && /path/to/notex/node_modules/.bin/notex-companion serve
```

`7717` is taken, so this one registers as a **satellite** and prints the *same* pairing line as the
hub (TBR-138 — every process shares the hub's own line, regardless of its own role).

## 2. Baseline — direct connect still works

Open the graph page for the Repository *this* checkout is linked to, **Connect companion**, paste
the pairing line. You should land on `connected` showing this checkout's own path — confirms plain
pairing is unaffected by hub/satellite being in the mix.

## 3. See the instance picker

Open the **second** Repository's graph page (never paired) and **Connect companion** with the same
pairing line.

**Note what happens here:** `ConnectFlow`'s own "Confirm this checkout" preview shows the *hub's*
checkout (this repo) — not the second Repository's own satellite. If you click **Confirm binding**
anyway, the page lands on `connected` right away, because `confirmPairing` derives its stored
checkoutId from whatever was just fetched — a first-ever pairing is always self-consistent, even
when it's bound to the wrong checkout for what you actually wanted. That's fine: click Confirm
regardless. Even though the page now says `connected`, the instance list (TBR-137's Variant B)
should still lead the card, above the "Checkout binding" details — both instances listed, correct
role badges (`hub`/`satellite`), and link-status badges (`linked elsewhere` for the hub's checkout,
`unlinked` for the satellite's). This is what lets you fix a wrong-but-self-confirmed first pairing
in place, instead of having no way back into the picker at all.

## 4. One-click switch, including the hub-key prompt

1. Click the satellite row's **Connect this checkout** → a confirm panel appears with its checkout
   path, git remote, and HEAD (from the already-fetched instance list, no extra network call).
2. **Confirm** → since that checkout isn't linked yet, expect `hub_key_required`'s inline form.
3. Paste the API key from **Settings → API keys** → **Save & retry**.
4. Expect the page to transition to `connected`, showing the satellite's checkout. Open DevTools →
   Network: requests now go to `127.0.0.1:<the satellite's own port>`, not `:7717` — the direct
   handoff, not a hub-proxied connection.

## 5. Confirmed binding — no re-prompt

Reload the page (or navigate away and back). Since the confirmed binding is remembered
(`switchConfirmation.ts`), re-selecting the same instance should skip straight to `connected`
without showing the confirm panel again. Inspect it directly in DevTools → Application → Local
Storage: `notex:companion:<repositoryId>` (the direct-handoff pairing) and
`notex:companion:switch-confirmed:<repositoryId>` (the confirmed checkout + git identity).

## 6. Crash / hub re-election

`Ctrl-C` the **hub**'s terminal. The satellite's terminal should print it winning re-election and
becoming the new hub within a couple seconds — well before the ~45s heartbeat-timeout window, which
is the proof the fast `ECONNREFUSED` path fired rather than the staleness-pruning fallback. Reload
either graph page: existing pairings (still pointed at `:7717`) keep working, since the new hub
reuses the same persisted `~/.notex-companion/hub.json` token.

## 7. Standalone fallback

```bash
nc -l 7717   # occupy the port with something that isn't a companion
```

Start `notex-companion serve` in a third terminal. Expect it to fall back to standalone mode on an
OS-assigned port with the warning `couldn't confirm a hub on 7717 — running standalone, one-click
switching unavailable this session`, not a hang or a crash.

## 8. Cheap extra error states

| Error | How to force it | Expected copy |
|---|---|---|
| `satellite_not_registered` | Switch to an instance, then `Ctrl-C` that satellite before clicking Confirm, then click Confirm | "That checkout isn't registered with the hub anymore — it may have quit. Refresh the page and try again." |
| `unauthorized` (hub's key rejected) | Restart the hub with `--rotate-token`'s sibling — rotate the *hub key* by submitting an obviously-wrong string via the inline form against a Repository whose ids the key can't validate | "Notex rejected the hub's API key. Generate a new one and enter it below." — same inline form re-appears |
| `write_failed` | `chmod 000` the satellite checkout's `.notex` directory (create it first, empty) before confirming a switch into it | "Couldn't write .notex/notex.json in that checkout. Check the companion's own logs." — remember to `chmod 755` it back afterward |

## Known, accepted quirks (not bugs — don't file these)

- **The picker never appears for a truly `unpaired` Repository — zero pairings, ever.** It needs
  *some* existing pairing to even attempt `GET /v1/instances` with; the manual "Connect companion"
  fallback link (still present in the plain unpaired/unreachable/etc. states) is the only bootstrap
  into it. This is different from — and narrower than — the wrong-checkout-but-`connected` case
  §3 walks through, which the picker *does* now cover: once any pairing exists at all, even a
  self-confirmed one against the wrong checkout, the picker is reachable from there.
- **A satellite reached via its own direct-handoff pairing (post-switch) has no picker either.**
  Only the hub serves `GET /v1/instances`; a satellite's own pairing 404s it. `ConnectionSection`
  shows a "Pair a different companion manually" link in its place (TBR-145) so you can still get
  back into `ConnectFlow` from there — use it, or switch from a *different* Repository's tab
  that's still paired against the hub.
- **A denied/blocked LNA permission is out of scope here** — that's `companion-connect-flow.md`'s
  job, deployed-origin only.
