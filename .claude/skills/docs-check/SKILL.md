---
name: docs-check
description: Check every Markdown file in the repo — markdownlint, local links and anchors (including links into other files), and that every Mermaid diagram renders the way GitHub will show it. Use after editing README.md, docs/ARCHITECTURE.md, CLAUDE.md or any other .md file.
---

# Check the docs

```bash
node scripts/check-docs.mjs                # lint, links and anchors, diagrams
node scripts/check-docs.mjs --no-diagrams  # skip rendering if Chrome isn't available
```

Rendering uses Chrome; set `CHROME_PATH` if it isn't found. The rules are in `.markdownlint-cli2.jsonc` (defaults, with line length off).

## Fixing what it reports

- **Blank lines around headings, lists, tables and code blocks:** `npx --yes markdownlint-cli2@0.18.1 --fix <file>`, then review the diff.
- **Code block without a language:** add one (`bash`, `text`, `json`, `http`…).
- **Missing anchor:** GitHub builds anchors by lowercasing the heading, dropping punctuation and turning spaces into hyphens (`## 8. Rate limiting` → `#8-rate-limiting`). Renumbering sections breaks links into them, so check README links into ARCHITECTURE.
- **Diagram doesn't render:** in sequence diagrams, a `;` inside a message ends the statement; use a comma. Keep labels free of unbalanced quotes and brackets.
- **Readability, not just validity:** after changing a diagram, render it to PNG and look at it. Valid diagrams can still be unreadable (crossing edges, empty boxes).

## Leave alone

`functions/src/llm/hlReference.md` is model input, not documentation. It's compact on purpose (it's sent with every build), so the checker skips it.

## Keep the docs in step with the code

When a number or rule changes (limits, credits, timeouts, endpoints), update every place it appears: `README.md`, `docs/ARCHITECTURE.md`, `CLAUDE.md`, the package READMEs and `.env.example`. Grep for the old value before finishing.
