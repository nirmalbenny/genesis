export function parseDate(value) {
  if (value === undefined || value === null || value === "") return null;
  let d;
  if (typeof value === "number") d = new Date(value);
  else if (/^\d{10,}$/.test(String(value))) d = new Date(Number(value));
  else d = new Date(value);
  return isNaN(d.getTime()) ? null : d;
}

export function formatDate(value) {
  const d = parseDate(value);
  if (!d) return "Unknown date";
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function formatDateTime(value) {
  const d = parseDate(value);
  if (!d) return "Time unknown";
  return d.toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function relativeTime(value) {
  const d = parseDate(value);
  if (!d) return "";
  const diff = Date.now() - d.getTime();
  const abs = Math.abs(diff);
  const min = 60 * 1000;
  const hour = 60 * min;
  const day = 24 * hour;
  let text;
  if (abs < min) return "just now";
  if (abs < hour) text = `${Math.round(abs / min)}m`;
  else if (abs < day) text = `${Math.round(abs / hour)}h`;
  else if (abs < 30 * day) text = `${Math.round(abs / day)}d`;
  else if (abs < 365 * day) text = `${Math.round(abs / (30 * day))}mo`;
  else text = `${Math.round(abs / (365 * day))}y`;
  return diff >= 0 ? `${text} ago` : `in ${text}`;
}

export function contactDisplayName(c) {
  if (!c) return "Unnamed lead";
  const full = [c.firstName, c.lastName].filter(Boolean).join(" ").trim();
  return (
    (c.contactName && String(c.contactName).trim()) ||
    full ||
    c.email ||
    c.phone ||
    "Unnamed lead"
  );
}
