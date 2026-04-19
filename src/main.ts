import * as dotenv from "dotenv";
dotenv.config();

import * as fs from "fs";
import * as path from "path";
import { fetchItems, fetchItemsByKeyword, type RakutenItem } from "./fetcher";
import { generateCaptions, generateTrendCaptions, type PostType } from "./generator";
import { fetchTrendKeyword } from "./trend-fetcher";
import { postItems, type PostResult } from "./poster";
import { notifyError } from "./notifiers";

const POSTED_ITEMS_FILE = path.join(process.cwd(), "posted_items.json");
const MAX_HISTORY = 500; // 保持する最大件数
const MAX_INELIGIBLE_HISTORY = 1000; // 投稿不可商品は多めに保持して永続スキップ
const MAX_INELIGIBLE_RETRIES = 3; // 投稿不可商品が出た場合の代替商品取得リトライ上限

interface PostedItemsState {
  postedItemCodes: string[];
  ineligibleItemCodes?: string[]; // 楽天ROOMに投稿不可と判明した商品（永続スキップ）
  postTypeIndex: number; // 0=評価取り, 1=売上, 2=送客 → ローテーション
}

function loadState(): { codes: Set<string>; ineligibleCodes: Set<string>; postTypeIndex: number } {
  try {
    const data: PostedItemsState = JSON.parse(fs.readFileSync(POSTED_ITEMS_FILE, "utf-8"));
    return {
      codes: new Set<string>(data.postedItemCodes ?? []),
      ineligibleCodes: new Set<string>(data.ineligibleItemCodes ?? []),
      postTypeIndex: data.postTypeIndex ?? 0,
    };
  } catch {
    return { codes: new Set<string>(), ineligibleCodes: new Set<string>(), postTypeIndex: 0 };
  }
}

