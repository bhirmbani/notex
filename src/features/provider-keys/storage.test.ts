// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest"

import {
  addProviderKey,
  deleteProviderKey,
  getActiveProviderKey,
  getProviderKeys,
  setActiveProviderKey,
} from "./storage"

afterEach(() => {
  localStorage.clear()
})

describe("provider key storage", () => {
  it("starts with no configured providers", () => {
    expect(getProviderKeys()).toEqual([])
    expect(getActiveProviderKey()).toBeNull()
  })

  it("adds a provider and assigns it an id", () => {
    const added = addProviderKey({ adapter: "anthropic", apiKey: "sk-ant-1", model: "claude-3-5-haiku-latest" })
    expect(added.id).toBeTruthy()
    expect(getProviderKeys()).toEqual([added])
  })

  it("marks the first added provider active automatically", () => {
    const added = addProviderKey({ adapter: "anthropic", apiKey: "sk-ant-1", model: "claude-3-5-haiku-latest" })
    expect(getActiveProviderKey()).toEqual(added)
  })

  it("does not change the active provider when a second one is added", () => {
    const first = addProviderKey({ adapter: "anthropic", apiKey: "sk-ant-1", model: "claude-3-5-haiku-latest" })
    addProviderKey({
      adapter: "openai-compatible",
      apiKey: "sk-oai-1",
      model: "gpt-4o-mini",
      baseUrl: "https://api.openai.com/v1",
    })
    expect(getActiveProviderKey()).toEqual(first)
  })

  it("marks exactly one provider active when setActiveProviderKey is called", () => {
    const first = addProviderKey({ adapter: "anthropic", apiKey: "sk-ant-1", model: "claude-3-5-haiku-latest" })
    const second = addProviderKey({
      adapter: "openai-compatible",
      apiKey: "sk-oai-1",
      model: "gpt-4o-mini",
      baseUrl: "https://api.openai.com/v1",
    })
    setActiveProviderKey(second.id)
    expect(getActiveProviderKey()).toEqual(second)
    void first
  })

  it("ignores setActiveProviderKey for an id that does not exist", () => {
    const first = addProviderKey({ adapter: "anthropic", apiKey: "sk-ant-1", model: "claude-3-5-haiku-latest" })
    setActiveProviderKey("does-not-exist")
    expect(getActiveProviderKey()).toEqual(first)
  })

  it("deletes a provider", () => {
    const first = addProviderKey({ adapter: "anthropic", apiKey: "sk-ant-1", model: "claude-3-5-haiku-latest" })
    deleteProviderKey(first.id)
    expect(getProviderKeys()).toEqual([])
  })

  it("clears the active provider when the active one is deleted", () => {
    const first = addProviderKey({ adapter: "anthropic", apiKey: "sk-ant-1", model: "claude-3-5-haiku-latest" })
    deleteProviderKey(first.id)
    expect(getActiveProviderKey()).toBeNull()
  })

  it("leaves the active provider unchanged when a non-active one is deleted", () => {
    const first = addProviderKey({ adapter: "anthropic", apiKey: "sk-ant-1", model: "claude-3-5-haiku-latest" })
    const second = addProviderKey({
      adapter: "openai-compatible",
      apiKey: "sk-oai-1",
      model: "gpt-4o-mini",
      baseUrl: "https://api.openai.com/v1",
    })
    deleteProviderKey(second.id)
    expect(getActiveProviderKey()).toEqual(first)
  })

  it("treats malformed stored JSON as no providers rather than throwing", () => {
    localStorage.setItem("notex:provider-keys", "not json")
    expect(getProviderKeys()).toEqual([])
  })

  it("drops a stored entry missing required fields rather than throwing", () => {
    localStorage.setItem(
      "notex:provider-keys",
      JSON.stringify({ providers: [{ id: "x", adapter: "anthropic" }], activeId: "x" }),
    )
    expect(getProviderKeys()).toEqual([])
  })

  it("never calls fetch — provider key storage is local-only (spec §3)", () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal("fetch", fetchSpy)

    const added = addProviderKey({ adapter: "anthropic", apiKey: "sk-ant-1", model: "claude-3-5-haiku-latest" })
    getProviderKeys()
    getActiveProviderKey()
    setActiveProviderKey(added.id)
    deleteProviderKey(added.id)

    expect(fetchSpy).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
  })
})
