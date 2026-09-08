import { describe, expect, it } from "vitest"

import { findSiblingPromotion } from "./siblingPromotion"
import type { InstanceSummary } from "notex-companion/client"

const IDS = { organizationId: "org-1", projectId: "proj-1", repositoryId: "repo-new" }

function instance(overrides: Partial<InstanceSummary>): InstanceSummary {
  return {
    instanceId: "inst-1",
    checkoutPath: "/Users/dev/repo/a",
    port: 8888,
    role: "satellite",
    registeredAt: "2026-01-01T00:00:00.000Z",
    lastHeartbeatAt: "2026-01-01T00:00:00.000Z",
    gitRemote: null,
    headSha: null,
    link: null,
    ...overrides,
  }
}

describe("findSiblingPromotion", () => {
  it("returns null when no instance is linked to anything", () => {
    const instances = [instance({ link: null })]
    expect(findSiblingPromotion(instances, [{ id: "repo-sibling", name: "Sibling" }], IDS)).toBeNull()
  })

  it("returns null when the only link is to this Repository itself", () => {
    const instances = [
      instance({ link: { organizationId: "org-1", projectId: "proj-1", repositoryId: "repo-new" } }),
    ]
    expect(findSiblingPromotion(instances, [{ id: "repo-new", name: "This one" }], IDS)).toBeNull()
  })

  it("returns null when the link belongs to a different Project", () => {
    const instances = [
      instance({ link: { organizationId: "org-1", projectId: "proj-other", repositoryId: "repo-sibling" } }),
    ]
    expect(findSiblingPromotion(instances, [{ id: "repo-sibling", name: "Sibling" }], IDS)).toBeNull()
  })

  it("returns null when the linked repositoryId isn't in the Project's own repository list", () => {
    const instances = [
      instance({ link: { organizationId: "org-1", projectId: "proj-1", repositoryId: "repo-stale" } }),
    ]
    expect(findSiblingPromotion(instances, [{ id: "repo-sibling", name: "Sibling" }], IDS)).toBeNull()
  })

  it("returns null when the link belongs to a different Organization, even with matching project/repository ids", () => {
    const instances = [
      instance({ link: { organizationId: "org-other", projectId: "proj-1", repositoryId: "repo-sibling" } }),
    ]
    expect(findSiblingPromotion(instances, [{ id: "repo-sibling", name: "Sibling" }], IDS)).toBeNull()
  })

  it("promotes an instance linked to a sibling Repository in the same Project", () => {
    const sibling = instance({
      instanceId: "inst-sibling",
      link: { organizationId: "org-1", projectId: "proj-1", repositoryId: "repo-sibling" },
    })
    const instances = [instance({ instanceId: "inst-unlinked", link: null }), sibling]

    expect(findSiblingPromotion(instances, [{ id: "repo-sibling", name: "Sibling Repo" }], IDS)).toEqual({
      instance: sibling,
      siblingRepositoryName: "Sibling Repo",
    })
  })

  it("ignores a hub-role instance even when its link names a sibling Repository", () => {
    const instances = [
      instance({
        role: "hub",
        link: { organizationId: "org-1", projectId: "proj-1", repositoryId: "repo-sibling" },
      }),
    ]
    expect(findSiblingPromotion(instances, [{ id: "repo-sibling", name: "Sibling" }], IDS)).toBeNull()
  })

  it("returns the first matching sibling when more than one instance qualifies", () => {
    const first = instance({
      instanceId: "inst-first",
      link: { organizationId: "org-1", projectId: "proj-1", repositoryId: "repo-sibling-1" },
    })
    const second = instance({
      instanceId: "inst-second",
      link: { organizationId: "org-1", projectId: "proj-1", repositoryId: "repo-sibling-2" },
    })
    const instances = [first, second]
    const repositories = [
      { id: "repo-sibling-1", name: "First Sibling" },
      { id: "repo-sibling-2", name: "Second Sibling" },
    ]

    expect(findSiblingPromotion(instances, repositories, IDS)).toEqual({
      instance: first,
      siblingRepositoryName: "First Sibling",
    })
  })
})
