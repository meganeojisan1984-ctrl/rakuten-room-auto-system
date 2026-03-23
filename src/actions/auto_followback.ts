/**
 * auto_followback.ts - 自動フォロー返し機能
 * 自分をフォローしているユーザーを自動的にフォロー返しする
 */
import { createBrowserContext, validateSession } from "../core/browser";
import { randomSleep } from "../utils/helpers";
import { addLog } from "../api/server";

const ROOM_URL = "https://room.rakuten.co.jp";

const SELECTORS = {
  // 楽天ROOMのフォローボタン (auto_followと同じ)
  followButton: 'button:has-text("フォローする")',
  // 楽天ROOMユーザーIDは /room_xxxxxxxx 形式
  userLinks: 'a[href^="/room_"]',
};

/**
 * ログイン中ユーザーのROOM IDを取得
 * トップページのナビゲーションから /room_xxxxxxxx リンクを探す
 */
async function getMyUserId(page: import("playwright").Page): Promise<string> {
  // 環境変数で直接指定されている場合は優先使用
  if (process.env.ROOM_USER_ID) return process.env.ROOM_USER_ID;

  // トップページ (AngularJSが確実に起動するページ) から自分のIDを取得
  await page.goto(`${ROOM_URL}/`, { waitUntil: "domcontentloaded", timeout: 30000 });
  await randomSleep(6000, 8000);

  // ナビゲーション内の自分のプロフィールリンクを探す
  const profileLinks = await page.evaluate(() =>
    Array.from(document.querySelectorAll('a[href^="/room_"]'))
      .map((a) => a.getAttribute("href") ?? "")
      .filter(Boolean)
  ).catch(() => [] as string[]);

  console.log(`[auto_followback] プロフィールリンク候補:`, profileLinks.slice(0, 5));

  // /room_xxxxxxxx 形式のIDを取得 (最初に見つかった自分のプロフィールリンク)
  // ヘッダーや「マイページ」リンクを優先的に探す
  const myLink = profileLinks.find((h) => h.match(/^\/room_[^/]+$/));
  const match = myLink?.match(/^(\/room_[^/]+)/);
  return match?.[1]?.replace("/", "") ?? "";
}

/**
 * フォロワー一覧からユーザーURLを収集
 */
