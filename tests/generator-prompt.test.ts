import { test } from "node:test";
import assert from "node:assert/strict";
import { buildFallbackCaption, buildPrompt, HUMAN_BUYER_COPY_RULES } from "../src/generator";
import type { ProductContentBrief } from "../src/content-brief";
import type { RakutenItem } from "../src/fetcher";

test("HUMAN_BUYER_COPY_RULES discourages AI-like copy while keeping purchase intent", () => {
  assert.match(HUMAN_BUYER_COPY_RULES, /AIっぽい/);
  assert.match(HUMAN_BUYER_COPY_RULES, /購入/);
  assert.match(HUMAN_BUYER_COPY_RULES, /断言しない/);
  assert.match(HUMAN_BUYER_COPY_RULES, /生活/);
});

test("fallback caption keeps posting alive when the text model is unavailable", () => {
  const item = {
    itemName: "収納ボックス",
    itemPrice: 1980,
    itemCaption: "棚のすき間に置きやすい収納用品です。",
    reviewAverage: 4.5,
    reviewCount: 123,
  } as RakutenItem;
  const caption = buildFallbackCaption(item);
  assert.match(caption, /収納ボックス/);
  assert.match(caption, /123件/);
  assert.doesNotMatch(caption, /実際に使った|買ってから生活が変わった/);
});

test("ROOM prompt includes the same content brief used for downstream creative", () => {
  const item = {
    itemName: "USB-C対応アルミハブ",
    itemPrice: 12800,
    itemCaption: "デスク周りの接続をまとめやすいUSBハブです。",
    shopName: "テストショップ",
    hasPointBonus: false,
    hasCoupon: false,
    pointRate: 0,
    reviewAverage: 4.5,
    reviewCount: 120,
  } as RakutenItem;
  const brief: ProductContentBrief = {
    itemName: item.itemName,
    displayName: item.itemName,
    audience: "husband",
    category: "PCガジェット",
    facts: ["USBハブ", "デスク周りの接続"],
    useCase: "在宅ワークの机で使う",
    angle: "男性目線で機能と使い勝手を見る",
    problem: "デスク周りの接続に迷う",
    solution: "機能と使い勝手を確認して選ぶ",
    seasonalHook: "",
    proofLine: "12,800円・レビュー120件・★4.5",
    imageComment: "PCガジェット｜デスク周りの接続を整理",
    purchaseCta: "価格とレビューを確認して詳細は楽天ROOMへ",
    hashtags: ["#PCガジェット"],
  };

  const prompt = buildPrompt(item, 2, "数字型", [], brief);
  assert.match(prompt, /共通コンテンツブリーフ/);
  assert.match(prompt, /PCガジェット/);
  assert.match(prompt, /機能と使い勝手/);
  assert.match(prompt, /デスク周りの接続を整理/);
  assert.ok(prompt.indexOf("悩み") < prompt.indexOf("解決"));
  assert.ok(prompt.indexOf("解決") < prompt.indexOf("購入導線"));
  assert.match(prompt, /男性目線/);
});
