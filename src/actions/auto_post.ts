/**
 * auto_post.ts - 自動コレ（投稿）機能
 * 楽天ROOM投稿 → X(Twitter) 2段階スレッド投稿
 */
import { fetchItems } from "../fetcher";
import { generateCaptions, type PostType } from "../generator";
import { postItems } from "../poster";
import { postToX } from "../x-poster";
import { addLog } from "../api/server";
import * as fs from "fs";
import * as path from "path";

const POSTED_ITEMS_FILE = path.join(process.cwd(), "data", "posted_items.json");
const MAX_HISTORY = 500;

interface PostedState {
  postedItemCodes: string[];
  postTypeIndex: number;
}

function loadState(): { codes: Set<string>; postTypeIndex: number } {
  try {
    const data = JSON.parse(fs.readFileSync(POSTED_ITEMS_FILE, "utf-8")) as PostedState;
    return { codes: new Set(data.postedItemCodes ?? []), postTypeIndex: data.postTypeIndex ?? 0 };
  } catch {
    return { codes: new Set(), postTypeIndex: 0 };
  }
}

function saveState(codes: Set<string>, postTypeIndex: number): void {
  const dir = path.dirname(POSTED_ITEMS_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const arr = [...codes].slice(-MAX_HISTORY);
  fs.writeFileSync(POSTED_ITEMS_FILE, JSON.stringify({ postedItemCodes: arr, postTypeIndex }, null, 2));
}

function getPostType(index: number): PostType {
  return ([1, 2, 3] as PostType[])[index % 3]!;
}

/**
 * 自動投稿を実行する
 * @param postCount 投稿件数
 * @param headless ヘッドレス実行フラグ
 */
export async function runAutoPost(postCount: number = 1, headless: boolean = true): Promise<void> {
  console.log(`[auto_post] 自動投稿開始 (${postCount}件)`);
  addLog("auto_post", "info", `自動投稿開始 (${postCount}件)`);

  const { codes: postedCodes, postTypeIndex } = loadState();
  const postType = getPostType(postTypeIndex);

  try {
    // 商品取得
    const items = await fetchItems(postCount, postedCodes);
    if (items.length === 0) {
      addLog("auto_post", "warn", "取得できる新商品がありません");
      return;
    }

    // 紹介文生成（ROOM用 + X親投稿用）
    const captionedItems = await generateCaptions(items, postType);
    if (captionedItems.length === 0) {
      addLog("auto_post", "error", "紹介文の生成に失敗しました");
      return;
    }

    // 楽天ROOM投稿
    const results = await postItems(captionedItems, headless);

    const succeeded = results.filter((r) => r.success).length;
    const failed = results.filter((r) => !r.success).length;
    addLog("auto_post", "info", `ROOM投稿完了 成功:${succeeded}件 失敗:${failed}件`);

    // 投稿済みリスト更新
    const successCodes = captionedItems
      .filter((_, i) => results[i]?.success)
      .map((c) => c.item.itemCode);
    for (const code of successCodes) postedCodes.add(code);
    saveState(postedCodes, (postTypeIndex + 1) % 3);

    // X(Twitter) 2段階スレッド投稿（ROOM投稿が成功した商品のみ）
    let xPosted = 0;
    for (let i = 0; i < captionedItems.length; i++) {
      if (!results[i]?.success) continue;

      const { item, xParentCaption } = captionedItems[i]!;
      const ok = await postToX(
        item.itemName,
        item.itemUrl,
        xParentCaption,
        item.imageUrl || undefined
      );
      if (ok) xPosted++;
    }

    if (xPosted > 0) {
      addLog("auto_post", "info", `X投稿完了: ${xPosted}件（スレッド形式）`);
    }

    console.log(`[auto_post] 完了 ROOM成功:${succeeded} 失敗:${failed} X投稿:${xPosted}`);
  } catch (err) {
    const msg = String(err);
    console.error("[auto_post] エラー:", msg);
    addLog("auto_post", "error", msg);
    throw err;
  }
}
