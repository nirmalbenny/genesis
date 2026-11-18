export const DAY_MS = 24 * 60 * 60 * 1000;

export function daysSince(ts, now) {
  if (ts === null || ts === undefined) return null;
  return Math.max(0, Math.floor((now - ts) / DAY_MS));
}

export function relativeFromDays(d) {
  if (d === null || d === undefined) return "Never";
  if (d < 1) return "Today";
  if (d === 1) return "Yesterday";
  if (d < 14) return `${d} days ago`;
  if (d < 60) return `${Math.floor(d / 7)} weeks ago`;
  if (d < 730) return `${Math.floor(d / 30)} months ago`;
  return `${Math.floor(d / 365)} years ago`;
}

export function formatDate(ts) {
  if (ts === null || ts === undefined) return "";
  try {
    return new Date(ts).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch (e) {
    return "";
  }
}

export function initialOf(name) {
  return ((name || "").match(/[\p{L}\p{N}]/u)?.[0] ?? "?").toUpperCase();
}
