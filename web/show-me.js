// Takes a person to the evidence behind what they are being asked, shows them what they were sent
// to, and gives them the way back. Works on every press. From flynn-kit's ui-design components,
// dressed from this project's tokens in web/mission/lead.css.

let trip = null;
/** The control last pressed. A jump's own landing can take the focus before the caller asks, so this is what "from" falls back on. */
let pressed = null;
addEventListener("click", (event) => { pressed = event.target.closest?.("button, a") ?? pressed; }, { capture: true });

const arrive = (node) => {
  node?.scrollIntoView({ block: "center", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  node?.focus({ preventScroll: true });
};

const endTrip = () => {
  if (!trip) return;
  trip.target.classList.remove("show-me-target");
  // Left by keyboard, the target still holds the focus; it lets go, so where the focus is sent next sticks.
  if (trip.target.contains(document.activeElement)) document.activeElement.blur();
  trip.pill.remove();
  document.body.classList.remove("show-me-on");
  removeEventListener("keydown", onKey);
  trip = null;
};

const goBack = () => {
  const { from, home } = trip;
  endTrip();
  arrive(home ?? from);
  // The control they pressed, or, when it has gone or was never one, the first thing to act on.
  const again = from?.isConnected && from !== document.body ? from : [...(home?.querySelectorAll("button, a, input") ?? [])].find((node) => node.checkVisibility());
  // After the frame: a key press's own default can move the focus again.
  requestAnimationFrame(() => again?.focus({ preventScroll: true }));
};

const onKey = (event) => {
  if (event.key === "Escape") goBack();
};

/**
 * False when the target cannot be shown, so the caller can say so rather than a press that does
 * nothing. The mark stays until the way back is taken. `home` is what comes back into view, when
 * that is more than the control the person pressed (a whole card).
 */
export const showMe = (target, { from = document.activeElement, home, back = "back" } = {}) => {
  if (!target?.checkVisibility()) return false;
  const origin = trip?.from ?? (from && from !== document.body && !target.contains(from) ? from : pressed);
  const place = trip?.home ?? home;
  endTrip();
  const pill = document.createElement("button");
  pill.type = "button";
  pill.className = "show-me-back";
  pill.textContent = back;
  pill.addEventListener("click", goBack);
  document.body.append(pill);
  // Room under the page's end, so the button is never over the last thing there.
  document.body.classList.add("show-me-on");
  if (!target.hasAttribute("tabindex")) target.setAttribute("tabindex", "-1");
  arrive(target);
  target.classList.add("show-me-target");
  addEventListener("keydown", onKey);
  trip = { target, pill, from: origin, home: place };
  return true;
};
