import { chromium, type Cookie } from "playwright";
import * as fs from "fs";
import * as path from "path";
import { createAuthenticatedContext, validateSession } from "../session";
import { notifyCookieExpired } from "../notifiers";

const AFFILIATE_TOP = "https://affiliate.rakuten.co.jp/";

async function diagnoseRoomCookie(): Promise<boolean> {
  const { browser, context } = await createAuthenticatedContext(true);
  try {
    const ok = await validateSession(context);
    console.log(`[diagnose] ROOM_COOKIE: ${ok ? "valid" : "INVALID"}`);
    if (!ok) await notifyCookieExpired();
    return ok;
  } finally {
    await context.close();
    await browser.close();
  }
}

function parseAffiliateCookies(): Cookie[] | null {
  const raw = process.env.RAKUTEN_AFFILIATE_COOKIE ?? "";
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) return parsed as Cookie[];
    } catch { /* fallthrough */ }
  }
  const file = path.join(process.cwd(), "cookies-affiliate.json");
  if (fs.existsSync(file)) {
    const parsed = JSON.parse(fs.readFileSync(file, "utf-8")) as unknown;
    if (Array.isArray(parsed)) return parsed as Cookie[];
  }
  return null;
}

async function diagnoseAffiliateCookie(): Promise<boolean> {
  const cookies = parseAffiliateCookies();
  if (!cookies) {
    console.log("[diagnose] RAKUTEN_AFFILIATE_COOKIE: 未設定");
    return false;
  }
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    locale: "ja-JP",
    timezoneId: "Asia/Tokyo",
  });
  await context.addCookies(cookies);
  const page = await context.newPage();
  try {
    await page.goto(AFFILIATE_TOP, { waitUntil: "domcontentloaded", timeout: 30000 });
    const url = page.url();
    const ok = !(url.includes("login") || url.includes("signin") || url.includes("grp01.id.rakuten.co.jp"));
    console.log(`[diagnose] RAKUTEN_AFFILIATE_COOKIE: ${ok ? "valid" : "INVALID"}`);
    return ok;
  } catch (err) {
    console.error(`[diagnose] affiliate check エラー:`, err);
    return false;
  } finally {
    await context.close();
    await browser.close();
  }
}

async function main(): Promise<void> {
  const roomOk = await diagnoseRoomCookie();
  const affiliateOk = await diagnoseAffiliateCookie();
  process.exit(roomOk && affiliateOk ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error("[diagnose] fatal:", err);
  process.exit(2);
});
