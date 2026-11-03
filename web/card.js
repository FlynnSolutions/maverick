// One card for everything the mission page lists: a task, a question, a finding, a summary
// bullet. A 40px head row (lamp or kind glyph, the title, chips on the right) over a body that
// folds: the headline always shows, the detail waits under `why`. Every section built on it reads
// the same, and `update` patches in place so a fold someone opened stays open.

import { icon } from "./icons.js";

/**
 * card({ key, lamp?, kind?, title, chips?: Array<{ text, cls?, href? }>, headline?, detail?,
 *        open? }, ctx): { node, update(spec) }
 *
 * `key` names the card for its owner; the root carries it as `data-key`.
 * `lamp` is `[status, band]` for ctx.lamp; without it the card draws its `kind`'s icon. The root
 *   carries `card-<kind>`, never the bare kind, which the page already uses for other things.
 * `chips` sit right of the title, a link when they carry `href`; `cls` is `fix`, `check` or
 *   `ship` for the three severities, or any other class the page's `.chip` knows.
 * `headline` and `detail` are a string or a Node. Whether the card folds is decided once, by
 *   whether the first spec has a detail; a later spec's detail is put into that fold.
 * `open` is the fold's first state only; after that the fold is the reader's, and `update`
 *   never opens or closes it.
 * `update` compares each part with the one it drew (a Node by identity, a string by value) and
 *   touches only what changed, so the same spec twice is a no-op and keeps the reader's focus.
 * `ctx` is the mission shell's: `el` and `lamp` are what this reads.
 */

/** A finding's card id, the anchor a verdict chip links to, cut to the characters an id survives. */
export const findingId = (key) => `rd-${key.replace(/[^a-z0-9-]/gi, "-")}`;

/** A chip that is a link: the pill (`.chip` and `cls`) inside a `.chip-hit` link sized for a finger. */
export const chipLink = (el, text, cls, attrs = {}) => el("a", { ...attrs, class: "chip-hit" }, el("span", { class: cls ? `chip ${cls}` : "chip" }, text));

/**
 * Long text folded to its opening, faded at the cut, with one button under it that opens and
 * folds it again. `ctx` needs `el` and `btn`; `height` is how much of the opening shows.
 */
export const foldable = ({ el, btn }, node, { more, height }) => {
  node.classList.add("fold-cut", "folded");
  node.style.setProperty("--fold-h", height);
  const toggle = btn(more, () => {
    const folded = node.classList.toggle("folded");
    toggle.textContent = folded ? more : "fold it";
    toggle.setAttribute("aria-expanded", String(!folded));
  }, "ghost fold-toggle");
  toggle.setAttribute("aria-expanded", "false");
  return el("div", { class: "fold-wrap" }, node, toggle);
};

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
  const folds = has(spec.detail);
  let open = folds && Boolean(spec.open);
  const shown = {};

  const mark = el("span", { class: "card-mark" });
  const title = el("span", { class: "card-title" });
  const chips = el("span", { class: "card-chips" });
  const headline = el("div", { class: "card-headline" });
  const detail = el("div", { class: "card-detail", id: `${id}-detail`, hidden: true });
  const node = el("article", { class: "mv-card", "data-key": String(spec.key) });

  /** When the card folds the head is a button, so the whole row is the one control that opens it. */
  const toggle = folds
    ? el("button", { type: "button", class: "card-toggle", "aria-controls": detail.id, onclick: () => fold(!open) }, mark, title, el("span", { class: "card-why" }, "why", el("span", { class: "chev" })))
    : el("div", { class: "card-toggle" }, mark, title);
  node.append(el("div", { class: "card-head" }, toggle, chips), el("div", { class: "card-body" }, headline, detail));

  const fold = (to) => {
    open = to;
    node.classList.toggle("open", open);
    toggle.setAttribute("aria-expanded", String(open));
    detail.hidden = !open;
  };
  if (folds) fold(open);

  /**
   * Each chip is patched where it stands, so a focused chip link keeps its focus through a sweep.
   * A linked chip is the pill inside a 44px link (`chipLink`), so the target is a finger's size
   * and the pill stays the size it reads at.
   */
  const drawChips = (list) => {
    const want = list ?? [];
    const have = [...chips.children];
    want.forEach((c, i) => {
      const tag = c.href ? "a" : "span";
      let slot = have[i];
      if (!slot || slot.tagName.toLowerCase() !== tag) {
        const fresh = c.href ? chipLink(el, c.text, c.cls) : el("span", {});
        if (slot) slot.replaceWith(fresh);
        else chips.append(fresh);
        slot = fresh;
      }
      const chip = c.href ? slot.firstChild : slot;
      chip.className = `chip${c.cls ? ` ${c.cls}` : ""}`;
      chip.textContent = c.text;
      if (c.href) slot.setAttribute("href", c.href);
    });
    for (const extra of have.slice(want.length)) extra.remove();
  };

  const update = (next) => {
    const lampKey = JSON.stringify(next.lamp ?? null);
    if (lampKey !== shown.lamp || next.kind !== shown.kind) {
      mark.replaceChildren(next.lamp ? ctx.lamp(...next.lamp) : icon(next.kind, "card-glyph"));
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
    if (next.headline !== shown.headline) {
      put(headline, next.headline);
      shown.headline = next.headline;
    }
    headline.hidden = !has(next.headline);
    if (folds && next.detail !== shown.detail) {
      put(detail, next.detail);
      shown.detail = next.detail;
    }
  };

  update(spec);
  return { node, update };
};
