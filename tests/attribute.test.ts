import { test } from "node:test";
import assert from "node:assert/strict";
import { attributeSlots } from "../src/attribution/attribute";
import { deriveItemCode } from "../src/affiliate/report-parser";

test("attributeSlots: slot 別に matched sales を集計", () => {
  const hashA = deriveItemCode("shopA", "itemA");
  const hashB = deriveItemCode("shopB", "itemB");
  const history = [
    { ts: "2026-07-25T00:00:00Z", itemCode: "shopA:1", itemName: "itemA", genreName: "", price: 1000, postType: 1, hour: 8, slot: "slot0", itemCodeHash: hashA },
    { ts: "2026-07-25T13:00:00Z", itemCode: "shopB:2", itemName: "itemB", genreName: "", price: 5000, postType: 2, hour: 13, slot: "slot1", itemCodeHash: hashB },
  ] as never[];
  const sales = [
    { date: "2026-07-25", itemCode: hashA, trackingId: "楽天ROOM", clicks: 0, orders: 1, reward: 300 },
    { date: "2026-07-25", itemCode: hashB, trackingId: "楽天ROOM", clicks: 0, orders: 2, reward: 800 },
  ];
  const result = attributeSlots(history, sales);
  const s0 = result.find((r) => r.slot === "slot0");
  const s1 = result.find((r) => r.slot === "slot1");
  assert.ok(s0);
  assert.equal(s0.matchedSales, 1);
  assert.equal(s0.totalReward, 300);
  assert.ok(s1);
  assert.equal(s1.totalReward, 800);
});

test("attributeSlots: slot 未設定の履歴は 'unknown' でまとめる", () => {
  const history = [{ ts: "2026-07-25T00:00:00Z", itemCode: "x", itemName: "x", genreName: "", price: 1, postType: 1, hour: 1 }] as never[];
  const result = attributeSlots(history, []);
  const unk = result.find((r) => r.slot === "unknown");
  assert.ok(unk);
  assert.equal(unk.posts, 1);
  assert.equal(unk.matchedSales, 0);
});

test("attributeSlots: reward 降順でソートされる", () => {
  const hashA = deriveItemCode("shopA", "itemA");
  const hashB = deriveItemCode("shopB", "itemB");
  const history = [
    { ts: "", itemCode: "", itemName: "", genreName: "", price: 0, postType: 1, hour: 1, slot: "low", itemCodeHash: hashA },
    { ts: "", itemCode: "", itemName: "", genreName: "", price: 0, postType: 1, hour: 1, slot: "high", itemCodeHash: hashB },
  ] as never[];
  const sales = [
    { date: "2026-07-25", itemCode: hashA, trackingId: "", clicks: 0, orders: 1, reward: 100 },
    { date: "2026-07-25", itemCode: hashB, trackingId: "", clicks: 0, orders: 1, reward: 900 },
  ];
  const result = attributeSlots(history, sales);
  assert.equal(result[0].slot, "high");
  assert.equal(result[1].slot, "low");
});
