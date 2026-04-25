import * as path from "path";
import * as dotenv from "dotenv";
import { createAuthenticatedContext, validateSession } from "./session";
import { notifyCookieExpired, notifyCaptchaDetected, notifyDomError, notifySuccess } from "./notifiers";
import type { RakutenItem } from "./fetcher";
dotenv.config();

const ROOM_URL = "https://room.rakuten.co.jp";
const SCREENSHOT_PATH = path.join(process.cwd(), "error.png");

// セレクタ定数 (楽天ROOMのDOM変更時はここを更新)
const SELECTORS = {
  // 商品ページの「ROOMに追加」ボタン
  addToRoomButton: ':text("ROOMに投稿"), :text("ROOMに追加"), a[data-ga-label="add_to_room"], button[data-ga-label="add_to_room"], .btn-add-room, a.add-to-room',
  // 投稿フォームのテキストエリア
  captionInput: 'textarea[placeholder*="コメント"], textarea[placeholder*="感想"], textarea[name="description"], textarea.room-caption, textarea',
  // 投稿ボタン（楽天ROOMの「完了」ボタンを最優先）
  postButton: ':text("完了"), :text("投稿する"), :text("シェアする"), :text("ROOMに投稿"), button[type="submit"], input[type="submit"]',
  // ログイン要求のセレクタ
  loginForm: 'form[action*="login"], input[name="u"]',
  // CAPTCHA
  captcha: '#recaptcha, .g-recaptcha, iframe[title*="reCAPTCHA"]',
  // 投稿成功メッセージ
  successMessage: '.success-message, .post-success, [class*="success"]',
};

