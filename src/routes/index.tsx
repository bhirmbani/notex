import { useEffect, useId, useState } from 'react'
import { Link, createFileRoute } from '@tanstack/react-router'
import { buttonVariants } from '@/components/ui/button'
import { ThemeToggle } from '@/components/ThemeToggle'

export const Route = createFileRoute('/')({
  component: HomePage,
})

const terminalSteps = [
  {
    prompt: '/graphify src --update',
    note: 'inside a Claude Code session',
    output: 'Updated graphify-out/graph.json',
  },
  {
    prompt: 'npx notex-companion serve',
    output: 'Companion ready · reading graph.json · graph stamp: fresh',
  },
  {
    prompt: 'graph_query({ terms: ["draft synthesis"] })',
    output: '4 nodes, 1 hub -> context.markdown ready',
  },
]

const faqs = [
  {
    q: 'Is Notex open source?',
    a: "Yes, AGPL-3.0. Self-host it, read it, modify it, freely. If you run a modified version as a hosted service, you're required to offer that service's users the modified source too, so a fork can't quietly compete without giving anything back to the people using it. notex-companion (MIT) and graphify, the code-graph tool it reads from, are both separately public too.",
  },
  {
    q: 'What does graphify actually do?',
    a: "It scans a repository and builds a code graph: files, symbols, and how they connect, including the structurally significant nodes and clusters a directory listing won't show. It's a separate tool, a Claude Code skill or CLI, that you run yourself. Notex doesn't ship or run it for you.",
  },
  {
    q: "What's the difference between Notex and graphify?",
    a: 'graphify is the tool that builds the code graph: a CLI or Claude Code skill you run yourself, with its own command-line query, path, and explain tools. It has no web app, no accounts, and no place to save a written answer. Notex is the knowledge base built around that graph: Projects, Repositories, Questions, and Answers, a browser you and your team actually use, and a Companion that serves graphify\'s own output to that browser and to an MCP host.',
  },
  {
    q: 'Why not just use graphify on its own?',
    a: "You can, for one person querying one checkout from a terminal. graphify has no concept of a Question or an Answer, nothing to share with a teammate, and nothing that remembers what was already asked. Notex adds that layer: a drafted Answer gets saved, cited, and stamped with the graph it came from, so the next person who asks the same thing finds it instead of re-running graphify's tools themselves.",
  },
  {
    q: 'Does Notex run graphify for me?',
    a: "No. The Companion only reads the graphify-out/graph.json file already sitting in your checkout. It never shells out to graphify and never builds a graph itself.",
  },
  {
    q: 'What happens if I forget to rerun graphify after changing code?',
    a: 'The graph goes stale, and Notex reports that instead of hiding it. Every drafted Answer carries the build time and commit hash of the graph it came from, so you can see exactly how current the evidence is.',
  },
  {
    q: "Why not just use graphify's own MCP server directly?",
    a: "You can, it ships one, though the MCP extra isn't installed by default. Notex's server adds structured JSON instead of formatted text blocks, a graph stamp on every response, staleness reporting graphify doesn't have, and the half graphify was never going to build: your Questions and Answers, read and written alongside the graph.",
  },
  {
    q: 'Is a Notex Repository the same as my git repository?',
    a: "No. A Repository here groups Questions and files inside a Project and carries no git semantics. It's bound to a Checkout, your local working copy, by hand; the two are never assumed to be the same thing.",
  },
]

const glossary = [
  {
    term: 'Project',
    definition:
      'The top-level container you create. A Project owns one or more Repositories.',
  },
  {
    term: 'Repository',
    definition:
      "A grouping of Questions and source files inside a Project. No git semantics here, it's a Notex grouping, not a version-control repo.",
  },
  {
    term: 'Question',
    definition:
      "A single prompt captured under a Repository. The question text is also its title, there's no separate field to fill in twice.",
  },
  {
    term: 'Answer',
    definition:
      'A response to a Question: a plain-text write-up, or an uploaded file when the answer is a document rather than prose.',
  },
]

function GitHubIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
    </svg>
  )
}

