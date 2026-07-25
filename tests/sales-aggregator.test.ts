import { test } from "node:test";
import assert from "node:assert/strict";
import {
  salesScore,
  aggregateSlotSales,
  aggregateGenreSales,
  aggregatePriceBandSales,
  SALES_SCORE_WEIGHT,
} from "../src/agents/sales-aggregator";
import { deriveItemCode } from "../src/affiliate/report-parser";

test("salesScore: reward*0.7 + clicks*0.3", () => {
  assert.equal(salesScore({ reward: 100, clicks: 10 }), 100 * 0.7 + 10 * 0.3);
  assert.equal(salesScore({ reward: 0, clicks: 0 }), 0);
});

test("SALES_SCORE_WEIGHT: reward=0.7, clicks=0.3", () => {
  assert.equal(SALES_SCORE_WEIGHT.reward, 0.7);
  assert.equal(SALES_SCORE_WEIGHT.clicks, 0.3);
});

test("aggregateSlotSales: slot 別に score/reward/clicks を集計 (降順)", () => {
  const hA = deriveItemCode("shopA", "itemA");
  const hB = deriveItemCode("shopB", "itemB");
  const history = [
    { ts: "", itemCode: "", itemName: "", genreName: "", price: 1000, postType: 1, hour: 8, slot: "slot0", itemCodeHash: hA },
    { ts: "", itemCode: "", itemName: "", genreName: "", price: 5000, postType: 2, hour: 13, slot: "slot1", itemCodeHash: hB },
  ] as never[];
  const sales = [
    { date: "2026-07-25", itemCode: hA, trackingId: "", clicks: 5, orders: 1, reward: 100 },
    { date: "2026-07-25", itemCode: hB, trackingId: "", clicks: 20, orders: 3, reward: 900 },
  ];
  const result = aggregateSlotSales(history, sales);
  const s1 = result.find((r) => r.slot === "slot1");
  const s0 = result.find((r) => r.slot === "slot0");
  assert.ok(s1 && s0);
  assert.equal(s1.totalReward, 900);
  assert.equal(s1.totalClicks, 20);
  assert.equal(s1.salesScore, 900 * 0.7 + 20 * 0.3);
  assert.equal(s0.salesScore, 100 * 0.7 + 5 * 0.3);
  assert.equal(result[0].slot, "slot1");
});

test("aggregateGenreSales: genre 別集計", () => {
  const hA = deriveItemCode("s", "a");
  const history = [
    { ts: "", itemCode: "", itemName: "", genreName: "キッチン消耗品", price: 1000, postType: 1, hour: 8, slot: "slot0", itemCodeHash: hA },
  ] as never[];
  const sales = [
    { date: "2026-07-25", itemCode: hA, trackingId: "", clicks: 10, orders: 1, reward: 300 },
  ];
  const result = aggregateGenreSales(history, sales);
  assert.equal(result.length, 1);
  assert.equal(result[0].key, "キッチン消耗品");
  assert.equal(result[0].totalReward, 300);
});

test("aggregatePriceBandSales: 価格帯別集計", () => {
  const hA = deriveItemCode("s", "a");
  const hB = deriveItemCode("s", "b");
  const history = [
    { ts: "", itemCode: "", itemName: "", genreName: "", price: 1500, postType: 1, hour: 8, slot: "", itemCodeHash: hA },
    { ts: "", itemCode: "", itemName: "", genreName: "", price: 7000, postType: 1, hour: 8, slot: "", itemCodeHash: hB },
  ] as never[];
  const sales = [
    { date: "2026-07-25", itemCode: hA, trackingId: "", clicks: 10, orders: 1, reward: 300 },
    { date: "2026-07-25", itemCode: hB, trackingId: "", clicks: 5, orders: 1, reward: 800 },
  ];
  const result = aggregatePriceBandSales(history, sales);
  assert.ok(result.length >= 2);
  for (const r of result) {
    assert.ok(r.key.length > 0);
    assert.ok(r.salesScore > 0);
  }
});

test("aggregateSlotSales: 履歴に対応 sales が無ければ salesScore=0 でもエントリは作る", () => {
  const history = [
    { ts: "", itemCode: "", itemName: "", genreName: "", price: 1000, postType: 1, hour: 8, slot: "slot0", itemCodeHash: "no-match" },
  ] as never[];
  const result = aggregateSlotSales(history, []);
  const s = result.find((r) => r.slot === "slot0");
  assert.ok(s);
  assert.equal(s.posts, 1);
  assert.equal(s.matchedSales, 0);
  assert.equal(s.salesScore, 0);
});
