// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import type { ReactNode } from "react"

import { InstancePicker } from "./InstancePicker"
import type { PairingRecord } from "./types"
import type { InstanceSummary } from "notex-companion/client"

// No route tree exists in an isolated component test — mock Link as a plain anchor, matching
// NotexJsonCard.test.tsx / QuestionGraphPanel.test.tsx's precedent.
vi.mock("@tanstack/react-router", () => ({
  Link: ({ to, children, ...props }: { to: string; children: ReactNode }) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
}))

afterEach(() => cleanup())

const IDS = { repositoryId: "repo-new", organizationId: "org-1", projectId: "proj-1" }

const PAIRING: PairingRecord = {
  baseUrl: "http://127.0.0.1:7717",
  token: "hub-tok",
  checkoutId: "hub-c",
}

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

// `selector: "p"` scopes this to each row's own header line, excluding the confirm panel's
// `<dd>` echo of the same checkout path once a row is opened mid-interaction.
function checkoutPaths(): Array<string> {
  return screen.getAllByText(/^\/Users\/dev\/repo\//, { selector: "p" }).map((el) => el.textContent)
}

describe("InstancePicker sibling promotion (TBR-148)", () => {
  it("shows the plain, unpromoted list when no instance links to a sibling Repository", () => {
    const instances = [
      instance({ instanceId: "inst-a", checkoutPath: "/Users/dev/repo/a", link: null }),
      instance({ instanceId: "inst-b", checkoutPath: "/Users/dev/repo/b", link: null }),
    ]

    render(
      <InstancePicker
        {...IDS}
        pairing={PAIRING}
        instances={instances}
        siblingRepositories={[]}
        onSwitched={() => {}}
      />
    )

    expect(screen.queryByText(/Already connected to/)).toBeNull()
    expect(checkoutPaths()).toEqual(["/Users/dev/repo/a", "/Users/dev/repo/b"])
  })

  it("promotes the instance linked to a sibling Repository above the rest, without removing others", () => {
    const instances = [
      instance({ instanceId: "inst-a", checkoutPath: "/Users/dev/repo/a", link: null }),
      instance({
        instanceId: "inst-sibling",
        checkoutPath: "/Users/dev/repo/sibling",
        link: { organizationId: "org-1", projectId: "proj-1", repositoryId: "repo-sibling" },
      }),
    ]

    render(
      <InstancePicker
        {...IDS}
        pairing={PAIRING}
        instances={instances}
        siblingRepositories={[{ id: "repo-sibling", name: "Sibling Repo" }]}
        onSwitched={() => {}}
      />
    )

    expect(screen.getByText("Already connected to Sibling Repo in this Project")).toBeTruthy()
    // Promoted row moves to the top; the other row stays visible below it.
    expect(checkoutPaths()).toEqual(["/Users/dev/repo/sibling", "/Users/dev/repo/a"])
  })

  it("never promotes a hub-role instance even when its link names a sibling Repository", () => {
    const instances = [
      instance({
        instanceId: "inst-hub",
        role: "hub",
        checkoutPath: "/Users/dev/repo/hub",
        link: { organizationId: "org-1", projectId: "proj-1", repositoryId: "repo-sibling" },
      }),
    ]

    render(
      <InstancePicker
        {...IDS}
        pairing={PAIRING}
        instances={instances}
        siblingRepositories={[{ id: "repo-sibling", name: "Sibling Repo" }]}
        onSwitched={() => {}}
      />
    )

    expect(screen.queryByText(/Already connected to/)).toBeNull()
  })

  it("freezes row order once a row is mid-interaction, even if a sibling promotion resolves afterwards", () => {
    const instances = [
      instance({ instanceId: "inst-a", checkoutPath: "/Users/dev/repo/a", link: null }),
      instance({
        instanceId: "inst-sibling",
        checkoutPath: "/Users/dev/repo/sibling",
        link: { organizationId: "org-1", projectId: "proj-1", repositoryId: "repo-sibling" },
      }),
    ]

    // `siblingRepositories` starts empty — as it would while useRepositories is still loading —
    // so no promotion applies yet and the plain list order holds.
    const { rerender } = render(
      <InstancePicker
        {...IDS}
        pairing={PAIRING}
        instances={instances}
        siblingRepositories={[]}
        onSwitched={() => {}}
      />
    )
    expect(checkoutPaths()).toEqual(["/Users/dev/repo/a", "/Users/dev/repo/sibling"])

    // Open the first row's ("a", not the future sibling) confirm panel before the sibling
    // repository list resolves.
    const connectButtons = screen.getAllByRole("button", { name: "Connect this checkout" })
    expect(connectButtons).toHaveLength(2)
    fireEvent.click(connectButtons[0]!)
    expect(screen.getByText("Checkout path")).toBeTruthy()

    // `siblingRepositories` now resolves with a match for the *other* row — order must not
    // shift out from under the row the user is actively confirming.
    rerender(
      <InstancePicker
        {...IDS}
        pairing={PAIRING}
        instances={instances}
        siblingRepositories={[{ id: "repo-sibling", name: "Sibling Repo" }]}
        onSwitched={() => {}}
      />
    )

    expect(checkoutPaths()).toEqual(["/Users/dev/repo/a", "/Users/dev/repo/sibling"])
    expect(screen.queryByText(/Already connected to/)).toBeNull()
    expect(screen.getByText("Checkout path")).toBeTruthy()
  })
})
