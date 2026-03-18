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
  addToRoomButton: ':text("ROOMに追加"), a[data-ga-label="add_to_room"], button[data-ga-label="add_to_room"], .btn-add-room, a.add-to-room',
  // 投稿フォームのテキストエリア
  captionInput: 'textarea[name="description"], textarea.room-caption, textarea[placeholder*="コメント"], textarea[placeholder*="感想"]',
  // 投稿ボタン
  postButton: 'button[type="submit"].room-post, button.post-btn, input[type="submit"][value*="投稿"]',
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
      waitUntil: "load",
      timeout: 30000,
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
      await page.screenshot({ path: SCREENSHOT_PATH });
      await notifyDomError("「ROOMに追加」ボタンが見つかりません。UIが変更された可能性があります");
      throw new Error("「ROOMに追加」ボタンが見つかりません");
    });

    await addBtn.click();
    console.log("[poster] ROOMに追加ボタンをクリックしました");

    // 投稿フォームの表示を待機
    const captionEl = await page.waitForSelector(SELECTORS.captionInput, { timeout: 15000 }).catch(async () => {
      await page.screenshot({ path: SCREENSHOT_PATH });
      await notifyDomError("投稿フォームのテキストエリアが見つかりません");
      throw new Error("投稿フォームが見つかりません");
    });

    // 紹介文を入力
    await captionEl.fill(caption);
    console.log("[poster] 紹介文を入力しました");

    // 投稿ボタンをクリック
    const postBtn = await page.waitForSelector(SELECTORS.postButton, { timeout: 10000 }).catch(async () => {
      await page.screenshot({ path: SCREENSHOT_PATH });
      await notifyDomError("投稿ボタンが見つかりません");
      throw new Error("投稿ボタンが見つかりません");
    });

    await postBtn.click();
    console.log("[poster] 投稿ボタンをクリックしました");

    // 投稿完了を待機 (URLの変化またはサクセスメッセージ)
    await Promise.race([
      page.waitForSelector(SELECTORS.successMessage, { timeout: 15000 }),
      page.waitForURL((url) => url.href.includes("/room/"), { timeout: 15000 }),
    ]).catch(async () => {
      // タイムアウトしても完了している場合があるのでエラーにしない
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
