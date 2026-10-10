import * as dotenv from "dotenv";
dotenv.config();

import * as fs from "fs";
import * as path from "path";
import { fetchItems, fetchItemsByKeyword, getLastSelectedGenre, PRODUCT_CATEGORIES } from "./fetcher";
import { generateStrategyBriefMap } from "./sales-strategy";
import { generateCaptions, generateTrendCaptions, type PostType } from "./generator";
import { fetchTrendKeyword } from "./trend-fetcher";
import { postItems } from "./poster";
import { crossPostToSns } from "./sns";
import { notifyError } from "./notifiers";
import { loadStrategy, weightedPick, appendHistory, report, type PostRecord } from "./agents/store";
import { loadPersona, getSlot } from "./persona/persona";
import { resolveSlot } from "./persona/slot-rotator";
import { deriveItemCode } from "./affiliate/report-parser";
import { createRoomPostIntent, clearRoomPostIntent, persistPostedItemsAndVerify, syncPostedItemsFromRemote, hasUnresolvedRoomPostIntent, persistRoomPostIntent, readRemoteRoomPostIntent, readRoomPostIntent, type RoomPostIntent } from "./room-post-intent";

const POSTED_ITEMS_FILE = path.join(process.cwd(), "posted_items.json");
const MAX_HISTORY = 500; // 保持する最大件数

interface PostedItemsState {
  postedItemCodes: string[];
  uncertainItemCodes?: string[]; // 投稿結果不明。手動確認まで自動再送しない
  postTypeIndex: number; // 0=評価取り, 1=売上, 2=送客 → ローテーション
}

function loadState(): { codes: Set<string>; uncertainCodes: Set<string>; postTypeIndex: number } {
  try {
    const data: PostedItemsState = JSON.parse(fs.readFileSync(POSTED_ITEMS_FILE, "utf-8"));
    const uncertainCodes = new Set<string>(data.uncertainItemCodes ?? []);
    return {
      codes: new Set<string>([...(data.postedItemCodes ?? []), ...uncertainCodes]),
      uncertainCodes,
      postTypeIndex: data.postTypeIndex ?? 0,
    };
  } catch {
    return { codes: new Set<string>(), uncertainCodes: new Set<string>(), postTypeIndex: 0 };
  }
}

function saveState(codes: Set<string>, postTypeIndex: number, uncertainCodes: Set<string>): void {
  const arr = [...codes].filter((code) => !uncertainCodes.has(code)).slice(-MAX_HISTORY);
  const state: PostedItemsState = {
    postedItemCodes: arr,
    uncertainItemCodes: [...uncertainCodes],
    postTypeIndex,
  };
  fs.writeFileSync(POSTED_ITEMS_FILE, JSON.stringify(state, null, 2));
}

/**
 * 投稿タイプの選択:
 * 司令官の学習済み重み(strategy.json)があれば重み付きランダム、なければローテーション。
 * 1=評価取り投稿（クリック・ROOM回遊目的）
 * 2=売上投稿（成約目的）
 * 3=送客投稿（楽天市場誘導）
 */
