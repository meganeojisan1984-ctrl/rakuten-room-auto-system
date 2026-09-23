import { test } from "node:test";
import assert from "node:assert/strict";
import { buildInstagramFinalCaption } from "../src/sns";
import type { RakutenItem } from "../src/fetcher";
import type { SalesStrategyBrief } from "../src/sales-strategy";

const item = { itemName: "高保湿美容液", itemPrice: 12800, itemCaption: "乾燥対策に使いやすい美容液です。" } as RakutenItem;
const brief: SalesStrategyBrief = {
  itemName: item.itemName, displayName: item.itemName, audience: "wife", category: "化粧品",
  facts: ["乾燥対策に使いやすい美容液"], useCase: "朝晩のケア", angle: "女性目線で続けやすさを見る",
  problem: "乾燥対策に迷う", solution: "毎日の保湿ケアに取り入れる", seasonalHook: "乾燥",
  proofLine: "12,800円・レビュー248件・★4.6", imageComment: "乾燥ケアを毎日の習慣に",
  purchaseCta: "詳細は楽天ROOMで確認", hashtags: ["#化粧品"], source: "api",
  target: "乾燥ケアを続けたい人", need: "続けやすい保湿ケア", purchaseReason: "価格とレビューを比較",
  captionOutline: ["悩み", "共感", "解決", "根拠", "ROOM"], imageScene: "朝の洗面台",
};

test("Instagram紹介文は戦略ブリーフの悩み・解決・根拠・CTAを同じ順で使う", async () => {
  const caption = await buildInstagramFinalCaption(item, "ROOM本文", brief);

  assert.ok(caption.indexOf(brief.problem) < caption.indexOf(brief.solution));
  assert.ok(caption.indexOf(brief.solution) < caption.indexOf(brief.proofLine));
  assert.ok(caption.indexOf(brief.proofLine) < caption.indexOf(brief.purchaseCta));
  assert.match(caption, /女性目線/);
});
