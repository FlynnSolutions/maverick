/**
 * The templates a project offers, over HTTP against a real server on the invented Harbor
 * project. Harbor holds one good template of its own and one broken one; the list answers with
 * both, a broken file is a choice with its error rather than a failed list, one template is
 * fetched by id, and an id is only ever looked up, never turned into a path.
 */
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, before, test } from "node:test";
import type { TemplateChoice, Workflow } from "../src/workflows.ts";
import { startHarbor, type Harbor } from "./harbor.ts";

const DOCKSIDE: Workflow = {
  id: "dockside",
  name: "Dockside",
  description: "Build and land, then review on the quay.",
  stages: [
    { id: "interview", kind: "interview" },
    { id: "plan-gate", kind: "gate" },
    { id: "preflight", kind: "preflight" },
    { id: "milestones", kind: "for-each", over: "milestones", stages: [
      { id: "tasks", kind: "for-each", over: "tasks", stages: [{ id: "build", kind: "agent", slot: "wingmanAgent" }] },
      { id: "merge", kind: "merge" },
      { id: "land", kind: "land" },
    ] },
    { id: "close", kind: "close" },
  ],
};

let harbor: Harbor;
before(async () => {
  harbor = await startHarbor();
  const dir = join(harbor.repo, ".maverick", "workflows");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "dockside.json"), JSON.stringify(DOCKSIDE), "utf8");
  writeFileSync(join(dir, "broken.json"), "{ not json", "utf8");
  // A good template one folder up: what `../secret` would reach if the route built a path from the URL.
  writeFileSync(join(harbor.repo, ".maverick", "secret.json"), JSON.stringify({ ...DOCKSIDE, id: "secret" }), "utf8");
});
after(async () => { await harbor.stop(); });

const get = async (path: string): Promise<{ status: number; json: unknown }> => {
  const res = await fetch(`${harbor.url}${path}`);
  return { status: res.status, json: await res.json() };
};

test("GET /api/workflows lists the built-ins first, then the project's files, the broken one with why", async () => {
  const { status, json } = await get("/api/workflows?project=harbor");
  assert.equal(status, 200, JSON.stringify(json));
  const list = json as TemplateChoice[];
  assert.deepEqual(list.map((c) => [c.id, c.source, c.unverified, c.template !== undefined]), [
    ["mission", "built-in", false, true],
    ["light", "built-in", true, true],
    ["broken", "project", false, false],
    ["dockside", "project", true, true],
  ]);
  assert.equal(list[1].name, "Light");
  const broken = list[2];
  assert.equal(broken.name, "broken");
  assert.match(String(broken.error), /^broken\.json: not JSON/);
  assert.deepEqual(list[3].template, DOCKSIDE, "the project's file, as it was written");
});

test("GET /api/workflows/<id> answers that one choice with its template", async () => {
  const { status, json } = await get("/api/workflows/dockside?project=harbor");
  assert.equal(status, 200, JSON.stringify(json));
  assert.deepEqual(json, { id: "dockside", name: "Dockside", description: DOCKSIDE.description, source: "project", unverified: true, leftOut: ["review", "proof", "walk"], template: DOCKSIDE });
});

test("GET /api/workflows/<id> answers a broken file as its choice with the error, not a failure", async () => {
  const { status, json } = await get("/api/workflows/broken?project=harbor");
  assert.equal(status, 200, JSON.stringify(json));
  assert.match(String((json as TemplateChoice).error), /^broken\.json: not JSON/);
});

test("an unknown id is a 404 that names it", async () => {
  const { status, json } = await get("/api/workflows/ferry?project=harbor");
  assert.equal(status, 404);
  assert.deepEqual(json, { error: "no template ferry" });
});

test("an id with ../ is refused, and the file it would reach is never read", async () => {
  const { status, json } = await get("/api/workflows/..%2Fsecret?project=harbor");
  assert.equal(status, 404);
  assert.deepEqual(json, { error: "no template ../secret" });
});

test("the routes need a project", async () => {
  const { status, json } = await get("/api/workflows");
  assert.equal(status, 500);
  assert.match(String((json as { error: string }).error), /project query parameter is required/);
});
