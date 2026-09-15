// Top Gun, not thunderstorms. Three effects, all transform/opacity: a jet flyby with a
// contrail across the top of the screen (big actions), a missile launched from an element
// toward the dock (spawning a session), and a spread of flares off an element (a drop that
// committed). Ambient: a distant contrail now and then. Reduce-motion silences the ambient
// only; the actions are the product.

const NS = "http://www.w3.org/2000/svg";
const rand = (a, b) => a + Math.random() * (b - a);
const reduced = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** A small jet silhouette, nose to the right, drawn in a 40x16 box. */
const JET = "M40 8 L30 6 L24 5 L20 5 L8 1 L6 1 L14 5 L6 5 L2 3 L1 3 L3 6.5 L3 9.5 L1 13 L2 13 L6 11 L14 11 L6 15 L8 15 L20 11 L24 11 L30 10 Z";

const svgLayer = (cls) => {
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("class", cls);
  svg.setAttribute("width", String(window.innerWidth));
  svg.setAttribute("height", String(window.innerHeight));
  document.body.append(svg);
  return svg;
};

/** Jet crosses the top of the viewport left to right; the contrail fades behind it. */
export const flyby = ({ y = rand(40, 120), duration = 1400 } = {}) => {
  const svg = svgLayer("fx flyby");
  const w = window.innerWidth;
  const trail = document.createElementNS(NS, "path");
  trail.setAttribute("d", `M-120 ${y + 8} L${w + 120} ${y + 8}`);
  trail.setAttribute("class", "contrail");
  trail.style.strokeDasharray = String(w + 240);
  trail.style.strokeDashoffset = String(w + 240);
  trail.style.setProperty("--dur", `${duration}ms`);
  const jet = document.createElementNS(NS, "g");
  jet.setAttribute("class", "jet");
  const body = document.createElementNS(NS, "path");
  body.setAttribute("d", JET);
  const burner = document.createElementNS(NS, "ellipse");
  burner.setAttribute("class", "burner");
  burner.setAttribute("cx", "-6");
  burner.setAttribute("cy", "8");
  burner.setAttribute("rx", "9");
  burner.setAttribute("ry", "2.5");
  jet.append(burner, body);
  jet.style.setProperty("--y", `${y}px`);
  jet.style.setProperty("--dur", `${duration}ms`);
  svg.append(trail, jet);
  window.setTimeout(() => svg.remove(), duration + 1400);
};

/** Missile from an element to a point (default: the dock, or the bottom centre), trail, then a flash. */
export const missile = (from, to) => {
  if (!from) return;
  const r = from.getBoundingClientRect();
  const dock = document.getElementById("dock");
  const target = to ?? (dock && !dock.hidden ? { x: dock.getBoundingClientRect().left + 40, y: dock.getBoundingClientRect().top + 20 } : { x: window.innerWidth / 2, y: window.innerHeight - 24 });
  const x0 = r.left + r.width * 0.5;
  const y0 = r.top + r.height * 0.5;
  const svg = svgLayer("fx missile-layer");
  const cx = (x0 + target.x) / 2 + rand(-80, 80);
  const cy = Math.min(y0, target.y) - rand(60, 160);
  const d = `M${x0} ${y0} Q${cx} ${cy} ${target.x} ${target.y}`;
  const trail = document.createElementNS(NS, "path");
  trail.setAttribute("d", d);
  trail.setAttribute("class", "missile-trail");
  const path = document.createElementNS(NS, "path");
  path.setAttribute("d", d);
  const length = path.getTotalLength();
  trail.style.strokeDasharray = String(length);
  trail.style.strokeDashoffset = String(length);
  const head = document.createElementNS(NS, "circle");
  head.setAttribute("class", "missile-head");
  head.setAttribute("r", "3");
  svg.append(trail, head);
  const duration = 620;
  const start = performance.now();
  const step = (now) => {
    const t = Math.min(1, (now - start) / duration);
    const e = 1 - Math.pow(1 - t, 3);
    const p = path.getPointAtLength(length * e);
    head.setAttribute("cx", String(p.x));
    head.setAttribute("cy", String(p.y));
    trail.style.strokeDashoffset = String(length * (1 - e));
    if (t < 1) requestAnimationFrame(step);
    else {
      const flash = document.createElementNS(NS, "circle");
      flash.setAttribute("class", "impact");
      flash.setAttribute("cx", String(target.x));
      flash.setAttribute("cy", String(target.y));
      flash.setAttribute("r", "6");
      svg.append(flash);
      window.setTimeout(() => svg.remove(), 520);
    }
  };
  requestAnimationFrame(step);
  from.classList.add("struck");
  window.setTimeout(() => from.classList.remove("struck"), 700);
};

/** Flares eject from the element in a fan and fall, glowing. */
export const flares = (target) => {
  if (!target) return;
  const r = target.getBoundingClientRect();
  const svg = svgLayer("fx flares");
  const n = Math.floor(rand(7, 12));
  for (let i = 0; i < n; i += 1) {
    const dot = document.createElementNS(NS, "circle");
    dot.setAttribute("class", "flare");
    dot.setAttribute("r", String(rand(1.6, 3)));
    const x = r.left + r.width * rand(0.3, 0.7);
    const y = r.top + r.height * 0.5;
    dot.setAttribute("cx", String(x));
    dot.setAttribute("cy", String(y));
    const angle = -Math.PI / 2 + rand(-1.1, 1.1);
    const dist = rand(60, 140);
    dot.style.setProperty("--dx", `${Math.cos(angle) * dist}px`);
    dot.style.setProperty("--dy", `${Math.sin(angle) * dist}px`);
    dot.style.setProperty("--delay", `${rand(0, 90)}ms`);
    svg.append(dot);
  }
  target.classList.add("struck");
  window.setTimeout(() => {
    svg.remove();
    target.classList.remove("struck");
  }, 1000);
};

/** Backwards-compatible name used across the UI for "something big just happened here". */
export const strike = (target) => {
  flares(target);
  flyby({ duration: 1100 });
};

/** A high, slow contrail now and then. */
export const scheduleWeather = () => {
  const tick = () => {
    if (document.visibilityState === "visible" && !reduced() && Math.random() < 0.5) flyby({ y: rand(20, 60), duration: 2600 });
    window.setTimeout(tick, 40_000 + Math.random() * 80_000);
  };
  window.setTimeout(tick, 20_000);
};
