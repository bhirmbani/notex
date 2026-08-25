import { Link } from "@tanstack/react-router"

type BreadcrumbItem = {
  label: string
  to?: string
   
  params?: Record<string, any>
}

export function Breadcrumb({ items }: { items: Array<BreadcrumbItem> }) {
  return (
    <div className="mb-6 flex items-center gap-1.5 font-mono text-[10px] tracking-wide text-muted-foreground">
      {items.map((item, i) => {
        const isLast = i === items.length - 1
        return (
          <span key={i} className="flex items-center gap-1.5">
            {i > 0 && <span>/</span>}
            {isLast || !item.to ? (
              <span className={isLast ? "truncate text-foreground" : ""}>
                {item.label}
              </span>
            ) : (
              <Link
                 
                to={item.to as any}
                params={item.params}
                className="transition-colors hover:text-foreground"
              >
                {item.label}
              </Link>
            )}
          </span>
        )
      })}
    </div>
  )
}
