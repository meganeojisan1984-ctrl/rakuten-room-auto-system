/**
 * sns.ts - Instagram / Threads 自動クロス投稿（認知度拡大用）
 *
 * ROOM投稿成功後に同じ商品をInstagram・Threadsへ展開する。
 * 必要な環境変数が未設定のプラットフォームは自動スキップ（エラーにしない）。
 *
 * 必要な環境変数:
 * - Instagram: IG_USER_ID, IG_ACCESS_TOKEN (Instagram Graph API / ビジネスアカウント)
 * - Threads:   THREADS_USER_ID, THREADS_ACCESS_TOKEN (Threads API)
 * - 共通:      ROOM_PROFILE_URL (楽天ROOMのプロフィールURL。誘導先)
 */
import axios from "axios";
import * as dotenv from "dotenv";
import type { RakutenItem } from "./fetcher";
import { notifyError } from "./notifiers";
dotenv.config();

// 環境変数は呼び出し時に読む（テスト・動的設定に対応）
const env = (key: string): string => process.env[key] ?? "";

const GRAPH_API = "https://graph.facebook.com/v21.0";
const THREADS_API = "https://graph.threads.net/v1.0";

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** 楽天のサムネイルURL(128x128)を高解像度に差し替える (IGは320px以上必須) */
export function upscaleImageUrl(imageUrl: string, size = 640): string {
  if (!imageUrl) return imageUrl;
  if (imageUrl.includes("_ex=")) {
    return imageUrl.replace(/_ex=\d+x\d+/, `_ex=${size}x${size}`);
  }
  const sep = imageUrl.includes("?") ? "&" : "?";
  return `${imageUrl}${sep}_ex=${size}x${size}`;
}

/** ROOM用キャプションをInstagram用に変換（リンク不可→プロフィール誘導CTA） */
export function toInstagramCaption(caption: string): string {
  const cta = "\n\n▶ 商品リンクは楽天ROOMに載せてます！プロフィールのリンクからチェックしてね🛒";
  const extraTags = "\n#楽天roomに載せてます #楽天購入品 #楽天マラソン #お買い物マラソン";
  return `${caption}${cta}${extraTags}`.slice(0, 2200);
}

