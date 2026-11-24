import { propagateAttributes, startObservation } from "@langfuse/tracing";
import { logger } from "firebase-functions";
import type { TokenUsage } from "../credits";
import type { BuildContext } from "../llm/buildContext";
import { CRITERIA, type BuildStatus, type Levels, type SecurityReview } from "../llm/variants";
import { costDetails, flushTraces, tracingOn, under, usageDetails } from "./langfuse";
import type { Score } from "./scores";

/**
 * A variant build in Langfuse (docs/plans/build-variants-evaluation.md): one trace, `variant-build`, in the app's
 * session (as its single builds are). Children: the planner, then one span per version holding its build and its two
 * reviews. The evaluation is also sent as scores, so Langfuse can filter, chart and compare it: per version the gate,
 * the total and each criterion's level (with the judge's reason), the security findings; per build what was offered
 * and charged. Content rule, as for builds: the request, the planner's prompts and the reviews' findings; never code.
 */

type Timed = { startedAt: number; endedAt: number; usage: TokenUsage };
export type VersionTrace = {
  title: string;
  summary: string;
  prompt: string;
  /** The look the planner gave this version. */
  style: string;
  /** The model and effort that built this version (VARIANT_BUILDS). */
  model: string;
  effort: string;
  status: BuildStatus;
  gate: "builds" | "secure" | "passed";
  files: string[];
  problems: string[];
  build: Timed;
  security: (Timed & { review: SecurityReview | null }) | null;
  quality: (Timed & { levels: Levels | null }) | null;
  total: number | null;
};
export type VariantTraceInput = {
  generationId: string;
  uid: string;
  projectId: string;
  appName: string;
  request: string;
  status: string;
  error: string | null;
  startedAt: number;
  endedAt: number;
  models: { build: string; security: string; quality: string };
  planner: (Timed & { name: string; declined: string | null }) | null;
  versions: VersionTrace[];
  finalists: number[];
  /** The guides sent and the content hash of every text involved (llm/buildContext.ts); null if the job ended earlier. */
  context?: BuildContext | null;
  credits: { held: number; charged: number; absorbed: number };
};
export type SentTrace = { traceId: string; versionIds: string[] };

const slug = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, "_");

/** The scores for a variant build (pure): per version on its span, per build on the trace. */
export function variantScores(t: VariantTraceInput, sent: SentTrace): Score[] {
  const id = (name: string, i?: number) => `${t.generationId}-${name}${i === undefined ? "" : `-v${i + 1}`}`;
  const scores: Score[] = [];
  t.versions.forEach((v, i) => {
    const on = { traceId: sent.traceId, observationId: sent.versionIds[i] };
    scores.push({ ...on, id: id("gate", i), name: "gate", value: v.gate, dataType: "CATEGORICAL", comment: v.title });
    scores.push({ ...on, id: id("build_config", i), name: "build_config", value: `${v.model}:${v.effort}`, dataType: "CATEGORICAL" });
    scores.push({ ...on, id: id("offered", i), name: "offered", value: t.finalists.includes(i) ? 1 : 0, dataType: "BOOLEAN" });
    if (v.total !== null) scores.push({ ...on, id: id("total", i), name: "total", value: v.total, dataType: "NUMERIC", comment: v.title });
    const review = v.security?.review;
    if (review) {
      scores.push({ ...on, id: id("security_findings", i), name: "security_findings", value: review.findings.length, dataType: "NUMERIC",
        comment: review.findings.map((f) => `[${f.severity}] ${f.check} ${f.file}${f.line ? `:${f.line}` : ""}: ${f.evidence}`).join("\n").slice(0, 1000) || undefined });
    }
    for (const c of CRITERIA) {
      const l = v.quality?.levels?.[c.id];
      if (l) {
        const failed = l.failed?.length ? `Failed checks: ${l.failed.join(", ")}. ` : "";
        scores.push({ ...on, id: id(`c${c.id}`, i), name: `c${c.id}_${slug(c.name)}`, value: l.level, dataType: "NUMERIC", comment: `${failed}${l.reason}`.slice(0, 500) });
      }
    }
  });
  const on = { traceId: sent.traceId };
  const totals = t.versions.map((v) => v.total).filter((n): n is number => n !== null).sort((a, b) => b - a);
  scores.push({ ...on, id: id("versions_passed"), name: "versions_passed", value: totals.length, dataType: "NUMERIC" });
  // How clearly the finalists beat the rest: the 2nd best's lead over the 3rd.
  if (totals.length >= 3) scores.push({ ...on, id: id("finalist_margin"), name: "finalist_margin", value: totals[1]! - totals[2]!, dataType: "NUMERIC" });
  scores.push({ ...on, id: id("charged_credits"), name: "charged_credits", value: t.credits.charged, dataType: "NUMERIC" });
  scores.push({ ...on, id: id("absorbed_credits"), name: "absorbed_credits", value: t.credits.absorbed, dataType: "NUMERIC" });
  return scores;
}

