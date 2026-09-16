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
const HOUR = 3600000;
const clock = (ms) => new Date(ms).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

/**
 * Claude's 5-hour window opens at your first message after the previous window lapsed. The
 * hour buckets place that first message inside an hour, so the true reset sits between the
 * block start + 5h and + 6h.
 */
const windowBlocks = (hourly) => {
  const hours = Object.keys(hourly).filter((k) => Object.entries(hourly[k]).some(([m, t]) => familyOf(m) && load(t) > 0)).sort();
  const blocks = [];
  for (const k of hours) {
    const t = Date.parse(`${k}:00:00Z`);
    const last = blocks[blocks.length - 1];
    if (!last || t >= last.start + 5 * HOUR) blocks.push({ start: t, hours: [k] });
    else last.hours.push(k);
  }
  return blocks;
};

const sumHours = (hourly, hours) => {
  const out = { all: 0 };
  for (const f of FAMILIES) out[f] = 0;
  for (const key of hours) {
    for (const [model, t] of Object.entries(hourly[key] ?? {})) {
      const f = familyOf(model);
      if (!f) continue;
      out[f] += load(t);
      out.all += load(t);
    }
  }
  return out;
};

/** The window that is open now, its load, and when it resets; null when no window is open. */
const currentWindow = (hourly) => {
  const blocks = windowBlocks(hourly);
  const last = blocks[blocks.length - 1];
  if (!last) return null;
  const now = Date.now();
  const resetEarliest = last.start + 5 * HOUR;
  const resetLatest = last.start + 6 * HOUR;
  if (now >= resetLatest) return null;
  const load_ = sumHours(hourly, last.hours);
  return { ...last, ...load_, resetEarliest, resetLatest, resetText: now >= resetEarliest ? "resetting about now" : `resets by ${clock(resetLatest)}` };
};

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
  for (const b of windowBlocks(hourly)) {
    const w = sumHours(hourly, b.hours);
    for (const k of Object.keys(w)) peak.five[k] = Math.max(peak.five[k] ?? 0, w[k]);
  }
  for (const key of keys) {
    const w = windowLoad(hourly, 168, new Date(`${key}:59:59Z`).getTime());
    for (const k of Object.keys(w)) peak.week[k] = Math.max(peak.week[k] ?? 0, w[k]);
  }
  return peak;
};

/** Against a real limit the bar warns at 70% and 90%; against your own peak it stays neutral. */
const meter = (value, limit, colour, calibrated) => {
  if (!calibrated) return el("span", { class: "cu-meter unset", title: "no limit set yet: see Calibrate" });
  const pct = limit ? Math.min(100, (value / limit) * 100) : 0;
  const tone = pct >= 90 ? "threat" : pct >= 70 ? "caution" : "";
  return el("span", { class: `cu-meter ${tone}`, style: `--c:${colour}`, title: `${Math.round(pct)}% of the limit you set` }, el("i", { style: `width:${pct.toFixed(1)}%` }));
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
        el("span", { class: "nums" }, limit ? `${fmt(value)} of ${fmt(limit)}` : "no limit set"),
      ),
    );
  }
  return list;
};

/**
 * Calibration. Claude shows its limits only as percentages in its own /usage screen, so the
 * moment Claude says a window is used up, the load at that moment becomes the limit here.
 */
const calibrate = (cur, limits, onSave) => {
  const wrap = el("div", { class: "cu-cal" });
  wrap.append(el("p", { class: "cu-lede" }, "Claude does not publish the numbers behind the percentages in its /usage screen. When Claude tells you a window is used up, press the button for that window: the load at that moment becomes its limit, and from then on the bars read as percentages. Until then the widget shows load only."));
  for (const [win, label] of [["five", "5-hour"], ["week", "weekly"]]) {
    for (const f of ["all", "fable", "opus"]) {
      const limit = limits?.[win]?.[f];
      wrap.append(el("div", { class: "row" },
        el("span", {}, `${label} · ${FAMILY_LABEL[f]}`),
        el("span", { class: "cur" }, `now ${fmt(cur[win][f] ?? 0)}`),
        el("span", { class: "lim" }, limit ? `limit ${fmt(limit)}` : "not set"),
        el("span", {},
          el("button", { type: "button", onclick: () => onSave(win, f, Math.round(cur[win][f] ?? 0)) }, "this is the limit"),
          limit ? el("button", { type: "button", class: "ghost", onclick: () => onSave(win, f, null) }, "clear") : null),
      ));
    }
  }
  wrap.append(el("p", { class: "muted small" }, "Or let Maverick read Claude's own numbers: the endpoint behind /usage needs the OAuth token in the macOS keychain, which Maverick is not permitted to read yet."));
  return wrap;
};

