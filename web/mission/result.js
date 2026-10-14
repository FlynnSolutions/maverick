// The mission page's Result: what the mission built, diff first, then what to read before you
// merge it, then the second gate. A module on the shell's contract: mount once, then update()
// patches each block in place, so an open report or an armed close survives the stream.

import { render as renderMarkdown } from "../markdown.js";

const merges = (m) => Object.entries(m.mergeShas ?? {}).map(([repo, sha]) => `${repo} ${sha}`).join(" · ");
const needsWalking = (view, m) => Boolean(view.walk?.[m.n]?.needed);
const walkState = (view, m) => view.walk?.[m.n]?.state ?? "none";
const branchOf = (view) => (view.repos ?? []).map((r) => r.branch).join(", ") || "the mission branch";
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

/* ---------- reading `git diff --stat` ---------- */
/** Its last line: "3 files changed, 120 insertions(+), 4 deletions(-)". Either count is left out when it is zero. */
const totalsOf = (stat) => {
  const last = stat.trim().split("\n").at(-1) ?? "";
  const num = (re) => Number(last.match(re)?.[1] ?? 0);
  return { files: num(/(\d+) files? changed/), plus: num(/(\d+) insertions?\(\+\)/), minus: num(/(\d+) deletions?\(-\)/) };
};
/** A rename is drawn `src/{old => new}/a.ts` or `old => new`; the file is where it went. */
const renamed = (path) => path.replace(/\{[^{}]*? => ([^{}]*)\}/g, "$1").replace(/\/\/+/g, "/").replace(/^.* => /, "");
/** Every line above the last: " path | 12 ++--", or " a.png | Bin 0 -> 12 bytes" for a binary. */
const filesOf = (stat) => stat.trim().split("\n").slice(0, -1).flatMap((line) => {
  const m = line.match(/^\s*(.+?)\s+\|\s+(\d+|Bin)\b/);
  return m ? [{ path: renamed(m[1]), changes: m[2] === "Bin" ? null : Number(m[2]) }] : [];
});
/**
 * Past eight files a task's list stops being read, so it folds to the directories they sit in.
 * git cuts a long path short to `.../tail`, so those fold together under `.../` rather than
 * under a directory that is only the cut-off tail of the real one.
 */
const FOLD_AT = 8;
const rowsOf = (files) => {
  if (files.length <= FOLD_AT) return files.map((f) => ({ path: f.path, files: 1, changes: f.changes }));
  const dirs = new Map();
  for (const f of files) {
    const dir = f.path.startsWith(".../") ? ".../" : f.path.includes("/") ? `${f.path.slice(0, f.path.lastIndexOf("/"))}/` : "./";
    const row = dirs.get(dir) ?? { path: dir, files: 0, changes: 0 };
    row.files += 1;
    row.changes += f.changes ?? 0;
    dirs.set(dir, row);
  }
  return [...dirs.values()];
};

/**
 * A task that merged a sibling into its own branch carries the sibling's files in its diff, so
 * summing the stats counts them twice. `inside` is how that is told from stats alone: every file
 * of the sibling is in the task's stat with the same count of changed lines. A sibling the task
 * merged and then edited further does not match, and is still counted twice.
 */
const inside = (a, b) => a.files.length > 0 && a !== b
  && a.files.every((f) => b.files.some((g) => g.path === f.path && g.changes === f.changes))
  && (b.files.length > a.files.length || b.order > a.order);
const minus = (a, b) => ({ plus: a.plus - b.plus, minus: a.minus - b.minus });

/**
 * What merged: the milestones that landed on the mission branch, and each of their tasks with
 * its stat. `own` is the task's diff less the siblings inside it, and `rows` its files less theirs.
 */
