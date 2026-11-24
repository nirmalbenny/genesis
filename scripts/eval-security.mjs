// Runs the variant security reviewer on planted defects (scripts/lib/security-cases.mjs): one small app per check and
// XSS sink, plus safe controls. Reports, per case, whether the reviewer removed it for the right check (caught), let it
// through (missed), or removed a safe control (false alarm). Calls Claude (Sonnet, about 2 credits per case); needs
// functions/.secret.local and `cd functions && npm run build`. Never prints keys.
//
//   node scripts/eval-security.mjs [case id…] [--model <model>] [--runs <n>]
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { fnRequire, ROOT } from "./lib/local.mjs";
import { CASES } from "./lib/security-cases.mjs";

const { values: opts, positionals } = parseArgs({
  allowPositionals: true,
  options: { model: { type: "string", default: "claude-sonnet-5-5" }, runs: { type: "string", default: "1" } },
});
const Anthropic = fnRequire("@anthropic-ai/sdk").default;
const { securityRequest, parseSecurity } = fnRequire("./lib/llm/grade");
const { securityRemoves } = fnRequire("./lib/llm/variants");
const key = readFileSync(`${ROOT}functions/.secret.local`, "utf8").match(/^ANTHROPIC_API_KEY=(.+)$/m)?.[1]?.trim();
if (!key) { console.error("ANTHROPIC_API_KEY missing from functions/.secret.local"); process.exit(1); }
const client = new Anthropic({ apiKey: key });

const cases = positionals.length ? CASES.filter((c) => positionals.includes(c.id)) : CASES;
const runs = Number(opts.runs) || 1;
const text = (m) => m.content.filter((b) => b.type === "text").map((b) => b.text).join("");

async function review(c) {
  const m = await client.messages.stream(securityRequest(opts.model, { request: c.request, version: c.request, files: c.files })).finalMessage();
  return parseSecurity(text(m));
}

const results = [];
for (const c of cases) {
  const verdicts = await Promise.all(Array.from({ length: runs }, () => review(c).catch(() => null)));
  for (const r of verdicts) {
    const removed = securityRemoves(r);
    const blocking = (r?.findings ?? []).filter((f) => f.severity === "critical" || f.severity === "high");
    const outcome = !r ? "NO REVIEW"
      : c.expect === null ? (removed ? "FALSE ALARM" : "ok")
      : !removed ? "MISSED"
      : blocking.some((f) => f.check === c.expect) ? "caught" : "caught, other check";
    results.push({ c, outcome });
    const detail = (r?.findings ?? []).map((f) => `${f.check}/${f.severity}`).join(" ") || "no findings";
    console.log(`${outcome.padEnd(20)} ${c.id.padEnd(24)} expect ${(c.expect ?? "pass").padEnd(4)} · ${detail}`);
  }
}
const count = (o) => results.filter((x) => x.outcome === o).length;
const planted = results.filter((x) => x.c.expect !== null).length;
const controls = results.length - planted;
console.log(`\nplanted defects: ${count("caught")} caught for the right check, ${count("caught, other check")} caught for another, ${count("MISSED")} missed (of ${planted})`);
console.log(`safe controls: ${count("ok")} passed, ${count("FALSE ALARM")} false alarms (of ${controls}) · reviews not completed: ${count("NO REVIEW")}`);
process.exit(count("MISSED") || count("FALSE ALARM") ? 2 : 0);
