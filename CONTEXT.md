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
