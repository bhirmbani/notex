// Split out of cli.ts so `link.ts` (TBR-85) can throw the same usage-error shape as
// `parseServeArgs` without an import cycle back through cli.ts's `main()`.

/** Thrown by argument parsing on bad input — `main()` turns it into a stderr message + exit 1. */
export class CliUsageError extends Error {}
