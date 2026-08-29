// VITE_COMMIT_SHA and VITE_APP_ENV are inlined at build time: scripts/deploy-env.mjs's
// buildEnv sets them for a real deploy, scripts/dev.mjs sets them for `bun run dev`. The
// fallbacks below only matter for `vite preview`/`vite build` invoked directly, bypassing
// both wrappers.
export const COMMIT_SHA = import.meta.env.VITE_COMMIT_SHA ?? 'dev'
export const APP_ENV = import.meta.env.VITE_APP_ENV ?? 'dev'
