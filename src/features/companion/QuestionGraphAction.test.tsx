// src/features/companion/QuestionGraphAction.test.tsx
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, render, screen, fireEvent } from "@testing-library/react"

// No route tree exists in an isolated component test, and this codebase has no precedent
// for mounting a real TanStack Router just to render one Link — mock it as a plain anchor,
// interpolating $params the same way the router would for this test's purposes.
vi.mock("@tanstack/react-router", () => ({
  Link: ({
    to,
    params,
    children,
    ...props
  }: {
    to: string
    params: Record<string, string>
    children: React.ReactNode
  }) => {
    const href = Object.entries(params).reduce(
      (path, [key, value]) => path.replace(`$${key}`, value),
      to
    )
    return (
      <a href={href} {...props}>
        {children}
      </a>
    )
  },
}))

import { QuestionGraphAction } from "./QuestionGraphAction"

afterEach(cleanup)

function renderAction(
  canDraft: boolean,
  connectionState: string | undefined,
  onDraft = vi.fn()
) {
  render(
    <QuestionGraphAction
      organizationId="org-1"
      projectId="proj-1"
      repoId="repo-1"
      canDraft={canDraft}
      connectionState={connectionState as never}
      isPending={false}
      onDraft={onDraft}
    />
  )
  return { onDraft }
}

describe("QuestionGraphAction", () => {
  it("enables the button and shows no notice when connected", () => {
    renderAction(true, "connected")

    const button = screen.getByRole<HTMLButtonElement>("button", {
      name: "Draft this Answer from the graph",
    })
    expect(button.disabled).toBe(false)
    expect(screen.queryByText(/Companion not connected/)).toBeNull()
  })

  it("disables the button and shows the browser-unsupported line, with no link", () => {
    renderAction(false, "unsupported")

    expect(
      screen.getByRole<HTMLButtonElement>("button", {
        name: "Draft this Answer from the graph",
      }).disabled
    ).toBe(true)
    expect(
      screen.getByText("Graph features need Chrome or Firefox.")
    ).toBeTruthy()
    expect(screen.queryByRole("link")).toBeNull()
  })

  it("disables the button and links to the graph page for any other non-connected state", () => {
    renderAction(false, "unreachable")

    expect(screen.getByText(/Companion not connected/)).toBeTruthy()
    const link = screen.getByRole<HTMLAnchorElement>("link", { name: "set it up" })
    expect(link.getAttribute("href")).toBe(
      "/dashboard/o/org-1/p/proj-1/r/repo-1/graph"
    )
  })

  it("calls onDraft when clicked while enabled", () => {
    const { onDraft } = renderAction(true, "connected")

    fireEvent.click(
      screen.getByRole("button", { name: "Draft this Answer from the graph" })
    )

    expect(onDraft).toHaveBeenCalledTimes(1)
  })
})
