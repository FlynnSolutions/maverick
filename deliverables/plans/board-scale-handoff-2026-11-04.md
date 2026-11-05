# Handoff: the Board at real scale (2026-11-04)

For a new session. This loop was handed off by the command center UI pass, on Cory's call.

**The problem.** On real data the Board is very long: the heaviest real project's page is about 42,000px, with 311
cards in Backlog, 72 in Roadmap and 132 in Done awaiting deploy. The ui-audit's focus pass stops at
150 Tabs on it (`focus-visible-unfinished`), which is the only finding holding the app grade at C.
Every other page grades A on real data.

**The approach Cory chose.** Fold or page the long lanes, the way the Archive did for the command
center. The cards live in the tracker, so nothing moves in the file: this is display only, and the
markdown stays the source of truth. How a lane folds, and whether Done gets the same treatment as
Backlog, is the design call to bring to Cory (`flynn-core:variants` fits).

**Done line (propose it, then agree it).** `ui-audit` grades the Board A in every area at 390 and
1280 on a tracker with 300+ cards, including a walked task: find a card, drag it, and add one.

**How to check.** `node tools/ui-check.mjs` with `MAVERICK_UI_AUDIT` set. Give the Harbor fixture a
heavy tracker, as `startHarbor({ ended })` does for sessions. Real data, read-only: serve `web/` and
proxy only GET `/api/*` from 8766, refusing every write.

**Also open.** `.ui-design/system.md` holds the command center's new rules; read them first.
