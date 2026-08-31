// Shared copy-to-clipboard state (TBR-113's NotexJsonCard.tsx originally, now also
// QuestionGraphPanel.tsx's two copy actions — TBR-131). One hook instance per button: each
// tracks its own copied/error state independently.

import { useState } from "react"

export function useCopy() {
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState(false)

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setError(false)
    } catch {
      setError(true)
    }
  }

  return { copied, error, copy }
}
