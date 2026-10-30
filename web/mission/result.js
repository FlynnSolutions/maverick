// The mission page's Result: what the mission built, diff first, then what to read before you
// merge it, then the second gate. A module on the shell's contract: mount once, then update()
// patches each block in place, so an open report or an armed close survives the stream.

import { render as renderMarkdown } from "../markdown.js";
import { card, chipLink, findingId } from "../card.js";
import { atReview } from "./state.js";

const merges = (m) => Object.entries(m.mergeShas ?? {}).map(([repo, sha]) => `${repo} ${sha}`).join(" · ");
const needsWalking = (view, m) => Boolean(view.walk?.[m.n]?.needed);
const walkState = (view, m) => view.walk?.[m.n]?.state ?? "none";
const branchOf = (view) => [...new Set((view.repos ?? []).map((r) => r.branch))].join(", ") || "the mission branch";

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
  for (const r of readings) {
    const found = areas.get(r.area);
    if (found) found.push(r);
    else areas.set(r.area, [r]);
  }
  return [...areas];
};

/** A summary bullet that asks something of you (fix it first, fix before merge, decide, check) rather than reporting. */
const ASKS = /^(fix first|fix before|decide|check)\b/i;

/* ---------- what I must read: three bullets asked of a read-only session ---------- */
/** How long a post that came back holds the button before its view lands; a post that failed brings no view. */
const HOLD_MS = 2000;
/** The record keeps at most three `- ` lines; a summary with none is the session's raw text, drawn as markdown. */
const bulletsOf = (text) => (text ?? "").split("\n").filter((line) => line.startsWith("- ")).map((line) => line.slice(2).trim());
/** A bullet's title is plain text: the emphasis and code marks a session writes are dropped, not shown. */
const plain = (md) => md.replace(/\*\*(.+?)\*\*/g, "$1").replace(/`([^`]+)`/g, "$1");
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
  const { el, btn, fmtTime, plural, actionUrl, LANDS } = ctx;

  const count = el("span", { class: "n" });
  const mustAt = el("span", { class: "n" });
  const mustBody = el("div", { class: "rs-must-body" });
  const summarizeBtn = btn("summarize", () => summarize());
  const must = el("div", { class: "rs-must", tabindex: "-1" },
    el("h2", {}, "What I must read", mustAt), mustBody, el("div", { class: "rs-acts" }, summarizeBtn));
  const sum = el("div", { class: "rs-sum" });
  const files = el("ul", { class: "rs-files", "aria-label": "What merged, by task" });
  const filesAt = el("span", { class: "n" });
  /* The file tree is the evidence, not the action: it folds under one line and opens on a chip's reveal. */
  const filesFold = el("details", { class: "rs-files-fold" }, el("summary", {}, el("span", { class: "chev" }), "the files, by task", filesAt), files);
  const readHead = el("h2", {}, "To read before you merge", el("span", { class: "n" }));
  // On the page, not a bucket's container: the fix bucket moves between Result and #now at review.
  const hideRead = btn("hide read", () => {
    const on = host.closest(".mv-page").classList.toggle("rs-hide-read");
    hideRead.setAttribute("aria-pressed", String(on));
  }, "ghost rs-tool");
  hideRead.setAttribute("aria-pressed", "false");
  const readTools = el("div", { class: "rs-tools" }, hideRead, el("span", { class: "rs-quiet" }, "Tab reaches each bucket once; j and k move between its findings, x marks the one in focus read"));
  const read = el("div", { class: "rs-read" });
  const walks = el("ul", { class: "rs-walks", "aria-label": "Milestones: walkthroughs and proofs" });
  const gate = el("div", { class: "rs-gate" });
  const mustSlot = el("div", {});
  const root = el("div", { class: "mv-result" }, el("h2", {}, "Result", count), mustSlot, sum, filesFold, readHead, readTools, read, walks, gate);
  host.append(root);
  /**
   * At review the result is the action: what the summary says to fix or decide, and every finding
   * marked fix, go to the top of the page with the walk and the close, and the rest of Result is
   * the evidence under them. The bucket is the same node either way; only where it sits moves.
   */
  const nowFix = el("div", { class: "rs-now-fix" });
  const nowBox = el("section", { class: "rs-now", "aria-label": "Before you merge", hidden: true }, nowFix);
  ctx.now.append(nowBox);
  const atNow = (v) => atReview(v.status);

  /** Each block is rebuilt only when what it draws changed, so nothing open inside another is lost. */
  const drawn = new Map();
  const patch = (node, key, draw) => {
    const shape = JSON.stringify(key);
    if (drawn.get(node) === shape) return;
    drawn.set(node, shape);
    node.replaceChildren(...draw().filter((n) => n !== null && n !== undefined && n !== false));
  };

  const drawMust = (v, state) => {
    const s = v.summary ?? {};
    if (state === "written") {
      const bullets = bulletsOf(s.text);
      if (!bullets.length) return [renderMarkdown(s.text, { project: ctx.projectId })];
      return bullets.map((b, i) => {
        const { node } = card({ key: `must-${i}`, kind: "bullet", title: plain(b) }, ctx);
        node.classList.toggle("rs-asks", ASKS.test(plain(b)));
        return node;
      });
    }
    const [cls, text] = {
      unmerged: ["rs-pending", "Nothing has merged yet. Once a milestone lands, summarize asks a read-only session to read the report and every finding, and write here the three things you must read before you merge."],
      none: ["rs-pending", "Not asked yet. Summarize asks a read-only session to read the report and every finding, and write here the three things you must read before you merge."],
      running: ["rs-pending", `A read-only session is reading the report and the findings, since ${fmtTime(s.started)}.`],
      failed: ["rs-warn", `The summary failed: ${s.failed}`],
    }[state];
    return [el("p", { class: cls }, text)];
  };

  /*
   * The button is one node, relabelled in place, so a reader on it keeps it. A post that came back
   * holds it at `summarizing...` until the view carrying the run lands, or HOLD_MS if none does.
   */
  let holding = false;
  let before;
  const paintMust = (v) => {
    const state = v.summaryState;
    const running = state === "running" || holding;
    summarizeBtn.textContent = running ? "summarizing..." : state === "written" ? "summarize again" : "summarize";
    const off = running || state === "unmerged";
    /* A disabled button drops its focus to the page, so it moves to the block, which can hold it. */
    if (off && document.activeElement === summarizeBtn) must.focus({ preventScroll: true });
    summarizeBtn.disabled = off;
    mustAt.textContent = state === "written" ? `written ${fmtTime(v.summary.at)}` : "";
    patch(mustBody, [state, v.summary], () => drawMust(v, state));
  };
  const summarize = async () => {
    before = latest.summary?.started;
    holding = true;
    paintMust(latest);
    const sent = await ctx.act("summarize", {}, "summarizing: a read-only session is reading the findings");
    // A refused ask holds nothing: the button comes straight back and the toast says why.
    if (!sent) {
      holding = false;
      paintMust(latest);
      return;
    }
    setTimeout(() => {
      if (!holding) return;
      holding = false;
      paintMust(latest);
    }, HOLD_MS);
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

  /** Each finding's chips on the merged-files rows, by its key, so a mark is painted onto them rather than redrawing the block. */
  const chips = new Map();
  /** A finding's chip on a merged-files row: a link to its row in the buckets, which it unfolds. */
  const fileChip = (r) => {
    const link = chipLink(el, r.severity, `${r.severity}${r.state ? " marked" : ""}`, {
      href: `#${findingId(r.key)}`,
      title: `${r.kind}: ${r.headline}`,
      onclick: (e) => { e.preventDefault(); reveal(r.key); },
    });
    const chip = link.firstChild;
    const mine = chips.get(r.key);
    if (mine) mine.push(chip);
    else chips.set(r.key, [chip]);
    return link;
  };

  const drawFiles = (merged, chipsOf) => {
    chips.clear();
    return merged.flatMap(({ m, tasks }) => [
      el("li", { class: "rs-ms" }, `Milestone ${m.n} · ${m.title}`),
      ...tasks.flatMap(({ task, own, rows, from, fromFiles }) => [
        el("li", { class: "rs-task" },
          el("span", { class: "d", title: task.title }, task.title),
          el("span", { class: "n" }, own ? plural(own.files, "file") : ""),
          own ? el("span", { class: "pm" }, el("b", {}, `+${own.plus}`), " ", el("i", {}, `−${own.minus}`)) : el("span", { class: "pm" }, "no diff recorded")),
        ...rows.map((r) => el("li", { class: `rs-file${chipsOf.get(r.path)?.length ? " chipped" : ""}` },
          el("span", { class: "d" }, el("span", { class: "p", title: r.path }, r.path), ...(chipsOf.get(r.path) ?? []).map(fileChip)),
          el("span", { class: "n" }, r.files > 1 ? plural(r.files, "file") : ""),
          el("span", { class: "pm" }, r.changes === null ? "binary" : plural(r.changes, "line")))),
        from.length ? el("li", { class: "rs-file rs-from" },
          el("span", { class: "d", title: from.join(", ") }, `and ${plural(fromFiles, "file")} merged in from ${from.join(", ")}, counted there`)) : null,
      ]),
    ]);
  };

  /*
   * The buckets are rebuilt only when the findings themselves change. A mark is painted onto the
   * card it belongs to, so marking one never folds a bucket or a `why` the reader had open, and
   * what was open is remembered across a rebuild too.
   */
  const rows = new Map();
  const tallies = [];
  const opened = new Map();
  let whys = new Set();

  /**
   * A mark is posted and the card waits, disabled, for the view that carries it; a failure is said
   * in a toast and the card goes back to what the view last said. Read is undone by the same
   * button, which then says "mark unread"; later writes to the checklist and stays.
   */
  const mark = async (r, state) => {
    const row = rows.get(r.key);
    row.box.disabled = true;
    row.later.disabled = true;
    if (state === "later") await ctx.act(`tasks/${r.taskId}/readings`, { key: r.key, state }, `on the checklist: ${r.headline}`);
    else await ctx.act("readings", { byTask: { [r.taskId]: [r.key] }, state }, `${state === "read" ? "read" : "unread again"}: ${r.headline}`);
    /* The controls were quietened here, not by a paint, so the next paint must not skip the card. */
    row.box.disabled = false;
    row.state = undefined;
    const now = latest.readings?.find((x) => x.key === r.key);
    if (now) paint(now);
  };

  /**
   * Read and later are both final: the route takes no unmark, so a marked card keeps its mark and
   * its controls go quiet. A card is painted only when its state moved, so a stream tick never
   * swaps out a `later` button the reader has focused.
   */
  const paint = (r) => {
    const row = rows.get(r.key);
    const state = r.state ?? "";
    if (!row || row.state === state) return;
    row.state = state;
    const focused = row.node.contains(document.activeElement) ? document.activeElement : null;
    const verb = state === "read" ? "mark unread" : "mark read";
    row.node.classList.toggle("rs-seen", state === "read");
    row.box.textContent = verb;
    row.box.setAttribute("aria-label", `${verb}: ${r.headline}`);
    row.box.setAttribute("aria-pressed", String(state === "read"));
    row.box.hidden = state === "later";
    row.later.disabled = false;
    row.slot.replaceChildren(...(state === "later" ? [el("span", { class: "rs-onlist" }, "on the checklist")] : state ? [] : [row.later]));
    for (const chip of chips.get(r.key) ?? []) chip.classList.toggle("marked", Boolean(state));
    if (focused && !focused.isConnected) row.box.focus({ preventScroll: true });
  };

  /**
   * A finding is a card: its severity chip and headline on the head row, the detail folded under
   * `why`, and the `rd-<key>` id the chips that link to it carry. The read box and `later` are
   * two controls where the card has room for one verb, so they sit in a span of this module's at
   * the end of the head row, which the card's update never touches.
   */
  const drawFinding = (r) => {
    const box = btn("mark read", () => mark(r, row().state === "read" ? "unread" : "read"), "ghost rs-mark");
    const row = () => rows.get(r.key);
    const later = btn("later", () => mark(r, "later"), "ghost rs-mark");
    later.setAttribute("aria-label", `later: put "${r.headline}" on the checklist`);
    const slot = el("span", { class: "rs-slot" });
    const { node } = card({
      key: r.key,
      kind: "finding",
      title: r.headline,
      chips: [{ text: r.severity, cls: r.severity }],
      detail: el("span", {}, r.detail || "No detail beyond the headline.", " ", el("span", { class: "t" }, `From ${r.taskTitle}, milestone ${r.milestone}.`)),
      open: whys.has(r.key),
    }, ctx);
    node.id = findingId(r.key);
    node.tabIndex = -1;
    node.querySelector(".card-head").append(el("span", { class: "rs-marks" }, box, slot));
    rows.set(r.key, { node, box, later, slot, state: null, r });
    return node;
  };

  /** Every unread finding in a bucket marked read in one go: one post per task, one toast for the lot. */
  const markAll = async (list, button) => {
    const unread = list.filter((r) => !rows.get(r.key)?.state);
    if (!unread.length) return;
    button.disabled = true;
    const byTask = {};
    for (const r of unread) (byTask[r.taskId] ??= []).push(r.key);
    if (!(await ctx.act("readings", { byTask, state: "read" }, `${plural(unread.length, "finding")} marked read`))) button.disabled = false;
  };

  const drawBucket = (b, list, at) => {
    if (!list.length) return el("div", { class: "rs-bucket rs-empty" }, el("span", { class: "h" }, b.title), el("span", { class: "n" }, "0"), el("span", {}, b.none));
    const all = btn("", () => markAll(list, all), "ghost rs-tool");
    const n = el("span", { class: "n" });
    /* The counts follow the marks in place, so marking one never rebuilds the bucket under the reader. */
    let drawnUnread = -1;
    tallies.push({ paint: () => {
      const unread = list.filter((r) => !rows.get(r.key)?.state).length;
      if (unread === drawnUnread) return;
      drawnUnread = unread;
      n.textContent = unread === list.length ? String(list.length) : `${unread} unread of ${list.length}`;
      all.textContent = `mark all ${unread} read`;
      all.hidden = !unread;
      // The count moved, so the post that held the button has landed.
      all.disabled = false;
    } });
    const bucket = el("details", { class: `rs-bucket ${b.severity}` },
      el("summary", {}, el("span", { class: "chev" }), el("span", { class: "h" }, b.title), n),
      el("div", { class: "rs-tools" }, all),
      ...byArea(list).flatMap(([area, found]) => [
        el("h3", { class: "rs-area" }, area),
        el("div", { class: "rs-findings", role: "group", "aria-label": `${b.title}, ${area}` }, ...found.map(drawFinding)),
      ]));
    pageBucket(bucket, list.length);
    // Fix opens itself where it is the action; everything else waits to be asked.
    bucket.open = opened.get(`${b.severity}:${at}`) ?? (b === BUCKETS[0] && at === "now");
    /*
     * A bucket is one stop on the Tab path, however many findings it holds: only the finding in
     * hand has its buttons in the order, and j and k (or a click) move which one that is. Sixty
     * findings would otherwise be a hundred and eighty presses of Tab to get past.
     */
    const reach = (card, on) => { for (const b of card.querySelectorAll("button")) b.tabIndex = on ? 0 : -1; };
    const cards = bucket.querySelectorAll(".rs-findings > .mv-card");
    cards.forEach((c, i) => reach(c, i === 0));
    let inHand = cards[0];
    bucket.addEventListener("focusin", (e) => {
      const c = e.target.closest?.(".rs-findings > .mv-card");
      if (!c || c === inHand || !bucket.contains(c)) return;
      reach(inHand, false);
      reach(c, true);
      inHand = c;
    });
    bucket.addEventListener("toggle", () => opened.set(`${b.severity}:${at}`, bucket.open));
    return bucket;
  };

  /**
   * A bucket shows its first dozen findings and offers the rest in one press: past that the list is
   * scrolled, not read, and a reader marks the bucket read rather than going card by card.
   */
  const PAGE = 12;
  const pageBucket = (bucket, total) => {
    if (total <= PAGE || shownAll.has(bucket.className)) return;
    const cards = [...bucket.querySelectorAll(".rs-findings > .mv-card")];
    const areas = [...bucket.querySelectorAll(".rs-area")];
    cards.slice(PAGE).forEach((c) => { c.hidden = true; });
    for (const a of areas) a.hidden = ![...a.nextElementSibling.children].some((c) => !c.hidden);
    const more = btn(`show the other ${total - PAGE}`, () => {
      shownAll.add(bucket.className);
      for (const n of [...cards, ...areas]) n.hidden = false;
      more.remove();
      cards[PAGE]?.focus({ preventScroll: true });
    }, "ghost rs-tool");
    bucket.append(el("div", { class: "rs-tools" }, more));
  };
  const shownAll = new Set();

  const drawRead = (readings, now) => {
    /* The fold is the card's; which were open is read off the cards about to go, for the ones that come back. */
    whys = new Set([...rows].filter(([, row]) => row.node.classList.contains("open")).map(([key]) => key));
    rows.clear();
    tallies.length = 0;
    const buckets = BUCKETS.map((b) => drawBucket(b, readings.filter((r) => r.severity === b.severity), now && b === BUCKETS[0] ? "now" : "result"));
    // Fix before merge goes to the top of the page at review, and the rest stay here.
    nowFix.replaceChildren(...(now ? [buckets.shift()] : []));
    return buckets;
  };

  /** j and k walk the findings in page order, x marks the one in focus read; never while typing. */
  document.addEventListener("keydown", (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey || !["j", "k", "x"].includes(e.key)) return;
    if (e.target.closest?.("input, textarea, select, [contenteditable], .term")) return;
    const here = document.activeElement?.closest?.(".rs-findings > .mv-card");
    if (e.key === "x") {
      const row = here && rows.get(here.dataset.key);
      if (!row) return;
      if (!row.state) mark(row.r, "read");
      e.preventDefault();
      return;
    }
    const cards = [...document.querySelectorAll(".rs-findings > .mv-card")].filter((n) => n.offsetParent !== null);
    if (!cards.length) return;
    const at = cards.indexOf(here);
    const next = cards[e.key === "j" ? Math.min(cards.length - 1, at + 1) : Math.max(0, at < 0 ? 0 : at - 1)];
    e.preventDefault();
    next.scrollIntoView({ block: "nearest" });
    next.focus({ preventScroll: true });
  });

  /** A chip on a file row, or one of Progress's through the shell, leads here: the bucket unfolds and the card takes focus. */
  const reveal = (key) => {
    const row = rows.get(key);
    if (!row) return;
    for (let d = row.node.closest("details"); d; d = d.parentElement?.closest("details")) d.open = true;
    row.node.scrollIntoView({ block: "center" });
    row.node.focus({ preventScroll: true });
  };

  /** The walk and the proof for each merged milestone, as the review page showed them. */
  const drawWalks = (v) => v.milestones.filter((m) => m.merged).map((m) => el("li", {},
    el("span", { class: "d" }, `Milestone ${m.n} · ${m.title}`),
    el("span", { class: "w" }, needsWalking(v, m) ? "to walk" : ({ walked: "walked", waived: "waived" }[walkState(v, m)] ?? "nothing to walk")),
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
    /* Armed, the focus waits on "not yet", so a held Enter cannot close; disarmed, it comes back to the close. */
    const arm = () => {
      acts.replaceChildren(
        btn(`yes, ${label}`, () => ctx.act("close", {}, byPr ? "closed; pull requests opened" : "mission closed; its items are ticked"), "primary"),
        btn("not yet", () => disarm(true)),
        el("span", { class: "rs-quiet" }, "nothing has happened yet"));
      acts.querySelector("button:last-of-type").focus();
    };
    const disarm = (refocus) => {
      acts.replaceChildren(
        btn(label, arm, "primary"),
        el("a", { href: `/?project=${encodeURIComponent(ctx.projectId)}&view=workspace` }, "back to the workspace"));
      if (refocus === true) acts.querySelector("button").focus();
    };
    if (ready) disarm();
    /* Removing a worktree discards whatever was left uncommitted in it, so this asks twice too,
       and says what the server removed rather than what it was asked to. */
    const tidy = el("div", { class: "rs-acts" });
    /* Each step puts the focus on the button that replaced the one pressed, never on the page: "not yet" when armed, so a held Enter cannot remove anything. */
    const tidyArm = () => {
      tidy.replaceChildren(
        btn("yes, remove the worktrees", tidyNow, "primary"),
        btn("not yet", () => tidyDisarm()),
        el("span", { class: "rs-quiet" }, "anything uncommitted in them goes with them; the branches stay"));
      tidy.querySelector("button:last-of-type").focus();
    };
    const tidyDisarm = (said, isError) => {
      const back = tidy.contains(document.activeElement) || tidy.querySelector(".rs-quiet:only-child");
      tidy.replaceChildren(
        btn("take back the worktrees", tidyArm, "ghost"),
        el("span", { class: isError ? "rs-fail" : "rs-quiet" }, typeof said === "string" ? said : "the branches stay; this only clears the directories"));
      if (back) tidy.querySelector("button").focus();
    };
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
    const head = el("h2", { id: "close", tabindex: "-1" }, "Your second and last gate", el("span", { class: "n" }, v.status));
    return [
      head,
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
      unwalked.length && !closed ? el("p", { class: "rs-quiet" }, "Each walk is asked ", el("a", { href: "#now" }, "at the top of the page"), ", with how far it has got.") : null,
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
    const chipsOf = new Map(merged.flatMap((g) => g.tasks.flatMap((t) => t.rows.map((r) => [r.path, readings.filter((x) => draws(r.path, x.area))]))));
    const closing = v.status === "review" || v.status === "closed";
    count.textContent = v.status === "closed" ? "closed" : v.status === "review" ? "ready" : merged.length ? "so far" : "not yet";
    if (holding && v.summary?.started !== before) holding = false;
    const now = atNow(v);
    nowBox.hidden = !now;
    if (must.parentElement !== (now ? nowBox : mustSlot)) (now ? nowBox : mustSlot).prepend(must);
    paintMust(v);
    patch(sum, [merged.map((g) => g.tasks.map((t) => [t.own, t.files])), v.milestones[0]?.title, branchOf(v)], () => drawSum(v, merged));
    patch(files, merged.map(({ m, tasks }) => [m.n, m.title, tasks.map(({ task, own, rows, from, fromFiles }) => [task.title, own, from, fromFiles,
      rows.map((r) => [r, (chipsOf.get(r.path) ?? []).map((c) => [c.key, c.severity, c.kind, c.headline])])])]), () => drawFiles(merged, chipsOf));
    filesFold.hidden = !merged.length;
    filesAt.textContent = merged.length ? plural(new Set(merged.flatMap((g) => g.tasks.flatMap((t) => t.files.map((f) => f.path)))).size, "file") : "";
    const unread = readings.filter((r) => !r.state).length;
    readHead.lastChild.textContent = readings.length ? `${unread} unread · ${readings.length} in all` : "";
    patch(read, [now, readings.map((r) => [r.key, r.severity, r.kind, r.area, r.headline, r.detail, r.taskTitle, r.milestone])], () => drawRead(readings, now));
    readTools.hidden = !readings.length;
    readings.forEach(paint);
    for (const t of tallies) t.paint();
    patch(walks, closing ? v.milestones.filter((m) => m.merged).map((m) => [m.n, m.title, v.walk?.[m.n], m.proof, m.mergeShas, v.proofRequired]) : [], () => (closing ? drawWalks(v) : []));
    walks.hidden = !closing;
    patch(gate, closing ? [v.status, v.finished, v.repos, v.walk, v.milestones.flatMap((m) => m.tasks).map((t) => t.status)] : null, () => drawGate(v));
    toClose();
  };

  /** The review question's "close" names `#close`: the gate comes into view with its close button focused, and still asks twice. */
  let scrolledTo = "";
  const toClose = () => {
    const target = location.hash === "#close" ? document.getElementById("close") : null;
    if (!target || scrolledTo === location.hash) return;
    scrolledTo = location.hash;
    requestAnimationFrame(() => {
      target.scrollIntoView({ block: "start" });
      // The close button when the gate is ready; its heading when it is not, so the keyboard lands where the eye does.
      (gate.querySelector(".rs-acts button.primary") ?? target).focus({ preventScroll: true });
    });
  };
  window.addEventListener("hashchange", () => { scrolledTo = ""; toClose(); });
  update(view);
  return { update, reveal };
};
