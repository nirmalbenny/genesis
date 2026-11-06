import { HL_PROXY, PREVIEW_TOKEN, LOCATION_ID } from "./hl.config.js";

export { LOCATION_ID };

export async function hlGet(path, params = {}) {
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") {
      qs.append(key, String(value));
    }
  }
  const base = String(HL_PROXY).replace(/\/+$/, "");
  const query = qs.toString();
  const url = `${base}${path}${query ? "?" + query : ""}`;

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