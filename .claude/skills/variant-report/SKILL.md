---
name: variant-report
description: Report on variant builds ("Show me 2 options") from Firestore — what the planner wrote for each version, which gate each passed or failed, the security review's findings, the 8 quality criteria with the judge's reasons, totals, finalists, the version kept and the credits charged and absorbed — for one build or across all of them. Use when asked how variant builds are scoring, why a version was offered or removed, which criteria lose points, whether the security gate fires, or before changing the planner, the rubric or the security brief.
---

# Variant build report

How variant builds are judged is [docs/plans/build-variants-evaluation.md](../../../docs/plans/build-variants-evaluation.md):
gate 1 (builds), gate 2 (AI security review: a critical or high finding removes the version), then 8 criteria on levels
0–4 (100 points), top 2 offered. Everything per build is stored in Firestore at `variantScores/{generationId}`, which no
client can read.

**Local only:** the script reads the emulators (`firebase emulators:start` running; `cd functions && npm run build`
first). For production, read the same data in Langfuse (trace `variant-build` in the app's session, scores per version)
or the Firebase console; never print keys or tokens.

## 1. Pick the scope

```bash
node scripts/inspect-variants.mjs --list  [--email <owner>]   # recent variant builds, one line each
node scripts/inspect-variants.mjs --stats [--email <owner>]   # across all builds scored with the two gates
node scripts/inspect-variants.mjs <app id | name | latest> [--email <owner>] [--generation <id>] [--short] [--sinks]
```

- `--list`: per version its total, or the gate it failed (`BUILD`, `SEC`); `*` = offered; `(old)` = scored with the
  earlier 10-criterion rubric (not comparable).
- `--stats`: gate removal rates, security findings by check and severity, each criterion's average level (lowest
  first), the finalist margin (2nd best over 3rd), which finalist customers kept, credits charged and absorbed.
- One build: the request; per version the planner's title, summary and prompt, the build (status, files, problems),
  the gate result, the security review (findings with evidence; care levels B1–B7; `--sinks` lists every sink it
  checked), the 8 levels with points and the judge's reason; then offered, kept and the charge. `--short` drops the
  long prompts and reasons.

Use the app id from the app's URL (`/p/<id>`, `/choose/<id>`) or `--list`.

Validating the reviews themselves (both call Claude; a few cents to under a dollar):

```bash
node scripts/eval-security.mjs [case id…] [--runs <n>]          # planted security defects + safe controls
node scripts/eval-consistency.mjs [--email <owner>] [--builds <n>] [--runs <n>]   # re-review stored finalists
```

Run `eval-security` after any change to `security.md`, and `eval-consistency` after any change to `rubric.md` or the
levels; record the results in the evaluation doc's §11.

## 2. What to look for

| Seen | Means | Where to act |
|---|---|---|
| A version `REMOVED at gate 2` | A critical or high security finding: read its evidence and the file before trusting it | A real defect: the build prompt or UI guide (`functions/src/llm/prompt.ts`, `functions/src/llm/ui/element-plus.md`). A false alarm: `functions/src/llm/security.md` |
| `security: NOT REVIEWED` | The review failed twice; the version was removed unseen | `build.variants` / `variant.*` lines in the functions log; the security model setting |
| One criterion low in every version (`--stats` lowest first) | A gap in how all builds are made, not a difference between versions | The build prompt or UI guide, not the scorecard (accessibility so far) |
| `Does what was asked` at 2–3 with reasons naming extra or missing features | The planner changed the request (added features, dropped parts) | The planner's instructions (`functions/src/llm/plan.ts`) |
| A judge's reason that contradicts the build rules (marks down `LOCATION_NAME`, unpaged calendar events, a missing feature the app doesn't need) | The rubric's wording | `functions/src/llm/rubric.md` |
| Finalist margin of 2 points or less | The pair is close to a coin toss | Grade those versions again before changing weights (`CRITERIA` in `functions/src/llm/variants.ts`) |
| Customers keep the second finalist often | The ranking doesn't match taste | Compare the kept versions' levels with the top-ranked ones |
| `absorbed` much higher than `charged` | Genesis's cost of the feature | Fewer versions, or cheaper reviews (`SECURITY_MODEL`, `GRADER_MODEL`) |

## 3. Report

Lead with the answer to the question asked (for example "the security gate hasn't removed anything in 6 builds";
"version 3 lost on accessibility and efficiency"). Quote levels, totals and findings as the script printed them, name
the build (app id and generation id) and say how many builds the numbers rest on. Builds marked `(old)` are not
comparable with the current scorecard: leave them out of any average. Never put scores, findings or the rubric in
anything a customer sees.

Changing the planner, `rubric.md`, `security.md` or the weights changes every variant build: update
`functions/src/llm/variants.test.ts` (it checks both documents name every criterion and check, and the evaluation doc's
worked example) and run a real variant build afterwards to compare.
