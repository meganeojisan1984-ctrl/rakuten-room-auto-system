import { test } from "node:test";
import assert from "node:assert/strict";
import { confirmFollow, FOLLOW_BUTTON_NAME, FOLLOWING_BUTTON_NAME } from "../src/actions/follow-control";

function mockPage(initial: "follow" | "following" | "missing", mode = "success") {
  let state = initial;
  let clicks = 0;
  const page = {
    getByRole(role: string, options: { name: RegExp }) {
      assert.equal(role, "button");
      const target = options.name.test("フォロー") ? "follow" : "following";
      const locator = {
        first: () => locator,
        waitFor: async () => { if (state !== target) throw new Error("timeout"); },
        isVisible: async () => state === target,
        scrollIntoViewIfNeeded: async () => {},
        click: async () => {
          clicks++;
          if (mode !== "unconfirmed") state = "following";
          if (mode === "click-timeout") throw new Error("click timeout");
        },
      };
      return locator;
    },
  };
  return { page: page as unknown as Parameters<typeof confirmFollow>[0], clicks: () => clicks };
}

test("current and legacy exact follow labels exclude count buttons", () => {
  assert.ok(FOLLOW_BUTTON_NAME.test("フォロー"));
  assert.ok(FOLLOW_BUTTON_NAME.test("フォローする"));
  assert.ok(FOLLOWING_BUTTON_NAME.test("フォロー中"));
  for (const text of ["フォロー 1,983", "フォロワー 1,003", "フォロー解除"]) {
    assert.equal(FOLLOW_BUTTON_NAME.test(text), false);
    assert.equal(FOLLOWING_BUTTON_NAME.test(text), false);
  }
});

test("confirmed existing follow is never clicked", async () => {
  const mock = mockPage("following");
  assert.equal(await confirmFollow(mock.page), "already-following");
  assert.equal(mock.clicks(), 0);
});

test("missing control is an error, not an existing follow", async () => {
  const mock = mockPage("missing");
  await assert.rejects(confirmFollow(mock.page), /DBには記録しません/);
  assert.equal(mock.clicks(), 0);
});

test("one click counts only after following state is visible", async () => {
  const mock = mockPage("follow");
  let checks = 0;
  assert.equal(await confirmFollow(mock.page, async () => { checks++; }), "followed");
  assert.equal(checks, 1);
  assert.equal(mock.clicks(), 1);
});

test("unconfirmed response is not retried or counted as success", async () => {
  const mock = mockPage("follow", "unconfirmed");
  await assert.rejects(confirmFollow(mock.page), /結果が不明/);
  assert.equal(mock.clicks(), 1);
});

test("uncertain click timeout is not retried", async () => {
  const mock = mockPage("follow", "click-timeout");
  await assert.rejects(confirmFollow(mock.page), /click timeout/);
  assert.equal(mock.clicks(), 1);
});

test("failed rate or stop check prevents the click", async () => {
  const mock = mockPage("follow");
  await assert.rejects(confirmFollow(mock.page, async () => { throw new Error("stopped"); }), /stopped/);
  assert.equal(mock.clicks(), 0);
});
