import { test } from "node:test";
import assert from "node:assert/strict";
import { loadTemplates } from "./templates";
import { ENTRY_FILES } from "./llm/validate";
import { createWorkspace } from "./llm/workspace";
import { CATEGORIES } from "./projects";

// Ready-made apps must pass the same checks as generated output.
test("every template is a valid app", () => {
  const { apps } = loadTemplates();
  for (const t of apps) {
    const workspace = createWorkspace({});
    const refused = t.files.map((f) => workspace.write(f.path, f.content)).filter((r) => r.isError).map((r) => r.content);
    assert.deepEqual(refused, [], t.slug);
    // The same app-wide check as a build: imports resolve, client, component and package names exist, the entry sets
    // up the UI. Ready-made apps are on Element Plus (mountApp), like new apps.
    assert.deepEqual(workspace.problems(), [], t.slug);
    assert.match(t.files.find((f) => f.path === "src/main.js")!.content, /mountApp\(App\)/, `${t.slug} mounts with mountApp`);
    for (const f of t.files) assert.ok(!f.content.includes("</parameter>"), `${t.slug}/${f.path} has a stray </parameter>`);
    assert.ok(CATEGORIES.includes(t.category), `${t.slug} has an unknown category "${t.category}"`);
    assert.ok(t.name && t.description && t.icon, `${t.slug} needs a name, description and icon`);
    const paths = t.files.map((f) => f.path);
    for (const entry of ENTRY_FILES) assert.ok(paths.includes(entry), `${t.slug} is missing ${entry}`);
  }
});

test("template slugs are unique", () => {
  const slugs = loadTemplates().apps.map((t) => t.slug);
  assert.equal(new Set(slugs).size, slugs.length);
});
