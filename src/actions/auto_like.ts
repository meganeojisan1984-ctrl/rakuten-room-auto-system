/**
 * auto_like.ts - 自動いいね機能
 * 楽天ROOMのタイムラインを取得し、他ユーザーの投稿にいいねを行う
 */
import { createBrowserContext, validateSession } from "../core/browser";
import { randomSleep } from "../utils/helpers";
import { addLog } from "../api/server";

const ROOM_URL = "https://room.rakuten.co.jp";

const SELECTORS = {
  // いいねボタン - 楽天ROOM AngularJS の実際のセレクタ
  // a[ng-click="like(item)"] class="icon-like right"
  likeButton: 'a[ng-click="like(item)"]',
  // 商品カードが読み込まれたか確認用
  itemCard: '.item-thumb, [ng-repeat*="item"], a[ng-click="like(item)"]',
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

    // タイムライン（フィード）を開く
    // networkidle はバックグラウンドポーリングで永遠に待つためNG → domcontentloaded + 手動待機
    await page.goto(`${ROOM_URL}/items`, { waitUntil: "domcontentloaded", timeout: 45000 });
    await randomSleep(6000, 8000);
    console.log(`[auto_like] ページURL: ${page.url()}`);

    // プロフィール設定ポップアップなどを閉じる
    await page.keyboard.press("Escape").catch(() => {});
    await randomSleep(1000, 2000);

    // 商品カードが描画されるまで待機
    let itemCount = await page.locator(SELECTORS.itemCard).count();
    if (itemCount === 0) {
      console.log("[auto_like] 商品カード未描画、追加待機中...");
      await randomSleep(5000, 7000);
      itemCount = await page.locator(SELECTORS.itemCard).count();
    }
    // まだ0なら「すべて」タブをクリックして全商品を表示
    if (itemCount === 0) {
      console.log("[auto_like] 「すべて」タブをクリックして全商品表示を試みます...");
      await page.evaluate(() => {
        const allTab = Array.from(document.querySelectorAll<HTMLElement>("[ng-click*='setGenre']"))
          .find((el) => el.textContent?.trim() === "すべて");
        if (allTab) allTab.click();
      }).catch(() => {});
      await randomSleep(4000, 6000);
    }
    console.log(`[auto_like] 商品カード数: ${await page.locator(SELECTORS.itemCard).count()}`);

    // スクロールしながらいいね
    for (let scrollPass = 0; scrollPass < 5 && likeCount < maxLikes; scrollPass++) {
      // いいねボタンを全て取得
      const likeButtons = await page.locator(SELECTORS.likeButton).all();
      console.log(`[auto_like] いいねボタン検出: ${likeButtons.length}個 (pass ${scrollPass + 1})`);

      for (const btn of likeButtons) {
        if (likeCount >= maxLikes) break;

        try {
          // 既にいいね済みなら skip（class="icon-like right liked" のようにlikedが付く）
          const isLiked = await btn.evaluate((el: Element) => {
            return el.classList.contains("liked") ||
              el.classList.contains("active") ||
              el.getAttribute("aria-pressed") === "true";
          });
          if (isLiked) continue;

          // 画面内にスクロール
          await btn.scrollIntoViewIfNeeded();
          await randomSleep(500, 1500);

          // JSクリックでオーバーレイを回避
          await btn.evaluate((el: Element) => (el as HTMLElement).click());
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
        await randomSleep(3000, 5000);
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
