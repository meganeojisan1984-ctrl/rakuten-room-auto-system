import axios from "axios";
import * as dotenv from "dotenv";
dotenv.config();

const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL ?? "";

/**
 * Discordへメッセージを送信する共通関数
 */
async function sendToDiscord(content: string): Promise<void> {
  if (!DISCORD_WEBHOOK_URL) {
    console.warn("[notifiers] DISCORD_WEBHOOK_URL が未設定のため通知をスキップします");
    return;
  }
  try {
    await axios.post(DISCORD_WEBHOOK_URL, { content });
    console.log("[notifiers] Discord通知送信完了");
  } catch (err) {
    console.error("[notifiers] Discord通知送信失敗:", err);
  }
}

/**
 * 投稿成功通知
 */
export async function notifySuccess(itemName: string, itemUrl: string): Promise<void> {
  const message = `✅ **楽天ROOM投稿成功**\n商品: ${itemName}\nURL: ${itemUrl}`;
  await sendToDiscord(message);
}

/**
 * Cookie期限切れ / 再ログイン要求の警告通知
 */
export async function notifyCookieExpired(): Promise<void> {
  const message =
    "⚠️ **【要対応】楽天ROOMのCookieが期限切れです**\n" +
    "`npm run export-cookie` を実行して、新しいCookieを取得し、GitHub Secretsの `ROOM_COOKIE` を更新してください。";
  await sendToDiscord(message);
}

/**
 * CAPTCHA遭遇の警告通知
 */
export async function notifyCaptchaDetected(): Promise<void> {
  const message =
    "🚨 **【緊急】CAPTCHA検知**\n楽天ROOMへのアクセス中にCAPTCHAが表示されました。\n" +
    "しばらく時間をおいてから再試行するか、Cookieを更新してください。";
  await sendToDiscord(message);
}

/**
 * API連続エラーの警告通知
 */
export async function notifyApiError(apiName: string, errorMessage: string): Promise<void> {
  const message =
    `🔴 **API エラー (${apiName})**\n` +
    `\`\`\`\n${errorMessage}\n\`\`\``;
  await sendToDiscord(message);
}

/**
 * DOM変更 / 要素が見つからない場合のエラー通知
 */
export async function notifyDomError(errorMessage: string): Promise<void> {
  const message =
    "🔴 **楽天ROOM DOM エラー**\n" +
    "楽天ROOMのUI構造が変更された可能性があります。スクリーンショットを確認してください。\n" +
    `\`\`\`\n${errorMessage}\n\`\`\``;
  await sendToDiscord(message);
}

/**
 * X APIクレジット枯渇通知
 */
export async function notifyXCreditsDepleted(): Promise<void> {
  const message =
    "⚠️ **【要対応】X APIクレジット残高不足**\n" +
    "X（Twitter）への投稿がクレジット不足（402エラー）で失敗しました。\n" +
    "X Developer Portal ( https://developer.x.com ) でプリペイドクレジットをチャージしてください。\n" +
    "チャージするまでX投稿はスキップされます。";
  await sendToDiscord(message);
}

/**
 * 汎用エラー通知
 */
export async function notifyError(title: string, errorMessage: string): Promise<void> {
  const message = `❌ **エラー: ${title}**\n\`\`\`\n${errorMessage}\n\`\`\``;
  await sendToDiscord(message);
}
