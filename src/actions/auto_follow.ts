/**
 * auto_follow.ts - 自動フォロー機能
 * フォローしたユーザーのフォロワーも連鎖スキャンし、候補を枯渇させない
 */
import { createBrowserContext, validateSession } from "../core/browser";
import { randomSleep } from "../utils/helpers";
import { addLog } from "../api/server";

const ROOM_URL = "https://room.rakuten.co.jp";
const PARALLEL_PAGES = 4;

/** 1時間あたりの最大フォロー数 (アカウント停止防止の絶対上限) */
const MAX_FOLLOWS_PER_HOUR = 100;

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

type State = {
  followCount: number;
  scanDone: boolean;
  followTimestamps: number[];
  /** フォローに成功したユーザーID (次の連鎖スキャン候補) */
  followedSeeds: string[];
};

/**
 * レートリミットチェック: 過去1時間のフォロー数が上限に達していたら待機
 */
async function enforceRateLimit(followTimestamps: number[]): Promise<void> {
  const ONE_HOUR = 60 * 60 * 1000;
  const now = Date.now();

  while (followTimestamps.length > 0 && now - followTimestamps[0]! > ONE_HOUR) {
    followTimestamps.shift();
  }

  if (followTimestamps.length >= MAX_FOLLOWS_PER_HOUR) {
    const waitMs = ONE_HOUR - (now - followTimestamps[0]!);
    const waitMin = Math.ceil(waitMs / 60000);
    console.log(`[auto_follow] ⚠️ 1時間${MAX_FOLLOWS_PER_HOUR}件上限に達しました。${waitMin}分待機します...`);
    addLog("auto_follow", "info", `レートリミット待機: ${waitMin}分`);
    await new Promise((resolve) => setTimeout(resolve, waitMs + 1000));
    const newNow = Date.now();
    while (followTimestamps.length > 0 && newNow - followTimestamps[0]! > ONE_HOUR) {
      followTimestamps.shift();
    }
  }
}

/**
 * 1ページ分のフォロワーリストをスキャンしてキューに追加
 */
async function scanOneFollowerList(
  page: import("playwright").Page,
  influencerId: string,
  queue: string[],
  seen: Set<string>,
  state: State,
  maxFollows: number
): Promise<void> {
  try {
    await page.goto(`${ROOM_URL}/${influencerId}/followers`, {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });
  } catch {
    console.warn(`[auto_follow][scan] ページ遷移失敗: ${influencerId}`);
    return;
  }
  await randomSleep(6000, 8000);

  if ((await page.locator(SELECTORS.userLinks).count()) === 0) {
    await randomSleep(5000, 7000);
  }

  let noNewCount = 0;
  let scrollNum = 0;

  while (state.followCount < maxFollows) {
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

    const beforeCount = await page.locator(SELECTORS.userLinks).count();
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await randomSleep(3000, 4000);
    const afterCount = await page.locator(SELECTORS.userLinks).count();

    scrollNum++;
    console.log(`[auto_follow][scan] ${influencerId} scroll${scrollNum}: +${added}件追加 (DOM ${afterCount}件, queue ${queue.length}件)`);

    if (afterCount <= beforeCount) {
      if (++noNewCount >= 3) {
        console.log(`[auto_follow][scan] ${influencerId} リスト末尾に到達`);
        break;
      }
    } else {
      noNewCount = 0;
    }
  }
}

/**
 * スキャナー:
 * 1. 初期インフルエンサーのフォロワーリストをスキャン
 * 2. Phase 1でスキャンした全員（フォロー済み含む）のフォロワーを連鎖スキャン
 *    → 全員フォロー済みでもその人たちのフォロワーは未フォローのはず
 * 3. 新規フォロー成功者のフォロワーも追加で連鎖スキャン
 */
