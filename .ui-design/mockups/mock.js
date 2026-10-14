/** Shared by both mockup pages: the bar with the agents on it, the option tabs, and tiny DOM helpers. */
import { lamp } from "../lamp.js";
import { mission } from "./mock-data.js";

export const el = (tag, attrs = {}, ...children) => {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === "class") node.className = v;
    else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v === true ? "" : String(v));
  }
  for (const c of children.flat()) if (c !== null && c !== undefined && c !== false) node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return node;
};
export { lamp };

export const radar = () => {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 16 16");
  svg.setAttribute("class", "radar");
  svg.innerHTML = `<circle class="dial" cx="8" cy="8" r="7"/><path class="trail" d="M8 8L8 1A7 7 0 0 1 14.1 4.5Z"/><line class="arm" x1="8" y1="8" x2="8" y2="1.2"/>`;
  return svg;
};

/** The top bar every page shares, with the agents on it so the mission page can see the sessions. */
export const bar = (crumb) => {
  const tasks = mission.milestones.flatMap((m) => m.tasks);
  const count = (f) => tasks.filter(f).length;
  const needs = mission.questions.length;
  return el("header", { class: "bar" },
    el("a", { href: "../index.html", class: "brand", "aria-label": "Maverick" }, el("span", { class: "wm" }, "Maverick")),
    el("span", { class: "crumb" }, el("b", {}, mission.project), " / ", crumb),
    el("nav", { class: "agents", "aria-label": "Agents" },
      el("a", { href: "#", class: "needs" }, lamp("blocked", "work"), el("span", { class: "n" }, String(needs)), "needs you"),
      el("a", { href: "#" }, lamp("busy", "work"), el("span", { class: "n" }, String(count((t) => t.status === "flying"))), "flying"),
      el("a", { href: "#" }, lamp("busy", "action"), el("span", { class: "n" }, String(count((t) => t.status === "reviewing"))), "RIO in"),
      el("a", { href: "#" }, lamp("done", "work"), el("span", { class: "n" }, String(count((t) => t.status === "passed"))), "passed"),
      el("span", { class: "sweep" }, radar(), `swept ${mission.sweepAgo}s ago`)),
  );
};

/** Option tabs: [key, label, note]. The chosen one rides in the hash so a link lands on it. */
export const options = (root, list) => {
  const pick = (key) => {
    for (const s of root.querySelectorAll("[data-option]")) s.classList.toggle("on", s.dataset.option === key);
    for (const b of root.querySelectorAll(".options button")) b.classList.toggle("active", b.dataset.key === key);
    root.querySelector(".options .note").textContent = list.find(([k]) => k === key)?.[2] ?? "";
    history.replaceState(null, "", `#${key}`);
  };
  const row = el("div", { class: "options" }, el("span", { class: "k" }, "Option"),
    ...list.map(([key, label]) => el("button", { type: "button", "data-key": key, onclick: () => pick(key) }, label)),
    el("span", { class: "note" }));
  root.prepend(row);
  const wanted = location.hash.slice(1);
  pick(list.some(([k]) => k === wanted) ? wanted : list[0][0]);
};

export const verdictLine = (t) => {
  const bits = [];
  if (t.blockers) bits.push(el("span", { class: "b" }, `${t.blockers} BLOCKER`));
  if (t.notes) bits.push(el("span", { class: "nt" }, `${t.notes} NOTE`));
  return bits;
};

/** A findings block with BLOCKER and NOTE lines coloured, the way the fenced block in a brief reads. */
export const findings = (text) => {
  const pre = el("pre");
  for (const line of text.split("\n")) {
    const cls = /^- BLOCKER:/.test(line) ? "b" : /^- NOTE:/.test(line) ? "nt" : null;
    pre.append(cls ? el("span", { class: cls }, line) : line, "\n");
  }
  return pre;
};