function CompanionTerminal() {
  const [step, setStep] = useState(0)
  const done = step >= terminalSteps.length

  return (
    <div
      className="border border-border bg-card font-mono text-xs sm:text-sm"
      role="group"
      aria-label="Example commands for building and querying the code graph"
    >
      <div className="border-b border-border px-4 py-2 text-muted-foreground">
        companion walkthrough
      </div>
      <div className="h-52 space-y-3 overflow-y-auto p-4">
        {terminalSteps.slice(0, step).map((s) => (
          <div key={s.prompt}>
            <div>
              <span className="text-primary">&#10095;</span> {s.prompt}
            </div>
            {s.note && (
              <div className="text-muted-foreground"># {s.note}</div>
            )}
            <div className="text-muted-foreground">{s.output}</div>
          </div>
        ))}
        {step === 0 && (
          <p className="text-muted-foreground">
            Press run to step through building and querying the graph.
          </p>
        )}
      </div>
      <div className="flex items-center justify-between gap-3 border-t border-border px-4 py-3">
        <button
          type="button"
          onClick={() =>
            setStep((s) => (s >= terminalSteps.length ? 0 : s + 1))
          }
          className={buttonVariants({
            variant: 'outline',
            size: 'sm',
            className: 'h-9 px-4',
          })}
        >
          {done ? 'Replay' : step === 0 ? 'Run' : 'Next command'}
        </button>
        <span className="text-muted-foreground">
          {Math.min(step, terminalSteps.length)}/{terminalSteps.length}
        </span>
      </div>
    </div>
  )
}

