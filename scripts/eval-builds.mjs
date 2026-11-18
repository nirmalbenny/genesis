// Build eval: runs a fixed set of real builds (real Claude, no HighLevel) against the local emulators and reports,
// per build, the outcome, time, tokens, credits and whether every saved file compiles. Costs real Claude usage
// (about $0.10 per build), so it is run on demand, never in CI.
//
//   firebase emulators:start          (with functions/.env.local; OUTPUT_PROTOCOL selects the protocol under test)
//   (cd functions && npm run build)
//   node scripts/eval-builds.mjs <label> [case…]      results appended to eval-results.jsonl (git-ignored)
//
// Cases run in order; follow-ups build on the app of the case they follow. With no case names, all of them run.
import { createRequire } from "node:module";
import { appendFileSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const fnRequire = createRequire(`${ROOT}functions/package.json`);
const feRequire = createRequire(`${ROOT}frontend/package.json`);

// The same emulator settings and file store as the functions emulator.
for (const line of readFileSync(`${ROOT}functions/.env.local`, "utf8").split("\n")) {
  const m = /^(FILE_STORE)=(.*)$/.exec(line.trim());
  if (m) process.env[m[1]] ??= m[2];
}
process.env.FIRESTORE_EMULATOR_HOST ??= "127.0.0.1:8080";
process.env.FIREBASE_AUTH_EMULATOR_HOST ??= "127.0.0.1:9099";
process.env.FIREBASE_STORAGE_EMULATOR_HOST ??= "127.0.0.1:9199";
process.env.GCLOUD_PROJECT ??= "genesisaibuilder";
// What the functions runtime provides (the default bucket for the blob store).
process.env.FIREBASE_CONFIG ??= JSON.stringify({ projectId: "genesisaibuilder", storageBucket: "genesisaibuilder.firebasestorage.app" });

const { db } = fnRequire("./lib/admin");
const { fileStore, SEED_FILES } = fnRequire("./lib/files");
const { loadTemplates } = fnRequire("./lib/templates");
const { getAuth } = fnRequire("firebase-admin/auth");
const { parse, compileScript, compileTemplate } = feRequire("vue/compiler-sfc");
const babel = feRequire("@babel/parser");

const FN = "http://127.0.0.1:5001/genesisaibuilder/us-central1";
const HINTS = { activePath: "src/App.vue", openPaths: ["src/App.vue"] };

/** A large app (four copies of a ready-made one), so some files are left out of the context and need read_files. */
const largeFiles = () => {
  const app = loadTemplates().apps.find((a) => a.slug === "daily-briefing");
  return [0, 1, 2, 3].flatMap((k) => app.files.map((f) => ({ path: k ? f.path.replace("src/", `src/part${k}/`) : f.path, content: f.content })));
};

/** name → { app: new app's files, or the case whose app it continues; prompt; expect } */
const CASES = {
  contacts: { app: SEED_FILES, prompt: "Build a contact list with a search box and a count of matching contacts" },
  dashboard: { app: SEED_FILES, prompt: "build a contact dashboard with search and a list of upcoming appointments" },
  inbox: { app: SEED_FILES, prompt: "Build an inbox: a list of conversations, and the selected conversation's messages next to it" },
  calendar: { app: SEED_FILES, prompt: "Show this week's appointments for each calendar, with buttons to move to the previous and next week" },
  newContact: { app: SEED_FILES, prompt: "Build a form to create a new contact (first name, last name, email, phone) and list the latest contacts below it" },
  clearSearch: { app: "dashboard", prompt: "Add a button that clears the search box" },
  phone: { app: "dashboard", prompt: "Show each contact's phone number in the list, under their name" },
  packageJson: { app: SEED_FILES, prompt: "Add lodash to package.json and use its debounce for a contact search box", expect: "no package.json" },
  refuse: { app: SEED_FILES, prompt: "Write me a short poem about the ocean.", expect: "declined" },
  large: { app: largeFiles, prompt: "In the third copy of the dashboard (the files under src/part3), make the leads section show each lead's phone number under their name." },
  largeFollow: { app: "large", prompt: "Also show the lead's email address under the phone number." },
  // Asks for a feature the preview's compiler lacks: the check refuses it and the model corrects it in the same build.
  defineModel: { app: SEED_FILES, prompt: "Make a reusable SearchBox component that supports v-model using defineModel, and use it to search contacts in a contact list" },
  stop: { app: SEED_FILES, prompt: "build a contact dashboard with search and a list of upcoming appointments", expect: "stopped", stopAfterFiles: 1 },
};

async function signIn() {
  const email = `eval-${Date.now()}@example.com`;
  const password = "eval-pass-1";
  const { uid } = await getAuth().createUser({ email, password, emailVerified: true });
  const r = await fetch("http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=x", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password, returnSecureToken: true }),
  });
  const { idToken } = await r.json();
  await db.doc(`users/${uid}`).set({
    hl: { locationId: "loc-eval", locationName: "Eval" },
    credits: { balance: 100_000, reserved: 0, granted: 100_000, used: 0 },
  }, { merge: true });
  return { uid, token: idToken };
}

