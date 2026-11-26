// The template page: one workflow template, read-only. The order of the work and who does each
// part, drawn left to right with wires, each for-each a box whose tasks splay and rejoin. A stage
// the template leaves out is not drawn; that it is unverified is said in words, above the flow.
// `?project=&id=` reads a template the project offers, `?project=&id=&mission=` the copy a mission
// pinned when it started.

import { applyProjectTheme, recall } from "./theme.js";
import { jetSvg } from "./jet.js";
import { mountDevBadge } from "./dev-badge.js";
import { cannotOpen as cannotOpenPage } from "./page.js";
import { missionHref } from "./mission-links.js";

const $ = (sel) => document.querySelector(sel);
const el = (tag, attrs = {}, ...children) => {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") node.className = v;
    else node.setAttribute(k, v);
  }
  node.append(...children.filter((c) => c !== null && c !== undefined && c !== false));
  return node;
};
const text = (s) => document.createTextNode(s);
const api = async (path) => {
  const res = await fetch(path);
  const body = await res.json();
  if (!res.ok) throw new Error(body.error ?? `${res.status} on ${path}`);
  return body;
};

const params = new URLSearchParams(location.search);
const projectId = params.get("project");
const templateId = params.get("id");
const missionId = params.get("mission");
const q = (s) => encodeURIComponent(s);

const applyTheme = (theme) => {
  const mode = recall("mv.theme", "");
  if (mode) document.documentElement.setAttribute("data-theme", mode);
  if (!theme || recall("mv.projectTheme", "1") === "0") return;
  applyProjectTheme(document.documentElement.style, theme);
  if (theme.font !== "Chakra Petch") document.head.append(el("link", { rel: "stylesheet", href: `https://fonts.googleapis.com/css2?family=${encodeURIComponent(theme.font).replace(/%20/g, "+")}:wght@500;600;700&display=swap` }));
};

/* ---------- who runs a stage, and in what colour ---------- */

/** Each kind's colour in the legend: the Strike Lead, you, Maverick, an agent, a command. */
const KIND = { interview: "lead", gate: "you", walk: "you", close: "you", preflight: "mav", merge: "mav", land: "mav", agent: "agent", command: "cmd" };
const LEGEND = [["lead", "Strike Lead"], ["you", "you"], ["mav", "Maverick"], ["agent", "an agent"], ["cmd", "a command"]];

/** A slot names a setting in the project's maverick.json; this is what it is called there, without the `Agent`. */
const SLOT = { wingmanAgent: "wingman", rioAgent: "rio", proof: "proof command" };
/** Who runs a stage that names no agent and takes no slot. */
const BY_KIND = { interview: "Strike Lead", gate: "you", walk: "you", close: "you", preflight: "Maverick", merge: "Maverick", land: "per repo", agent: "builder" };

/** The stage's own agent, else its slot's name, else who that kind of stage always is. The summary runs only when asked. */
const whoRuns = (stage) => {
  const who = stage.agent ?? SLOT[stage.slot] ?? BY_KIND[stage.kind] ?? stage.kind;
  return stage.id === "summary" ? `${who}, on demand` : who;
};

const label = (id) => id.charAt(0).toUpperCase() + id.slice(1).replace(/-/g, " ");

/* ---------- the flow, per the editor round's picks 1, 7 and 11 ---------- */

const wire = () => el("span", { class: "wf-wire", "aria-hidden": "true" });

/** A card step: the kind's colour, the name, who runs it, a port on either side. */
const node = (stage) => el("div", { class: `wf-node k-${KIND[stage.kind] ?? "mav"}`, role: "listitem" },
  el("span", { class: "wf-ic", "aria-hidden": "true" }),
  el("span", { class: "wf-nn" }, label(stage.id)),
  el("span", { class: "wf-nw" }, whoRuns(stage)));

/** A row of stages joined by wires, each for-each drawn as its box. */
const row = (stages) => stages.flatMap((s, i) => [i ? wire() : null, s.kind === "for-each" ? fan(s) : node(s)]).filter(Boolean);

/**
 * A for-each is a box headed by what it runs over. Tasks run side by side, so their lane splays
 * from a joint and rejoins at another, with two quieter lanes behind it to say there are several.
 */
