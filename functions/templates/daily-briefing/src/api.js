import { HL_PROXY, PREVIEW_TOKEN, LOCATION_ID } from "./hl.config.js";

export { LOCATION_ID };

// Read-only GET helper for the HighLevel proxy. Throws Error with the proxy's message on failure.
export async function hlGet(path, params = {}) {
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") qs.set(key, String(value));
  }
  const base = String(HL_PROXY || "").replace(/\/+$/, "");
  const url = `${base}${path}${qs.toString() ? "?" + qs.toString() : ""}`;

  let res;
  try {
    res = await fetch(url, {
      method: "GET",
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
    const msg = data && data.error && data.error.message;
    throw new Error(msg || `Request failed (${res.status})`);
  }
  return data || {};
}