async function runScanner(
  page: import("playwright").Page,
  influencerIds: string[],
  queue: string[],
  seen: Set<string>,
  state: State,
  maxFollows: number
): Promise<void> {
  // Phase 1: 初期インフルエンサーをスキャン
  for (const id of influencerIds) {
    if (state.followCount >= maxFollows) break;
    await scanOneFollowerList(page, id, queue, seen, state, maxFollows);
  }

  // Phase 2: 連鎖スキャン
  // 「Phase 1で見つかった全員」を初期シードとして使用（新規フォロー0件でも動作する）
  // 加えて「新規フォロー成功者」もシードとして随時追加
  const seedPool: string[] = [...seen]; // Phase 1終了時点の全候補をコピー
  const seenSeeds = new Set<string>(seedPool); // 同じ人を2回スキャンしない
  let seedPos = 0;

  while (state.followCount < maxFollows) {
    // 新規フォロー成功者をシードプールに追加（まだ追加していないもの）
    for (const s of state.followedSeeds) {
      if (!seenSeeds.has(s)) {
        seenSeeds.add(s);
        seedPool.push(s);
      }
    }

    if (seedPos < seedPool.length) {
      const seedUrl = seedPool[seedPos++]!;
      const seedId = seedUrl.replace(/^\//, "");
      console.log(`[auto_follow][scan] 連鎖スキャン: ${seedId} (${seedPos}/${seedPool.length})`);
      await scanOneFollowerList(page, seedId, queue, seen, state, maxFollows);
    } else {
      await randomSleep(2000, 3000);
      if (queue.length === 0 && seedPos >= seedPool.length) {
        console.log(`[auto_follow][scan] 新規候補が見つかりません。スキャン終了`);
        break;
      }
    }
  }

  state.scanDone = true;
  console.log(`[auto_follow][scan] スキャン完了 (収集済み ${seen.size}件)`);
}

/**
 * フォローワーカー: キューからURLを取り出してフォロー
 * フォロー成功時は state.followedSeeds に追加（連鎖スキャン用）
 */
async function followWorker(
  page: import("playwright").Page,
  queue: string[],
  state: State,
  maxFollows: number,
  pageId: number
): Promise<void> {
  while (state.followCount < maxFollows) {
    if (queue.length === 0) {
      if (state.scanDone) break;
      await randomSleep(1000, 2000);
      continue;
    }

    const userUrl = queue.shift()!;

    try {
      await page.goto(`${ROOM_URL}${userUrl}`, {
        waitUntil: "domcontentloaded",
        timeout: 20000,
      });

      // Angularが読み込まれるまで待つ（最大4秒、早ければ即通過）
      await page.waitForSelector("[ng-click]", { timeout: 4000 }).catch(() => {});

      const followBtn = page.locator(SELECTORS.followButton).first();
      if (!(await followBtn.isVisible().catch(() => false))) {
        // フォロー済み → 追加待機なし、即スキップ
        continue;
      }

      await enforceRateLimit(state.followTimestamps);

      await followBtn.scrollIntoViewIfNeeded();
      await randomSleep(300, 600);

      await page.evaluate(() => {
        const btn = Array.from(document.querySelectorAll<HTMLElement>("button")).find(
          (el) => el.textContent?.trim() === "フォローする"
        );
        if (btn) btn.click();
      }).catch(() => {});
      await randomSleep(800, 1200);

      if (await followBtn.isVisible().catch(() => false)) {
        await followBtn.click({ force: true }).catch(() => {});
        await randomSleep(800, 1000);
      }

      state.followTimestamps.push(Date.now());
      state.followCount++;
      // フォロー成功 → 連鎖スキャンの種として登録
      state.followedSeeds.push(userUrl);

      console.log(`[auto_follow][p${pageId}] フォロー! ${userUrl} (${state.followCount}/${maxFollows})`);
      addLog("auto_follow", "info", `フォロー: ${state.followCount}/${maxFollows}`);

      await randomSleep(1000, 1500);
    } catch (err) {
      console.warn(`[auto_follow][p${pageId}] スキップ: ${userUrl} - ${err}`);
      // リダイレクト等の残留ナビゲーションが終わるのを待ってからリセット
      await page.waitForLoadState("domcontentloaded", { timeout: 8000 }).catch(() => {});
      await page.goto("about:blank", { timeout: 5000 }).catch(() => {});
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
  console.log(`[auto_follow] 自動フォロー開始 (最大${maxFollows}件, 並列${PARALLEL_PAGES}ページ, 連鎖スキャンあり)`);
  addLog("auto_follow", "info", `自動フォロー開始 (最大${maxFollows}件)`);

  const { browser, context } = await createBrowserContext(headless);

  try {
    if (!(await validateSession(context))) {
      addLog("auto_follow", "error", "セッション無効: Cookie更新が必要です");
      return;
    }

    const queue: string[] = [];
    const seen = new Set<string>();
    const state: State = {
      followCount: 0,
      scanDone: false,
      followTimestamps: [],
      followedSeeds: [],
    };

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
