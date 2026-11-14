# UI kit (`./genesis/ui.css`, provided at run time; never write it)
src/main.js imports it before App: `import "./genesis/ui.css"`. Build the UI from these classes; they look good together, so do not write CSS that repeats them.
- Layout: `.page` (centered page column; use as the root element), `.header` (title left, actions right), `.stack` (vertical, gap), `.row` (horizontal, wraps), `.grid` (responsive columns of cards), `.spacer` (pushes the rest of a row right).
- Surfaces and text: `.card` (white panel, stacks its children), `.muted`, `.small`, `.truncate`. Plain `h1` `h2` `h3` `p` are already styled.
- Buttons: `.btn`, plus `.primary` (main action), `.danger`, `.ghost`, `.sm`. Disabled buttons are dimmed automatically.
- Forms: `.field` (wraps `.label` + control), `.label`, `.input` (on input, select and textarea).
- Lists and tables: `.list` (ul) with `.list-item` rows, plus `.clickable` and `.active` on rows; `.table`; `.avatar` (round initials).
- Badges, chips, stats: `.badge` plus `.success`, `.warning`, `.danger`, `.info`; `.chips` with `.chip` (`.active` when selected) for filters; `.stats` with `.stat` boxes holding `.stat-value` and `.stat-label`.
- States: `.loading` (spinner + text), `.empty` (centered "nothing here" text), `.notice` plus `.error`, `.success`, `.warning` (messages; use `.notice.error` for error.message).
Variables: colors `--bg --surface --surface-muted --primary-soft --text --muted --border --primary --on-primary --success --warning --danger --info`, plus `--radius --font --tint-amount` (a percentage, never a color). Use the color variables in your own layout CSS (e.g. `background: var(--surface-muted)` for incoming message bubbles, `var(--primary-soft)` for outgoing ones). Override them in :root in src/style.css (imported after the kit) only for a look the user asked for.
