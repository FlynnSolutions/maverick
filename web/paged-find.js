// A long list shown a page at a time, with a find over it: the pattern the command center's
// Archive set (web/command.js), kept here so a second list does not grow a second one. The
// board's lanes use it. The Archive is the next user; it moves over once the open work on it lands.
import { icon } from "./icons.js";

/** What a find box holds, ready to match: trimmed and lowercase. */
export const query = (words) => words.trim().toLowerCase();

/** True when there is no find, or the text holds it (`q` from `query`). */
export const matches = (text, q) => !q || text.toLowerCase().includes(q);

const button = (className, text, onclick) => {
  const b = document.createElement("button");
  Object.assign(b, { type: "button", className });
  b.append(text);
  b.addEventListener("click", onclick);
  return b;
};

/**
 * A find box, in the Archive's dress, with its way out: a clear control beside the field, live while it holds
 * something, and Escape in the field. `onFind(words)` runs once the typing pauses, and at once on a clear.
 * Gives `{ node, input, clear }`; `clear()` empties it and puts the focus back in the field.
 */
export const findBox = ({ label, value = "", onFind, pause = 120 }) => {
  const input = document.createElement("input");
  Object.assign(input, { type: "text", className: "rack-find", placeholder: label, value });
  input.setAttribute("aria-label", label);
  const out = button("ghost icon-btn find-clear", icon("close"), () => clear());
  out.setAttribute("aria-label", "clear the find");
  out.title = "clear the find (Esc)";
  const node = document.createElement("div");
  node.className = "find-box";
  node.append(input, out);
  let timer = 0;
  const said = () => { out.disabled = !input.value; };
  const clear = () => {
    window.clearTimeout(timer);
    input.value = "";
    said();
    onFind("");
    input.focus();
  };
  input.addEventListener("input", () => {
    said();
    window.clearTimeout(timer);
    timer = window.setTimeout(() => onFind(input.value), pause);
  });
  input.addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || !input.value) return;
    e.preventDefault();
    clear();
  });
  said();
  return { node, input, clear };
};

/**
 * One paged list's furniture: `show more`, which asks `onMore(shown)` to draw on to the next page
 * (appending, not drawing the list again), the line beside it saying how many are on show, and the
 * line that says there is nothing to show, with the way out of a find that matched nothing.
 * `at.shown` is how far it reaches; `tell` keeps them true after a draw. The foot shows only while
 * there is more to show.
 */
export const pager = ({ page, shown = page, onMore, footClass }) => {
  const at = { shown };
  const more = button("rack-verb", "show more", () => {
    at.shown += page;
    onMore(at.shown);
  });
  const said = document.createElement("span");
  said.className = "muted small";
  said.setAttribute("role", "status");
  const foot = document.createElement("div");
  foot.className = footClass;
  foot.append(more, said);
  const none = document.createElement("p");
  return {
    at, foot, none,
    /** After a draw: `found` match; `empty` is what to say when none do, and `clear`, when given, offers the way out of the find. */
    tell: ({ found, empty, clear = null }) => {
      more.hidden = found <= at.shown;
      said.textContent = more.hidden ? "" : `${at.shown} shown`;
      foot.hidden = more.hidden;
      none.replaceChildren(...(found ? [] : [empty, ...(clear ? [" ", button("rack-verb", "clear the find", clear)] : [])]));
      none.hidden = Boolean(found);
    },
  };
};