/** ROOM用キャプションをThreads用に変換（500字制限・リンク可） */
export function toThreadsCaption(caption: string): string {
  const roomUrl = env("ROOM_PROFILE_URL");
  const link = roomUrl ? `\n\n🛒 楽天ROOMで紹介中 → ${roomUrl}` : "";
  // ハッシュタグはThreadsでは効果が薄いので削って本文を優先
  const body = caption.replace(/#[^\s#]+/g, "").replace(/\n{3,}/g, "\n\n").trim();
  const maxBody = 500 - link.length;
  return `${body.slice(0, maxBody)}${link}`;
}

/**
 * Instagram Graph API で画像投稿
 * 1. メディアコンテナ作成 → 2. ステータス確認 → 3. 公開
 */
export async function postToInstagram(item: RakutenItem, caption: string): Promise<boolean> {
  const IG_USER_ID = env("IG_USER_ID");
  const IG_ACCESS_TOKEN = env("IG_ACCESS_TOKEN");
  if (!IG_USER_ID || !IG_ACCESS_TOKEN) {
    console.log("[sns] Instagram: 環境変数未設定のためスキップ");
    return false;
  }
  try {
    const imageUrl = upscaleImageUrl(item.imageUrl);
    console.log("[sns] Instagram: メディアコンテナ作成中...");
    const createRes = await axios.post<{ id: string }>(
      `${GRAPH_API}/${IG_USER_ID}/media`,
      null,
      {
        params: {
          image_url: imageUrl,
          caption: toInstagramCaption(caption),
          access_token: IG_ACCESS_TOKEN,
        },
        timeout: 30000,
      }
    );
    const creationId = createRes.data.id;

    // メディア処理完了を待機（最大60秒）
    for (let i = 0; i < 12; i++) {
      const statusRes = await axios.get<{ status_code: string }>(
        `${GRAPH_API}/${creationId}`,
        { params: { fields: "status_code", access_token: IG_ACCESS_TOKEN }, timeout: 15000 }
      );
      if (statusRes.data.status_code === "FINISHED") break;
      if (statusRes.data.status_code === "ERROR") {
        throw new Error("Instagramメディア処理エラー");
      }
      await sleep(5000);
    }

    console.log("[sns] Instagram: 公開中...");
    await axios.post(
      `${GRAPH_API}/${IG_USER_ID}/media_publish`,
      null,
      { params: { creation_id: creationId, access_token: IG_ACCESS_TOKEN }, timeout: 30000 }
    );
    console.log(`[sns] ✅ Instagram投稿成功: ${item.itemName.slice(0, 30)}`);
    return true;
  } catch (err) {
    const msg = axios.isAxiosError(err)
      ? JSON.stringify(err.response?.data ?? err.message).slice(0, 500)
      : String(err);
    console.error("[sns] Instagram投稿失敗:", msg);
    await notifyError("Instagram投稿失敗", msg);
    return false;
  }
}

/**
 * Threads API で投稿（画像あり: IMAGE / なし: TEXT）
 * 1. コンテナ作成 → 2. 30秒待機（公式推奨） → 3. 公開
 */
export async function postToThreads(item: RakutenItem, caption: string): Promise<boolean> {
  const THREADS_USER_ID = env("THREADS_USER_ID");
  const THREADS_ACCESS_TOKEN = env("THREADS_ACCESS_TOKEN");
  if (!THREADS_USER_ID || !THREADS_ACCESS_TOKEN) {
    console.log("[sns] Threads: 環境変数未設定のためスキップ");
    return false;
  }
  try {
    const text = toThreadsCaption(caption);
    const hasImage = !!item.imageUrl;
    const params: Record<string, string> = {
      media_type: hasImage ? "IMAGE" : "TEXT",
      text,
      access_token: THREADS_ACCESS_TOKEN,
    };
    if (hasImage) params.image_url = upscaleImageUrl(item.imageUrl);

    console.log("[sns] Threads: コンテナ作成中...");
    const createRes = await axios.post<{ id: string }>(
      `${THREADS_API}/${THREADS_USER_ID}/threads`,
      null,
      { params, timeout: 30000 }
    );

    // 公式推奨: メディア処理のため公開前に30秒待機（TEXTは短くてOK）
    await sleep(hasImage ? 30000 : 3000);

    console.log("[sns] Threads: 公開中...");
    await axios.post(
      `${THREADS_API}/${THREADS_USER_ID}/threads_publish`,
      null,
      {
        params: { creation_id: createRes.data.id, access_token: THREADS_ACCESS_TOKEN },
        timeout: 30000,
      }
    );
    console.log(`[sns] ✅ Threads投稿成功: ${item.itemName.slice(0, 30)}`);
    return true;
  } catch (err) {
    const msg = axios.isAxiosError(err)
      ? JSON.stringify(err.response?.data ?? err.message).slice(0, 500)
      : String(err);
    console.error("[sns] Threads投稿失敗:", msg);
    await notifyError("Threads投稿失敗", msg);
    return false;
  }
}

/**
 * ROOM投稿成功商品をInstagram・Threadsへクロス投稿
 * スパム防止のため1実行につき1商品のみ。失敗しても本体処理には影響させない。
 */
export async function crossPostToSns(
  items: Array<{ item: RakutenItem; caption: string }>
): Promise<{ attempted: boolean; instagram: boolean; threads: boolean }> {
  const none = { attempted: false, instagram: false, threads: false };
  const first = items[0];
  if (!first) return none;

  const igEnabled = !!(env("IG_USER_ID") && env("IG_ACCESS_TOKEN"));
  const threadsEnabled = !!(env("THREADS_USER_ID") && env("THREADS_ACCESS_TOKEN"));
  if (!igEnabled && !threadsEnabled) {
    console.log("[sns] Instagram/Threads未設定。クロス投稿をスキップ（SETUP-SNS.md参照）");
    return none;
  }

  console.log("\n--- SNSクロス投稿 (認知度拡大) ---");
  const instagram = igEnabled ? await postToInstagram(first.item, first.caption) : false;
  const threads = threadsEnabled ? await postToThreads(first.item, first.caption) : false;
  return { attempted: true, instagram, threads };
}
