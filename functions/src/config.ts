import { defineSecret, defineString } from "firebase-functions/params";

export const ANTHROPIC_API_KEY = defineSecret("ANTHROPIC_API_KEY");
export const HL_CLIENT_ID = defineSecret("HL_CLIENT_ID");
export const HL_CLIENT_SECRET = defineSecret("HL_CLIENT_SECRET");
export const PREVIEW_TOKEN_SECRET = defineSecret("PREVIEW_TOKEN_SECRET");

export const ANTHROPIC_MODEL = defineString("ANTHROPIC_MODEL");
export const ANTHROPIC_SUMMARY_MODEL = defineString("ANTHROPIC_SUMMARY_MODEL", { default: "claude-haiku-5-5" });
export const HL_REDIRECT_URI = defineString("HL_REDIRECT_URI");
export const APP_URL = defineString("APP_URL");

/**
 * Browser origins allowed to call api, generate and hlAuthStart: the app's Firebase Hosting domains and the
 * Vite dev server. hlProxy stays open to any origin, because generated apps run on Sandpack's origin.
 */
const PROJECT_ID = process.env.GCLOUD_PROJECT ?? "";
export const APP_ORIGINS: (string | RegExp)[] = [
  `https://${PROJECT_ID}.web.app`,
  `https://${PROJECT_ID}.firebaseapp.com`,
  /^http:\/\/(localhost|127\.0\.0\.1):5173$/,
];

export const HL_API_BASE = "https://services.leadconnectorhq.com";
export const HL_SCOPES = [
  "contacts.readonly",
  "contacts.write",
  "conversations.readonly",
  "conversations.write",
  "conversations/message.readonly",
  "conversations/message.write",
  "calendars.readonly",
  "calendars/events.readonly",
  "calendars/events.write",
  "locations.readonly",
].join(" ");
