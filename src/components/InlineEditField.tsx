import { useEffect, useRef, useState } from 'react'
import { RiPencilLine } from '@remixicon/react'

import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

type InlineEditFieldProps = {
  value: string
  onSave: (value: string) => void
  ariaLabel: string
  as?: React.ElementType
  className?: string
  inputClassName?: string
}

export function InlineEditField({
  value,
  onSave,
  ariaLabel,
  as: Tag = 'span',
  className,
  inputClassName,
}: InlineEditFieldProps) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus()
      inputRef.current?.select()
    }
  }, [editing])

  const startEditing = () => {
    setDraft(value)
    setEditing(true)
  }

  const commit = () => {
    const trimmed = draft.trim()
    if (trimmed && trimmed !== value) {
      onSave(trimmed)
    }
    setEditing(false)
  }

  const discard = () => {
    setDraft(value)
    setEditing(false)
  }

  if (editing) {
    return (
      <Input
        ref={inputRef}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            commit()
          } else if (e.key === 'Escape') {
            e.preventDefault()
            discard()
          }
        }}
        aria-label={ariaLabel}
        className={cn(className, inputClassName)}
      />
    )
  }

  return (
    <Tag className={cn('group/edit inline-flex items-center gap-1.5', className)}>
      <span>{value}</span>
      <button
        type="button"
        onClick={startEditing}
        className="text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover/edit:opacity-100"
        aria-label={`Edit ${ariaLabel}`}
      >
        <RiPencilLine className="size-3.5" />
      </button>
    </Tag>
  )
}
