import ReactMarkdown from "react-markdown"
import remarkBreaks from "remark-breaks"
import remarkGfm from "remark-gfm"
import type { Components } from "react-markdown"

import { cn } from "@/lib/utils"

const components: Components = {
  h1: ({ className, node: _node, ...props }) => (
    <h1 className={cn("mt-4 mb-2 text-base font-semibold first:mt-0", className)} {...props} />
  ),
  h2: ({ className, node: _node, ...props }) => (
    <h2 className={cn("mt-4 mb-2 text-sm font-semibold first:mt-0", className)} {...props} />
  ),
  h3: ({ className, node: _node, ...props }) => (
    <h3 className={cn("mt-3 mb-1.5 text-xs font-semibold first:mt-0", className)} {...props} />
  ),
  h4: ({ className, node: _node, ...props }) => (
    <h4 className={cn("mt-3 mb-1.5 text-xs font-semibold first:mt-0", className)} {...props} />
  ),
  p: ({ className, node: _node, ...props }) => <p className={cn("mb-3 last:mb-0", className)} {...props} />,
  a: ({ className, node: _node, ...props }) => (
    <a
      className={cn("text-primary underline underline-offset-2", className)}
      target="_blank"
      rel="noreferrer noopener"
      {...props}
    />
  ),
  ul: ({ className, node: _node, ...props }) => (
    <ul className={cn("mb-3 list-disc space-y-1 pl-5 last:mb-0", className)} {...props} />
  ),
  ol: ({ className, node: _node, ...props }) => (
    <ol className={cn("mb-3 list-decimal space-y-1 pl-5 last:mb-0", className)} {...props} />
  ),
  hr: ({ className, node: _node, ...props }) => (
    <hr className={cn("my-4 border-border", className)} {...props} />
  ),
  blockquote: ({ className, node: _node, ...props }) => (
    <blockquote
      className={cn("mb-3 border-l-2 border-border pl-3 text-muted-foreground last:mb-0", className)}
      {...props}
    />
  ),
  pre: ({ className, node: _node, ...props }) => (
    <pre className={cn("mb-3 overflow-x-auto rounded-sm bg-muted p-3 last:mb-0", className)} {...props} />
  ),
  code: ({ className, node: _node, children, ...props }) => {
    const isBlock = String(children).includes("\n")
    if (isBlock) {
      return (
        <code className={className} {...props}>
          {children}
        </code>
      )
    }
    return (
      <code className={cn("rounded-sm bg-muted px-1 py-0.5", className)} {...props}>
        {children}
      </code>
    )
  },
}

export function MarkdownContent({ content }: { content: string }) {
  return (
    <div className="overflow-x-auto p-4 font-mono text-xs leading-relaxed break-words text-foreground">
      <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]} components={components}>
        {content}
      </ReactMarkdown>
    </div>
  )
}
