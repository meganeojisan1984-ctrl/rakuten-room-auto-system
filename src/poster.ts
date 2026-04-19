import * as path from "path";
import * as fs from "fs";
import * as dotenv from "dotenv";
import { createAuthenticatedContext, validateSession } from "./session";
import { notifyCookieExpired, notifyCaptchaDetected, notifyDomError, notifySuccess } from "./notifiers";
import type { RakutenItem } from "./fetcher";
dotenv.config();

const ROOM_URL = "https://room.rakuten.co.jp";
const SCREENSHOT_PATH = path.join(process.cwd(), "error.png");
const ARTIFACTS_DIR = path.join(process.cwd(), "post-artifacts");
const MAX_SUBMIT_ATTEMPTS = 2; // 同一商品での投稿リトライ上限
const VERIFY_POLL_ATTEMPTS = 3; // 投稿確認のポーリング回数 (キャッシュ反映待ち)
const VERIFY_POLL_INTERVAL_MS = 5000;

// セレクタ定数 (楽天ROOMのDOM変更時はここを更新)
const SELECTORS = {
  // 商品ページの「ROOMに追加」ボタン
  addToRoomButton: ':text("ROOMに投稿"), :text("ROOMに追加"), a[data-ga-label="add_to_room"], button[data-ga-label="add_to_room"], .btn-add-room, a.add-to-room',
  // ログイン要求のセレクタ
  loginForm: 'form[action*="login"], input[name="u"]',
  // CAPTCHA
  captcha: '#recaptcha, .g-recaptcha, iframe[title*="reCAPTCHA"]',
};

export type PostResult = {
  success: boolean;
  itemName: string;
  itemCode: string;
  itemUrl: string;
  ineligible?: boolean;
  error?: string;
};

/**
 * ログイン中ユーザーの楽天ROOM IDを取得 (verify用)
 * 環境変数 ROOM_USER_ID 優先、なければトップページのプロフィールリンクから検出
 */
