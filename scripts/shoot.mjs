// Screenshots of the local app at desktop and phone width, for a UI change's manual check (/verify step 4).
// Needs the emulators and the dev server (`firebase emulators:start`, `cd frontend && npm run dev`) and Chrome.
// Drives Chrome through the DevTools protocol (Node's WebSocket): no browser library.
//
//   node scripts/shoot.mjs [route] [--email <local account>] [--app <id | name | latest>] [--run]
//                          [--size desktop|phone|both] [--wait-for <css selector>] [--wait-gone <text>] [--wait <ms>] [--full]
//                          [--out <dir>] [--base <url>]
//
// route: a path such as /apps (default /). --email signs in as that local account (signed out without it).
// --app opens the app's workspace (/p/<id>), or with --run its launch page (/run/<id>), and waits until the
// preview's "Updating preview" / "Starting your app" overlay is gone. --wait-for waits until a selector exists,
// --wait-gone until a text is no longer on the page (up to 60 s each; "|" separates texts); --wait then waits a
// further time (default 1500 ms after either, else 5000 ms). --full captures the whole page. Screenshots go to --out (default .shots/, git-ignored).
// Also prints the page's console errors.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { findApp, fnRequire, ROOT, uidOf } from "./lib/local.mjs";

const { values: opts, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    email: { type: "string" }, app: { type: "string" }, run: { type: "boolean" },
    size: { type: "string", default: "both" }, "wait-for": { type: "string" }, "wait-gone": { type: "string" }, wait: { type: "string" },
    full: { type: "boolean" }, out: { type: "string", default: join(ROOT, ".shots") }, base: { type: "string", default: "http://localhost:5173" },
  },
});
const SIZES = { desktop: { width: 1440, height: 900, mobile: false }, phone: { width: 390, height: 844, mobile: true } };
const sizes = opts.size === "both" ? ["desktop", "phone"] : [opts.size];
if (sizes.some((s) => !SIZES[s]) || positionals.length > 1) {
  console.error("usage: node scripts/shoot.mjs [route] [--email <account>] [--app <id|name|latest>] [--run] [--size desktop|phone|both] [--wait-for <selector>] [--wait-gone <text>] [--wait <ms>] [--full] [--out <dir>] [--base <url>]");
  process.exit(1);
}
const fail = (message) => {
  console.error(message);
  process.exit(1);
};

let route = positionals[0] ?? "/";
if (opts.app) {
  const app = await findApp(opts.app, opts.email).catch((e) => fail(e.message));
  route = `/${opts.run ? "run" : "p"}/${app.id}`;
  opts["wait-gone"] ??= "Updating preview|Starting your app";
}
await fetch(opts.base).catch(() => fail(`Nothing answers at ${opts.base}: start the dev server (cd frontend && npm run dev).`));
const uid = opts.email ? await uidOf(opts.email).catch(() => fail(`No local account ${opts.email}.`)) : null;
const token = uid ? await fnRequire("firebase-admin/auth").getAuth().createCustomToken(uid) : null;

// ---- Chrome ----
const CHROME = process.env.CHROME_PATH ?? ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser"].find(existsSync);
if (!CHROME) fail("Chrome not found: set CHROME_PATH to its path.");
const profile = mkdtempSync(join(tmpdir(), "genesis-shoot-"));
const chrome = spawn(CHROME, ["--headless=new", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "--no-first-run", "--no-default-browser-check", "--hide-scrollbars", "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let port;
for (let i = 0; i < 100 && !port; i++) {
  await sleep(100);
  try { port = readFileSync(join(profile, "DevToolsActivePort"), "utf8").split("\n")[0]; } catch { /* not yet */ }
}
if (!port) fail("Chrome didn't start.");
const target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((t) => t.type === "page");
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });

