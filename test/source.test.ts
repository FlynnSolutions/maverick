import assert from "node:assert/strict";
import { test } from "node:test";
import { resolve } from "node:path";
import { serverPath, sourceDir, withoutSource } from "../app/source.mjs";

test("the app's source is the --source flag, in either spelling, else the environment, else the packed copy", () => {
  assert.equal(sourceDir(["/usr/bin/electron", ".", "--source", "/home/u/x/maverick"]), "/home/u/x/maverick");
  assert.equal(sourceDir(["electron", "--source=/a/b"]), "/a/b");
  assert.equal(sourceDir(["electron", "--source=rel"]), resolve("rel"), "a relative path is resolved from where the app was started");
  assert.equal(sourceDir(["electron", "."], { MAVERICK_SOURCE: "/env/maverick" }), "/env/maverick");
  assert.equal(sourceDir(["electron", "--source", "/flag"], { MAVERICK_SOURCE: "/env" }), "/flag", "the flag outranks the environment");
  assert.equal(sourceDir(["electron", "--source"]), undefined, "a flag with nothing after it names nothing");
  assert.equal(sourceDir(["electron", "--source="]), undefined);
  assert.equal(sourceDir(["electron"]), undefined);
});

test("the server is the checkout's server.ts, or the packed one, and a relaunch carries every argument but the source", () => {
  assert.equal(serverPath("/a/maverick", "/packed/server.ts"), "/a/maverick/server.ts");
  assert.equal(serverPath(undefined, "/packed/server.ts"), "/packed/server.ts");
  assert.deepEqual(withoutSource([".", "--source", "/old/checkout", "--other", "--source=/older"]), [".", "--other"]);
});
