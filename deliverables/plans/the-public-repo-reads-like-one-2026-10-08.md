# The public repo reads like one (planned 2026-10-07, for 2026-10-08)

One session's work. Not a mission: five small files, one image, two lines in the README,
and nothing in `src/`, `web/` or `server.ts`.

## What it is

The checklist item, which is the whole spec, in its own words:

> `LICENSE` landed 2026-09-16. Still missing: `CONTRIBUTING.md`, `SECURITY.md`, issue and PR
> templates under `.github/`, a screenshot or GIF in the README, and a one-line description of
> who this is for. Do not post about it before this is done.

Cory's call on 2026-10-07: the item text is the spec, and anything it does not name is out of
scope. His answers to the four questions that remained are under "Decided by Cory" below; there
is nothing left for the session to ask.

The repo has been public and MIT since 2026-09-16 (decisions M4) and is "the first repo here
that strangers read" (`RULEBOOK.md`). Today a stranger finds a README that opens on a paragraph
about the pilot, no picture, no way to know whether the tool is for them, and no file telling
them how to file a bug or report a hole. This item closes that gap and nothing else.

## Done when

Each line is a check a person or a script can run, not a claim.

1. `CONTRIBUTING.md` exists at the repo root and states, in the repo's own voice: Node 22.18+,
   no dependencies and no build step, `npm test`, commits lowercase and plain, no client data or
   real project paths, verify by looking with `tools/cdp.mjs`, and that `.ui-design/system.md`
   and `docs/03-decisions.md` are binding. It links to those files by relative path and every
   link resolves.
2. `SECURITY.md` exists at the repo root, names the owner's email as it appears on the repo's
   commits as the disclosure channel, and says what the reporter can expect (acknowledgement,
   no bounty, single maintainer). No placeholder text anywhere in it.
3. `.github/ISSUE_TEMPLATE/bug.md`, `.github/ISSUE_TEMPLATE/idea.md` and
   `.github/pull_request_template.md` exist, each with GitHub front matter where GitHub needs it
   (`name`, `about` on the issue templates).
4. `README.md` carries, directly under the `# Maverick` heading, one line saying who this is
   for, and under that one image, a PNG of the board on an invented project, referenced by a
   relative path that resolves to a file in the repo.
5. The image shows no real project name, path, or client data. The fixture it was taken from is
   described in the PR so a reviewer can see that for themselves.
6. `npm test` is green on the branch (nothing here should move it, which is the point of
   running it).
7. A draft PR is open against `main`, carrying the `/simplify` findings and what was done
   about them. Not merged, not posted about anywhere.

## Files it touches

New:

- `CONTRIBUTING.md`
- `SECURITY.md`
- `.github/ISSUE_TEMPLATE/bug.md`
- `.github/ISSUE_TEMPLATE/idea.md`
- `.github/pull_request_template.md`
- `.github/readme/board.png`

Edited:

- `README.md`: two insertions under the title, nothing else.

Nothing else in the repo changes. The invented project the screenshot comes from lives outside
the repo in a temporary directory and is not committed.

## What it grows out of

- `RULEBOOK.md`, "Public repo": issues and PRs come from outside; keep the README true; no
  client data, real paths or `network/` content; screenshots use invented projects; commits in
  the existing voice. `CONTRIBUTING.md` is these rules written for the stranger.
- `docs/00-overview.md`, "Who it is for": "One person at a keyboard, running many Claude Code
  sessions against their own repos, who wants a single surface over the work rather than a
  screenful of terminals. Local-first and single-user by design." The README's one line is
  this paragraph compressed, not a new claim.
- `docs/05-conventions.md` and `tools/README.md`: the working practice `CONTRIBUTING.md`
  points at (fail loud, one concern per commit, measure rather than assert).
- `tools/cdp.mjs`: how the screenshot is taken, with no dependency.
- `src/config.ts`: `SESSION_CONSOLE_HOME` and `SESSION_CONSOLE_PORT`, which let the screenshot
  server run against a throwaway registry on a spare port so Cory's own
  `~/.claude/session-console/projects.json` is never touched.
- `server.ts` line 506: `POST /api/projects` with `{ path, name }` registers a project by path
  and returns its `id`; the board is then at `/?project=<id>` (`web/app.js` line 2).
- `deliverables/CHECKLIST.md`: the shape a tracker must have for the board to show it
  (`## 🔥 Priority`, `## 🚧 In Progress`, `## 📋 Backlog`, `## ✅ ...`, items as `- [ ]`
  bullets with `  - key: value` fields). The fixture copies the shape with invented content.

## Decided by Cory, 2026-10-07

- **The scope split.** This item owns `CONTRIBUTING.md`, `SECURITY.md`, the `.github/`
  templates, the screenshot and the one-liner. The readiness item keeps linter, formatter,
  `.editorconfig`, `.nvmrc`, CI and the re-score; the Electron item keeps the download and the
  statement-led README front page. `CONTRIBUTING.md` and `SECURITY.md` appear in the readiness
  item's text too; this item writes them and that session finds them present.
