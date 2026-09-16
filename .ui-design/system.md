# Maverick design system

Recorded 2026-09-15 after the ui-design / ui-audit pass on the Workspace (command center).
Hold to these; extend rather than reinvent.

## Direction and feel

A carbon flight deck. The project being flown supplies the accent (`--accent`, `--accent-hot`),
the display face (`--display`) and a callsign, via `<project>/maverick.json`; everything else is
gunmetal, steel and HUD signal colours. Quiet structure, signal where something needs the
pilot. Top Gun without costume: the jet appears where a lead or a warning is, not as decoration.

## Tokens (world names)

Surfaces `--carbon` (page) → `--gunmetal` → `--steel` (panel) → `--panel` → `--panel-lifted`.
Edges `--seam-soft` / `--seam` / `--seam-strong` (rgba, never solid hex). Ink `--ink`,
`--ink-soft`, `--ink-faint` (the floor for any text a person reads), `--ink-ghost` (hairlines
and glyphs only, fails 4.5:1 on text). Signals `--hud` (good), `--caution` (needs you),
`--threat` (failing), `--cold` (idle). Model families have their own instrument palette
(`--model-fable` white, `--model-opus`, `--model-sonnet`, `--model-haiku`, `--model-other`) so
`--accent` keeps meaning "this project".

## Depth and spacing

One depth strategy: a 1px ring (`0 0 0 1px var(--seam-*)`) on every surface; an offset-and-blur
shadow only on lift (hover, popovers). Base unit 4px. Density: panels 12px 14px padding, 8px
between rows inside a panel, 16px between panels, 18px between bands, 24px between projects.
Headings carry more space above than below.

## Type

Display: the project's face (Chakra Petch default) at 22px/600 for a project head, 15px/600 for
a panel title and band heading, 11px tracked uppercase for micro-labels. Body IBM Plex Sans 13
to 14px. Mono JetBrains Mono 11.5px for meta lines; every dynamic number is mono or
`tabular-nums`. Nothing a person reads sits below 11px.

## Patterns

- **Session panel** (`.cc-panel`): lamp · title (display 15/600) · role chip · verdict · two
  quiet ghost actions (30px, 44px wide, `--ink-soft`): `dock`, then `close` / `stop` / `remove`,
  which reddens on hover and always asks first. Enter or Space on the panel opens it; on one of
  its buttons it is that button's. Meta line mono 11.5. Last exchange as `YOU` / `CLAUDE` rows.
  The whole panel is the click target (Enter and Space too). Compact variant drops the exchange.
- **Dialog** (`.ask`): every question the browser would draw (confirm, prompt) is Maverick's
  own: a 440px gunmetal card (a form) on the drawer's backdrop, title display 15/600, body 13px
  soft ink, actions right-aligned as `cancel` ghost then the verb. A dangerous verb is threat-dim
  filled and focus starts on cancel. The page behind goes inert and stops scrolling; Escape and
  the backdrop cancel; Enter in a field submits; focus returns where it was.
- **Dock tab** (`.dock-tab`): two real buttons side by side, the name (lamp + ellipsised title)
  and a 28px `×` that reddens on hover; closing a live claude's terminal asks first, detaching
  a background attach does not.
- **Bands**: Needs you (caution, jet glyph) → formations → Working → Idle (compact) → Finished
  (compact) → closed formations as one-line rows. The focal element of the deck is whatever
  waits on the pilot.
- **Formation** (`.cc-formation`): lead row (accent jet glyph, role, loop, status) across the
  top; wings hung off a 1px hairline with 13px ticks. Never a coloured left border wash.
- **Usage pill** (`.cu-baby`): 34px capsule, brand + three labelled micro-meters + readouts;
  opens a 640px panel below it (fixed sheet under 600px). Meters are neutral (`.peak`, opacity
  0.75) until a limit is set, then caution at 70% and threat at 90%.
- **Conversation** (`.cc-conv`): 680px measure (~73ch). User turns are flat panels with a 2px
  accent right rule; Claude turns a 2px seam left rule; runs of tool calls fold into one mono
  pill; harness injections fold as system events.
- **Buttons**: primary is accent with `0 1px 2px rgba(0,0,0,.4)`, never a coloured halo. Ghost
  actions are lower-case verbs (`dock`, `close`, `stop`, `refresh`). Focus ring is
  `2px solid var(--accent)`.

## Browser surfaces

`::selection` accent-dim; caret accent; thin scrollbars in `--cold`; underline offset 2px on
markdown links; `prefers-reduced-motion` silences lamps, panel entrances and meter transitions
(the jet flyby is the one authored moment that stays).

## Phone width (≤600px)

Top bar wraps; the pill goes full width and drops its bars; the usage panel becomes a fixed
sheet; grids go single column with `minmax(0, 1fr)`; secondary buttons reach 44px.
