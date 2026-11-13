import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { runBrowserBundlePost, isConfirmedRoomPostUrl } from "../src/browser-post-runner";
import type { BrowserPostStateStore, BrowserPostState, StateSnapshot } from "../src/browser-post-state";
import { browserBundleFixture } from "./helpers/browser-bundle-fixture";
const profileUrl = "https://room.rakuten.co.jp/room_test";
const roomPostUrl = profileUrl + "/1700000000000001";
function store() {
  const events: string[] = [];
  let state: BrowserPostState = { version: 1, active: null, records: [] };
  let revision = 0;
  const excluded: string[] = [];
  const result: BrowserPostStateStore = {
    async read() { return { state: structuredClone(state), revision: String(revision), excludedItemCodes: [...excluded] }; },
    async save(value, expected) {
      assert.equal(expected, String(revision));
      events.push(value.active?.status ?? "cleared");
      state = structuredClone(value); revision++;
      return this.read();
    },
    async persistPosted(code) { events.push("posted:" + code); excluded.push(code); },
  };
  return { result, events, excluded, state: () => state };
}
test("reserve, publish, preserve confirmed active, persist posted, then consume in order", async t => {
  const f = browserBundleFixture(t), s = store();
  s.excluded.push("old:uncertain");
  const result = await runBrowserBundlePost({ manifestPath: f.manifestPath, profileUrl, store: s.result, lockDirectory: f.dir,
    publish: async entry => { s.events.push("publish"); assert.equal(entry.item.itemCode, f.item.itemCode); assert.deepEqual(entry.image.bytes, f.png); return { success: true, itemName: entry.item.itemName, itemUrl: entry.item.itemUrl, roomPostUrl }; } });
  assert.equal(result.roomPostUrl, roomPostUrl);
  assert.deepEqual(s.events, ["reserved", "publish", "published", "posted:shop:test", "cleared"]);
  assert.equal(s.state().active, null); assert.equal(s.state().records.length, 1);
  await assert.rejects(runBrowserBundlePost({ manifestPath: f.manifestPath, profileUrl, store: s.result, lockDirectory: f.dir }), /ALREADY_POSTED_OR_UNCERTAIN/);
});
test("uncertain old product stays excluded while another product can proceed", async t => {
  const f = browserBundleFixture(t), s = store(); s.excluded.push(f.item.itemCode);
  await assert.rejects(runBrowserBundlePost({ manifestPath: f.manifestPath, profileUrl, store: s.result, lockDirectory: f.dir, publish: async () => { throw new Error("must not run"); } }), /ALREADY_POSTED_OR_UNCERTAIN/);
  assert.deepEqual(s.events, []);
});
test("CAS failure blocks publication", async t => {
  const f = browserBundleFixture(t), s = store(); let called = false;
  s.result.save = async () => { throw new Error("CAS conflict"); };
  await assert.rejects(runBrowserBundlePost({ manifestPath: f.manifestPath, profileUrl, store: s.result, lockDirectory: f.dir, publish: async () => { called = true; throw new Error("unexpected"); } }), /CAS conflict/);
  assert.equal(called, false);
});
for (const failure of ["throw", "missing-url", "wrong-profile", "unknown"]) test("unconfirmed publication retains active state: " + failure, async t => {
  const f = browserBundleFixture(t), s = store(); let calls = 0;
  const publish = async () => { calls++; if (failure === "throw") throw new Error("upload outcome unknown"); return { success: true, itemName: f.item.itemName, itemUrl: f.item.itemUrl, roomPostUrl: failure === "missing-url" ? undefined : failure === "wrong-profile" ? "https://room.rakuten.co.jp/room_other/1700000000000001" : roomPostUrl, unknown: failure === "unknown" }; };
  await assert.rejects(runBrowserBundlePost({ manifestPath: f.manifestPath, profileUrl, store: s.result, lockDirectory: f.dir, publish }));
  assert.equal(s.state().active?.status, "unknown");
  await assert.rejects(runBrowserBundlePost({ manifestPath: f.manifestPath, profileUrl, store: s.result, lockDirectory: f.dir, publish }), /ACTIVE_POST_UNRESOLVED/);
  assert.equal(calls, 1);
});
test("posted state write failure does not free a confirmed active reservation", async t => {
  const f = browserBundleFixture(t), s = store();
  s.result.persistPosted = async () => { throw new Error("remote write failed"); };
  await assert.rejects(runBrowserBundlePost({ manifestPath: f.manifestPath, profileUrl, store: s.result, lockDirectory: f.dir, publish: async () => ({ success: true, itemName: f.item.itemName, itemUrl: f.item.itemUrl, roomPostUrl }) }), /remote write failed/);
  assert.equal(s.state().active?.status, "published"); assert.equal(s.state().records.length, 0);
});
test("existing process lock blocks before remote reservation", async t => {
  const f = browserBundleFixture(t), s = store(); fs.writeFileSync(path.join(f.dir, ".browser-room-post.lock"), "pending");
  await assert.rejects(runBrowserBundlePost({ manifestPath: f.manifestPath, profileUrl, store: s.result, lockDirectory: f.dir }), /EEXIST/);
  assert.deepEqual(s.events, []);
});
test("only verified profile detail permalinks qualify", () => {
  assert.equal(isConfirmedRoomPostUrl(roomPostUrl, profileUrl + "/items"), true);
  for (const url of [profileUrl + "/items", profileUrl + "/1700000000000001?x=1", "http://room.rakuten.co.jp/room_test/1700000000000001", "https://evil.test/room_test/1700000000000001"]) assert.equal(isConfirmedRoomPostUrl(url, profileUrl), false);
});
test("production entrypoint with no bundle stops without invoking legacy API pipeline", () => {
  const env = { ...process.env }; delete env.ROOM_BROWSER_BUNDLE;
  const result = spawnSync(process.execPath, ["--import", "tsx", "src/main.ts"], { encoding: "utf8", env });
  assert.equal(result.status, 1); assert.match(result.stderr, /ROOM_BROWSER_BUNDLE_REQUIRED/);
  for (const file of ["src/main.ts", "src/actions/auto_post.ts"]) {
    const source = fs.readFileSync(file, "utf8");
    assert.match(source, /runBrowserPostFromEnvironment/);
    assert.doesNotMatch(source, /generateCaptions|generateStrategyBrief|crossPostToSns|fetchItems/);
  }
});