/** "3h 56m" until an ISO time, or "" once passed. */
const until = (iso) => {
  if (!iso) return "";
  const ms = Date.parse(iso) - Date.now();
  if (ms <= 0) return "now";
  const h = Math.floor(ms / HOUR);
  const m = Math.round((ms % HOUR) / 60000);
  return h >= 24 ? `${Math.floor(h / 24)}d ${h % 24}h` : h ? `${h}h ${m}m` : `${m}m`;
};
const when = (iso) => {
  if (!iso) return "";
  const d = new Date(iso);
  const sameDay = d.toDateString() === new Date().toDateString();
  return sameDay ? clock(d.getTime()) : d.toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" });
};

/** A limit row from Claude's own numbers: name, meter by severity, percent, reset. */
const limitName = (l) => (l.kind === "session" ? "5-hour window" : l.kind === "weekly_all" ? "Weekly · all models" : l.scope?.model?.display_name ? `Weekly · ${l.scope.model.display_name}` : `Weekly · ${l.kind}`);
const liveMeter = (l) => {
  const tone = l.severity === "critical" || l.percent >= 90 ? "threat" : l.severity === "warning" || l.percent >= 70 ? "caution" : "";
  return el("span", { class: `cu-meter ${tone}`, style: `--c:${l.kind === "session" ? "var(--ink)" : "var(--model-opus)"}`, title: `${l.percent}% used` }, el("i", { style: `width:${Math.min(100, l.percent)}%` }));
};
const liveRows = (limits) =>
  el("div", { class: "cu-rows" }, ...limits.map((l) =>
    el("div", { class: `cu-row${l.kind === "session" ? " all" : ""}` },
      el("span", { class: "name" }, limitName(l)),
      liveMeter(l),
      el("span", { class: "pct" }, `${l.percent}%`),
      el("span", { class: "nums" }, l.resets_at ? `resets in ${until(l.resets_at)} · ${when(l.resets_at)}` : "no reset scheduled"))));

/**
 * Mount the widget. `ctx.api(path)` and `ctx.post(path, body)` are the page's fetch helpers.
 * Renders the baby widget into `root`; the full panel opens as a sheet under it. Claude's own
 * numbers lead; the transcript-derived load explains what is consuming them; the calibration
 * proxy only appears when the endpoint cannot be reached.
 */
