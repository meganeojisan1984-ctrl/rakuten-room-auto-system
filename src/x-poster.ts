import { TwitterApi } from "twitter-api-v2";
import * as dotenv from "dotenv";
dotenv.config();

const X_API_KEY = process.env.X_API_KEY ?? "";
const X_API_SECRET = process.env.X_API_SECRET ?? "";
const X_ACCESS_TOKEN = process.env.X_ACCESS_TOKEN ?? "";
const X_ACCESS_TOKEN_SECRET = process.env.X_ACCESS_TOKEN_SECRET ?? "";

// TwitterのURL短縮後の表示文字数（常に23文字として計算）
const URL_CHAR_COUNT = 23;
const MAX_TWEET_LENGTH = 280;

/**
 * ツイート本文を組み立てる。
 * キャプション + 商品URL が280文字に収まるようにキャプションを切り詰める。
 */
function buildTweetText(caption: string, itemUrl: string): string {
  // URL部分はスペース1文字 + 短縮URL23文字 = 24文字
  const urlPartLength = 1 + URL_CHAR_COUNT;
  const maxCaptionLength = MAX_TWEET_LENGTH - urlPartLength;

  const trimmedCaption =
    caption.length > maxCaptionLength
      ? caption.slice(0, maxCaptionLength - 1) + "…"
      : caption;

  return `${trimmedCaption} ${itemUrl}`;
}

/**
 * X（旧Twitter）へ商品紹介ツイートを投稿する。
 * 認証情報が未設定の場合はスキップ（falseを返す）。
 * 投稿失敗時もエラーをスローせず、falseを返す（メイン処理を止めない）。
 */
export async function postToX(
  itemName: string,
  itemUrl: string,
  caption: string
): Promise<boolean> {
  if (!X_API_KEY || !X_API_SECRET || !X_ACCESS_TOKEN || !X_ACCESS_TOKEN_SECRET) {
    console.warn("[x-poster] X API認証情報が未設定のためスキップします（X_API_KEY / X_API_SECRET / X_ACCESS_TOKEN / X_ACCESS_TOKEN_SECRET）");
    return false;
  }

  try {
    const client = new TwitterApi({
      appKey: X_API_KEY,
      appSecret: X_API_SECRET,
      accessToken: X_ACCESS_TOKEN,
      accessSecret: X_ACCESS_TOKEN_SECRET,
    });

    const tweetText = buildTweetText(caption, itemUrl);
    console.log(`[x-poster] X(Twitter)へ投稿中: 「${itemName.slice(0, 30)}...」`);
    console.log(`[x-poster] ツイート文字数: ${tweetText.length}文字`);

    await client.v2.tweet(tweetText);
    console.log("[x-poster] ✅ X(Twitter)投稿成功");
    return true;
  } catch (err: unknown) {
    const errMsg = String(err);
    // レート制限（429）は警告レベルに留める
    if (errMsg.includes("429") || errMsg.includes("Rate limit")) {
      console.warn("[x-poster] X APIレート制限に達しました。次回の実行時に再試行されます");
    } else {
      console.error("[x-poster] X(Twitter)投稿失敗:", err);
    }
    return false;
  }
}
