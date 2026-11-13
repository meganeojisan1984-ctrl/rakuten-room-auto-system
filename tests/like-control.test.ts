import { test } from "node:test";
import assert from "node:assert/strict";
import { confirmLike, LIKED_ICON } from "../src/actions/like-control";

function mockButton(initial: "outline" | "filled" | "missing", mode = "success") {
  let state = initial;
  let clicks = 0;
  const button = {
    locator(selector: string) {
      const target = selector === LIKED_ICON ? "filled" : "outline";
      const icon = {
        first: () => icon,
        isVisible: async () => state === target,
        waitFor: async () => { if (state !== target) throw new Error("timeout"); },
      };
      return icon;
    },
    scrollIntoViewIfNeeded: async () => {},
    click: async () => {
      clicks++;
      if (mode !== "no-op") state = "filled";
      if (mode === "timeout") throw new Error("click timeout");
    },
  };
  return {
    button: button as unknown as Parameters<typeof confirmLike>[0],
    clicks: () => clicks,
    setState: (next: typeof state) => { state = next; },
  };
}

test("existing filled icon is never toggled", async () => {
  const mock = mockButton("filled");
  assert.equal(await confirmLike(mock.button, async () => {}), "already-liked");
  assert.equal(mock.clicks(), 0);
});

test("late hydration from outline to filled prevents an unlike", async () => {
  const mock = mockButton("outline");
  let reads = 0;
  assert.equal(await confirmLike(mock.button, async () => {
    if (++reads === 2) mock.setState("filled");
  }), "already-liked");
  assert.equal(mock.clicks(), 0);
});

test("unliked control receives exactly one click and confirms filled", async () => {
  const mock = mockButton("outline");
  assert.equal(await confirmLike(mock.button, async () => {}), "liked");
  assert.equal(mock.clicks(), 1);
});

test("a no-op is not counted and is never clicked twice", async () => {
  const mock = mockButton("outline", "no-op");
  await assert.rejects(confirmLike(mock.button, async () => {}), /結果が不明/);
  assert.equal(mock.clicks(), 1);
});

test("uncertain click timeout is not retried", async () => {
  const mock = mockButton("outline", "timeout");
  await assert.rejects(confirmLike(mock.button, async () => {}), /click timeout/);
  assert.equal(mock.clicks(), 1);
});

test("optimistic state rolled back after loading is not success", async () => {
  const mock = mockButton("outline");
  let waits = 0;
  await assert.rejects(confirmLike(mock.button, async () => {
    if (++waits === 3) mock.setState("outline");
  }), /維持されません/);
  assert.equal(mock.clicks(), 1);
});

test("unknown control is never clicked", async () => {
  const mock = mockButton("missing");
  await assert.rejects(confirmLike(mock.button, async () => {}), /確認できません/);
  assert.equal(mock.clicks(), 0);
});

test("unfinished network state prevents a click", async () => {
  const mock = mockButton("outline");
  await assert.rejects(confirmLike(mock.button, async () => { throw new Error("network busy"); }), /network busy/);
  assert.equal(mock.clicks(), 0);
});
