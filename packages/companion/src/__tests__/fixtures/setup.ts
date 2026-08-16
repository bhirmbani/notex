// graphify-out/ is gitignored repo-wide (it's build output, not source), which would
// also swallow a checked-in fixture at this literal path. So the fixture's graph.json
// content lives at ./sample-checkout-graph.source.json (a plain, trackable name) and
// this module materializes it into the expected graphify-out/graph.json layout before
// any test reads FIXTURE_ROOT.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"

export const FIXTURE_ROOT = resolve(import.meta.dir, "sample-checkout")

const graphDir = resolve(FIXTURE_ROOT, "graphify-out")
const graphPath = resolve(graphDir, "graph.json")
const sourcePath = resolve(import.meta.dir, "sample-checkout-graph.source.json")

mkdirSync(graphDir, { recursive: true })
writeFileSync(graphPath, readFileSync(sourcePath))
