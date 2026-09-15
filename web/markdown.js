// A small markdown renderer for what sessions write: headings, paragraphs, nested bullet and
// numbered lists, bold, italic, inline code, fenced code, links, rules. File paths become
// links the console can serve. Numbered items under a "for a human" heading become
// checkboxes when a `checks` map is supplied. No HTML passes through.

const escapeHtml = (s) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

const SERVABLE = /\.(html|md|txt)$/;

export const inline = (md, { project } = {}) => {
  let out = escapeHtml(md);
  out = out.replace(/`([^`]+)`/g, (_, code) => {
    const clean = code.replace(/&quot;/g, '"');
    if (project && SERVABLE.test(clean) && !/^https?:/.test(clean) && !clean.includes(" ")) {
      return `<a class="md-file" href="/files?project=${encodeURIComponent(project)}&amp;path=${encodeURIComponent(clean.replace(/^\.\//, ""))}" target="_blank"><code>${clean}</code></a>`;
    }
    return `<code>${code}</code>`;
  });
  out = out.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  out = out.replace(/(^|[\s(])_([^_\n]+)_(?=[\s.,;:)]|$)/g, "$1<em>$2</em>");
  out = out.replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank">$1</a>');
  out = out.replace(/(^|[\s(])(https?:\/\/[^\s)<]+)/g, '$1<a href="$2" target="_blank">$2</a>');
  return out;
};

/**
 * Render a markdown document. `checks` is {key: boolean}; `onCheck(key, text, done)` is called
 * when a checkbox changes. Keys are `<section>:<n>` so they survive re-renders and edits.
 */
export const render = (md, { project, checks = {}, onCheck } = {}) => {
  const root = document.createElement("div");
  root.className = "md";
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  let i = 0;
  let section = "";
  let humanSection = false;
  const container = [root];
  const top = () => container[container.length - 1];

  const flushParagraph = (buf) => {
    if (!buf.length) return;
    const p = document.createElement("p");
    p.innerHTML = inline(buf.join(" "), { project });
    top().append(p);
    buf.length = 0;
  };

  const readList = (indent) => {
    const items = [];
    let ordered = null;
    while (i < lines.length) {
      const m = lines[i].match(/^(\s*)(?:([-*+])|(\d+)[.)])\s+(.*)$/);
      if (!m || m[1].length !== indent) break;
      if (ordered === null) ordered = Boolean(m[3]);
      const item = { text: m[4], children: null, number: m[3] ? Number(m[3]) : null };
      i += 1;
      // continuation lines: deeper indentation without a bullet
      const cont = [];
      while (i < lines.length && lines[i].trim() && !/^\s*(?:[-*+]|\d+[.)])\s+/.test(lines[i]) && (lines[i].match(/^\s*/)[0].length > indent)) {
        cont.push(lines[i].trim());
        i += 1;
      }
      if (cont.length) item.text += ` ${cont.join(" ")}`;
      const next = lines[i]?.match(/^(\s*)(?:[-*+]|\d+[.)])\s+/);
      if (next && next[1].length > indent) item.children = readList(next[1].length);
      items.push(item);
    }
    const list = document.createElement(ordered ? "ol" : "ul");
    items.forEach((item, n) => {
      const li = document.createElement("li");
      const key = `${section}:${item.number ?? n + 1}`;
      if (humanSection && onCheck) {
        const label = document.createElement("label");
        label.className = `md-check${checks[key] ? " done" : ""}`;
        const box = document.createElement("input");
        box.type = "checkbox";
        box.checked = Boolean(checks[key]);
        box.addEventListener("change", () => {
          label.classList.toggle("done", box.checked);
          onCheck(key, item.text.replace(/\*\*/g, "").slice(0, 160), box.checked);
        });
        const span = document.createElement("span");
        span.innerHTML = inline(item.text, { project });
        label.append(box, span);
        li.append(label);
      } else {
        li.innerHTML = inline(item.text, { project });
      }
      if (item.children) li.append(item.children);
      list.append(li);
    });
    return list;
  };

  const paragraph = [];
  while (i < lines.length) {
    const line = lines[i];
    if (line.startsWith("```")) {
      flushParagraph(paragraph);
      const code = [];
      i += 1;
      while (i < lines.length && !lines[i].startsWith("```")) code.push(lines[i++]);
      i += 1;
      const pre = document.createElement("pre");
      pre.textContent = code.join("\n");
      top().append(pre);
      continue;
    }
    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      flushParagraph(paragraph);
      const h = document.createElement(`h${Math.min(6, heading[1].length + 2)}`);
      h.innerHTML = inline(heading[2], { project });
      section = heading[2].toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 40);
      humanSection = /human|for cory|for you|left for/i.test(heading[2]);
      top().append(h);
      i += 1;
      continue;
    }
    if (/^\s*(?:---|\*\*\*)\s*$/.test(line)) {
      flushParagraph(paragraph);
      top().append(document.createElement("hr"));
      i += 1;
      continue;
    }
    const bullet = line.match(/^(\s*)(?:[-*+]|\d+[.)])\s+/);
    if (bullet) {
      flushParagraph(paragraph);
      top().append(readList(bullet[1].length));
      continue;
    }
    if (!line.trim()) {
      flushParagraph(paragraph);
      i += 1;
      continue;
    }
    paragraph.push(line.trim());
    i += 1;
  }
  flushParagraph(paragraph);
  return root;
};
