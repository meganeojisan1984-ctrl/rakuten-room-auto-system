import { test } from "node:test";
import assert from "node:assert/strict";
import { PRODUCT_CATEGORIES, type RakutenItem } from "../src/fetcher";
import { generateStrategyBriefMap } from "../src/sales-strategy";
import type { PersonaSlot } from "../src/persona/persona";

const category = PRODUCT_CATEGORIES.find((value) => value.name === "PCガジェット")!;
const persona = { id: "slot2", name: "夫", genres: ["PCガジェット"], hashtags: [] } as PersonaSlot;
const item = (code: string) => ({ itemCode: code, itemName: `商品${code}`, itemCaption: "デスク周りの接続を整理", itemPrice: 10000 } as RakutenItem);

test("商品ごとに戦略ブリーフを1回生成し、itemCodeで再利用できるMapを返す", async () => {
  const calls: string[] = [];
  const briefs = await generateStrategyBriefMap([item("a"), item("b")], persona, category, async (value) => {
    calls.push(value.itemCode);
    return {
      itemName: value.itemName, displayName: value.itemName, audience: "husband" as const,
      category: category.name, facts: ["接続"], useCase: "仕事", angle: "機能",
      problem: "接続に困る", solution: "機能で解決", seasonalHook: "", proofLine: "10,000円",
      imageComment: "接続を整理", purchaseCta: "詳細はROOMへ", hashtags: [], source: "fallback" as const,
      target: "仕事で使う人", need: "効率", purchaseReason: "比較", captionOutline: ["悩み", "解決", "根拠", "ROOM"], imageScene: "デスク",
    };
  });

  assert.deepEqual(calls, ["a", "b"]);
  assert.equal(briefs.get("a")?.target, "仕事で使う人");
  assert.equal(briefs.size, 2);
});
