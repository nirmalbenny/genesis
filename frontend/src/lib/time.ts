// Each unit and how many of it make the next one (a week ends the relative range).
const STEPS: [Intl.RelativeTimeFormatUnit, number][] = [['minute', 60], ['hour', 24], ['day', 7]]

/** "just now", "5 minutes ago", "3 hours ago", "yesterday"; a date after a week. */
export function timeAgo(ms: number, now = Date.now()): string {
  const seconds = (now - ms) / 1000
  if (seconds < 45) return 'just now'
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })
  let value = seconds / 60
  for (const [unit, next] of STEPS) {
    if (value < next) return rtf.format(-Math.max(1, Math.round(value)), unit)
    value /= next
  }
  return new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}
