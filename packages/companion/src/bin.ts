// The actual process entry point — this is what `dist/cli.js` (the published `bin`) runs.
// Deliberately just this: `cli.ts` stays import-safe (its `main` only runs when called), so
// `cli.test.ts` can import `parseServeArgs`/`CliUsageError` without triggering a live run.

import { main } from "./cli.ts"

main()