async function collectMyFollowers(
  page: import("playwright").Page,
  myId: string,
  limit: number
): Promise<string[]> {
  const urls: string[] = [];
  try {
    await page.goto(`${ROOM_URL}/${myId}/followers`, {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });
    await randomSleep(6000, 8000);
    const roomLinkCount = await page.locator('a[href^="/room_"]').count();
    if (roomLinkCount === 0) {
      console.log(`[auto_followback] 追加待機中...`);
      await randomSleep(5000, 7000);
    }

    // 無限スクロールで追加読み込み (DOM上のリンク数がlimitに達するか、末尾まで)
    let noNewCount = 0;
    for (let scroll = 0; scroll < 50; scroll++) {
      const before = await page.locator(SELECTORS.userLinks).count();
      if (before >= limit) break;
      await page.evaluate(() => window.scrollBy(0, window.innerHeight * 3));
      await randomSleep(2000, 3000);
      const after = await page.locator(SELECTORS.userLinks).count();
      if (after === before) {
        noNewCount++;
        if (noNewCount >= 2) break; // 2回連続で増えなければページ末尾
      } else {
        noNewCount = 0;
      }
      console.log(`[auto_followback] スクロール${scroll + 1}: ${after}件`);
    }

    const links = await page.locator(SELECTORS.userLinks).all();
    console.log(`[auto_followback] ユーザーリンク検出: ${links.length}件`);
    for (const link of links) {
      const href = await link.getAttribute("href");
      if (!href) continue;
      // /room_xxxxxxxx/items などからユーザーID部分のみ取得
      const match = href.match(/^(\/room_[^/?#]+)/);
      const cleanHref = match?.[1] ?? href;
      if (cleanHref && !urls.includes(cleanHref) && cleanHref !== `/${myId}`) {
        urls.push(cleanHref);
        if (urls.length >= limit) break;
      }
    }
  } catch (err) {
    console.warn("[auto_followback] フォロワー収集失敗:", err);
  }
  return urls;
}

/**
 * フォロー返し実行
 * @param maxFollowbacks 最大フォロー返し数
 * @param headless ヘッドレス実行フラグ
 */
export async function runAutoFollowback(
  maxFollowbacks: number = 30,
  headless: boolean = true
): Promise<void> {
  console.log(`[auto_followback] フォロー返し開始 (最大${maxFollowbacks}件)`);
  addLog("auto_followback", "info", `フォロー返し開始 (最大${maxFollowbacks}件)`);

  const { browser, context } = await createBrowserContext(headless);
  let followbackCount = 0;

  try {
    if (!(await validateSession(context))) {
      addLog("auto_followback", "error", "セッション無効: Cookie更新が必要です");
      return;
    }

    const page = await context.newPage();

    // 自分のROOM IDを取得
    const myId = await getMyUserId(page);
    if (!myId) {
      addLog("auto_followback", "error", "自分のユーザーIDを取得できませんでした");
      return;
    }
    console.log(`[auto_followback] 自分のID: ${myId}`);

    // フォロワー一覧を取得
    const followerUrls = await collectMyFollowers(page, myId, maxFollowbacks * 3);
    console.log(`[auto_followback] フォロワー ${followerUrls.length}人を収集`);

    for (const userUrl of followerUrls) {
      if (followbackCount >= maxFollowbacks) break;

      try {
        const fullUrl = userUrl.startsWith("http") ? userUrl : `${ROOM_URL}${userUrl}`;
        await page.goto(fullUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
        await randomSleep(6000, 8000);
        // Angular未描画なら追加待機
        const ngCount = await page.locator("[ng-click], button").count();
        if (ngCount === 0) {
          await randomSleep(5000, 7000);
        }

        // フォローボタンがあるか確認（既フォロー済みは「フォロー中」になっているためスキップ）
        const followBtn = page.locator(SELECTORS.followButton).first();
        const isVisible = await followBtn.isVisible().catch(() => false);
        if (!isVisible) {
          console.log(`[auto_followback] フォロー済みまたはボタンなし: ${userUrl}`);
          continue;
        }

        await followBtn.scrollIntoViewIfNeeded();
        await randomSleep(500, 1000);

        // JSクリックでオーバーレイを回避してからforce:trueでフォールバック
        await page.evaluate(() => {
          const btn = Array.from(document.querySelectorAll<HTMLElement>("button")).find(
            (el) => el.textContent?.trim() === "フォローする"
          );
          if (btn) btn.click();
        }).catch(() => {});
        await randomSleep(1000, 2000);

        // クリック後にボタンが消えたか確認（消えていれば成功）
        const stillVisible = await followBtn.isVisible().catch(() => false);
        if (stillVisible) {
          // まだ表示されていればforce:trueで再試行
          await followBtn.click({ force: true }).catch(() => {});
          await randomSleep(1000, 1500);
        }

        followbackCount++;
        console.log(`[auto_followback] フォロー返し! ${userUrl} (${followbackCount}/${maxFollowbacks})`);

        await randomSleep(2000, 5000);
      } catch (err) {
        console.warn(`[auto_followback] スキップ: ${userUrl} - ${err}`);
      }
    }

    addLog("auto_followback", "info", `フォロー返し完了: ${followbackCount}件`);
    console.log(`[auto_followback] 完了: ${followbackCount}件フォロー返し`);
  } catch (err) {
    const msg = String(err);
    console.error("[auto_followback] エラー:", msg);
    addLog("auto_followback", "error", msg);
    throw err;
  } finally {
    await browser.close();
  }
}
