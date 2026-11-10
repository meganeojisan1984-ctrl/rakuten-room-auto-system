/**
 * auto_like.ts - 自動いいね機能
 * インフルエンサーのROOMアイテムページ（React UI）からいいねを行う
 */
import { createBrowserContext, validateSession } from "../core/browser";
import { randomSleep } from "../utils/helpers";
import { addLog } from "../api/server";
import { confirmLike, LIKE_BUTTON, LIKE_CARD } from "./like-control";
import { createNetworkSettler } from "./network-settler";

const ROOM_URL = "https://room.rakuten.co.jp";

// いいね対象: 人気インフルエンサーのROOM ID
const INFLUENCER_IDS = [
  "room_2b6017e5e7",
  "room_9adbb0f109",
  "room_marika_family",
  "room_f585583974",
];

/**
 * Use only the observed ROOM card heart control. Never fall back to an image,
 * arbitrary class substring, or a second click on an uncertain toggle.
 */
async function likeOnPage(
  page: import("playwright").Page,
  influencerId: string,
  remaining: number,
  maxLikes: number
): Promise<number> {
  const traffic = createNetworkSettler(page);
  try {
    await page.goto(`${ROOM_URL}/${influencerId}/items`, {
      waitUntil: "domcontentloaded", timeout: 45000,
    });
    const settle = async () => {
      // Let scroll-triggered requests start, then require them to finish. A timeout
      // is a failure, not permission to act on the initial outline placeholder.
      await page.waitForTimeout(750);
      await traffic.waitForQuiet();
      await page.waitForTimeout(500);
      await traffic.waitForQuiet();
    };
    await settle();
    const cards = page.locator(LIKE_CARD);
    await cards.first().waitFor({ state: "visible", timeout: 20000 });
    let liked = 0;
    let recognizedControls = 0;

    for (let scrollPass = 0; scrollPass < 5 && liked < remaining; scrollPass++) {
      const cardList = await cards.all();
      for (const card of cardList) {
        if (liked >= remaining) break;
        await card.scrollIntoViewIfNeeded();
        await card.hover();
        const buttons = card.locator(LIKE_BUTTON);
        const count = await buttons.count();
        if (count === 0) continue;
        if (count !== 1) throw new Error("カードのいいねボタンを一意に特定できません");
        recognizedControls++;
        const result = await confirmLike(buttons.first(), settle);
        if (result === "already-liked") continue;
        liked++;
        console.log(`[auto_like] いいね確認済み (${maxLikes - remaining + liked}/${maxLikes})`);
        await randomSleep(2000, 4000);
      }
      if (liked < remaining) {
        await page.evaluate(() => window.scrollBy(0, window.innerHeight * 2));
        await settle();
      }
    }
    if (recognizedControls === 0) throw new Error("ROOMのいいね操作を確認できません。成功として扱いません");
    return liked;
  } finally {
    traffic.dispose();
  }
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
      throw new Error("ROOM セッション無効: Cookie更新が必要です");
    }

    const page = await context.newPage();

    for (const influencerId of INFLUENCER_IDS) {
      if (likeCount >= maxLikes) break;

      console.log(`[auto_like] ${influencerId} のアイテムページへ移動`);
      const liked = await likeOnPage(page, influencerId, maxLikes - likeCount, maxLikes);
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
