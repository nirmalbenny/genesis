// Convert ISO strings, ms epoch numbers or numeric strings into a Date (or null).
export function toDate(value) {
  if (value === undefined || value === null || value === "") return null;
  let d;
  if (typeof value === "number") {
    d = new Date(value);
  } else if (typeof value === "string" && /^\d{11,}$/.test(value.trim())) {
    d = new Date(Number(value));
  } else {
    d = new Date(value);
  }
  return isNaN(d.getTime()) ? null : d;
}

export function relativeTime(value) {
  const d = toDate(value);
  if (!d) return "Unknown time";
  const diff = Date.now() - d.getTime();
  const future = diff < 0;
  const abs = Math.abs(diff);
  const min = Math.floor(abs / 60000);
  const hr = Math.floor(min / 60);
  const day = Math.floor(hr / 24);
  let text;
  if (min < 1) return "Just now";
  if (min < 60) text = `${min}m`;
  else if (hr < 24) text = `${hr}h`;
  else if (day < 30) text = `${day}d`;
  else return d.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
  return future ? `in ${text}` : `${text} ago`;
}

export function formatTime(value) {
  const d = toDate(value);
  if (!d) return "";
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

export function contactDisplayName(c) {
  if (!c) return "Unnamed contact";
  const full = [c.firstName, c.lastName].filter(Boolean).join(" ").trim();
  return (c.contactName || c.fullName || full || c.email || c.phone || "Unnamed contact").toString();
}