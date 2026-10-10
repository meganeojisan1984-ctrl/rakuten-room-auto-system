import { test } from "node:test";
import assert from "node:assert/strict";
import { createRoomPostIntent, hasUnresolvedRoomPostIntent } from "../src/room-post-intent";

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
