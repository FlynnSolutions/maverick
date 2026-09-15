// Claude usage, as a provider widget. Everything Claude-specific about limits lives here so an
// OpenAI provider can sit beside it with the same shape: `mount(root, ctx)` renders the baby
// widget; clicking it opens the full panel. Data comes from the transcripts Claude Code keeps
// (`/api/usage`), so it is what was consumed. Anthropic does not expose the plan's quota
// locally, so the limits are what you enter once, and until then the meters read against your
// highest window so far.

const el = (tag, attrs = {}, ...children) => {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v === true ? "" : String(v));
  }
  for (const c of children.flat()) if (c !== null && c !== undefined) node.append(typeof c === "string" ? document.createTextNode(c) : c);
  return node;
};

export const provider = { id: "claude", name: "Claude" };

/** Model ids collapse to the families a plan meters: Fable, Opus, Sonnet, Haiku. */
export const familyOf = (model) => {
  if (!model || model.startsWith("<")) return null;
  const m = /claude-(fable|opus|sonnet|haiku)/.exec(model);
  return m ? m[1] : "other";
};
export const FAMILIES = ["fable", "opus", "sonnet", "haiku", "other"];
const FAMILY_LABEL = { fable: "Fable", opus: "Opus", sonnet: "Sonnet", haiku: "Haiku", other: "Other", all: "All models" };
/** The instrument palette for model families (declared in style.css); the project accent keeps meaning "this project". */
const FAMILY_COLOUR = { fable: "var(--model-fable)", opus: "var(--model-opus)", sonnet: "var(--model-sonnet)", haiku: "var(--model-haiku)", other: "var(--model-other)", all: "var(--ink)" };

/**
 * What a window "costs". Anthropic meters a mix of input and output; cache reads are far
 * cheaper than fresh input, so they count a tenth. This is a proxy, and the limits you enter
 * are calibrated against it, so the ratio is what matters, not the unit.
 */
