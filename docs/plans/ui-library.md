# Plan: an open-source component library for generated apps

Status: **implemented locally, all phases at once (2026-11-18), not committed.** The user chose Element Plus without
the comparison trial; the results are in §9. Replaces the hand-made kit for **new** apps; the kit stays for the apps
that use it.
Follows [ui-kit-and-components.md](ui-kit-and-components.md) (done), which built that kit.

## 1. Goal

Generated apps should be **good and usable by customers**: complete, polished widgets (sortable tables, date
pickers, searchable selects, toasts, confirmations, forms with validation), consistent spacing and states, and
layouts that work on a phone. Looking like Genesis is **not** a goal.

Today every widget comes from a hand-made kit (`frontend/src/sandbox/genesis/ui.css` and 71 components on
`reka-ui`). It is small, fast and checked, but each widget is ours to design, build and maintain. The widgets that
matter most for usability (date picker, combobox, data table, toast, charts) don't exist, and Claude builds them by
hand, unevenly. A maintained library has them already.

## 2. Which library

Requirements: **MIT or similar** (Genesis lets customers build apps, so a library that requires an OEM license is
excluded); actively released; works from npm in Sandpack's in-browser bundler with **no build step of its own** (no
Tailwind, no Vite plugin); complete for business apps; well known to Claude; restyled through CSS variables or a
theme object.

| Library | License | Last release | Verdict |
|---|---|---|---|
| PrimeVue 5 | PrimeUI license: a key is required; free only under $1M revenue / 10 employees; letting third parties develop with it needs an OEM license | 2026-11-11 | **Excluded** (license) |
| PrimeVue 4 | MIT | 2026-04-08 (`v4-stable`; fixes now go to 5) | Excluded: frozen |
| **Element Plus** 2.14 | MIT | 2026-11-06 | **Candidate**: the standard for business apps; rich Table, DatePicker, Select with search, Form validation, Message, MessageBox; one CSS import; themed by `--el-*` variables; very well known to Claude |
| **Naive UI** 2.45 | MIT | 2026-08-27 | **Candidate**: modern look; rich DataTable, DatePicker, Select, Form, Message and Dialog; CSS-in-JS (no CSS import); themed by a JS object; providers must wrap the app |
| Vuetify 4 | MIT | 2026-11-18 | Not first choice: Material look, heaviest, needs Vue 3.5 and an icon font |
| shadcn-vue | MIT | 2026-10-28 | Not a package: source files styled by Tailwind, which would have to run in the browser |
| Ant Design Vue 4 | MIT | 2024-11-11 | Excluded: not maintained |

Phase 0 decides between **Element Plus** and **Naive UI** with measurements (§6). Facts above were read from npm on
2026-11-18; the license text from the published package.

## 3. Design

### 3.1 How the library reaches the preview

Packages are installed, not injected: `PreviewPanel` writes the preview's `package.json`, and Sandpack's bundler
downloads what it lists from CodeSandbox's npm CDN (as it does today for `vue` and `reka-ui`).

- **Pinned versions.** `UI_LIBRARY` in `PreviewPanel.vue` lists the exact versions (no `^`), added only when the app
  uses them (its files import `./genesis/setup.js` or the library). Upgrades are deliberate: bump, run the eval,
  compare, screenshot.
- **The same for launched apps** (`/run/:id`) and "Open in CodeSandbox", which use the same `package.json`.

### 3.2 One setup file Genesis owns

A system file, `src/genesis/setup.js` (next to `hl.js`, never written by Claude), mounts the app with the library
configured: plugin or providers, theme, locale, and the message and dialog services. The starter `main.js` becomes:

```js
import { mountApp } from "./genesis/setup.js";
import App from "./App.vue";

mountApp(App);
```

`mountApp` hides the library's own setup (Element Plus: `app.use(ElementPlus)` and its CSS; Naive UI: the
`NConfigProvider` / `NMessageProvider` / `NDialogProvider` wrappers), so Claude can't get it wrong, the theme can
change for every app at once, and switching libraries later touches one file. A restyle the user asks for overrides
the library's variables in `src/style.css`, as today.

### 3.3 What Claude is told

- **The prompt's styling section** is rewritten: build with the library; feedback with its message service; a
  confirmation only where the rules ask for one; no CSS that restyles it unless the user asks.
- **A short guide** (`functions/src/llm/ui/<library>.md`, about 20 lines) replaces most of `uiKit.md`: the import
  form, the components to use for each job (lists, forms, dates, feedback, empty states), and the traps found in
  phase 0. Claude knows the library, so the guide covers only our rules, not its API.
- **Paging stays ours.** HighLevel lists page forward with cursors, so a table's numbered pagination can't be used:
  the table shows `pager.items` and a **Load more** button under it (`usePager`, unchanged).
