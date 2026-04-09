export type Theme = 'light' | 'dark' | 'system'
export type ResolvedTheme = 'light' | 'dark'

export const THEME_STORAGE_KEY = 'notex-theme'

const cycle: Record<Theme, Theme> = {
  light: 'dark',
  dark: 'system',
  system: 'light',
}

export function resolveTheme(theme: Theme, systemIsDark: boolean): ResolvedTheme {
  if (theme === 'system') return systemIsDark ? 'dark' : 'light'
  return theme
}

export function getNextTheme(current: Theme): Theme {
  return cycle[current]
}
