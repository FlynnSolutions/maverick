# maverick — how this repo conforms

Follows **DOC_STANDARD** (the shared doc standard; pin a version here). This file is the per-repo anchor: it maps the standard's slots to where this repo's docs live, and records repo-specific layout/ownership.

## Slot map

| Slot | Lives at | Owner |
|------|----------|-------|
| Overview | `docs/00-overview.md` | `claude` |
| Architecture | `docs/01-architecture.md` | `claude` |
| Data Model | `docs/02-data-model.md` | `claude` |
| Decisions | `docs/03-decisions.md` | `claude` |
| Status | `docs/04-status.md` | `auto` |
| Conventions | `docs/05-conventions.md` | `claude` |
| Runbook | `docs/06-runbook.md` | `claude` |
| Glossary | `docs/07-glossary.md` | `claude` |
| Index | `docs/INDEX.md` | `claude` |

## Repo specifics

**Owner:** Flynn Solutions. Public, MIT. Single-user, local-first.

**Layout.** Slots live in `docs/`. Two documents sit beside them without being slots:
`docs/POSITIONING.md` (what this is and is not, against the field) and the repo-root
`README.md`, which is the front door and is deliberately fuller than `00-overview.md` because
it is what a stranger reads first.

**Divergences from the defaults:**

- `04-status.md` is owned `auto` by the standard, but **no generator exists here yet**. It is
  hand-written and dated until one does. Treated as a known debt, not as conformance.
- There is no `deliverables/` engagement structure. Maverick has no client work; its single
  tracker is `deliverables/CHECKLIST.md` and that is all that directory holds.
- The UI contract `.ui-design/system.md` is binding and is **not** a slot. It predates this
  onboarding and stays where the UI work expects to find it; `05-conventions.md` points at it
  rather than absorbing it.

**Gate.** `check.py` from the doc standard, run against this repo. Not yet installed as a
pre-commit hook here.
