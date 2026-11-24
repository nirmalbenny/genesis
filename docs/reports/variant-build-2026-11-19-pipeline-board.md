# Variant Build Report: Pipeline Board

Nov 19, 2026 · Nirmal Benny

## Summary

All four versions of the Pipeline board passed both gates with zero security findings; version #3 scored 100/100 and was the one the customer kept.

- **Build:** app `JwZkvto0m4NMA8EC7JGD`, generation `EPKoLwAypAIYLSbLqflo`, run on 2026-11-19 at 15:50 on the local stack against the HighLevel sandbox.
- **Ranking:** #3 Search and move 100, #1 Kanban columns 96, #2 Totals dashboard 90, #4 Stage by stage 87. The top two were offered; the margin between 2nd and 3rd was 6 points.
- **Cost:** the customer was charged 112 credits (the kept version at the Sonnet rate); Genesis absorbed 763 across 13 model calls.
- **Main caveats:** one build is not a trend, and two rubric checks (5.5 and 4.5) mark down behaviour the build rules allow or that cannot happen today. Both are listed under Observations.

## How versions are evaluated

Each version must pass two gates, then earns up to 100 points on 8 criteria; the two highest totals are offered to the customer.

1. **Planner.** Sonnet turns the request into 4 prompts with the same features and a different layout and look. Its instructions never mention scoring, and any prompt that does is dropped.
2. **Gate 1, code check.** The same compile, import and design check every Genesis build runs. A version that fails is removed.
3. **Gate 2, AI security review.** A reviewer model checks 12 attack classes (A1–A12) against every place the app renders or sends data. Any critical or high finding removes the version. It also rates 7 care items (B1–B7) on 0–4.
4. **Quality.** A judge model reports which listed checks each criterion fails. The level (0–4) is computed in code from those failures, so the judge never picks a number.
5. **Selection.** Points = weight × level / 4. Ties break on security care, then real data, then fit to the request.

| # | Criterion | Weight |
| --- | --- | --- |
| 1 | Does what was asked | 20 |
| 2 | Works on real data | 15 |
| 3 | Security and privacy care | 15 |
| 4 | Handles failure | 15 |
| 5 | Efficient with HighLevel | 10 |
| 6 | Easy to use | 10 |
| 7 | Accessible | 10 |
| 8 | Built to last | 5 |

Level rule: 4 = no failed check; 3 = one non-key check; 2 = a key check, or 2–3 checks; 1 = more than 3; 0 = the criterion's purpose is not met. Criterion 3 comes from the security reviewer's care items (average, floored, minus medium findings).

The customer only sees the two finalists, their titles, summaries and styles. Scores, findings and the rubric are never shown to them.

## The build

One request, four models and efforts, four distinct looks; the build finished with status done.

**Request (as typed):** "Build a pipeline board of my open opportunities grouped by stage, with each deal's value and contact name, a total value for each stage, and a button to move a deal to another stage. moving the same should reflect live no on a refresh"

**Context sent:** HighLevel guides for contacts and opportunities; Element Plus UI guide. Reviewers: security Sonnet 5.5, quality Haiku 5.5. Content hashes (first 12 hex of SHA-256) tie every score to the exact texts used:

| Text | Hash |
| --- | --- |
| Build prompt | `1806464a90d2` |
| UI guide | `3de2ab062d12` |
| Build tools | `4c90509173f0` |
| Planner | `54c7ca9b549b` |
| Quality rubric | `11d64165bedf` |
| Security brief | `e6208e3170ad` |
| Contacts guide | `903dd11d8909` |
| Opportunities guide | `be984f0b507a` |

**Versions:**

| # | Title | Model, effort | Style | Files | Output tokens |
| --- | --- | --- | --- | --- | --- |
| 1 | Kanban columns | Sonnet 5.5, medium | Light, blue accent | 6 | 4,540 |
| 2 | Totals dashboard | Sonnet 5.5, high | Dark, teal accent | 7 | 8,777 |
| 3 | Search and move | Opus 5.5, medium | Light, compact, orange | 6 | 8,799 |
| 4 | Stage by stage | Opus 5.5, high | Light, spacious, purple | 8 | 14,061 |

**Cost:** a hold of 331 credits was placed before the build and released; the customer was charged 112 for the kept version. Genesis absorbed 763 credits (1 credit = $0.001 of Claude list price) over 13 model calls: planner, 4 builds, 4 security reviews, 4 quality reviews.

## Results by version

No version was removed; totals spread from 87 to 100, and the two finalists were #3 and #1.

| Rank | # | Title | Gate 1: code | Gate 2: security | Total /100 | Outcome |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 3 | Search and move | Pass | Pass, 0 findings | 100 | Offered, kept |
| 2 | 1 | Kanban columns | Pass | Pass, 0 findings | 96 | Offered |
| 3 | 2 | Totals dashboard | Pass | Pass, 0 findings | 90 | Not offered |
| 4 | 4 | Stage by stage | Pass | Pass, 0 findings | 87 | Not offered |