export const load = (t) => (t.output ?? 0) * 4 + (t.input ?? 0) + (t.cacheWrite ?? 0) + (t.cacheRead ?? 0) / 10;
const fmt = (n) => (n >= 1e9 ? `${(n / 1e9).toFixed(2)}B` : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(0)}k` : String(Math.round(n)));

const hourKey = (d) => d.toISOString().slice(0, 13);

/** Sum hourly buckets over [now - hours, now], per family and total. */
const windowLoad = (hourly, hours, endMs = Date.now()) => {
  const out = { all: 0 };
  for (const f of FAMILIES) out[f] = 0;
  for (let i = 0; i < hours; i += 1) {
    const key = hourKey(new Date(endMs - i * 3600000));
    for (const [model, t] of Object.entries(hourly[key] ?? {})) {
      const f = familyOf(model);
      if (!f) continue;
      const v = load(t);
      out[f] += v;
      out.all += v;
    }
  }
  return out;
};

/** The highest 5-hour and 7-day windows seen in the hourly data: the calibration baseline. */
const peaks = (hourly) => {
  const keys = Object.keys(hourly).sort();
  const peak = { five: { all: 0 }, week: { all: 0 } };
  for (const f of FAMILIES) {
    peak.five[f] = 0;
    peak.week[f] = 0;
  }
  for (const key of keys) {
    const end = new Date(`${key}:59:59Z`).getTime();
    for (const [name, hours] of [["five", 5], ["week", 168]]) {
      const w = windowLoad(hourly, hours, end);
      for (const k of Object.keys(w)) peak[name][k] = Math.max(peak[name][k] ?? 0, w[k]);
    }
  }
  return peak;
};

/** Against a real limit the bar warns at 70% and 90%; against your own peak it stays neutral. */
const meter = (value, limit, colour, calibrated) => {
  const pct = limit ? Math.min(100, (value / limit) * 100) : 0;
  const tone = !calibrated ? "peak" : pct >= 90 ? "threat" : pct >= 70 ? "caution" : "";
  return el("span", { class: `cu-meter ${tone}`, style: `--c:${colour}`, title: calibrated ? `${Math.round(pct)}% of the limit you set` : "no limit set: shown against your highest window so far" }, el("i", { style: `width:${pct.toFixed(1)}%` }));
};

/** A percentage only means something against a limit you set; otherwise the load itself is the number. */
const pctText = (value, limit, calibrated) => (calibrated && limit ? `${Math.min(999, Math.round((value / limit) * 100))}%` : fmt(value));

/** Hourly stacked bars for the last `hours` hours. */
const hourChart = (hourly, hours, limitPerHour) => {
  const now = Date.now();
  const cols = [];
  let max = 1;
  for (let i = hours - 1; i >= 0; i -= 1) {
    const d = new Date(now - i * 3600000);
    const key = hourKey(d);
    const per = {};
    let total = 0;
    for (const [model, t] of Object.entries(hourly[key] ?? {})) {
      const f = familyOf(model);
      if (!f) continue;
      per[f] = (per[f] ?? 0) + load(t);
      total += load(t);
    }
    max = Math.max(max, total);
    cols.push({ d, per, total, current: i === 0 });
  }
  const chart = el("div", { class: "cu-chart", style: `--n:${hours}` });
  for (const c of cols) {
    const bar = el("div", { class: `cu-bar${c.current ? " now" : ""}`, title: `${c.d.toLocaleString([], { weekday: "short", hour: "numeric" })}: ${fmt(c.total)}${Object.entries(c.per).map(([f, v]) => ` · ${FAMILY_LABEL[f]} ${fmt(v)}`).join("")}` });
    const stack = el("div", { class: "stack" });
    for (const f of FAMILIES) if (c.per[f]) stack.append(el("i", { style: `height:${((c.per[f] / max) * 100).toFixed(1)}%; background:${FAMILY_COLOUR[f]}` }));
    const h = c.d.getHours();
    bar.append(stack, el("span", {}, h % 6 === 0 ? (h === 0 ? c.d.toLocaleDateString([], { weekday: "short" }) : `${h}`) : ""));
    chart.append(bar);
  }
  if (limitPerHour && limitPerHour < max) chart.append(el("div", { class: "cu-limit-line", style: `bottom:${((limitPerHour / max) * 100).toFixed(1)}%` }));
  return chart;
};

/** Weekly stacked bars, one per ISO week, oldest left. */
const weekChart = (weekly, limit) => {
  const weeks = Object.keys(weekly).sort();
  const cols = weeks.map((w) => {
    const per = {};
    let total = 0;
    for (const [model, t] of Object.entries(weekly[w])) {
      const f = familyOf(model);
      if (!f) continue;
      per[f] = (per[f] ?? 0) + load(t);
      total += load(t);
    }
    return { w, per, total };
  });
  const max = Math.max(1, limit ?? 0, ...cols.map((c) => c.total));
  const chart = el("div", { class: "cu-chart weeks", style: `--n:${cols.length}` });
  for (const c of cols) {
    const bar = el("div", { class: `cu-bar${c.w === weeks[weeks.length - 1] ? " now" : ""}`, title: `week of ${c.w}: ${fmt(c.total)}${Object.entries(c.per).map(([f, v]) => ` · ${FAMILY_LABEL[f]} ${fmt(v)}`).join("")}` });
    const stack = el("div", { class: "stack" });
    for (const f of FAMILIES) if (c.per[f]) stack.append(el("i", { style: `height:${((c.per[f] / max) * 100).toFixed(1)}%; background:${FAMILY_COLOUR[f]}` }));
    const [, m, d] = c.w.split("-");
    bar.append(stack, el("span", {}, `${Number(m)}/${Number(d)}`));
    chart.append(bar);
  }
  if (limit) chart.append(el("div", { class: "cu-limit-line", style: `bottom:${((limit / max) * 100).toFixed(1)}%` }));
  return chart;
};

const legend = () => el("div", { class: "cu-legend" }, ...FAMILIES.filter((f) => f !== "other").map((f) => el("span", {}, el("i", { style: `background:${FAMILY_COLOUR[f]}` }), FAMILY_LABEL[f])));

/**
 * Limits are per window and per family, in load units. `{ five: { all, fable, opus, ... }, week: {...} }`.
 * Missing entries fall back to the observed peak so the meter still means something.
 */
const limitFor = (limits, peak, win, family) => limits?.[win]?.[family] ?? null;
const baselineFor = (limits, peak, win, family) => limitFor(limits, peak, win, family) ?? (peak[win][family] > 0 ? peak[win][family] : null);

const rows = (win, current, limits, peak) => {
  const list = el("div", { class: "cu-rows" });
  for (const f of ["all", "fable", "opus", "sonnet", "haiku"]) {
    const value = current[f] ?? 0;
    const limit = limitFor(limits, peak, win, f);
    const base = baselineFor(limits, peak, win, f);
    list.append(
      el(
        "div",
        { class: `cu-row${f === "all" ? " all" : ""}` },
        el("span", { class: "name" }, el("i", { style: `background:${FAMILY_COLOUR[f]}` }), FAMILY_LABEL[f]),
        meter(value, base, FAMILY_COLOUR[f], Boolean(limit)),
        el("span", { class: "pct" }, pctText(value, base, Boolean(limit))),
        el("span", { class: "nums" }, limit ? `${fmt(value)} of ${fmt(limit)}` : base ? `peak ${fmt(base)}` : "nothing yet"),
      ),
    );
  }
  return list;
};

const limitsForm = (limits, onSave) => {
  const form = el("form", { class: "cu-limits" });
  const fields = [];
  for (const win of ["five", "week"]) {
    const group = el("div", { class: "group" }, el("b", {}, win === "five" ? "5-hour window" : "Weekly"));
    for (const f of ["all", "fable", "opus", "sonnet"]) {
      const input = el("input", { type: "number", min: "0", step: "1000", placeholder: "peak", value: limits?.[win]?.[f] ?? "" });
      fields.push({ win, f, input });
      group.append(el("label", {}, el("span", {}, FAMILY_LABEL[f]), input));
    }
    form.append(group);
  }
  form.append(
    el("p", { class: "muted small" }, "In load units: output × 4 + input + cache writes + cache reads ÷ 10. Leave a field empty to meter against your highest window so far. The day you hit a real Claude limit, copy that window's number in here and the meters are calibrated."),
    el("div", { class: "actions" }, el("button", { type: "submit", class: "primary" }, "Save limits")),
  );
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const next = { five: {}, week: {} };
    for (const { win, f, input } of fields) if (input.value !== "") next[win][f] = Number(input.value);
    await onSave(next);
  });
  return form;
};

/**
 * Mount the widget. `ctx.api(path)` and `ctx.post(path, body)` are the page's fetch helpers.
 * Renders the baby widget into `root`; the full panel opens as a sheet under it.
 */
export const mount = (root, ctx) => {
  let data = null;
  let limits = null;
  let open = false;
  let tab = "five";

  const current = () => ({ five: windowLoad(data.hourly, 5), week: windowLoad(data.hourly, 168) });

  const baby = () => {
    const cur = current();
    const peak = peaks(data.hourly);
    const five = baselineFor(limits, peak, "five", "all");
    const week = baselineFor(limits, peak, "week", "all");
    const fable = baselineFor(limits, peak, "five", "fable");
    const set = (win, f) => Boolean(limitFor(limits, peak, win, f));
    const readout = `5-hour ${pctText(cur.five.all, five, set("five", "all"))}, Fable ${pctText(cur.five.fable, fable, set("five", "fable"))}, week ${pctText(cur.week.all, week, set("week", "all"))}`;
    return el(
      "button",
      {
        type: "button", class: `cu-baby${open ? " open" : ""}`, "aria-expanded": open ? "true" : "false",
        "aria-label": `Claude usage: ${readout}${set("five", "all") ? "" : " (no limits set)"}`,
        title: set("five", "all") ? "Claude usage against your limits. Click for the hourly and weekly picture." : "Claude usage against your highest windows so far (no limits set yet). Click for the hourly and weekly picture.",
        onclick: () => { open = !open; paint(); },
      },
      el("span", { class: "brand" }, "Claude"),
      el("span", { class: "cell" }, el("span", { class: "k" }, "5h"), meter(cur.five.all, five, FAMILY_COLOUR.all, set("five", "all")), el("span", { class: "v" }, pctText(cur.five.all, five, set("five", "all")))),
      el("span", { class: "cell" }, el("span", { class: "k" }, "Fable"), meter(cur.five.fable, fable, FAMILY_COLOUR.fable, set("five", "fable")), el("span", { class: "v" }, pctText(cur.five.fable, fable, set("five", "fable")))),
      el("span", { class: "cell" }, el("span", { class: "k" }, "week"), meter(cur.week.all, week, FAMILY_COLOUR.all, set("week", "all")), el("span", { class: "v" }, pctText(cur.week.all, week, set("week", "all")))),
      el("span", { class: "chev" }, open ? "▴" : "▾"),
    );
  };

  const panel = () => {
    const cur = current();
    const peak = peaks(data.hourly);
    const isFive = tab === "five";
    const tabs = el(
      "div",
      { class: "cu-tabs" },
      el("button", { type: "button", class: isFive ? "on" : "", onclick: () => { tab = "five"; paint(); } }, "5-hour window"),
      el("button", { type: "button", class: tab === "week" ? "on" : "", onclick: () => { tab = "week"; paint(); } }, "This week"),
      el("button", { type: "button", class: tab === "limits" ? "on" : "", onclick: () => { tab = "limits"; paint(); } }, "Limits"),
      el("span", { class: "spacer" }),
      el("span", { class: "muted small mono" }, `scanned ${new Date(data.scannedAt).toLocaleTimeString()}`),
    );
    const body = el("div", { class: "cu-body" });
    if (tab === "limits") body.append(limitsForm(limits, async (next) => { limits = await ctx.post("/api/usage/limits", next); tab = "five"; paint(); }));
    else if (isFive) {
      body.append(
        el("p", { class: "cu-lede" }, `Claude meters a rolling 5-hour window. These are the last five clock hours; Fable and Opus draw the window down fastest.${limitFor(limits, peak, "five", "all") ? "" : " No limit is set yet, so the bars read against your highest window so far (see Limits)."}`),
        rows("five", cur.five, limits, peak),
        el("h4", {}, "Load per hour, last 24"),
        hourChart(data.hourly, 24, (limitFor(limits, peak, "five", "all") ?? peak.five.all) / 5),
        legend(),
      );
    } else {
      body.append(
        el("p", { class: "cu-lede" }, `The weekly limit rolls over seven days, with a separate, smaller allowance for the heavy models. Rolling 7 days first, then the last eight calendar weeks.${limitFor(limits, peak, "week", "all") ? "" : " No limit is set yet, so the bars read against your highest week so far."}`),
        rows("week", cur.week, limits, peak),
        el("h4", {}, "Load per week, last 8"),
        weekChart(data.weekly, limitFor(limits, peak, "week", "all")),
        legend(),
      );
    }
    return el("div", { class: "cu-panel" }, tabs, body);
  };

  const paint = () => {
    if (!data) {
      root.replaceChildren(el("span", { class: "cu-baby loading" }, "Claude usage…"));
      return;
    }
    root.replaceChildren(baby(), ...(open ? [panel()] : []));
  };

  const load_ = async () => {
    [data, limits] = await Promise.all([ctx.api("/api/usage"), ctx.api("/api/usage/limits")]);
    paint();
  };
  paint();
  load_().catch((err) => root.replaceChildren(el("span", { class: "cu-baby error" }, `Claude usage unavailable: ${err.message}. `, el("button", { type: "button", class: "ghost", onclick: () => load_().catch(() => {}) }, "retry"))));
  const timer = window.setInterval(() => load_().catch(() => {}), 60_000);
  return { refresh: load_, stop: () => window.clearInterval(timer) };
};
