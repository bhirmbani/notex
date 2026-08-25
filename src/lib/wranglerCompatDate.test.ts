import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// Nitro's `cloudflare-module` preset emits `.output/server/wrangler.json` with
// `no_bundle: true`, so `wrangler deploy` never runs the esbuild pass that injects
// unenv's Node polyfills — every `node:*` specifier in the SSR bundle must be resolvable
// by workerd itself. The bundle imports `node:os` (mermaid → @mermaid-js/parser →
// langium → vscode-jsonrpc), which workerd only provides from this compatibility date
// onward; below it the deployed Worker 500s with `No such module "node:os"` on every
// request. The generated config inherits `compatibility_date` from these files verbatim.
const MIN_COMPATIBILITY_DATE = '2025-09-15'

const CONFIGS = ['wrangler.jsonc', 'wrangler.dev.jsonc']

function readCompatibilityDate(file: string): string {
  const source = readFileSync(resolve(process.cwd(), file), 'utf8')
  const match = source.match(/"compatibility_date"\s*:\s*"([^"]+)"/)
  const date = match?.[1]
  if (!date) throw new Error(`${file} has no compatibility_date`)
  return date
}

describe('wrangler compatibility_date', () => {
  it.each(CONFIGS)('%s is at or after the native node:os date', (file) => {
    expect(readCompatibilityDate(file) >= MIN_COMPATIBILITY_DATE).toBe(true)
  })
})
