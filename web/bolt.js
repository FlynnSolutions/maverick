// Lightning. A strike is a real channel: a main path built by midpoint displacement (so
// the jaggedness is fractal, not a zigzag), thinner branches peeling off it, three stacked
// strokes (wide blurred glow, mid halo, white-hot core) and a flicker envelope, plus a
// sheet flash of the sky around the origin. Only opacity moves. Nothing under reduced motion.

const reduced = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const NS = "http://www.w3.org/2000/svg";
const rand = (a, b) => a + Math.random() * (b - a);

/** Midpoint displacement between two points; `sway` is the max sideways offset as a fraction of length. */
const channel = (x0, y0, x1, y1, depth = 6, sway = 0.22) => {
  let points = [[x0, y0], [x1, y1]];
  for (let d = 0; d < depth; d += 1) {
    const next = [points[0]];
    for (let i = 1; i < points.length; i += 1) {
      const [ax, ay] = points[i - 1];
      const [bx, by] = points[i];
      const mx = (ax + bx) / 2;
      const my = (ay + by) / 2;
      const len = Math.hypot(bx - ax, by - ay);
      const nx = -(by - ay) / (len || 1);
      const ny = (bx - ax) / (len || 1);
      const off = rand(-1, 1) * len * sway;
      next.push([mx + nx * off, my + ny * off], [bx, by]);
    }
    points = next;
    sway *= 0.62;
  }
  return points;
};

const toPath = (points) => points.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");

/** Branches leave the channel between 20% and 80% of its length, angled 25 to 55 degrees off it, and shorten each generation. */
const branches = (points, generation, out) => {
  if (generation > 2) return;
  const count = generation === 0 ? Math.floor(rand(2, 5)) : Math.floor(rand(0, 2));
  for (let b = 0; b < count; b += 1) {
    const i = Math.floor(points.length * rand(0.2, 0.8));
    const [x, y] = points[i];
    const [px, py] = points[Math.max(0, i - 3)];
    const heading = Math.atan2(y - py, x - px);
    const angle = heading + (Math.random() < 0.5 ? -1 : 1) * (rand(25, 55) * Math.PI) / 180;
    const length = Math.hypot(points[points.length - 1][0] - points[0][0], points[points.length - 1][1] - points[0][1]) * rand(0.18, 0.4);
    const pts = channel(x, y, x + Math.cos(angle) * length, y + Math.sin(angle) * length, 4, 0.2);
    out.push({ points: pts, generation: generation + 1 });
    branches(pts, generation + 1, out);
  }
};

const layer = (d, cls, width, extra = {}) => {
  const path = document.createElementNS(NS, "path");
  path.setAttribute("d", d);
  path.setAttribute("class", cls);
  path.setAttribute("stroke-width", String(width));
  for (const [k, v] of Object.entries(extra)) path.setAttribute(k, v);
  return path;
};

/**
 * Strike an element. The bolt comes from above the viewport (or `from`), finds a point on
 * the element's top edge, and the element glows while the channel is live.
 */
// Strikes are the product, so they ignore the OS reduce-motion setting; only the ambient
// weather respects it.
export const strike = (target, { from } = {}) => {
  if (!target) return;
  const rect = target.getBoundingClientRect();
  const x1 = rect.left + rect.width * rand(0.25, 0.75);
  const y1 = rect.top + 1;
  const x0 = from?.x ?? x1 + rand(-220, 220);
  const y0 = from?.y ?? -40;

  const main = channel(x0, y0, x1, y1);
  const limbs = [];
  branches(main, 0, limbs);

  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("class", "bolt");
  svg.setAttribute("width", String(window.innerWidth));
  svg.setAttribute("height", String(window.innerHeight));
  svg.style.setProperty("--flash-x", `${x0}px`);

  const glow = document.createElementNS(NS, "g");
  glow.setAttribute("class", "bolt-glow");
  const halo = document.createElementNS(NS, "g");
  halo.setAttribute("class", "bolt-halo");
  const core = document.createElementNS(NS, "g");
  core.setAttribute("class", "bolt-core");
  const all = [{ points: main, generation: 0 }, ...limbs];
  for (const { points, generation } of all) {
    const d = toPath(points);
    const w = generation === 0 ? 2.2 : generation === 1 ? 1.2 : 0.7;
    const fade = generation === 0 ? 1 : generation === 1 ? 0.7 : 0.45;
    glow.append(layer(d, "", w * 9, { opacity: String(0.28 * fade) }));
    halo.append(layer(d, "", w * 3.2, { opacity: String(0.7 * fade) }));
    core.append(layer(d, "", w, { opacity: String(fade) }));
  }
  svg.append(glow, halo, core);

  const sheet = document.createElement("div");
  sheet.className = "sky-flash strike-flash";
  sheet.style.setProperty("--flash-x", `${(x0 / window.innerWidth) * 100}%`);
  sheet.style.setProperty("--flash-y", `${Math.max(0, (y0 / window.innerHeight) * 100)}%`);

  document.body.append(sheet, svg);
  target.classList.add("struck");
  window.setTimeout(() => {
    svg.remove();
    sheet.remove();
    target.classList.remove("struck");
  }, 640);
};

