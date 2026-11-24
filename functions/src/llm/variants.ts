/**
 * Variant builds (docs/plans/build-variants.md): one request becomes 4 prompts, 4 builds run in parallel, and the 2
 * best are offered. How a build is judged is docs/plans/build-variants-evaluation.md; everything here is pure:
 * - Gate 1, builds: isEligible (the build finished and the code check left no problem);
 * - Gate 2, secure: securityRemoves (the AI security reviewer found a critical or high issue, or couldn't review);
 * - the quality score: 8 criteria on levels 0-4 (the quality judge scores 1, 2 and 4-8; criterion 3 comes from the
 *   security reviewer's care levels), and keepTwo.
 */

export const VARIANT_COUNT = 4;
export const FINALISTS = 2;

/** The quality score's criteria and points (the judges' instructions are rubric.md and security.md). */
export const CRITERIA = [
  { id: 1, name: "Does what was asked", points: 20 },
  { id: 2, name: "Works on real data", points: 15 },
  { id: 3, name: "Security and privacy care", points: 15 },
  { id: 4, name: "Handles failure", points: 15 },
  { id: 5, name: "Efficient with HighLevel", points: 10 },
  { id: 6, name: "Easy to use", points: 10 },
  { id: 7, name: "Accessible", points: 10 },
  { id: 8, name: "Built to last", points: 5 },
] as const;
export type CriterionId = (typeof CRITERIA)[number]["id"];
/** The criteria the quality judge scores (3 comes from the security reviewer). */
export const JUDGED: CriterionId[] = [1, 2, 4, 5, 6, 7, 8];

/** The security checks that must never fail (A1-A12) and the care items behind criterion 3 (B1-B7). */
export const SECURITY_CHECKS = ["A1", "A2", "A3", "A4", "A5", "A6", "A7", "A8", "A9", "A10", "A11", "A12"] as const;
export const CARE_ITEMS = ["B1", "B2", "B3", "B4", "B5", "B6", "B7"] as const;
export type CareItem = (typeof CARE_ITEMS)[number];

export const MAX_LEVEL = 4;

// ---- Each version's model and effort ----

export const EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;
export type Effort = (typeof EFFORTS)[number];
export type BuildConfig = { model: string; effort: Effort };
export const configKey = (c: BuildConfig) => `${c.model}:${c.effort}`;

/**
 * The VARIANT_BUILDS setting as VARIANT_COUNT configs: `model:effort`, comma-separated. Entries that don't parse are
 * dropped; too few are repeated in order; none at all means `fallbackModel` at high effort.
 */
export function parseBuildConfigs(text: string, fallbackModel: string): BuildConfig[] {
  const parsed = text.split(",").map((e) => e.trim().split(":")).flatMap(([model, effort]) =>
    model && EFFORTS.includes(effort as Effort) ? [{ model, effort: effort as Effort }] : []);
  const list = parsed.length ? parsed : [{ model: fallbackModel, effort: "high" as Effort }];
  return Array.from({ length: VARIANT_COUNT }, (_, i) => list[i % list.length]!);
}

/**
 * Which config builds which version: rotated by an offset taken from the build's id, so over many builds every
 * config builds every kind of prompt (the planner's first prompt isn't always Sonnet's). Deterministic per build.
 */
export function assignBuilds(configs: BuildConfig[], buildId: string): BuildConfig[] {
  const offset = [...buildId].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 0) % configs.length;
  return configs.map((_, i) => configs[(i + offset) % configs.length]!);
}

// ---- The four prompts must not mention our evaluation (build-variants.md §4.2) ----

const EVALUATION_TERMS = [
  /\bscor(e|es|ed|ing)\b/i, /\brubric\b/i, /\bcriteri(a|on)\b/i, /\bpoints?\b/i, /\bgrad(e|es|ed|er|ing)\b/i,
  /\bevaluat/i, /\bjudg(e|ed|es|ing)\b/i, /\bcompet(e|ing|ition)\b/i, /\bbest version\b/i, /\beliminat/i,
  /\bfinalists?\b/i, /\branked?\b/i,
  ...CRITERIA.map((c) => new RegExp(c.name.replace(/ /g, "\\s+"), "i")),
];

/** True when a text mentions evaluation, scoring or one of the criteria. */
export const mentionsEvaluation = (text: string): boolean => EVALUATION_TERMS.some((re) => re.test(text));

// ---- Gate 1: builds ----

export type BuildStatus = "done" | "problems" | "truncated" | "error" | "cancelled" | "declined";

/** Only a build that finished with every change accepted and no problem left goes on. */
export const isEligible = (status: BuildStatus): boolean => status === "done";

// ---- Gate 2: secure ----

export type Severity = "critical" | "high" | "medium" | "low";
export type SecurityFinding = { check: string; severity: Severity; file: string; line: number | null; evidence: string };
/** The security reviewer's answer; null when the review couldn't be completed. */
export type SecurityReview = { findings: SecurityFinding[]; care: Partial<Record<CareItem, number>>; checkedSinks: string[] };

