# Inline edit-in-place for renaming Project/Repository/Question/Answer

Adding edit UI for Project name, Repository name, Question, and Answer name/content, we chose inline edit-in-place (pencil icon on hover → the `<h1>`/name becomes an input, Enter/blur saves, Escape discards) over a modal or dedicated edit page. No rename/edit UI precedent existed in the app before this — every prior mutation surface was a create modal (`AddFileModal`, `CreateRepoModal`, `LinkModal`). This sets the convention for any future rename/edit affordance on these entities: inline, not modal.

Answer *content* (not name) is the one exception — it uses explicit Save/Cancel buttons instead of blur-to-save, since accidentally committing a multi-line edit via stray blur is costlier than for a short name field.
