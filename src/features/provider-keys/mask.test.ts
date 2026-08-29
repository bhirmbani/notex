import { describe, expect, it } from "vitest"

import { maskApiKey } from "./mask"

describe("maskApiKey", () => {
  it("keeps a short key fully masked", () => {
    expect(maskApiKey("short")).toBe("••••••••")
  })

  it("shows a leading and trailing slice of a longer key, masking the middle", () => {
    expect(maskApiKey("sk-ant-abcdef123456")).toBe("sk-a••••3456")
  })

  it("never includes the full key value in its output", () => {
    const key = "sk-ant-abcdef123456"
    expect(maskApiKey(key)).not.toContain(key)
  })
})
