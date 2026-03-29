/**
 * auto_follow.ts - 自動フォロー機能
 * フォロワーリストでURLを収集 → 複数ページ並列でプロフィール訪問＆フォロー
 */
import { createBrowserContext, validateSession } from "../core/browser";
import { randomSleep } from "../utils/helpers";
import { addLog } from "../api/server";

const ROOM_URL = "https://room.rakuten.co.jp";

// 並列処理するページ数 (増やすと速くなるが検出リスクも上がる)
const PARALLEL_PAGES = 2;

// フォロー対象: 人気インフルエンサーのROOM ID
const DEFAULT_INFLUENCER_IDS = [
  "room_2b6017e5e7",
  "room_9adbb0f109",
  "room_marika_family",
  "room_f585583974",
];

const SELECTORS = {
  followButton: 'button:has-text("フォローする")',
  userLinks: 'a[href^="/room_"]',
};

/**
 * フォロワーリストからユーザーURLを収集
 */
async function collectFollowers(
  page: import("playwright").Page,
  influencerId: string,
  limit: number
): Promise<string[]> {
  const urls: string[] = [];
  try {
    await page.goto(`${ROOM_URL}/${influencerId}/followers`, {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });
    await randomSleep(6000, 8000);

    // AngularJS描画待機
    const roomLinkCount = await page.locator(SELECTORS.userLinks).count();
    if (roomLinkCount === 0) {
      await randomSleep(5000, 7000);
    }

    // 無限スクロールで収集
    let noNewCount = 0;
    for (let scroll = 0; scroll < 50; scroll++) {
      const before = await page.locator(SELECTORS.userLinks).count();
      if (before >= limit) break;
      await page.evaluate(() => window.scrollBy(0, window.innerHeight * 3));
      await randomSleep(2000, 3000);
      const after = await page.locator(SELECTORS.userLinks).count();
      if (after === before) {
        if (++noNewCount >= 2) break;
      } else {
        noNewCount = 0;
      }
      console.log(`[auto_follow] スクロール${scroll + 1}: ${after}件 (${influencerId})`);
    }

    const links = await page.locator(SELECTORS.userLinks).all();
    for (const link of links.slice(0, limit)) {
      const href = await link.getAttribute("href");
      if (!href) continue;
      const match = href.match(/^(\/room_[^/?#]+)/);
      const cleanHref = match?.[1] ?? href;
      if (cleanHref && !urls.includes(cleanHref)) urls.push(cleanHref);
    }
  } catch (err) {
    console.warn(`[auto_follow] フォロワー収集失敗 (${influencerId}):`, err);
  }
  return urls;
}

/**
 * 1ページでユーザーリストを順番にフォロー
 */
async function followUsers(
  page: import("playwright").Page,
  queue: string[],       // 共有キュー (参照渡し: shift()で消費)
  counter: { n: number }, // 共有カウンター
  maxFollows: number,
  pageId: number
): Promise<void> {
  while (counter.n < maxFollows) {
    const userUrl = queue.shift();
    if (!userUrl) break;

    try {
      const fullUrl = `${ROOM_URL}${userUrl}`;
      await page.goto(fullUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
      await randomSleep(3000, 4000);

      // Angular未描画なら追加待機
      if ((await page.locator("[ng-click]").count()) === 0) {
        await randomSleep(3000, 4000);
      }

      const followBtn = page.locator(SELECTORS.followButton).first();
      if (!(await followBtn.isVisible().catch(() => false))) {
        console.log(`[auto_follow][p${pageId}] フォロー済み: ${userUrl}`);
        continue;
      }

      await followBtn.scrollIntoViewIfNeeded();
      await randomSleep(500, 1000);

      await page.evaluate(() => {
        const btn = Array.from(document.querySelectorAll<HTMLElement>("button")).find(
          (el) => el.textContent?.trim() === "フォローする"
        );
        if (btn) btn.click();
      }).catch(() => {});
      await randomSleep(1000, 2000);

      if (await followBtn.isVisible().catch(() => false)) {
        await followBtn.click({ force: true }).catch(() => {});
        await randomSleep(1000, 1500);
      }

      counter.n++;
      console.log(`[auto_follow][p${pageId}] フォロー! ${userUrl} (${counter.n}/${maxFollows})`);
      addLog("auto_follow", "info", `フォロー: ${counter.n}/${maxFollows}`);

      await randomSleep(2000, 4000);
    } catch (err) {
      console.warn(`[auto_follow][p${pageId}] スキップ: ${userUrl} - ${err}`);
    }
  }
}

/**
 * 自動フォロー実行
 */
export async function runAutoFollow(
  maxFollows: number = 10,
  influencerIds: string[] = DEFAULT_INFLUENCER_IDS,
  headless: boolean = true
): Promise<void> {
  console.log(`[auto_follow] 自動フォロー開始 (最大${maxFollows}件, 並列${PARALLEL_PAGES}ページ)`);
  addLog("auto_follow", "info", `自動フォロー開始 (最大${maxFollows}件)`);

  const { browser, context } = await createBrowserContext(headless);

  try {
    if (!(await validateSession(context))) {
      addLog("auto_follow", "error", "セッション無効: Cookie更新が必要です");
      return;
    }

    // Step1: 収集用ページでフォロワーURLを集める
    const collectPage = await context.newPage();
    const allUrls: string[] = [];
    for (const influencerId of influencerIds) {
      const urls = await collectFollowers(collectPage, influencerId, maxFollows * 3);
      console.log(`[auto_follow] ${influencerId}: ${urls.length}件収集`);
      for (const u of urls) {
        if (!allUrls.includes(u)) allUrls.push(u);
      }
      if (allUrls.length >= maxFollows * 3) break;
    }
    await collectPage.close();
    console.log(`[auto_follow] 合計 ${allUrls.length}件のユーザーURLを収集`);

    // Step2: 並列ページでフォロー実行
    const queue = [...allUrls];
    const counter = { n: 0 };
    const pages = await Promise.all(
      Array.from({ length: PARALLEL_PAGES }, () => context.newPage())
    );

    await Promise.all(
      pages.map((page, i) =>
        followUsers(page, queue, counter, maxFollows, i + 1)
      )
    );

    for (const page of pages) await page.close().catch(() => {});

    addLog("auto_follow", "info", `フォロー完了: ${counter.n}件`);
    console.log(`[auto_follow] 完了: ${counter.n}件フォロー`);
  } catch (err) {
    const msg = String(err);
    console.error("[auto_follow] エラー:", msg);
    addLog("auto_follow", "error", msg);
    throw err;
  } finally {
    await browser.close();
  }
}
