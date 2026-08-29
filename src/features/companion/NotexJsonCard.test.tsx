// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { NotexJsonCard, buildNotexJsonSnippet } from "./NotexJsonCard"
import type { ReactNode } from "react"

// No route tree exists in an isolated component test — mock Link as a plain anchor, matching
// QuestionGraphPanel.test.tsx's precedent rather than mounting a real TanStack Router.
vi.mock("@tanstack/react-router", () => ({
  Link: ({ to, children, ...props }: { to: string; children: ReactNode }) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
}))

afterEach(() => cleanup())

const IDS = {
  organizationId: "org-1",
  projectId: "proj-1",
  repositoryId: "repo-1",
}

describe("buildNotexJsonSnippet", () => {
  it("builds pretty-printed JSON with the ids and an empty apiKey", () => {
    expect(buildNotexJsonSnippet(IDS)).toBe(
      JSON.stringify(
        { organizationId: "org-1", projectId: "proj-1", repositoryId: "repo-1", apiKey: "" },
        null,
        2
      )
    )
  })
})

describe("NotexJsonCard", () => {
  it("copies the full snippet, not just the visible ids, to the clipboard", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.assign(navigator, { clipboard: { writeText } })

    render(<NotexJsonCard {...IDS} />)
    fireEvent.click(screen.getByRole("button", { name: "Copy snippet" }))

    await waitFor(() => expect(writeText).toHaveBeenCalledWith(buildNotexJsonSnippet(IDS)))
  })

  it("shows a clipboard error message when the snippet copy fails", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("denied"))
    Object.assign(navigator, { clipboard: { writeText } })

    render(<NotexJsonCard {...IDS} />)
    fireEvent.click(screen.getByRole("button", { name: "Copy snippet" }))

    expect(await screen.findByText(/Could not copy automatically/)).toBeTruthy()
  })

  it("hides individual ids until Show individual ids is clicked", () => {
    render(<NotexJsonCard {...IDS} />)
    expect(screen.queryByText("org-1")).toBeNull()

    fireEvent.click(screen.getByRole("button", { name: "Show individual ids" }))

    expect(screen.getByText("org-1")).toBeTruthy()
  })

  it("copies a single id's own value, not the full snippet, from its row's copy button", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.assign(navigator, { clipboard: { writeText } })

    render(<NotexJsonCard {...IDS} />)
    fireEvent.click(screen.getByRole("button", { name: "Show individual ids" }))
    fireEvent.click(screen.getByRole("button", { name: "Copy Organization ID" }))

    await waitFor(() => expect(writeText).toHaveBeenCalledWith("org-1"))
    expect(writeText).not.toHaveBeenCalledWith(buildNotexJsonSnippet(IDS))
  })

  it("links the API key note to the API keys settings page", () => {
    render(<NotexJsonCard {...IDS} />)

    const link = screen.getByRole("link", { name: /Settings → API keys/ })

    expect(link.getAttribute("href")).toBe("/dashboard/settings/api-keys")
  })
})
