import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRoomPostIntent, hasUnresolvedRoomPostIntent, persistRoomPostIntent } from "../src/room-post-intent";

test("ROOM投稿intentは500件を超えてもunknownを切り捨てない", () => {
  const items = Array.from({ length: 501 }, (_, index) => ({
    itemCode: `item-${index}`,
    itemName: `商品${index}`,
    itemUrl: `https://example.test/${index}`,
  }));
  const intent = createRoomPostIntent(items, "test-request");
  assert.equal(intent.items.length, 501);
  assert.equal(intent.items[500]?.itemCode, "item-500");
  assert.equal(hasUnresolvedRoomPostIntent(intent), true);
});

test("空intentだけが解決済みとして扱われる", () => {
  const intent = createRoomPostIntent([], "empty-request");
  assert.equal(hasUnresolvedRoomPostIntent(intent), false);
});

test("CIでintentのremote保存に失敗したら送信前に停止する", async () => {
  const intent = createRoomPostIntent([{ itemCode: "save-fail", itemName: "保存失敗テスト", itemUrl: "https://example.test/save-fail" }], "save-fail-request");
  const originalFetch = globalThis.fetch;
  const oldEnv = {
    CI: process.env.CI,
    GITHUB_TOKEN: process.env.GITHUB_TOKEN,
    GITHUB_REPOSITORY: process.env.GITHUB_REPOSITORY,
  };
  const intentPath = path.join(process.cwd(), "room_post_intent.json");
  process.env.CI = "true";
  process.env.GITHUB_TOKEN = "test-token";
  process.env.GITHUB_REPOSITORY = "owner/repo";
  globalThis.fetch = async () => new Response("", { status: 500 });
  try {
    await assert.rejects(persistRoomPostIntent(intent), /永続化に失敗/);
    assert.equal(fs.existsSync(intentPath), true);
  } finally {
    globalThis.fetch = originalFetch;
    if (oldEnv.CI === undefined) delete process.env.CI; else process.env.CI = oldEnv.CI;
    if (oldEnv.GITHUB_TOKEN === undefined) delete process.env.GITHUB_TOKEN; else process.env.GITHUB_TOKEN = oldEnv.GITHUB_TOKEN;
    if (oldEnv.GITHUB_REPOSITORY === undefined) delete process.env.GITHUB_REPOSITORY; else process.env.GITHUB_REPOSITORY = oldEnv.GITHUB_REPOSITORY;
    fs.rmSync(intentPath, { force: true });
  }
});
