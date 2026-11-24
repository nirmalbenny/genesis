import type Anthropic from "@anthropic-ai/sdk";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  CARE_ITEMS, CHECKS, JUDGED, levelFromChecks, SECURITY_CHECKS, type CareItem, type CriterionId, type Level, type SecurityReview, type Severity,
} from "./variants";

/**
 * The two AI reviews of a variant build's version (docs/plans/build-variants-evaluation.md), each on its own, never
 * next to the other versions:
 * - the security reviewer (security.md): findings by check with a severity, care levels and the sinks it checked;
 * - the quality judge (rubric.md): a level and a reason for criteria 1, 2 and 4-8.
 * Both answer with structured output. Nothing else reads their instructions.
 */

export const REVIEW_MAX_TOKENS = 8000; // thinking included
export const RUBRIC = readFileSync(join(__dirname, "rubric.md"), "utf8");
export const SECURITY = readFileSync(join(__dirname, "security.md"), "utf8");

const documents = (files: Record<string, string>) =>
  `<documents>\n${Object.keys(files).sort().map((p) => `<document><source>${p}</source><document_content>\n${files[p]}\n</document_content></document>`).join("\n")}\n</documents>`;

type Input = { request: string; version: string; files: Record<string, string> };
const userTurn = (input: Input): Anthropic.MessageParam => ({
  role: "user",
  content: `The customer's request:\n<request>\n${input.request}\n</request>\n\nThis version:\n<version>\n${input.version}\n</version>\n\nThe app's files:\n${documents(input.files)}`,
});
const request = (model: string, system: string, schema: Record<string, unknown>, input: Input): Anthropic.MessageCreateParamsNonStreaming => ({
  model,
  max_tokens: REVIEW_MAX_TOKENS,
  system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
  output_config: { format: { type: "json_schema", schema } },
  messages: [userTurn(input)],
});
const parse = (text: string): Record<string, unknown> | null => {
  try {
    const v = JSON.parse(text);
    return v && typeof v === "object" ? v : null;
  } catch {
    return null;
  }
};

// ---- Quality judge ----

// Per criterion: the checks that failed (only that criterion's numbers), whether its purpose is met at all, and why.
// The level is computed from these (levelFromChecks), never taken from the model.
const judged = (id: Exclude<CriterionId, 3>) => ({
  type: "object",
  additionalProperties: false,
  required: ["failed", "purposeMet", "reason"],
  properties: {
    failed: { type: "array", items: { type: "string", enum: CHECKS[id].ids } },
    purposeMet: { type: "boolean" },
    reason: { type: "string" },
  },
});
const QUALITY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: JUDGED.map((id) => `c${id}`),
  properties: Object.fromEntries(JUDGED.map((id) => [`c${id}`, judged(id as Exclude<CriterionId, 3>)])),
};

export const qualityRequest = (model: string, input: Input) => request(model, RUBRIC, QUALITY_SCHEMA, input);

/**
 * The judge's answer as levels: each criterion's level computed from the checks it failed. Missing or malformed
 * criteria are left out (levelsOf scores them 0).
 */
export function parseQuality(text: string): Partial<Record<CriterionId, Level>> {
  const data = parse(text);
  const out: Partial<Record<CriterionId, Level>> = {};
  for (const id of JUDGED) {
    const v = data?.[`c${id}`] as { failed?: unknown; purposeMet?: unknown; reason?: unknown } | undefined;
    if (!v || !Array.isArray(v.failed)) continue;
    const checks = id as Exclude<CriterionId, 3>;
    const failed = [...new Set(v.failed.filter((f): f is string => typeof f === "string" && CHECKS[checks].ids.includes(f)))].sort();
    out[id] = {
      level: levelFromChecks(checks, failed, v.purposeMet !== false),
      failed,
      reason: typeof v.reason === "string" ? v.reason.slice(0, 400) : "",
    };
  }
  return out;
}

// ---- Security reviewer ----

const SEVERITIES: Severity[] = ["critical", "high", "medium", "low"];
const SECURITY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["findings", "care", "checkedSinks"],
  properties: {
    findings: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["check", "severity", "file", "line", "evidence"],
        properties: {
          check: { type: "string", enum: [...SECURITY_CHECKS] },
          severity: { type: "string", enum: SEVERITIES },
          file: { type: "string" },
          line: { type: ["integer", "null"] },
          evidence: { type: "string" },
        },
      },
    },
    care: {
      type: "object",
      additionalProperties: false,
      required: [...CARE_ITEMS],
      properties: Object.fromEntries(CARE_ITEMS.map((b) => [b, { type: "integer" }])),
    },
    checkedSinks: { type: "array", items: { type: "string" } },
  },
};

export const securityRequest = (model: string, input: Input) => request(model, SECURITY, SECURITY_SCHEMA, input);

/** The security review, or null when the answer can't be read (the version then counts as not reviewed). */
export function parseSecurity(text: string): SecurityReview | null {
  const data = parse(text);
  if (!data || !Array.isArray(data.findings)) return null;
  const findings = (data.findings as Record<string, unknown>[])
    .filter((f) => typeof f?.check === "string" && SEVERITIES.includes(f.severity as Severity))
    .map((f) => ({
      check: String(f.check),
      severity: f.severity as Severity,
      file: typeof f.file === "string" ? f.file : "",
      line: typeof f.line === "number" ? f.line : null,
      evidence: typeof f.evidence === "string" ? f.evidence.slice(0, 300) : "",
    }));
  const care: Partial<Record<CareItem, number>> = {};
  const given = (data.care ?? {}) as Record<string, unknown>;
  for (const b of CARE_ITEMS) if (typeof given[b] === "number") care[b] = given[b] as number;
  const checkedSinks = Array.isArray(data.checkedSinks) ? (data.checkedSinks as unknown[]).filter((s): s is string => typeof s === "string").slice(0, 100) : [];
  return { findings, care, checkedSinks };
}
