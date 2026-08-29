# Notex

Notex organizes engineering knowledge as a hierarchy of Projects, Repositories, Questions, and Answers, alongside freeform Notes.

## Language

**Project**:
The top-level container a user creates; owns Repositories.

**Repository**:
A grouping of Questions and source Files within a Project. Distinct from a version-control repository — no git semantics.

**Question**:
A single prompt captured under a Repository (stored as `contexts.question` in the schema; the field itself is both the question's identity and its display title — there is no separate title/body split).
_Avoid_: Context, title (as a distinct field)

**Answer**:
A response to a Question, stored as a `files` row. Has a `name` (title) and, when `contentType` is `text`, a plain-text `content` body. Upload-type Answers have no editable content — only a `name`.
_Avoid_: File (as the user-facing term — "File" is the schema/table name, "Answer" is the domain term)

**Notes**:
A separate freeform rich-text feature, distinct from Answers. Notes get a rich text editor; Answer content stays plain text — the two are not the same kind of content and should not share an editor.

**Organization**:
_Planned (TBR-10 map — not yet implemented)._ The top-level tenancy container that will own Projects, replacing direct user ownership. Every User gets one auto-created on signup and may hold Memberships in others.
_Avoid_: Org (as the canonical term)

**Membership**:
_Planned (TBR-10 map)._ The join between a User and an Organization, carrying a Role. A User holds at most one Membership per Organization, and may hold Memberships in multiple Organizations.
_Avoid_: Member (as the entity name — "member" is also a Role value, so "an admin Member" would be ambiguous; use "Membership" for the entity, `member`/`admin` for the Role)

**Role**:
_Planned (TBR-10 map)._ A Membership's privilege level within its Organization: `admin` or `member`. Admin manages Memberships and Organization settings, and has implicit full access to every Project in the Organization with no Grant needed. Member has no default Project access and must be given a Grant per Project.

**Invite**:
_Planned (TBR-10 map)._ A single-use, expiring, link-based token that creates a Membership (Role: `member`) in the issuing Organization once accepted.
_Avoid_: Invitation

**Grant**:
A per-(Membership, Project) permission record specifying `read` or `write` access. Admin Memberships never need a Grant — their access is implicit via Role. A Membership with no Grant on a Project has no access to it at all (not read-only-by-default). Project deletion is admin-only regardless of Grant level.

**Companion**:
_Planned (TBR-53 map)._ The per-checkout Node process (`notex-companion`) that reads a local `graphify-out/graph.json` and serves deterministic retrieval over it to the Notex browser page and to an MCP host. It holds no LLM, never builds a graph, and never talks to D1.
_Avoid_: server, agent, daemon (the multi-repo daemon is a specific deferred variant, not a synonym)

**Checkout**:
_Planned (TBR-53 map)._ The user's local working copy of a version-control repository, which a Companion serves. Distinct from a **Repository**, which is a Notex grouping with no git semantics — a Checkout is *bound* to a Repository by human confirmation, and the two are never the same thing.

**Graph stamp**:
_Planned (TBR-53 map)._ The identity and age of the graph a result came from — build time, hash, counts, checkout path, git HEAD, and the graphify root. Echoed on every Companion response, not just `status`, so a drafted Answer's provenance records the graph *that draft* came from.

**Pairing**:
_Planned (TBR-53 map)._ The per-device act of giving a browser or MCP host the Companion's bearer token, by pasting a line the Companion prints. The token never reaches the Worker or D1.
_Avoid_: pairing as a synonym for **binding** — pairing is about the token, binding is about which Repository a Checkout belongs to

**Checkout-relative**:
_Planned (TBR-53 map)._ The path convention for everything leaving the Companion: POSIX paths relative to the **Checkout root**, resolved from graphify's own root during projection.
_Avoid_: repo-relative (ambiguous between the Checkout root and graphify's root — that ambiguity produced citations pointing at files that do not exist)

**Degraded retrieval**:
_Planned (TBR-53 map)._ A result produced without agent-side vocabulary expansion, matched literally. It fails by returning plausible **wrong** seeds rather than nothing, so it must always be declared alongside truncation and the seed-score floor.

**Seed-score floor**:
_Planned (TBR-53 map)._ The threshold below which the UI says "nothing convincing matched" instead of rendering a subgraph, because no seed cleared an exact token match.

**Provenance footer**:
_Planned (TBR-53 map)._ The plain-text block appended to a graph-drafted Answer's content: draft date, graph build date and hash, a truncation notice when it applies, and the checkout-relative source paths. It is content, not schema, and every write path renders it from one shared function.

**Vocabulary expansion**:
_Planned (TBR-87)._ The LLM step that turns a Question's raw text into pre-expanded `terms[]` before the companion's `query` op runs, closing the browser path's `degraded: { expansion: "none" }` gap (`companion-api.md` §4.4). Runs with the user's own Provider key, direct from the browser when the provider allows it, via a Notex-side proxy on transport failure. See ADR-0006.

**Provider key**:
_Planned (TBR-87)._ A user-supplied credential for a third-party LLM provider (Anthropic, or any OpenAI-compatible endpoint), used for Vocabulary expansion and Synthesis. Stored client-side only (`localStorage`), never written to D1.
_Avoid_: API key (ambiguous with the Settings → API keys credential from TBR-65, which is Notex's own server-stored key authenticating the companion/MCP *to* Notex — always say "Provider key" for this one)

**Synthesis**:
_Planned (TBR-99)._ The LLM step that turns the companion's retrieved `context.markdown` into cited prose, seeded into the Question surface's Draft textarea in place of the raw evidence block. A second, distinct call from Vocabulary expansion — expansion widens the search terms *before* retrieval; synthesis writes the answer *after* it. Runs browser-direct with the same Provider key, per ADR-0007; unlike expansion it has no proxy fallback, so a transport failure degrades the same as any other synthesis failure.
_Avoid_: conflating with Vocabulary expansion — different call, different failure banner, and synthesis firing is independent of whether expansion itself succeeded.
