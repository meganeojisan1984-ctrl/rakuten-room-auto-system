/**
 * auto_follow.ts - 自動フォロー機能
 * 収集とフォローをパイプライン化し、100件達成まで継続スクロール
 */
import { createBrowserContext, validateSession } from "../core/browser";
import { randomSleep } from "../utils/helpers";
import { addLog } from "../api/server";

const ROOM_URL = "https://room.rakuten.co.jp";
const PARALLEL_PAGES = 2;

/** 1時間あたりの最大フォロー数 (アカウント停止防止の絶対上限) */
const MAX_FOLLOWS_PER_HOUR = 100;

/**
 * レートリミットチェック: 過去1時間のフォロー数が上限に達していたら待機
 */
async function enforceRateLimit(followTimestamps: number[]): Promise<void> {
  const ONE_HOUR = 60 * 60 * 1000;
  const now = Date.now();

  // 1時間より古いタイムスタンプを削除
  while (followTimestamps.length > 0 && now - followTimestamps[0]! > ONE_HOUR) {
    followTimestamps.shift();
  }

  if (followTimestamps.length >= MAX_FOLLOWS_PER_HOUR) {
    // 最古のフォローから1時間後まで待機
    const waitMs = ONE_HOUR - (now - followTimestamps[0]!);
    const waitMin = Math.ceil(waitMs / 60000);
    console.log(`[auto_follow] ⚠️ 1時間${MAX_FOLLOWS_PER_HOUR}件上限に達しました。${waitMin}分待機します...`);
    addLog("auto_follow", "info", `レートリミット待機: ${waitMin}分`);
    await new Promise((resolve) => setTimeout(resolve, waitMs + 1000));
    // 待機後に再度古いタイムスタンプを削除
    const newNow = Date.now();
    while (followTimestamps.length > 0 && newNow - followTimestamps[0]! > ONE_HOUR) {
      followTimestamps.shift();
    }
  }
}

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
 * 収集スキャナー: インフルエンサーのフォロワーリストを順に巡回し
 * URLをキューに積み続ける。followCount が maxFollows に達したら終了。
 */
async function runScanner(
  page: import("playwright").Page,
  influencerIds: string[],
  queue: string[],
  seen: Set<string>,
  state: { followCount: number; scanDone: boolean },
  maxFollows: number
): Promise<void> {
  for (const influencerId of influencerIds) {
    if (state.followCount >= maxFollows) break;

    try {
      await page.goto(`${ROOM_URL}/${influencerId}/followers`, {
        waitUntil: "domcontentloaded",
        timeout: 30000,
      });
    } catch {
      console.warn(`[auto_follow][scan] ページ遷移失敗: ${influencerId}`);
      continue;
    }
    await randomSleep(6000, 8000);

    // 初回描画待機
    if ((await page.locator(SELECTORS.userLinks).count()) === 0) {
      await randomSleep(5000, 7000);
    }

    let noNewCount = 0;
    let scrollNum = 0;

    while (state.followCount < maxFollows) {
      // 現在のDOMからURLを収集してキューに追加
      const links = await page.locator(SELECTORS.userLinks).all();
      let added = 0;
      for (const link of links) {
        const href = await link.getAttribute("href").catch(() => null);
        if (!href) continue;
        const match = href.match(/^(\/room_[^/?#]+)/);
        const userId = match?.[1];
        if (userId && !seen.has(userId)) {
          seen.add(userId);
          queue.push(userId);
          added++;
        }
      }

      // スクロールで次のバッチを読み込む
      const beforeCount = await page.locator(SELECTORS.userLinks).count();
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await randomSleep(3000, 4000);
      const afterCount = await page.locator(SELECTORS.userLinks).count();

      scrollNum++;
      console.log(`[auto_follow][scan] ${influencerId} scroll${scrollNum}: +${added}件追加 (DOM ${afterCount}件, queue ${queue.length}件)`);

      if (afterCount <= beforeCount) {
        noNewCount++;
        if (noNewCount >= 3) {
          console.log(`[auto_follow][scan] ${influencerId} リスト末尾に到達`);
          break;
        }
      } else {
        noNewCount = 0;
      }
    }
  }

  state.scanDone = true;
  console.log(`[auto_follow][scan] スキャン完了 (収集済み ${seen.size}件)`);
}

/**
 * フォローワーカー: キューからURLを取り出してフォロー
 */
async function followWorker(
  page: import("playwright").Page,
  queue: string[],
  state: { followCount: number; scanDone: boolean; followTimestamps: number[] },
  maxFollows: number,
  pageId: number
): Promise<void> {
  while (state.followCount < maxFollows) {
    // キューが空ならスキャン完了待ち
    if (queue.length === 0) {
      if (state.scanDone) break;
      await randomSleep(1000, 2000);
      continue;
    }

    const userUrl = queue.shift()!;

    try {
      await page.goto(`${ROOM_URL}${userUrl}`, {
        waitUntil: "domcontentloaded",
        timeout: 30000,
      });
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

      // フォロー前にレートリミット確認 (1時間100件上限)
      await enforceRateLimit(state.followTimestamps);

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

      state.followTimestamps.push(Date.now());
      state.followCount++;
      console.log(`[auto_follow][p${pageId}] フォロー! ${userUrl} (${state.followCount}/${maxFollows})`);
      addLog("auto_follow", "info", `フォロー: ${state.followCount}/${maxFollows}`);

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

    const queue: string[] = [];
    const seen = new Set<string>();
    const state = { followCount: 0, scanDone: false, followTimestamps: [] as number[] };

    // スキャナー用ページ + フォローワーカー用ページを並列起動
    const scanPage = await context.newPage();
    const workerPages = await Promise.all(
      Array.from({ length: PARALLEL_PAGES }, () => context.newPage())
    );

    await Promise.all([
      runScanner(scanPage, influencerIds, queue, seen, state, maxFollows),
      ...workerPages.map((page, i) =>
        followWorker(page, queue, state, maxFollows, i + 1)
      ),
    ]);

    for (const page of [scanPage, ...workerPages]) {
      await page.close().catch(() => {});
    }

    addLog("auto_follow", "info", `フォロー完了: ${state.followCount}件`);
    console.log(`[auto_follow] 完了: ${state.followCount}件フォロー`);
  } catch (err) {
    const msg = String(err);
    console.error("[auto_follow] エラー:", msg);
    addLog("auto_follow", "error", msg);
    throw err;
  } finally {
    await browser.close();
  }
}
