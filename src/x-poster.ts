import { TwitterApi } from "twitter-api-v2";
import * as https from "https";
import * as http from "http";
import * as dotenv from "dotenv";
import { notifyXCreditsDepleted } from "./notifiers";
dotenv.config();

const X_API_KEY = process.env.X_API_KEY ?? "";
const X_API_SECRET = process.env.X_API_SECRET ?? "";
const X_ACCESS_TOKEN = process.env.X_ACCESS_TOKEN ?? "";
const X_ACCESS_TOKEN_SECRET = process.env.X_ACCESS_TOKEN_SECRET ?? "";
const X_USERNAME = process.env.X_USERNAME ?? "";

const MAX_TWEET_LENGTH = 280;
// Twitter URL短縮後の表示文字数（常に23文字として計算）
const URL_CHAR_COUNT = 23;

/**
 * フォロー誘導CTAパターン（リプライ末尾にランダムで1つ挿入）
 * パターンAのみ @X_USERNAME を動的に埋め込む
 */
const CTA_PATTERNS = [
  `最新のQOL爆上げアイテムやお得情報はプロフから発信中！見逃さないようフォローしてね ▷ @${X_USERNAME}`,
  `毎日、1,000円台で買える「本当に良いモノ」だけ厳選して紹介してます。フォローしてチェック！✨`,
  `楽天セールや限定クーポン情報もリアルタイムで流します。賢くお買い物したい人はフォロー必須です`,
];

function getRandomCta(): string {
  return CTA_PATTERNS[Math.floor(Math.random() * CTA_PATTERNS.length)]!;
}

/**
 * 画像URLからBufferをダウンロード
 */
function downloadImage(url: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith("https") ? https : http;
    protocol
      .get(url, (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => resolve(Buffer.concat(chunks)));
        res.on("error", reject);
      })
      .on("error", reject);
  });
}

/**
 * リプライテキストを組み立てる（URL + CTA）
 * - URL(23文字扱い) + 改行2行 + CTAパターン
 * - 280文字を超える場合はCTAを切り詰める
 */
function buildReplyText(itemUrl: string): string {
  const cta = getRandomCta();
  const separator = "\n\n";
  const full = `${itemUrl}${separator}${cta}`;

  if (full.length <= MAX_TWEET_LENGTH) return full;

  // URLは23文字扱いで計算（短縮される）
  const usedByUrl = URL_CHAR_COUNT + separator.length;
  const maxCta = MAX_TWEET_LENGTH - usedByUrl - 1; // "…" 1文字分
  return `${itemUrl}${separator}${cta.slice(0, maxCta)}…`;
}

/**
 * X（旧Twitter）へ2段階スレッドで投稿する。
 *
 * 1件目（親ツイート）:
 *   - 商品画像を添付
 *   - PAS法で生成したキャプション（URLなし・ハッシュタグ2個以内）
 *
 * 2件目（セルフリプライ）:
 *   - 楽天ROOMの商品URL
 *   - ランダムなフォロー誘導CTA
 */
export async function postToX(
  itemName: string,
  itemUrl: string,
  parentCaption: string,
  imageUrl?: string
): Promise<boolean> {
  if (!X_API_KEY || !X_API_SECRET || !X_ACCESS_TOKEN || !X_ACCESS_TOKEN_SECRET) {
    console.warn(
      "[x-poster] X API認証情報が未設定のためスキップします（X_API_KEY / X_API_SECRET / X_ACCESS_TOKEN / X_ACCESS_TOKEN_SECRET）"
    );
    return false;
  }

  try {
    const client = new TwitterApi({
      appKey: X_API_KEY,
      appSecret: X_API_SECRET,
      accessToken: X_ACCESS_TOKEN,
      accessSecret: X_ACCESS_TOKEN_SECRET,
    });

    console.log(`[x-poster] X(Twitter)へスレッド投稿中: 「${itemName.slice(0, 30)}...」`);

    // ── 1件目: 親ツイート（画像 + キャプション）──────────────────
    let parentTweetId: string;

    if (imageUrl) {
      try {
        const imageBuffer = await downloadImage(imageUrl);
        const mediaId = await client.v1.uploadMedia(imageBuffer, { mimeType: "image/jpeg" });
        const parentTweet = await client.v2.tweet({
          text: parentCaption,
          media: { media_ids: [mediaId] },
        });
        parentTweetId = parentTweet.data.id;
        console.log("[x-poster] ✅ 親ツイート投稿成功（画像あり）");
      } catch (imgErr) {
        console.warn("[x-poster] 画像アップロード失敗、テキストのみで親ツイートを投稿:", imgErr);
        const parentTweet = await client.v2.tweet({ text: parentCaption });
        parentTweetId = parentTweet.data.id;
        console.log("[x-poster] ✅ 親ツイート投稿成功（テキストのみ）");
      }
    } else {
      const parentTweet = await client.v2.tweet({ text: parentCaption });
      parentTweetId = parentTweet.data.id;
      console.log("[x-poster] ✅ 親ツイート投稿成功");
    }

    // ── 2件目: セルフリプライ（URL + CTA）──────────────────────
    const replyText = buildReplyText(itemUrl);
    console.log(`[x-poster] リプライ文字数: ${replyText.length}文字`);

    await client.v2.tweet({
      text: replyText,
      reply: { in_reply_to_tweet_id: parentTweetId },
    });
    console.log("[x-poster] ✅ リプライ投稿成功（URL + CTA）");

    return true;
  } catch (err: unknown) {
    const errMsg = String(err);
    if (errMsg.includes("402") || errMsg.includes("CreditsDepleted")) {
      console.warn("[x-poster] X APIクレジット残高不足。Developer Portalでチャージが必要です");
      await notifyXCreditsDepleted();
    } else if (errMsg.includes("429") || errMsg.includes("Rate limit")) {
      console.warn("[x-poster] X APIレート制限に達しました。次回の実行時に再試行されます");
    } else {
      console.error("[x-poster] X(Twitter)投稿失敗:", err);
    }
    return false;
  }
}