function saveState(codes: Set<string>, ineligibleCodes: Set<string>, postTypeIndex: number): void {
  const arr = [...codes].slice(-MAX_HISTORY);
  const ineligibleArr = [...ineligibleCodes].slice(-MAX_INELIGIBLE_HISTORY);
  const state: PostedItemsState = {
    postedItemCodes: arr,
    ineligibleItemCodes: ineligibleArr,
    postTypeIndex,
  };
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
const TREND_MODE = process.env.TREND_MODE === "true";

async function main(): Promise<void> {
  console.log("=== 楽天ROOM自動投稿システム 開始 ===");
  console.log(`実行時刻: ${new Date().toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })}`);
  console.log(`モード: ${TREND_MODE ? "トレンド投稿" : `ランキング投稿 (${process.env.TARGET_GENRE ?? "general"})`}`);
  console.log(`投稿数: ${POST_COUNT}件\n`);

  const { codes: postedCodes, ineligibleCodes, postTypeIndex } = loadState();
  const postType = getPostType(postTypeIndex);
  console.log(`[main] 投稿済み商品数: ${postedCodes.size}件 / 投稿不可スキップ: ${ineligibleCodes.size}件（除外対象）`);
  if (!TREND_MODE) {
    console.log(`[main] 今回の投稿タイプ: ${getPostTypeLabel(postType)}\n`);
  }

  // 取得時の除外セット（投稿済み + 投稿不可と判明した商品）
  const excludeCodes = new Set<string>([...postedCodes, ...ineligibleCodes]);

  // Step 1: 商品取得
  let items: RakutenItem[];
  let trendKeyword: string | undefined;
  try {
    if (TREND_MODE) {
      console.log("--- [1/3] トレンドキーワード取得 → 商品検索中 ---");
      trendKeyword = await fetchTrendKeyword();
      console.log(`トレンドキーワード: 「${trendKeyword}」`);
      items = await fetchItemsByKeyword(trendKeyword, POST_COUNT, excludeCodes);
      // キーワード検索でヒットしない場合はランキングにフォールバック
      if (items.length === 0) {
        console.warn(`[main] キーワード「${trendKeyword}」で商品なし。ランキングにフォールバック`);
        items = await fetchItems(POST_COUNT, excludeCodes);
        trendKeyword = undefined; // フォールバック時はGemini生成も通常モードへ
      }
    } else {
      console.log("--- [1/3] 商品取得中 ---");
      items = await fetchItems(POST_COUNT, excludeCodes);
    }
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

  // 紹介文生成のヘルパー（リトライ時も再利用）
  const generateForItems = async (
    targetItems: RakutenItem[]
  ): Promise<Array<{ item: RakutenItem; caption: string }>> => {
    if (trendKeyword) {
      return generateTrendCaptions(trendKeyword, targetItems);
    }
    return generateCaptions(targetItems, postType);
  };

  // Step 2: 紹介文を生成
  let captionedItems: Array<{ item: RakutenItem; caption: string }>;
  try {
    console.log("--- [2/3] 紹介文生成中 ---");
    captionedItems = await generateForItems(items);
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

  // Step 3: 楽天ROOMへ投稿（投稿不可商品が出たら代替商品で最大N回リトライ）
  console.log("--- [3/3] 楽天ROOMへ投稿中 ---");
  const headless = process.env.CI === "true" || process.env.HEADLESS !== "false";
  const allResults: PostResult[] = [];

  let pending = captionedItems;
  for (let retry = 0; retry <= MAX_INELIGIBLE_RETRIES; retry++) {
    let batchResults: PostResult[];
    try {
      batchResults = await postItems(pending, headless);
    } catch (err) {
      const msg = String(err);
      console.error("投稿処理中に予期しないエラー:", msg);
      await notifyError("投稿処理エラー", msg);
      process.exit(1);
    }
    allResults.push(...batchResults);

    // 投稿不可と判明した商品コードを永続スキップリストに追加
    const ineligibleNow = batchResults.filter((r) => r.ineligible);
    for (const r of ineligibleNow) {
      ineligibleCodes.add(r.itemCode);
      excludeCodes.add(r.itemCode);
    }

    if (ineligibleNow.length === 0 || retry === MAX_INELIGIBLE_RETRIES) break;

    console.log(
      `\n[main] 投稿不可商品 ${ineligibleNow.length}件をスキップリストへ追加。代替商品を取得 (リトライ ${retry + 1}/${MAX_INELIGIBLE_RETRIES})`
    );

    let replacements: RakutenItem[] = [];
    try {
      replacements = await fetchItems(ineligibleNow.length, excludeCodes);
    } catch (err) {
      console.warn(`[main] 代替商品取得失敗: ${String(err)}、リトライ終了`);
      break;
    }
    if (replacements.length === 0) {
      console.warn("[main] 代替商品が0件、リトライ終了");
      break;
    }

    try {
      pending = await generateForItems(replacements);
    } catch (err) {
      console.warn(`[main] 代替商品の紹介文生成失敗: ${String(err)}、リトライ終了`);
      break;
    }
    if (pending.length === 0) {
      console.warn("[main] 代替商品の紹介文生成が全て失敗、リトライ終了");
      break;
    }
  }

  // 結果サマリー
  const succeeded = allResults.filter((r) => r.success).length;
  const failed = allResults.filter((r) => !r.success).length;
  const ineligibleTotal = allResults.filter((r) => r.ineligible).length;

  console.log("\n=== 実行結果 ===");
  console.log(`✅ 成功: ${succeeded}件`);
  console.log(`❌ 失敗: ${failed}件 (うち投稿不可: ${ineligibleTotal}件)`);

  if (failed > 0) {
    const errors = allResults
      .filter((r) => !r.success)
      .map((r) => `- ${r.itemName.slice(0, 30)}: ${r.error ?? "不明なエラー"}`)
      .join("\n");
    console.error("失敗した商品:\n" + errors);
  }

  // 成功した商品を投稿済みリストに追加して保存。投稿タイプを次に進める
  const successCodes = allResults.filter((r) => r.success).map((r) => r.itemCode);
  for (const code of successCodes) postedCodes.add(code);
  const nextPostTypeIndex = (postTypeIndex + 1) % 3;
  saveState(postedCodes, ineligibleCodes, nextPostTypeIndex);
  console.log(
    `[main] 状態保存: 投稿済み +${successCodes.length}件 / 投稿不可 +${ineligibleTotal}件 (累計スキップ ${ineligibleCodes.size}件)`
  );
  console.log(`[main] 次回の投稿タイプ: ${getPostTypeLabel(getPostType(nextPostTypeIndex))}`);

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
