// The breakdown page: every brainstorm down the left with where it stands, the selected one's
// gate on the right. It borrows the mission page's frame because it is the same shape of thing:
// a document a CAG wrote, parsed into what it would do to the board, and one approve.

import { readableOn, recall } from "./theme.js";

const $ = (sel) => document.querySelector(sel);
const el = (tag, attrs = {}, ...children) => {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") node.className = v;
    else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v);
  }
  node.append(...children.filter((c) => c !== null && c !== undefined && c !== false));
  return node;
};
const show = (...nodes) => $("#detail").replaceChildren(...nodes.filter((n) => n !== null && n !== undefined && n !== false));
const btn = (label, onclick, cls = "") => el("button", { type: "button", class: cls, onclick }, label);
const api = async (path, init) => {
  const res = await fetch(path, init);
  const body = await res.json();
  if (!res.ok) throw new Error(body.error ?? `${res.status} on ${path}`);
  return body;
};
const post = (path, body) => api(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body ?? {}) });
const setStatus = (msg, isError = false) => {
  const s = $("#status");
  s.textContent = msg;
  s.classList.toggle("error", isError);
};

const params = new URLSearchParams(location.search);
const projectId = params.get("project");
let selected = params.get("file") ?? null;
let project = null;
let brainstorms = [];

const applyTheme = (theme) => {
  const mode = recall("mv.theme", "");
  if (mode) document.documentElement.setAttribute("data-theme", mode);
  if (!theme || recall("mv.projectTheme", "1") === "0") return;
  const root = document.documentElement.style;
  root.setProperty("--accent", theme.accent);
  root.setProperty("--accent-hot", theme.accentHot);
  root.setProperty("--on-accent", readableOn(theme.accent));
  root.setProperty("--display", `"${theme.font}", "Chakra Petch", "IBM Plex Sans", sans-serif`);
  if (theme.font !== "Chakra Petch") document.head.append(el("link", { rel: "stylesheet", href: `https://fonts.googleapis.com/css2?family=${encodeURIComponent(theme.font).replace(/%20/g, "+")}:wght@500;600;700&display=swap` }));
};

const fileHref = (path) => `/files?project=${encodeURIComponent(projectId)}&path=${encodeURIComponent(path)}`;
const STATE_CLASS = { "not broken down": "pending", proposing: "flying", "proposal waiting": "review", "broken down": "passed" };

let lastPayload = "";
const load = async (force = false) => {
  const body = await fetch(`/api/brainstorms?project=${encodeURIComponent(projectId)}`).then((r) => r.text());
  if (!force && body === lastPayload) return;
  lastPayload = body;
  brainstorms = JSON.parse(body);
  if (!selected || !brainstorms.some((b) => b.file === selected)) selected = brainstorms[0]?.file ?? null;
  renderAll();
};

const act = async (what, body, said) => {
  try {
    setStatus(said);
    const result = await post(`/api/brainstorms/${what}`, { project: projectId, ...body });
    await load(true);
    return result;
  } catch (err) {
    setStatus(err.message, true);
    return null;
  }
};

const renderNav = () => {
  $("#nav").replaceChildren(...brainstorms.map((b, i) => el("button", {
    type: "button",
    class: `nav-step ${STATE_CLASS[b.state]}${b.file === selected ? " selected" : ""}`,
    onclick: () => { selected = b.file; history.replaceState(null, "", `?project=${encodeURIComponent(projectId)}&file=${encodeURIComponent(b.file)}`); renderAll(); },
  }, el("span", { class: "lamp" }), el("span", { class: "n" }, String(i + 1)), el("span", { class: "t", title: b.title }, b.title), el("span", { class: `verdict ${STATE_CLASS[b.state]}` }, b.state))));
};

const itemRow = (it) => el("div", { class: "mv-plan-task" },
  el("h4", {}, it.title, el("span", { class: "mv-repo" }, `${it.kind} · ${it.size} · ${it.call}`)),
  el("p", {}, it.body));

