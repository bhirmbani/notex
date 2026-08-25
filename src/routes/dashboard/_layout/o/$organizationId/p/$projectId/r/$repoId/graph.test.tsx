// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react"
import { NodePicker, PathPanel, SearchPanel } from "./graph"
import type { ReactNode } from "react"

import type { ResolvedNode } from "@/features/companion/types"
import * as client from "@/features/companion/client"
import { EDITOR_SCHEME_STORAGE_KEY } from "@/lib/editorScheme"

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  localStorage.clear()
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

const RESULT_NODE = {
  id: "node-1",
  label: "authenticate",
  sourceFile: "api/middleware/auth.ts",
  sourceLocation: "L18",
  fileType: "code",
  community: null,
  score: 3.5,
}

describe("NodePicker", () => {
  it("searches on input, resolves a suggestion into a chip, and clears back to a search box", async () => {
    vi.spyOn(client, "search").mockResolvedValue({
      graph: {} as never,
      results: [RESULT_NODE],
    })
    const onChange = vi.fn()

    render(
      <NodePicker
        pairing={PAIRING}
        label="From"
        value={null}
        onChange={onChange}
      />,
      { wrapper }
    )

    fireEvent.change(screen.getByLabelText("From"), {
      target: { value: "auth" },
    })

    await waitFor(() => expect(screen.getByText("authenticate")).toBeTruthy(), {
      timeout: 1000,
    })

    fireEvent.click(screen.getByText("authenticate"))

    expect(onChange).toHaveBeenCalledWith({
      id: "node-1",
      label: "authenticate",
    })
  })

  it("renders a resolved value as a chip, not a text input, and clears on click", () => {
    const onChange = vi.fn()
    const value: ResolvedNode = { id: "node-1", label: "authenticate" }

    render(
      <NodePicker
        pairing={PAIRING}
        label="From"
        value={value}
        onChange={onChange}
      />,
      { wrapper }
    )

    expect(screen.getByText("authenticate")).toBeTruthy()
    expect(screen.queryByLabelText("From")).toBeNull()

    fireEvent.click(screen.getByLabelText("Clear From"))
    expect(onChange).toHaveBeenCalledWith(null)
  })
})

describe("PathPanel", () => {
  it("disables Find path until both From and To are resolved", () => {
    render(
      <PathPanel
        pairing={PAIRING}
        from={null}
        to={null}
        onChangeFrom={vi.fn()}
        onChangeTo={vi.fn()}
      />,
      { wrapper }
    )

    expect(
      screen.getByRole<HTMLButtonElement>("button", { name: "Find path" })
        .disabled
    ).toBe(true)
  })

  it("submits the resolved node ids, not raw text, once both sides are set", async () => {
    const pathSpy = vi.spyOn(client, "path").mockResolvedValue({
      graph: {} as never,
      found: true,
      nodes: [],
      edges: [],
    })

    render(
      <PathPanel
        pairing={PAIRING}
        from={{ id: "node-1", label: "authenticate" }}
        to={{ id: "node-2", label: "session" }}
        onChangeFrom={vi.fn()}
        onChangeTo={vi.fn()}
      />,
      { wrapper }
    )

    const button = screen.getByRole<HTMLButtonElement>("button", {
      name: "Find path",
    })
    expect(button.disabled).toBe(false)
    fireEvent.click(button)

    await waitFor(() =>
      expect(pathSpy).toHaveBeenCalledWith(PAIRING.baseUrl, PAIRING.token, {
        from: "node-1",
        to: "node-2",
      })
    )
  })

  it("reads a normal no-route result as neutral, not an error", async () => {
    vi.spyOn(client, "path").mockResolvedValue({
      graph: {} as never,
      found: false,
      nodes: [],
      edges: [],
    })

    render(
      <PathPanel
        pairing={PAIRING}
        from={{ id: "node-1", label: "authenticate" }}
        to={{ id: "node-2", label: "session" }}
        onChangeFrom={vi.fn()}
        onChangeTo={vi.fn()}
      />,
      { wrapper }
    )

    fireEvent.click(screen.getByRole("button", { name: "Find path" }))

    const message = await screen.findByText(/no path found/i)
    expect(message.className).not.toContain("destructive")
  })
})

describe("SearchPanel", () => {
  it("lets a result populate From or To without the user typing an id", async () => {
    vi.spyOn(client, "search").mockResolvedValue({
      graph: {} as never,
      results: [RESULT_NODE],
    })
    const onUseAsFrom = vi.fn()
    const onUseAsTo = vi.fn()

    render(
      <SearchPanel
        pairing={PAIRING}
        checkoutPath="/Users/dev/notex"
        onUseAsFrom={onUseAsFrom}
        onUseAsTo={onUseAsTo}
      />,
      { wrapper }
    )

    fireEvent.change(screen.getByPlaceholderText("Search the graph…"), {
      target: { value: "auth" },
    })

    await waitFor(() => expect(screen.getByText("authenticate")).toBeTruthy(), {
      timeout: 1000,
    })

    fireEvent.click(screen.getByRole("button", { name: "Use as From" }))
    expect(onUseAsFrom).toHaveBeenCalledWith({
      id: "node-1",
      label: "authenticate",
    })

    fireEvent.click(screen.getByRole("button", { name: "Use as To" }))
    expect(onUseAsTo).toHaveBeenCalledWith({
      id: "node-1",
      label: "authenticate",
    })
  })

  it("builds an editor link from checkoutPath + sourceFile honouring the stored scheme", async () => {
    localStorage.setItem(EDITOR_SCHEME_STORAGE_KEY, "cursor")
    vi.spyOn(client, "search").mockResolvedValue({
      graph: {} as never,
      results: [RESULT_NODE],
    })

    render(
      <SearchPanel
        pairing={PAIRING}
        checkoutPath="/Users/dev/notex"
        onUseAsFrom={vi.fn()}
        onUseAsTo={vi.fn()}
      />,
      { wrapper }
    )

    fireEvent.change(screen.getByPlaceholderText("Search the graph…"), {
      target: { value: "auth" },
    })

    const link = await screen.findByLabelText<HTMLAnchorElement>(
      "Open api/middleware/auth.ts in editor"
    )
    expect(link.href).toBe(
      "cursor://file/Users/dev/notex/api/middleware/auth.ts:18:1"
    )
  })

  it("omits the editor link entirely when the scheme is 'none'", async () => {
    localStorage.setItem(EDITOR_SCHEME_STORAGE_KEY, "none")
    vi.spyOn(client, "search").mockResolvedValue({
      graph: {} as never,
      results: [RESULT_NODE],
    })

    render(
      <SearchPanel
        pairing={PAIRING}
        checkoutPath="/Users/dev/notex"
        onUseAsFrom={vi.fn()}
        onUseAsTo={vi.fn()}
      />,
      { wrapper }
    )

    fireEvent.change(screen.getByPlaceholderText("Search the graph…"), {
      target: { value: "auth" },
    })

    await waitFor(() => expect(screen.getByText("authenticate")).toBeTruthy())
    expect(
      screen.queryByLabelText("Open api/middleware/auth.ts in editor")
    ).toBeNull()
  })
})
