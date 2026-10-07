// A hosted walkthrough: the document inside the page, its verdicts read live. The document is
// one of the test walkthroughs the skills write (a KEY string, an h2 per pillar, a .tc[data-id]
// per case, answers in localStorage under KEY); the page frames it, counts the answers as they
// are given, and hands each change to the caller to save. The ship and a mission's milestone
// both host one; the gate each hangs on it is theirs.

/** The test walkthrough among a step's documents, the same test the server applies. */
export const WALKTHROUGH_DOC = /deliverables\/testing\/.*walkthrough.*\.html$/;

let timer = null;
let onStorage = null;

/** A page repainting must stop the previous panel's clock and its storage listener, or two of them save over each other. */
export const stopWalkthrough = () => {
  window.clearInterval(timer);
  timer = null;
  if (onStorage) window.removeEventListener("storage", onStorage);
  onStorage = null;
};

/**
 * `el` is the page's own element helper; every page carries one and this module has none.
 * `onSave(summary)` is called with { total, answered, verdicts, key } whenever the answers change.
 */
export const walkthroughPanel = ({ el, fmtTime, url, doc, saved, onSave }) => {
  const bar = el("div", { class: "runway small" }, el("div", { class: "fill", style: "width:0%" }));
  const count = el("span", { class: "mono small muted" }, "reading the document…");
  const pillars = el("div", { class: "pillars" });
  const frame = el("iframe", { class: "doc-frame tall", src: url, title: doc });
  let cases = [];
  let key = null;

  const readState = () => {
    if (!key) return {};
    try { return JSON.parse(localStorage.getItem(key) || "null") ?? {}; } catch { return {}; }
  };
  const paint = () => {
    const state = readState();
    const answered = cases.filter((c) => state[c.id]?.v);
    const pct = cases.length ? (answered.length / cases.length) * 100 : 0;
    bar.firstChild.style.width = `${pct}%`;
    count.textContent = cases.length ? `${answered.length} of ${cases.length} cases answered` : "no cases found in the document";
    const byPillar = new Map();
    for (const c of cases) {
      const p = byPillar.get(c.pillar) ?? { total: 0, done: 0, verdicts: {} };
      p.total += 1;
      const v = state[c.id]?.v;
      if (v) { p.done += 1; p.verdicts[v] = (p.verdicts[v] ?? 0) + 1; }
      byPillar.set(c.pillar, p);
    }
    pillars.replaceChildren(...[...byPillar.entries()].map(([name, p]) => el("div", { class: `pillar${p.done === p.total ? " complete" : ""}` }, el("span", { class: "pname" }, name), el("span", { class: "pcount mono" }, `${p.done}/${p.total}`), el("span", { class: "pverdicts mono small muted" }, Object.entries(p.verdicts).map(([v, n]) => `${v} ${n}`).join(" · ")))));
    return { answered: answered.length, verdicts: Object.fromEntries(answered.map((c) => [c.id, state[c.id].v])) };
  };
  let lastSaved = "";
  const save = async () => {
    const { answered, verdicts } = paint();
    if (!key || !cases.length) return;
    const fingerprint = JSON.stringify(verdicts);
    if (fingerprint === lastSaved) return;
    lastSaved = fingerprint;
    await onSave({ key, total: cases.length, answered, verdicts, updatedAt: new Date().toISOString() });
  };
  frame.addEventListener("load", () => {
    try {
      const d = frame.contentDocument;
      const text = d.documentElement.innerHTML;
      key = text.match(/KEY\s*=\s*"([^"]+)"/)?.[1] ?? null;
      cases = [];
      let pillar = "";
      for (const node of d.querySelectorAll("h2, .tc[data-id]")) {
        if (node.tagName === "H2") pillar = node.textContent.trim();
        else cases.push({ id: node.dataset.id, pillar });
      }
      save();
    } catch (err) {
      count.textContent = `could not read the document: ${err.message}`;
    }
  });
  stopWalkthrough();
  onStorage = save;
  window.addEventListener("storage", onStorage);
  timer = window.setInterval(save, 4000);

  return el("section", { class: "panel walkthrough-panel" },
    el("h2", {}, "Walkthrough", el("span", { class: "spacer" }), count, el("a", { href: url, target: "_blank", class: "mono small" }, "open in its own tab ↗")),
    el("div", { class: "wt-progress" }, bar),
    saved ? el("div", { class: "muted small mono" }, `last saved ${fmtTime(saved.updatedAt)} · ${saved.answered} of ${saved.total}`) : null,
    pillars,
    frame);
};