export const mount = (root, ctx) => {
  let data = null;
  let live = null;
  let limits = null;
  let open = false;
  let tab = "now";

  const current = () => {
    const win = currentWindow(data.hourly);
    const five = { all: 0 };
    for (const f of FAMILIES) five[f] = 0;
    return { five: win ?? five, win, week: windowLoad(data.hourly, 168) };
  };
  const liveLimits = () => (live?.data?.limits ?? []).slice().sort((a, b) => (a.kind === "session" ? -1 : b.kind === "session" ? 1 : 0));
  /** "as of <time>" while the last check failed and the numbers are the previous good ones. */
  const asOf = () => (live?.stale ? `as of ${when(live.fetchedAt)}` : "");

  const pill = (children, title) =>
    el("button", { type: "button", class: `cu-baby${open ? " open" : ""}`, "aria-expanded": open ? "true" : "false", "aria-label": title, title, onclick: () => { open = !open; paint(); } }, el("span", { class: "brand" }, "Claude"), ...children, el("span", { class: "chev" }, open ? "▴" : "▾"));

  const baby = () => {
    const ls = liveLimits();
    if (ls.length) {
      const session = ls.find((l) => l.kind === "session");
      const cells = ls.map((l) =>
        el("span", { class: "cell" },
          el("span", { class: "k" }, l.kind === "session" ? "5h" : l.kind === "weekly_all" ? "week" : l.scope?.model?.display_name ?? l.kind),
          liveMeter(l),
          el("span", { class: "v" }, `${l.percent}%`),
          l === session && l.resets_at ? el("span", { class: "reset" }, `resets ${when(l.resets_at)}`) : null));
      if (live.stale) cells.push(el("span", { class: "reset" }, asOf()));
      return pill(cells, `Claude usage from Claude${live.stale ? ` ${asOf()} (${live.stale})` : ""}: ${ls.map((l) => `${limitName(l)} ${l.percent}%${l.resets_at ? `, resets ${when(l.resets_at)}` : ""}`).join("; ")}`);
    }
    // Fallback: the transcript-derived load against your own calibration.
    const cur = current();
    const peak = peaks(data.hourly);
    const set = (win, f) => Boolean(limitFor(limits, peak, win, f));
    const five = baselineFor(limits, peak, "five", "all");
    return pill([
      el("span", { class: "cell" }, el("span", { class: "k" }, "5h"), set("five", "all") ? meter(cur.five.all, five, FAMILY_COLOUR.all, true) : null, el("span", { class: "v" }, pctText(cur.five.all, five, set("five", "all"))), el("span", { class: "reset" }, cur.win ? cur.win.resetText : "window clear")),
      el("span", { class: "cell" }, el("span", { class: "k" }, "week"), el("span", { class: "v" }, fmt(cur.week.all))),
      el("span", { class: "reset" }, live?.error ? "Claude's numbers unavailable" : "load only"),
    ], `Claude usage (load from transcripts; Claude's own numbers unavailable${live?.error ? `: ${live.error}` : ""}). Click for details.`);
  };

  const panel = () => {
    const cur = current();
    const peak = peaks(data.hourly);
    const ls = liveLimits();
    const session = ls.find((l) => l.kind === "session");
    const weekly = ls.find((l) => l.kind === "weekly_all");
    const tabs = el("div", { class: "cu-tabs" },
      el("button", { type: "button", class: tab === "now" ? "on" : "", onclick: () => { tab = "now"; paint(); } }, "Now"),
      el("button", { type: "button", class: tab === "five" ? "on" : "", onclick: () => { tab = "five"; paint(); } }, "5-hour window"),
      el("button", { type: "button", class: tab === "week" ? "on" : "", onclick: () => { tab = "week"; paint(); } }, "This week"),
      ls.length ? null : el("button", { type: "button", class: tab === "limits" ? "on" : "", onclick: () => { tab = "limits"; paint(); } }, "Calibrate"),
      el("span", { class: "spacer" }),
      el("span", { class: "muted small mono" }, live?.fetchedAt && !live.error ? `Claude ${new Date(live.fetchedAt).toLocaleTimeString()} · load ${new Date(data.scannedAt).toLocaleTimeString()}` : `load ${new Date(data.scannedAt).toLocaleTimeString()}`),
    );
    const body = el("div", { class: "cu-body" });
    if (tab === "now") {
      if (ls.length) {
        body.append(
          el("p", { class: "cu-lede" }, live.stale
            ? `Claude's own numbers for your ${live.subscription ?? ""} plan ${asOf()}; the last check failed (${live.stale}), so these stand until the next one succeeds.`
            : `Claude's own numbers for your ${live.subscription ?? ""} plan: the same figures its /usage screen shows. The 5-hour window is a rolling session; the weekly limits roll over seven days, with the heavy model metered on its own.`),
          liveRows(ls),
        );
        const rows = live.data?.seven_day_breakdown?.rows?.filter((r) => r.percent > 0) ?? [];
        if (rows.length > 1) body.append(el("h4", {}, "Where this week went"), el("div", { class: "cu-legend" }, ...rows.map((r) => el("span", {}, `${r.display_name} ${r.percent}%`))));
      } else {
        body.append(el("p", { class: "cu-lede" }, `Claude's own numbers are unavailable${live?.error ? ` (${live.error})` : ""}. What follows is load read from the transcripts.`), rows("five", cur.five, limits, peak));
      }
    } else if (tab === "limits") {
      body.append(calibrate(cur, limits, async (win, f, value) => {
        const next = { five: { ...(limits?.five ?? {}) }, week: { ...(limits?.week ?? {}) } };
        if (value === null) delete next[win][f];
        else next[win][f] = value;
        limits = await ctx.post("/api/usage/limits", next);
        paint();
      }));
    } else if (tab === "five") {
      body.append(
        el("p", { class: "cu-lede" }, session
          ? `${session.percent}% of the 5-hour window used; it resets in ${until(session.resets_at)} (${when(session.resets_at)}). Below, what has been consuming it: load per hour, by model family, from the transcripts.`
          : `Claude's 5-hour window opens at your first message and ${cur.win ? `${cur.win.resetText.replace("resets", "closes")} (it opened around ${clock(cur.win.start)})` : "is not open right now"}. Load per hour, by model family.`),
        el("h4", {}, "Load per hour, last 24"),
        hourChart(data.hourly, 24, null),
        legend(),
      );
    } else {
      body.append(
        el("p", { class: "cu-lede" }, weekly
          ? `${weekly.percent}% of the week used; it resets in ${until(weekly.resets_at)} (${when(weekly.resets_at)}).${ls.filter((l) => l.kind === "weekly_scoped").map((l) => ` ${l.scope?.model?.display_name ?? "Scoped"}: ${l.percent}% of its own weekly allowance.`).join("")} Below, load per week by model family, from the transcripts.`
          : "Claude's weekly limit resets once a week at a time it keeps. Load per week by model family, from the transcripts."),
        el("h4", {}, "Load per week, last 8"),
        weekChart(data.weekly, null),
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
    [data, live, limits] = await Promise.all([ctx.api("/api/usage"), ctx.api("/api/usage/live").catch((err) => ({ fetchedAt: new Date().toISOString(), error: err.message })), ctx.api("/api/usage/limits")]);
    paint();
  };
  paint();
  load_().catch((err) => root.replaceChildren(el("span", { class: "cu-baby error" }, `Claude usage unavailable: ${err.message}. `, el("button", { type: "button", class: "ghost", onclick: () => load_().catch(() => {}) }, "retry"))));
  const timer = window.setInterval(() => load_().catch(() => {}), 60_000);
  return { refresh: load_, stop: () => window.clearInterval(timer) };
};
