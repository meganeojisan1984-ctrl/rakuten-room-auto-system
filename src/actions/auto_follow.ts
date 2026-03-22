/**
 * auto_follow.ts - 自動フォロー機能
 * 指定したインフルエンサーのフォロワー一覧からランダムにフォローする
 */
import { createBrowserContext, validateSession } from "../core/browser";
import { randomSleep } from "../utils/helpers";
import { addLog } from "../api/server";

const ROOM_URL = "https://room.rakuten.co.jp";

// フォロー対象: 人気インフルエンサーのROOM ID
const DEFAULT_INFLUENCER_IDS = [
  "room_2b6017e5e7",
  "room_9adbb0f109",
  "room_marika_family",
  "room_f585583974",
];

const SELECTORS = {
  followerItems: '.follower-item, [class*="follower"], [class*="user-item"]',
  followButton: 'button:has-text("フォロー"), [class*="follow-btn"]:not([class*="following"])',
  followingButton: 'button:has-text("フォロー中"), [class*="following"]',
  // 楽天ROOMユーザーIDは /room_xxxxxxxx 形式
  userLinks: 'a[href^="/room_"]',
};

/**
 * 指定ユーザーのフォロワー一覧からユーザーを収集
 * SPAのため: プロフィールページを開いてからフォロワータブをクリック
 */
async function collectFollowers(
  page: import("playwright").Page,
  influencerId: string,
  limit: number
): Promise<string[]> {
  const urls: string[] = [];
  try {
    // Step1: フォロワーページに直接遷移 (domcontentloaded + 手動待機)
    await page.goto(`${ROOM_URL}/${influencerId}/followers`, {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });
    // AngularJSの描画を待機 (networkidleは使わない: バックグラウンドポーリングで永遠に待つため)
    await randomSleep(6000, 8000);
    console.log(`[auto_follow] URL: ${page.url()}, 全リンク数: ${await page.locator("a[href]").count()}, /room_リンク数: ${await page.locator('a[href^="/room_"]').count()}`);

    // Step2: AngularJSがまだ描画中なら追加待機
    const roomLinkCount = await page.locator('a[href^="/room_"]').count();
    if (roomLinkCount === 0) {
      console.log(`[auto_follow] 追加待機中...`);
      await randomSleep(5000, 7000);
    }

    // Step4: ユーザーリンクを収集
    const links = await page.locator(SELECTORS.userLinks).all();
    console.log(`[auto_follow] ユーザーリンク検出: ${links.length}件 (${influencerId})`);
    for (const link of links.slice(0, limit)) {
      const href = await link.getAttribute("href");
      if (href && !urls.includes(href)) urls.push(href);
    }
  } catch (err) {
    console.warn(`[auto_follow] フォロワー収集失敗 (${influencerId}):`, err);
  }
  return urls;
}

/**
 * 自動フォロー実行
 * @param maxFollows 最大フォロー数
 * @param influencerIds フォロワー参照先インフルエンサーID一覧
 * @param headless ヘッドレス実行フラグ
 */
export async function runAutoFollow(
  maxFollows: number = 10,
  influencerIds: string[] = DEFAULT_INFLUENCER_IDS,
  headless: boolean = true
): Promise<void> {
  console.log(`[auto_follow] 自動フォロー開始 (最大${maxFollows}件)`);
  addLog("auto_follow", "info", `自動フォロー開始 (最大${maxFollows}件)`);

  const { browser, context } = await createBrowserContext(headless);
  let followCount = 0;

  try {
    if (!(await validateSession(context))) {
      addLog("auto_follow", "error", "セッション無効: Cookie更新が必要です");
      return;
    }

    const page = await context.newPage();

    for (const influencerId of influencerIds) {
      if (followCount >= maxFollows) break;

      const userUrls = await collectFollowers(page, influencerId, maxFollows * 2);
      console.log(`[auto_follow] ${influencerId}のフォロワー ${userUrls.length}人を収集`);

      for (const userUrl of userUrls) {
        if (followCount >= maxFollows) break;

        try {
          const fullUrl = userUrl.startsWith("http") ? userUrl : `${ROOM_URL}${userUrl}`;
          await page.goto(fullUrl, { waitUntil: "domcontentloaded", timeout: 20000 });
          await randomSleep(1500, 3000);

          // フォローボタンを探す
          const followBtn = page.locator(SELECTORS.followButton).first();
          const isVisible = await followBtn.isVisible().catch(() => false);
          if (!isVisible) {
            console.log(`[auto_follow] フォロー済みまたはボタンなし: ${userUrl}`);
            continue;
          }

          await followBtn.scrollIntoViewIfNeeded();
          await randomSleep(500, 1000);
          await followBtn.click();
          followCount++;
          console.log(`[auto_follow] フォロー! ${userUrl} (${followCount}/${maxFollows})`);

          await randomSleep(2000, 5000);
        } catch (err) {
          console.warn(`[auto_follow] スキップ: ${userUrl} - ${err}`);
        }
      }
    }

    addLog("auto_follow", "info", `フォロー完了: ${followCount}件`);
    console.log(`[auto_follow] 完了: ${followCount}件フォロー`);
  } catch (err) {
    const msg = String(err);
    console.error("[auto_follow] エラー:", msg);
    addLog("auto_follow", "error", msg);
    throw err;
  } finally {
    await browser.close();
  }
}
