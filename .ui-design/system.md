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
- **A state belongs to one rack, and the lamp is the tie-breaker.** The racks filter one list
  independently, so a state named by two of them draws the same session twice. `blocked` was
  counted as finished *and* claimed by "Needs you", so one session sat in both "Needs you" and
  "Background · done", wearing a lock lamp on a strip marked `finished`. Blocked is running and
  stopped at a prompt: it is the loudest thing on the page, never the quietest. When a predicate
  and a lamp disagree about a state, the lamp is right, because it is what the pilot actually
  reads at 14px. Keep "has ended" and "the agent's own word outranks the registry" as two
  predicates; they overlap but they are not the same question.
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
- **One project at a time.** Maverick is opened on a project; sessions running elsewhere are
  that project's business. No cross-project view, no project filter, and no project heading on
  the command centre, because the bar already names it and every rack carries its own count.
- **Development only.** Every tracker row Maverick shows is a dev row. There is no toggle for
  non-dev items, because there is no reason to look at them here.
- **Formations, not a dock.** A dock covering half the page over live content was the confusing
  part. Sessions group into *formations*, named phonetically (Alpha, Bravo, Charlie), each a tab
  beside the Rack. A formation is one **lead**, the session that orchestrates, and its **flight**,
  one to twenty sessions under it, drawn with the same strips as everywhere else. The active
  formation is in the URL, so one can be pulled into its own window or desktop.
- **A strip moves between racks, and that is the whole of drag and drop.** A controller lifts a
  paper flight strip out of one rack and puts it in another, so the tabs are the racks: drop a
  strip on a formation tab and it joins that flight, drop it on `Rack` and it leaves the
  formation it was in. Inside a formation the lead slot and the flight are two more racks, which
  is promote and demote. One rule, no second gesture. The strip advertises it with the grab
  cursor alone (its row is already six columns dense and has no pixels to spare for a handle);
  what actually announces the move is the *targets* lighting up the moment a strip is in the air.
  A landing zone is an `outline` with an offset, never a ring or padding, so highlighting a rack
  cannot move the page it is drawn on. Every drag also has a click path, on the strip's own
  right-click menu, because a drag is unreachable without a pointer.
- **A rename puts the drag handle down.** A `draggable` ancestor swallows text selection inside
  an input, so `.strip-rename` clears `draggable` on the strip while the name is being typed and
  restores it on commit or Escape. Without this the rename field looks focusable and will not
  select.
- **A slot can be held for a session that does not exist yet.** Starting a claude into a
  formation gives the formation a `pending` entry keyed by the *pty*, because that is the only
  handle that exists before a session id does; it fills itself the moment Claude Code registers
  a session in that terminal, and drops if the pty dies without ever registering. The held slot
  draws as the same strip on the same grid, marked `starting`, for the same reason a slot whose
  session is gone says so rather than vanishing. The callsign (`Alpha 2`) names the *slot* and
  titles its terminal; the session keeps the title Claude Code derives, which says more about
  the work than a position does.
- **A tab's own actions live on the tab.** Right-click a formation to rename or disband it;
  closing one should not need a trip inside it first. Disbanding asks, because the grouping is
  the only thing lost and it is not recoverable.
- **A session opens where it sits, and several can be open at once.** Full screen answers "show
  me this one" and nothing else: it covers the formation, so the moment you type into the lead
  you lose the flight. Inside a formation a strip expands in place instead. The strip stays in
  its rack and gets taller, its line becoming the pane's header, the body below carrying the
  conversation and composer, or the terminal once you take the stick. The open set lives in the
  URL beside `formation`, so a layout survives a reload and can be pulled into its own window.
  Past one open strip the rack becomes two columns, and a *collapsed* strip still spans the full
  row, because it is still a line: only the open ones share. In a column the strip drops its
  `where`, which is the one thing its own pane header repeats.
- **The pane header says only what the strip has no column for.** Inline it is one row: take the
  stick, and dismiss. The strip line directly above already carries the name, state, timing,
  place and the three verbs, and a second header repeating them was the defect, not the design.
  Note that `replaceChildren` does not drop nulls the way `el()` does; one painted the word
  "null" into every pane head.
