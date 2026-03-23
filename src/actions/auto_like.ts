/**
 * auto_like.ts - 自動いいね機能
 * インフルエンサーのプロフィールページから他ユーザーの投稿にいいねを行う
 * (/items はプロフィール興味設定が必要なため、直接インフルエンサーページを使用)
 */
import { createBrowserContext, validateSession } from "../core/browser";
import { randomSleep } from "../utils/helpers";
import { addLog } from "../api/server";

const ROOM_URL = "https://room.rakuten.co.jp";

// いいね対象: 人気インフルエンサーのROOM ID (自動フォローと同じリスト)
const INFLUENCER_IDS = [
  "room_2b6017e5e7",
  "room_9adbb0f109",
  "room_marika_family",
  "room_f585583974",
];

const SELECTORS = {
  likeButton: 'a[ng-click="like(item)"]',
  itemCard: '.item-thumb, [ng-repeat*="item"], a[ng-click="like(item)"]',
};

/**
 * 指定ページでいいねを実行。実行したいいね数を返す
 */
async function likeOnPage(
  page: import("playwright").Page,
  url: string,
  remaining: number,
  maxLikes: number
): Promise<number> {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
  await randomSleep(6000, 8000);
  console.log(`[auto_like] ページ: ${page.url()}`);

  // 商品カードが描画されるまで待機
  let itemCount = await page.locator(SELECTORS.itemCard).count();
  if (itemCount === 0) {
    console.log("[auto_like] 商品カード未描画、追加待機中...");
    await randomSleep(5000, 7000);
    itemCount = await page.locator(SELECTORS.itemCard).count();
  }
  console.log(`[auto_like] 商品カード数: ${itemCount}`);
  if (itemCount === 0) return 0;

  let liked = 0;
  // スクロールしながらいいね
  for (let scrollPass = 0; scrollPass < 5 && liked < remaining; scrollPass++) {
    const likeButtons = await page.locator(SELECTORS.likeButton).all();
    console.log(`[auto_like] いいねボタン検出: ${likeButtons.length}個 (pass ${scrollPass + 1})`);

    for (const btn of likeButtons) {
      if (liked >= remaining) break;

      try {
        const isLiked = await btn.evaluate((el: Element) => {
          return el.classList.contains("liked") ||
            el.classList.contains("active") ||
            el.getAttribute("aria-pressed") === "true";
        });
        if (isLiked) continue;

        await btn.scrollIntoViewIfNeeded();
        await randomSleep(500, 1500);
        await btn.evaluate((el: Element) => (el as HTMLElement).click());
        liked++;
        console.log(`[auto_like] いいね! (${maxLikes - remaining + liked}/${maxLikes})`);
        await randomSleep(1500, 4000);
      } catch {
        // ボタンが消えた場合など無視
      }
    }

    if (liked < remaining) {
      await page.evaluate(() => window.scrollBy(0, window.innerHeight * 2));
      await randomSleep(3000, 5000);
    }
  }
  return liked;
}

/**
 * 自動いいね実行
 */
export async function runAutoLike(maxLikes: number = 20, headless: boolean = true): Promise<void> {
  console.log(`[auto_like] 自動いいね開始 (最大${maxLikes}件)`);
  addLog("auto_like", "info", `自動いいね開始 (最大${maxLikes}件)`);

  const { browser, context } = await createBrowserContext(headless);
  let likeCount = 0;

  try {
    if (!(await validateSession(context))) {
      addLog("auto_like", "error", "セッション無効: Cookie更新が必要です");
      return;
    }

    const page = await context.newPage();

    // インフルエンサーのアイテムページを順番に巡回していいね
    for (const influencerId of INFLUENCER_IDS) {
      if (likeCount >= maxLikes) break;

      const url = `${ROOM_URL}/${influencerId}/items`;
      console.log(`[auto_like] ${influencerId} のアイテムページへ移動`);
      const liked = await likeOnPage(page, url, maxLikes - likeCount, maxLikes);
      likeCount += liked;
      console.log(`[auto_like] ${influencerId}: ${liked}件いいね (累計 ${likeCount}/${maxLikes})`);
    }

    addLog("auto_like", "info", `いいね完了: ${likeCount}件`);
    console.log(`[auto_like] 完了: ${likeCount}件いいね`);
  } catch (err) {
    const msg = String(err);
    console.error("[auto_like] エラー:", msg);
    addLog("auto_like", "error", msg);
    throw err;
  } finally {
    await browser.close();
  }
}
