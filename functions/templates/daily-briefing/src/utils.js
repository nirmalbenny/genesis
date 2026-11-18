import { toDate } from "./genesis/hl.js";

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

export function initials(name) {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}
