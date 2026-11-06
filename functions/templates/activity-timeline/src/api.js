import { HL_PROXY, PREVIEW_TOKEN } from "./hl.config.js";

export async function hlGet(path, params = {}) {
  const qs = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== "") qs.append(k, String(v));
  });
  const base = String(HL_PROXY || "").replace(/\/+$/, "");
  const url = base + path + (qs.toString() ? "?" + qs.toString() : "");

  let res;
  try {
    res = await fetch(url, {
      headers: { Authorization: `Bearer ${PREVIEW_TOKEN}` },
    });
  } catch (e) {
    throw new Error("Network error: could not reach the server.");
  }

  let data = null;
  try {
    data = await res.json();
  } catch (e) {
    data = null;
  }

  if (!res.ok) {
    const msg =
      (data && data.error && data.error.message) ||
      `Request failed (${res.status})`;
    throw new Error(msg);
  }
  return data || {};
}