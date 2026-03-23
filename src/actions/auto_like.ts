/**
 * auto_like.ts - 自動いいね機能
 * インフルエンサーのROOMアイテムページ（React UI）からいいねを行う
 */
import { createBrowserContext, validateSession } from "../core/browser";
import { randomSleep } from "../utils/helpers";
import { addLog } from "../api/server";

const ROOM_URL = "https://room.rakuten.co.jp";

// いいね対象: 人気インフルエンサーのROOM ID
const INFLUENCER_IDS = [
  "room_2b6017e5e7",
  "room_9adbb0f109",
  "room_marika_family",
  "room_f585583974",
];

/**
 * 指定ページでいいねを実行。実行したいいね数を返す
 * React UI対応: CSS Moduleのハッシュクラス名 (like--, heart-- 等) を使用
 */
async function likeOnPage(
  page: import("playwright").Page,
  influencerId: string,
  remaining: number,
  maxLikes: number
): Promise<number> {
  // /items ページに遷移
  const url = `${ROOM_URL}/${influencerId}/items`;
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
  // React SPAの描画を待機
  await randomSleep(5000, 7000);
  console.log(`[auto_like] ページ: ${page.url()}`);

  // React rootが描画されるまで待機
  try {
    await page.waitForSelector("#root > *", { timeout: 10000 });
  } catch {
    console.log("[auto_like] #root子要素なし、さらに待機...");
    await randomSleep(3000, 5000);
  }

  // デバッグ: ページのHTML断片を複数箇所取得してボタン構造を確認
  const debugInfo = await page.evaluate(() => {
    const body = document.body?.innerHTML ?? "";
    // classにlike/heart/favoriteを含む要素を検索
    const allEls = Array.from(document.querySelectorAll("*"));
    const likeEls = allEls
      .filter((el) => {
        const cls = el.className;
        if (typeof cls !== "string") return false;
        return /like|heart|Love|favorite|fav/i.test(cls);
      })
      .slice(0, 5)
      .map((el) => `${el.tagName}[${el.className.slice(0, 80)}]`);

    // aria-labelに「いいね」を含む要素
    const ariaEls = Array.from(document.querySelectorAll("[aria-label]"))
      .filter((el) => /いいね|like|love|heart/i.test(el.getAttribute("aria-label") ?? ""))
      .slice(0, 5)
      .map((el) => `${el.tagName}[aria-label="${el.getAttribute("aria-label")}"][class="${(el as HTMLElement).className?.slice(0, 60)}"]`);

    // ボタン要素のclass一覧 (先頭10件)
    const buttons = Array.from(document.querySelectorAll("button,a"))
      .slice(0, 20)
      .map((el) => `${el.tagName}[${(el as HTMLElement).className?.slice(0, 60) ?? ""}]`);

    return {
      bodyHead: body.slice(0, 800),
      likeEls,
      ariaEls,
      buttonSample: buttons,
    };
  });

  console.log("[auto_like] bodyHTML先頭:", debugInfo.bodyHead);
  console.log("[auto_like] like/heart系要素:", JSON.stringify(debugInfo.likeEls));
  console.log("[auto_like] aria-label系要素:", JSON.stringify(debugInfo.ariaEls));
  console.log("[auto_like] button/aサンプル:", JSON.stringify(debugInfo.buttonSample));

  // React CSS Moduleのいいねボタン候補セレクタ (class名にlike/heartが含まれる)
  const likeSelectors = [
    '[class*="like"]',
    '[class*="heart"]',
    '[class*="Love"]',
    '[class*="favorite"]',
    '[aria-label*="いいね"]',
    '[aria-label*="like"]',
    '[aria-label*="love"]',
  ];

  // アイテムカード候補セレクタ (Reactのitem/thumb系)
  const itemSelectors = [
    '[class*="itemThumb"]',
    '[class*="item-thumb"]',
    '[class*="itemCard"]',
    '[class*="item_card"]',
    '[class*="itemImage"]',
    '[class*="thumb"]',
    '[class*="Thumb"]',
    '[class*="photoWrap"]',
    'ul[class*="item"] li',
    'li[class*="item"]',
  ];

  // アイテムカードを検索
  let itemCards: import("playwright").Locator | null = null;
  for (const sel of itemSelectors) {
    const count = await page.locator(sel).count();
    if (count > 0) {
      console.log(`[auto_like] アイテムカード発見: ${sel} (${count}件)`);
      itemCards = page.locator(sel);
      break;
    }
  }

  if (!itemCards) {
    console.log("[auto_like] アイテムカード未発見 - imgで代替試行");
    // imgタグを使ってアイテムエリアを特定 (最後の手段)
    const imgCount = await page.locator("main img, #root img").count();
    console.log(`[auto_like] main/root内img数: ${imgCount}`);
    if (imgCount === 0) return 0;
    itemCards = page.locator("main img, #root img");
  }

  let liked = 0;

  // スクロールしながらいいね (最大5パス)
  for (let scrollPass = 0; scrollPass < 5 && liked < remaining; scrollPass++) {
    const cardList = await itemCards.all();
    console.log(`[auto_like] カード数: ${cardList.length} (pass ${scrollPass + 1})`);

    for (const card of cardList) {
      if (liked >= remaining) break;

      try {
        // カードにホバーしていいねボタンを出現させる
        await card.scrollIntoViewIfNeeded();
        await card.hover({ force: true }).catch(() => {});
        await randomSleep(300, 600);

        // ホバー後にいいねボタンを探す
        let likeBtn: import("playwright").Locator | null = null;
        for (const sel of likeSelectors) {
          const count = await page.locator(sel).count();
          if (count > 0) {
            // まだいいねしていないボタンを選ぶ
            const candidates = await page.locator(sel).all();
            for (const btn of candidates) {
              const isAlreadyLiked = await btn.evaluate((el: Element) => {
                const cls = el.className;
                if (typeof cls !== "string") return false;
                return /liked|active|pressed|selected/i.test(cls);
              }).catch(() => false);
              const ariaPressed = await btn.getAttribute("aria-pressed").catch(() => null);
              if (!isAlreadyLiked && ariaPressed !== "true") {
                likeBtn = btn;
                break;
              }
            }
            if (likeBtn) break;
          }
        }

        if (!likeBtn) continue;

        await likeBtn.scrollIntoViewIfNeeded();
        await randomSleep(300, 800);
        // JSクリック優先 (オーバーレイ回避)
        await likeBtn.evaluate((el: Element) => (el as HTMLElement).click());
        await randomSleep(500, 1000);
        // JS clickで反応がなければ force click
        const stillUnliked = await likeBtn.evaluate((el: Element) => {
          const cls = el.className;
          return typeof cls === "string" && !/liked|active|pressed|selected/i.test(cls);
        }).catch(() => false);
        if (stillUnliked) {
          await likeBtn.click({ force: true }).catch(() => {});
        }

        liked++;
        console.log(`[auto_like] いいね! (${maxLikes - remaining + liked}/${maxLikes})`);
        await randomSleep(2000, 4000);
      } catch {
        // ボタンが消えた場合など無視
      }
    }

    if (liked < remaining) {
      await page.evaluate(() => window.scrollBy(0, window.innerHeight * 2));
      await randomSleep(3000, 5000);
    }
  }

  return liked;
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
      return;
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