- **PNG, not GIF.** A GIF needs recording tooling the repo does not have, and decisions M2 says
  no dependencies. `tools/cdp.mjs --shot` already produces a 2x PNG with nothing added. One
  image of the board, since the board over markdown trackers is the claim `POSITIONING.md`
  builds on.
- **Contributions.** Issues and pull requests welcome, reviewed by the owner. `CONTRIBUTING.md`
  says that and states the bar; it does not invent a code of conduct, a CLA, a review SLA or a
  maintainer roster.
- **Security contact.** The owner email on the commits. The session reads it from the repo
  (`git log main -1 --format=%ae`) rather than typing it, so the file and the history agree.

## Assumptions the session proceeds on

Routine calls with an obvious default, reversible in the PR:

- **Image location.** `.github/readme/board.png`. It sits beside the other repo-meta files this
  item creates, stays out of `docs/` (whose numbered slots are governed by the doc standard) and
  out of `web/` (which is served).
- **Templates as markdown, not YAML forms.** Plain `.md` templates with front matter are the
  older GitHub shape, have no schema to get wrong, and match a repo that is plain files
  throughout. Two issue templates (a bug, an idea) and one PR template. No `config.yml`.
- **Where the one line goes.** Directly under `# Maverick`, above the existing first paragraph.
  The existing paragraphs are not rewritten; the statement-led front page belongs to
  `plans/maverick-public-release-2026-10-07.md` and is out of scope here.
- **The acknowledgement window in `SECURITY.md`.** Seven days. A single maintainer can keep it;
  Cory changes the number in review if he wants another.

## Steps, in order

1. **Open the loop.** `bin/session-open --role develop --loop "the public repo reads like one"
   --exit "draft PR open with the seven done-when checks green" --project maverick`. Branch
   from `main`: `oss/public-repo-reads-like-one`.
2. **Read the owner email.** `git log main -1 --format=%ae`. That string is the disclosure
   channel in `SECURITY.md`; nothing is typed by hand.
3. **Write `CONTRIBUTING.md`.** Short, in the README's voice. Sections: run it (`node
   server.ts`, Node 22.18+, nothing to install), test it (`npm test`), the rules (no
   dependencies, no build step, nothing machine-specific, no client data or real paths, lowercase
   plain commits, one concern per commit, fail loud), the contracts (`.ui-design/system.md`,
   `docs/03-decisions.md`, `RULEBOOK.md`), verify by looking (`tools/cdp.mjs`, 6 to 9 seconds
   to settle), and how to send work (issues and pull requests welcome, against `main`, reviewed
   and merged by the owner; an issue first for anything beyond a fix saves both sides a
   rewrite). No em-dashes.
4. **Write the templates.** `bug.md`: what you did, what you saw, what you expected, Node and
   OS versions, the tracker shape if it is a parsing bug. `idea.md`: the problem, not the
   feature; what it would replace; whether it needs a dependency (which is a decision, per
   M2). `pull_request_template.md`: what changed, how it was verified (the command and its
   output), what it deliberately does not touch, and the checkbox "no client data, real paths or
   `network/` content". These mirror the six-section reply shape Maverick already asks of its
   agents (M14) without copying it verbatim.
5. **Build the invented project.** In a temporary directory outside the repo (the session's
   scratchpad), a folder named for an invented product with `deliverables/CHECKLIST.md` in the
   shape above: a `## 🔥 Priority` section with one `###` release group and three or four items
   carrying `created`, `kind` and `size` fields, a `## 🚧 In Progress` item, a `## 📋 Backlog`
   with a handful, a `## ✅` section with two ticked. Invented names only; no path, person,
   client or repo that exists. `git init` and one commit in it, since the board reads
   `git blame` for dates.
6. **Take the screenshot.** Start the server against a throwaway home on a spare port:
   `SESSION_CONSOLE_HOME=<tmp> SESSION_CONSOLE_PORT=8799 node server.ts`. Register the fixture
   with `POST /api/projects` (`{ "path": "<fixture>", "name": "<invented name>" }`) and take
   the returned `id`. Then `node tools/cdp.mjs 'http://localhost:8799/?project=<id>' --shot
   .github/readme/board.png --wait 8000`. Read the PNG back and look at it: the board, the
   invented items, nothing real in the top bar or the picker. Stop the server. The throwaway
   home is deleted with the scratchpad.
7. **Edit the README.** Under `# Maverick`, insert one line: the "Who it is for" paragraph
   from `docs/00-overview.md` compressed to a sentence, then a blank line, then
   `![The board over a project's markdown tracker](.github/readme/board.png)`. Nothing else in
   the file moves.
