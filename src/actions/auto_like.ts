/**
 * auto_like.ts - 自動いいね機能
 * 楽天ROOMのタイムラインを取得し、他ユーザーの投稿にいいねを行う
 */
import { createBrowserContext, validateSession } from "../core/browser";
import { randomSleep } from "../utils/helpers";
import { addLog } from "../api/server";

const ROOM_URL = "https://room.rakuten.co.jp";

const SELECTORS = {
  // いいねボタン - 楽天ROOM AngularJS UI
  likeButton: [
    'button[ng-click*="like"]',
    'button[ng-click*="Like"]',
    'button[ng-click*="fav"]',
    'a[ng-click*="like"]',
    'a[ng-click*="fav"]',
    '[class*="like-btn"]',
    '[class*="btn-like"]',
    '[class*="heart"]',
    '[class*="like"]:not([class*="liked"])',
    'button[class*="good"]',
  ].join(", "),
};

/**
 * タイムラインを開いていいね実行
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

    // タイムライン（フィード）を開く - リダイレクト完了まで待機
    await page.goto(`${ROOM_URL}/`, { waitUntil: "networkidle", timeout: 45000 });
    await randomSleep(2000, 3000);
    console.log(`[auto_like] ページURL: ${page.url()}`);

    // デバッグ: ページ上の全ボタン・リンクのclassを確認
    const debugInfo = await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll("button, a[ng-click], [ng-click]"));
      return buttons.slice(0, 30).map((el) => ({
        tag: el.tagName,
        class: el.className.toString().slice(0, 60),
        ngClick: el.getAttribute("ng-click") ?? "",
        text: el.textContent?.trim().slice(0, 20) ?? "",
      }));
    }).catch(() => []);
    console.log("[auto_like] ページ上の要素サンプル:", JSON.stringify(debugInfo, null, 2));

    // スクロールしながらいいね
    for (let scrollPass = 0; scrollPass < 5 && likeCount < maxLikes; scrollPass++) {
      // いいねボタンを全て取得
      const likeButtons = await page.locator(SELECTORS.likeButton).all();
      console.log(`[auto_like] いいねボタン検出: ${likeButtons.length}個`);

      for (const btn of likeButtons) {
        if (likeCount >= maxLikes) break;

        try {
          // 既にいいね済みなら skip
          const isLiked = await btn.evaluate((el: Element) => {
            return el.classList.contains("liked") ||
              el.classList.contains("active") ||
              el.getAttribute("aria-pressed") === "true";
          });
          if (isLiked) continue;

          // 画面内にスクロール
          await btn.scrollIntoViewIfNeeded();
          await randomSleep(500, 1500);

          // クリック
          await btn.click();
          likeCount++;
          console.log(`[auto_like] いいね! (${likeCount}/${maxLikes})`);

          // 人間らしい間隔
          await randomSleep(1500, 4000);
        } catch {
          // ボタンが消えた場合など無視して続行
        }
      }

      // ページをスクロールして新しい投稿を読み込む
      if (likeCount < maxLikes) {
        await page.evaluate(() => window.scrollBy(0, window.innerHeight * 2));
        await randomSleep(2000, 4000);
      }
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
