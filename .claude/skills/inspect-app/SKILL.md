---
name: inspect-app
description: Find out why a generated app came out wrong on the local stack (unstyled, broken, wrong data, a build that failed or did too little) — its files, the code check's verdict, each build's prompt, outcome, tokens and reply, and screenshots of it running. Use when the user says an app they built locally looks or behaves wrong, or before changing the prompt or the code checks because of one.
---

# Inspect a generated app

Local only (emulators and `cd frontend && npm run dev` running; `cd functions && npm run build` first). Read and
look before changing anything: most "the app is wrong" reports come from one build, and the build record says which.

## 1. What it's made of and how its builds went

```bash
node scripts/inspect-app.mjs <app id | name | latest> [--email <owner>] [--builds <n>] [--file <path>]… [--all-files]
```

- **Code check:** what the next build would be told about the current files (compile errors, unresolved imports,
  unknown components, client names or package exports, a `src/main.js` that doesn't set up the UI). Problems here
  are real bugs.
- **Builds** (newest first): prompt, status, files written, input (uncached, cache read, cache write) and output
  tokens, credits, error, and the reply shown in the chat. A file the user expected but missing from `wrote:` means
  the model left it alone (as with the unstyled app: `src/main.js` was never written).
- `--file src/main.js` (or `--all-files`) prints the code.

## 2. What it looks like

```bash
node scripts/shoot.mjs --email <owner> --app <id | name | latest>          # workspace, once the preview has run
node scripts/shoot.mjs --email <owner> --app <…> --run --full              # the launched app, whole page
node scripts/shoot.mjs /apps --email <owner> --size phone                  # any route
```

Desktop and phone screenshots go to `.shots/` (git-ignored); read them. The page's console errors are printed.
To interact first (also inside the preview's frame), add steps:
`--do "click:Ready-made; clickat:290,249; type:Neha; key:Enter; wait:2000; waitfor:Fix with AI; shot:name"`.

## 3. Find the cause, then fix it at its source

| Seen | Usually | Fix in |
|---|---|---|
| Unstyled app | `src/main.js` isn't `mountApp(App)` (Element Plus) or, in an older app, lacks the kit import | starter files (`functions/src/files/index.ts`), the entry check in `checkCode.ts` |
| A component, icon or helper that doesn't exist | the guide doesn't steer Claude to the right one | `functions/src/llm/ui/element-plus.md` (`uiKit.md` for kit apps), `hlReference.md`, `hl-resources/<id>.md`; package names come from `functions/src/llm/packages.json` |
| Element Plus misused (wrong prop, numbered pages on a HighLevel list) | the guide | `functions/src/llm/ui/element-plus.md` |
| Wrong HighLevel fields or paging | the resource's guide | `hl-resources/<id>.md` (verify with `npm run hl:probe`) |
| A request misunderstood, declined, or done partly | the system prompt | `functions/src/llm/prompt.ts` |
| A build that failed or stopped | `error:` on the build; the functions emulator's log (`build.*` lines) | depends on the error |

A fix to the prompt or the docs Claude reads changes every build: add or rerun an eval case, then compare
(`node scripts/eval-builds.mjs <label> <case…>`, `node scripts/eval-compare.mjs`). Report the cause, the fix and
what was rerun.