/** A version is removed by a critical or high finding, or when it couldn't be reviewed: nothing is offered unreviewed. */
export function securityRemoves(review: SecurityReview | null): boolean {
  return !review || review.findings.some((f) => f.severity === "critical" || f.severity === "high");
}

const clampLevel = (n: unknown): number => (typeof n === "number" && Number.isFinite(n) ? Math.max(0, Math.min(MAX_LEVEL, Math.round(n))) : 0);

/** Criterion 3's level: the care items' average, rounded down, one level lower per medium finding (never below 0). */
export function careLevel(review: SecurityReview): number {
  // A care item the reviewer didn't return is taken as not applicable (full): care never removes a version.
  const levels = CARE_ITEMS.map((b) => (review.care[b] === undefined ? MAX_LEVEL : clampLevel(review.care[b])));
  const average = Math.floor(levels.reduce((a, b) => a + b, 0) / levels.length);
  const mediums = review.findings.filter((f) => f.severity === "medium").length;
  return Math.max(0, average - mediums);
}

// ---- The quality score ----

/** A criterion's level, why, and (for the judged criteria) the checks that failed. */
export type Level = { level: number; reason: string; failed?: string[] };
export type Levels = Record<CriterionId, Level>;

/**
 * The checks of each judged criterion (rubric.md lists them with the same numbers); `key` ones matter most. The judge
 * only reports which checks failed; levelFromChecks turns that into a level, so the same failures always give the
 * same level (docs/plans/build-variants-evaluation.md §6.3).
 */
export const CHECKS: Record<Exclude<CriterionId, 3>, { ids: string[]; key: string[] }> = {
  1: { ids: ["1.1", "1.2", "1.3", "1.4", "1.5", "1.6"], key: ["1.1", "1.2"] },
  2: { ids: ["2.1", "2.2", "2.3", "2.4", "2.5", "2.6", "2.7"], key: ["2.1"] },
  4: { ids: ["4.1", "4.2", "4.3", "4.4", "4.5", "4.6"], key: ["4.1", "4.2"] },
  5: { ids: ["5.1", "5.2", "5.3", "5.4", "5.5", "5.6"], key: ["5.1", "5.2"] },
  6: { ids: ["6.1", "6.2", "6.3", "6.4", "6.5", "6.6"], key: [] },
  7: { ids: ["7.1", "7.2", "7.3", "7.4", "7.5"], key: ["7.1", "7.2"] },
  8: { ids: ["8.1", "8.2", "8.3", "8.4", "8.5"], key: [] },
};

/**
 * The level from the failed checks: 4 none failed · 3 one non-KEY failed · 2 a KEY failed, or two or three failed ·
 * 1 more than three failed · 0 the criterion's purpose isn't met at all. Unknown check ids are ignored.
 */
export function levelFromChecks(id: Exclude<CriterionId, 3>, failed: string[], purposeMet = true): number {
  if (!purposeMet) return 0;
  const { ids, key } = CHECKS[id];
  const fails = [...new Set(failed)].filter((f) => ids.includes(f));
  if (!fails.length) return 4;
  if (fails.length > 3) return 1;
  if (fails.length === 1 && !key.includes(fails[0]!)) return 3;
  return 2;
}

/**
 * All 8 levels: the quality judge's (clamped to 0-4; a criterion it didn't grade is 0, so a version is never chosen
 * unseen) and criterion 3 from the security review.
 */
export function levelsOf(judged: Partial<Record<CriterionId, Level>>, review: SecurityReview): Levels {
  const out = {} as Levels;
  for (const c of CRITERIA) {
    if (c.id === 3) {
      out[3] = { level: careLevel(review), reason: "From the security review." };
      continue;
    }
    const given = judged[c.id];
    // Keep the failed checks with the level: stored scores, traces and reports show which checks decided it.
    out[c.id] = { level: clampLevel(given?.level), reason: given?.reason ?? "Not graded.", ...(given?.failed ? { failed: given.failed } : {}) };
  }
  return out;
}

/** A criterion's points: its weight × level ÷ 4, rounded to the nearest point. */
export const pointsOf = (id: CriterionId, level: number): number =>
  Math.round((CRITERIA.find((c) => c.id === id)!.points * level) / MAX_LEVEL);

export const total = (l: Levels): number => CRITERIA.reduce((sum, c) => sum + pointsOf(c.id, l[c.id].level), 0);

export type Candidate = { index: number; levels: Levels };

/**
 * The finalists, best first: by total; ties go to security and privacy care, then works on real data, then does what
 * was asked, then build order (so the result never depends on which build finished first).
 */
export function keepTwo(candidates: Candidate[]): number[] {
  const sorted = [...candidates].sort((a, b) =>
    total(b.levels) - total(a.levels)
    || b.levels[3].level - a.levels[3].level
    || b.levels[2].level - a.levels[2].level
    || b.levels[1].level - a.levels[1].level
    || a.index - b.index);
  return sorted.slice(0, FINALISTS).map((c) => c.index);
}
