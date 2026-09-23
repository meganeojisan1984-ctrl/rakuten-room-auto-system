import { test } from "node:test";
import assert from "node:assert/strict";
import { PRODUCT_CATEGORIES, type RakutenItem } from "../src/fetcher";
import { generateSalesStrategyBrief } from "../src/sales-strategy";
import type { PersonaSlot } from "../src/persona/persona";

const item = {
  itemName: "高保湿美容液 乾燥対策 セット",
  itemCaption: "乾燥しやすい季節の保湿ケアに。毎日のスキンケアに取り入れやすい美容液です。",
  itemPrice: 12800,
  reviewAverage: 4.6,
  reviewCount: 248,
  hasCoupon: true,
  hasPointBonus: true,
  pointRate: 5,
} as RakutenItem;
const wife = { id: "slot0", name: "美容を楽しむ妻", genres: ["化粧品"], hashtags: ["#美容"] } as PersonaSlot;
const category = PRODUCT_CATEGORIES.find((value) => value.name === "化粧品")!;

function response(value: unknown) {
  return { output_text: JSON.stringify(value) };
}

test("販売戦略APIは商品把握・ニーズ・購入導線を含む構造化ブリーフを返す", async () => {
  let requestText = "";
  const result = await generateSalesStrategyBrief(item, wife, category, {
    client: async (body) => {
      requestText = String(body.input);
      return response({
        target: "乾燥ケアを続けたい人",
        problem: "季節の乾燥対策に迷う",
        need: "毎日続けやすい保湿ケア",
        solution: "商品説明にある保湿用途を確認して選ぶ",
        angle: "女性目線で続けやすさを見る",
        captionOutline: ["悩み", "共感", "解決", "根拠", "ROOM"],
        imageScene: "朝の洗面台、清潔で落ち着いた雰囲気",
        imageComment: "乾燥ケアを毎日の習慣に",
        purchaseCta: "詳細は楽天ROOMで確認",
        purchaseReason: "価格とレビューを確認して比較できる",
      });
    },
    apiKey: "test-key",
  });

  assert.equal(result.source, "api");
  assert.equal(result.target, "乾燥ケアを続けたい人");
  assert.match(requestText, /高保湿美容液/);
  assert.match(requestText, /12,800円/);
  assert.match(requestText, /女性/);
  assert.match(requestText, /悩み.*解決.*根拠.*購入|悩み.*購入導線/s);
});

test("空・不正なAPI応答は商品情報ベースのフォールバックへ切り替える", async () => {
  const result = await generateSalesStrategyBrief(item, wife, category, {
    client: async () => ({ output_text: "これはJSONではない説明文です" }),
    apiKey: "test-key",
  });

  assert.equal(result.source, "fallback");
  assert.match(result.problem, /乾燥|化粧品/);
  assert.match(result.solution, /化粧品/);
  assert.match(result.proofLine, /12,800円/);
  assert.match(result.purchaseCta, /ROOM/);
});

test("APIエラーでも投稿を止めずフォールバックする", async () => {
  const result = await generateSalesStrategyBrief(item, wife, category, {
    client: async () => { throw new Error("timeout"); },
    apiKey: "test-key",
  });

  assert.equal(result.source, "fallback");
  assert.equal(result.audience, "wife");
});
