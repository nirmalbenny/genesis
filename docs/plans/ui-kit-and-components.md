# Plan: Genesis look and reusable components for generated apps

Branch `feat/ui-components` (from `main` at `99d6490`). Status: **done** (all four phases in one change, at the user's request; the decisions in §7 took the recommended option). A real-Claude check is in ARCHITECTURE §10.

## Contents

- [1. Goal](#1-goal)
- [2. What exists today](#2-what-exists-today)
- [3. Design](#3-design)
- [4. Phases](#4-phases)
- [5. Testing and verification](#5-testing-and-verification)
- [6. Risks](#6-risks)
- [7. Decisions needed](#7-decisions-needed)

## 1. Goal

Generated apps should look like Genesis (coral, navy, Inter, the same buttons, inputs, cards and badges) and be built from a small set of ready-made components with shadcn's API, so Claude writes `<Button variant="outline">` instead of hand-styling, gets accessible dialogs, menus and tabs for free, and keeps its output short.

## 2. What exists today

- **UI kit** `frontend/src/sandbox/genesis/ui.css`: CSS classes (`.btn`, `.card`, `.input`, `.badge`, `.list-item`, `.notice`, …) and variables, generic blue look, system font. Injected into every preview as `src/genesis/ui.css`; apps import it in `main.js`. Documented for Claude in `functions/src/llm/uiKit.md` (part of the cached system prompt); a Vitest test keeps the two in sync.
- **Add-only rule:** the kit is live for every app at once, so classes and variables may be added, never removed or renamed.
- **Preview:** `PreviewPanel.vue` (editor and `/run/:id`) runs apps in Sandpack (`vue-cli` template) with only `vue` and `core-js` as packages.
- **Ready-made apps** (`functions/templates/`) don't use the kit; they have their own CSS in roughly Genesis colours (Phase 4).
- **Genesis's own UI** (`frontend/src/style.css`, `components/ui/*`): shadcn-vue on Tailwind v4 and `reka-ui`, Inter, coral `#ff5c35`, navy `#213343`, radius 6 px (cards 10 px), 32 px buttons and inputs, 24 px badges.

## 3. Design

### 3.1 Two layers

```text
src/genesis/ui.css          the kit: Genesis tokens + CSS classes (restyled; names unchanged; a few additions)
src/genesis/ui/*.vue        components with shadcn's API, styled ONLY by kit classes (no Tailwind)
src/genesis/ui/index.js     import { Button, Card, Dialog } from "./genesis/ui"
```

Both are injected by `PreviewPanel` like the HighLevel client, are never saved, and `src/genesis/` stays system-owned (the model can't write there). Components contain no colours or sizes of their own: everything comes from the kit, so one stylesheet defines the look and a user's "make it dark" still works by overriding kit variables in `src/style.css`.

### 3.2 Kit restyle (values only)

| Variable or class | Genesis value |
|---|---|
| `--primary` / new `--primary-hover` / `--on-primary` | `#ff5c35` / `#e8491f` / `#ffffff` |
| `--text` / `--muted` | `#213343` / `#516f90` |
| `--bg` / `--surface` / `--border` | `#f5f8fa` / `#ffffff` / `#dfe3eb` |
| new `--input-border` / `--ring` | `#cbd6e2` / `#ff8f73` |
| `--success` / `--warning` / `--danger` / `--info` | `#00a38d` / `#c2410c` / `#b91c1c` / `#007a8c` |
| `--primary-soft` | `#fff1ee` (Genesis accent) |
| `--radius` | `10px` for cards; controls use `calc(var(--radius) - 4px)` = 6 px |
| `--font` / new `--font-mono` | Inter, system fallback / IBM Plex Mono |
| `.btn` | 32 px, 13 px medium, radius 6, focus ring `--ring`; default variant white with light-grey hover |
| `.badge` | 24 px, radius 6 (not a pill), 12 px medium |
| `.input` | 32 px, `--input-border`, coral focus ring |
| `.card` | radius 10, padding 20, Genesis border |

Fonts load from Google Fonts with `display=swap`; if blocked, the system font is used.

### 3.3 Additions to the kit (add-only)

`.btn.secondary`, `.btn.outline` (aliases of Genesis's outline style), `.btn.link`, `.btn.icon`, `.btn.lg`; `.badge.primary`, `.badge.outline`; `.tabs`, `.tab` (`.active`); `.separator`; `.skeleton`; plus the internal classes the components need (`.dialog`, `.dialog-overlay`, `.menu`, `.menu-item`, `.tooltip`, …), documented as "used by components; don't use directly".

### 3.4 Components (shadcn API)

**Phase A, plain Vue, no new packages:**

| Component | Props / slots (shadcn names) |
|---|---|
| `Button` | `variant`: default, secondary, outline, ghost, destructive, link · `size`: default, sm, lg, icon · `as` (e.g. `a`) · `disabled` |
| `Badge` | `variant`: default, secondary, outline, destructive, plus Genesis's success, warning, info |
| `Card`, `CardHeader`, `CardTitle`, `CardDescription`, `CardContent`, `CardFooter` | slots |
| `Input`, `Textarea` | `modelValue` / `update:modelValue` (v-model), native attributes passed through |
| `Label`, `Separator`, `Skeleton` | |
| `NativeSelect` | a styled native `<select>` (v-model); covers most pickers without `reka-ui` |
| `Alert`, `AlertTitle`, `AlertDescription` | `variant`: default, destructive, success, warning |
| `Table`, `TableHeader`, `TableBody`, `TableRow`, `TableHead`, `TableCell` | slots |
| `Avatar` | `name` → initials, optional `src` |
| `Tabs`, `TabsList`, `TabsTrigger`, `TabsContent` | v-model; ARIA tab roles and arrow keys, written without `reka-ui` |
| Genesis helpers: `Stat`, `EmptyState`, `Loading` | the patterns every app needs (kit's `.stat`, `.empty`, `.loading`) |

**Phase B, on `reka-ui` (adds one package to every preview; needs approval):** `Dialog`, `Sheet`, `DropdownMenu`, `Select`, `Popover`, `Tooltip`, `Checkbox`, `Switch`. Same APIs as shadcn-vue, so Claude's knowledge applies directly.

### 3.5 What Claude is told (`uiKit.md`, the cached system prompt)

- Build the UI from the components (`import { Button, Card, … } from "./genesis/ui"`, path adjusted), and the kit's layout classes (`.page`, `.header`, `.stack`, `.row`, `.grid`, `.spacer`) for arrangement.
- One line per component with its props and variants; no examples longer than a line.
- Keep the existing rules: no own colours or component styles unless the user asks for a different look; then override kit variables in `src/style.css`.
- Older apps keep working: kit classes stay valid and documented.

A Vitest test keeps the doc in sync with the kit (classes, variables) and with the component index (every exported component documented, nothing documented that isn't exported).

### 3.6 Rules that keep this safe

- **Add-only, for components too:** props, variants, slots and events can be added, never removed or renamed.
- **No styles inside components:** classes only, so the kit stays the single source of the look.
- **Vue 3 APIs only that the preview's Vue supports** (no `defineModel`; props and emits), and the preview's `vue` dependency pinned to `^3.4` (also what `reka-ui` needs).
- `reka-ui` (Phase B) is added to the preview only when an app imports a component that needs it, so other apps don't load it.

## 4. Phases

| Phase | Content | User-visible effect |
|---|---|---|
| 1. Restyle | Kit values to Genesis tokens; additions (3.3); docs and tests | Every app using the kit takes the Genesis look on deploy |
| 2. Components A | Plain components (3.4), index, injection in `PreviewPanel`, `uiKit.md` rewritten around components | New builds use components; older apps unchanged except the restyle |
| 3. Components B | `reka-ui` components, conditional dependency | Dialogs, menus, selects, tooltips available |
| 4. Templates (optional) | Move the six ready-made apps onto the kit and components | One look everywhere |

Planned as one pull request per phase; shipped as one commit at the user's request.

## 5. Testing and verification

- **Unit (Vitest):** kit ↔ doc sync (extended); no existing class or variable removed (a list of today's names is checked); every component renders the expected classes and ARIA attributes for each variant, rendered to HTML with Vue's own server renderer (no new test packages); the component index and the doc agree.
- **Visual:** headless-browser screenshots, desktop and phone width, before and after, of generated apps that use the kit (contacts list, inbox, dashboard, calendar) and of a gallery page that shows every component and variant.
- **Real builds (emulators):** two or three builds with the new `uiKit.md`, checking that Claude imports the components, that apps render, and that output tokens don't grow (baseline: a dashboard build at about 4,455 output tokens).
- **Cache:** the doc change alters the cached system prompt once; the first build after deploy pays the cache write.

## 6. Risks

| Risk | Mitigation |
|---|---|
| Restyle shifts existing apps by a few pixels (buttons 34 → 32 px, pill badges → rounded) | Screenshots of existing apps before and after; names and variables unchanged |
| White on coral is ~2.9:1 contrast (Genesis's own buttons use it) | Match Genesis (decision 3); a darker coral only for apps if you prefer |
| Longer system prompt (component list) | Keep one line per component; measure the prompt size and build cost |
| Claude mixes old classes and new components | Prompt prefers components; both styles look the same, so mixing is visual-safe |
| `reka-ui` makes previews slower to load | Only added for apps that import a component needing it; measured before Phase 3 ships |
| Sandpack resolving `vue` to a version without an API we use | Pin `^3.4`; components avoid newer APIs |

## 7. Decisions needed

1. Restyle every existing app at once (recommended) or only new apps (`ui-v2.css`)?
2. Load Inter (recommended) or keep the system font?
3. Coral exactly as Genesis (recommended) or a slightly darker coral for apps?
4. Phase B (`reka-ui` in the preview): include now, or decide after Phase 2?
5. Templates (Phase 4): in this effort or later?
