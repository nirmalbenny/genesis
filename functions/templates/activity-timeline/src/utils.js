/** "kavya pillai" -> "Kavya Pillai"; names that already have capitals are left alone. */
export function titleCase(s) {
  const t = String(s || "").trim();
  if (!t || t !== t.toLowerCase()) return t;
  return t.replace(/(^|[\s'(-])(\p{L})/gu, (_, sep, ch) => sep + ch.toUpperCase());
}

export function contactDisplayName(c) {
  if (!c) return "Unnamed contact";
  const full = [c.firstName, c.lastName].filter(Boolean).join(" ").trim();
  const name = (c.contactName && String(c.contactName).trim()) || full;
  return name ? titleCase(name) : c.email || c.phone || "Unnamed contact";
}

const AVATAR_COLORS = ["#ff5c35", "#00a4bd", "#7c5cdb", "#00bda5", "#f2547d", "#f5a623", "#516f90"];
/** Stable colour per name so the same person always looks the same. */
export function avatarColor(name) {
  let h = 0;
  for (const ch of String(name || "")) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

/** "in 3 days", "2 h ago", "just now". */
export function relative(date) {
  if (!date) return "";
  const diff = date.getTime() - Date.now();
  const abs = Math.abs(diff);
  const fmt = new Intl.RelativeTimeFormat([], { numeric: "auto" });
  if (abs < 60e3) return "just now";
  if (abs < 3600e3) return fmt.format(Math.round(diff / 60e3), "minute");
  if (abs < 86400e3) return fmt.format(Math.round(diff / 3600e3), "hour");
  if (abs < 30 * 86400e3) return fmt.format(Math.round(diff / 86400e3), "day");
  return fmt.format(Math.round(diff / (30 * 86400e3)), "month");
}

export function initials(name) {
  const parts = String(name || "")
    .trim()
    .split(/\s+/)
    .map((p) => p.replace(/[^\p{L}\p{N}]/gu, ""))
    .filter(Boolean);
  if (!parts.length) return "?";
  const letters = parts.slice(0, 2).map((p) => p[0]);
  return letters.join("").toUpperCase();
}

export function parseDate(value) {
  if (value === undefined || value === null || value === "") return null;
  let d;
  if (typeof value === "number") {
    d = new Date(value);
  } else {
    let s = String(value).trim();
    if (/^\d{4}-\d{2}-\d{2} \d/.test(s)) s = s.replace(" ", "T");
    d = new Date(s);
  }
  return isNaN(d.getTime()) ? null : d;
}

export function dayKey(date) {
  if (!date) return "unknown";
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${m}-${d}`;
}

export function dayLabel(date) {
  if (!date) return "Unknown date";
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  const key = dayKey(date);
  const tomorrow = new Date();
  tomorrow.setDate(today.getDate() + 1);
  if (key === dayKey(today)) return "Today";
  if (key === dayKey(yesterday)) return "Yesterday";
  if (key === dayKey(tomorrow)) return "Tomorrow";
  return date.toLocaleDateString([], {
    weekday: "short",
    month: "short",
    day: "numeric",
    ...(date.getFullYear() !== today.getFullYear() ? { year: "numeric" } : {}),
  });
}

export function timeLabel(date) {
  if (!date) return "";
  return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

export function fullLabel(date) {
  if (!date) return "";
  return date.toLocaleString();
}

export function prettify(text) {
  if (!text) return "";
  const s = String(text)
    .replace(/^TYPE_/i, "")
    .replace(/[_-]+/g, " ")
    .trim()
    .toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
}