- **Chosen per app, like the HighLevel guides.** The guide goes in the second cached system block
  (`llm/guides.ts`): the library's guide for new apps and apps already on it, `uiKit.md` for apps that import
  `./genesis/ui`. The first block (the frozen tools and rules) stays identical for every user.

### 3.4 Code checks

- **Allowed packages:** `vue`, the library, its icon package, and (phase 3) `chart.js` + `vue-chartjs`. Anything
  else is refused, as today.
- **Names that exist:** a generated `functions/src/llm/packages.json` lists each allowed package's exported names
  (components, icons), written from the pinned versions by a script and kept in sync by a test. A named import that
  doesn't exist (`ElKanban`) is refused with the reason; wrong **props** can't be checked and surface in the preview
  (Fix with AI).
- **The entry check** (today: `main.js` imports `ui.css`) accepts either `mountApp` from `./genesis/setup.js` (new
  apps) or the kit import (existing apps).

### 3.5 Existing apps and the kit

- The kit (`ui.css`, `src/genesis/ui/`) **stays injected** for every app that uses it: apps never break. It is
  frozen: no additions after this plan.
- A follow-up on a kit app stays on the kit (one app, one library). Moving it is the user's choice ("modernize this
  app") and a normal build.
- The six ready-made apps move to the library in phase 4 (`/new-template`); users get them through the
  content-hashed bootstrap upgrade.
- The kit additions of 2026-11-18 (`Icon`, `IconTile`, `Tag`, `SectionHeader`, `SearchInput`, icons, the page
  recipe) were never committed: drop them if phase 0 picks a library (the kit is add-only once shipped, so shipping
  them would only grow what we keep forever).

## 4. What changes, by file

| Area | Files |
|---|---|
| Preview packages and setup | `frontend/src/components/PreviewPanel.vue`; new `frontend/src/sandbox/genesis/setup.js` |
| Starter and entry check | `functions/src/files/index.ts` (`SEED_FILES`), `functions/src/llm/checkCode.ts`, `functions/src/llm/workspace.ts` |
| Allowed packages and names | new `functions/src/llm/packages.json`, its script and test; `checkCode.ts` (`PACKAGES`) |
| Claude's guide | `functions/src/llm/prompt.ts` (styling section), new `functions/src/llm/ui/<library>.md`, `functions/src/llm/guides.ts` (selection) |
| Templates | `functions/templates/*` (phase 4) |
| Tests | `frontend/src/sandbox/genesis/*.test.ts` (setup renders, kit tests kept for the frozen kit), `functions/src/llm/*.test.ts` |
| Eval | `scripts/eval-builds.mjs`: usability checks next to compile checks |
| Docs | README, ARCHITECTURE §6 and §10, CLAUDE.md (stack, "apps may import only vue", the dependency rule) |

## 5. Phases

0. **Trial** (local, nothing committed). Element Plus and Naive UI behind a temporary switch, against today's kit, on
   four eval cases (`contacts`, `dashboard`, `pipeline`, `newContact`), twice each: about 24 builds, roughly $2 of
   Claude usage. Measure (§6), screenshot desktop and phone, and decide with the user.
1. **Platform:** pinned packages in the preview, `setup.js` with `mountApp`, the new starter, the entry check,
   `packages.json` with its script and test, unit tests. Preview cold and warm start times recorded.
2. **Claude's guide:** the styling section, the library guide, per-app selection in the second cache block, eval
   cases updated (usability checks), the measured baseline in ARCHITECTURE.
3. **Charts and icons** (if phase 0 shows apps need them): `vue-chartjs` + `chart.js` (MIT), the library's icon
   package (or `@lucide/vue`), both in `packages.json`.
4. **Ready-made apps** rebuilt on the library, screenshots, docs counts.
5. **Rollout:** deploy; existing apps unchanged; watch `build.problem`, preview errors and Fix with AI use for a
   week; then remove the kit from the prompt for new apps (it stays injected).

Each phase: `/verify`, the eval compared with the last baseline (`node scripts/eval-compare.mjs`), screenshots with
`node scripts/shoot.mjs`.

## 6. How phase 0 decides

| Measure | How | Bar |
|---|---|---|
| Builds | eval: passes, files that don't compile, preview errors on first run | no worse than the kit |
| Cost | median output tokens and credits per case (`eval-compare.mjs`) | within 15% of the kit |
| Start time | preview cold start (empty browser cache) and warm start, launched app | cold under 8 s, warm under 3 s |
| Usability | per screenshot: every control works; loading, empty and error states; readable on a phone; search, sort and paging; feedback after an action | clearly better than the kit |
| Mistakes | props or components that don't exist, found in the preview | rare, and fixed by Fix with AI |

## 7. Risks

- **Start time.** A library is much larger than the kit; importing from its root may pull every component into the
  bundle. Measured in phase 0; mitigations: per-component import paths in the guide, or prebundling.