async function createApp(uid, files) {
  const ref = db.collection("projects").doc();
  await ref.set({
    ownerId: uid, name: "Eval", description: "eval", kind: "user", category: "other", icon: null, locationId: "loc-eval",
    deletedAt: null, createdAt: new Date(), updatedAt: new Date(),
  });
  await fileStore().apply(ref.id, files.map((f) => ({ type: "write", ...f })));
  return ref.id;
}

/** Compile errors of one saved file (Vue SFCs and JS/TS modules), or null when it compiles. */
function compileError(path, source) {
  try {
    if (path.endsWith(".vue")) {
      const { descriptor, errors } = parse(source, { filename: path });
      if (errors.length) return String(errors[0].message ?? errors[0]);
      const script = compileScript(descriptor, { id: "x" });
      if (descriptor.template) {
        const t = compileTemplate({ source: descriptor.template.content, filename: path, id: "x", compilerOptions: { bindingMetadata: script.bindings } });
        if (t.errors.length) return String(t.errors[0].message ?? t.errors[0]);
      }
    } else if (/\.(js|ts)$/.test(path)) {
      babel.parse(source, { sourceType: "module", plugins: path.endsWith(".ts") ? ["typescript"] : [] });
    } else if (path.endsWith(".json")) JSON.parse(source);
    return null;
  } catch (e) {
    return e.message.split("\n")[0];
  }
}

const MARKUP = /<\/?(?:[a-z]+:)?(?:parameter|invoke|function_calls)\b|<\/?(?:file|plan|refuse|delete)[\s>]/;

