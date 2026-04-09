import { useCallback, useEffect, useState } from 'react'
import { RiSunLine, RiMoonLine, RiComputerLine } from '@remixicon/react'
import { Button } from '@/components/ui/button'
import {
  type Theme,
  resolveTheme,
  getNextTheme,
  THEME_STORAGE_KEY,
} from '@/lib/theme'

function getStoredTheme(): Theme {
  if (typeof window === 'undefined') return 'system'
  const stored = localStorage.getItem(THEME_STORAGE_KEY)
  if (stored === 'light' || stored === 'dark' || stored === 'system') return stored
  return 'system'
}

function applyTheme(theme: Theme) {
  const systemIsDark = window.matchMedia('(prefers-color-scheme: dark)').matches
  const resolved = resolveTheme(theme, systemIsDark)
  document.documentElement.classList.toggle('dark', resolved === 'dark')
}

const icons: Record<Theme, typeof RiSunLine> = {
  light: RiSunLine,
  dark: RiMoonLine,
  system: RiComputerLine,
}

const labels: Record<Theme, string> = {
  light: 'Switch to dark mode',
  dark: 'Switch to system theme',
  system: 'Switch to light mode',
}

export function ThemeToggle({ className }: { className?: string }) {
  const [theme, setTheme] = useState<Theme>('system')

  useEffect(() => {
    const stored = getStoredTheme()
    setTheme(stored)
    applyTheme(stored)
  }, [])

  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const handler = () => {
      if (getStoredTheme() === 'system') applyTheme('system')
    }
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])

  const toggle = useCallback(() => {
    const next = getNextTheme(theme)
    setTheme(next)
    localStorage.setItem(THEME_STORAGE_KEY, next)
    applyTheme(next)
  }, [theme])

  const Icon = icons[theme]

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={toggle}
      aria-label={labels[theme]}
      className={className}
    >
      <Icon className="size-4" />
    </Button>
  )
}