// ---- DevTools protocol: commands answered by id, events to listeners ----
let nextId = 0;
const pending = new Map();
const listeners = new Map();
ws.onmessage = ({ data }) => {
  const msg = JSON.parse(data);
  if (msg.id !== undefined) {
    const p = pending.get(msg.id);
    pending.delete(msg.id);
    if (msg.error) p.reject(new Error(msg.error.message)); else p.resolve(msg.result);
  } else for (const fn of listeners.get(msg.method) ?? []) fn(msg.params);
};
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++nextId;
  pending.set(id, { resolve, reject });
  ws.send(JSON.stringify({ id, method, params }));
});
const on = (method, fn) => listeners.set(method, [...(listeners.get(method) ?? []), fn]);
const evaluate = async (expression) => {
  const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
  return r.result.value;
};
const open = async (url) => {
  const loaded = new Promise((resolve) => on("Page.loadEventFired", resolve));
  await send("Page.navigate", { url });
  await Promise.race([loaded, sleep(30_000)]);
};

const errors = [];
on("Runtime.exceptionThrown", (p) => errors.push(p.exceptionDetails.exception?.description?.split("\n")[0] ?? p.exceptionDetails.text));
on("Runtime.consoleAPICalled", (p) => { if (p.type === "error") errors.push(p.args.map((a) => a.value ?? a.description ?? "").join(" ").split("\n")[0]); });
await send("Page.enable");
await send("Runtime.enable");

try {
  if (token) {
    // Sign in through the app's own Firebase module (served by the dev server), connected to the auth emulator.
    await open(opts.base);
    await evaluate(`(async () => {
      const src = await (await fetch('/src/firebase.ts')).text();
      const authUrl = /from\\s+["']([^"']*firebase_auth[^"']*)["']/.exec(src)[1];
      const { auth } = await import('/src/firebase.ts');
      const { signInWithCustomToken } = await import(authUrl);
      await signInWithCustomToken(auth, ${JSON.stringify(token)});
    })()`);
  }
  mkdirSync(opts.out, { recursive: true });
  const name = route.replace(/^\/|\/$/g, "").replace(/[^\w-]+/g, "-") || "home";
  for (const size of sizes) {
    const { width, height, mobile } = SIZES[size];
    await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: mobile ? 2 : 1, mobile });
    const started = Date.now();
    await open(opts.base + route);
    if (opts["wait-for"]) {
      const sel = JSON.stringify(opts["wait-for"]);
      let found = false;
      for (let i = 0; i < 120 && !found; i++) { found = await evaluate(`!!document.querySelector(${sel})`); if (!found) await sleep(500); }
      if (!found) console.log(`${size}: ${opts["wait-for"]} didn't appear within 60 s`);
    }
    if (opts["wait-gone"]) {
      const texts = JSON.stringify(opts["wait-gone"].split("|"));
      const present = () => evaluate(`${texts}.some((t) => document.body.innerText.includes(t))`);
      for (let i = 0; i < 20 && !(await present()); i++) await sleep(500); // let it appear first (up to 10 s)
      let gone = false;
      for (let i = 0; i < 120 && !gone; i++) { gone = await evaluate(`!${texts}.some((t) => document.body.innerText.includes(t))`); if (!gone) await sleep(500); }
      if (!gone) console.log(`${size}: "${opts["wait-gone"]}" still on the page after 60 s`);
    }
    if (opts["wait-for"] || opts["wait-gone"]) console.log(`${size}: ready in ${((Date.now() - started) / 1000).toFixed(1)} s`);
    await sleep(Number(opts.wait ?? (opts["wait-for"] || opts["wait-gone"] ? 1500 : 5000)));
    let clip;
    if (opts.full) {
      const { cssContentSize: c } = await send("Page.getLayoutMetrics");
      clip = { x: 0, y: 0, width: Math.ceil(c.width), height: Math.ceil(c.height), scale: 1 };
    }
    const { data } = await send("Page.captureScreenshot", { format: "png", ...(clip ? { clip, captureBeyondViewport: true } : {}) });
    const file = join(opts.out, `${name}-${size}.png`);
    writeFileSync(file, Buffer.from(data, "base64"));
    console.log(`${size}: ${file}`);
  }
  const unique = [...new Set(errors)];
  console.log(unique.length ? `Console errors (${unique.length}):\n${unique.slice(0, 10).map((e) => `  - ${e}`).join("\n")}` : "No console errors.");
} catch (e) {
  console.error(e.message);
  process.exitCode = 1;
} finally {
  ws.close();
  chrome.kill();
  await sleep(200);
  rmSync(profile, { recursive: true, force: true });
}
process.exit();
