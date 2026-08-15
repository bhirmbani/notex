# TBR-54 — Can an `https://` page call `http://127.0.0.1` today, and what is the Local Network Access timeline?

**Research date:** 2026-08-15
**Branch:** `research/tbr-54-loopback-browser-policy`
**Ticket:** [TBR-54](https://linear.app/bmbn/issue/TBR-54/research-can-an-https-page-call-httplocalhost-today-and-what-is-the) (parent TBR-53)
**Baseline versions at time of writing:** Chrome stable **152** (2026-08-12, chromiumdash), Firefox stable **153.0.4** (2026-07-21, product-details), Safari **26.6** (WebKit blog 2026-07-27).

---

## TL;DR

The world changed under this assumption. **Private Network Access preflights are dead**; they were replaced by a **user-facing permission prompt (Local Network Access)** which is **already shipped and enabled by default in Chrome (since 142, Oct 2025) and Firefox (since 151, May 2026)**, and covers **loopback**, not just LAN IPs.

| Engine | `fetch('http://127.0.0.1:PORT')` from an `https://` page, today | Verdict |
|---|---|---|
| **Chrome / Edge ≥142** | Works **only after the user grants the `loopback-network` permission** via a prompt. Grant also relaxes mixed content. Denial = network error, persisted. | ⚠️ Works, gated by a prompt |
| **Firefox ≥151** | Same shape: permission prompt required, on by default for all users. | ⚠️ Works, gated by a prompt |
| **Safari 26.x** | **Blocked.** WebKit still treats loopback as mixed content (bug 171934, still `NEW`). LNA implementation (bug 250607) is unshipped, actively in progress as of 2026-08-13. | ❌ Does not work |
| **Brave** | Blocked by default; most sites cannot even prompt. | ❌ Does not work |

**Recommendation: do not ship plain `http://127.0.0.1` as the only transport.** See [Recommendation](#recommendation).

---

## 1. Mixed content: what "potentially trustworthy loopback" actually buys you

The W3C "Secure Contexts" definition treats `127.0.0.0/8`, `::1/128` and `localhost` as *potentially trustworthy*, which is why `https://` → `http://127.0.0.1` was historically **not** blocked as mixed content in Chrome and Firefox. That part is still true, but it is no longer the binding constraint — the LNA permission is.

- **Chrome:** LNA "is restricted to secure contexts. If granted, the permission additionally relaxes mixed content blocking for local network requests (since many local devices are not able to obtain publicly trusted TLS certificates for various reasons)." — [Chrome Platform Status feature 5152728072060928](https://chromestatus.com/feature/5152728072060928), summary last edited **2026-07-15**.
- **Spec:** mixed-content upgrade/block steps are skipped when the host is a private IP literal, a `.local` name, or the request explicitly sets `targetAddressSpace`. — [Local Network Access spec](https://wicg.github.io/local-network-access/), *Draft Community Group Report, **7 August 2026***.
- **Safari is the outlier, still.** [WebKit bug 171934 — "Don't treat loopback addresses (127.0.0.0/8, ::1/128, localhost, .localhost) as mixed content"](https://bugs.webkit.org/show_bug.cgi?id=171934) is **still status `NEW`**. ⚠️ *Freshness caveat: the most recent comment on that bug is from **June 2023**, older than I would like for a "current behavior" claim.* It is corroborated by a much fresher secondary signal: an [Apple Developer Forums thread from January 2026](https://developer.apple.com/forums/thread/811690) where a developer reports local-network requests blocked in Safari but working in Chrome, and the Apple DTS engineer responds by pointing at OS-level local-network privacy (TN3179) rather than saying "this works".

**Practical consequence:** on Chrome/Firefox you should set `targetAddressSpace: "loopback"` explicitly on the request. It both declares intent before DNS resolution and deterministically skips the mixed-content check, instead of relying on the browser recognising the IP literal.

```js
const res = await fetch("http://127.0.0.1:PORT/status", {
  mode: "cors",
  targetAddressSpace: "loopback", // spec option; skips mixed-content checks
});
```

Source for the option: [MDN — Local network access](https://developer.mozilla.org/en-US/docs/Web/Security/Defenses/Local_network_access) (last modified **2026-08-12**) and the [spec](https://wicg.github.io/local-network-access/) (2026-08-07).

---

## 2. Dated timeline: PNA → LNA

| Date | Milestone | Source |
|---|---|---|
| **2022-08** | Chrome 104 ships **PNA preflights in warning-only mode**. Preflight sends `Access-Control-Request-Private-Network: true`, expects `Access-Control-Allow-Private-Network: true`. Failures logged to DevTools, request proceeds anyway. | [chromestatus 5737414355058688](https://chromestatus.com/feature/5737414355058688) — "Enabled by default", M104 |
| **2024-10-09** | Chrome puts **PNA enforcement on hold** "due to a number of compatibility problems"; says it is "considering alternatives such as additional permissions". | [developer.chrome.com/blog/pna-on-hold](https://developer.chrome.com/blog/pna-on-hold) |
| **2025-03-06** | LNA chromestatus entry created by cthomp@chromium.org. | chromestatus API `created` field |
| **2025-06-09** | Chrome announces the **LNA permission prompt**, superseding PNA. Opt-in testing via `chrome://flags#local-network-access-check` (Chrome 138). | [developer.chrome.com/blog/local-network-access](https://developer.chrome.com/blog/local-network-access) (published 2025-06-09, updated 2025-09-29) |
| **2025-06-26** | Standards positions requested from [Mozilla (#1260)](https://github.com/mozilla/standards-positions/issues/1260) and [WebKit (#520)](https://github.com/WebKit/standards-positions/issues/520). Both still formally unlabelled. | GitHub |
| **2025-09-03** | **Intent to Ship** posted to blink-dev; LGTM1 from Alex Russell; TAG review "issues addressed". Explicitly: **no preflight, no server opt-in headers.** | [blink-dev thread](https://groups.google.com/a/chromium.org/g/blink-dev/c/cwu_RUmBpzY) |
| **2025-10-28** | **Chrome 142 stable** — "Chrome 142 restricts the ability to make requests to the user's local network, gated behind a permission prompt." | [Chrome 142 release notes](https://developer.chrome.com/release-notes/142) |
| **2026-02-10** | **Chrome 145** splits the permission into **`local-network`** and **`loopback-network`**; `local-network-access` kept as an alias. | [Chrome 145 release notes](https://developer.chrome.com/release-notes/145) |
| ~2026-03 | **Chrome 146** adds enterprise policies `LocalNetworkAccessIpAddressSpaceOverrides`, `LocalNetworkAccessPermissionsPolicyDefaultEnabled`. | chromestatus summary (edited 2026-07-15) |
| **2026-03-24** | Safari 26.4 ships a *bug fix* — "`fetch()` would throw a `TypeError` when using `targetAddressSpace: 'loopback'`". Evidence WebKit has partial plumbing, **not** a shipped feature announcement. | [WebKit Features for Safari 26.4](https://webkit.org/blog/17862/webkit-features-for-safari-26-4/) |
| **2026-04-07** | **Chrome 147** extends LNA to **WebSockets, WebTransport**, and `WindowClient.navigate()`. | [Chrome 147 release notes](https://developer.chrome.com/release-notes/147) |
| **2026-05-19** | **Firefox 151** — "Local network access restrictions are now rolling out to all users. Firefox requires websites to request permission before connecting to devices on your local network or to apps and services on your device." (Firefox 149 had it on for ETP=Strict users only.) | [Firefox 151.0 release notes](https://www.firefox.com/en-US/firefox/151.0/releasenotes/) |
| **2026-08-07** | LNA spec draft republished. | [wicg.github.io/local-network-access](https://wicg.github.io/local-network-access/) |
| **2026-08-13** | **WebKit actively implementing**: bug 321725 "Classify address spaces beyond the ranges in the Local Network Access spec" filed with PR #71581 — `determineIPAddressSpace()` was mis-classifying and failing to recognise `localhost`/`.local` by hostname. | [WebKit bug 321725](https://bugs.webkit.org/show_bug.cgi?id=321725) |
| **Future (Chrome 156)** | `LocalNetworkAccessRestrictionsTemporaryOptOut` enterprise policy is **removed**. Last escape hatch closes. | chromestatus summary |

**Direction of travel is unambiguous:** the gate is tightening, not loosening, and it is expanding to more transports (WebSocket/WebTransport already gone in Chrome 147). Any design that assumes silent loopback access is on a shrinking runway.

### Where Safari lands

- [WebKit bug 250607 "Implement Local Network Access"](https://bugs.webkit.org/show_bug.cgi?id=250607) — filed 2023-01-13, **status `NEW`**, most recent comment 2025-06-26. Sub-bugs for the feature flag, IDL, WPT imports and the fetch extension are **resolved**, so the implementation is under way behind a flag.
- No WebKit standards position has been recorded on [#520](https://github.com/WebKit/standards-positions/issues/520) (opened 2025-06-26, still unlabelled).
- **Read:** Safari is likely to arrive at the *same* permission-prompt destination within a few releases, and until it does, loopback is simply blocked there. Either way Safari never becomes a "silent plain-http works" browser.

---

## 3. The exact CORS / preflight header set the companion must implement

**LNA adds no headers.** This is stated three ways:

- Spec: "This specification explicitly does not employ CORS preflight requests… No special response headers like `Access-Control-Allow-Private-Network` are required." ([spec](https://wicg.github.io/local-network-access/), 2026-08-07)
- Explainer: LNA "differs by gating access on a permission rather than via preflight requests." ([WICG explainer](https://github.com/WICG/local-network-access/blob/main/explainer.md))
- Intent to Ship: "No preflight headers or server-side changes are required." ([blink-dev, 2025-09-03](https://groups.google.com/a/chromium.org/g/blink-dev/c/cwu_RUmBpzY))

So what the companion needs is **ordinary CORS**, nothing exotic:

### Preflight response — `OPTIONS http://127.0.0.1:PORT/*`

```http
HTTP/1.1 204 No Content
Access-Control-Allow-Origin: https://notex.example        # echo the exact origin; NEVER "*" if credentials are used
Access-Control-Allow-Methods: GET, POST, OPTIONS
Access-Control-Allow-Headers: content-type, authorization, x-notex-token
Access-Control-Max-Age: 600
Vary: Origin
Access-Control-Allow-Private-Network: true                # OPTIONAL, legacy-safe; see note
```

### Actual response — every real request

```http
Access-Control-Allow-Origin: https://notex.example
Vary: Origin
Access-Control-Allow-Credentials: true                    # ONLY if you use cookies; then ACAO must not be "*"
Access-Control-Expose-Headers: <any non-safelisted response header the page reads>
```

Notes:

1. **A preflight is triggered by your own request shape, not by LNA** — any non-simple method, a `Content-Type: application/json`, or a custom auth header forces an `OPTIONS`. Do not skip implementing `OPTIONS`.
2. **`Access-Control-Allow-Private-Network: true` is optional but harmless.** Chrome's PNA warning-only preflight (M104) is still nominally in the codebase and never became enforcing; sending the header costs nothing and silences DevTools warnings on older Chrome/Edge. It is *not* part of LNA and does **not** substitute for the permission.
3. **Do not use `Access-Control-Allow-Origin: *`** — pin to the exact Notex origin(s). A loopback server that accepts `*` is exactly the CSRF surface LNA exists to shut down.
4. **Prefer a bearer token in a header over cookies.** Avoids `Allow-Credentials`, avoids SameSite pitfalls, and forces a preflight you control.
5. **Permissions-Policy delegation** — if the companion call ever happens inside an iframe, the embedder must delegate:
   `Permissions-Policy: loopback-network=("https://notex.example")` (plus `local-network=(...)` if LAN targets are ever in scope). ([MDN, 2026-06-08](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Permissions-Policy/loopback-network))

---

## 4. What the UX becomes

The prompt has already landed. This is not a hypothetical.

- **Trigger:** the first local-network request from the origin. Per the explainer: "When a site makes a local network request, the UA should check if the origin has already been granted the permission. If not, **the request should be blocked while the UA displays a prompt**."
- **Wording (Chrome):** *"<site> wants to look for and connect to any device on your local network."* This is a **scary-sounding, wide-scope prompt** — users read "any device on your local network", not "one helper app I just installed".
- **Persistence:** it is a standard persisted per-origin permission, like camera/mic. Chrome remembers Allow. Firefox: "You can also choose to have Firefox remember your decision for all future visits. You can change it anytime in your Settings." ([SUMO](https://support.mozilla.org/en-US/kb/control-personal-device-local-network-permissions-firefox))
- **Denial:** "If the user denies the permission prompt, the request fails" — surfaced as a **network error**, i.e. `fetch()` rejects with an opaque `TypeError`, **indistinguishable from "companion not running"**. This is the nastiest part for us: our error handling cannot tell "user blocked you" from "no companion installed" without calling `navigator.permissions.query({name: "loopback-network"})` first.
- **Recovery from a Block is bad.** It is buried in site settings; Adobe's own docs for their add-on tooling tell developers that if a user hits Block they must go clear browsing data for the site. Not a support path we want.
- **Detect before you call:**

```js
const status = await navigator.permissions.query({ name: "loopback-network" });
// "granted" | "prompt" | "denied"  — branch the UI before firing the fetch
```

- **Secure context is mandatory**, and there is no non-secure fallback: "The permissions are restricted to secure contexts. On non-secure contexts, all requests will fail." ([MDN, 2026-08-12](https://developer.mozilla.org/en-US/docs/Web/Security/Defenses/Local_network_access))
- **Enterprise fleets can pre-grant or pre-block.** `LocalNetworkAccessAllowedForUrls` / `LocalNetworkAccessBlockedForUrls` (Chrome), `LocalNetworkAccess` (Firefox). Good news if Notex ever sells into managed fleets: a one-line policy removes the prompt. Bad news: some fleets will **block** it wholesale and we will never see the request.

### Real-world evidence that this hurts

- **Dell** published a KB (last modified **2026-07-02**) titled *"Dell Online Support Experience Impacted Due to Local Network Access Restrictions"*: dell.com/support talking to the local SupportAssist agent breaks when users hit Block, producing bogus "install SupportAssist" prompts and dead driver-update flows. Dell's remediation is a user-facing walkthrough of Chrome/Edge site settings.
- Similar public breakage notices exist from Duo Desktop, Twingate, ServiceNow and Dynamsoft. The pattern is consistent: **the https-page-to-loopback-agent architecture is the exact thing LNA broke**, and every vendor using it is now shipping support documentation instead of a working product.

---

## 5. Prior art in 2026

| Approach | Who | How it holds up under LNA |
|---|---|---|
| **Plain http to loopback + prompt** | Dell SupportAssist, Duo Desktop, Twingate, Adobe Express add-on dev, Dynamsoft | Works, but every one of them has published a "here's how to un-break your browser" KB. This is the status quo, and the status quo is visibly painful. |
| **Locally-trusted TLS via public DNS + real cert** | **Plex** (`*.HASH.plex.direct`, wildcard cert issued per server, DNS resolves `192-168-1-7.hash.plex.direct` → the LAN/loopback IP) | Solves *mixed content* elegantly, but **does not solve LNA** — the permission is keyed on the resolved **address space**, not the scheme. A `https://…plex.direct` URL resolving to 127.0.0.1 is still a loopback request and still prompts. Also drags in DNS-rebinding-protection failures on some routers and a cert-issuance service you must operate forever. |
| **Native messaging via a browser extension** | 1Password, KeePassXC | Fully sidesteps LNA and mixed content. Cost: you must ship and maintain a browser extension per store, and Safari extensions are their own project. |
| **Companion serves its own UI** | Most dev tools, Jupyter, Vite, Docker Desktop, Trezor Suite desktop | Immune. The page is same-origin with the companion (`http://127.0.0.1:PORT` is itself a secure context and is *not* a "local network request" when the initiator is also loopback — LNA gates public→loopback and local→loopback, not loopback→loopback). Zero permission prompts, zero mixed content, zero CORS. |
| **Reverse tunnel / cloud relay** | Various | Companion dials out to our backend over wss; the browser never touches loopback. Immune to all of the above. Cost: relay infrastructure, latency, and the data leaves the machine. |
| **Hard block** | **Brave** ([1.54, 2023-06-27](https://brave.com/privacy-updates/27-localhost-permission/)) | "By default, no sites have this permission and, importantly, **most sites have no way to prompt users for this permission**." Brave is not a prompt — it is a wall, unless you get onto their allow-list. |

---

## 6. Recommendation

**Do not proceed with plain `http://127.0.0.1` as the sole transport. Fall back to the companion-serves-its-own-UI option** (or, if the hosted page must stay the primary surface, treat loopback as an *optional accelerated path* behind a permission check with a designed fallback).

Reasoning, in order of weight:

1. **Safari is a hard zero today.** Not "prompts", not "degraded" — blocked. If Notex must work in Safari, the loopback transport cannot be the only path, full stop. And WebKit's LNA work landing (bug 250607/321725, active 2026-08-13) will convert Safari from "blocked" to "prompts", never to "silently works".
2. **Brave is a hard zero with no prompt available.**
3. **Chrome and Firefox both already prompt**, with wording ("connect to any device on your local network") that will scare a meaningful fraction of users into Block — and Block is sticky and painful to reverse.
4. **Denial is indistinguishable from "companion not installed"** at the `fetch()` layer, so our onboarding funnel loses the ability to give accurate guidance unless we add a `navigator.permissions.query` pre-check (which Safari won't answer either).
5. **The trend line is one-directional.** Chrome 147 already swallowed WebSocket and WebTransport; Chrome 156 removes the enterprise opt-out. There is no future in which this gets easier.
6. **Companion-serves-UI has zero browser policy surface.** Loopback→loopback is not a local network request, `http://127.0.0.1` is a secure context, no CORS, no mixed content, no prompt, works identically in all four engines. The cost is that the companion must ship a UI and we lose the "hosted page is always current" property — a real cost, but a *product* cost we control, not a *policy* cost that a browser vendor can revoke in a six-week release cycle.

**If, despite this, the hosted-page transport is kept**, the minimum bar is:
- serve Notex over `https://` (already true);
- always set `targetAddressSpace: "loopback"`;
- pre-flight the *permission* with `navigator.permissions.query({name: "loopback-network"})` and render an explainer before triggering the browser prompt, so the user knows what they are being asked;
- implement the CORS header set in §3 with a pinned origin and a bearer token, never `*`, never cookies;
- ship a non-loopback fallback path for Safari and Brave from day one — which is the companion-serves-UI option anyway, so you may as well build that first.

**Corollary for the map:** the "Not yet specified" reverse-tunnel option should graduate to a specified alternative now. It is the only design that is immune in every engine without shipping a UI in the companion.

---

## Freshness caveats

- **WebKit bug 171934** (loopback-as-mixed-content) — most recent comment **June 2023**. Older than I would like as the primary source for "Safari blocks this today". Corroborated only by a Jan 2026 Apple Developer Forums thread and by the absence of any WebKit release-note announcement to the contrary through Safari 26.6 (2026-07-27).
- **Mozilla and WebKit standards positions** (#1260, #1260/#520) are both still formally **unlabelled** despite Firefox having shipped the feature. Firefox's actual behaviour is documented in release notes and SUMO, not in a position statement.
- **Chrome Platform Status** still reports `status.text: "In development"` for the LNA feature even though the summary and release notes describe it as shipped in 142 — a bookkeeping inconsistency in chromestatus, not a signal that it is unshipped. Chrome 142/145/147 release notes are the authoritative record.
- **Prompt-persistence semantics** (dismissal vs. explicit Block, auto-block after repeated dismissals) are asserted here from Chrome's general permission model plus vendor KBs; I could not find a primary Chrome document stating LNA-specific persistence rules.
- Everything about **Chrome 148–152** is a gap: I found no LNA changes announced in those release notes, but I did not read all five in full.

## Sources

- [Chrome Platform Status — Local network access restrictions](https://chromestatus.com/feature/5152728072060928) (summary last edited 2026-07-15)
- [Chrome Platform Status — PNA preflights: warning-only mode](https://chromestatus.com/feature/5737414355058688) (M104, enabled by default)
- [Local Network Access spec, WICG](https://wicg.github.io/local-network-access/) (Draft CG Report, 2026-08-07)
- [WICG local-network-access explainer](https://github.com/WICG/local-network-access/blob/main/explainer.md)
- [Intent to Ship: Local network access restrictions, blink-dev](https://groups.google.com/a/chromium.org/g/blink-dev/c/cwu_RUmBpzY) (2025-09-03)
- [New permission prompt for Local Network Access — Chrome for Developers](https://developer.chrome.com/blog/local-network-access) (2025-06-09, upd. 2025-09-29)
- [Private Network Access on hold — Chrome for Developers](https://developer.chrome.com/blog/pna-on-hold) (2024-10-09)
- [Chrome 142 release notes](https://developer.chrome.com/release-notes/142) (2025-10-28) · [145](https://developer.chrome.com/release-notes/145) (2026-02-10) · [147](https://developer.chrome.com/release-notes/147) (2026-04-07)
- [MDN — Local network access](https://developer.mozilla.org/en-US/docs/Web/Security/Defenses/Local_network_access) (2026-08-12)
- [MDN — Permissions-Policy: loopback-network](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Permissions-Policy/loopback-network) (2026-06-08)
- [Firefox 151.0 release notes](https://www.firefox.com/en-US/firefox/151.0/releasenotes/) (2026-05-19)
- [Firefox SUMO — Control personal device and local network permissions](https://support.mozilla.org/en-US/kb/control-personal-device-local-network-permissions-firefox)
- [Mozilla standards-positions #1260](https://github.com/mozilla/standards-positions/issues/1260) (opened 2025-06-26, unlabelled)
- [WebKit standards-positions #520](https://github.com/WebKit/standards-positions/issues/520) (opened 2025-06-26, unlabelled)
- [WebKit bug 171934 — loopback as mixed content](https://bugs.webkit.org/show_bug.cgi?id=171934) (NEW; last comment 2023-06)
- [WebKit bug 250607 — Implement Local Network Access](https://bugs.webkit.org/show_bug.cgi?id=250607) (NEW; last comment 2025-06-26)
- [WebKit bug 321725 — Classify address spaces beyond the LNA spec ranges](https://bugs.webkit.org/show_bug.cgi?id=321725) (filed 2026-08-13)
- [WebKit Features for Safari 26.4](https://webkit.org/blog/17862/webkit-features-for-safari-26-4/) (2026-03-24) · [26.6](https://webkit.org/blog/18178/webkit-features-for-safari-26-6/) (2026-07-27)
- [Apple Developer Forums — Local network request blocked in Safari but working in Chrome](https://developer.apple.com/forums/thread/811690) (2026-01)
- [Brave — Localhost permission](https://brave.com/privacy-updates/27-localhost-permission/) (2023-06-27)
- [Dell KB 000372996 — Dell Online Support Experience Impacted Due to Local Network Access Restrictions](https://www.dell.com/support/kbdoc/en-us/000372996/dell-online-support-experience-impacted-due-to-local-network-access-restrictions) (last modified 2026-07-02)
- [How Plex is doing HTTPS for all its users — Filippo Valsorda](https://words.filippo.io/how-plex-is-doing-https-for-all-its-users/) and [Plex Support — Secure Server Connections](https://support.plex.tv/articles/206225077-how-to-use-secure-server-connections/)
- Version baselines: [chromiumdash releases API](https://chromiumdash.appspot.com/fetch_releases?channel=Stable), [Mozilla product-details](https://product-details.mozilla.org/1.0/firefox_versions.json) (both queried 2026-08-15)
