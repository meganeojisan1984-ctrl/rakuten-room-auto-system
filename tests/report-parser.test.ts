import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { parseOrderCsv, deriveItemCode } from "../src/affiliate/report-parser";

const SAMPLE_CSV = `﻿"注文別成果: 2026.07"

ステータス,リンクタイプ,,,,,デバイスタイプ
"0 - 未確定","0 - その他","5 - ショップリンク（検索窓）","10 - 楽天モーションウィジェット","15 - 売れ筋アイテムリンク","20 - 楽天ブログパーツ","0 - その他"
"1 - 確定","1 - 商品リンク","6 - 楽天アフィリエイトバナー（画像）","11 - リアルタイムランキングウィジェット","16 - 楽天セレクトウィジェット","21 - お気に入りブックマークリンク","1 - PC"


発生日,成果報酬,料率,売上金額,ジャンル名,ショップ名,商品名,ステータス,リンクタイプ,デバイスタイプ,計測ID
date,rewards,rate,amount,genre_name,shop_name,item_name,status,link_type,device_type,measurement_id
"2026-07-04 21:54:33",93,3.0,3132,インテリア,"アストロ","衣類カバー",0,1,3,楽天ROOM
"2026-07-05 09:17:23",252,13.0,1939,日用品,"SUISOSUM","水素入浴剤 750g",0,1,3,楽天ROOM
"2026-07-05 09:17:23",179,13.0,1378,日用品,"SUISOSUM","水素入浴剤 350g",0,1,3,楽天ROOM
`;

test("parseOrderCsv: 凡例をスキップして英語ヘッダから読み始める", () => {
  const rows = parseOrderCsv(SAMPLE_CSV);
  assert.equal(rows.length, 3);
});

test("parseOrderCsv: 発生日タイムスタンプを YYYY-MM-DD に丸める", () => {
  const rows = parseOrderCsv(SAMPLE_CSV);
  assert.equal(rows[0].date, "2026-07-04");
  assert.equal(rows[1].date, "2026-07-05");
});

test("parseOrderCsv: 計測ID を trackingId に採用", () => {
  const rows = parseOrderCsv(SAMPLE_CSV);
  assert.equal(rows[0].trackingId, "楽天ROOM");
});

test("parseOrderCsv: 同一(date,itemCode,trackingId) は集約（orders += 1, reward += ）", () => {
  const dup = SAMPLE_CSV + '"2026-07-04 22:10:00",50,3.0,1666,インテリア,"アストロ","衣類カバー",0,1,3,楽天ROOM\n';
  const rows = parseOrderCsv(dup);
  const iroi = rows.find((r) => r.date === "2026-07-04");
  assert.ok(iroi);
  assert.equal(iroi.orders, 2);
  assert.equal(iroi.reward, 143);
});

test("parseOrderCsv: targetDate 指定でその日のみ抽出", () => {
  const rows = parseOrderCsv(SAMPLE_CSV, { targetDate: "2026-07-05" });
  assert.equal(rows.length, 2);
  assert.ok(rows.every((r) => r.date === "2026-07-05"));
});

test("parseOrderCsv: 英語ヘッダが無ければ throw", () => {
  assert.throws(
    () => parseOrderCsv("no header here\njust,random,data"),
    /英語ヘッダ行/,
  );
});

test("parseOrderCsv: clicks は常に 0（この CSV に含まれないため）", () => {
  const rows = parseOrderCsv(SAMPLE_CSV);
  assert.ok(rows.every((r) => r.clicks === 0));
});

test("deriveItemCode: 決定論的で12桁 hex", () => {
  const a = deriveItemCode("shopA", "item1");
  const b = deriveItemCode("shopA", "item1");
  const c = deriveItemCode("shopA", "item2");
  assert.equal(a, b);
  assert.notEqual(a, c);
  assert.match(a, /^[0-9a-f]{12}$/);
});

test("parseOrderCsv: 実CSVサンプル（fixtures があれば）で 6行程度を集約する", () => {
  const fixturePath = path.join(process.cwd(), "data", "affiliate-debug", "order-2026-07.csv");
  if (!fs.existsSync(fixturePath)) {
    // fixture が無い環境ではスキップ扱い
    return;
  }
  const csv = fs.readFileSync(fixturePath, "utf-8");
  const rows = parseOrderCsv(csv);
  // 少なくとも1件はある / 全て発生日が YYYY-MM-DD 形式
  assert.ok(rows.length > 0);
  for (const r of rows) {
    assert.match(r.date, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(r.orders >= 1);
    assert.ok(r.reward >= 0);
  }
});
