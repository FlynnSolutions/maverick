// Phone review: swipe right to keep, left to remove. A removal is "a match": say why, and
// the item moves to the tracker's Removed section with the reason, in one commit.

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
const api = async (path, init) => {
  const res = await fetch(path, init);
  const body = await res.json();
  if (!res.ok) throw new Error(body.error ?? `${res.status} on ${path}`);
  return body;
};
const post = (path, body) => api(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body ?? {}) });
const escapeHtml = (s) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]);
const renderInline = (md) => escapeHtml(md).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>").replace(/`([^`]+)`/g, "<code>$1</code>").replace(/\[([^\]]+)\]\([^)]*\)/g, "$1");

const LANE_NAMES = { priority: "Roadmap", "in-progress": "In progress", backlog: "Backlog" };
let projectId = new URLSearchParams(location.search).get("project");
let queue = [];
let kept = new Set();
let history = [];

const keptKey = () => `review.kept.${projectId}`;
const loadKept = () => {
  try { kept = new Set(JSON.parse(localStorage.getItem(keptKey()) ?? "[]")); } catch { kept = new Set(); }
};
const saveKept = () => {
  try { localStorage.setItem(keptKey(), JSON.stringify([...kept])); } catch {}
};
const itemKey = (item) => item.firstLine;

const loadQueue = async () => {
  const trackers = await api(`/api/board?project=${encodeURIComponent(projectId)}`);
  queue = [];
  for (const tracker of trackers) {
    for (const section of tracker.sections) {
      if (!section.column || section.column === "shipped") continue;
      for (const group of section.groups) for (const item of group.items) {
        if (item.checked || kept.has(itemKey(item))) continue;
        queue.push({ tracker, section, item });
      }
    }
  }
  render();
};

const cardFor = ({ section, item }, under = false) => {
  const desc = el("div", { class: "desc" });
  desc.innerHTML = renderInline(item.description || "(no description)");
  return el(
    "article",
    { class: `swipe-card${under ? " under" : ""}` },
    el("div", { class: "stamp keep" }, "keep"),
    el("div", { class: "stamp nope" }, "match"),
    el("div", { class: "lane" }, `${LANE_NAMES[section.column] ?? section.heading} · line ${item.start + 1}`),
    el("h2", {}, item.title),
    el("div", { class: "meta" }, ...item.tags.map((t) => el("span", { class: "chip kind" }, t.toLowerCase())), item.fields.due ? el("span", { class: "chip due" }, `due ${item.fields.due}`) : null, item.created ? el("span", { class: "chip size" }, item.created) : null),
    desc,
  );
};

const render = () => {
  const deck = $("#deck");
  deck.querySelectorAll(".swipe-card").forEach((n) => n.remove());
  $("#empty").hidden = queue.length > 0;
  $("#count").textContent = queue.length ? `${queue.length} to review` : "";
  if (queue[1]) deck.append(cardFor(queue[1], true));
  if (queue[0]) {
    const card = cardFor(queue[0]);
    deck.append(card);
    attachSwipe(card);
  }
};

const decide = (dir) => {
  const entry = queue[0];
  if (!entry) return;
  const card = $("#deck .swipe-card:not(.under)");
  if (dir === "keep") {
    fly(card, 1);
    kept.add(itemKey(entry.item));
    saveKept();
    history.push({ entry, action: "keep" });
    queue.shift();
    window.setTimeout(render, 280);
  } else {
    fly(card, -1);
    window.setTimeout(() => openMatch(entry), 260);
  }
};

const fly = (card, dir) => {
  if (!card) return;
  card.classList.add("fly");
  card.style.transform = `translate(${dir * 120}vw, -6vh) rotate(${dir * 18}deg)`;
};

const attachSwipe = (card) => {
  let startX = 0;
  let startY = 0;
  let dx = 0;
  let active = false;
  const keepStamp = card.querySelector(".stamp.keep");
  const nopeStamp = card.querySelector(".stamp.nope");
  card.addEventListener("pointerdown", (e) => {
    active = true;
    startX = e.clientX;
    startY = e.clientY;
    card.setPointerCapture(e.pointerId);
    card.classList.add("dragging");
    card.classList.remove("settle");
  });
  card.addEventListener("pointermove", (e) => {
    if (!active) return;
    dx = e.clientX - startX;
    const dy = e.clientY - startY;
    card.style.transform = `translate(${dx}px, ${dy * 0.3}px) rotate(${dx / 18}deg)`;
    keepStamp.style.opacity = String(Math.min(1, Math.max(0, dx / 90)));
    nopeStamp.style.opacity = String(Math.min(1, Math.max(0, -dx / 90)));
  });
  const release = () => {
    if (!active) return;
    active = false;
    card.classList.remove("dragging");
    if (dx > 110) decide("keep");
    else if (dx < -110) decide("nope");
    else {
      card.classList.add("settle");
      card.style.transform = "";
      keepStamp.style.opacity = "0";
      nopeStamp.style.opacity = "0";
    }
    dx = 0;
  };
  card.addEventListener("pointerup", release);
  card.addEventListener("pointercancel", release);
};

const openMatch = (entry) => {
  $("#match").hidden = false;
  $("#match-title").textContent = entry.item.title;
  $("#reason").value = "";
  $("#reason").focus();
  $("#match-cancel").onclick = () => {
    $("#match").hidden = true;
    render();
  };
  $("#match-send").onclick = async () => {
    const reason = $("#reason").value.trim();
    if (!reason) {
      $("#reason").focus();
      return;
    }
    $("#match-send").disabled = true;
    try {
      await post("/api/remove", { project: projectId, tracker: entry.tracker.index, itemStart: entry.item.start, itemFirstLine: entry.item.firstLine, reason });
      history.push({ entry, action: "remove" });
      $("#match").hidden = true;
      await loadQueue();
    } catch (err) {
      alert(err.message);
      $("#match").hidden = true;
      await loadQueue();
    } finally {
      $("#match-send").disabled = false;
    }
  };
};

$("#keep").addEventListener("click", () => decide("keep"));
$("#nope").addEventListener("click", () => decide("nope"));
$("#undo").addEventListener("click", () => {
  const lastAction = history.pop();
  if (!lastAction) return;
  if (lastAction.action === "keep") {
    kept.delete(itemKey(lastAction.entry.item));
    saveKept();
    queue.unshift(lastAction.entry);
    render();
  } else {
    alert("A removal is already committed to the tracker; restore it from the Removed section on the desktop console.");
  }
});
document.addEventListener("keydown", (e) => {
  if (e.key === "ArrowRight") decide("keep");
  if (e.key === "ArrowLeft") decide("nope");
});

const boot = async () => {
  const projects = await api("/api/projects");
  const select = $("#project");
  select.replaceChildren(...projects.map((p) => el("option", { value: p.id }, p.name)));
  if (!projectId && projects[0]) projectId = projects[0].id;
  select.value = projectId;
  select.addEventListener("change", () => {
    projectId = select.value;
    history.replaceState(null, "", `?project=${encodeURIComponent(projectId)}`);
    loadKept();
    loadQueue();
  });
  loadKept();
  await loadQueue();
};
boot().catch((err) => { $("#count").textContent = err.message; });
