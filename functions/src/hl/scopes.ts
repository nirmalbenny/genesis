import { db } from "../admin";

/** HighLevel's space-separated scope string as a sorted list. */
export const scopeList = (scope: string | undefined): string[] => [...new Set((scope ?? "").split(/\s+/).filter(Boolean))].sort();

/**
 * Copies the connection's granted scopes onto users/{uid}.hl (for connections made before the callback stored them),
 * so the app can tell the user which resources need a reconnect. Does nothing without a connection or when in sync.
 */
export async function syncGrantedScopes(uid: string): Promise<void> {
  const [user, tokens] = await Promise.all([db.doc(`users/${uid}`).get(), db.doc(`hlTokens/${uid}`).get()]);
  if (!user.get("hl") || !tokens.exists) return;
  const granted = scopeList(tokens.get("scope"));
  const shown = (user.get("hl.scopes") as string[] | undefined) ?? null;
  if (shown && shown.join(" ") === granted.join(" ")) return;
  await db.doc(`users/${uid}`).update({ "hl.scopes": granted });
}
