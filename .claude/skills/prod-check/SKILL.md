---
name: prod-check
description: Verify a Genesis production deploy after a push to main — the CI run, the live site, function auth, CORS and, when relevant, data stored by the change — without printing any secret. Use right after pushing, or when asked whether production is healthy.
---

# Check production

Project `genesisaibuilder` (see `.firebaserc`), region `us-central1`.

## 1. CI and deploy

```bash
id=$(gh run list -L1 --json databaseId -q '.[0].databaseId')
gh run watch "$id" --exit-status >/dev/null; gh run view "$id" --json conclusion,headSha,jobs
```

Both jobs ("Type-check, test, build" and "Deploy to Firebase") must succeed, for the commit you pushed. Pushes that change only Markdown or `docs/` don't run CI.

## 2. Live site and functions

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://genesisaibuilder.web.app        # 200
B=https://us-central1-genesisaibuilder.cloudfunctions.net
for f in api/projects/x hlProxy/contacts/; do curl -s -o /dev/null -w "$f %{http_code}\n" -H "Authorization: Bearer nope" "$B/$f"; done   # 401 each
```

## 3. CORS

```bash
for o in https://genesisaibuilder.web.app https://evil.example.com; do
  echo "$o: $(curl -s -i -X OPTIONS -H "Origin: $o" -H 'Access-Control-Request-Method: POST' "$B/api/projects" | grep -i '^access-control-allow-origin' | tr -d '\r')"
done
```

The app's origin must be echoed back; any other origin must get no `Access-Control-Allow-Origin`. `hlProxy` must still allow other origins (generated apps run on Sandpack's).

## 4. Data written by the change (when relevant)

Read Firestore with `gcloud auth print-access-token` and the REST API, and print **field names only, never values**. For example, HighLevel tokens must hold only `sealed` (plus `expiresAt`, `locationId`, `scope`), never `accessToken` or `refreshToken`.

## 5. Report

What was checked and the result, and anything that needs a signed-in user to verify (the definition-of-done flow: sign up → connect HighLevel → build → live data → edit → restore). Never create or delete production accounts or data without asking first.