async function getMyRoomId(page: import("playwright").Page): Promise<string> {
  if (process.env.ROOM_USER_ID) return process.env.ROOM_USER_ID;
  try {
    await page.goto(`${ROOM_URL}/`, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(5000);
    const id = await page.evaluate(() => {
      const links = Array.from(document.querySelectorAll('a[href^="/room_"]'))
        .map((a) => a.getAttribute("href") ?? "")
        .filter(Boolean);
      const myLink = links.find((h) => /^\/room_[^/]+$/.test(h));
      return myLink?.replace(/^\//, "") ?? "";
    });
    return id;
  } catch (err) {
    console.warn(`[poster] マイルームID取得失敗: ${String(err)}`);
    return "";
  }
}

/**
 * 楽天ROOMの自分のitemsページに該当商品が存在するか確認
 * itemCode "shopCode:itemNumber" を商品リンクのURLパターンと突合
 */
async function verifyPostExists(
  page: import("playwright").Page,
  myRoomId: string,
  item: RakutenItem
): Promise<boolean> {
  const codeMatch = item.itemCode.match(/^([^:]+):(.+)$/);
  if (!codeMatch) {
    console.warn(`[poster] verify: itemCodeパース失敗: ${item.itemCode}`);
    return false;
  }
  const shopCode = codeMatch[1]!;
  const itemNumber = codeMatch[2]!;
  const itemsUrl = `${ROOM_URL}/${myRoomId}/items`;

  for (let attempt = 1; attempt <= VERIFY_POLL_ATTEMPTS; attempt++) {
    if (attempt > 1) await page.waitForTimeout(VERIFY_POLL_INTERVAL_MS);
    try {
      await page.goto(itemsUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
      await page.waitForTimeout(3000);
      const found = await page.evaluate(
        ({ shopCode, itemNumber }) => {
          const links = Array.from(document.querySelectorAll("a"))
            .map((a) => (a as HTMLAnchorElement).href || "")
            .filter((h) => h.includes("item.rakuten.co.jp"));
          return links.some(
            (h) =>
              h.includes(`/${shopCode}/${itemNumber}/`) ||
              h.includes(`/${shopCode}/${itemNumber}?`)
          );
        },
        { shopCode, itemNumber }
      );
      if (found) {
        console.log(`[poster] ✅ verify OK: ${item.itemCode} (試行${attempt}/${VERIFY_POLL_ATTEMPTS})`);
        return true;
      }
      console.log(`[poster] verify NG: ${item.itemCode} 未検出 (試行${attempt}/${VERIFY_POLL_ATTEMPTS})`);
    } catch (err) {
      console.warn(`[poster] verify エラー (試行${attempt}/${VERIFY_POLL_ATTEMPTS}): ${String(err)}`);
    }
  }
  return false;
}

/**
 * 投稿失敗時の解析用にスクリーンショットとHTMLを保存
 */
async function saveFailureArtifacts(
  page: import("playwright").Page,
  item: RakutenItem,
  label: string
): Promise<void> {
  try {
    if (!fs.existsSync(ARTIFACTS_DIR)) {
      fs.mkdirSync(ARTIFACTS_DIR, { recursive: true });
    }
    const safeCode = item.itemCode.replace(/[^a-zA-Z0-9_-]/g, "_");
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    const baseName = `${ts}_${safeCode}_${label}`;
    const screenshotPath = path.join(ARTIFACTS_DIR, `${baseName}.png`);
    const htmlPath = path.join(ARTIFACTS_DIR, `${baseName}.html`);
    await page.screenshot({ path: screenshotPath, fullPage: true });
    const html = await page.content();
    await fs.promises.writeFile(htmlPath, html, "utf-8");
    console.log(`[poster] 失敗アーティファクト保存: post-artifacts/${baseName}.{png,html}`);
  } catch (err) {
    console.warn(`[poster] アーティファクト保存失敗: ${String(err)}`);
  }
}

/**
 * 投稿フォームに紹介文を入力して「完了」ボタンをクリック
 * attempt=1: JS click → Locator force:true
 * attempt=2: keyboard Enter / form submit / 再force click でリカバー
 */
async function fillAndSubmit(
  postPage: import("playwright").Page,
  caption: string,
  attempt: number
): Promise<void> {
  // テキストエリアを取得
  const captionLocator = postPage.locator("textarea").first();
  await captionLocator.waitFor({ state: "visible", timeout: 15000 });

  // テキスト入力: Angularスコープ更新 + DOM値書き込み
  await postPage.evaluate((text) => {
    const textarea = document.querySelector("textarea");
    if (!textarea) return;
    const win = window as unknown as {
      angular?: {
        element: (el: Element) => {
          scope: () => Record<string, unknown>;
          triggerHandler: (e: string) => void;
        };
      };
    };
    if (win.angular) {
      const angEl = win.angular.element(textarea);
      let scope = angEl.scope() as Record<string, unknown> & {
        $parent?: Record<string, unknown>;
        $root?: { $digest?: () => void };
      };
      while (scope) {
        if ("content" in scope) { scope["content"] = text; break; }
        if (!scope.$parent) break;
        scope = scope.$parent as typeof scope;
      }
      try { scope.$root?.$digest?.(); } catch {}
      angEl.triggerHandler("input");
      angEl.triggerHandler("change");
    }
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
    setter?.call(textarea, text);
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
    textarea.dispatchEvent(new Event("change", { bubbles: true }));
  }, caption);
  await postPage.waitForTimeout(500);

  // フォールバック: キーボード入力で再試行
  const enteredText = await captionLocator.inputValue().catch(() => "");
  if (enteredText.length === 0) {
    console.log("[poster] Angular入力失敗、キーボード入力で再試行...");
    await captionLocator.click({ force: true });
    await postPage.keyboard.press("Control+a");
    await postPage.keyboard.type(caption, { delay: 10 });
    await postPage.waitForTimeout(500);
  }
  const finalText = await captionLocator.inputValue().catch(() => "");
  console.log(`[poster] 紹介文を入力 (${finalText.length}文字, 試行${attempt}/${MAX_SUBMIT_ATTEMPTS})`);

  // 投稿ボタン取得
  const postBtnLocator = postPage.locator('button:has-text("完了"), a:has-text("完了")').first();
  const postBtnVisible = await postBtnLocator.isVisible({ timeout: 10000 }).catch(() => false);
  if (!postBtnVisible) {
    throw new Error("投稿ボタンが見つかりません");
  }

  // 試行毎に異なるクリック戦略
  if (attempt === 1) {
    // JS直接click → Locator force:true
    await postPage.evaluate(() => {
      const btn = Array.from(document.querySelectorAll<HTMLElement>("button, a")).find(
        (el) => el.textContent?.trim() === "完了"
      );
      if (btn) btn.click();
    }).catch(() => {});
    await postPage.waitForTimeout(1000);
    await postBtnLocator.click({ force: true, timeout: 5000 }).catch(() => {});
    console.log("[poster] 投稿ボタンクリック (JS click + Locator force)");
  } else {
    // 別戦略: dispatchEvent + ng-click 直接トリガー + force click
    await postPage.evaluate(() => {
      const btn = Array.from(document.querySelectorAll<HTMLElement>("button, a")).find(
        (el) => el.textContent?.trim() === "完了"
      );
      if (!btn) return;
      // mousedown/mouseup/click を順に発火
      ["mousedown", "mouseup", "click"].forEach((type) => {
        btn.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true }));
      });
      // Angular ng-click 属性があれば $apply 経由で評価
      const ngClick = btn.getAttribute("ng-click");
      const win = window as unknown as { angular?: { element: (el: Element) => { scope: () => { $apply?: (fn: string) => void } } } };
      if (ngClick && win.angular) {
        try {
          win.angular.element(btn).scope().$apply?.(ngClick);
        } catch {}
      }
    }).catch(() => {});
    await postPage.waitForTimeout(1000);
    await postBtnLocator.click({ force: true, timeout: 5000 }).catch(() => {});
    console.log("[poster] 投稿ボタンクリック (dispatchEvent + ng-click + force)");
  }
}

