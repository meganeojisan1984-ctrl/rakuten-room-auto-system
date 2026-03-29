/**
 * auto_follow.ts - 自動フォロー機能
 * フォロワーリストページ上のフォローボタンを直接クリックする方式 (高速化)
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
  followButton: 'button:has-text("フォローする")',
};

/**
 * フォロワーリストページ上でフォローボタンを直接クリック
 * プロフィールページへの遷移を省略することで処理速度を大幅に向上
 */
async function followFromFollowersList(
  page: import("playwright").Page,
  influencerId: string,
  maxFollows: number
): Promise<number> {
  let followCount = 0;

  try {
    await page.goto(`${ROOM_URL}/${influencerId}/followers`, {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });
  } catch (err) {
    console.warn(`[auto_follow] ページ遷移失敗 (${influencerId}): ${err}`);
    return -1;
  }
  await randomSleep(6000, 8000);

  // AngularJSがまだ描画中なら追加待機
  const initialCount = await page.locator(SELECTORS.followButton).count();
  if (initialCount === 0) {
    console.log(`[auto_follow] 追加待機中 (${influencerId})...`);
    await randomSleep(5000, 7000);
  }

  // リストページにフォローボタンがなければフォールバックを示すため0を返す
  const buttonCount = await page.locator(SELECTORS.followButton).count();
  if (buttonCount === 0) {
    console.log(`[auto_follow] フォロワーリストにフォローボタンなし: ${influencerId}`);
    return -1; // -1 = フォールバック要求
  }

  console.log(`[auto_follow] フォロワーリストでフォローボタン ${buttonCount}件検出 (${influencerId})`);

  let noNewCount = 0;

  while (followCount < maxFollows) {
    // 常に最初の「フォローする」ボタンを取得 (クリック後に消えた分が自動的にずれる)
    const btn = page.locator(SELECTORS.followButton).first();
    const isVisible = await btn.isVisible().catch(() => false);

    if (!isVisible) {
      // 画面内にボタンがなければスクロールして追加読み込み
      const before = await page.locator(SELECTORS.followButton).count();
      await page.evaluate(() => window.scrollBy(0, window.innerHeight * 3));
      await randomSleep(2000, 3000);
      const after = await page.locator(SELECTORS.followButton).count();

      if (after === before) {
        noNewCount++;
        if (noNewCount >= 2) break; // 2回連続で増えなければリスト末尾
      } else {
        noNewCount = 0;
      }
      continue;
    }

    await btn.scrollIntoViewIfNeeded();
    await randomSleep(500, 1000);

    // JSクリック → force:true フォールバック
    await page.evaluate(() => {
      const el = Array.from(document.querySelectorAll<HTMLElement>("button")).find(
        (b) => b.textContent?.trim() === "フォローする"
      );
      if (el) el.click();
    }).catch(() => {});
    await randomSleep(1000, 2000);

    const stillVisible = await btn.isVisible().catch(() => false);
    if (stillVisible) {
      await btn.click({ force: true }).catch(() => {});
      await randomSleep(1000, 1500);
    }

    followCount++;
    console.log(`[auto_follow] フォロー! (${followCount}/${maxFollows}) [${influencerId}]`);
    addLog("auto_follow", "info", `フォロー: ${followCount}/${maxFollows}`);

    await randomSleep(2000, 4000);
  }

  return followCount;
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

      let result: number;
      try {
        result = await followFromFollowersList(page, influencerId, maxFollows - followCount);
      } catch (err) {
        console.warn(`[auto_follow] ${influencerId} でエラー、スキップ: ${err}`);
        continue;
      }

      if (result === -1) {
        console.log(`[auto_follow] ${influencerId} をスキップ (フォローボタン未検出)`);
        continue;
      }

      followCount += result;
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
