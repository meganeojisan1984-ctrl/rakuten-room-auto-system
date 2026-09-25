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

test("fallback caption uses the product brief to stay need-specific when the text model is out of credit", () => {
  const item = {
    itemName: "大風量ヘアドライヤー",
    itemPrice: 5980,
    itemCaption: "大風量で髪を乾かしやすい美容家電。",
    reviewAverage: 4.49,
    reviewCount: 8592,
  } as RakutenItem;
  const brief: ProductContentBrief = {
    itemName: item.itemName,
    displayName: item.itemName,
    audience: "wife",
    category: "美容家電",
    facts: ["大風量で髪を乾かしやすい", "冷風に対応"],
    useCase: "忙しい朝やお風呂上がりのヘアケア",
    angle: "乾かす時間と使いやすさを見る",
    problem: "お風呂上がりの髪を乾かす時間が気になる人へ",
    solution: "大風量と冷風の仕様を確認して選ぶ",
    seasonalHook: "",
    proofLine: "5,980円・レビュー8592件・★4.49",
    imageComment: "美容家電｜大風量で髪を乾かしやすい",
    purchaseCta: "価格とレビューを確認して詳細は楽天ROOMへ",
    hashtags: ["#美容家電"],
  };
  const caption = buildFallbackCaption(item, brief);
  assert.match(caption, /お風呂上がり|乾かす時間/);
  assert.match(caption, /大風量|冷風/);
  assert.doesNotMatch(caption, /暮らしの中の「あと少し不便」/);
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
