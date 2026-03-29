/**
 * auto_follow.ts - 自動フォロー機能
 * ランキング/発見ページから動的にシードを取得し、
 * DBでフォロー済みユーザーを追跡して重複フォローを防ぐ
 */
import { createBrowserContext, validateSession } from "../core/browser";
import { randomSleep } from "../utils/helpers";
import { addLog, isFollowedUser, recordFollowedUser, getFollowedCount } from "../api/server";

const ROOM_URL = "https://room.rakuten.co.jp";
const OWN_ROOM_ID = process.env.OWN_ROOM_ID || "room_sho_qoltime";
const PARALLEL_PAGES = 4;

/** 1時間あたりの最大フォロー数 (アカウント停止防止の絶対上限) */
const MAX_FOLLOWS_PER_HOUR = 100;

/** キューにこの件数以上溜まったら連鎖スキャンを停止（早期打ち切りで高速化） */
const QUEUE_SATURATION = 80;

/** ランキング/発見ページ (動的シード取得に使用) */
const DISCOVERY_PAGES = [
  `${ROOM_URL}/ranking`,
  `${ROOM_URL}/`,
];

const SELECTORS = {
  followButton: 'button:has-text("フォローする")',
  // 相対URL(/room_xxx)と絶対URL(https://room.rakuten.co.jp/room_xxx)の両方に対応
  userLinks: 'a[href*="/room_"]',
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
 * 自分のフォロー中リストからユーザーIDを収集する
 * 毎回ランダムにシャッフルして返すことで、毎回違う人のフォロワーを探索できる
 */
async function getOwnFollowingIds(
  page: import("playwright").Page,
  sampleSize = 30
): Promise<string[]> {
  try {
    // フォロー中リストを直接取得
    await page.goto(`${ROOM_URL}/${OWN_ROOM_ID}/following`, {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });
    await randomSleep(4000, 5000);
    console.log(`[auto_follow][discover] フォロー中ページURL: ${page.url()}, userLinks件数: ${await page.locator(SELECTORS.userLinks).count()}`);

    const ids = new Set<string>();
    for (let i = 0; i < 8 && ids.size < 200; i++) {
      const links = await page.locator(SELECTORS.userLinks).all();
      for (const link of links) {
        const href = await link.getAttribute("href").catch(() => null);
        if (!href) continue;
        const m = href.match(/\/room_([^/?#]+)/);
        if (m) ids.add(`room_${m[1]}`);
      }
      const before = ids.size;
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await randomSleep(1000, 1500);
      if (ids.size === before) break; // 末尾に到達
    }

    // ランダムにシャッフルして毎回違うシードを返す
    const all = [...ids];
    for (let i = all.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [all[i], all[j]] = [all[j]!, all[i]!];
    }
    const result = all.slice(0, sampleSize);
    console.log(`[auto_follow][discover] フォロー中リスト ${ids.size}件からランダム${result.length}件を選出`);
    return result;
  } catch (e) {
    console.warn(`[auto_follow][discover] フォロー中リスト取得失敗: ${e}`);
    return [];
  }
}

/**
 * シードユーザーIDを取得する
 * 優先度: 自フォロー中リスト → ランキング/TOPページ
 */
async function discoverSeedIds(page: import("playwright").Page): Promise<string[]> {
  // まず自分のフォロー中リストからランダムにシードを取得
  const fromFollowing = await getOwnFollowingIds(page, 30);
  if (fromFollowing.length >= 5) return fromFollowing;

  // フォールバック: ランキング/TOPページ
  const ids = new Set<string>();
  for (const url of DISCOVERY_PAGES) {
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
      await randomSleep(3000, 4000);
      const links = await page.locator(SELECTORS.userLinks).all();
      console.log(`[auto_follow][discover] ${url}: ${links.length}件のリンク`);
      for (const link of links) {
        const href = await link.getAttribute("href").catch(() => null);
        if (!href) continue;
        const match = href.match(/\/room_([^/?#]+)/);
        if (match) ids.add(`room_${match[1]}`);
      }
    } catch {
      console.warn(`[auto_follow][discover] ページ取得失敗: ${url}`);
    }
  }
  const result = [...ids].slice(0, 30);
  console.log(`[auto_follow][discover] ランキングページから${result.length}件のシードを取得`);
  return result;
}

/**
 * 1ページ分のフォロワーリストをスキャンしてキューに追加
 * DB済みユーザーはキューに入れない
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
  await randomSleep(2000, 3000);

  if ((await page.locator(SELECTORS.userLinks).count()) === 0) {
    await randomSleep(2000, 3000);
  }

  let noNewCount = 0;
  let scrollNum = 0;

  while (state.followCount < maxFollows) {
    const links = await page.locator(SELECTORS.userLinks).all();
    let added = 0;
    for (const link of links) {
      const href = await link.getAttribute("href").catch(() => null);
      if (!href) continue;
      const match = href.match(/(\/room_[^/?#]+)/);
      const userId = match?.[1];
      if (userId && !seen.has(userId)) {
        seen.add(userId);
        // DB追跡: フォロー済みはキューに入れない
        if (!isFollowedUser(userId)) {
          queue.push(userId);
          added++;
        }
      }
    }

    const beforeCount = await page.locator(SELECTORS.userLinks).count();
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await randomSleep(1500, 2000);
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
 * スキャナー
 */
async function runScanner(
  page: import("playwright").Page,
  seedIds: string[],
  queue: string[],
  seen: Set<string>,
  state: State,
  maxFollows: number
): Promise<void> {
  // Phase 1: シードのフォロワーリストをスキャン
  for (const id of seedIds) {
    if (state.followCount >= maxFollows) break;
    await scanOneFollowerList(page, id, queue, seen, state, maxFollows);
  }

  // Phase 2: 連鎖スキャン
  const seedPool: string[] = [...seen];
  const seenSeeds = new Set<string>(seedPool);
  let seedPos = 0;

  while (state.followCount < maxFollows) {
    for (const s of state.followedSeeds) {
      if (!seenSeeds.has(s)) {
        seenSeeds.add(s);
        seedPool.push(s);
      }
    }

    // キューが十分溜まっていれば連鎖スキャンを打ち切り（高速化）
    if (queue.length >= QUEUE_SATURATION) {
      console.log(`[auto_follow][scan] キュー${queue.length}件到達、連鎖スキャンを停止`);
      break;
    }

    if (seedPos < seedPool.length) {
      const seedUrl = seedPool[seedPos++]!;
      const seedId = seedUrl.replace(/^\//, "");
      console.log(`[auto_follow][scan] 連鎖スキャン: ${seedId} (${seedPos}/${seedPool.length})`);
      await scanOneFollowerList(page, seedId, queue, seen, state, maxFollows);
    } else {
      await randomSleep(1000, 1500);
      if (queue.length === 0 && seedPos >= seedPool.length) {
        console.log(`[auto_follow][scan] 新規候補が見つかりません。スキャン終了`);
        break;
      }
    }
  }

  state.scanDone = true;
  console.log(`[auto_follow][scan] スキャン完了 (収集済み ${seen.size}件, DB累計フォロー ${getFollowedCount()}件)`);
}

/**
 * フォローワーカー: キューからURLを取り出してフォロー
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

      // Angularが「フォローする」または「フォロー中」ボタンを描画するまで最大10秒待つ
      await page.waitForSelector(
        'button:has-text("フォローする"), button:has-text("フォロー中")',
        { timeout: 10000 }
      ).catch(() => {});

      const followBtn = page.locator(SELECTORS.followButton).first();
      if (!(await followBtn.isVisible().catch(() => false))) {
        // フォロー済みまたはボタン未描画 → DBに記録してスキップ
        const currentUrl = page.url();
        console.log(`[auto_follow][p${pageId}] スキップ(フォロー済み or ボタンなし): ${userUrl} → ${currentUrl}`);
        recordFollowedUser(userUrl);
        continue;
      }

      await enforceRateLimit(state.followTimestamps);

      await followBtn.scrollIntoViewIfNeeded();
      await randomSleep(200, 400);

      await page.evaluate(() => {
        const btn = Array.from(document.querySelectorAll<HTMLElement>("button")).find(
          (el) => el.textContent?.trim() === "フォローする"
        );
        if (btn) btn.click();
      }).catch(() => {});
      await randomSleep(500, 800);

      if (await followBtn.isVisible().catch(() => false)) {
        await followBtn.click({ force: true }).catch(() => {});
        await randomSleep(500, 700);
      }

      state.followTimestamps.push(Date.now());
      state.followCount++;
      state.followedSeeds.push(userUrl);
      // DBにフォロー済みとして記録
      recordFollowedUser(userUrl);

      console.log(`[auto_follow][p${pageId}] フォロー! ${userUrl} (${state.followCount}/${maxFollows})`);
      addLog("auto_follow", "info", `フォロー: ${state.followCount}/${maxFollows}`);

      await randomSleep(700, 1000);
    } catch (err) {
      console.warn(`[auto_follow][p${pageId}] スキップ: ${userUrl} - ${err}`);
      // リダイレクト等の残留ナビゲーションが終わるのを待ってからリセット
      await page.waitForLoadState("domcontentloaded", { timeout: 4000 }).catch(() => {});
      await page.goto("about:blank", { timeout: 3000 }).catch(() => {});
    }
  }
}

/**
 * 自動フォロー実行
 * influencerIds が空の場合はランキングページから動的にシードを取得する
 */
export async function runAutoFollow(
  maxFollows: number = 10,
  influencerIds: string[] = [],
  headless: boolean = true
): Promise<void> {
  console.log(`[auto_follow] 自動フォロー開始 (最大${maxFollows}件, 並列${PARALLEL_PAGES}ページ, DB累計${getFollowedCount()}件フォロー済み)`);
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

    // シードが指定されていなければ発見ページから動的取得
    const seedIds = influencerIds.length > 0
      ? influencerIds
      : await discoverSeedIds(scanPage);

    if (seedIds.length === 0) {
      console.warn("[auto_follow] シードが見つかりませんでした。終了します。");
      await scanPage.close().catch(() => {});
      return;
    }

    console.log(`[auto_follow] シード: ${seedIds.slice(0, 5).join(", ")}${seedIds.length > 5 ? ` 他${seedIds.length - 5}件` : ""}`);

    const workerPages = await Promise.all(
      Array.from({ length: PARALLEL_PAGES }, () => context.newPage())
    );

    await Promise.all([
      runScanner(scanPage, seedIds, queue, seen, state, maxFollows),
      ...workerPages.map((page, i) =>
        followWorker(page, queue, state, maxFollows, i + 1)
      ),
    ]);

    for (const page of [scanPage, ...workerPages]) {
      await page.close().catch(() => {});
    }

    addLog("auto_follow", "info", `フォロー完了: ${state.followCount}件`);
    console.log(`[auto_follow] 完了: ${state.followCount}件フォロー (DB累計 ${getFollowedCount()}件)`);
  } catch (err) {
    const msg = String(err);
    console.error("[auto_follow] エラー:", msg);
    addLog("auto_follow", "error", msg);
    throw err;
  } finally {
    await browser.close();
  }
}
