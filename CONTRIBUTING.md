# Contributing

Maverick is one person's workflow, published. Issues and pull requests are welcome, and the
bar is the one the repo holds itself to: [`RULEBOOK.md`](RULEBOOK.md) is binding, and
[`docs/03-decisions.md`](docs/03-decisions.md) says why things are the way they are. Read both
before proposing a change to how it works.

## Run it

As the [README](README.md#get-it) says: `node server.ts`, nothing to install. The Electron
shell under `app/` and the environment are in [`docs/06-runbook.md`](docs/06-runbook.md).

## Check it

```bash
npm test        # node --test, the parsers and the records
npm run lint    # node --check over every file
```

Both run in CI on every pull request. Anything visual is checked by looking, with the headless
Chrome harness in [`tools/`](tools/README.md), not by asserting from the CSS.

## What review looks for

The rules in [`RULEBOOK.md`](RULEBOOK.md) (the trackers are the source of truth, no
dependencies in the server or the client, nothing machine-specific, nothing private), and two
of working practice:

- **One concern per change.** A drive-by refactor is a separate pull request.
- **Match the file you are in.** Naming, structure, comment density. The diff should read as
  if the same author wrote it.

## Pull requests

Work on a branch and open a pull request against `main`. The template asks for what changed,
how to see it, and a short checklist. `main` takes changes by pull request with CI green;
there is no branch protection rule configured yet, so that is a convention, not a lock.

Commit subjects are lowercase and plain, in the product's own vocabulary ("formations replace
the dock"), not a file list.

## Reporting a security problem

See [`SECURITY.md`](SECURITY.md).
