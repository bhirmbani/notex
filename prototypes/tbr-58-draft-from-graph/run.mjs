// PROTOTYPE — THROWAWAY. TBR-58. Starts the companion and the UI together.
// One command: `bun run prototype:tbr-58`
import { spawn } from "node:child_process"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))
const kids = [
  spawn(process.execPath, [resolve(here, "companion/server.mjs")], { stdio: "inherit" }),
  spawn("npx", ["vite", "--config", resolve(here, "ui/vite.config.ts")], {
    stdio: "inherit",
    shell: process.platform === "win32",
  }),
]

const bye = () => {
  for (const k of kids) k.kill()
  process.exit(0)
}
process.on("SIGINT", bye)
process.on("SIGTERM", bye)
for (const k of kids) k.on("exit", bye)