const fan = (stage) => {
  const head = `for each ${stage.over === "tasks" ? "task" : "milestone"}`;
  const inner = stage.over === "tasks"
    ? [el("span", { class: "wf-joint", "aria-hidden": "true" }),
      el("div", { class: "wf-splay" },
        el("div", { class: "wf-lane", role: "list", "aria-label": head }, ...row(stage.stages ?? [])),
        ...[1, 2].map(() => el("div", { class: "wf-lane wf-echo", "aria-hidden": "true" }, ...row(stage.stages ?? [])))),
      el("span", { class: "wf-joint", "aria-hidden": "true" })]
    : [el("div", { class: "wf-run", role: "list", "aria-label": head }, ...row(stage.stages ?? []))];
  return el("div", { class: "wf-fan", role: "listitem" }, el("span", { class: "wf-fh" }, head), ...inner);
};

const flow = (w) => el("div", { class: "wf-flow", tabindex: "0", role: "region", "aria-label": "The flow, left to right" },
  el("div", { class: "wf-row", role: "list" }, ...row(w.stages)));

const legend = () => el("p", { class: "wf-legend" }, ...LEGEND.map(([k, l]) => el("span", { class: `k-${k}` }, el("i", { "aria-hidden": "true" }), l)));

/* ---------- the page ---------- */

const list = (items) => (items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`);

/** Only what this template actually leaves out of the three that verify the work, as the server counts them. */
const unverifiedLine = (leftOut) => {
  const out = leftOut.map((id) => (id === "walk" ? "the walk" : id));
  return el("p", { class: "wf-unv" }, el("b", {}, "Unverified."), ` It leaves out ${list(out)}, so a mission it runs stays on its mission branch, and you take the work from there by hand.`);
};

const sourceLine = (choice, pinned) => el("p", { class: "wf-src" },
  choice.source === "built-in" ? `built-in · src/workflows/${choice.id}.json` : `the project's file · .maverick/workflows/${choice.id}.json`,
  pinned ? " · the copy this mission pinned when it started" : null);

const render = (project, choice) => {
  const { mission } = choice;
  const workspace = `/?project=${q(project.id)}&view=workspace`;
  const crumb = el("p", { class: "wf-crumb" },
    el("a", { href: workspace }, project.name), " · ",
    mission ? el("a", { href: missionHref(project.id, mission) }, mission.name) : "Templates",
    ` · ${choice.id}`);
  const w = choice.template;
  const section = $("#template");
  section.removeAttribute("aria-busy");
  section.replaceChildren(...[
    crumb,
    el("h1", {}, choice.name),
    choice.description ? el("p", { class: "wf-desc" }, choice.description) : null,
    w && choice.unverified ? unverifiedLine(choice.leftOut) : null,
    sourceLine(choice, Boolean(mission)),
    ...(w ? [flow(w), legend()] : [el("p", { class: "mv-fail" }, `This template can't be used: ${choice.error ?? "the server sent no template and no reason"}`)]),
  ].filter(Boolean));
  $("#crumb").replaceChildren(text(`${project.name} · Template `), el("b", {}, choice.name));
  document.title = `${choice.name} · Template · ${project.name} · Maverick`;
};

const cannotOpen = (why, href = "/?pick=1", label = "pick a project") => cannotOpenPage($("#page"), "This template cannot be opened", why, href, label);

const boot = async () => {
  void mountDevBadge();
  $("#brand-mark").replaceChildren(jetSvg("jet-glyph mark"));
  if (!projectId || !templateId) return cannotOpen("The link names no project or no template: open a template from its mission's page, which writes both.");
  const project = (await api("/api/projects")).find((p) => p.id === projectId);
  if (!project) return cannotOpen(`There is no project "${projectId}" on this machine; it may have been removed from the registry.`);
  applyTheme(project.theme);
  const workspace = `/?project=${q(projectId)}&view=workspace`;
  $("#crumb").replaceChildren(text(project.name));
  $("#board-link").replaceChildren(text("Workspace"));
  $("#board-link").href = workspace;
  $("#back").href = workspace;
  try {
    // With a mission, the server answers the copy it pinned and the mission's name for the crumb.
    render(project, await api(`/api/workflows/${q(templateId)}?project=${q(projectId)}${missionId ? `&mission=${q(missionId)}` : ""}`));
  } catch (err) {
    cannotOpen(err.message, workspace, "back to the workspace");
  }
};
boot().catch((err) => cannotOpen(`The template could not be read: ${err.message}`));
