// A long list shown a page at a time, with a find over it: the pattern the command center's
// Archive set (web/command.js), kept here so a second list does not grow a second one. The
// board's lanes use it. The Archive is the next user; it moves over once the open work on it lands.

/** What a find box holds, ready to match: trimmed and lowercase. */
export const query = (words) => words.trim().toLowerCase();

/** True when there is no find, or the text holds it (`q` from `query`). */
export const matches = (text, q) => !q || text.toLowerCase().includes(q);

/** A find box, in the Archive's dress. `onFind(words)` runs once the typing pauses, not on every key. */
export const findBox = ({ label, value = "", onFind, pause = 120 }) => {
  const input = document.createElement("input");
  Object.assign(input, { type: "text", className: "rack-find", placeholder: label, value });
  input.setAttribute("aria-label", label);
  let timer = 0;
  input.addEventListener("input", () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => onFind(input.value), pause);
  });
  return input;
};

/**
 * One paged list's furniture: `show more`, which asks `onMore(shown)` to draw on to the next page
 * (appending, not drawing the list again), the "N of M" line beside it, and the line that says
 * there is nothing to show. `at.shown` is how far it reaches; `tell` keeps the three true after a draw.
 */
export const pager = ({ page, shown = page, onMore, footClass }) => {
  const at = { shown };
  const more = document.createElement("button");
  Object.assign(more, { type: "button", className: "rack-verb", textContent: "show more" });
  more.addEventListener("click", () => {
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
    at, more, said, foot, none,
    /** After a draw: `found` of `total` match the find `q`; `empty` is what to say when none do. */
    tell: ({ found, total, q, empty }) => {
      const shown = Math.min(found, at.shown);
      more.hidden = found <= at.shown;
      said.textContent = !found ? "" : q ? `${shown} of ${found} found` : `${shown} of ${total}`;
      foot.hidden = more.hidden && !said.textContent;
      none.textContent = found ? "" : empty;
      none.hidden = !none.textContent;
    },
  };
};
