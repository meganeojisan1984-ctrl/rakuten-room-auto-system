import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createNetworkSettler } from "../src/actions/network-settler";

test("fresh scroll requests are awaited even after an earlier idle state", async () => {
  const page = new EventEmitter();
  const guard = createNetworkSettler(page as unknown as Parameters<typeof createNetworkSettler>[0]);
  try {
    await guard.waitForQuiet(100, 1);
    const request = {};
    page.emit("request", request);
    let ready = false;
    const pending = guard.waitForQuiet(500, 1).then(() => { ready = true; });
    await new Promise((resolve) => setTimeout(resolve, 40));
    assert.equal(ready, false);
    page.emit("requestfinished", request);
    await pending;
    assert.equal(ready, true);
  } finally {
    guard.dispose();
    assert.equal(page.listenerCount("request"), 0);
    assert.equal(page.listenerCount("requestfinished"), 0);
    assert.equal(page.listenerCount("requestfailed"), 0);
  }
});

test("unfinished hydration requests fail closed", async () => {
  const page = new EventEmitter();
  const guard = createNetworkSettler(page as unknown as Parameters<typeof createNetworkSettler>[0]);
  try {
    page.emit("request", {});
    await assert.rejects(guard.waitForQuiet(30, 1), /読み込みが完了しません/);
  } finally { guard.dispose(); }
});

test("failed hydration requests never authorize a click", async () => {
  const page = new EventEmitter();
  const guard = createNetworkSettler(page as unknown as Parameters<typeof createNetworkSettler>[0]);
  try {
    const request = {};
    page.emit("request", request);
    page.emit("requestfailed", request);
    await assert.rejects(guard.waitForQuiet(100, 1), /通信が失敗/);
  } finally { guard.dispose(); }
});


test("error HTTP responses fail closed", async () => {
  const page = new EventEmitter();
  const guard = createNetworkSettler(page as unknown as Parameters<typeof createNetworkSettler>[0]);
  try {
    page.emit("response", { status: () => 500 });
    await assert.rejects(guard.waitForQuiet(100, 1), /応答にエラー/);
  } finally { guard.dispose(); }
});


test("requests begun during a render delay must settle before acting", async () => {
  const page = new EventEmitter();
  const guard = createNetworkSettler(page as unknown as Parameters<typeof createNetworkSettler>[0]);
  try {
    await guard.waitForQuiet(100, 1);
    // Model a request that begins after the first quiet check, during rendering.
    const request = {};
    page.emit("request", request);
    let acted = false;
    const finalCheck = guard.waitForQuiet(500, 1).then(() => { acted = true; });
    await new Promise((resolve) => setTimeout(resolve, 40));
    assert.equal(acted, false);
    page.emit("requestfinished", request);
    await finalCheck;
    assert.equal(acted, true);
  } finally { guard.dispose(); }
});
