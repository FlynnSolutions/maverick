// One card for everything the mission page lists: a task, a question, a finding, a summary
// bullet. A 40px head row (lamp or kind glyph, the title, chips on the right, one optional verb)
// over a body that folds: the headline always shows, the detail waits under `why`. Every section
// built on it reads the same, and `update` patches in place so a fold someone opened stays open.

/**
 * card({ key, lamp?, kind?, title, chips?: Array<{ text, cls?, href? }>, headline?, detail?,
 *        act?: { label, onclick }, open? }, ctx): { node, update(spec) }
 *
 * `key` names the card for its owner; a `kind: "finding"` card carries id `rd-<key>`, the anchor
 *   verdict chips elsewhere link to, cut to the characters an id survives as result.js cuts it.
 * `lamp` is `[status, band]` for ctx.lamp; without it the card draws its `kind` glyph. The root
 *   carries `card-<kind>`, never the bare kind, which the page already uses for other things.
 * `chips` sit right of the title, a link when they carry `href`; `cls` is `fix`, `check` or
 *   `ship` for the three severities, or any other class the page's `.chip` knows.
 * `headline` and `detail` are a string or a Node. Without a detail the card does not fold.
 * `act` is one verb on the head row, beside the chips.
 * `open` is the fold's first state only; after that the fold is the reader's, and `update`
 *   never opens, closes or rebuilds it (a card whose detail goes away loses its fold with it).
 * `ctx` is the mission shell's: `el`, `btn` and `lamp` are what this reads.
 */

const NS = "http://www.w3.org/2000/svg";

/** The kinds' glyphs, drawn in icons.js's hand: one 16px box, stroked in currentColor. */
const GLYPHS = {
  task: ["M3 4.5h10", "M3 8h10", "M3 11.5h6"],
  question: ["M5.6 6a2.4 2.4 0 1 1 3.4 2.2c-.6.3-1 .8-1 1.5v.6", "M8 12.4v.2"],
  decision: ["M3.4 8.4 L6.6 11.4 L12.6 4.6"],
  finding: ["M8 2.8 L13.2 8 L8 13.2 L2.8 8 Z"],
  bullet: ["M5.2 8h5.6"],
};

const glyph = (kind) => {
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", "0 0 16 16");
  svg.setAttribute("class", "card-glyph");
  svg.setAttribute("aria-hidden", "true");
  for (const d of GLYPHS[kind] ?? GLYPHS.bullet) {
    const path = document.createElementNS(NS, "path");
    path.setAttribute("d", d);
    svg.append(path);
  }
  return svg;
};

const findingId = (key) => `rd-${String(key).replace(/[^a-z0-9-]/gi, "-")}`;

/** A string becomes the node's text; a Node replaces what was there; nothing empties it. */
const put = (node, content) => {
  if (content instanceof Node) node.replaceChildren(content);
  else node.textContent = content ?? "";
};

let made = 0;

const has = (content) => content !== undefined && content !== null && content !== "";

export const card = (spec, ctx) => {
  const { el } = ctx;
  const id = `card-${(made += 1)}`;
  let open = has(spec.detail) && Boolean(spec.open);
  let folds = false;
  const shown = {};

  const mark = el("span", { class: "card-mark" });
  const title = el("span", { class: "card-title" });
  const why = el("span", { class: "card-why" }, "why");
  const chips = el("span", { class: "card-chips" });
  const act = el("span", { class: "card-act" });
  const headline = el("div", { class: "card-headline" });
  const detail = el("div", { class: "card-detail", id: `${id}-detail`, hidden: true });
  const node = el("article", { class: "card mv-card", "data-key": String(spec.key) });
  if (spec.kind === "finding") node.id = findingId(spec.key);

  /** When the card folds the head is a button, so the whole row is the one control that opens it. */
  let toggle = el("div", { class: "card-toggle" }, mark, title);
  node.append(el("div", { class: "card-head" }, toggle, chips, act), el("div", { class: "card-body" }, headline, detail));

  const fold = (to) => {
    open = to;
    node.classList.toggle("open", open);
    toggle.setAttribute("aria-expanded", String(open));
    detail.hidden = !open;
  };

  /** A card gains or loses its fold only when it has a detail to fold or stops having one; a closed fold is the only kind swapped. */
  const setFolds = (to) => {
    if (to === folds) return;
    folds = to;
    const next = to
      ? el("button", { type: "button", class: "card-toggle", "aria-controls": detail.id, onclick: () => fold(!open) }, mark, title, why)
      : el("div", { class: "card-toggle" }, mark, title);
    toggle.replaceWith(next);
    toggle = next;
    if (to) fold(open);
    else {
      open = false;
      node.classList.remove("open");
      detail.hidden = true;
    }
  };

  /** Each chip is patched where it stands, so a focused chip link keeps its focus through a sweep. */
  const drawChips = (list) => {
    const want = list ?? [];
    const have = [...chips.children];
    want.forEach((c, i) => {
      const tag = c.href ? "a" : "span";
      let chip = have[i];
      if (!chip || chip.tagName.toLowerCase() !== tag) {
        const fresh = el(tag, {});
        if (chip) chip.replaceWith(fresh);
        else chips.append(fresh);
        chip = fresh;
      }
      chip.className = `chip${c.cls ? ` ${c.cls}` : ""}`;
      chip.textContent = c.text;
      if (c.href) chip.setAttribute("href", c.href);
    });
    for (const extra of have.slice(want.length)) extra.remove();
  };

  /** The verb's button is made once and calls whatever `act` the latest spec carries. */
  const drawAct = (a) => {
    if (!a) return act.replaceChildren();
    if (act.firstChild) act.firstChild.textContent = a.label;
    else act.append(ctx.btn(a.label, (e) => spec.act?.onclick(e), "ghost"));
  };

  /** Only what changed is touched; a Node headline or detail is always put, since it cannot be compared. */
  const update = (next) => {
    if (String(next.key) !== String(spec.key)) throw new Error(`card ${spec.key} cannot take the spec for ${next.key}`);
    spec = next;
    const lampKey = JSON.stringify(next.lamp ?? null);
    if (lampKey !== shown.lamp || next.kind !== shown.kind) {
      mark.replaceChildren(next.lamp ? ctx.lamp(...next.lamp) : glyph(next.kind));
      if (shown.kind) node.classList.remove(`card-${shown.kind}`);
      if (next.kind) node.classList.add(`card-${next.kind}`);
      shown.lamp = lampKey;
      shown.kind = next.kind;
    }
    if (next.title !== shown.title) {
      title.textContent = next.title;
      title.title = next.title;
      shown.title = next.title;
    }
    const chipKey = JSON.stringify(next.chips ?? []);
    if (chipKey !== shown.chips) {
      drawChips(next.chips);
      shown.chips = chipKey;
    }
    drawAct(next.act);
    if (next.headline instanceof Node || next.headline !== shown.headline) {
      put(headline, next.headline);
      shown.headline = next.headline;
    }
    headline.hidden = !has(next.headline);
    if (next.detail instanceof Node || next.detail !== shown.detail) {
      if (has(next.detail)) put(detail, next.detail);
      shown.detail = next.detail;
    }
    setFolds(has(next.detail));
  };

  update(spec);
  return { node, update };
};