/** The scores sent when the customer keeps a version: which finalist (1 = the top-ranked) and on which version. */
export const keptScores = (generationId: string, sent: SentTrace, versionIndex: number, rank: number): Score[] => [
  { id: `${generationId}-kept_rank`, traceId: sent.traceId, name: "kept_rank", value: rank, dataType: "NUMERIC" },
  { id: `${generationId}-kept-v${versionIndex + 1}`, traceId: sent.traceId, observationId: sent.versionIds[versionIndex], name: "kept", value: 1, dataType: "BOOLEAN" },
];

/** Sends the trace; returns its ids for the scores (null when tracing is off or sending failed). Never throws. */
export async function sendVariantTrace(t: VariantTraceInput): Promise<SentTrace | null> {
  if (!tracingOn()) return null;
  try {
    const at = (ms: number) => new Date(ms);
    let sent: SentTrace | null = null;
    await propagateAttributes({
      userId: t.uid,
      sessionId: t.projectId, // the app's session, beside its single builds
      traceName: "variant-build",
      tags: ["variant-build", t.status],
      metadata: { generationId: t.generationId, projectName: t.appName },
    }, async () => {
      const root = startObservation("variant-build", {
        input: { request: t.request },
        output: {
          offered: t.finalists.map((i) => t.versions[i]?.title),
          versions: t.versions.map((v) => ({ title: v.title, gate: v.gate, total: v.total })),
        },
        level: t.status === "error" ? "ERROR" : t.status === "partial" || t.status === "cancelled" ? "WARNING" : "DEFAULT",
        statusMessage: t.error ?? undefined,
        metadata: { status: t.status, models: t.models, credits: t.credits, context: t.context ?? null },
      }, { asType: "agent", startTime: at(t.startedAt) });

      const p = t.planner;
      if (p) {
        under(root, () => startObservation("plan-versions", {
          model: t.models.build,
          input: { request: t.request },
          output: p.declined ? { declined: p.declined } : { appName: p.name, versions: t.versions.map(({ title, summary, style, prompt }) => ({ title, summary, style, prompt })) },
          usageDetails: usageDetails(p.usage),
          costDetails: costDetails(t.models.build, p.usage),
        }, { asType: "generation", startTime: at(p.startedAt) })).end(at(p.endedAt));
      }

      const versionIds = t.versions.map((v, i) => {
        const end = Math.max(v.build.endedAt, v.security?.endedAt ?? 0, v.quality?.endedAt ?? 0);
        const span = under(root, () => startObservation(`version-${i + 1}`, {
          input: { title: v.title, style: v.style, prompt: v.prompt, model: v.model, effort: v.effort },
          output: { gate: v.gate, total: v.total, offered: t.finalists.includes(i) },
          level: v.gate === "secure" ? "ERROR" : v.gate === "builds" ? "WARNING" : "DEFAULT",
          statusMessage: v.gate === "secure" ? "removed by the security review" : v.gate === "builds" ? `build ${v.status}` : undefined,
          metadata: { summary: v.summary },
        }, { startTime: at(v.build.startedAt) }));
        under(span, () => startObservation("build", {
          model: v.model,
          modelParameters: { effort: v.effort },
          input: { request: t.request, version: v.prompt },
          output: { status: v.status, filesWritten: v.files, problems: v.problems },
          usageDetails: usageDetails(v.build.usage),
          costDetails: costDetails(v.model, v.build.usage),
          level: v.status === "done" ? "DEFAULT" : "WARNING",
        }, { asType: "generation", startTime: at(v.build.startedAt) })).end(at(v.build.endedAt));
        const sec = v.security;
        if (sec) {
          under(span, () => startObservation("security-review", {
            model: t.models.security,
            output: sec.review ?? { error: "the review couldn't be completed" },
            usageDetails: usageDetails(sec.usage),
            costDetails: costDetails(t.models.security, sec.usage),
            level: !sec.review || v.gate === "secure" ? "ERROR" : sec.review.findings.length ? "WARNING" : "DEFAULT",
          }, { asType: "generation", startTime: at(sec.startedAt) })).end(at(sec.endedAt));
        }
        const q = v.quality;
        if (q) {
          under(span, () => startObservation("quality-review", {
            model: t.models.quality,
            output: q.levels ? Object.fromEntries(CRITERIA.map((c) => [c.name, q.levels![c.id]])) : { error: "the review couldn't be completed" },
            usageDetails: usageDetails(q.usage),
            costDetails: costDetails(t.models.quality, q.usage),
          }, { asType: "generation", startTime: at(q.startedAt) })).end(at(q.endedAt));
        }
        span.end(at(end));
        return span.id;
      });
      root.end(at(t.endedAt));
      sent = { traceId: root.traceId, versionIds };
    });
    await flushTraces();
    return sent;
  } catch (err) {
    logger.warn("variant.trace_send_failed", { generationId: t.generationId, error: err instanceof Error ? err.message : String(err) });
    return null;
  }
}
