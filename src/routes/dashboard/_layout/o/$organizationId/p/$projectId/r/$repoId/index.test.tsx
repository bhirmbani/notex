// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { CreateContextModal } from "./index"
import type { ReactNode } from "react"
import type * as ReactRouter from "@tanstack/react-router"

import * as connectionState from "@/features/companion/connectionState"
import * as client from "@/features/companion/client"

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof ReactRouter>()
  return { ...actual, useNavigate: () => vi.fn() }
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
}

const PAIRING = {
  baseUrl: "http://127.0.0.1:7717",
  token: "tok",
  checkoutId: "c1",
}

function renderModal(existingQuestions: Array<string> = []) {
  return render(
    <CreateContextModal
      organizationId="org-1"
      repoId="repo-1"
      projectId="proj-1"
      existingQuestions={existingQuestions}
      onClose={() => {}}
    />,
    { wrapper }
  )
}

describe("CreateContextModal — suggested questions", () => {
  it("renders companion's suggested questions as a clickable list when connected", async () => {
    vi.spyOn(connectionState, "resolveConnectionState").mockResolvedValue({
      state: "connected",
      pairing: PAIRING,
      status: {} as never,
    })
    vi.spyOn(client, "fetchSuggestedQuestions").mockResolvedValue({
      graph: {} as never,
      questions: [
        { question: "Why does auth connect to session?", rationale: "High betweenness." },
        { question: "Should util be split up?", rationale: "Low cohesion." },
      ],
    })

    renderModal()

    await waitFor(() =>
      expect(screen.getByText("Why does auth connect to session?")).toBeTruthy()
    )
    expect(screen.getByText("Should util be split up?")).toBeTruthy()
  })

  it("marks a suggestion matching an existing context's question as already asked", async () => {
    vi.spyOn(connectionState, "resolveConnectionState").mockResolvedValue({
      state: "connected",
      pairing: PAIRING,
      status: {} as never,
    })
    vi.spyOn(client, "fetchSuggestedQuestions").mockResolvedValue({
      graph: {} as never,
      questions: [
        { question: "Why does auth connect to session?", rationale: "High betweenness." },
        { question: "Should util be split up?", rationale: "Low cohesion." },
      ],
    })

    renderModal(["  why does auth connect to session?  "])

    await waitFor(() =>
      expect(screen.getByText("Why does auth connect to session?")).toBeTruthy()
    )
    const askedItem = screen
      .getByText("Why does auth connect to session?")
      .closest("button")!
    expect(askedItem.textContent).toContain("Already asked")

    const freshItem = screen.getByText("Should util be split up?").closest("button")!
    expect(freshItem.textContent).not.toContain("Already asked")
  })

  it("clicking a suggestion fills the question input without submitting", async () => {
    vi.spyOn(connectionState, "resolveConnectionState").mockResolvedValue({
      state: "connected",
      pairing: PAIRING,
      status: {} as never,
    })
    vi.spyOn(client, "fetchSuggestedQuestions").mockResolvedValue({
      graph: {} as never,
      questions: [{ question: "Why does auth connect to session?", rationale: "High betweenness." }],
    })

    renderModal()

    await waitFor(() =>
      expect(screen.getByText("Why does auth connect to session?")).toBeTruthy()
    )
    fireEvent.click(screen.getByText("Why does auth connect to session?"))

    const input = screen.getByLabelText<HTMLInputElement>("Question")
    expect(input.value).toBe("Why does auth connect to session?")
  })

  it("renders no suggestions section when no companion is connected", async () => {
    vi.spyOn(connectionState, "resolveConnectionState").mockResolvedValue({
      state: "unpaired",
    })
    const fetchSpy = vi.spyOn(client, "fetchSuggestedQuestions")

    renderModal()

    await waitFor(() => expect(screen.getByLabelText("Question")).toBeTruthy())
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(screen.queryByText("Suggested questions")).toBeNull()
  })
})
