// What an action did, said once and gone, without moving the page: the toast. The rules are the
// design kit's (ui-design feedback.md section 2): one polite live region that is on the page
// before any message, bottom right on a desktop and full width at the bottom of a phone, four
// seconds for one line and longer as it grows, never past ten; an error stays until it is closed,
// and the clock stops while the pointer or the focus is on it or the tab is hidden. At most three
// show on a desktop and one on a phone; the rest wait their turn.

const PHONE = window.matchMedia("(max-width: 600px)");
const queue = [];

// The region is on the page from the moment the module loads, before any message, so a screen
// reader is already listening when the first one lands.
const region = document.createElement("div");
region.className = "toasts";
region.setAttribute("role", "status");
region.setAttribute("aria-live", "polite");
region.setAttribute("aria-atomic", "false");
document.body.append(region);

const lifetime = (msg) => Math.min(10000, 4000 + Math.max(0, msg.length - 60) * 40);

/** Leave the way it came: the class plays the exit, and the node goes once it has had time to. */
const leave = (node) => {
  if (node.classList.contains("leaving")) return;
  node.classList.add("leaving");
  // A timer rather than transitionend: a reduced-motion page or a hidden tab may never fire one.
  window.setTimeout(() => { node.remove(); drain(); }, 200);
};

const show = ({ msg, error }) => {
  const node = document.createElement("div");
  node.className = `toast${error ? " error" : ""}`;
  const said = document.createElement("p");
  said.textContent = msg;
  node.append(said);
  if (error) {
    const close = document.createElement("button");
    close.type = "button";
    close.className = "ghost";
    close.textContent = "close";
    close.setAttribute("aria-label", `close: ${msg}`);
    close.addEventListener("click", () => leave(node));
    node.append(close);
  } else {
    let left = lifetime(msg);
    let started = 0;
    let timer = 0;
    // The pointer, the focus and a hidden tab each hold the clock; it runs only while none does.
    const holders = new Set();
    const hold = (why) => {
      if (!holders.size) { window.clearTimeout(timer); left -= Date.now() - started; }
      holders.add(why);
    };
    const release = (why) => {
      if (!holders.delete(why) || holders.size) return;
      started = Date.now();
      timer = window.setTimeout(go, left);
    };
    const tab = () => (document.hidden ? hold("tab") : release("tab"));
    const go = () => { document.removeEventListener("visibilitychange", tab); leave(node); };
    node.addEventListener("pointerenter", () => hold("pointer"));
    node.addEventListener("pointerleave", () => release("pointer"));
    node.addEventListener("focusin", () => hold("focus"));
    node.addEventListener("focusout", () => release("focus"));
    document.addEventListener("visibilitychange", tab);
    holders.add("start");
    release("start");
  }
  region.prepend(node);
};

const drain = () => {
  const room = PHONE.matches ? 1 : 3;
  while (queue.length && region.querySelectorAll(".toast:not(.leaving)").length < room) show(queue.shift());
};

/** toast(msg, { error }) says it in the page's live region; an error waits to be closed. */
export const toast = (msg, { error = false } = {}) => {
  if (!msg) return;
  queue.push({ msg, error });
  drain();
};
