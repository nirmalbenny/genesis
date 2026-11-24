# Evaluating build variants: gates, scorecard and selection

Status: **implemented on `feature/build-variants` (2026-11-19).** The scoring is in
[`llm/variants.ts`](../../functions/src/llm/variants.ts), the two reviews in [`llm/grade.ts`](../../functions/src/llm/grade.ts)
with their instructions in [`llm/security.md`](../../functions/src/llm/security.md) and
[`llm/rubric.md`](../../functions/src/llm/rubric.md), and the job in [`variants.ts`](../../functions/src/variants.ts).
It replaces the earlier 10-criterion rubric and pattern-based findings. The flow around it is in
[build-variants.md](build-variants.md) and [build-variants-dry-run.md](build-variants-dry-run.md).

Validated (§11): the security reviewer caught all 16 planted defects for the right check with no false alarm on 3
safe controls; re-reviewing 6 finalists 3 times gave the same level in 47 of 48 criteria, the same finalist order in
9 of 9 runs and the same security verdict every time. The blind human comparison is still to be done.

## Contents

- [1. What this decides](#1-what-this-decides)
- [2. Principles](#2-principles)
- [3. The pipeline](#3-the-pipeline)
- [4. Gate 1: Builds](#4-gate-1-builds)
- [5. Gate 2: Secure](#5-gate-2-secure)
- [6. The quality score](#6-the-quality-score)
- [7. Choosing the two](#7-choosing-the-two)
- [8. Worked example](#8-worked-example)
- [9. Why this scorecard](#9-why-this-scorecard)
- [10. What it doesn't cover](#10-what-it-doesnt-cover)
- [11. Validation](#11-validation)
- [12. Cost](#12-cost)

## 1. What this decides

A variant build produces 4 versions of the customer's app. This scorecard decides which 2 the customer sees. It must:

- never offer a version that is broken or unsafe;
- among the rest, offer the 2 the customer is most likely to be happy with on their real data;
- leave matters of taste (layout, look) to the customer, who previews both and keeps one.

## 2. Principles

1. **Gates for what can't be traded off.** A broken or unsafe app is removed, never just ranked lower. No score can buy
   back a failed gate.
2. **Points where versions differ.** The score is spent on what separates good versions from weaker ones: doing what
   was asked, working on real data, failure handling, care with data, ease of use.
3. **Not applicable scores full.** An app without writes is never marked down for missing write confirmations; one
   without dates is never marked down for time zones.
4. **Fixed levels, not free numbers.** Every criterion is scored on 5 described levels, which keeps an AI judge far
   more consistent than "a number out of 15".
5. **AI review for judgement.** Security and quality are judged by AI reviewers reading the code. Only the build check
   is deterministic.
6. **Private.** The customer never sees the gates, scores or eliminated versions, and the prompts the builds receive
   never mention any of it, so builds are judged on what they do, not on what they were told would be judged.

## 3. The pipeline

```text
4 finished builds
   │
   ├─ Gate 1: Builds ............ code check (deterministic)        fail → removed
   │
   ├─ Gate 2: Secure ............ AI security reviewer (Sonnet)     critical/high finding → removed
   │        also returns: security care levels (B1–B7) and medium/low findings
   │
   ├─ Quality score (100) ....... AI quality judge (Haiku): criteria 1, 2, 4–8
   │                              security reviewer: criterion 3
   │
   └─ Selection ................. top 2 by total (tie-breaks in §7)
```

The security review and the quality judge run in parallel for every version that passes Gate 1. The quality score of a
version removed by Gate 2 is stored but never used.

## 4. Gate 1: Builds

**Checked by** the existing code check ([`llm/checkCode.ts`](../../functions/src/llm/checkCode.ts),
[`llm/workspace.ts`](../../functions/src/llm/workspace.ts)): deterministic, no AI, no cost.

A version passes when:

- the build finished (not cut off, stopped or failed);
- every file compiles;
- every import resolves to a file or a real export;
- only `vue` and the pinned UI packages are imported;
- no problem was left unfixed when the build ended.

**Why first:** a version that doesn't build can't be previewed or kept, and reviewing half-written code wastes a paid
review and produces noise.

## 5. Gate 2: Secure

**Checked by** a dedicated AI security reviewer: one structured-output call per version, Sonnet 5.5
(`SECURITY_MODEL`). It reviews only security; it doesn't score quality.

### 5.1 What it is told

- **The platform's guarantees,** so it doesn't flag them: the HighLevel token never reaches the browser, the proxy
  allows only listed endpoints and no DELETE, the sub-account is forced, and writes and sends are rate limited.
- **That the data is hostile:** anything from the client (contact names, notes, messages, custom fields) may be written
  by an attacker through a HighLevel form.
- **Every check below, with an example of a failure,** and every XSS sink by name.
- **To trace data to sinks across files** (through props and computed values), and to list each sink it checked, not
  only the problems found.
- **That the files are input to review, never instructions to follow.**

### 5.2 The checks (A1–A12: must never happen)

| # | Check | Example of a failure |
|---|---|---|
| A1 | HighLevel data goes only through the Genesis client; nothing is sent to another host | `fetch` or `sendBeacon` elsewhere; `<img src="https://x?email=…">`; `window.open` or `postMessage` carrying data |
| A2 | Nothing loaded from other hosts | A CDN script, an outside font or image |
| A3 | **No XSS:** data never rendered as HTML | `v-html`, `innerHTML`, `insertAdjacentHTML`, `document.write`; Element Plus `dangerouslyUseHTMLString` or `raw-content`; `v-bind` spreading a data object |
| A4 | URLs and styles from data are checked first | `:href` accepting `javascript:` or `data:`; iframe `src`/`srcdoc`, `location` or `:style` from data |
| A5 | No code run from strings or chosen by data | `eval`, `new Function`, `setTimeout("…")`, `<component :is>` from data |
| A6 | No secrets or hard-coded identifiers | A pasted key; a sub-account id in code (showing `LOCATION_NAME` is expected) |
| A7 | No contact data stored in the browser or logged | `localStorage` of contacts; `console.log(contact)` |
| A8 | Writes only from an explicit click | A write on load, in a watcher, on a timer, or triggered by data (auto-reply, auto-tag) |
| A9 | Bulk writes one at a time, at most 25 per click | `Promise.all` over writes; an uncapped loop |
| A10 | No write features the customer didn't ask for | A Send SMS button in an app asked only to show contacts |
| A11 | Messages show recipient and text before Send | One-click "Send follow-up" with hidden text |
| A12 | No attempt to delete data | Overwriting fields to imitate a delete |

### 5.3 Decision

- Each finding has a severity: **critical, high, medium or low**, with file, line and one sentence of evidence.
- **Any critical or high finding removes the version.**
- **Medium** findings don't remove it; each lowers criterion 3 by one level (§6.4). **Low** findings are stored only.
- A review that fails is retried once. **A version whose review can't complete counts as not passing**, so nothing is
  ever offered unreviewed.

## 6. The quality score

### 6.1 Criteria (100 points)

| # | Criterion | Points | Scored by | Full marks (level 4) means |
|---|---|---|---|---|
| 1 | **Does what was asked** | 20 | Quality judge | Every requested feature and kind of data is there and works |
| 2 | **Works on real data** | 15 | Quality judge | No logic bugs; names and dates through the client helpers (`contactName`, `toDate`); correct time zones; missing fields and long text handled |
| 3 | **Security and privacy care** | 15 | Security reviewer | B1–B7 (§6.4) |
| 4 | **Handles failure** | 15 | Quality judge | Every call's failure shown with its message and a retry; the error codes the app's own calls can return are handled |
| 5 | **Efficient with HighLevel** | 10 | Quality judge | Paged lists use `usePager` with Load more; search, filters and sort on the server; bounded event windows (calendar events are not paged); no call per row; no fetching everything |
| 6 | **Easy to use** | 10 | Quality judge | Main task first, clear headings; loading, empty and in-progress states; feedback after every action |
| 7 | **Accessible** | 10 | Quality judge | Labelled inputs; clickable items are buttons or links, or keyboard-reachable; icon-only buttons named; meaning not by colour alone |
| 8 | **Built to last** | 5 | Quality judge | Theme components and tokens; components of about 150 lines |

### 6.2 What is checked, criterion by criterion

Each criterion is a list of checks the judge answers yes, no or not applicable from the code. They are the same text
the quality judge is given ([`llm/rubric.md`](../../functions/src/llm/rubric.md)); its reason for each level names the
checks that failed, by number (for example "Fails 7.2: ContactTable.vue opens rows only by row-click"). **KEY** checks
matter most.

**1. Does what was asked (20)**

| # | Check |
|---|---|
| 1.1 KEY | Every feature the request names is present |
| 1.2 KEY | Every kind of data the request names is shown (contacts, conversations, messages, appointments, opportunities, calendars) |
| 1.3 | Each requested feature is reachable from the app's screens (not dead code, a placeholder or a TODO) |
| 1.4 | Each requested feature calls the client for real data or a real write (no mock or hard-coded results) |
| 1.5 | Requested search, filters and sort exist and act on the data they name |
| 1.6 | No large features the request didn't ask for that take over the main screen |

**2. Works on real data (15)**

| # | Check |
|---|---|
| 2.1 KEY | Fields are read with the client's response shapes (nothing undefined or always empty, nothing shown as `[object Object]`) |
| 2.2 | People's names go through `contactName` (or the raw first and last name), not lower-cased list fields |
| 2.3 | Dates go through `toDate` before formatting or comparing; contact appointment times (no offset) are handled |
| 2.4 | Missing or empty fields show a fallback and never throw |
| 2.5 | Long text (names, previews, notes, messages) is truncated or wrapped |
| 2.6 | Sorting, filtering and grouping are correct (dates as dates, numbers as numbers; stable keys in lists) |
| 2.7 | Counts and totals come from the client's `total`, or say what they cover; never the loaded page passed off as the whole |

**4. Handles failure (15)**

| # | Check |
|---|---|
| 4.1 KEY | Every client call is awaited inside try/catch, or its pager's `error` is used |
| 4.2 KEY | Each failure shows its `error.message` next to the part of the app that failed |
| 4.3 | Each failed load offers a retry |
| 4.4 | A failed write keeps what the user entered, re-enables the control and shows the error |
| 4.5 | The error codes this app's own calls can return are handled where they matter (`hl_duplicate_contact` when creating contacts; a wait message for rate limits; `hl_scope_missing` explained). Codes it can't hit don't count |
| 4.6 | No promise is left unhandled |

**5. Efficient with HighLevel (10)**

| # | Check |
|---|---|
| 5.1 KEY | Lists the client pages use `usePager`, with Load more shown while `hasMore` |
| 5.2 KEY | No client call per row of a list (for example one `getContact` per card) |
| 5.3 | Search, filters and sort go to the server through the pager's options where the client supports them |
| 5.4 | Calendar events and free slots are fetched for a bounded window (free slots at most 31 days) |
| 5.5 | Nothing fetches every page automatically, polls, or refetches on a timer |
| 5.6 | The same data isn't fetched twice for one view; calls made outside `usePager` on every keystroke are debounced (`usePager` debounces itself) |

**6. Easy to use (10)**

| # | Check |
|---|---|
| 6.1 | A heading names what the app is for, and its main task is the first thing on the screen |
| 6.2 | Every area that loads data shows a loading state |
| 6.3 | Every list or panel that can be empty says so, helpfully |
| 6.4 | Every write control shows progress while it runs and a success message after |
| 6.5 | Where the client gives a total, the list says how much is shown ("Showing 20 of 54") |
| 6.6 | The layout works at phone width (no fixed widths wider than a phone; columns stack or hide) |

**7. Accessible (10)**

| # | Check |
|---|---|
| 7.1 KEY | Every input, select and textarea has a label or `aria-label` (a placeholder alone doesn't count) |
| 7.2 KEY | Everything clickable is a button or link, or has a role, a tabindex and Enter handling; a row or card opened only by a click handler fails |
| 7.3 | Icon-only buttons have an `aria-label` |
| 7.4 | Status isn't shown by colour alone (tags and badges carry text) |
| 7.5 | Dialogs and drawers have a title; headings go in order |

**8. Built to last (5)**

| # | Check |
|---|---|
| 8.1 | Element Plus components where one exists (no hand-built table, select, dialog, drawer or date input) |
| 8.2 | No colours of its own outside `src/style.css`; the theme's tokens and layout classes are used |
| 8.3 | No `el-pagination` for HighLevel lists |
| 8.4 | Every component is under about 200 lines, and `App.vue` lays out components rather than doing everything |
| 8.5 | Shared logic (formatting, date maths) lives in one place, not copied between components |

### 6.3 From checks to levels and points

| Level | When |
|---|---|
| 4 | Every applicable check passes |
| 3 | Exactly one check fails, and it isn't a KEY check |
| 2 | A KEY check fails, or two or three checks fail |
| 1 | More than three checks fail, or most of the applicable ones |
| 0 | The criterion's purpose isn't met at all (criterion 1: the app does something else; criterion 4: no failure is handled) |

A check that doesn't apply to the app (no writes, no dates, no lists) is not applicable and never counts against it.
**The judge only reports which checks failed; the level is computed from them in code** (`levelFromChecks` in
[`llm/variants.ts`](../../functions/src/llm/variants.ts)), so the same failures always give the same level. A run before
this change gave level 4 with a failed check named in its own reason.
`points = criterion weight × level ÷ 4`, rounded to the nearest point; the total is the sum of the 8 criteria.

### 6.4 Criterion 3: security and privacy care

The security reviewer checks each item ([`llm/security.md`](../../functions/src/llm/security.md)):

| # | Item | Checked |
|---|---|---|
| B1 | Data minimisation | Lists show no phone numbers or emails in full unless the task is about them; full values only in the detail view |
| B2 | Confirmation | Every send, bulk change and appointment change asks for confirmation naming what will change (recipient and text, the records, the new time) |
| B3 | Input checks | Before a write: required fields, email and phone formats and lengths checked in the form, errors next to the field |
| B4 | Least capability | No write controls in a read-only request; edit forms contain only the fields the request names |
| B5 | Nothing personal in URLs or errors | No names, emails or phones in query strings, router paths or the app's own error messages |
| B6 | Safe outside links | Links built from data allow only `http`/`https`, open with `target="_blank"` and `rel="noopener noreferrer"`; `mailto:`/`tel:` from checked values |
| B7 | Defensive display | Very long values truncated or wrapped; no value from data shown where it could pass for a button, link or system message |

Each item's level: **4** met everywhere it applies · **3** met except in one place · **2** met in some places, missing
in others · **1** missing almost everywhere · **0** missing everywhere; **4** when it doesn't apply.
`criterion 3 level = floor(average of B1–B7) − 1 per medium finding`, never below 0.

## 7. Choosing the two

1. Remove every version that fails Gate 1 or Gate 2.
2. Rank the rest by total.
3. **Ties** go to *Security and privacy care*, then *Works on real data*, then *Does what was asked*, then build order
   (so the result never depends on which build finished first).
4. Offer the **top 2**. With 1 left, offer it alone ("Here's your app"). With none left after Gate 1, the most complete
   build opens in the editor with Fix with AI. A version removed by Gate 2 is never applied.

Stored for Genesis only (`variantScores/{generationId}`): every finding with evidence, every level with its reason,
totals and the finalists. The customer sees only the finalists' titles and summaries.

## 8. Worked example

Three versions passed Gate 1; one was removed by Gate 2 (a contact note rendered with `v-html`: A3, critical).

| Criterion | Weight | Agenda (level → points) | Search first | Contact cards |
|---|---|---|---|---|
| 1 Does what was asked | 20 | 4 → 20 | 4 → 20 | 3 → 15 |
| 2 Works on real data | 15 | 3 → 11 | 4 → 15 | 3 → 11 |
| 3 Security and privacy care | 15 | 4 → 15 | 3 → 11 | 3 → 11 |
| 4 Handles failure | 15 | 3 → 11 | 3 → 11 | 3 → 11 |
| 5 Efficient with HighLevel | 10 | 4 → 10 | 4 → 10 | 2 → 5 |
| 6 Easy to use | 10 | 3 → 8 | 4 → 10 | 3 → 8 |
| 7 Accessible | 10 | 2 → 5 | 3 → 8 | 2 → 5 |
| 8 Built to last | 5 | 4 → 5 | 4 → 5 | 4 → 5 |
| **Total** | 100 | **85** | **90** | **71** |

Offered: **Search first** and **Agenda**. Contact cards loses mainly on efficiency: one appointments call per card.

## 9. Why this scorecard

| Decision | Reason | Evidence from the first 16 graded versions |
|---|---|---|
| Security as a gate, not points | A polished app must never win while it leaks data or allows XSS | As points, security never separated anything: full marks on all 16, while a real flaw would have cost only 10–15 of 100 |
| Security reviewed separately, on Sonnet | Indirect flows (data reaching a sink two files away) need focus and the stronger model; the quality judge stays cheap | — |
| "Not applicable scores full" | Absence of a feature isn't a defect | The earlier rubric marked down apps without writes or dates; that alone moved totals by 2–5 points |
| Explicit exceptions (`LOCATION_NAME`, calendar windows, relevant error codes) | The rubric must not contradict what the build prompt tells the model to do | Versions lost points for showing `LOCATION_NAME` and for not paging calendar events, both correct |
| *Does what was asked* added, 20 points | The planner rewrites the request 4 ways; a version can drift | Not measured before |
| *Works on real data* raised to 15 | Logic bugs are what customers hit first | One version showed `[object Object]` as a contact name |
| Levels instead of free numbers | Consistency between grades | Finalists were decided by 0–3 points under free scoring |
| Accessibility scored, not gated | It comes in degrees; every version falls short somewhere | 3–6/10 across all 16; as a gate it would have removed every version |

## 10. What it doesn't cover

- **Rendering at run time.** A crash on load or a blank page isn't caught before the customer previews the version
  (that would need a headless browser on the server, not part of this design). The preview shows the error and offers
  Fix with AI.
- **Guaranteed XSS detection.** AI review catches direct sinks reliably and indirect flows most of the time, not always.
  Refusing `v-html`, `innerHTML` and `dangerouslyUseHTMLString` in the code check would make the obvious cases certain;
  that is a separate, optional build rule.
- **Taste.** Which layout the customer prefers is left to the customer.

## 11. Validation

| Check | How | Result (2026-11-19) |
|---|---|---|
| **Planted security defects** | `node scripts/eval-security.mjs`: one small app per check (A1–A12) and per XSS sink (`v-html`, `dangerouslyUseHTMLString`, `v-bind` spread, a two-file prop chain), plus safe controls (cases in `scripts/lib/security-cases.mjs`) | **16 of 16 caught for the right check; 0 false alarms on 3 controls** |
| **Consistency** | `node scripts/eval-consistency.mjs --runs 3`: each stored finalist re-reviewed 3 times with the current rubric and brief | 6 finalists: **47 of 48 criterion levels identical** across runs (one *Built to last* moved 4↔3); **finalist order held in 9 of 9 runs**; **security verdict never changed** |
| **Human agreement** | A reviewer scores 20 versions blind; totals within 10 points, and the reviewer's favourite of the 4 is a finalist at least 80% of the time | **Not done yet: needs a person** |
| **Rubric fairness** | `/variant-report --stats`: a check every version fails is a build-prompt gap or an unfair check | Fixed two unfair checks (`LOCATION_NAME`; `usePager` already debounces). Gaps fixed in the build prompt and UI guide: labelled search inputs, a View button instead of row-click, rate-limit messages, no call per row |

Only finalists can be re-reviewed: their files are kept as snapshots, the other versions' files are not.

## 12. Cost

The customer pays only for the version they keep ([build-variants.md](build-variants.md)). Genesis absorbs the
planner, the other three builds and every review. Measured on three real variant builds:

| | Credits per variant build |
|---|---|
| Charged to the customer (the kept version) | 60–109 |
| Absorbed by Genesis | 327–467 (about $0.33–0.47) |
| Of which the reviews: security (Sonnet), quality (Haiku) | ~25–35, ~3–5 |

The other three builds are most of the absorbed cost, not the reviews.
