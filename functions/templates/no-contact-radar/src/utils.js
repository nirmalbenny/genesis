export const DAY_MS = 24 * 60 * 60 * 1000;

// Accepts ms epoch numbers, numeric strings, or ISO-like date strings.
export function parseDate(value) {
  if (value === null || value === undefined || value === "") return null;
  let ts;
  if (typeof value === "number") {
    ts = value;
  } else if (/^\d+$/.test(String(value).trim())) {
    ts = Number(value);
  } else {
    ts = Date.parse(String(value));
  }
  if (!Number.isFinite(ts) || ts <= 0) return null;
  return ts;
}

export function contactDisplayName(c) {
  const full = [c && c.firstName, c && c.lastName]
    .filter((x) => typeof x === "string" && x.trim())
    .join(" ")
    .trim();
  return (
    (c && typeof c.contactName === "string" && c.contactName.trim()) ||
    full ||
    (c && c.email) ||
    (c && c.phone) ||
    "Unnamed contact"
  );
}

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
