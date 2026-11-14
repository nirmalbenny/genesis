#!/usr/bin/env node
// Checks every tracked Markdown file: markdownlint, local links and #anchors (including links into other
// files), and that every Mermaid diagram renders. No project dependencies; tools run through npx.
//
//   node scripts/check-docs.mjs                 all checks
//   node scripts/check-docs.mjs --no-diagrams   skip rendering (it needs Chrome; set CHROME_PATH if it isn't found)
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
process.chdir(root);
// hlReference.md and uiKit.md are model input, not documentation: kept compact on purpose because every build sends them.
const MODEL_INPUT = ["functions/src/llm/hlReference.md", "functions/src/llm/uiKit.md"];
const files = execFileSync("git", ["ls-files", "*.md"], { encoding: "utf8" })
  .split("\n").filter((f) => f && !f.startsWith("functions/templates/") && !MODEL_INPUT.includes(f));
let failed = false;

// 1. markdownlint (config: .markdownlint-cli2.jsonc)
console.log(`markdownlint: ${files.length} files`);
const lint = spawnSync("npx", ["--yes", "markdownlint-cli2@0.18.1", ...files], { stdio: "inherit" });
if (lint.status !== 0) failed = true;

// 2. Local links and anchors. Anchors follow GitHub: lowercase, drop punctuation, spaces to hyphens.
const stripCode = (s) => s.replace(/```[\s\S]*?```/g, "");
const slug = (h) => h.trim().toLowerCase().replace(/[^\w\- ]/g, "").replace(/ /g, "-");
const anchorsOf = (file) => new Set([...stripCode(fs.readFileSync(file, "utf8")).matchAll(/^#{1,6} (.+)$/gm)].map((m) => slug(m[1])));
let links = 0;
for (const file of files) {
  for (const [, target] of stripCode(fs.readFileSync(file, "utf8")).matchAll(/\]\(([^)\s]+)\)/g)) {
    if (/^(https?:|mailto:)/.test(target)) continue;
    links++;
    const [rel, frag] = target.split("#");
    const dest = rel ? path.normalize(path.join(path.dirname(file), rel)) : file;
    if (!fs.existsSync(dest)) { console.error(`✖ ${file}: missing file ${target}`); failed = true; continue; }
    if (frag && dest.endsWith(".md") && !anchorsOf(dest).has(frag)) { console.error(`✖ ${file}: missing anchor ${target}`); failed = true; }
  }
}
console.log(`links: ${links} local links checked`);

// 3. Mermaid diagrams render (GitHub shows a broken one as an error box)
if (!process.argv.includes("--no-diagrams")) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "genesis-mermaid-"));
  const chrome = process.env.CHROME_PATH
    ?? ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/google-chrome"].find((p) => fs.existsSync(p));
  const puppeteer = path.join(dir, "puppeteer.json");
  fs.writeFileSync(puppeteer, JSON.stringify({ ...(chrome ? { executablePath: chrome } : {}), args: ["--no-sandbox"] }));
  let diagrams = 0;
  for (const file of files) {
    for (const [i, m] of [...fs.readFileSync(file, "utf8").matchAll(/```mermaid\n([\s\S]*?)```/g)].entries()) {
      diagrams++;
      const input = path.join(dir, `d${diagrams}.mmd`);
      fs.writeFileSync(input, m[1]);
      const r = spawnSync("npx", ["--yes", "@mermaid-js/mermaid-cli@11.4.2", "-p", puppeteer, "-i", input, "-o", `${input}.svg`],
        { encoding: "utf8", env: { ...process.env, PUPPETEER_SKIP_DOWNLOAD: "1" } });
      if (r.status !== 0) { console.error(`✖ ${file}: diagram ${i + 1} doesn't render\n${(r.stderr || "").split("\n").slice(0, 4).join("\n")}`); failed = true; }
    }
  }
  console.log(`diagrams: ${diagrams} rendered`);
}

console.log(failed ? "✖ docs check failed" : "✔ docs check passed");
process.exit(failed ? 1 : 0);