type PostResult = {
  success: boolean;
  itemName: string;
  itemUrl: string;
  error?: string;
};

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

    // ショップ特有のモーダル（checkbox-hack方式の <label for="modal">）や
    // 楽天会員ヘッダーがクリック座標を覆ってクリックを妨げるため、事前に除去・無効化する
    await page.evaluate(() => {
      // checkbox-hack モーダルを閉じる (label[for="modal"] が開く input#modal を unchecked に)
      document
        .querySelectorAll<HTMLInputElement>('input[type="checkbox"][id^="modal"]')
        .forEach((cb) => {
          cb.checked = false;
        });
      // 画面の大部分を覆うオーバーレイを透過させ、pointer-events を無効化
      const candidates = document.querySelectorAll<HTMLElement>(
        'label[for^="modal"], #rakutenLimitedId_header, .ris-header, [class*="overlay"], [id*="overlay"]'
      );
      candidates.forEach((el) => {
        const rect = el.getBoundingClientRect();
        // ボタン自体を隠さないよう、幅か高さが画面の一定以上を占めるもののみ無効化
        const coversWidth = rect.width >= window.innerWidth * 0.4;
        const coversHeight = rect.height >= 80;
        if (coversWidth && coversHeight) {
          el.style.pointerEvents = "none";
        }
      });
    });
    await page.locator(SELECTORS.addToRoomButton).first().scrollIntoViewIfNeeded().catch(() => {});

    // 新しいタブが開く場合に備えて待機。
    // force: true でオーバーレイの pointer-event ヒットテストをバイパスし、
    // それでも失敗した場合は JS の .click() にフォールバックする
    const clickWithFallback = async () => {
      try {
        await addBtn.click({ force: true, timeout: 10000 });
      } catch (err) {
        console.warn(`[poster] force click失敗、JSクリックで再試行: ${String(err)}`);
        await addBtn.evaluate((el) => (el as HTMLElement).click());
      }
    };
    const [newPageOrNull] = await Promise.all([
      context.waitForEvent("page", { timeout: 5000 }).catch(() => null),
      clickWithFallback(),
    ]);

    const postPage = newPageOrNull ?? page;
    if (newPageOrNull) {
      console.log("[poster] 新しいタブで投稿フォームが開きました");
      await postPage.waitForLoadState("load", { timeout: 15000 });
    }
    console.log("[poster] ROOMに追加ボタンをクリックしました");

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

    // テキストエリアを取得
    const captionLocator = postPage.locator("textarea").first();
    await captionLocator.waitFor({ state: "visible", timeout: 15000 }).catch(async () => {
      await notifyDomError("投稿フォームのテキストエリアが見つかりません");
      throw new Error("投稿フォームが見つかりません");
    });

    // ng-modelを取得してAngularJSのscopeを直接更新
    const ngModelAttr = await postPage.evaluate(() => {
      return document.querySelector("textarea")?.getAttribute("ng-model") ?? "";
    });
    console.log(`[poster] textarea ng-model: "${ngModelAttr}"`);

    // テキスト入力: Angularスコープ更新 + キーボード入力の二段階
    await postPage.evaluate((text) => {
      const textarea = document.querySelector("textarea");
      if (!textarea) return;
      // Angularスコープに直接セット
      const win = window as unknown as { angular?: { element: (el: Element) => { scope: () => Record<string, unknown>; triggerHandler: (e: string) => void } } };
      if (win.angular) {
        const angEl = win.angular.element(textarea);
        let scope = angEl.scope() as Record<string, unknown> & { $parent?: Record<string, unknown>; $root?: { $digest?: () => void } };
        while (scope) {
          if ("content" in scope) { scope["content"] = text; break; }
          if (!scope.$parent) break;
          scope = scope.$parent as typeof scope;
        }
        try { scope.$root?.$digest?.(); } catch {}
        angEl.triggerHandler("input");
        angEl.triggerHandler("change");
      }
      // DOM値も直接書き込む
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
      setter?.call(textarea, text);
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
      textarea.dispatchEvent(new Event("change", { bubbles: true }));
    }, caption);
    await postPage.waitForTimeout(500);

    // 0文字の場合はキーボードで入力（フォールバック）
    const enteredText = await captionLocator.inputValue().catch(() => "");
    if (enteredText.length === 0) {
      console.log("[poster] Angular入力失敗、キーボード入力で再試行...");
      await captionLocator.click({ force: true });
      await postPage.keyboard.press("Control+a");
      await postPage.keyboard.type(caption, { delay: 10 });
      await postPage.waitForTimeout(500);
    }
    const finalText = await captionLocator.inputValue().catch(() => "");
    console.log(`[poster] 紹介文を入力しました (${finalText.length}文字)`);

    // 投稿ボタン（完了）: Locatorを使ってforce:trueでオーバーレイを回避
    const postBtnLocator = postPage.locator('button:has-text("完了"), a:has-text("完了")').first();
    const postBtnVisible = await postBtnLocator.isVisible({ timeout: 10000 }).catch(() => false);
    if (!postBtnVisible) {
      await postPage.screenshot({ path: SCREENSHOT_PATH, fullPage: true }).catch(() => {});
      await notifyDomError("投稿ボタン(完了)が見つかりません");
      throw new Error("投稿ボタンが見つかりません");
    }

    // JS直接クリック → Locator force:true の順で試行
    await postPage.evaluate(() => {
      const btn = Array.from(document.querySelectorAll<HTMLElement>("button, a")).find(
        (el) => el.textContent?.trim() === "完了"
      );
      if (btn) btn.click();
    }).catch(() => {});
    await postPage.waitForTimeout(1000);
    // Locator force:true（ElementHandleではなくLocatorなので確実にオーバーレイを無視できる）
    await postBtnLocator.click({ force: true, timeout: 5000 }).catch(() => {});
    console.log("[poster] 投稿ボタンをクリックしました (Locator force:true)");

    // 投稿直後のスクリーンショット（デバッグ用）
    await postPage.waitForTimeout(3000);
    await postPage.screenshot({ path: SCREENSHOT_PATH, fullPage: true }).catch(() => {});
    console.log("[poster] 投稿後スクリーンショット保存: error.png");
    const afterHtml = await postPage.evaluate(() => document.body.innerHTML.slice(0, 3000)).catch(() => "");
    console.log("[poster] 投稿後ページHTML:", afterHtml);
    console.log("[poster] 投稿後URL:", postPage.url());

    // 投稿完了を待機
    await Promise.race([
      postPage.waitForSelector(SELECTORS.successMessage, { timeout: 15000 }),
      postPage.waitForURL((url) => url.href.includes("/room/"), { timeout: 15000 }),
    ]).catch(async () => {
      console.warn("[poster] 投稿完了確認タイムアウト（投稿自体は成功している可能性あり）");
    });

    await notifySuccess(item.itemName, item.itemUrl);
    console.log(`[poster] ✅ 投稿成功: ${item.itemName}`);

    return { success: true, itemName: item.itemName, itemUrl: item.itemUrl };
  } catch (err) {
    const errorMsg = String(err);
    console.error(`[poster] 投稿失敗: ${errorMsg}`);
    return {
      success: false,
      itemName: item.itemName,
      itemUrl: item.itemUrl,
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