function getPostType(index: number): PostType {
  const weights = loadStrategy().postTypeWeights;
  const hasLearned = Object.values(weights).some((w) => w !== 1);
  if (hasLearned) {
    return parseInt(weightedPick(["1", "2", "3"], (t) => t, weights), 10) as PostType;
  }
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

  const pendingIntent = readRoomPostIntent();
  const remoteIntent = await readRemoteRoomPostIntent();
  if (hasUnresolvedRoomPostIntent(pendingIntent) || hasUnresolvedRoomPostIntent(remoteIntent.intent)) {
    const blockedIntent = hasUnresolvedRoomPostIntent(remoteIntent.intent) ? remoteIntent.intent : pendingIntent;
    throw new Error(`未解決のROOM投稿intentがあります（requestId=${blockedIntent.requestId}）。remoteを権威状態として手動確認まで再送しません`);
  }
  // 古いcheckoutの履歴で商品を再選定しないようactive branchの履歴を先に同期する。
  await syncPostedItemsFromRemote();

  // Phase 2: 本回の担当 persona を決定
  const persona = loadPersona();
  const slotId = resolveSlot(persona, new Date());
  const slot = getSlot(persona, slotId);
  const SKIP_ROOM = process.env.SKIP_ROOM === "1";
  console.log(`[main] active persona: ${slot.id} (${slot.name}) SKIP_ROOM=${SKIP_ROOM}`);

  const { codes: postedCodes, uncertainCodes, postTypeIndex } = loadState();
  const postType = getPostType(postTypeIndex);
  console.log(`[main] 投稿済み商品数: ${postedCodes.size}件（除外対象）`);
  if (!TREND_MODE) {
    console.log(`[main] 今回の投稿タイプ: ${getPostTypeLabel(postType)}\n`);
  }

  // Step 1: 商品取得
  let items;
  let trendKeyword: string | undefined;
  try {
    if (TREND_MODE) {
      console.log("--- [1/3] トレンドキーワード取得 → 商品検索中 ---");
      trendKeyword = await fetchTrendKeyword();
      console.log(`トレンドキーワード: 「${trendKeyword}」`);
      items = await fetchItemsByKeyword(trendKeyword, POST_COUNT, postedCodes);
      // キーワード検索でヒットしない場合はランキングにフォールバック
      if (items.length === 0) {
        console.warn(`[main] キーワード「${trendKeyword}」で商品なし。ランキングにフォールバック`);
        items = await fetchItems(POST_COUNT, postedCodes, slot.genres);
        trendKeyword = undefined; // フォールバック時はGemini生成も通常モードへ
      }
    } else {
      console.log("--- [1/3] 商品取得中 ---");
      items = await fetchItems(POST_COUNT, postedCodes, slot.genres);
    }
    if (items.length === 0) {
      throw new Error("フィルタリング後に使用可能な商品が0件でした");
    }
    console.log(`商品取得完了: ${items.length}件\n`);
    report("scout", true, `${items.length}件選定 (${trendKeyword ? `トレンド: ${trendKeyword}` : getLastSelectedGenre()})`);
  } catch (err) {
    const msg = String(err);
    console.error("商品取得エラー:", msg);
    report("scout", false, msg.slice(0, 150));
    await notifyError("楽天API商品取得エラー", msg);
    process.exit(1);
  }

  // Step 2: 紹介文を生成
  let captionedItems;
  try {
    console.log("--- [2/3] 紹介文生成中 ---");
    const selectedCategory = PRODUCT_CATEGORIES.find((category) => category.name === getLastSelectedGenre())
      ?? PRODUCT_CATEGORIES.find((category) => slot.genres.includes(category.name));
    const briefs = selectedCategory
      ? await generateStrategyBriefMap(items, slot, selectedCategory)
      : undefined;
    if (trendKeyword) {
      // トレンドモード: Gemini Flash で YouTube必勝構成
      captionedItems = await generateTrendCaptions(trendKeyword, items, briefs);
    } else {
      // 通常モード: Groq で投稿タイプ別生成
      captionedItems = await generateCaptions(items, postType, briefs);
    }
    if (captionedItems.length === 0) {
      throw new Error("紹介文の生成に全て失敗しました");
    }
    console.log(`紹介文生成完了: ${captionedItems.length}件\n`);
    report("copywriter", true, `${captionedItems.length}件生成 (タイプ${postType})`);
  } catch (err) {
    const msg = String(err);
    console.error("紹介文生成エラー:", msg);
    report("copywriter", false, msg.slice(0, 150));
    await notifyError("紹介文生成エラー", msg);
    process.exit(1);
  }

  // Step 3: 楽天ROOMへ投稿（SKIP_ROOM=1 の cron 枠は IG のみ）
  let results: Awaited<ReturnType<typeof postItems>>;
  let roomIntent: RoomPostIntent | undefined;
  if (SKIP_ROOM) {
    console.log("--- [3/3] SKIP_ROOM=1 のため ROOM 投稿をスキップ ---");
    results = captionedItems.map((c) => ({
      success: true,
      itemName: c.item.itemName,
      itemUrl: c.item.itemUrl,
    }));
  } else {
    try {
      console.log("--- [3/3] 楽天ROOMへ投稿中 ---");
      // クリック前に意図を永続化。保存できなければ1件も送信しない。
      roomIntent = createRoomPostIntent(captionedItems.map((c) => ({
        itemCode: c.item.itemCode,
        itemName: c.item.itemName,
        itemUrl: c.item.itemUrl,
      })));
      await persistRoomPostIntent(roomIntent);
      const headless = process.env.CI === "true" || process.env.HEADLESS !== "false";
      results = await postItems(captionedItems, headless);
      if (!(results.length === captionedItems.length && results.every((result) => result.success))) {
        console.warn("[main] ROOM投稿が全件確認できないためintentを保持します。再送禁止。");
      }
    } catch (err) {
      const msg = String(err);
      console.error("投稿処理中に予期しないエラー:", msg);
      await notifyError("投稿処理エラー", msg);
      process.exit(1);
    }
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

  // 投稿エージェントの報告
  if (SKIP_ROOM) {
    report("poster", true, "skipped (SKIP_ROOM=1)");
  } else {
    report(
      "poster",
      succeeded > 0,
      `成功${succeeded}件/失敗${failed}件${failed > 0 ? ` (${results.find((r) => !r.success)?.error?.slice(0, 80) ?? ""})` : ""}`
    );
  }

  // ROOM投稿成功商品をInstagram・Threadsへクロス投稿（失敗しても本体は続行）
  const succeededItems = captionedItems.filter((_, i) => results[i]?.success);
  if (succeededItems.length > 0) {
    try {
      const sns = await crossPostToSns(succeededItems, { persona: slot });
      if (sns.attempted) {
        report("promoter", sns.instagram || sns.threads, `IG=${sns.instagram ? "成功" : "失敗/未設定"}, Threads=${sns.threads ? "成功" : "失敗/未設定"}`);
      }
    } catch (err) {
      console.error("[main] SNSクロス投稿エラー（続行）:", String(err));
      report("promoter", false, String(err).slice(0, 150));
    }
  }

  // 学習ループ用の投稿履歴を記録（計測エージェントが後からいいね数を付与）
  const jstHour = parseInt(
    new Date().toLocaleString("ja-JP", { timeZone: "Asia/Tokyo", hour: "2-digit", hour12: false }),
    10
  );
  const historyRecords: PostRecord[] = succeededItems.map((c) => ({
    ts: new Date().toISOString(),
    itemCode: c.item.itemCode,
    itemName: c.item.itemName,
    genreName: trendKeyword ? `トレンド:${trendKeyword}` : getLastSelectedGenre(),
    price: c.item.itemPrice,
    postType,
    hour: jstHour,
    hook: c.hook,
    captionHead: c.caption.replace(/\s+/g, " ").slice(0, 25),
    trendKeyword,
    // Phase 2: slot 属性 + sales-db との JOIN キー
    slot: slot.id,
    itemCodeHash: deriveItemCode(c.item.shopName ?? "", c.item.itemName),
  }));
  if (historyRecords.length > 0) appendHistory(historyRecords);

  // 成功商品を記録し、結果不明の商品は手動確認まで自動再送対象から隔離する
  const successCodes = succeededItems.map((c) => c.item.itemCode);
  const uncertainItems = captionedItems.filter((_, i) => results[i]?.unknown);
  for (const code of successCodes) postedCodes.add(code);
  for (const item of uncertainItems) uncertainCodes.add(item.item.itemCode);
  const nextPostTypeIndex = (postTypeIndex + 1) % 3;
  saveState(postedCodes, nextPostTypeIndex, uncertainCodes);
  console.log(`[main] 投稿済みリストを更新: ${successCodes.length}件追加、結果不明隔離: ${uncertainItems.length}件`);
  console.log(`[main] 次回の投稿タイプ: ${getPostTypeLabel(getPostType(nextPostTypeIndex))}`);

  // 成功コードをremote posted stateへ保存・読み戻し検証した後だけintentを消去する。
  // remote保存/検証/消去のいずれかに失敗した場合はintentを残し、次回起動を安全側で停止する。
  if (roomIntent && successCodes.length > 0) {
    await persistPostedItemsAndVerify(successCodes);
  }
  if (roomIntent && results.length === captionedItems.length && results.every((result) => result.success)) {
    await clearRoomPostIntent(roomIntent.requestId);
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
