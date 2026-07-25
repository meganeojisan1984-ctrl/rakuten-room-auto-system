import { test } from "node:test";
import assert from "node:assert/strict";
import {
  initDb,
  upsertSalesRow,
  getSalesByDateRange,
  getScrapeSummary,
} from "../src/affiliate/sales-db";

test("initDb creates sales table with expected columns", () => {
  const db = initDb(":memory:");
  const cols = db
    .prepare("PRAGMA table_info(sales)")
    .all() as Array<{ name: string }>;
  const names = cols.map((c) => c.name).sort();
  assert.deepEqual(names, [
    "clicks",
    "date",
    "item_code",
    "orders",
    "reward",
    "scraped_at",
    "tracking_id",
  ]);
  db.close();
});

test("upsertSalesRow inserts and upserts on same key", () => {
  const db = initDb(":memory:");
  upsertSalesRow(db, {
    date: "2026-07-25",
    itemCode: "shop:12345",
    trackingId: "slot0",
    clicks: 10,
    orders: 1,
    reward: 300,
  });
  upsertSalesRow(db, {
    date: "2026-07-25",
    itemCode: "shop:12345",
    trackingId: "slot0",
    clicks: 25,
    orders: 3,
    reward: 900,
  });
  const rows = getSalesByDateRange(db, "2026-07-25", "2026-07-25");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].clicks, 25);
  assert.equal(rows[0].orders, 3);
  assert.equal(rows[0].reward, 900);
  db.close();
});

test("getSalesByDateRange respects range boundaries", () => {
  const db = initDb(":memory:");
  const base = {
    itemCode: "shop:1",
    trackingId: "slot0",
    clicks: 1,
    orders: 0,
    reward: 0,
  };
  upsertSalesRow(db, { date: "2026-07-20", ...base });
  upsertSalesRow(db, { date: "2026-07-25", ...base });
  upsertSalesRow(db, { date: "2026-07-30", ...base });
  const rows = getSalesByDateRange(db, "2026-07-22", "2026-07-27");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].date, "2026-07-25");
  db.close();
});

test("getScrapeSummary aggregates totals", () => {
  const db = initDb(":memory:");
  upsertSalesRow(db, {
    date: "2026-07-25",
    itemCode: "shop:1",
    trackingId: "slot0",
    clicks: 10,
    orders: 1,
    reward: 300,
  });
  upsertSalesRow(db, {
    date: "2026-07-25",
    itemCode: "shop:2",
    trackingId: "slot1",
    clicks: 5,
    orders: 2,
    reward: 800,
  });
  const s = getScrapeSummary(db, "2026-07-25", "2026-07-25");
  assert.equal(s.rows, 2);
  assert.equal(s.totalClicks, 15);
  assert.equal(s.totalOrders, 3);
  assert.equal(s.totalReward, 1100);
  db.close();
});