- **A terminal wears this interface, and a real emulator is not negotiable.** Claude Code drives
  the alternate screen, addresses the cursor and wants raw keys, so the arrows, Ctrl+C and its
  own permission menus only work through something that speaks the protocol; re-rendering its
  output as components would lose exactly that. What is negotiable is the look. xterm paints
  transparent over the pane's own `--panel`, in JetBrains Mono with a line height you can read, a
  bar cursor in `--accent`, a seam ring and the thin `--cold` scrollbar, with the 16 ANSI slots
  repainted in the instrument palette. That last part is not enough on its own: measured against
  a live pty, Claude Code writes its own colours as **truecolor** (`38;2;r;g;b`), which walks
  straight past any theme, so the handful it hardcodes (its orange is `#d77757`) are substituted
  in the stream on the way to the renderer. Anything not in that table passes through untouched,
  which is the safe direction: an unseen colour keeps its own value rather than becoming a wrong one.
- **The terminal lives inside the session it belongs to.** "Take the stick" mounts it in the
  session's own full-screen view rather than in a panel over the page; detaching leaves the
  session running. A formation holds session ids, not sessions: sessions come and go, the
  grouping outlives them, and a slot whose session is gone says so rather than vanishing.
- **xterm measures its own box**, so every visible pane must be refit and its pty resized on any
  layout change, inside a `requestAnimationFrame` so the new geometry has actually landed.
- **The bar** (52px): the traced jet at 27px in the accent, then the wordmark, then the project
  as a pill carrying its own accent as a dot (a project is identity, not a form field, so it is
  never a native `select`), then the views as a segmented well with a drawn icon beside each
  label and the live one lifted out on `--panel-lifted`, then status, then the instruments.
- **Anything painted on the project's accent computes its own foreground.** A project picks the
  accent, so a fixed `--on-accent` cannot hold: white on Realtime's cyan is 3.2:1. `readableOn()`
  takes whichever of ink or paper contrasts better and sets the token; clearing the project
  palette clears it too.
- **Icons carry `.icon` and inherit `currentColor`** at one 1.5 stroke in a 16px box: board is
  unequal kanban columns, calendar a grid with two hangers, workspace the rack's strips with a
  lamp at each head.
- **The edge between the board and the rail belongs to the grid, not to the rail.** The rail is
  sticky and only as tall as its own content, especially collapsed, while the board beside it
  runs for thousands of pixels; an edge drawn on the rail can never reach the bottom. It is a
  pseudo-element on `.project`, positioned off a `--rail` custom property that the collapsed
  state overrides, so it is full height by construction and moves when the rail narrows.
- **The rail is an edge, not a box.** A background plus a ring plus a shadow made it a card
  floating in a column, which reads worst when it is collapsed to a strip. It carries one thing:
  an inset shadow on the deck side, so the separation fades out instead of stopping dead.
- **The rail speaks in the workspace's shapes.** Its rows carry the same engines and reticles,
  and a tally at the top counts what is waiting, working and parked in those same shapes. The
  tally is the one thing besides the heading that survives the rail collapsing to 36px.
- **A drawn lamp is an `svg`; a plain dot is a `span`.** Records, dock tabs and closed
  formations carry state rather than an engine, so they stay dots and are styled separately.
- **A rail is a surface, not a line.** The sessions rail is sticky and one viewport tall; the
  board beside it runs to 30,000px, so any border on it stops a screen down and reads as broken.
  It is a floating panel instead: its own background, a 1px ring and a soft shadow on the deck
  side, which needs no relationship to the length of what it sits next to.
- **Collapsed means a fixed strip, never a fraction.** A collapsed lane at `0.16fr` grows with
  the window and never gets out of the way; it is 36px. The turned heading gets a `min-height`
  matching the longest label, so a row of collapsed lanes reads as one band and no heading wraps
  inside a short column.
- **Every colour a surface uses is a token, or light mode inherits the dark one's hard-coded
  darks.** The bar (`--bar`), the lamp's machined metal (`--metal`, `--metal-edge`, `--metal-lip`,
  the `--cold-*` set), the release tile (`--tile`), the stat wells (`--inset`), every lift shadow
  (`--shade`, `--shade-soft`), the deck gradient (`--deck-top`) and the status colours (`--ok`,
  `--warn`, `--gold`, `--info`, `--on-accent`). The light bar is silver, not a lightened dark.
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
