// Lightning. A strike is drawn as a jagged SVG path from a point above the target down to
// it, revealed by stroke-dashoffset, with a glow on the target. Everything here animates
// only transform, opacity and stroke-dashoffset, and does nothing under reduced motion.

const reduced = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const jaggedPath = (x0, y0, x1, y1, segments = 9, spread = 26) => {
  const points = [[x0, y0]];
  for (let i = 1; i < segments; i += 1) {
    const t = i / segments;
    const x = x0 + (x1 - x0) * t + (Math.random() - 0.5) * spread * (1 - Math.abs(t - 0.5));
    const y = y0 + (y1 - y0) * t + (Math.random() - 0.5) * 6;
    points.push([x, y]);
  }
  points.push([x1, y1]);
  return points.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
};

const forkPath = (path) => {
  // A short branch off a random vertex of the main bolt.
  const vertices = path.split(" ").map((p) => p.slice(1).split(",").map(Number));
  const [x, y] = vertices[Math.max(1, Math.floor(vertices.length * (0.3 + Math.random() * 0.4)))];
  const dir = Math.random() < 0.5 ? -1 : 1;
  return jaggedPath(x, y, x + dir * (30 + Math.random() * 40), y + 40 + Math.random() * 40, 4, 14);
};

/**
 * Strike an element: bolt from above, flash, glow. `from` overrides the origin point
 * (defaults to a point 120 to 220px above the element, jittered sideways).
 */
export const strike = (target, { from } = {}) => {
  if (!target || reduced()) return;
  const rect = target.getBoundingClientRect();
  const x1 = rect.left + rect.width * (0.3 + Math.random() * 0.4);
  const y1 = rect.top + 2;
  const x0 = from?.x ?? x1 + (Math.random() - 0.5) * 160;
  const y0 = from?.y ?? Math.max(0, y1 - 120 - Math.random() * 100);

  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", "bolt");
  svg.setAttribute("width", String(window.innerWidth));
  svg.setAttribute("height", String(window.innerHeight));
  const main = jaggedPath(x0, y0, x1, y1);
  for (const [d, cls] of [[main, "bolt-glow"], [forkPath(main), "bolt-fork"], [main, "bolt-core"]]) {
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", d);
    path.setAttribute("class", cls);
    svg.append(path);
  }
  document.body.append(svg);
  for (const path of svg.querySelectorAll("path")) {
    const length = path.getTotalLength();
    path.style.strokeDasharray = String(length);
    path.style.strokeDashoffset = String(length);
    path.getBoundingClientRect(); // commit the start state before the transition
    path.style.strokeDashoffset = "0";
  }
  target.classList.add("struck");
  window.setTimeout(() => svg.classList.add("fade"), 140);
  window.setTimeout(() => {
    svg.remove();
    target.classList.remove("struck");
  }, 620);
};

/** A distant flash across the whole sky: rare, faint, never on a timer the user notices. */
export const distantLightning = () => {
  if (reduced()) return;
  const sheet = document.createElement("div");
  sheet.className = "sky-flash";
  document.body.append(sheet);
  window.setTimeout(() => sheet.remove(), 700);
};

export const scheduleWeather = () => {
  const tick = () => {
    if (document.visibilityState === "visible" && Math.random() < 0.5) distantLightning();
    window.setTimeout(tick, 25_000 + Math.random() * 50_000);
  };
  window.setTimeout(tick, 15_000);
};
