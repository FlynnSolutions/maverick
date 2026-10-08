# Maverick as a downloadable app, with an honest front page (2026-10-07)

The brief, from Cory on 2026-10-07, in his words: put Maverick into Electron, post it on
GitHub as an app people can download, make it open source and free to everyone, and put one
completely honest statement on the front of it about why it was built and who built it.

## The statement, as he said it

This is the source material for the README's first section and the release page. Keep the
substance; it is the pillar, not a marketing paragraph.

> I'm a longtime developer, and also a founder and creator, and I've been using this to build
> all of my projects. It uses a lot of the tools I'm used to building with in Claude Code, but
> it organizes them and helps me visualize my workflow. It helps me run small products on my
> own and full enterprise-level software, so it can handle anything. It helps you manage
> projects on a project-to-project basis, anything from brainstorming to shipping features and
> everything in between. It can be customized as much as you like, or used as it is out of the
> box, and it will help you build your own workflow, loosely based off mine and what I do. I
> want the reality of it to be the marketing of it. Open source, free to everyone.

Voice rule for the written version: the `writing-voice` skill. No em-dashes. No claims the
repo cannot back; where it is one person's workflow, say so.

## What done looks like

1. **A download.** A signed-or-unsigned macOS build (Cory's machine is the only tested
   platform; say so) attached to a GitHub Release, built by a workflow so a tag produces it.
   `server.ts` becomes the Electron main process, as the rulebook has said since the start;
   the renderer is `web/` unchanged. Nothing in `web/` may start assuming Electron: the
   browser tab stays a first-class way to run it (`node server.ts`).
2. **The front page.** README opens with the statement above, then what it actually does
   today, in the order a stranger meets it: the picker, the board over markdown trackers,
   sessions, missions, the ship, the calendar. Screenshots or a short GIF of the real thing
   on an invented project (the rulebook forbids client data and real paths in the repo).
3. **The repo reads as public.** The two Priority items under "Open source, for real" are
   part of this: `CONTRIBUTING.md`, `SECURITY.md`, issue and PR templates, a `test` and
   `lint` CI workflow, the readiness score re-taken and printed.
4. **The decision about dependencies.** The rulebook says no dependencies and no build step.
   Electron and its builder are dependencies and a build step. That rule stays true for the
   *server and the web*; the Electron shell is a wrapper around them with its own
   `package.json` under `app/` (or similar), so `node server.ts` stays zero-dependency. Write
   this down in `docs/03-decisions.md` before adding a line of Electron.

## What is deliberately out of scope

- Windows and Linux builds. Unverified platforms are not shipped; they are a follow-up.
- Auto-update. A release page with a download is enough for the first public cut.
- Any change to what Maverick does. This is packaging and the front page.

## The one thing to argue about before starting

For a developer audience, `npx maverick` or a Homebrew tap of the zero-dependency server is
a smaller download and a smaller promise than a 200 MB Electron app, and it ships this week.
Cory has asked for Electron, and the rulebook has planned for it since 2026-09-14; the call
stands. But the session should put the `npx`/brew path on the table once, as the thing to
ship first or alongside, and let him decide.

## How it proves itself

- A fresh clone, `npm test` green, the CI workflow green on the tag.
- The Release has an asset; downloading it on this Mac and opening it shows the picker.
- `node server.ts` still runs with no `npm install`.
- The README statement is the one above, in his voice, and nothing in the README claims a
  feature the walkthrough on 2026-10-07 did not pass.
