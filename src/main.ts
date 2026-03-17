import * as dotenv from "dotenv";
dotenv.config();

import { fetchItems } from "./fetcher";
import { generateCaptions } from "./generator";
import { postItems } from "./poster";
import { notifyError } from "./notifiers";

const POST_COUNT = parseInt(process.env.POST_COUNT ?? "3", 10);

async function main(): Promise<void> {
  console.log("=== 楽天ROOM自動投稿システム 開始 ===");
  console.log(`実行時刻: ${new Date().toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })}`);
  console.log(`ターゲットジャンル: ${process.env.TARGET_GENRE ?? "general"}`);
  console.log(`投稿数: ${POST_COUNT}件\n`);

  // Step 1: 楽天APIから商品を取得
  let items;
  try {
    console.log("--- [1/3] 商品取得中 ---");
    items = await fetchItems(POST_COUNT);
    if (items.length === 0) {
      throw new Error("フィルタリング後に使用可能な商品が0件でした");
    }
    console.log(`商品取得完了: ${items.length}件\n`);
  } catch (err) {
    const msg = String(err);
    console.error("商品取得エラー:", msg);
    await notifyError("楽天API商品取得エラー", msg);
    process.exit(1);
  }

  // Step 2: Gemini APIで紹介文を生成
  let captionedItems;
  try {
    console.log("--- [2/3] 紹介文生成中 ---");
    captionedItems = await generateCaptions(items);
    if (captionedItems.length === 0) {
      throw new Error("紹介文の生成に全て失敗しました");
    }
    console.log(`紹介文生成完了: ${captionedItems.length}件\n`);
  } catch (err) {
    const msg = String(err);
    console.error("紹介文生成エラー:", msg);
    await notifyError("Gemini API紹介文生成エラー", msg);
    process.exit(1);
  }

  // Step 3: 楽天ROOMへ投稿
  let results;
  try {
    console.log("--- [3/3] 楽天ROOMへ投稿中 ---");
    const headless = process.env.CI === "true" || process.env.HEADLESS !== "false";
    results = await postItems(captionedItems, headless);
  } catch (err) {
    const msg = String(err);
    console.error("投稿処理中に予期しないエラー:", msg);
    await notifyError("投稿処理エラー", msg);
    process.exit(1);
  }

  // 結果サマリー
  const succeeded = results.filter((r) => r.success).length;
  const failed = results.filter((r) => !r.success).length;

  console.log("\n=== 実行結果 ===");
  console.log(`✅ 成功: ${succeeded}件`);
  console.log(`❌ 失敗: ${failed}件`);

  if (failed > 0) {
    const errors = results
      .filter((r) => !r.success)
      .map((r) => `- ${r.itemName.slice(0, 30)}: ${r.error ?? "不明なエラー"}`)
      .join("\n");
    console.error("失敗した商品:\n" + errors);
  }

  // 全件失敗の場合は異常終了
  if (succeeded === 0) {
    await notifyError("全件投稿失敗", `${failed}件の投稿が全て失敗しました`);
    process.exit(1);
  }

  console.log("\n=== 楽天ROOM自動投稿システム 完了 ===");
}

main().catch(async (err) => {
  console.error("予期しない致命的エラー:", err);
  await notifyError("致命的エラー", String(err));
  process.exit(1);
});