async function build(user, pid, prompt, stopAfterFiles) {
  const t0 = Date.now();
  const res = await fetch(`${FN}/generate`, {
    method: "POST", headers: { Authorization: `Bearer ${user.token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ projectId: pid, prompt, ...HINTS }),
  });
  if (!res.ok) return { outcome: `http_${res.status}`, error: (await res.text()).slice(0, 200) };
  // Read the stream as it arrives, to time the first token.
  let text = "";
  let firstToken = null;
  const decoder = new TextDecoder();
  let stopSent = false;
  for await (const chunk of res.body) {
    text += decoder.decode(chunk, { stream: true });
    if (firstToken === null && text.includes("event: token")) firstToken = Date.now() - t0;
    // Press Stop once enough files are finished (as the Stop button does).
    if (stopAfterFiles && !stopSent && (text.match(/event: file_end/g) ?? []).length >= stopAfterFiles) {
      stopSent = true;
      const gid = /event: start\ndata: (.*)\n/.exec(text)?.[1] && JSON.parse(/event: start\ndata: (.*)\n/.exec(text)[1]).generationId;
      await fetch(`${FN}/api/projects/${pid}/generations/${gid}/cancel`, { method: "POST", headers: { Authorization: `Bearer ${user.token}` } });
    }
  }
  const events = [...text.matchAll(/event: (\w+)\ndata: (.*)\n/g)].map((m) => ({ e: m[1], d: JSON.parse(m[2]) }));
  const end = events.find((x) => ["done", "error", "cancelled"].includes(x.e));
  const gid = events.find((x) => x.e === "start")?.d.generationId;
  const gen = (await db.doc(`projects/${pid}/generations/${gid}`).get()).data() ?? {};
  const chat = events.filter((x) => x.e === "token" && x.d.path === null).map((x) => x.d.text).join("");
  const written = gen.files ?? [];
  const saved = written.length ? await fileStore().read(pid, written) : [];
  const broken = saved.flatMap((f) => {
    const err = compileError(f.path, f.content);
    if (!err) return [];
    const line = Number(/\((\d+):\d+\)/.exec(err)?.[1] ?? 0);
    const near = line ? f.content.split("\n").slice(Math.max(0, line - 3), line + 1).join("\n") : f.content.slice(-200);
    return [{ path: f.path, error: err, near }];
  });
  const started = events.filter((x) => x.e === "file_start").map((x) => x.d.path);
  return {
    unfinished: end?.e === "cancelled" ? end.d.unfinished ?? null : undefined,
    startedNotSaved: started.filter((p) => !written.includes(p)),
    outcome: end?.d?.code === "declined" ? "declined" : end?.e,
    error: end?.e === "error" ? end.d.message?.slice(0, 300) : undefined,
    seconds: Math.round((Date.now() - t0) / 100) / 10,
    firstTokenSeconds: firstToken === null ? null : Math.round(firstToken / 100) / 10,
    files: written.length,
    broken,
    markupInFiles: saved.filter((f) => MARKUP.test(f.content)).map((f) => f.path),
    codeInChat: /```|<template>|<script\b|^import .* from /m.test(chat),
    reads: events.filter((x) => x.e === "status").map((x) => x.d.paths).flat(),
    outputTokens: gen.usage?.outputTokens ?? null,
    credits: gen.credits ?? null,
    written,
  };
}

const [label, ...only] = process.argv.slice(2);
if (!label) {
  console.error("usage: node scripts/eval-builds.mjs <label> [case…]");
  process.exit(1);
}
// One user per app, so the per-user build limit (10 starts in 10 minutes) never interferes.
const apps = {};
for (const [name, c] of Object.entries(CASES)) {
  if (only.length && !only.includes(name)) continue;
  let app = typeof c.app === "string" ? apps[c.app] : null;
  if (typeof c.app === "string" && !app) { console.log(`${name}: skipped (needs case ${c.app})`); continue; }
  if (!app) {
    const owner = await signIn();
    app = { user: owner, pid: await createApp(owner.uid, typeof c.app === "function" ? c.app() : c.app) };
  }
  apps[name] = app;
  const { user, pid } = app;
  const r = await build(user, pid, c.prompt, c.stopAfterFiles).catch((e) => ({ outcome: "script_error", error: e.message }));
  // Stopped: finished files kept and compiling, the one being written not saved.
  const ok = c.expect === "stopped" ? r.outcome === "cancelled" && r.files >= 1 && !r.broken?.length && (r.unfinished === null || !r.written.includes(r.unfinished))
    : c.expect === "declined" ? r.outcome === "declined"
    // Build what the rules allow (no npm package) instead of declining the whole request.
    : c.expect === "no package.json" ? r.outcome === "done" && !r.written?.includes("package.json") && !r.broken?.length
    : r.outcome === "done" && !r.broken?.length && !r.markupInFiles?.length;
  const row = { label, case: name, ok, ...r, at: new Date().toISOString() };
  appendFileSync(`${ROOT}eval-results.jsonl`, JSON.stringify(row) + "\n");
  console.log(`${ok ? "PASS" : "FAIL"} ${name.padEnd(12)} ${r.outcome} ${r.seconds}s first=${r.firstTokenSeconds}s out=${r.outputTokens} credits=${r.credits} files=${r.files} broken=${r.broken?.length ?? "-"} markup=${r.markupInFiles?.length ?? "-"}${r.error ? ` (${r.error})` : ""}`);
}
process.exit(0);
