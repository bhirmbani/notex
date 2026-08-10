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
