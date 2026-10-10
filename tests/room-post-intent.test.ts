import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { clearRoomPostIntent, createRoomPostIntent, hasUnresolvedRoomPostIntent, persistPostedItemsAndVerify, persistRoomPostIntent, syncPostedItemsFromRemote } from "../src/room-post-intent";

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
  fs.rmSync(intentPath, { force: true });
  process.env.CI = "true";
  process.env.GITHUB_TOKEN = "test-token";
  process.env.GITHUB_REPOSITORY = "owner/repo";
  globalThis.fetch = async () => new Response("", { status: 500 });
  try {
    await assert.rejects(persistRoomPostIntent(intent), /ROOM投稿intent.*失敗/);
    assert.equal(fs.existsSync(intentPath), false);
  } finally {
    globalThis.fetch = originalFetch;
    if (oldEnv.CI === undefined) delete process.env.CI; else process.env.CI = oldEnv.CI;
    if (oldEnv.GITHUB_TOKEN === undefined) delete process.env.GITHUB_TOKEN; else process.env.GITHUB_TOKEN = oldEnv.GITHUB_TOKEN;
    if (oldEnv.GITHUB_REPOSITORY === undefined) delete process.env.GITHUB_REPOSITORY; else process.env.GITHUB_REPOSITORY = oldEnv.GITHUB_REPOSITORY;
    fs.rmSync(intentPath, { force: true });
  }
});

