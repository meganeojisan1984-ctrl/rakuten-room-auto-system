import { chromium, type BrowserContext, type Cookie } from "playwright";
import * as fs from "fs";
import * as path from "path";
import * as dotenv from "dotenv";
dotenv.config();

const ROOM_URL = "https://room.rakuten.co.jp";
const LOGIN_URL = "https://grp01.id.rakuten.co.jp";

/**
 * Cookie配列を取得する。
 * 1. 環境変数 ROOM_COOKIE (GitHub Actions用)
 * 2. cookies.json (ローカル用。Cookie値に#等が含まれるとdotenvが値を壊すため、
 *    ローカルではファイル読みが確実)
 */
export function parseCookiesFromEnv(): Cookie[] {
  const raw = process.env.ROOM_COOKIE ?? "";
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) return parsed as Cookie[];
    } catch {
      console.warn("[session] 環境変数ROOM_COOKIEのパース失敗、cookies.jsonへフォールバック");
    }
  }
  const file = path.join(process.cwd(), "cookies.json");
  if (fs.existsSync(file)) {
    const parsed = JSON.parse(fs.readFileSync(file, "utf-8")) as unknown;
    if (Array.isArray(parsed)) return parsed as Cookie[];
  }
  throw new Error("ROOM_COOKIE のパース失敗（環境変数・cookies.json ともに利用不可）");
}

/**
 * BrowserContextにCookieを注入する
 */
export async function injectCookies(context: BrowserContext, cookies: Cookie[]): Promise<void> {
  if (cookies.length === 0) {
    throw new Error("注入するCookieが空です。ROOM_COOKIE 環境変数を確認してください");
  }
  await context.addCookies(cookies);
  console.log(`[session] ${cookies.length}件のCookieを注入しました`);
}

/**
 * Cookieが有効（ログイン状態）かどうかを検証する
 * 楽天ROOMにアクセスし、ログインページにリダイレクトされないか確認する
 */
export async function validateSession(context: BrowserContext): Promise<boolean> {
  const page = await context.newPage();
  try {
    console.log("[session] Cookieの有効性を検証中...");
    await page.goto(`${ROOM_URL}/my`, {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });
    const currentUrl = page.url();
    // ログインページへリダイレクトされた場合はセッション無効
    if (currentUrl.includes(LOGIN_URL) || currentUrl.includes("/login") || currentUrl.includes("signin")) {
      console.warn("[session] セッション無効: ログインページへリダイレクトされました");
      return false;
    }
    console.log("[session] セッション有効確認済み");
    return true;
  } catch (err) {
    console.error("[session] セッション検証中にエラー:", err);
    return false;
  } finally {
    await page.close();
  }
}

/**
 * Cookie付きBrowserContextを作成して返す（呼び出し側でclose()すること）
 */
export async function createAuthenticatedContext(headless = true): Promise<{
  browser: Awaited<ReturnType<typeof chromium.launch>>;
  context: BrowserContext;
}> {
  const cookies = parseCookiesFromEnv();
  const browser = await chromium.launch({ headless });
  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    locale: "ja-JP",
    timezoneId: "Asia/Tokyo",
  });
  await injectCookies(context, cookies);
  return { browser, context };
}
