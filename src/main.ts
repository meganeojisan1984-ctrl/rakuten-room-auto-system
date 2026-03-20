import * as dotenv from "dotenv";
dotenv.config();

import * as fs from "fs";
import * as path from "path";
import { fetchItems } from "./fetcher";
import { generateCaptions, type PostType } from "./generator";
import { postItems } from "./poster";
import { postToX } from "./x-poster";
import { notifyError } from "./notifiers";

const POSTED_ITEMS_FILE = path.join(process.cwd(), "posted_items.json");
const MAX_HISTORY = 500; // 保持する最大件数

interface PostedItemsState {
  postedItemCodes: string[];
  postTypeIndex: number; // 0=評価取り, 1=売上, 2=送客 → ローテーション
}

function loadState(): { codes: Set<string>; postTypeIndex: number } {
  try {
    const data: PostedItemsState = JSON.parse(fs.readFileSync(POSTED_ITEMS_FILE, "utf-8"));
    return {
      codes: new Set<string>(data.postedItemCodes ?? []),
      postTypeIndex: data.postTypeIndex ?? 0,
    };
  } catch {
    return { codes: new Set<string>(), postTypeIndex: 0 };
  }
}

function saveState(codes: Set<string>, postTypeIndex: number): void {
  const arr = [...codes].slice(-MAX_HISTORY);
  const state: PostedItemsState = { postedItemCodes: arr, postTypeIndex };
  fs.writeFileSync(POSTED_ITEMS_FILE, JSON.stringify(state, null, 2));
}

/**
 * 投稿タイプのローテーション:
 * 1=評価取り投稿（クリック・ROOM回遊目的）
 * 2=売上投稿（成約目的）
 * 3=送客投稿（楽天市場誘導）
 */
function getPostType(index: number): PostType {
  const types: PostType[] = [1, 2, 3];
  return types[index % 3]!;
}

function getPostTypeLabel(postType: PostType): string {
  switch (postType) {
    case 1: return "評価取り投稿（クリック・ROOM回遊目的）";
    case 2: return "売上投稿（成約目的）";
    case 3: return "送客投稿（楽天市場誘導）";
  }
}

const POST_COUNT = parseInt(process.env.POST_COUNT ?? "1", 10);

async function main(): Promise<void> {
  console.log("=== 楽天ROOM自動投稿システム 開始 ===");
  console.log(`実行時刻: ${new Date().toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })}`);
  console.log(`ターゲットジャンル: ${process.env.TARGET_GENRE ?? "general"}`);
  console.log(`投稿数: ${POST_COUNT}件\n`);

  const { codes: postedCodes, postTypeIndex } = loadState();
  const postType = getPostType(postTypeIndex);
  console.log(`[main] 投稿済み商品数: ${postedCodes.size}件（除外対象）`);
  console.log(`[main] 今回の投稿タイプ: ${getPostTypeLabel(postType)}\n`);

  // Step 1: 楽天APIから商品を取得
  let items;
  try {
    console.log("--- [1/3] 商品取得中 ---");
    items = await fetchItems(POST_COUNT, postedCodes);
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

  // Step 2: 紹介文を生成（投稿タイプを渡す）
  let captionedItems;
  try {
    console.log("--- [2/3] 紹介文生成中 ---");
    captionedItems = await generateCaptions(items, postType);
    if (captionedItems.length === 0) {
      throw new Error("紹介文の生成に全て失敗しました");
    }
    console.log(`紹介文生成完了: ${captionedItems.length}件\n`);
  } catch (err) {
    const msg = String(err);
    console.error("紹介文生成エラー:", msg);
    await notifyError("紹介文生成エラー", msg);
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

  // Step 4: X(Twitter)へ投稿（ROOM投稿成功分のみ）
  const xEnabled =
    process.env.X_API_KEY &&
    process.env.X_API_SECRET &&
    process.env.X_ACCESS_TOKEN &&
    process.env.X_ACCESS_TOKEN_SECRET;

  if (xEnabled) {
    console.log("--- [4/4] X(Twitter)へ投稿中 ---");
    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      const captioned = captionedItems[i];
      if (!result?.success || !captioned) continue;

      await postToX(captioned.item.itemName, captioned.item.itemUrl, captioned.xCaption);

      // 連続投稿時はレート制限対策で間隔を空ける
      if (i < results.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, 3000));
      }
    }
    console.log("");
  } else {
    console.log("[main] X API認証情報が未設定のためX投稿をスキップします\n");
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

  // 成功した商品を投稿済みリストに追加して保存。投稿タイプを次に進める
  const successCodes = captionedItems
    .filter((_, i) => results[i]?.success)
    .map((c) => c.item.itemCode);
  for (const code of successCodes) postedCodes.add(code);
  const nextPostTypeIndex = (postTypeIndex + 1) % 3;
  if (successCodes.length > 0 || true) {
    saveState(postedCodes, nextPostTypeIndex);
    console.log(`[main] 投稿済みリストを更新: ${successCodes.length}件追加`);
    console.log(`[main] 次回の投稿タイプ: ${getPostTypeLabel(getPostType(nextPostTypeIndex))}`);
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
