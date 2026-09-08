// The instance-picker's promoted-suggestion pick (TBR-148): when at least one instance's
// `link` names a sibling Repository in the same Project as the current (new) Repository, that
// instance surfaces above the plain list as "Already connected to <sibling name> in this
// Project" (InstancePicker.tsx). `siblingRepositories` is this Project's own repository list
// (useRepositories) — cross-referencing against it, rather than trusting `link.repositoryId`
// alone, means a stale link naming a Repository that's since been deleted from the Project
// never gets promoted with no name to show.

import type { InstanceSummary } from "notex-companion/client"

export type SiblingRepository = { id: string; name: string }

export type SiblingPromotion = {
  instance: InstanceSummary
  siblingRepositoryName: string
}

/** Never considers a hub-role instance: the hub is never a switch target (InstancePicker.tsx's
 * own `isHub` disabling), so promoting one would highlight a row whose action can't be taken.
 * Checks all three `link` fields, mirroring `linkMatches` (packages/companion/src/registry.ts)
 * rather than `projectId`/`repositoryId` alone — a same-id cross-organization collision is
 * unreachable today (ids are `crypto.randomUUID()`, `siblingRepositories` is always fetched
 * org-scoped), but the check exists so it stays that way if either assumption ever changes. */
export function findSiblingPromotion(
  instances: Array<InstanceSummary>,
  siblingRepositories: Array<SiblingRepository>,
  ids: { organizationId: string; projectId: string; repositoryId: string }
): SiblingPromotion | null {
  for (const instance of instances) {
    if (instance.role !== "satellite") continue
    const link = instance.link
    if (!link) continue
    if (link.organizationId !== ids.organizationId) continue
    if (link.projectId !== ids.projectId) continue
    if (link.repositoryId === ids.repositoryId) continue

    const sibling = siblingRepositories.find((repo) => repo.id === link.repositoryId)
    if (!sibling) continue

    return { instance, siblingRepositoryName: sibling.name }
  }
  return null
}
