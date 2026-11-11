---
name: verify
description: Run Genesis's full definition of done before claiming a change is finished — lint, unit tests, emulator integration tests, frontend tests and the production build — and report exactly what passed and what wasn't checked. Use after any code change in functions/ or frontend/.
---

# Verify a change

Run every step, even when an earlier one fails, then report the results as a table. Never summarize a failure as a pass.

## 1. Functions

```bash
cd functions && npm run lint && npm test
```

`npm test` builds `lib/` and runs the unit tests (`src/**/*.test.ts`).

## 2. Integration tests (emulators)

The Firestore emulator needs **Java 21+** on `PATH` (macOS: `export PATH="/opt/homebrew/opt/openjdk/bin:$PATH"`).

- **If the emulators are already running** (`curl -s localhost:4400/emulators` answers): `cd functions && npm run test:e2e`.
- **Otherwise**, run them for the duration of the tests:

  ```bash
  (cd functions && npm run build) && firebase emulators:exec --only auth,firestore,functions "npm --prefix functions run test:e2e"
  ```

They need `LOCAL_TOKEN_KEK` in `functions/.env.local` (see `.env.example`). They never call Claude or HighLevel.

## 3. Frontend

```bash
cd frontend && npm run lint && npm test && npm run build
```

`npm run build` includes the `vue-tsc` type check.

## 4. Exercise the changed path

Tests don't replace looking at the change:

- **UI change:** run the app (`firebase emulators:start`, then `cd frontend && npm run dev`) and take headless-browser screenshots of the affected screens, desktop and phone width.
- **Generation or data change:** try it against the real HighLevel sandbox and real Claude on the emulators.
- **Docs change:** run the `docs-check` skill.

## 5. Report

| Step | Result |
|---|---|
| Functions lint / unit tests | pass or fail, with counts |
| Integration tests | pass or fail, with counts |
| Frontend lint / tests / build | pass or fail |
| Manual check | what was exercised, or "not done" and why |

State plainly anything that wasn't verified (for example: production-only paths such as Cloud KMS, or flows needing a real HighLevel connection).
