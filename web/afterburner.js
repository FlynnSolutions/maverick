// Top Gun, not thunderstorms. Every effect is transform and opacity only. The jet appears
// when something is happening, never on a timer: a flyby you did not cause is just weather.
// contrail across the top of the screen (big actions), a missile launched from an element
// toward the dock (spawning a session), and a spread of flares off an element (a drop that
// committed). Ambient: a distant contrail now and then. Reduce-motion silences the ambient
// only; the actions are the product.

import { jetPaths } from "./jet.js";

const NS = "http://www.w3.org/2000/svg";
const rand = (a, b) => a + Math.random() * (b - a);
const reduced = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;


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
  const burner = document.createElementNS(NS, "ellipse");
  burner.setAttribute("class", "burner");
  burner.setAttribute("cx", "-7");
  burner.setAttribute("cy", "10");
  burner.setAttribute("rx", "10");
  burner.setAttribute("ry", "2.6");
  jet.append(burner, ...jetPaths());
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

/**
 * A big jet crossing while something loads, looping until you stop it. Replaces the ambient
 * flyby: the jet now only appears when it means something, which is the whole point of it.
 * `stop()` lets the current pass finish rather than cutting it dead.
 */
export const loading = ({ y = 0.42, scale = 3.4, duration = 2200 } = {}) => {
  if (reduced()) return () => {};
  const host = svgLayer("fx loading");
  let live = true;
  let timer = 0;
  const pass = () => {
    if (!host.isConnected) return;
    const py = window.innerHeight * y;
    const jet = document.createElementNS(NS, "g");
    jet.setAttribute("class", "jet big");
    const burner = document.createElementNS(NS, "ellipse");
    burner.setAttribute("class", "burner");
    burner.setAttribute("cx", "-7"); burner.setAttribute("cy", "10");
    burner.setAttribute("rx", "12"); burner.setAttribute("ry", "3");
    jet.append(burner, ...jetPaths());
    jet.style.setProperty("--y", `${py}px`);
    jet.style.setProperty("--dur", `${duration}ms`);
    jet.style.setProperty("--scale", String(scale));
    host.append(jet);
    window.setTimeout(() => jet.remove(), duration + 200);
    timer = window.setTimeout(() => { if (live) pass(); }, duration * 0.82);
  };
  pass();
  return () => {
    live = false;
    window.clearTimeout(timer);
    window.setTimeout(() => host.remove(), duration + 300);
  };
};