test("remoteに既存未解決intentがあれば別runのintentで上書きしない", async () => {
  const oldIntent = createRoomPostIntent([{ itemCode: "old", itemName: "既存", itemUrl: "https://example.test/old" }], "old-request");
  const nextIntent = createRoomPostIntent([{ itemCode: "new", itemName: "新規", itemUrl: "https://example.test/new" }], "new-request");
  const originalFetch = globalThis.fetch;
  const oldEnv = { CI: process.env.CI, GITHUB_TOKEN: process.env.GITHUB_TOKEN, GITHUB_REPOSITORY: process.env.GITHUB_REPOSITORY, GITHUB_REF_NAME: process.env.GITHUB_REF_NAME };
  const calls: string[] = [];
  process.env.CI = "true"; process.env.GITHUB_TOKEN = "test-token"; process.env.GITHUB_REPOSITORY = "owner/repo"; process.env.GITHUB_REF_NAME = "main";
  globalThis.fetch = async (_input, init) => {
    calls.push(init?.method ?? "GET");
    return new Response(JSON.stringify({
      sha: "remote-sha",
      content: Buffer.from(JSON.stringify(oldIntent)).toString("base64"),
    }), { status: 200 });
  };
  try {
    await assert.rejects(persistRoomPostIntent(nextIntent), /未解決ROOM投稿intent/);
    assert.deepEqual(calls, ["GET"]);
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries(oldEnv)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});

test("別requestIdのremote intentは消去しない", async () => {
  const oldIntent = createRoomPostIntent([{ itemCode: "old", itemName: "既存", itemUrl: "https://example.test/old" }], "old-request");
  const originalFetch = globalThis.fetch;
  const oldEnv = { CI: process.env.CI, GITHUB_TOKEN: process.env.GITHUB_TOKEN, GITHUB_REPOSITORY: process.env.GITHUB_REPOSITORY, GITHUB_REF_NAME: process.env.GITHUB_REF_NAME };
  const calls: string[] = [];
  process.env.CI = "true"; process.env.GITHUB_TOKEN = "test-token"; process.env.GITHUB_REPOSITORY = "owner/repo"; process.env.GITHUB_REF_NAME = "feature";
  globalThis.fetch = async (_input, init) => {
    calls.push(init?.method ?? "GET");
    return new Response(JSON.stringify({
      sha: "remote-sha",
      content: Buffer.from(JSON.stringify(oldIntent)).toString("base64"),
    }), { status: 200 });
  };
  try {
    await assert.rejects(clearRoomPostIntent("different-request"), /別requestId/);
    assert.deepEqual(calls, ["GET"]);
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries(oldEnv)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});

test("ROOM intentは履歴保存後にだけ消去しunknown一覧を切り捨てない", () => {
  const source = fs.readFileSync(path.join(process.cwd(), "src/main.ts"), "utf-8");
  const saved = source.indexOf("saveState(postedCodes");
  const cleared = source.indexOf("clearRoomPostIntent(roomIntent.requestId)");
  assert.ok(saved >= 0 && cleared > saved);
  assert.doesNotMatch(source, /uncertainItemCodes: \[\.\.\.uncertainCodes\]\.slice/);
});

test("古いcheckoutはactive branchの最新posted履歴を先に取り込む", async () => {
  const originalFetch = globalThis.fetch;
  const oldEnv = { CI: process.env.CI, GITHUB_TOKEN: process.env.GITHUB_TOKEN, GITHUB_REPOSITORY: process.env.GITHUB_REPOSITORY, GITHUB_REF_NAME: process.env.GITHUB_REF_NAME };
  const postedPath = path.join(process.cwd(), "posted_items.json");
  const originalPosted = fs.readFileSync(postedPath, "utf-8");
  process.env.CI = "true"; process.env.GITHUB_TOKEN = "test-token"; process.env.GITHUB_REPOSITORY = "owner/repo"; process.env.GITHUB_REF_NAME = "main";
  fs.writeFileSync(postedPath, JSON.stringify({ postedItemCodes: ["local-old"], postTypeIndex: 0 }));
  globalThis.fetch = async () => new Response(JSON.stringify({
    content: Buffer.from(JSON.stringify({ postedItemCodes: ["remote-new"], postTypeIndex: 2 })).toString("base64"),
  }), { status: 200 });
  try {
    await syncPostedItemsFromRemote();
    const merged = JSON.parse(fs.readFileSync(postedPath, "utf-8")) as { postedItemCodes: string[] };
    assert.deepEqual(new Set(merged.postedItemCodes), new Set(["local-old", "remote-new"]));
  } finally {
    fs.writeFileSync(postedPath, originalPosted);
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries(oldEnv)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});

test("posted stateをremote保存して読み戻し確認できるまで成功扱いしない", async () => {
  const originalFetch = globalThis.fetch;
  const oldEnv = { CI: process.env.CI, GITHUB_TOKEN: process.env.GITHUB_TOKEN, GITHUB_REPOSITORY: process.env.GITHUB_REPOSITORY, GITHUB_REF_NAME: process.env.GITHUB_REF_NAME };
  const postedPath = path.join(process.cwd(), "posted_items.json");
  const originalPosted = fs.readFileSync(postedPath, "utf-8");
  process.env.CI = "true"; process.env.GITHUB_TOKEN = "test-token"; process.env.GITHUB_REPOSITORY = "owner/repo"; process.env.GITHUB_REF_NAME = "main";
  fs.writeFileSync(postedPath, JSON.stringify({ postedItemCodes: ["required"], postTypeIndex: 1 }));
  let call = 0;
  globalThis.fetch = async (_input, init) => {
    call += 1;
    if (init?.method === "PUT") return new Response("", { status: 200 });
    return new Response(JSON.stringify({
      sha: "posted-sha",
      content: Buffer.from(JSON.stringify({ postedItemCodes: ["required", "remote-parallel"], postTypeIndex: 1 })).toString("base64"),
    }), { status: 200 });
  };
  try {
    await persistPostedItemsAndVerify(["required"]);
    assert.equal(call, 3);
    const mergedLocal = JSON.parse(fs.readFileSync(postedPath, "utf-8")) as { postedItemCodes: string[] };
    assert.equal(mergedLocal.postedItemCodes.includes("remote-parallel"), true);
  } finally {
    fs.writeFileSync(postedPath, originalPosted);
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries(oldEnv)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});

test("posted stateのremote保存失敗時はintent解除へ進めない", async () => {
  const originalFetch = globalThis.fetch;
  const oldEnv = { CI: process.env.CI, GITHUB_TOKEN: process.env.GITHUB_TOKEN, GITHUB_REPOSITORY: process.env.GITHUB_REPOSITORY, GITHUB_REF_NAME: process.env.GITHUB_REF_NAME };
  const postedPath = path.join(process.cwd(), "posted_items.json");
  const originalPosted = fs.readFileSync(postedPath, "utf-8");
  process.env.CI = "true"; process.env.GITHUB_TOKEN = "test-token"; process.env.GITHUB_REPOSITORY = "owner/repo"; process.env.GITHUB_REF_NAME = "main";
  fs.writeFileSync(postedPath, JSON.stringify({ postedItemCodes: ["required"], postTypeIndex: 1 }));
  globalThis.fetch = async (_input, init) => init?.method === "PUT"
    ? new Response("", { status: 500 })
    : new Response(JSON.stringify({ sha: "posted-sha", content: Buffer.from(JSON.stringify({ postedItemCodes: [] })).toString("base64") }), { status: 200 });
  try {
    await assert.rejects(persistPostedItemsAndVerify(["required"]), /remote保存に失敗/);
  } finally {
    fs.writeFileSync(postedPath, originalPosted);
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries(oldEnv)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});