/** Distant lightning: a faint sheet somewhere in the upper sky, rarely. */
export const distantLightning = () => {
  if (reduced()) return;
  const sheet = document.createElement("div");
  sheet.className = "sky-flash";
  sheet.style.setProperty("--flash-x", `${rand(10, 90)}%`);
  sheet.style.setProperty("--flash-y", `${rand(-10, 15)}%`);
  document.body.append(sheet);
  window.setTimeout(() => sheet.remove(), 900);
};

export const scheduleWeather = () => {
  const tick = () => {
    if (document.visibilityState === "visible" && Math.random() < 0.5) distantLightning();
    window.setTimeout(tick, 25_000 + Math.random() * 50_000);
  };
  window.setTimeout(tick, 15_000);
};

/* ---------- charge and discharge ---------- */

/** Short arcs leaving the edge of a rect, re-rolled every few frames so they crackle. */
const crackleArcs = (rect, count) => {
  const out = [];
  for (let i = 0; i < count; i += 1) {
    const side = Math.floor(rand(0, 4));
    const x = side === 3 ? rect.left : side === 1 ? rect.right : rand(rect.left, rect.right);
    const y = side === 0 ? rect.top : side === 2 ? rect.bottom : rand(rect.top, rect.bottom);
    const len = rand(8, 26);
    const dx = side === 3 ? -len : side === 1 ? len : rand(-len, len) * 0.4;
    const dy = side === 0 ? -len : side === 2 ? len : rand(-len, len) * 0.4;
    out.push(toPath(channel(x, y, x + dx, y + dy, 3, 0.35)));
  }
  return out;
};

const charging = new Map();

/** Start charging an element: a growing glow plus crackle that intensifies while held. */
export const charge = (target) => {
  if (!target || charging.has(target)) return;
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("class", "crackle");
  svg.setAttribute("width", String(window.innerWidth));
  svg.setAttribute("height", String(window.innerHeight));
  document.body.append(svg);
  target.classList.add("charging");
  const started = performance.now();
  let last = 0;
  const state = { svg, raf: 0 };
  const frame = (now) => {
    if (now - last > 55) {
      last = now;
      const held = now - started;
      const count = Math.min(10, 3 + Math.floor(held / 140));
      const rect = target.getBoundingClientRect();
      svg.replaceChildren();
      for (const d of crackleArcs(rect, count)) {
        svg.append(layer(d, "crackle-glow", 3.5, { opacity: String(rand(0.25, 0.5)) }));
        svg.append(layer(d, "crackle-core", 0.9, { opacity: String(rand(0.6, 1)) }));
      }
    }
    state.raf = requestAnimationFrame(frame);
  };
  state.raf = requestAnimationFrame(frame);
  charging.set(target, state);
};

/** Release: the charge leaves as a burst of radial bolts, or as a full strike for primary actions. */
export const discharge = (target, { strike: full = false } = {}) => {
  const state = charging.get(target);
  if (!state) return;
  cancelAnimationFrame(state.raf);
  state.svg.remove();
  charging.delete(target);
  target.classList.remove("charging");
  if (full) strike(target);
  else burst(target);
};

export const dischargeAll = () => {
  for (const target of [...charging.keys()]) discharge(target, { strike: false });
};

/** Four to seven short bolts leaving the element outward, one quick flicker. */
export const burst = (target) => {
  const rect = target.getBoundingClientRect();
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("class", "bolt burst");
  svg.setAttribute("width", String(window.innerWidth));
  svg.setAttribute("height", String(window.innerHeight));
  const n = Math.floor(rand(4, 8));
  for (let i = 0; i < n; i += 1) {
    const angle = (i / n) * Math.PI * 2 + rand(-0.4, 0.4);
    const r0 = Math.min(rect.width, rect.height) * 0.45;
    const r1 = r0 + rand(28, 70);
    const d = toPath(channel(cx + Math.cos(angle) * r0, cy + Math.sin(angle) * r0, cx + Math.cos(angle) * r1, cy + Math.sin(angle) * r1, 4, 0.3));
    svg.append(layer(d, "burst-glow", 5, { opacity: "0.35" }));
    svg.append(layer(d, "burst-core", 1.1, { opacity: "0.95" }));
  }
  document.body.append(svg);
  target.classList.add("struck");
  window.setTimeout(() => {
    svg.remove();
    target.classList.remove("struck");
  }, 320);
};