The customer kept the top-ranked version, so ranking and choice agreed on this build.

## Quality scorecards

Every version met the request, worked on real data paths and was easy to use and accessible; points were lost only on security care, failure handling and HighLevel efficiency.

Points per criterion (level 0–4 in brackets), versions in rank order. A level 3 is worth 11.25 or 7.5 points; cells are rounded down, totals are computed from the exact values:

| Criterion (weight) | #3 Search and move | #1 Kanban columns | #2 Totals dashboard | #4 Stage by stage |
| --- | --- | --- | --- | --- |
| 1 Does what was asked (20) | 20 (4) | 20 (4) | 20 (4) | 20 (4) |
| 2 Works on real data (15) | 15 (4) | 15 (4) | 11 (3) | 15 (4) |
| 3 Security and privacy care (15) | 15 (4) | 11 (3) | 11 (3) | 11 (3) |
| 4 Handles failure (15) | 15 (4) | 15 (4) | 15 (4) | 11 (3) |
| 5 Efficient with HighLevel (10) | 10 (4) | 10 (4) | 7 (3) | 5 (2) |
| 6 Easy to use (10) | 10 (4) | 10 (4) | 10 (4) | 10 (4) |
| 7 Accessible (10) | 10 (4) | 10 (4) | 10 (4) | 10 (4) |
| 8 Built to last (5) | 5 (4) | 5 (4) | 5 (4) | 5 (4) |
| **Total** | **100** | **96** | **90** | **87** |

Failed checks behind each lost point:

| Version | Criterion | Failed check | What the judge saw |
| --- | --- | --- | --- |
| #1 | 3 | Care item B7 at level 3 | From the security reviewer's care rating, not a finding |
| #2 | 2 | 2.7 | Stage totals are computed from the deals loaded so far and not labelled as partial |
| #2 | 3 | Care items B2 and B7 at level 3 | From the security reviewer's care rating |
| #2 | 5 | 5.5 | Calls Load more automatically, up to 4 pages |
| #4 | 3 | Care item B7 at level 3 | From the security reviewer's care rating |
| #4 | 4 | 4.5 | No specific message for `hl_scope_missing` |
| #4 | 5 | 5.5, 5.6 | Auto Load more up to 4 pages; fetches the same deals twice |

The reviewer does not store a reason for care items yet, so the B7 and B2 rows carry no explanation (see Observations).

## Security review

The reviewer (Sonnet 5.5) reported no finding of any severity in any version, across 73 sinks checked in total; care ratings were 4 except B7 in three versions and B2 in one.

**Attack classes (A1–A12).** A finding of critical or high severity on any of these removes the version. No version had a finding, so all 12 passed for all 4 versions.

| Check | What it rules out |
| --- | --- |
| A1 | HighLevel data sent anywhere except through the Genesis client |
| A2 | Scripts, fonts, styles, images or iframes loaded from other hosts |
| A3 | Data rendered as HTML (v-html, innerHTML and similar) |
| A4 | Unchecked URLs or styles built from data |
| A5 | Code run from strings or chosen by data |
| A6 | Secrets, or a sub-account id or name, written into the code |
| A7 | Contact data stored in the browser or written to the console |
| A8 | Writes not caused by an explicit click or submit |
| A9 | Parallel writes, or more than 25 per click |
| A10 | Write features the customer did not ask for |
| A11 | A message sent without its recipient and content shown beside Send |
| A12 | Deleting data, or imitating a delete by overwriting |

**Care items (B1–B7), level 0–4.** These feed criterion 3 and never remove a version.

| Care item | #3 | #1 | #2 | #4 |
| --- | --- | --- | --- | --- |
| B1 Shows only the data the task needs | 4 | 4 | 4 | 4 |
| B2 Confirms sends and bulk or appointment changes | 4 | 4 | 3 | 4 |
| B3 Validates input before a write | 4 | 4 | 4 | 4 |
| B4 Only the actions the request needs | 4 | 4 | 4 | 4 |
| B5 No personal data in URLs or error messages | 4 | 4 | 4 | 4 |
| B6 Outside links limited to http(s), opened safely | 4 | 4 | 4 | 4 |
| B7 Long values truncated; data cannot pass for a control | 4 | 3 | 3 | 3 |

**Sinks checked** (each place the app renders or sends data, listed by the reviewer): #3 19, #1 15, #2 18, #4 21.

The reviewer itself was validated separately: it caught 16 of 16 planted defects and raised 0 false alarms on 3 safe controls.

## Observations

### Validation done so far

| Test | Result |
| --- | --- |
| Security reviewer on planted defects | 16 of 16 caught |
| Security reviewer on safe controls | 0 of 3 false alarms |
| Quality levels on re-review of stored finalists | 47 of 48 identical |
| Finalist order on re-review | 9 of 9 identical |
