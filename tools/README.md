# tools

## cdp.mjs — look at the page, don't guess at it

Drives headless Chrome over the DevTools protocol with no dependency (Node 22 ships a
WebSocket client). Every visual claim in this repo's history was checked with it, and several
defects were only findable this way: a card's `dock` button was silently sticky and blurred
because a bare `.dock` rule matched it, and the busy lamp pulsed in the colour a *finished*
session is painted. Neither is visible in the CSS; both are obvious in a computed style.

```bash
node tools/cdp.mjs 'http://localhost:8766/?project=realtime&view=workspace' --shot out.png
node tools/cdp.mjs 'http://localhost:8766/?project=realtime' --eval check.js --wait 7000
```

- `--shot <file>` full-page PNG at 2x. A very tall page with a horizontal scroller can confuse
  full-page capture; measure the DOM before believing a screenshot that looks broken.
- `--eval <file>` runs the file's expression in the page and prints the result. An async IIFE
  works, so it can click things, wait, and report. This is how interactions get verified.
- `--w --h` viewport, `--wait` ms to settle before acting.

The pages poll, so give them 6-9 seconds. `&nolive` turns off the tailing terminals in the ship
wizard, which otherwise keep a capture from ever settling.

Measure rather than assert: contrast ratios from computed colours, element boxes for alignment,
`scrollWidth` vs `clientWidth` for overflow. `.ui-design/system.md` records what the numbers
should be.