const mergedOf = (view) => {
  const groups = view.milestones.filter((m) => m.merged).map((m) => ({
    m,
    tasks: m.tasks.map((task) => {
      const stat = view.diffstat?.[task.id] ?? "";
      return { task, totals: stat ? totalsOf(stat) : null, files: stat ? filesOf(stat) : [] };
    }),
  }));
  const all = groups.flatMap((g) => g.tasks);
  all.forEach((t, i) => { t.order = i; });
  for (const t of all) {
    const within = all.filter((a) => a.totals && inside(a, t));
    /* Only the outermost: a sibling inside another sibling is already in that one's count. */
    const direct = within.filter((a) => !within.some((b) => inside(a, b)));
    const taken = new Set(within.flatMap((a) => a.files.map((f) => f.path)));
    t.from = direct.map((a) => a.task.title);
    t.fromFiles = taken.size;
    const mine = t.files.filter((f) => !taken.has(f.path));
    t.own = t.totals && { ...direct.reduce((acc, a) => minus(acc, a.totals), t.totals), files: mine.length };
    t.rows = rowsOf(mine);
  }
  return groups;
};

/* ---------- triage: the view's readings in three buckets, each grouped by area ---------- */
/** In the order they are read: what blocks the merge, then the claims nobody checked, then the rest. */
const BUCKETS = [
  { severity: "fix", title: "Fix before merge", none: "nothing to fix before you merge" },
  { severity: "check", title: "Unverified", none: "nothing left unverified" },
  { severity: "ship", title: "Fine to ship", none: "nothing noted as fine to ship" },
];
/** The view's readings arrive grouped by area within each bucket; this only cuts them at each new area. */
const byArea = (readings) => {
  const areas = new Map();
  for (const r of readings) areas.set(r.area, [...(areas.get(r.area) ?? []), r]);
  return [...areas];
};
const rowId = (key) => `rd-${key.replace(/[^a-z0-9-]/gi, "-")}`;
/**
 * Whether a merged-files row draws an area: the file or directory itself, a file inside it, or a
 * folded directory holding it. A plain-name area (`general`, `the sign-in form`) is no path, so
 * it matches no row and is read only in its bucket.
 */
const draws = (path, area) => {
  const p = path.replace(/\/+$/, "");
  return p === area || p.startsWith(`${area}/`) || (path.endsWith("/") && path !== "./" && area.startsWith(path));
};

