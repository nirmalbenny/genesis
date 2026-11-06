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
  const d = value instanceof Date ? value : parseDate(value);
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
  const d = parseDate(value);
  if (!d) return "—";
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function statusClass(status) {
  const s = String(status || "").toLowerCase();
  if (["confirmed", "showed", "booked"].includes(s)) return "good";
  if (["cancelled", "canceled", "noshow", "no_show", "invalid"].includes(s)) return "bad";
  if (["new", "pending"].includes(s)) return "warn";
  return "";
}