// The Node fallback exists because `npx notex-companion` runs under plain Node, where
// `Bun.serve` does not exist (TBR-66) — this exercises that path directly (forcing
// runtime: "node") even though the suite itself runs under `bun test`, since Bun also
// implements `node:http` and the whole point is that this path never touches Bun.* APIs.

import { connect } from "node:net"
import { describe, expect, it } from "bun:test"
import { startServer } from "../net.ts"

function echoHandler(): (req: Request) => Promise<Response> {
  return async (req) => {
    const body = req.method === "GET" || req.method === "HEAD" ? undefined : await req.text()
    return new Response(JSON.stringify({ method: req.method, url: req.url, origin: req.headers.get("origin"), body }), {
      status: 200,
      headers: { "content-type": "application/json", "x-test": "yes" },
    })
  }
}

async function fetchWithRetry(url: string, init?: RequestInit, attempts = 20): Promise<Response> {
  for (let i = 0; i < attempts; i++) {
    try {
      return await fetch(url, init)
    } catch (err) {
      if (i === attempts - 1) throw err
      await new Promise((r) => setTimeout(r, 10))
    }
  }
  throw new Error("unreachable")
}

describe("startServer(..., \"node\")", () => {
  it("binds 127.0.0.1 on the requested fixed port and serves the fetch handler", async () => {
    const handle = startServer({ hostname: "127.0.0.1", port: 18923, fetch: echoHandler() }, "node")
    try {
      expect(handle.hostname).toBe("127.0.0.1")
      expect(handle.port).toBe(18923)
      const res = await fetchWithRetry(`http://127.0.0.1:${handle.port}/hello?x=1`, {
        headers: { origin: "https://example.com" },
      })
      expect(res.status).toBe(200)
      expect(res.headers.get("x-test")).toBe("yes")
      const body = (await res.json()) as { method: string; url: string; origin: string | null }
      expect(body).toMatchObject({ method: "GET", origin: "https://example.com" })
      expect(body.url).toContain("/hello?x=1")
    } finally {
      handle.stop(true)
    }
  })

  it("forwards a POST body to the handler", async () => {
    const handle = startServer({ hostname: "127.0.0.1", port: 18924, fetch: echoHandler() }, "node")
    try {
      const res = await fetchWithRetry(`http://127.0.0.1:${handle.port}/echo`, {
        method: "POST",
        body: JSON.stringify({ q: "hi" }),
      })
      const body = (await res.json()) as { method: string; body: string }
      expect(body.method).toBe("POST")
      expect(JSON.parse(body.body)).toEqual({ q: "hi" })
    } finally {
      handle.stop(true)
    }
  })

  it("rejects a dynamic port (0) — the Node fallback requires an explicit port", () => {
    expect(() => startServer({ hostname: "127.0.0.1", port: 0, fetch: echoHandler() }, "node")).toThrow()
  })

  it("survives a client that declares a body then aborts mid-request", async () => {
    const handle = startServer({ hostname: "127.0.0.1", port: 18926, fetch: echoHandler() }, "node")
    try {
      await new Promise<void>((done) => {
        const socket = connect(handle.port, "127.0.0.1", () => {
          // Content-Length promises 100000 bytes; only 1 is ever sent, then the socket dies —
          // this is exactly what a client that resets mid-upload looks like on the wire.
          socket.write("POST /echo HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Length: 100000\r\n\r\nx")
          setTimeout(() => {
            socket.destroy()
            done()
          }, 50)
        })
        socket.on("error", () => done())
      })

      // A crashed server would drop every subsequent connection, not just this one — this is
      // the assertion that actually catches the process-wide crash, not just this request.
      const res = await fetchWithRetry(`http://127.0.0.1:${handle.port}/still-alive`)
      expect(res.status).toBe(200)
    } finally {
      handle.stop(true)
    }
  })
})
