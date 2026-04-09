# tanstack-start-cf-d1-auth-skills

An AI coding agent skill that bootstraps a production-ready full-stack app with **TanStack Start**, **Cloudflare Workers**, **Cloudflare D1**, **Drizzle ORM**, and **BetterAuth**.

Compatible with any AI coding agent that supports skills or custom instructions (Claude Code, Cursor, Copilot, Windsurf, etc.).

## What this skill does

When invoked, this skill walks the agent through setting up the complete integration across three phases:

1. **Infrastructure** — Vite/Nitro config for Cloudflare Workers, Wrangler config, Hono API, dev scripts
2. **Database** — Drizzle ORM schema for BetterAuth tables, D1 binding, migration generation
3. **Auth** — BetterAuth server/client, auth middleware, protected routes, login/register pages

## When to use

Invoke this skill when you want to:

- Bootstrap a new TanStack Start project with authentication
- Set up BetterAuth with Cloudflare D1/Workers
- Wire Drizzle ORM into a TanStack Start app
- Add protected routes + session management to an existing TanStack Start scaffold

## Prerequisites

Before running the skill, you need:

- A TanStack Start project scaffolded (e.g., via `bunx --bun shadcn@latest init --template start`)
- Bun as the package manager
- Tailwind CSS + shadcn/ui configured
- A Cloudflare account with a D1 database created (`wrangler d1 create <name>`)

## Stack

| Layer | Technology |
|-------|-----------|
| Framework | [TanStack Start](https://tanstack.com/start) (SSR React on Nitro) |
| Deployment | [Cloudflare Workers](https://workers.cloudflare.com/) |
| Database | [Cloudflare D1](https://developers.cloudflare.com/d1/) (SQLite at the edge) |
| ORM | [Drizzle ORM](https://orm.drizzle.team/) |
| Auth | [BetterAuth](https://www.better-auth.com/) (email/password) |
| API | [Hono](https://hono.dev/) |
| UI | [shadcn/ui](https://ui.shadcn.com/) + Tailwind CSS |

## Key integration patterns

The non-obvious wiring that makes this stack work:

- **Nitro `cloudflare-module` preset** — required for Cloudflare Workers deployment
- **`globalThis.__env__`** — how server-side code accesses D1 and other CF bindings
- **Three-way request router** — `/api/v1/*` → Hono, `/api/auth/*` → BetterAuth, everything else → TanStack Start SSR
- **Per-request auth factory** — BetterAuth instantiated per-request to receive the D1 binding
- **`tanstackStartCookies()` plugin** — essential for session cookies to work with SSR
- **`getRequest()` from `@tanstack/react-start/server`** — do NOT use `vinxi/http`, it crashes

See [SKILL.md](./SKILL.md) for the full implementation guide with exact code patterns.

## Installation
 
```bash
npx skills add bhirmbani/tanstack-start-cf-d1-auth-skills
```

## Usage

Tell your coding agent what you want to build and mention the stack:

```
Set up a TanStack Start app with BetterAuth and Cloudflare D1
```

The agent will use this skill to guide you through each phase with the exact file contents to create.

### Agent-specific setup

| Agent | How to use this skill |
|-------|----------------------|
| **Claude Code** | Add to your project via the skills system; the agent picks it up automatically |
| **Cursor** | Add `SKILL.md` contents to `.cursor/rules` or reference it in your system prompt |
| **Copilot / Windsurf** | Paste the `SKILL.md` contents into your custom instructions |
| **Other agents** | Copy the contents of `SKILL.md` into the agent's context or instructions |

## References

Step-by-step reference files for each phase:

- [`references/phase-1-infrastructure.md`](./references/phase-1-infrastructure.md)
- [`references/phase-2-database.md`](./references/phase-2-database.md)
- [`references/phase-3-auth.md`](./references/phase-3-auth.md)
