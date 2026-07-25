/**
 * tools/export-affiliate-cookie.ts
 * ローカル用: ブラウザを開いてユーザーが手動ログイン後、
 * 楽天アフィリエイト管理画面の Cookie を取得・出力するツール
 *
 * 使い方: npm run export-affiliate-cookie
 */

import { chromium } from "playwright";
import * as fs from "fs";
import * as path from "path";

const AFFILIATE_TOP_URL = "https://affiliate.rakuten.co.jp/";
// 認証必須ページに直接アクセス → 未ログインなら 楽天SSO へリダイレクト → ログイン後 /mypage に戻る
const AFFILIATE_MYPAGE_URL = "https://affiliate.rakuten.co.jp/mypage";
const OUTPUT_FILE = path.join(process.cwd(), "cookies-affiliate.json");

async function main(): Promise<void> {
  console.log("=== 楽天アフィリエイト Cookie エクスポートツール ===");
  console.log("ブラウザが開きます。楽天IDでログインしてください。");
  console.log("ログイン完了後、このスクリプトが自動でCookieを取得します。\n");

  const browser = await chromium.launch({
    headless: false,
    args: ["--start-maximized"],
  });
  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    locale: "ja-JP",
    timezoneId: "Asia/Tokyo",
    viewport: null,
  });
  const page = await context.newPage();
  await page.goto(AFFILIATE_MYPAGE_URL, { waitUntil: "domcontentloaded" });

  console.log(`楽天アフィリエイトのマイページ (${AFFILIATE_MYPAGE_URL}) にログイン後の遷移完了を待機（最大15分）...`);
  // ログイン完了判定: マイページ or レポートページ or auth/callback 後の /?...状態 に着地
  await page.waitForURL(
    (url) => {
      const s = url.href;
      return (
        s.startsWith("https://affiliate.rakuten.co.jp/mypage") ||
        s.startsWith("https://affiliate.rakuten.co.jp/report") ||
        (s.startsWith(AFFILIATE_TOP_URL) &&
          !s.includes("login") &&
          !s.includes("account.rakuten.com"))
      );
    },
    { timeout: 900000 },
  );
  // 認証セッションが完全に確立するまで念のため待つ（SSO cookie 反映のため2秒）
  await page.waitForTimeout(2000);

  console.log("\nログイン完了を検知しました！Cookieを取得中...");
  const cookies = await context.cookies();

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(cookies, null, 2), "utf-8");
  console.log(`\n✅ Cookieを保存しました: ${OUTPUT_FILE}`);

  console.log("\n=== GitHub Secrets 用 (RAKUTEN_AFFILIATE_COOKIE の値) ===");
  console.log("以下の文字列をコピーして、GitHubリポジトリのSecrets > RAKUTEN_AFFILIATE_COOKIE に貼り付けてください:\n");
  console.log(JSON.stringify(cookies) + "\n");

  await browser.close();
  console.log("ブラウザを閉じました。");
}

main().catch((err: unknown) => {
  console.error("エラーが発生しました:", err);
  process.exit(1);
});
