import { useQuery } from '@tanstack/react-query'
import { getActiveSession } from './lib/client'

export const sessionKeys = {
  active: ['active-session'] as const,
}

export function useActiveSession() {
  return useQuery({ queryKey: sessionKeys.active, queryFn: getActiveSession })
}
