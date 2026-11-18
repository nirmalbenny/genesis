import { toDate } from "./genesis/hl.js";

export function dayKey(date) {
  if (!date) return "unknown";
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${m}-${d}`;
}

export function fmtDay(date) {
  if (!date) return "Date unknown";
  return date.toLocaleDateString(undefined, {
    weekday: "long",
    month: "short",
    day: "numeric",
  });
}

export function fmtTime(date) {
  if (!date) return "—";
  return date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

export function fmtDateTime(value) {
  const d = value instanceof Date ? value : toDate(value);
  if (!d) return "—";
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function fmtDate(value) {
  const d = toDate(value);
  if (!d) return "—";
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function statusType(status) {
  const s = String(status || "").toLowerCase();
  if (["confirmed", "showed", "booked"].includes(s)) return "success";
  if (["cancelled", "canceled", "noshow", "no_show", "invalid"].includes(s)) return "danger";
  if (["new", "pending"].includes(s)) return "warning";
  return "info";
}

export function capitalize(text) {
  const s = String(text || "");
  return s.charAt(0).toUpperCase() + s.slice(1);
}