function PrivacyPolicyModal({
  open,
  onClose,
}: {
  open: boolean
  onClose: () => void
}) {
  const titleId = useId()

  useEffect(() => {
    if (!open) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = previousOverflow
    }
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-background/80 p-4 py-10 backdrop-blur-sm sm:items-center"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(e) => e.stopPropagation()}
        className="max-h-full w-full max-w-2xl overflow-y-auto border border-border bg-card"
      >
        <div className="sticky top-0 flex items-center justify-between border-b border-border bg-card px-6 py-4">
          <h2 id={titleId} className="text-lg font-bold">
            Privacy Policy
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close privacy policy"
            className={buttonVariants({
              variant: 'ghost',
              size: 'icon',
              className: 'h-9 w-9',
            })}
          >
            &#10005;
          </button>
        </div>
        <div className="space-y-6 px-6 py-6 text-sm text-muted-foreground">
          <p className="text-xs text-muted-foreground">
            Last updated: September 8, 2026
          </p>
          <p>
            This describes how Notex handles data across the hosted app and
            the local Companion process described elsewhere on this page.
            It's written from the actual architecture, not a generic
            template.
          </p>
          <div>
            <h3 className="font-mono text-sm font-bold text-foreground">
              What Notex stores
            </h3>
            <ul className="mt-3 list-disc space-y-2 pl-5">
              <li>Account information needed to sign you in.</li>
              <li>
                The Projects, Repositories, Questions, and Answers you
                create.
              </li>
              <li>
                Notex API keys you generate in Settings, used to
                authenticate the Companion and MCP host to Notex.
              </li>
              <li>
                A session cookie used only to keep you signed in. Notex
                does not use analytics or advertising cookies.
              </li>
            </ul>
          </div>
          <div>
            <h3 className="font-mono text-sm font-bold text-foreground">
              What Notex never stores
            </h3>
            <ul className="mt-3 list-disc space-y-2 pl-5">
              <li>
                Your source code or the code graph
                (graphify-out/graph.json). The Companion reads it from your
                machine and serves it directly to your browser or MCP host;
                Notex's servers never see it.
              </li>
              <li>
                Your Provider key (Anthropic, or any OpenAI-compatible
                endpoint). It stays in your browser's local storage.
              </li>
              <li>
                The Companion's pairing token. It's generated and kept on
                your machine, and never reaches Notex's Worker or database.
              </li>
              <li>
                Draft synthesis calls, which run browser-direct to your
                provider with no proxy fallback.
              </li>
              <li>
                Vocabulary expansion calls, which run browser-direct by
                default. If your browser can't reach the provider, Notex
                relays the call without storing the key or its contents.
              </li>
            </ul>
          </div>
          <div>
            <h3 className="font-mono text-sm font-bold text-foreground">
              Third parties involved
            </h3>
            <ul className="mt-3 list-disc space-y-2 pl-5">
              <li>
                Cloudflare, which hosts the application and its database.
                Cloudflare processes data on Notex's behalf as its
                infrastructure provider.
              </li>
              <li>
                Whichever LLM provider you configure (Anthropic, or an
                OpenAI-compatible endpoint). You talk to it directly with
                your own key; Notex is not a party to that call except the
                documented vocabulary-expansion fallback above.
              </li>
            </ul>
          </div>
          <div>
            <h3 className="font-mono text-sm font-bold text-foreground">
              Your control over your data
            </h3>
            <ul className="mt-3 list-disc space-y-2 pl-5">
              <li>
                Project deletion is admin-only, regardless of Grant level,
                so access to delete what you've stored is deliberately
                restricted.
              </li>
              <li>
                Rotate or revoke the Companion's pairing token any time by
                running it with --rotate-token.
              </li>
              <li>Revoke a Notex API key from Settings at any time.</li>
              <li>
                Your Provider key never leaves your browser, so revoking it
                is entirely in your hands: clear it from local storage or
                rotate it with your provider.
              </li>
            </ul>
          </div>
          <div>
            <h3 className="font-mono text-sm font-bold text-foreground">
              Changes to this policy
            </h3>
            <p className="mt-3">
              If this changes, the update appears on this page. There's no
              separate mailing list to track it through.
            </p>
          </div>
          <div>
            <h3 className="font-mono text-sm font-bold text-foreground">
              Contact
            </h3>
            <p className="mt-3">
              Questions about this policy:{' '}
              <span className="italic">[ADD CONTACT EMAIL]</span>
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}

function HomePage() {
  const [privacyOpen, setPrivacyOpen] = useState(false)
  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <header className="sticky top-0 z-10 border-b border-border bg-background/95 backdrop-blur-sm">
        <div className="mx-auto flex h-16 max-w-5xl items-center justify-between gap-4 px-4 sm:px-6">
          <span className="font-heading text-sm font-bold tracking-tight">
            Notex
          </span>
          <nav className="flex items-center gap-2">
            <a
              href="https://github.com/bhirmbani/notex"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="View Notex on GitHub, opens in a new tab"
              className={buttonVariants({
                variant: 'ghost',
                size: 'icon',
                className: 'h-11 w-11',
              })}
            >
              <GitHubIcon className="h-5 w-5" />
            </a>
            <ThemeToggle />
            <Link
              to="/login"
              className={buttonVariants({ variant: 'ghost', className: 'h-11 px-4' })}
            >
              Sign in
            </Link>
            <Link
              to="/register"
              className={buttonVariants({
                className: 'hidden h-11 px-4 sm:inline-flex',
              })}
            >
              Create free account
            </Link>
          </nav>
        </div>
      </header>

      <main className="flex-1">
        <section className="mx-auto max-w-5xl px-4 py-16 sm:px-6 sm:py-24">
          <div className="grid gap-10 lg:grid-cols-[1.1fr_0.9fr] lg:items-center lg:gap-16">
            <div>
              <h1 className="text-3xl leading-tight font-bold text-balance sm:text-4xl lg:text-5xl">
                Ask your codebase a{' '}
                <span className="text-primary">Question</span>. Get an{' '}
                <span className="text-primary">Answer</span> grounded in the
                code it's about.
              </h1>
              <p className="mt-5 max-w-xl text-base text-muted-foreground sm:text-lg">
                Notex organizes engineering knowledge as Projects,
                Repositories, Questions, and Answers. A local Companion
                process turns a repository into a queryable graph, so a
                drafted Answer cites real source instead of guessing.
              </p>
              <div className="mt-8 flex flex-wrap gap-3">
                <Link
                  to="/register"
                  className={buttonVariants({ className: 'h-11 px-5' })}
                >
                  Create a free account
                </Link>
                <a
                  href="#how-it-works"
                  className={buttonVariants({
                    variant: 'outline',
                    className: 'h-11 px-5',
                  })}
                >
                  See how it's organized
                </a>
              </div>
              <p className="mt-4 text-sm text-muted-foreground">
                Open source, AGPL-3.0.{' '}
                <a
                  href="https://github.com/bhirmbani/notex"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary underline-offset-4 hover:underline"
                >
                  Read the code on GitHub.
                </a>
              </p>
            </div>

            <CompanionTerminal />
          </div>
        </section>

        <section
          id="how-it-works"
          className="border-t border-border bg-muted/30"
        >
          <div className="mx-auto max-w-5xl px-4 py-16 sm:px-6 sm:py-20">
            <h2 className="text-2xl font-bold sm:text-3xl">
              How Notex is organized
            </h2>
            <p className="mt-3 max-w-2xl text-muted-foreground">
              No folders, no wiki to keep in sync by hand. Four kinds of
              things, nested inside each other.
            </p>
            <dl className="mt-10 grid gap-8 sm:grid-cols-2">
              {glossary.map((entry) => (
                <div key={entry.term}>
                  <dt className="font-mono text-sm font-bold text-primary">
                    {entry.term}
                  </dt>
                  <dd className="mt-2 text-sm text-muted-foreground">
                    {entry.definition}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        </section>

        <section id="more" className="border-t border-border">
          <div className="mx-auto max-w-5xl px-4 py-16 sm:px-6 sm:py-20">
            <h2 className="text-2xl font-bold sm:text-3xl">
              There's more in a Project than Questions and Answers
            </h2>
            <p className="mt-3 max-w-2xl text-muted-foreground">
              Three things that don't fit the glossary above, because they
              cut across it instead of adding another entity to it.
            </p>
            <div className="mt-10 grid gap-10 lg:grid-cols-3 lg:gap-8">
              <div>
                <h3 className="font-mono text-sm font-bold text-primary">
                  Notes and diagrams
                </h3>
                <p className="mt-3 text-sm text-muted-foreground">
                  A Project holds more than Questions and Answers. Add a
                  Note, a full markdown editor with live preview, for
                  anything that doesn't fit a Question, or a Mermaid
                  diagram when a picture says it faster than prose. Both
                  live in the Project alongside everything else.
                </p>
              </div>
              <div>
                <h3 className="font-mono text-sm font-bold text-primary">
                  A mind map, not just a hierarchy
                </h3>
                <p className="mt-3 text-sm text-muted-foreground">
                  Every Repository, Question, Answer, Note, and diagram in
                  a Project can be linked to any other one directly, on
                  purpose, past the fixed Project owns Repository owns
                  Question chain above. The mind map draws the result: how
                  your team's knowledge actually connects, not just how
                  it's filed.
                </p>
              </div>
              <div>
                <h3 className="font-mono text-sm font-bold text-primary">
                  Nobody gets a Project by default
                </h3>
                <p className="mt-3 text-sm text-muted-foreground">
                  Inviting someone to your Organization doesn't hand them
                  every Project. The invite is a single-use, expiring link;
                  once accepted, an admin decides which Projects that
                  person can read, and which they can write to, one
                  Project at a time. Admins get every Project without a
                  Grant. Everyone else starts with none.
                </p>
              </div>
            </div>
          </div>
        </section>

        <section id="graphify" className="border-t border-border">
          <div className="mx-auto max-w-5xl px-4 py-16 sm:px-6 sm:py-20">
            <div className="grid gap-10 lg:grid-cols-2 lg:gap-16">
              <div>
                <h2 className="text-2xl font-bold sm:text-3xl">
                  graphify builds the graph. The Companion only reads it.
                </h2>
                <p className="mt-4 text-muted-foreground">
                  graphify turns a repository into a code graph: it walks the
                  source, extracts files and symbols, and works out which
                  ones are structurally load-bearing (what the skill calls a
                  god node) and which cluster into communities a file tree
                  won't show you. It runs on its own schedule, as a Claude
                  Code skill or CLI you invoke yourself, and writes the
                  result to graphify-out/graph.json.
                </p>
                <p className="mt-4 text-muted-foreground">
                  Notex's Companion never calls graphify and never builds a
                  graph of its own. It reads whatever graph.json is already
                  on disk and stamps every response with the build time and
                  commit the graph came from, so a stale graph gets
                  reported, not hidden.
                </p>
              </div>
              <div>
                <div className="border border-border bg-card p-6 font-mono text-sm">
                  <div className="text-muted-foreground">
                    example graph stamp
                  </div>
                  <div className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
                    <span className="text-muted-foreground">built</span>
                    <span>2026-09-08T14:02Z</span>
                    <span className="text-muted-foreground">commit</span>
                    <span>a1b2c3d</span>
                    <span className="text-muted-foreground">root</span>
                    <span>src/</span>
                    <span className="text-muted-foreground">status</span>
                    <span>fresh</span>
                  </div>
                </div>
                <p className="mt-3 text-xs text-muted-foreground">
                  One commit later, with no rerun, the same stamp reports{' '}
                  <span className="text-destructive">
                    status: stale, re-run graphify
                  </span>
                  , instead of quietly serving old evidence.
                </p>
              </div>
            </div>
          </div>
        </section>

        <section
          id="companion"
          className="border-t border-border bg-muted/30"
        >
          <div className="mx-auto max-w-5xl px-4 py-16 sm:px-6 sm:py-20">
            <div className="grid gap-10 lg:grid-cols-2 lg:gap-16">
              <div>
                <h2 className="text-2xl font-bold sm:text-3xl">
                  A Companion process that runs on your machine, not ours
                </h2>
                <p className="mt-4 text-muted-foreground">
                  The notex-companion process reads your checkout's code
                  graph and serves retrieval to the browser and to an MCP
                  host. It holds no LLM, never builds the graph itself, and
                  never talks to Notex's database.
                </p>
                <p className="mt-4 text-muted-foreground">
                  Drafting an Answer from the graph uses your own Provider
                  key (Anthropic, or any OpenAI-compatible endpoint) for
                  vocabulary expansion and synthesis, and both run from your
                  browser, not from Notex's backend.{' '}
                  <a
                    href="#privacy"
                    className="text-primary underline-offset-4 hover:underline"
                  >
                    See exactly what's stored below.
                  </a>
                </p>
              </div>
              <div className="border border-border bg-card p-6 font-mono text-sm lg:self-start">
                <div className="text-muted-foreground">companion flow</div>
                <div className="mt-3">graphify-out/graph.json</div>
                <div className="mt-1 pl-4 text-foreground">
                  &#8595; read by
                </div>
                <div className="mt-1">notex-companion (local)</div>
                <div className="mt-1 pl-4 text-foreground">
                  &#8595; serves
                </div>
                <div className="mt-1">browser + MCP host</div>
                <div className="mt-1 pl-4 text-foreground">
                  &#8595; exposes
                </div>
                <div className="mt-1 text-muted-foreground">
                  graph_query, graph_search, graph_path, graph_node,
                  notex_*
                </div>
              </div>
            </div>
          </div>
        </section>

        <section id="install" className="border-t border-border">
          <div className="mx-auto max-w-5xl px-4 py-16 sm:px-6 sm:py-20">
            <h2 className="text-2xl font-bold sm:text-3xl">
              Installing the Companion
            </h2>
            <p className="mt-3 max-w-2xl text-muted-foreground">
              No install step, really. npx runs it directly, and it never
              listens beyond your own machine.
            </p>
            <div className="mt-10 grid gap-10 lg:grid-cols-2 lg:gap-16">
              <div className="border border-border bg-card p-6 font-mono text-sm">
                <div className="text-muted-foreground">example run</div>
                <div className="mt-3">
                  <span className="text-primary">&#10095;</span> npx
                  notex-companion@latest
                </div>
                <div className="mt-3 text-muted-foreground">
                  Serving ./your-checkout
                </div>
                <div className="text-muted-foreground">
                  1,204 nodes &middot; 3,860 edges &middot; 42 communities
                </div>
                <div className="mt-2 text-primary">
                  Pairing: nt_9f2a... (paste into Connect companion)
                </div>
              </div>
              <div>
                <ol className="list-decimal space-y-4 pl-5 text-sm text-muted-foreground marker:text-foreground">
                  <li>
                    Run{' '}
                    <code className="bg-muted px-1 py-0.5 font-mono text-foreground">
                      npx notex-companion@latest
                    </code>{' '}
                    inside a checkout that already has a
                    graphify-out/graph.json.
                  </li>
                  <li>
                    Paste the pairing line it prints into Notex's "Connect
                    companion" flow to pair your browser.
                  </li>
                  <li>
                    Using an MCP host? Wire it in with{' '}
                    <code className="bg-muted px-1 py-0.5 font-mono text-foreground">
                      claude mcp add notex-companion -- npx
                      notex-companion@latest mcp
                    </code>
                    .
                  </li>
                </ol>
                <p className="mt-6 text-sm text-muted-foreground">
                  Needs Node.js 18 or newer, nothing else, no Python, no
                  native build toolchain. The server binds 127.0.0.1 only,
                  so it's never reachable from your LAN, let alone the
                  internet.
                </p>
              </div>
            </div>
          </div>
        </section>

        <section id="open-source" className="border-t border-border bg-muted/30">
          <div className="mx-auto max-w-5xl px-4 py-16 sm:px-6 sm:py-20">
            <h2 className="text-2xl font-bold sm:text-3xl">
              Notex is open source
            </h2>
            <p className="mt-3 max-w-2xl text-muted-foreground">
              AGPL-3.0. Self-host it, read it, modify it. The graph builder
              and the Companion it reads from are both public too, so
              nothing above is a marketing claim you have to take on faith.
            </p>
            <div className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              <a
                href="https://github.com/bhirmbani/notex"
                target="_blank"
                rel="noopener noreferrer"
                className="group flex items-center gap-4 border border-primary/40 bg-card p-6 transition-colors hover:border-primary"
              >
                <GitHubIcon className="h-8 w-8 shrink-0 text-foreground" />
                <div>
                  <div className="font-mono text-sm font-bold group-hover:text-primary">
                    bhirmbani/notex{' '}
                    <span aria-hidden="true">&#8599;</span>
                  </div>
                  <div className="mt-1 text-sm text-muted-foreground">
                    The full app, AGPL-3.0. Source on GitHub, opens in a new
                    tab.
                  </div>
                </div>
              </a>
              <a
                href="https://github.com/Graphify-Labs/graphify"
                target="_blank"
                rel="noopener noreferrer"
                className="group flex items-center gap-4 border border-border bg-card p-6 transition-colors hover:border-primary/60"
              >
                <GitHubIcon className="h-8 w-8 shrink-0 text-foreground" />
                <div>
                  <div className="font-mono text-sm font-bold group-hover:text-primary">
                    Graphify-Labs/graphify{' '}
                    <span aria-hidden="true">&#8599;</span>
                  </div>
                  <div className="mt-1 text-sm text-muted-foreground">
                    The tool that builds the code graph. Source on GitHub,
                    opens in a new tab.
                  </div>
                </div>
              </a>
              <a
                href="https://www.npmjs.com/package/notex-companion"
                target="_blank"
                rel="noopener noreferrer"
                className="group flex items-center gap-4 border border-border bg-card p-6 transition-colors hover:border-primary/60"
              >
                <svg
                  viewBox="0 0 24 24"
                  className="h-8 w-8 shrink-0"
                  aria-hidden="true"
                >
                  <rect width="24" height="24" fill="#CB3837" />
                  <text
                    x="12"
                    y="16"
                    textAnchor="middle"
                    fontFamily="monospace"
                    fontWeight="bold"
                    fontSize="8"
                    fill="#ffffff"
                  >
                    npm
                  </text>
                </svg>
                <div>
                  <div className="font-mono text-sm font-bold group-hover:text-primary">
                    notex-companion <span aria-hidden="true">&#8599;</span>
                  </div>
                  <div className="mt-1 text-sm text-muted-foreground">
                    Published on npm. Install it with npx
                    notex-companion@latest, opens in a new tab.
                  </div>
                </div>
              </a>
            </div>
          </div>
        </section>

        <section id="privacy" className="border-t border-border">
          <div className="mx-auto max-w-5xl px-4 py-16 sm:px-6 sm:py-20">
            <h2 className="text-2xl font-bold sm:text-3xl">
              Your knowledge lives here. Your code doesn't.
            </h2>
            <p className="mt-3 max-w-2xl text-muted-foreground">
              Here's exactly where each piece of data actually sits, not a
              summary of a policy.
            </p>
            <div className="mt-10 grid border border-border sm:grid-cols-2">
              <div className="bg-card p-6">
                <h3 className="font-mono text-sm font-bold">
                  Stored on Notex
                </h3>
                <ul className="mt-4 space-y-3 text-sm text-muted-foreground">
                  <li>
                    Your Projects, Repositories, Questions, and Answers: the
                    knowledge you actually save.
                  </li>
                  <li>
                    Notex API keys you generate in Settings, used to
                    authenticate the Companion and MCP host to Notex.
                  </li>
                </ul>
              </div>
              <div className="border-t border-primary/40 bg-card p-6 sm:border-t-0 sm:border-l">
                <h3 className="font-mono text-sm font-bold text-primary">
                  Never stored on Notex
                </h3>
                <ul className="mt-4 space-y-3 text-sm text-muted-foreground">
                  <li>
                    Your source code and the code graph
                    (graphify-out/graph.json): the Companion serves it
                    straight from your machine to your browser. It never
                    uploads.
                  </li>
                  <li>
                    Your Provider key (Anthropic, or any OpenAI-compatible
                    endpoint): stays in your browser's local storage.
                  </li>
                  <li>
                    The Companion's pairing token: device-local, never
                    reaches Notex's Worker or its database.
                  </li>
                  <li>
                    Draft synthesis calls: run browser-direct to your
                    provider, with no proxy fallback.
                  </li>
                  <li>
                    Vocabulary expansion calls: direct by default too. If
                    your browser can't reach the provider, Notex relays the
                    call without storing the key or its contents.
                  </li>
                </ul>
              </div>
            </div>
          </div>
        </section>

        <section id="faq" className="border-t border-border bg-muted/30">
          <div className="mx-auto max-w-5xl px-4 py-16 sm:px-6 sm:py-20">
            <h2 className="text-2xl font-bold sm:text-3xl">FAQ</h2>
            <p className="mt-3 max-w-2xl text-muted-foreground">
              Specific to how graphify, the Companion, and Notex fit
              together, not the usual template questions.
            </p>
            <div className="mt-8 divide-y divide-border border-t border-border">
              {faqs.map((item) => (
                <details key={item.q} className="group py-4">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-medium">
                    {item.q}
                    <span
                      className="shrink-0 text-muted-foreground transition-transform group-open:rotate-45"
                      aria-hidden="true"
                    >
                      +
                    </span>
                  </summary>
                  <p className="mt-3 text-sm text-muted-foreground">
                    {item.a}
                  </p>
                </details>
              ))}
            </div>
          </div>
        </section>

        <section className="border-t border-border">
          <div className="mx-auto flex max-w-5xl flex-col items-start gap-6 px-4 py-16 sm:items-center sm:px-6 sm:py-20 sm:text-center">
            <h2 className="text-2xl font-bold sm:text-3xl">
              Give your team's questions a place to live next to the code.
            </h2>
            <div className="flex flex-wrap gap-3">
              <Link
                to="/register"
                className={buttonVariants({ className: 'h-11 px-5' })}
              >
                Create a free account
              </Link>
              <Link
                to="/login"
                className={buttonVariants({
                  variant: 'outline',
                  className: 'h-11 px-5',
                })}
              >
                Sign in
              </Link>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-8 sm:px-6">
          <span className="font-mono text-xs text-muted-foreground">
            Notex
          </span>
          <button
            type="button"
            onClick={() => setPrivacyOpen(true)}
            className="-m-3 p-3 font-mono text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
          >
            Privacy policy
          </button>
        </div>
      </footer>

      <PrivacyPolicyModal
        open={privacyOpen}
        onClose={() => setPrivacyOpen(false)}
      />
    </div>
  )
}
