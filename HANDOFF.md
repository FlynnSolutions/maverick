# Maverick: next session, drag and drop into formations

Paste everything below the line into a fresh session in `~/Projects/maverick`.

---

I'm working on Maverick, my local dev console at `~/Projects/maverick`. It watches every Claude
Code session on this machine and lets me steer them. Run it with `node server.ts`; it serves
`web/` at http://localhost:8766. Node 22 strips the types itself, there is no build step and no
dependencies.

**Read `.ui-design/system.md` first.** It is the design contract, not documentation: every line
is there because breaking it caused a real defect. Hold to it.

## What exists

**The workspace** (`?view=workspace`) is the command centre. It shows one project's sessions as
a *rack* of *strips*: fixed columns so the lamp, state, timing, path and the three verbs share
one x down the page. Strips group into racks by urgency: Needs you, Working, Needs action (idle
under an hour), Idle, Stale, Background done. A strip's lamp is a drawn afterburner nozzle for
running states and a targeting reticle for the two that want me. Clicking a strip opens the
session full screen with its transcript, a composer, and optionally its terminal.

**Formations** are named groups of sessions, phonetic callsigns (Alpha, Bravo, Charlie), each a
tab beside "Rack" in the page head. A formation is one **lead**, the session that orchestrates,
and its **flight**, the sessions under it. Server model in `src/formations.ts`, REST at
`/api/formations`. The active formation is in the URL so one can be pulled into its own window.

There is **no dock**. It used to be a panel covering half the page over live content and it was
confusing; it was removed entirely. Terminals now open inside a session's own full-screen view.

Key files: `web/command.js` (the rack, strips, formations, the full-screen session view),
`web/app.js` (bar, board, calendar, dialogs, theme), `web/style.css`, `web/lamp.js` (nozzles and
reticles), `web/jet.js` (the F-14, traced from a photo; regenerate it, never hand-edit it).

## What I want built

1. **Drag and drop sessions into formations.** From the Rack, I should be able to drag a strip
   onto a formation tab and have it join that formation's flight. Inside a formation, I should be
   able to drag a flight member onto the lead slot to promote it, and drag a strip out to remove
   it. Persist through `PATCH /api/formations/:id` (`{ lead, members }`). The rack's strips
   already have a drag affordance nowhere, so decide how a strip advertises that it can be dragged
   without adding clutter to a row that is already dense.

2. **Start a new session directly into a formation.** Right now "New session" creates a session
   that appears in the rack and I then have to add it. I want to create one *into* the formation
   I am looking at, so the flight grows without a second step. Work out the whole flow: what the
   control is, where it sits, what the session is named, whether it inherits anything from the
   lead.

Preserve the existing UI language. Strips, lamps, reticles, racks and the callsign vocabulary are
the point; do not invent a second visual system for formations.

## Verify by looking, not by asserting

`node tools/cdp.mjs <url> --shot out.png` and `--eval file.js` drive headless Chrome over the
DevTools protocol. Read `tools/README.md`. Two real defects in this repo were invisible in the
CSS and obvious in a computed style, so measure: contrast ratios from computed colours, element
boxes for alignment, `scrollWidth` vs `clientWidth` for overflow. Give the pages 6-9 seconds to
settle. For drag and drop specifically, synthesise the `dragstart`/`dragover`/`drop` events in an
`--eval` script and assert the formation actually changed on the server, not just in the DOM.

## Also noted, not for this session

Sessions are being marked **done** when they are not done in my view. I looked at where that
comes from, so you do not have to start cold:

- Maverick does not compute the status. Interactive sessions carry whatever Claude Code's own
  registry says, and background agents carry the `state` field from `claude agents --json --all`,
  shelled out in `backgroundAgents` in `src/git.ts`.
- There is, however, a real banding defect in the client. In `web/command.js` the helper that
  decides a session is finished counts `blocked` as finished, while the "Needs you" rack also
  claims `blocked`. The two filters run independently over the same list, so a blocked session
  renders in **both** "Needs you" and "Background, done". The registry has no blocked sessions
  right now, so I could not reproduce it live; the contradiction is plain in the source.

That may be the whole of it, and it is a two-line fix, but it is a different
concern from drag and drop. Do it as its own commit, or leave it for the mission-control rework.

## How I work

Small changes, verified, one concern each. Tell me plainly when something is not verified. Never
claim something works without showing the output. Commit and push when it is done; never merge.
