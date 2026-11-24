import { describe, expect, it } from 'vitest'
import { timeAgo } from './time'

describe('timeAgo', () => {
  const now = Date.UTC(2026, 10, 19, 12)
  it('reads naturally for recent times and falls back to a date after a week', () => {
    expect(timeAgo(now - 10_000, now)).toBe('just now')
    expect(timeAgo(now - 5 * 60_000, now)).toMatch(/5 minutes ago/)
    expect(timeAgo(now - 3 * 3_600_000, now)).toMatch(/3 hours ago/)
    expect(timeAgo(now - 26 * 3_600_000, now)).toMatch(/yesterday/)
    expect(timeAgo(now - 10 * 86_400_000, now)).not.toMatch(/ago/)
  })
})
