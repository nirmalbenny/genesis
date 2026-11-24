import { logger } from "firebase-functions";
import { traceEnvironment } from "./langfuse";

/**
 * Langfuse scores through its public API (POST /api/public/scores: a JSON array; 202 when all are accepted, 207
 * with counts and errors otherwise, which must not be retried). No SDK: fetch with Basic auth. A score may arrive
 * before its trace; Langfuse links it once the trace exists. Each score carries a fixed id, so sending it again
 * on the same day replaces it rather than adding another.
 */

export type Score = {
  id: string;
  traceId: string;
  observationId?: string;
  name: string;
  value: number | string;
  dataType: "NUMERIC" | "CATEGORICAL" | "BOOLEAN";
  comment?: string;
};

export type LangfuseKeys = { publicKey: string; secretKey: string; baseUrl: string };
const TIMEOUT_MS = 3000;

/** Sends scores. Never throws and never waits more than TIMEOUT_MS: observability must not hold up the product. */
export async function sendScores(keys: LangfuseKeys, scores: Score[]): Promise<void> {
  if (!scores.length) return;
  try {
    const res = await fetch(`${keys.baseUrl.replace(/\/$/, "")}/api/public/scores`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${keys.publicKey}:${keys.secretKey}`).toString("base64")}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(scores.map((s) => ({ ...s, environment: traceEnvironment() }))),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (res.status === 207) logger.warn("variant.scores_partly_rejected", { result: (await res.text()).slice(0, 500) });
    else if (!res.ok) logger.warn("variant.scores_failed", { status: res.status });
  } catch (err) {
    logger.warn("variant.scores_failed", { error: err instanceof Error ? err.message : String(err) });
  }
}
