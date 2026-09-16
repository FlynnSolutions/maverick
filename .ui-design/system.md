# Maverick design system

Recorded 2026-09-15 after the ui-design / ui-audit pass on the Workspace (command center).
Hold to these; extend rather than reinvent.

## Direction and feel

A flight deck, in Navy colours off the airframe: gull greys and silver, insignia red and blue,
white for the lifted surface. Two modes, dark (a real dark grey, `--carbon: #14171a`, not the
near-black this started on) and light (`#e4e7e9` deck, white panels); an explicit choice is
remembered in `mv.theme`, otherwise the system decides. The project being flown supplies the
accent and display face via `<project>/maverick.json`. Top Gun without costume: the jet appears
when something is happening, never on a timer, because a flyby you did not cause is weather.

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

- **Four densities, and the loudest is the one that answers the page's question.** Needs-you
  (`.rack.needs`): 56px line, 17px name, lifted `--panel-lifted`, a caution ring at 45% alpha
  you can actually see, secondary text raised to `--ink-soft` to stay readable on the brighter
  surface. Working (`.strip.full`): 46px, 15px name, the exchange. Idle/stale/done: a 40px line
  at 13.5px/500. Three lifted strips is not a hierarchy; one is.
- **The type scale has to agree with the ordering.** The racks sort by urgency, so the project
  heading is a quiet 15px tracked divider and `Needs you` is the 19px caution heading. When the
  project head was 22px and the rack head 15px, the structure sorted by urgency and the type
  sorted by project.
- **Never let `1fr` pool the slack on the column that does not need it.** The name column took
  every spare pixel (577px of void on the strip that mattered) while state, timing and path all
  truncated beside it. The name shares: `minmax(230px, 0.5fr)` on the path, fixed on the rest.
  Any cell that can ellipsise carries a `title`, or its text is unrecoverable.
- **A state colour belongs to one state.** `@keyframes arc` hardcoded `--hud`, so a *working*
  session pulsed in the colour a *finished* one is painted. A keyframe that sets colour is a
  second place a state is defined; keep the colour on the class and the motion in the keyframe.
- **The lamp is an engine, or a reticle.** Running states are an afterburner nozzle drawn off a
  photograph: a serrated petal rim (a *ring* with the teeth cut into its inner edge, never a
  filled star, which reads as a sun), a banded throat, and an iris whose area opens with heat.
  Everything reads one property, `--bloom`, 0 cold to 1 afterburner. The petals flutter while
  the engine is lit and the core flickers on a deliberately uneven cadence, because a clean
  pulse reads as a notification dot rather than combustion.
- **The two states that want the pilot are a targeting reticle, not a lamp.** Blocked is a lock:
  brackets closed on the target, a filled pip, and a burst of flicker once every five seconds
  rather than a steady blink. Your-turn is acquiring: brackets held open with the ring sweeping
  inside them. A different *form*, so a blocked session can never be mistaken for a busy one at
  14px. Rotate the ring, not the brackets, and set `transform-box: view-box` or it spins about
  its own bounding box and wobbles.
- **The airframe is traced, never drawn.** `web/jet.js` is an F-14A generated from a photograph:
  sky cut, the mask's own border followed pixel by pixel, simplified, then the interior quantised
  into four tone bands and each region traced as its own contour. 43 paths. Regenerate it from
  the reference; do not hand-edit coordinates, which is what produced three bad jets before this.
- **Session strip** (`.strip`) — the signature. Air traffic control keeps one paper progress
  strip per flight in a rack, ordered by urgency and annotated by hand; a session is a flight.
  The line is a grid of fixed columns (`8px · name 1fr · 180px state · 148px timing · 230px
  where · 152px actions`, 14px gaps, 40px min height), so the lamp, the state and the three
  verbs share one x down the entire page however long a title runs. Right-aligning the action
  group is not enough: `close`, `stop` and `remove` differ in width, so each verb gets its own
  column (66 / 52 / 64px, 8px apart). Verbs are 28px tall with a `::after` extending the hit
  area to the full 40px row rather than inflating the row to 44; extend on both axes, and keep
  a real gap, or adjacent targets touch.
- **Three densities carry the hierarchy.** `full` (needs you, working) lifts the strip, sets the
  name 15px/600 and carries the last exchange beneath the line; `line` is the bare strip at
  13.5px/500. A rack of 40px lines under one lifted strip is the whole hierarchy: no second
  colour, no border, no size ramp needed.
- **Racks are ordered by who needs you, projects included.** A project holding a waiting session
  is drawn before one that is merely busy, and an empty project draws nothing. The page's focal
  element is whatever waits on the pilot, wherever it lives.
- **Rename in place** (`.strip-rename`): the name becomes an input in its own seat, accent ring,
  nothing around it moving. Enter or blur commits, Escape restores, empty hands the session back
  Claude Code's own title. The new name paints immediately; rebuilding every session record
  takes over a second and a rename that appears to do nothing reads as one that failed.
- **The corner dismisses; it never ends anything.** The session overlay's rightmost control was
  the verb that kills the Claude, and there was no dismiss control at all, so the position every
  interface reserves for "close this window" was wired to "close this session". The corner is a
  drawn ✕ that only closes the view; the destructive verb sits left of the primary and names its
  object (`end session`, `stop agent`, `remove record`). The rack's dense gutter keeps the short
  verbs, because it has one column of room and a confirm behind it.
- **Icons are drawn** (`web/icons.js`): one 16px box, one 1.6 stroke, `currentColor`, an
  `aria-label` on the button. Never a unicode glyph, so an icon can sit next to the jet.
  A 30px icon button carries a `::after` to a 40px hit area, the way the rack's verbs do.
- **The page head is one row**: title, the project filter, then the instruments. The filter had a
  row of its own that was empty but for one word at the far right. The command center renders its
  chips into a `filterRoot` the head owns, which is also why refresh survives a failed load.
- **Idle decays in three steps, and the first step is yours.** Under an hour between turns is a
  conversation you are in the middle of (`Needs action`, carries the exchange); under a day is
  `Idle`; beyond that is `Stale`. Distinct from `Needs you`, which is blocked on a prompt.
- **Never name a class with a bare generic word.** `.dock` styled the terminal dock *and* every
  card's `dock` button, silently making those buttons sticky, column-flex and blurred, which is
  what knocked their labels out of line with `close`. Style a one-off region by id (`#dock`) and
  keep component classes prefixed (`.strip-*`, `.rack`, `.cc-*`).
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
