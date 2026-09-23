import { test } from "node:test";
import assert from "node:assert/strict";
import { PRODUCT_CATEGORIES, type RakutenItem } from "../src/fetcher";
import { buildProductContentBrief } from "../src/content-brief";
import type { PersonaSlot } from "../src/persona/persona";

const wife = { id: "slot0", name: "美容を楽しむ妻", hashtags: ["#美容"] } as PersonaSlot;
const husband = { id: "slot2", name: "家電好きの夫", hashtags: ["#ガジェット"] } as PersonaSlot;
const item = {
  itemName: "高保湿美容液 乾燥対策 セット",
  itemCaption: "乾燥しやすい季節の保湿ケアに。毎日のスキンケアに取り入れやすい美容液です。",
  itemPrice: 12800,
  reviewAverage: 4.6,
  reviewCount: 248,
} as RakutenItem;

test("共通ブリーフは女性向けカテゴリの季節フックと根拠を保持する", () => {
  const category = PRODUCT_CATEGORIES.find((value) => value.name === "化粧品")!;
  const brief = buildProductContentBrief(item, wife, category, new Date("2026-10-01T00:00:00+09:00"));

  assert.equal(brief.audience, "wife");
  assert.equal(brief.category, "化粧品");
  assert.match(brief.angle, /女性目線/);
  assert.match(brief.seasonalHook, /乾燥|保湿/);
  assert.match(brief.proofLine, /12,800円/);
  assert.match(brief.proofLine, /248件/);
  assert.match(brief.imageComment, /化粧品/);
  assert.match(brief.imageComment, /乾燥/);
  assert.match(brief.problem, /乾燥/);
  assert.match(brief.solution, /化粧品/);
  assert.match(brief.purchaseCta, /ROOM/);
});

test("共通ブリーフは男性向けカテゴリで機能軸を明示し、根拠のない効果を作らない", () => {
  const category = PRODUCT_CATEGORIES.find((value) => value.name === "PCガジェット")!;
  const brief = buildProductContentBrief(
    { ...item, itemName: "USB-C対応アルミハブ", itemCaption: "デスク周りの接続をまとめやすいUSBハブです。" },
    husband,
    category,
  );

  assert.equal(brief.audience, "husband");
  assert.match(brief.angle, /機能|耐久性/);
  assert.match(brief.facts.join(" "), /USBハブ/);
  assert.match(brief.problem, /接続|デスク/);
  assert.match(brief.solution, /機能/);
  assert.doesNotMatch(`${brief.angle} ${brief.useCase} ${brief.imageComment}`, /絶対に痩せる|必ず若返る|治る/);
});
