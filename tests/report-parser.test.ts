import { test } from "node:test";
import assert from "node:assert/strict";
import { parseAffiliateCsv } from "../src/affiliate/report-parser";

test("parseAffiliateCsv: 基本形（クリック/成果/報酬 列）", () => {
  const csv = [
    "商品コード,商品名,クリック数,成果件数,報酬額",
    "shop-a:10001,テスト商品A,15,2,600",
    "shop-b:20002,テスト商品B,3,0,0",
  ].join("\n");
  const rows = parseAffiliateCsv(csv, { date: "2026-07-25", defaultTrackingId: "slot0" });
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], {
    date: "2026-07-25",
    itemCode: "shop-a:10001",
    trackingId: "slot0",
    clicks: 15,
    orders: 2,
    reward: 600,
  });
  assert.equal(rows[1].reward, 0);
});

test("parseAffiliateCsv: カンマ入り金額と円記号を除去", () => {
  const csv = [
    "商品コード,クリック数,成果件数,報酬額",
    "shop:1,120,3,\"¥1,250\"",
  ].join("\n");
  const rows = parseAffiliateCsv(csv, { date: "2026-07-25" });
  assert.equal(rows[0].reward, 1250);
});

test("parseAffiliateCsv: トラッキングID列が存在すればそれを優先", () => {
  const csv = [
    "商品コード,クリック数,成果件数,報酬額,トラッキングID",
    "shop:1,5,1,300,slot2-furusato",
  ].join("\n");
  const rows = parseAffiliateCsv(csv, { date: "2026-07-25", defaultTrackingId: "slot0" });
  assert.equal(rows[0].trackingId, "slot2-furusato");
});

test("parseAffiliateCsv: 必須列が無い場合は throw", () => {
  const csv = "商品名,クリック数\nテスト,10";
  assert.throws(
    () => parseAffiliateCsv(csv, { date: "2026-07-25" }),
    /商品コード列が見つかりません/,
  );
});

test("parseAffiliateCsv: 空行を無視", () => {
  const csv = [
    "商品コード,クリック数,成果件数,報酬額",
    "",
    "shop:1,10,1,300",
    "   ",
    "shop:2,5,0,0",
  ].join("\n");
  const rows = parseAffiliateCsv(csv, { date: "2026-07-25" });
  assert.equal(rows.length, 2);
});