export const mount = (host, view, ctx) => {
  const { el, btn, fmtTime, actionUrl, LANDS } = ctx;

  const count = el("span", { class: "n" });
  const sum = el("div", { class: "rs-sum" });
  const files = el("ul", { class: "rs-files", "aria-label": "What merged, by task" });
  const readHead = el("h2", {}, "To read before you merge", el("span", { class: "n" }));
  const read = el("div", { class: "rs-read" });
  const walks = el("ul", { class: "rs-walks", "aria-label": "Milestones: walkthroughs and proofs" });
  const gate = el("div", { class: "rs-gate" });
  const root = el("div", { class: "mv-result" }, el("h2", {}, "Result", count), sum, files, readHead, read, walks, gate);
  host.append(root);

  /** Each block is rebuilt only when what it draws changed, so nothing open inside another is lost. */
  const drawn = new Map();
  const patch = (node, key, draw) => {
    const shape = JSON.stringify(key);
    if (drawn.get(node) === shape) return;
    drawn.set(node, shape);
    node.replaceChildren(...draw().filter((n) => n !== null && n !== undefined && n !== false));
  };

  const drawSum = (v, merged) => {
    if (!merged.length) {
      const first = v.milestones[0];
      return [el("p", { class: "rs-pending" }, first
        ? `Nothing has merged yet. When milestone ${first.n}, ${first.title}, lands on ${branchOf(v)}, this shows its diff: the lines added and removed, the files each of its tasks changed, and the tasks merged.`
        : "Nothing has merged yet, and the plan has no milestones.")];
    }
    const tasks = merged.flatMap((g) => g.tasks);
    const t = tasks.reduce((a, { own }) => (own ? { plus: a.plus + own.plus, minus: a.minus + own.minus } : a), { plus: 0, minus: 0 });
    const paths = new Set(tasks.flatMap((x) => x.files.map((f) => f.path)));
    const missing = tasks.filter((x) => !x.totals).length;
    return [
      el("b", {}, `+${t.plus} −${t.minus} · ${plural(paths.size, "file")} · ${plural(tasks.length, "task")} merged`),
      el("span", {}, `on ${branchOf(v)}`),
      missing ? el("span", { class: "rs-warn", title: "a diff git could not give is not drawn as zero" }, `${plural(missing, "task")} without a diff, not counted`) : null,
    ];
  };

  /** A finding's chip on a merged-files row: a link to its row in the buckets, which it unfolds. */
  const fileChip = (r) => el("a", {
    class: `rs-chip ${r.severity}${r.state ? " marked" : ""}`,
    href: `#${rowId(r.key)}`,
    title: `${r.kind}: ${r.headline}`,
    onclick: (e) => { e.preventDefault(); reveal(r.key); },
  }, r.severity);

  const drawFiles = (merged, chipsOf) => merged.flatMap(({ m, tasks }) => [
    el("li", { class: "rs-ms" }, `Milestone ${m.n} · ${m.title}`),
    ...tasks.flatMap(({ task, own, rows, from, fromFiles }) => [
      el("li", { class: "rs-task" },
        el("span", { class: "d", title: task.title }, task.title),
        el("span", { class: "n" }, own ? plural(own.files, "file") : ""),
        own ? el("span", { class: "pm" }, el("b", {}, `+${own.plus}`), " ", el("i", {}, `−${own.minus}`)) : el("span", { class: "pm" }, "no diff recorded")),
      ...rows.map((r) => el("li", { class: "rs-file" },
        el("span", { class: "d" }, el("span", { class: "p", title: r.path }, r.path), ...chipsOf(r.path).map(fileChip)),
        el("span", { class: "n" }, r.files > 1 ? plural(r.files, "file") : ""),
        el("span", { class: "pm" }, r.changes === null ? "binary" : plural(r.changes, "line")))),
      from.length ? el("li", { class: "rs-file rs-from" },
        el("span", { class: "d", title: from.join(", ") }, `and ${plural(fromFiles, "file")} merged in from ${from.join(", ")}, counted there`)) : null,
    ]),
  ]);

  /*
   * The buckets are rebuilt only when the findings themselves change. A mark is painted onto the
   * row it belongs to, so marking one never folds a bucket or a `why` the reader had open, and
   * what was open is remembered across a rebuild too.
   */
  const rows = new Map();
  const opened = new Map();
  const whys = new Set();

  /** A mark is posted and the row waits, disabled, for the view that carries it; a failure is said on the status line and the row goes back to what the view last said. */
  const mark = async (r, state) => {
    const row = rows.get(r.key);
    row.box.disabled = true;
    row.later.disabled = true;
    await ctx.act(`tasks/${r.taskId}/readings`, { key: r.key, state }, state === "read" ? `read: ${r.headline}` : `on the checklist: ${r.headline}`);
    const now = latest.readings?.find((x) => x.key === r.key);
    if (now) paint(now);
  };

  /** Read and later are both final: the route takes no unmark, so a marked row keeps its mark and its controls go quiet. */
  const paint = (r) => {
    const row = rows.get(r.key);
    if (!row) return;
    row.li.classList.toggle("read", r.state === "read");
    row.li.classList.toggle("later", r.state === "later");
    row.box.checked = r.state === "read";
    row.box.disabled = Boolean(r.state);
    row.later.disabled = Boolean(r.state);
    row.slot.replaceChildren(r.state === "later" ? el("span", { class: "rs-onlist" }, "on the checklist") : row.later);
  };

  const drawFinding = (r) => {
    const id = rowId(r.key);
    const box = el("input", { type: "checkbox", "aria-label": `read: ${r.headline}`, onchange: () => mark(r, "read") });
    const later = btn("later", () => mark(r, "later"), "ghost");
    later.setAttribute("aria-label", `later: put "${r.headline}" on the checklist`);
    const slot = el("span", { class: "rs-slot" });
    const detail = el("p", { class: "rs-detail", id: `${id}-why`, hidden: !whys.has(r.key) },
      r.detail || "No detail beyond the headline.", " ", el("span", { class: "t" }, `From ${r.taskTitle}, milestone ${r.milestone}.`));
    const why = btn("why", () => {
      detail.hidden = !detail.hidden;
      why.setAttribute("aria-expanded", String(!detail.hidden));
      if (detail.hidden) whys.delete(r.key);
      else whys.add(r.key);
    }, "ghost");
    why.setAttribute("aria-expanded", String(!detail.hidden));
    why.setAttribute("aria-controls", detail.id);
    const li = el("li", { class: "rs-finding", id, tabindex: "-1" },
      el("span", { class: `rs-chip ${r.severity}`, title: r.kind }, r.severity),
      el("span", { class: "h", title: r.headline }, r.headline),
      why,
      el("label", { class: "rs-rd" }, box, "read"),
      slot,
      detail);
    rows.set(r.key, { li, box, later, slot });
    return li;
  };

  const drawBucket = (b, list) => {
    if (!list.length) return el("div", { class: "rs-bucket rs-empty" }, el("span", { class: "h" }, b.title), el("span", { class: "n" }, "0"), el("span", {}, b.none));
    const bucket = el("details", { class: `rs-bucket ${b.severity}` },
      el("summary", {}, el("span", { class: "h" }, b.title), el("span", { class: "n" }, String(list.length))),
      ...byArea(list).flatMap(([area, found]) => [
        el("h3", { class: "rs-area" }, area),
        el("ul", { class: "rs-findings", "aria-label": `${b.title}, ${area}` }, ...found.map(drawFinding)),
      ]));
    bucket.open = opened.get(b.severity) ?? b === BUCKETS[0];
    bucket.addEventListener("toggle", () => opened.set(b.severity, bucket.open));
    return bucket;
  };

  const drawRead = (readings) => {
    rows.clear();
    return BUCKETS.map((b) => drawBucket(b, readings.filter((r) => r.severity === b.severity)));
  };

  /** A chip on a file row leads here: the bucket unfolds and the row takes focus. */
  const reveal = (key) => {
    const row = rows.get(key);
    if (!row) return;
    const bucket = row.li.closest("details");
    if (bucket) bucket.open = true;
    row.li.scrollIntoView({ block: "center" });
    row.li.focus({ preventScroll: true });
  };

  /** The walk and the proof for each merged milestone, as the review page showed them. */
  const drawWalks = (v) => v.milestones.filter((m) => m.merged).map((m) => el("li", {},
    el("span", { class: "d" }, `Milestone ${m.n} · ${m.title}`),
    el("span", { class: `w${needsWalking(v, m) ? " need" : ""}` }, needsWalking(v, m) ? "not walked" : ({ walked: "walked", waived: "waived" }[walkState(v, m)] ?? "nothing to walk")),
    m.proof ? el("span", { class: `w ${m.proof.ok ? "ok" : "bad"}` }, `proof ${m.proof.ok ? "passed" : "failed"} ${fmtTime(m.proof.at)}`) : el("span", { class: "w" }, v.proofRequired ? "no proof yet" : ""),
    merges(m) ? el("span", { class: "sha" }, `merged as ${merges(m)}`) : null,
    m.proof ? el("details", {}, el("summary", {}, "the proof's last lines"), el("pre", { class: "rs-proof" }, m.proof.output.split("\n").slice(-20).join("\n"))) : null));

  /** The report: fetched when opened, and a failure is said, not shown as a blank. */
  const reportSection = () => {
    const box = el("div", {});
    const details = el("details", { class: "rs-report" }, el("summary", {}, "the report: what a person reads in the morning"),
      el("p", { class: "rs-quiet" }, "Generated from the record, the ledger and the RIOs' own findings, not written by the agent that flew it. ", el("a", { href: actionUrl("report"), target: "_blank" }, "raw markdown")), box);
    details.addEventListener("toggle", async () => {
      if (!details.open || box.childElementCount) return;
      try {
        const r = await fetch(actionUrl("report"));
        if (!r.ok) throw new Error((await r.json().catch(() => ({ error: r.statusText }))).error ?? r.statusText);
        box.replaceChildren(renderMarkdown(await r.text(), { project: ctx.projectId }));
      } catch (err) {
        box.replaceChildren(el("p", { class: "rs-warn" }, `could not load the report: ${err.message}`));
      }
    });
    return details;
  };

  /** The second gate, moved from the review page. Closing lands work, so it asks twice, in the page. */
  const drawGate = (v) => {
    if (v.status !== "review" && v.status !== "closed") return [];
    const tasks = v.milestones.flatMap((m) => m.tasks);
    const passed = tasks.filter((t) => t.status === "passed");
    const unwalked = v.milestones.filter((m) => needsWalking(v, m));
    const ready = v.status === "review" && !unwalked.length;
    const closed = v.status === "closed";
    const repos = v.repos ?? [];
    const byPr = repos.some((r) => r.land === "pr");
    const lands = repos.filter((r) => r.land !== "merge");
    const what = lands.length
      ? `Then, per repo: ${lands.map((r) => `${r.label} ${r.land === "push" ? `pushed to ${r.base}` : `a pull request against ${r.base}`}`).join(", ")}.`
      : "The mission branches are left for the ship.";
    const label = lands.length ? "close it and land the work" : "close the mission and tick its items";
    const acts = el("div", { class: "rs-acts" });
    const arm = () => acts.replaceChildren(
      btn(`yes, ${label}`, () => ctx.act("close", {}, byPr ? "closed; pull requests opened" : "mission closed; its items are ticked"), "primary"),
      btn("not yet", disarm),
      el("span", { class: "rs-quiet" }, "nothing has happened yet"));
    const disarm = () => acts.replaceChildren(
      btn(label, arm, "primary"),
      el("a", { href: `/?project=${encodeURIComponent(ctx.projectId)}&view=workspace` }, "back to the workspace"));
    if (ready) disarm();
    /* Removing a worktree discards whatever was left uncommitted in it, so this asks twice too,
       and says what the server removed rather than what it was asked to. */
    const tidy = el("div", { class: "rs-acts" });
    const tidyArm = () => tidy.replaceChildren(
      btn("yes, remove the worktrees", tidyNow, "primary"),
      btn("not yet", tidyDisarm),
      el("span", { class: "rs-quiet" }, "anything uncommitted in them goes with them; the branches stay"));
    const tidyDisarm = (said, isError) => tidy.replaceChildren(
      btn("take back the worktrees", tidyArm, "ghost"),
      el("span", { class: isError ? "rs-warn" : "rs-quiet" }, typeof said === "string" ? said : "the branches stay; this only clears the directories"));
    const tidyNow = async () => {
      tidy.replaceChildren(el("span", { class: "rs-quiet" }, "removing the worktrees"));
      try {
        /* The gate is not redrawn when a worktree goes, so what was left is read from the latest view. */
        const expected = latest.milestones.flatMap((m) => m.tasks).filter((t) => t.status === "passed" && t.worktree).length;
        const { removed } = await ctx.post(actionUrl("tidy"), {});
        const left = expected - removed.length;
        tidyDisarm(left > 0
          ? `${removed.length} of ${plural(expected, "worktree")} removed; git would not remove the other ${left}`
          : removed.length ? `${plural(removed.length, "worktree")} removed; the branches stay` : "nothing left to remove", left > 0);
      } catch (err) {
        tidyDisarm(err.message, true);
      }
    };
    if (closed) tidyDisarm();
    return [
      el("h2", {}, "Your second and last gate", el("span", { class: "n" }, v.status)),
      el("div", { class: "rs-meta" },
        el("span", {}, `${passed.length} of ${tasks.length} tasks passed`),
        ...repos.map((r) => el("span", { title: `lands against ${r.base}` }, `${r.label} · ${r.branch}`)),
        v.finished ? el("span", {}, `finished ${fmtTime(v.finished)}`) : null),
      el("p", { class: "rs-why" }, closed
        ? (byPr
            ? "Closed. Its items are ticked in the tracker and its pull requests are open below. Maverick has not merged anything and will not: this project's own rules say so."
            : "Closed. Its items are ticked in the tracker and the mission branches are waiting for the ship, which is what merges. Everything below is still here to read.")
        : ready
          ? (byPr
              ? "Every milestone merged onto the mission branch in each repo. Check them out and test them yourself: they are branches, not claims. Closing ticks the tracker and opens one pull request per repo against its base. It stops there. This project forbids a tool merging, so the merge is yours."
              : "Every milestone merged onto the mission branch in each repo. Check them out and test them yourself: they are branches, not claims. Closing ticks each passed item in the tracker and hands the branches on; Maverick does not merge a mission to a base, the ship does.")
          : `Every milestone merged. ${unwalked.length} of them still to walk: a milestone is done when you have been through its walkthrough, not when its RIO said pass. Nothing lands before that.`),
      unwalked.length && !closed ? el("div", { class: "rs-acts" },
        ...unwalked.map((m) => el("a", { href: "#plan" }, `walk milestone ${m.n}`)),
        el("span", { class: "rs-quiet" }, "each walkthrough is under its milestone in the plan")) : null,
      repos.length ? el("ul", { class: "rs-lands", "aria-label": "Where each repo lands" },
        ...repos.map((r) => el("li", { class: r.land }, el("span", { class: "r" }, r.label), el("span", {}, LANDS[r.land]?.(r.base) ?? r.land)))) : null,
      ready ? el("p", { class: "rs-why" }, `Closing ticks ${plural(passed.length, "item")} in the tracker in one commit. ${what}`) : null,
      reportSection(),
      repos.some((r) => r.landed) ? el("div", { class: "rs-meta" }, el("span", {}, "landed:"),
        ...repos.filter((r) => r.landed).map((r) => (r.landed.startsWith("http")
          ? el("a", { href: r.landed, target: "_blank" }, `${r.label} pull request`)
          : el("span", { title: `pushed to ${r.base}` }, `${r.label} · ${r.landed}`)))) : null,
      ready ? acts : null,
      closed ? tidy : null,
    ];
  };

  let latest = view;
  let mergedKey = "";
  let merged = [];
  const update = (v) => {
    latest = v;
    // Reading the stats is the heavy part of an update, and they move only when a diff or a merge does.
    const key = JSON.stringify([v.diffstat, v.milestones.filter((m) => m.merged).map((m) => m.n)]);
    if (key !== mergedKey) {
      mergedKey = key;
      merged = mergedOf(v);
    }
    const readings = v.readings ?? [];
    const chipsOf = (path) => readings.filter((r) => draws(path, r.area));
    const closing = v.status === "review" || v.status === "closed";
    count.textContent = v.status === "closed" ? "closed" : v.status === "review" ? "ready" : merged.length ? "so far" : "not yet";
    patch(sum, [merged.map((g) => g.tasks.map((t) => [t.own, t.files])), v.milestones[0]?.title, branchOf(v)], () => drawSum(v, merged));
    patch(files, merged.map(({ m, tasks }) => [m.n, m.title, tasks.map(({ task, own, rows, from, fromFiles }) => [task.title, own, from, fromFiles,
      rows.map((r) => [r, chipsOf(r.path).map((c) => [c.key, c.severity, c.kind, c.headline, Boolean(c.state)])])])]), () => drawFiles(merged, chipsOf));
    files.hidden = !merged.length;
    const unread = readings.filter((r) => !r.state).length;
    readHead.lastChild.textContent = readings.length ? `${unread} unread · ${readings.length} in all` : "";
    patch(read, readings.map((r) => [r.key, r.severity, r.kind, r.area, r.headline, r.detail, r.taskTitle, r.milestone]), () => drawRead(readings));
    readings.forEach(paint);
    patch(walks, closing ? v.milestones.filter((m) => m.merged).map((m) => [m.n, m.title, v.walk?.[m.n], m.proof, m.mergeShas, v.proofRequired]) : [], () => (closing ? drawWalks(v) : []));
    walks.hidden = !closing;
    patch(gate, closing ? [v.status, v.finished, v.repos, v.walk, v.milestones.flatMap((m) => m.tasks).map((t) => t.status)] : null, () => drawGate(v));
  };
  update(view);
  return { update };
};