- **Sandpack compatibility.** The `vue-cli` template's bundler must handle the library's ESM and CSS. Phase 0
  proves it before anything is built on it.
- **Claude's knowledge vs the pinned version.** Mostly stable APIs (Element Plus 2.x since 2022), but the guide
  records any trap the trial finds; `packages.json` catches names that don't exist.
- **Accessibility** is weaker than `reka-ui` in some components; check keyboard use of the main widgets in phase 0.
- **Supply chain.** Packages come from a CDN at run time (already true of `vue`); only the allow-listed packages,
  at pinned versions.
- **License changes.** PrimeVue moved to a commercial license in its next major; pinning protects existing apps,
  and the license is checked again before each major upgrade.

## 8. Decisions needed

1. Run phase 0 (about $2 of Claude usage, local only)? Recommended: yes.
2. The library, after phase 0. Front-runner: Element Plus (completeness and Claude's familiarity); Naive UI if it is
   clearly better looking at similar cost.
3. Drop the uncommitted kit additions of 2026-11-18 if a library is chosen. Recommended: yes.
4. CLAUDE.md rules that change: "apps may import only `vue`" and "ask before adding any dependency" (to: the
   allow-listed preview packages, pinned, changed only through this plan's process).

## 9. Results (2026-11-18, local)

All phases in one change, Element Plus without the comparison trial (user decision). Nothing committed.

| Check | Result |
|---|---|
| Element Plus in Sandpack | works: table, date picker, select, tags, statistic, icons and a Chart.js chart on live data, no console errors |
| Start time (launched app) | cold 4.7 s, warm 3.6 s; an app on the kit 5.7 s and 4.8 s |
| Full eval, 14 cases | all pass (the inbox case broke off once with a dropped connection and passed on rerun) |
| Cost against the kit (`registry-phase4-final`) | output tokens about +9% on average (new apps +12% to +33%), credits about +20%, partly the cache rewrite after the prompt changed: over the plan's 15% bar |
| Generated apps (contacts, dashboard, deals, new contact) | clean tables, validated forms, drawers, stage columns; real data at desktop and phone width |
| Ready-made apps | all six converted by real Genesis builds (48 to 84 s each, 98 to 192 credits), pass the build's code check, run with no console errors; names are now capitalized (the client's `contactName`) |
| Upgrade | an existing account's ready-made apps were replaced on its next visit (content hash) |
| Apps on the kit | a follow-up ("add a button that clears the search box") stayed on the kit |
| Launched-app top bar | fits a phone (labels hide below `sm`) |

Left for later: lowering the token cost (shorter guide, or examples of compact markup), the cosmetic icon spacing in
Activity Timeline, and the deploy (`docs-check`, `/verify`, then main).

## 10. The design standard (2026-11-19, local)

The user's design standard (palette, 8px spacing, type, component states, layouts, responsiveness, no emoji, a token
system, user preferences first), split by who can guarantee it:

- **The platform** (`frontend/src/sandbox/genesis/theme.css`, loaded by `setup.js`, never sent to Claude): the
  tokens, Element Plus derived from them, refined components with every state, layout classes, a dark variant.
  Existing Element Plus apps got it with no rebuild.
- **Claude** (about 15 lines in `ui/element-plus.md`): the layout by purpose (a page header; a sidebar only for three
  or more views), data first with KPIs only when they matter, every state, form rules, a confirmation before sends and
  bulk writes, icons not emoji, phone layouts, colors and spacing only through the tokens, the user's look as token
  overrides.
- **The code check** (`checkDesign`, Element Plus apps only): colors in styles outside `src/style.css` and emoji come
  back as problems. It caught three in the ready-made apps (two hard-coded `#fff`, a 👋), fixed with a new
  `--app-on-primary` token.

Kept from Genesis's constraints: no numbered pages for HighLevel lists (Load more); no sidebar for one-view tools.

Measured: full eval 14 of 14 pass; against the Element Plus run without the standard, credits about -2% and most
cases fewer output tokens (the guide replaced per-app styling). Against the kit, output tokens still about +13% and
credits +18%. Screenshots: one palette across apps, neutral tags with color only for states (after one guide fix),
phone tables reduced to one column with secondary lines.

Contrast (WCAG AA, checked by `theme.test.ts`): the spec's primary `#FF7A59` has 2.6:1 with white text and its muted
text `#7C98B6` about 3:1 on white. Text in or on the brand color and filled buttons use `--app-primary-strong`
(`#d62b00`, the same hue: 5:1 with white, 4.5:1 on the light tint); the coral stays for tints, borders, focus rings
and charts; in dark mode the coral itself reaches 6.4:1 and buttons get dark text. Quiet content (`.muted`, empty
states) uses the secondary text color (5.3:1); the muted color is kept for placeholders and disabled text.
