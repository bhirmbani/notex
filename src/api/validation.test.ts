import { describe, expect, it } from 'vitest'

import { requireNonEmptyString } from './validation'

describe('requireNonEmptyString', () => {
  it('returns the trimmed value when non-empty', () => {
    expect(requireNonEmptyString('  hello  ')).toBe('hello')
  })

  it('returns null for an empty string', () => {
    expect(requireNonEmptyString('')).toBeNull()
  })

  it('returns null for a whitespace-only string', () => {
    expect(requireNonEmptyString('   ')).toBeNull()
  })

  it('returns null for a non-string value', () => {
    expect(requireNonEmptyString(123)).toBeNull()
    expect(requireNonEmptyString(null)).toBeNull()
    expect(requireNonEmptyString(undefined)).toBeNull()
    expect(requireNonEmptyString(['a'])).toBeNull()
  })
})