const renderOne = (b) => {
  const parsed = b.parsed;
  const count = (call) => parsed.items.filter((i) => i.call === call).length;
  const gate = [];
  if (b.state === "not broken down") {
    gate.push(el("p", { class: "why" }, "Nothing has been proposed from this brainstorm. A CAG reads it and the board and writes a proposal: items with a kind, a size, and a call of now, backlog or mission. It reads and writes one file; it runs nothing."),
      el("div", { class: "gate-actions" }, btn("propose items", () => act("propose", { file: b.file }, "a CAG is reading the brainstorm"), "primary"), el("a", { class: "button-link", target: "_blank", href: fileHref(b.file) }, "read the brainstorm ↗")));
  } else if (b.state === "proposing") {
    gate.push(el("p", { class: "why" }, "A CAG is reading the brainstorm and the board now. The proposal shows here when it has written it; this page polls."));
  } else if (parsed?.problems?.length) {
    gate.push(el("p", { class: "why" }, "There is a proposal, but it cannot be written to the board as it stands:"),
      el("ul", { class: "mv-problems" }, ...parsed.problems.map((p) => el("li", {}, p))),
      el("div", { class: "gate-actions" }, btn("propose again", () => act("propose", { file: b.file }, "a CAG is reading the brainstorm again"), "primary"), el("a", { class: "button-link", target: "_blank", href: fileHref(b.proposal) }, "read the proposal ↗")));
  } else if (b.state === "proposal waiting") {
    gate.push(el("p", { class: "why" }, `This is the one approval. Approving writes ${count("now")} item${count("now") === 1 ? "" : "s"} onto the roadmap and ${count("backlog")} into the backlog, both under a group named after this brainstorm, in one commit.${count("mission") ? ` ${count("mission")} mission-sized item${count("mission") === 1 ? "" : "s"} open${count("mission") === 1 ? "s" : ""} a Strike Lead interview instead of being written here.` : ""}`),
      el("div", { class: "mv-band" },
        el("div", { class: "cell" }, el("span", { class: "k" }, "onto the roadmap"), el("span", { class: "v" }, String(count("now")))),
        el("div", { class: "cell" }, el("span", { class: "k" }, "into the backlog"), el("span", { class: "v" }, String(count("backlog")))),
        el("div", { class: "cell" }, el("span", { class: "k" }, "to a Strike Lead"), el("span", { class: "v" }, String(count("mission")))),
        el("div", { class: "cell" }, el("span", { class: "k" }, "already on the board"), el("span", { class: "v" }, String(parsed.already.length)))),
      count("now") ? el("p", { class: "cost-note" }, "Roadmap items arrive unplanned, on purpose: no plan file exists yet, and the rule at the door is a field that names a real file. They wear the badge, and \"plan it\" is their next verb.") : null,
      el("div", { class: "gate-actions" },
        btn("approve and write the board", async () => {
          const result = await act("approve", { file: b.file }, "writing the board");
          if (result) setStatus(`committed ${result.commit}${result.missions.length ? ` · ${result.missions.length} mission interview(s) opened on the workspace` : ""}`);
        }, "primary"),
        btn("propose again", () => act("propose", { file: b.file }, "a CAG is reading the brainstorm again"), "ghost"),
        el("a", { class: "button-link", target: "_blank", href: fileHref(b.proposal) }, "read the proposal ↗")));
  } else {
    gate.push(el("p", { class: "why" }, `Broken down on ${b.approved}, committed as ${b.commit}. The proposal below is the frozen artifact of that approval.`),
      el("div", { class: "gate-actions" }, el("a", { class: "button-link", href: `/?project=${encodeURIComponent(projectId)}&view=board` }, "see it on the board"), el("a", { class: "button-link", target: "_blank", href: fileHref(b.proposal) }, "read the proposal ↗")));
  }
  show(
    el("div", { class: "detail-head" }, el("h1", {}, b.title), el("span", { class: `verdict ${STATE_CLASS[b.state]}` }, b.state)),
    el("div", { class: "detail-meta" }, el("span", {}, b.file), b.proposal ? el("span", {}, b.proposal) : null),
    el("section", { class: "panel mv-gate" }, el("h2", {}, "The gate"), ...gate),
    parsed?.items?.length ? el("section", { class: "panel" }, el("h2", {}, "Proposed items", el("span", { class: "spacer" }), el("span", { class: "muted small" }, parsed.intro)), ...parsed.items.map(itemRow)) : null,
    parsed?.already?.length ? el("section", { class: "panel" }, el("h2", {}, "Already on the board"), el("ul", {}, ...parsed.already.map((a) => el("li", {}, a)))) : null,
  );
};

const renderAll = () => {
  $("#crumb").textContent = `${project?.name ?? projectId} · brainstorms`;
  $("#board-link").href = `/?project=${encodeURIComponent(projectId)}&view=workspace`;
  $("#board-link").textContent = "Workspace";
  renderNav();
  const b = brainstorms.find((x) => x.file === selected);
  if (b) renderOne(b);
  else show(el("p", { class: "mv-empty" }, "No brainstorms yet. Sit the CAG down from the Missions rack on the workspace; one conversation writes one dated document under deliverables/brainstorms/."));
};

const boot = async () => {
  if (!projectId) { setStatus("no project in the url", true); return; }
  project = (await api("/api/projects")).find((p) => p.id === projectId) ?? null;
  applyTheme(project?.theme);
  await load(true);
  window.setInterval(() => load().catch(() => {}), 5000);
};
boot().catch((err) => setStatus(err.message, true));