/**
 * 楽天ROOMへ1商品を投稿する
 */
async function postSingleItem(
  item: RakutenItem,
  caption: string,
  headless: boolean
): Promise<PostResult> {
  const { browser, context } = await createAuthenticatedContext(headless);

  try {
    // Cookieの有効性チェック
    const isValid = await validateSession(context);
    if (!isValid) {
      await notifyCookieExpired();
      throw new Error("Cookie期限切れ: セッションが無効です");
    }

    const page = await context.newPage();

    // 商品URLへアクセス
    console.log(`[poster] 商品URLへアクセス: ${item.itemUrl}`);
    await page.goto(item.itemUrl, {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });
    await page.waitForTimeout(2000);

    // CAPTCHA検知
    const captchaEl = await page.$(SELECTORS.captcha);
    if (captchaEl) {
      await page.screenshot({ path: SCREENSHOT_PATH });
      await notifyCaptchaDetected();
      throw new Error("CAPTCHA検知: 自動投稿を中止します");
    }

    // ログイン要求検知
    const loginEl = await page.$(SELECTORS.loginForm);
    if (loginEl) {
      await notifyCookieExpired();
      throw new Error("ログイン要求検知: Cookieが期限切れです");
    }

    // 「ROOMに追加」ボタンをクリック
    console.log("[poster] ROOMに追加ボタンを探しています...");
    const addBtn = await page.waitForSelector(SELECTORS.addToRoomButton, { timeout: 15000 }).catch(async () => {
      await page.screenshot({ path: SCREENSHOT_PATH, fullPage: true });
      const bodyHtml = await page.evaluate(() => document.body.innerHTML.slice(0, 3000));
      console.error("[poster] ページHTML(先頭3000文字):", bodyHtml);
      await notifyDomError("「ROOMに追加」ボタンが見つかりません。UIが変更された可能性があります");
      throw new Error("「ROOMに追加」ボタンが見つかりません");
    });

    // 新しいタブが開く場合に備えて待機
    const [newPageOrNull] = await Promise.all([
      context.waitForEvent("page", { timeout: 5000 }).catch(() => null),
      addBtn.click(),
    ]);

    const postPage = newPageOrNull ?? page;
    if (newPageOrNull) {
      console.log("[poster] 新しいタブで投稿フォームが開きました");
      await postPage.waitForLoadState("load", { timeout: 15000 });
    }
    console.log("[poster] ROOMに追加ボタンをクリックしました");

    // 投稿不可商品の検知: mix/collect が 404 を返すケース
    // (ROOM投稿不可ジャンル / 販売停止 / ショップ除外など)
    const ineligibleDetected = await postPage.evaluate(() => {
      const title = document.title || "";
      const heading = document.querySelector("h1,h2")?.textContent || "";
      const bodySnippet = (document.body?.innerText || "").slice(0, 500);
      const text = `${title} ${heading} ${bodySnippet}`;
      return /ページが見つかりません|お探しのページは見つかりません|Page Not Found|404 Not Found/i.test(text);
    }).catch(() => false);

    if (ineligibleDetected) {
      await postPage.screenshot({ path: SCREENSHOT_PATH }).catch(() => {});
      console.warn(`[poster] ROOM投稿不可商品を検知 (404): ${postPage.url()}`);
      throw new Error("ROOM_INELIGIBLE: 楽天ROOMに投稿できない商品です (404)");
    }

    // AngularJSの初期化完了を待機
    await postPage.waitForFunction(() => {
      const win = window as unknown as { angular?: { element: (el: Element) => { injector: () => unknown } } };
      return win.angular?.element(document.body).injector() !== undefined;
    }, { timeout: 15000 }).catch(() => {
      console.warn("[poster] AngularJS初期化タイムアウト、処理続行");
    });
    await postPage.waitForTimeout(2000);

    // フォーム読み込み確認スクリーンショット
    await postPage.screenshot({ path: SCREENSHOT_PATH }).catch(() => {});
    console.log("[poster] フォーム確認スクリーンショット保存");

    // ng-model 確認 (デバッグログ用)
    const ngModelAttr = await postPage.evaluate(() => {
      return document.querySelector("textarea")?.getAttribute("ng-model") ?? "";
    }).catch(() => "");
    if (ngModelAttr) console.log(`[poster] textarea ng-model: "${ngModelAttr}"`);

    // verify用のマイルームIDを取得 (別ページで)
    const idPage = await context.newPage();
    let myRoomId = "";
    try {
      myRoomId = await getMyRoomId(idPage);
      if (myRoomId) console.log(`[poster] マイルームID: ${myRoomId}`);
      else console.warn("[poster] マイルームID取得失敗 → URL遷移チェックにフォールバック");
    } finally {
      await idPage.close().catch(() => {});
    }

    // 投稿サブミット + verify を最大 MAX_SUBMIT_ATTEMPTS 回試行
    let verified = false;
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= MAX_SUBMIT_ATTEMPTS && !verified; attempt++) {
      try {
        if (attempt > 1) {
          console.log(`[poster] 投稿リトライ ${attempt}/${MAX_SUBMIT_ATTEMPTS}: フォーム再読込`);
          await postPage.reload({ waitUntil: "domcontentloaded", timeout: 30000 });
          await postPage.waitForTimeout(3000);
        }

        await fillAndSubmit(postPage, caption, attempt);
        await postPage.waitForTimeout(3000);
        console.log(`[poster] 投稿後URL: ${postPage.url()}`);

        // 投稿確認: マイルームに該当商品が出現したかチェック
        if (myRoomId) {
          const verifyPage = await context.newPage();
          try {
            await postPage.waitForTimeout(2000); // ROOM側のキャッシュ反映待ち
            verified = await verifyPostExists(verifyPage, myRoomId, item);
          } finally {
            await verifyPage.close().catch(() => {});
          }
        } else {
          // myRoomID不明時は URL 遷移で代替判定
          verified = postPage.url().includes("/room_") || !postPage.url().includes("/mix/collect");
          if (verified) console.log("[poster] URL遷移を確認 (verify代替)");
        }

        if (!verified) {
          await saveFailureArtifacts(postPage, item, `attempt${attempt}_unverified`);
          lastError = new Error(`VERIFY_FAILED: 試行${attempt}で投稿確認できず`);
          console.warn(`[poster] ❌ 投稿確認できず (試行${attempt}/${MAX_SUBMIT_ATTEMPTS})`);
        }
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        console.warn(`[poster] 試行${attempt}でエラー: ${lastError.message}`);
        await saveFailureArtifacts(postPage, item, `attempt${attempt}_error`).catch(() => {});
      }
    }

    if (!verified) {
      await notifyDomError(`投稿確認失敗: ${item.itemName.slice(0, 40)}`).catch(() => {});
      throw lastError ?? new Error("VERIFY_FAILED: 投稿確認できませんでした");
    }

    await notifySuccess(item.itemName, item.itemUrl);
    console.log(`[poster] ✅ 投稿成功 (verify済み): ${item.itemName}`);

    return { success: true, itemName: item.itemName, itemCode: item.itemCode, itemUrl: item.itemUrl };
  } catch (err) {
    const errorMsg = String(err);
    const ineligible = errorMsg.includes("ROOM_INELIGIBLE");
    console.error(`[poster] 投稿失敗: ${errorMsg}`);
    return {
      success: false,
      itemName: item.itemName,
      itemCode: item.itemCode,
      itemUrl: item.itemUrl,
      ineligible,
      error: errorMsg,
    };
  } finally {
    await browser.close();
  }
}

/**
 * 複数商品を順次投稿する
 */
export async function postItems(
  items: Array<{ item: RakutenItem; caption: string }>,
  headless: boolean = true
): Promise<PostResult[]> {
  const results: PostResult[] = [];

  for (const { item, caption } of items) {
    console.log(`\n[poster] === 投稿開始: ${item.itemName.slice(0, 40)} ===`);
    const result = await postSingleItem(item, caption, headless);
    results.push(result);

    // 投稿間隔（サーバー負荷・BAN対策）
    if (items.indexOf({ item, caption }) < items.length - 1) {
      const waitMs = 5000 + Math.random() * 5000; // 5〜10秒のランダム待機
      console.log(`[poster] 次の投稿まで ${Math.round(waitMs / 1000)}秒待機...`);
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }

    // 致命的なエラー（Cookie切れ・CAPTCHA）は即時中断
    if (!result.success && result.error) {
      const isFatal =
        result.error.includes("Cookie期限切れ") ||
        result.error.includes("CAPTCHA") ||
        result.error.includes("ログイン要求");
      if (isFatal) {
        console.error("[poster] 致命的エラーのため投稿を中断します");
        break;
      }
    }
  }

  return results;
}
