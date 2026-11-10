// m1-t7 fixture: invented Harbor missions in four states (plus a full one at review for
// comparison), each view read once from the real server and then served frozen by a proxy, so the
// sweep cannot move a state while it is screenshotted and graded. From the repo root:
//   node deliverables/screenshots/workflow-templates-m2/m1-t7/fixture.ts [port]   (default 47371)
// then shoot with tools/cdp.mjs, read with check.js, and grade with a ui-audit's scan.mjs and
// grade.mjs on manifest.json. SIGTERM stops the proxy and Harbor and removes Harbor's scratch.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer, request } from "node:http";
import { dirname, join } from "node:path";
import { startHarbor } from "../../../../test/harbor.ts";

const h = await startHarbor();
const pin = async (template: string) => {
  const r = await fetch(`${h.url}/api/missions?project=harbor`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: `pin ${template}`, brief: "pin", template }) });
  return (await r.json()).mission.template;
};
const pinned = { mission: await pin("mission"), light: await pin("light") };
const dir = join(h.sessions, "missions", "harbor");
// Where each mission's ledger is written, as a real project has it once a plan lands.
mkdirSync(join(h.repo, "deliverables", "missions"), { recursive: true });
writeFileSync(join(h.repo, "deliverables", "missions", ".keep"), "", "utf8");
h.git("add", ".");
h.git("commit", "-q", "-m", "m1-t7 fixture: the ledger folder");
mkdirSync(dir, { recursive: true });

let n = 0;
const branch = (name: string, file: string, lines: number) => {
  h.git("checkout", "-q", "-b", name, "main");
  mkdirSync(join(h.repo, "src"), { recursive: true });
  writeFileSync(join(h.repo, "src", file), Array.from({ length: lines }, (_, i) => `line ${i} of ${file}`).join("\n") + "\n", "utf8");
  h.git("add", ".");
  h.git("commit", "-q", "-m", `m1-t7 fixture: ${file}`);
  h.git("checkout", "-q", "main");
};
const task = (mission: string, i: number, title: string, status: string) => {
  const b = `mission/${mission}-t${i}`;
  branch(b, `${mission}-${i}.ts`, 10 + (n++) * 7);
  return { id: `${mission}-t${i}`, title, intent: title, status, attempts: 1, repo: "harbor", branch: b, base: "main" };
};
const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString();
const record = (id: string, name: string, brief: string, status: string, template: unknown, milestones: Array<{ n: number; title: string; done: string; tasks: Array<{ id: string; title: string }> }>) => {
  // The plan the ledger is written from, committed before the mission branch leaves main.
  writeFileSync(join(h.repo, "deliverables", "missions", `${id}.md`), `${brief}\n\n${milestones.map((m) => `## Milestone ${m.n}: ${m.title}\n\n_done when: ${m.done}_\n\n${m.tasks.map((t) => `- [ ] **${t.id}** ${t.title}\n`).join("")}`).join("\n")}`, "utf8");
  h.git("add", ".");
  h.git("commit", "-q", "-m", `m1-t7 fixture: the ${id} plan`);
  h.git("branch", `mission/${id}`, "main");
  // The integration worktree, on the mission branch, inside Harbor's scratch so its stop removes it.
  const integration = join(dirname(h.claudeDir), `int-${id}`);
  h.git("worktree", "add", "-q", integration, `mission/${id}`);
  const m = {
    id, project: "harbor", name, brief, status, created: ago(180), approved: ago(150), plan: `deliverables/missions/${id}.md`,
    repos: [{ label: "harbor", path: h.repo, base: "main", branch: `mission/${id}`, integration, land: "merge" }],
    land: "merge", trackerIndex: 0, milestones, ...(template ? { template } : {}), rev: 1,
  };
  writeFileSync(join(dir, `${id}.json`), JSON.stringify(m, null, 2), "utf8");
};

record("dredge", "Dredge the channel", "Dredge the channel to six metres so the ferry can berth at low water.", "flying", pinned.mission, [
  { n: 1, title: "Survey and dredge plan", done: "the survey is on the chart", tasks: [task("dredge", 1, "Survey the channel depths", "passed"), { id: "dredge-t2", title: "Chart the dredge line", intent: "Chart the dredge line", status: "pending", attempts: 0, repo: "harbor" }, { id: "dredge-t3", title: "Price the spoil barge", intent: "Price the spoil barge", status: "pending", attempts: 0, repo: "harbor" }] },
  { n: 2, title: "Dredge", done: "six metres at low water", tasks: [{ id: "dredge-t4", title: "Book the dredger", intent: "Book the dredger", status: "pending", attempts: 0, repo: "harbor" }] },
]);
record("buoys", "Relight the buoys", "Swap the channel buoys' lamps for the new flashing pattern.", "flying", pinned.light, [
  { n: 1, title: "Relight", done: "every buoy flashes the new pattern", tasks: [task("buoys", 1, "List the buoys and their lamps", "passed"), { id: "buoys-t2", title: "Fit the new lamps", intent: "Fit the new lamps", status: "pending", attempts: 0, repo: "harbor" }] },
]);
record("moorings", "Renumber the moorings", "Renumber the visitor moorings so the numbers run along the pontoon.", "review", pinned.light, [
  { n: 1, title: "Renumber", done: "the numbers run along the pontoon", merged: ago(20), mergeShas: { harbor: "4f2a9c1" }, tasks: [task("moorings", 1, "Draw the new numbering", "passed"), task("moorings", 2, "Update the berth list", "passed")] },
]);
record("tide", "Post the tide table", "Post next month's tide table on the harbour office board.", "flying", undefined, [
  { n: 1, title: "Tide table", done: "the table is posted", tasks: [{ id: "tide-t1", title: "Fetch the tide predictions", intent: "Fetch the tide predictions", status: "pending", attempts: 0, repo: "harbor" }] },
]);
record("breakwater", "Survey the breakwater", "Survey the breakwater after the storm and list what needs repair.", "review", pinned.mission, [
  { n: 1, title: "Survey", done: "the repair list is written", merged: ago(30), mergeShas: { harbor: "9b1e0d4" }, walkthrough: { waived: { note: "fixture", at: ago(25) } }, tasks: [task("breakwater", 1, "Walk the breakwater and photograph it", "passed")] },
]);

const views: Record<string, unknown> = {};
for (const id of ["dredge", "buoys", "moorings", "tide", "breakwater"]) {
  const v = await (await fetch(`${h.url}/api/missions/${id}?project=harbor`)).json();
  // The older record: a view from before templates carries no `workflow` at all.
  if (id === "tide") delete v.workflow;
  views[id] = v;
}

const proxy = createServer((req, res) => {
  const m = req.url!.match(/^\/api\/missions\/([^/?]+)(\/stream)?\?/);
  const v = m && views[m[1]];
  if (v && m[2]) {
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
    res.write(`data: ${JSON.stringify(v)}\n\n`);
    return;
  }
  if (v && req.method === "GET") {
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(JSON.stringify(v));
  }
  const up = request(h.url + req.url, { method: req.method, headers: req.headers }, (r) => { res.writeHead(r.statusCode!, r.headers); r.pipe(res); });
  req.pipe(up);
});
const port = Number(process.argv[2] ?? 47371);
proxy.listen(port, "127.0.0.1", () => console.log(`fixture: http://127.0.0.1:${port} harbor ${h.url} pid ${process.pid}`));
const stop = () => { proxy.close(); h.stop().then(() => process.exit(0)); };
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
