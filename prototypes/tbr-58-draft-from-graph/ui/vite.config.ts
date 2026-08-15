// PROTOTYPE — THROWAWAY. TBR-58.
import { defineConfig } from "vite"
import viteReact from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"

export default defineConfig({
  root: import.meta.dirname,
  server: { port: 5858 },
  plugins: [tailwindcss(), viteReact()],
})
