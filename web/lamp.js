/**
 * The session lamp. A running engine for the states that are just running, and a targeting
 * reticle for the two that want the pilot, so a blocked session can never be mistaken for a
 * busy one at 10px: it is a different shape, not a different colour.
 *
 * The nozzle is drawn off a real afterburner photograph: a serrated petal rim, a banded
 * throat, and an iris whose area opens with heat. Everything reads one custom property,
 * --bloom, from 0 cold to 1 afterburner.
 */
const NS = "http://www.w3.org/2000/svg";
const TAU = Math.PI * 2;
const f = (n) => n.toFixed(2);
const pt = (cx, cy, r, a) => [cx + r * Math.cos(a), cy + r * Math.sin(a)];

const circle = (cx, cy, r) =>
  `M${f(cx - r)} ${f(cy)}a${f(r)} ${f(r)} 0 1 0 ${f(2 * r)} 0a${f(r)} ${f(r)} 0 1 0 ${f(-2 * r)} 0`;

/** Teeth pointing inward. Filled as a star they would be sunbeams; as a ring they are petals. */
const zigzag = (cx, cy, rOut, rIn, teeth) => {
  let d = "";
  for (let i = 0; i < teeth * 2; i += 1) {
    const a = (i / (teeth * 2)) * TAU - Math.PI / 2;
    const [x, y] = pt(cx, cy, i % 2 ? rIn : rOut, a);
    d += `${i ? "L" : "M"}${f(x)} ${f(y)}`;
  }
  return `${d}Z`;
};
const petalRing = (cx, cy, rOut, rIn, teeth) =>
  `${circle(cx, cy, rOut)} ${zigzag(cx, cy, rOut - (rOut - rIn) * 0.1, rIn, teeth)}`;

const brackets = (cx, cy, r, len) => {
  let d = "";
  for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    const x = cx + sx * r, y = cy + sy * r;
    d += `M${f(x)} ${f(y - sy * len)}L${f(x)} ${f(y)}L${f(x - sx * len)} ${f(y)}`;
  }
  return d;
};
const ticks = (cx, cy, r, n, len) => {
  let d = "";
  for (let i = 0; i < n; i += 1) {
    const a = (i / n) * TAU;
    const [x1, y1] = pt(cx, cy, r, a);
    const [x2, y2] = pt(cx, cy, r + len, a);
    d += `M${f(x1)} ${f(y1)}L${f(x2)} ${f(y2)}`;
  }
  return d;
};

const NOZZLE =
  `<circle class="case" cx="16" cy="16" r="13.5"/><circle class="lip" cx="16" cy="16" r="11.8"/>` +
  `<g class="iris"><path class="tooth" fill-rule="evenodd" d="${petalRing(16, 16, 10.4, 8.2, 16)}"/></g>` +
  `<circle class="throat" cx="16" cy="16"/><circle class="band" cx="16" cy="16"/>` +
  `<circle class="core" cx="16" cy="16"/>`;

/** Locked: closed on the target, a filled pip, and a burst of flicker now and then. */
const LOCK =
  `<g class="lock"><path class="ret" d="${brackets(16, 16, 10.6, 4.4)}"/>` +
  `<path class="ret thin" d="M16 4.6L16 8.6M16 27.4L16 23.4M4.6 16L8.6 16M27.4 16L23.4 16"/>` +
  `<circle class="pip" cx="16" cy="16" r="2.9"/></g>`;

/** Acquiring: the brackets hold still and the ring sweeps inside them. */
const ACQUIRE =
  `<g class="acq"><path class="ret" d="${brackets(16, 16, 13.4, 4.6)}"/>` +
  `<g class="sweep"><circle class="ring" cx="16" cy="16" r="8.4"/>` +
  `<path class="ret thin" d="${ticks(16, 16, 8.4, 8, 2.2)}M16 6.2L16 9.4"/></g>` +
  `<circle class="pip hollow" cx="16" cy="16" r="2.2"/></g>`;

const HEAT = { busy: "work", running: "work", shell: "warm", idle: "warm", done: "done", exited: "done", stopped: "done" };
const WANTS_YOU = /^(waiting|blocked)$/;

/**
 * `band` is the rack the strip sits in, which carries what the status alone cannot: a session
 * between turns for under an hour wants you, and one idle for a week is cold.
 */
export const lampMarkup = (status, band) => {
  if (WANTS_YOU.test(status ?? "")) return { cls: "lock", svg: LOCK };
  if (band === "action") return { cls: "acquire", svg: ACQUIRE };
  const heat = band === "stale" ? "cold" : HEAT[status] ?? "warm";
  return { cls: `burn ${heat}`, svg: NOZZLE };
};

/** The lamp as an element, sized by CSS. */
export const lamp = (status, band) => {
  const { cls, svg: markup } = lampMarkup(status, band);
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", "0 0 32 32");
  svg.setAttribute("class", `lamp ${cls} ${status ?? ""}`);
  svg.setAttribute("aria-hidden", "true");
  svg.innerHTML = markup;
  return svg;
};
