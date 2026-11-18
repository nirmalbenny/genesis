import { ref, onMounted, onBeforeUnmount } from "vue";
import { contactName, toDate } from "./genesis/hl.js";

export function initials(c) {
  const name = String(contactName(c) || "").trim();
  const parts = name
    .split(/[\s@.]+/)
    .map((p) => p.replace(/[^\p{L}\p{N}]/gu, ""))
    .filter(Boolean);
  const letters = (parts[0] ? parts[0][0] : "") + (parts.length > 1 ? parts[1][0] : "");
  return (letters || "?").toUpperCase();
}

export function fmtDate(v) {
  const d = v instanceof Date ? v : toDate(v);
  if (!d) return "—";
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export function fmtDateTime(v) {
  const d = v instanceof Date ? v : toDate(v);
  if (!d) return "No date";
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function typeLabel(t) {
  if (!t) return "Message";
  return String(t)
    .replace(/^TYPE_/, "")
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/^\w/, (c) => c.toUpperCase());
}

export function useIsPhone() {
  const mq = window.matchMedia("(max-width: 640px)");
  const isPhone = ref(mq.matches);
  const onChange = (e) => {
    isPhone.value = e.matches;
  };
  onMounted(() => mq.addEventListener("change", onChange));
  onBeforeUnmount(() => mq.removeEventListener("change", onChange));
  return isPhone;
}
