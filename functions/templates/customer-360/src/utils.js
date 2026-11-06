export function displayName(c) {
  if (!c) return "Unnamed contact";
  const full = [c.firstName, c.lastName].filter(Boolean).join(" ").trim();
  return (
    (c.contactName && String(c.contactName).trim()) ||
    full ||
    c.email ||
    c.phone ||
    "Unnamed contact"
  );
}

export function initials(c) {
  const name = displayName(c);
  if (name === "Unnamed contact") return "?";
  const parts = name.split(/[\s@.]+/).map((p) => p.replace(/[^\p{L}\p{N}]/gu, "")).filter(Boolean);
  const letters = (parts[0] ? parts[0][0] : "") + (parts.length > 1 ? parts[1][0] : "");
  return (letters || "?").toUpperCase();
}

export function toDate(v) {
  if (v === undefined || v === null || v === "") return null;
  let d;
  if (typeof v === "number") d = new Date(v);
  else if (/^\d{10,13}$/.test(String(v))) d = new Date(Number(v));
  else {
    let s = String(v);
    if (/^\d{4}-\d{2}-\d{2} /.test(s)) s = s.replace(" ", "T");
    d = new Date(s);
  }
  return isNaN(d.getTime()) ? null : d;
}

export function fmtDate(v) {
  const d = toDate(v);
  if (!d) return "—";
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export function fmtDateTime(v) {
  const d = toDate(v);
  if (!d) return "No date";
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}