8. **Write `SECURITY.md`**: the email from step 2 as the channel, what to include, what to
   expect (acknowledgement within seven days, fix in the next release, no bounty), and the
   supported version (the `main` branch; there are no tagged releases yet).
9. **Verify** as listed under "How it proves itself". Commit one concern at a time in the
   repo's voice: `contributing and security, for the stranger`, `issue and pr templates`, `the
   readme says who it is for, and shows the board`.
10. **`/simplify`**, the real multi-agent pass. Fix what it finds. Then push and open a draft PR
    against `main` whose body carries the done-when list ticked, the fixture description, and
    the simplify findings. Do not merge. Do not post about the repo anywhere; that is the item's
    own last line, and the readiness item is still open.
11. **Close the loop.** `bin/session-close` with the PR as the handoff.

## What it must not touch

- `server.ts`, anything in `src/`, `web/`, `test/`, `tools/`, `bin/`. This is a documents item.
- The README beyond the two inserted lines. In particular: the sentence "the one screen Cory
  manages work from", the three mentions of Realtime, and the statement-led rewrite all belong
  to `plans/maverick-public-release-2026-10-07.md`, not here. Leave them.
- The sibling readiness item's deliverables: no linter, formatter, `.editorconfig`, `.nvmrc`,
  CI workflow or re-score. `CONTRIBUTING.md` and `SECURITY.md` appear in both items' text; this
  item writes them, and the readiness session finds them present.
- `docs/`. The one line is lifted from `00-overview.md`, which is not edited.
- Cory's real `~/.claude/session-console/projects.json`. The screenshot server runs against a
  temporary `SESSION_CONSOLE_HOME`.
- GitHub repository settings (the About blurb, private vulnerability reporting). A session has
  no hands there, and the chosen channel is an email, so none is needed.
- The checklist. Ticking the item happens at ship, not in this PR.
- Any public channel. No post, no announcement, no social anything.

## How it proves itself

Run on the branch before the PR is opened, output pasted into the PR body:

```bash
ls CONTRIBUTING.md SECURITY.md .github/ISSUE_TEMPLATE/bug.md .github/ISSUE_TEMPLATE/idea.md .github/pull_request_template.md .github/readme/board.png
grep -n 'board.png' README.md
sed -n '1,6p' README.md
grep -rn 'TODO\|TBD\|placeholder\|example.com' CONTRIBUTING.md SECURITY.md .github/
grep -rn -- '—' CONTRIBUTING.md SECURITY.md .github/
npm test
git diff main --stat
```

Expected: all six files listed; one `board.png` reference in the README; line 3 of the README is
the who-it-is-for sentence; the two `grep -rn` lines return nothing; `npm test` reports the
same pass count as `main`; the diff stat names only the six new files and `README.md`.

The image is checked by eye, twice: by the session reading the PNG back after step 6, and by
Cory in the walkthrough below. GitHub only applies issue and PR templates from the default
branch, so the templates are proven by file presence here and by the first issue or PR opened
after this merges.

## Walkthrough cards

Each card: do the thing, see the thing, mark ✓ or ✗ with a note.

1. **The front door.** Open the PR's `README.md` on GitHub. Under the title, one sentence says
   who this is for, without naming Cory or any real project. Below it, the board renders inline.
   ✓ if the sentence is true of the product today and the image loads.
2. **The picture is clean.** Look at the screenshot at full size. Every project name, item
   title and path in it is invented. No `~/Projects/...`, no Realtime, no client. ✓ if nothing
   in it exists on this machine.
3. **The picture is the product.** The screenshot shows the roadmap board with lanes, a release
   group, item cards with field chips, in Maverick's own orange-over-carbon theme (no
   `maverick.json` in the fixture). ✓ if someone who has never seen Maverick could tell what it
   does from this one image.
4. **Contributing reads like this repo.** Open `CONTRIBUTING.md`. It is short, lowercase in
   voice, and every rule in it is one you recognise from `RULEBOOK.md` or
   `docs/05-conventions.md`. Click every link; each lands on a file. ✓ if nothing in it is new
   policy you did not set.
5. **Security says what you chose.** Open `SECURITY.md`. The disclosure channel is the email on
   your commits, and it matches `git log -1 --format=%ae`. The acknowledgement window is seven
   days. ✓ if you would be comfortable with a stranger acting on it tomorrow.
6. **The templates ask the right questions.** Open the two issue templates and the PR template
   in the PR. The bug template asks for Node and OS versions; the idea template asks about
   dependencies; the PR template asks how it was verified and has the no-client-data checkbox.
   ✓ if you would want every incoming issue and PR to have answered these.
7. **Nothing else moved.** Read the PR's file list. Six new files and `README.md`. The README
   diff is two inserted lines and nothing removed. ✓ if that is all.
8. **Still green, still unposted.** The PR body shows `npm test` output matching `main`, and
   the PR is a draft. Nothing has been posted anywhere about the repo. ✓ if both hold.
