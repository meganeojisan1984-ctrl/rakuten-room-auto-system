/**
 * browser.ts - Playwright セッション管理・BAN対策
 * session.ts をラップし、よりステルス性の高い設定を付与
 */
import { chromium, type BrowserContext, type Browser } from "playwright";
import * as fs from "fs";
import * as path from "path";
import * as dotenv from "dotenv";
dotenv.config();

const SESSION_FILE = path.join(process.cwd(), "data", "session.json");
const LOGIN_URL = "https://grp01.id.rakuten.co.jp";
const ROOM_URL = "https://room.rakuten.co.jp";

// BAN対策: ヒューマンらしい User-Agent 一覧
const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
];

function randomUserAgent(): string {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)]!;
}

/**
 * Cookieを環境変数または data/session.json から読み込む
 */
export function loadCookies(): unknown[] {
  // 1. .env の ROOM_COOKIE を優先
  const envCookie = process.env.ROOM_COOKIE;
  if (envCookie && envCookie !== "[]") {
    try {
      const parsed = JSON.parse(envCookie) as unknown;
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    } catch {
      // fallthrough
    }
  }
  // 2. data/session.json を参照
  try {
    const raw = fs.readFileSync(SESSION_FILE, "utf-8");
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed) && parsed.length > 0) return parsed;
  } catch {
    // fallthrough
  }
  return [];
}

/**
 * Cookieを data/session.json へ保存
 */
export function saveCookies(cookies: unknown[]): void {
  const dir = path.dirname(SESSION_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(SESSION_FILE, JSON.stringify(cookies, null, 2));
  console.log(`[browser] セッション保存完了: ${SESSION_FILE}`);
}

/**
 * 認証済み BrowserContext を作成して返す
 * ヘッドレス/ヘッドフル両対応、BAN対策設定込み
 */
export async function createBrowserContext(headless = true): Promise<{
  browser: Browser;
  context: BrowserContext;
}> {
  const cookies = loadCookies();

  const browser = await chromium.launch({
    headless,
    args: [
      "--no-sandbox",
      "--disable-blink-features=AutomationControlled",
      "--disable-infobars",
    ],
  });

  const context = await browser.newContext({
    userAgent: randomUserAgent(),
    locale: "ja-JP",
    timezoneId: "Asia/Tokyo",
    viewport: { width: 1366, height: 768 },
    extraHTTPHeaders: {
      "Accept-Language": "ja-JP,ja;q=0.9,en-US;q=0.8,en;q=0.7",
    },
  });

  // WebDriver検知回避
  await context.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => undefined });
  });

  if (cookies.length > 0) {
    await context.addCookies(cookies as Parameters<BrowserContext["addCookies"]>[0]);
    console.log(`[browser] ${cookies.length}件のCookieを注入しました`);
  } else {
    console.warn("[browser] Cookieが未設定です。手動ログインが必要な可能性があります");
  }

  return { browser, context };
}

/**
 * セッションが有効か確認する
 */
export async function validateSession(context: BrowserContext): Promise<boolean> {
  const page = await context.newPage();
  try {
    await page.goto(`${ROOM_URL}/my`, { waitUntil: "domcontentloaded", timeout: 30000 });
    const url = page.url();
    const isValid = !url.includes(LOGIN_URL) && !url.includes("/login") && !url.includes("signin");
    console.log(`[browser] セッション検証: ${isValid ? "有効" : "無効"} (${url})`);
    return isValid;
  } catch {
    return false;
  } finally {
    await page.close();
  }
}
