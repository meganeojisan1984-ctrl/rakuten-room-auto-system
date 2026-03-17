/**
 * tools/cookie-exporter.ts
 * ローカル用: ブラウザを開いてユーザーが手動ログイン後、
 * 楽天ROOMのCookieを取得・出力するツール
 *
 * 使い方: npm run export-cookie
 */

import { chromium } from "playwright";
import * as fs from "fs";
import * as path from "path";

const ROOM_URL = "https://room.rakuten.co.jp";
const LOGIN_URL = "https://grp01.id.rakuten.co.jp/rms/nid/login?service_id=top&r=https%3A%2F%2Froom.rakuten.co.jp%2F";
const OUTPUT_FILE = path.join(process.cwd(), "cookies.json");

async function main(): Promise<void> {
  console.log("=== 楽天ROOM Cookie エクスポートツール ===");
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

  // ログインページへ移動
  await page.goto(LOGIN_URL, { waitUntil: "domcontentloaded" });

  console.log("ログインページが開きました。手動でログインしてください...");
  console.log(`楽天ROOMのマイページ (${ROOM_URL}/my) に遷移するまで待機します`);

  // 楽天ROOMのマイページに遷移するまで待機（最大5分）
  await page.waitForURL((url) => url.href.startsWith(ROOM_URL), {
    timeout: 300000,
  });

  console.log("\nログイン完了を検知しました！Cookieを取得中...");

  // Cookieを取得
  const cookies = await context.cookies();

  // JSONファイルに出力
  const jsonOutput = JSON.stringify(cookies, null, 2);
  fs.writeFileSync(OUTPUT_FILE, jsonOutput, "utf-8");
  console.log(`\n✅ Cookieを保存しました: ${OUTPUT_FILE}`);

  // GitHub Secrets用の1行JSON出力
  const singleLine = JSON.stringify(cookies);
  console.log("\n=== GitHub Secrets 用 (ROOM_COOKIE の値) ===");
  console.log("以下の文字列をコピーして、GitHubリポジトリのSecrets > ROOM_COOKIE に貼り付けてください:");
  console.log("\n" + singleLine + "\n");

  await browser.close();
  console.log("ブラウザを閉じました。");
}

main().catch((err) => {
  console.error("エラーが発生しました:", err);
  process.exit(1);
});
