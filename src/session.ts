import { chromium, type BrowserContext, type Cookie } from "playwright";
import * as fs from "fs";
import * as path from "path";
import * as dotenv from "dotenv";
import { notifyCookieExpired } from "./notifiers";
import { assertRoomAccount, configuredRoomProfileUrl } from "./room-account";
dotenv.config();


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
 * ログイン済みヘッダの my ROOM が指定アカウントを指すことを確認する
 */
export async function validateSession(context: BrowserContext): Promise<boolean> {
  try {
    console.log("[session] Cookieの有効性を検証中...");
    await assertRoomAccount(context, configuredRoomProfileUrl());
    console.log("[session] 指定アカウントの my ROOM を確認しました");
    return true;
  } catch {
    console.warn("[session] 指定アカウントを確認できません。操作を停止します");
    await notifyCookieExpired();
    return false;
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
  const browser = await chromium.launch(getChromiumLaunchOptions(headless));
  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    locale: "ja-JP",
    timezoneId: "Asia/Tokyo",
  });
  await injectCookies(context, cookies);
  return { browser, context };
}

/**
 * 楽天の商品ページがHTTP/2接続を異常終了させる環境があるため、
 * 投稿に使うChromiumではHTTP/2を無効化する。
 */
export function getChromiumLaunchOptions(headless: boolean) {
  return {
    headless,
    args: ["--disable-http2"],
  };
}
