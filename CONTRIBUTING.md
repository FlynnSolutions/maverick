# Contributing

Maverick is one person's workflow, published. Issues and pull requests are welcome, and the
bar is the one the repo holds itself to: [`RULEBOOK.md`](RULEBOOK.md) is binding, and
[`docs/03-decisions.md`](docs/03-decisions.md) says why things are the way they are. Read both
before proposing a change to how it works.

## Run it

```bash
git clone https://github.com/FlynnSolutions/maverick.git
cd maverick
node server.ts        # http://localhost:8766
```

Node 22.18 or newer. There is no install step: the server and the web client have no
dependencies and no build. The Electron shell under `app/` is the one place with a
`package.json` that installs anything; see [`docs/06-runbook.md`](docs/06-runbook.md).

## Check it

```bash
npm test        # node --test, the parsers and the records
npm run lint    # node --check over every file
```

Both run in CI on every pull request. Anything visual is checked by looking, with the headless
Chrome harness in [`tools/`](tools/README.md), not by asserting from the CSS.

## The rules that will come up in review

- **The markdown trackers are the source of truth.** Maverick keeps no store of its own for
  anything a tracker can hold. Do not add a database.
- **No dependencies in the server or the web client.** A dependency is a decision, recorded in
  `docs/03-decisions.md`, not a convenience.
- **Nothing machine-specific in code.** Paths and ports go through `src/config.ts`.
- **Nothing private in the repo.** No client data, no real project paths. Screenshots and
  fixtures use invented projects.
- **One concern per change.** A drive-by refactor is a separate pull request.
- **Match the file you are in.** Naming, structure, comment density. The diff should read as
  if the same author wrote it.

## Pull requests

Work on a branch and open a pull request against `main`. The template asks for what changed,
how to see it, and the checklist above. `main` takes changes by pull request with CI green;
there is no branch protection rule configured yet, so that is a convention, not a lock.

Commit subjects are lowercase and plain, in the product's own vocabulary ("formations replace
the dock"), not a file list.

## Reporting a security problem

See [`SECURITY.md`](SECURITY.md).
