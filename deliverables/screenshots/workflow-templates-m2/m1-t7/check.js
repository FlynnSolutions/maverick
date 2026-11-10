(async () => {
  const until = async (f, ms) => { const end = Date.now() + ms; while (Date.now() < end) { const x = f(); if (x) return x; await new Promise((r) => setTimeout(r, 100)); } return null; };
  await until(() => document.querySelector("#ask h1:not(.mv-loading)"), 10000);
  await new Promise((r) => setTimeout(r, 1500));
  const q = (s) => document.querySelector(s);
  const line = q(".mv-template");
  const flight = q(".mv-flight");
  const word = q("#word"), anchors = q(".mv-anchors");
  const rect = (n) => n && Math.round(n.getBoundingClientRect().top);
  return JSON.stringify({
    line: line && line.textContent, href: line && line.querySelector("a").getAttribute("href"),
    order: [...q("#ask").children].map((c) => c.tagName + "." + c.className).slice(0, 3),
    flightHidden: flight.hidden,
    flight: [...flight.children].map((li) => `${li.className}:${li.textContent}${li.getAttribute("aria-current") ? "*" : ""}`),
    tops: { word: rect(word), flight: rect(flight), anchors: rect(anchors), now: rect(q("#now")), ask: rect(q("#ask")) },
    between: word.nextElementSibling === flight && flight.nextElementSibling === anchors,
    must: Boolean(q(".rs-must")), summarize: [...document.querySelectorAll("button")].some((b) => /summari/.test(b.textContent)),
    walks: q(".rs-walks") && !q(".rs-walks").hidden ? q(".rs-walks").textContent : null,
    toRead: [...document.querySelectorAll(".mv-result > h2, .rs-now, .rs-read")].filter((n) => n.offsetParent !== null).map((n) => n.textContent.slice(0, 60)),
    walksLabel: q(".rs-walks")?.getAttribute("aria-label"),
    why: [...document.querySelectorAll(".rs-why")].map((p) => p.textContent),
    overflow: document.documentElement.scrollWidth - innerWidth,
  }, null, 1);
})()
