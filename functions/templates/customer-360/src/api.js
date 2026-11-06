import { HL_PROXY, PREVIEW_TOKEN, LOCATION_ID } from "./hl.config.js";

export { LOCATION_ID };

export async function hl(path, params = {}) {
  const clean = {};
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== "") clean[k] = v;
  }
  const qs = new URLSearchParams(clean).toString();
  const base = String(HL_PROXY || "").replace(/\/$/, "");
  const url = `${base}${path}${qs ? (path.includes("?") ? "&" : "?") + qs : ""}`;

  let res;
  try {
    res = await fetch(url, {
      headers: { Authorization: `Bearer ${PREVIEW_TOKEN}` },
    });
  } catch (e) {
    throw new Error("Could not reach the server. Check your connection and try again.");
  }

  let data = null;
  try {
    data = await res.json();
  } catch (e) {
    data = null;
  }

  if (!res.ok) {
    throw new Error(
      (data && data.error && data.error.message) || `Request failed (${res.status})`
    );
  }
  return data || {};
}