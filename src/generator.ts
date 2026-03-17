import { GoogleGenerativeAI } from "@google/generative-ai";
import * as dotenv from "dotenv";
import type { RakutenItem } from "./fetcher";
dotenv.config();

const GEMINI_API_KEY = process.env.GEMINI_API_KEY ?? "";
const MODEL_NAME = "gemini-2.0-flash";

// Free Tier制限対策: リクエスト間隔 (ms)
const REQUEST_INTERVAL_MS = 4000; // 15RPM制限に対応 (60秒/15 = 4秒)
const MAX_RETRIES = 3;
const RETRY_BASE_DELAY_MS = 10000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Exponential Backoffでリトライ
 */
async function generateWithRetry(
  genAI: GoogleGenerativeAI,
  prompt: string,
  attempt: number = 0
): Promise<string> {
  try {
    const model = genAI.getGenerativeModel({ model: MODEL_NAME });
    const result = await model.generateContent(prompt);
    const text = result.response.text();
    if (!text) throw new Error("Gemini APIからの応答が空です");
    return text;
  } catch (err: unknown) {
    const errorMsg = String(err);
    const isRateLimit =
      errorMsg.includes("429") ||
      errorMsg.includes("RESOURCE_EXHAUSTED") ||
      errorMsg.includes("rate limit");

    if (isRateLimit && attempt < MAX_RETRIES) {
      const delay = RETRY_BASE_DELAY_MS * Math.pow(2, attempt);
      console.warn(
        `[generator] レート制限に達しました。${delay / 1000}秒後にリトライ (${attempt + 1}/${MAX_RETRIES})`
      );
      await sleep(delay);
      return generateWithRetry(genAI, prompt, attempt + 1);
    }
    throw err;
  }
}

/**
 * 商品情報からプロモーション文を生成するプロンプトを構築
 */
function buildPrompt(item: RakutenItem): string {
  const bonusInfo: string[] = [];
  if (item.hasPointBonus) {
    bonusInfo.push(`🎯 ポイント${item.pointRate}倍獲得チャンス！`);
  }
  if (item.hasCoupon) {
    bonusInfo.push("🎫 クーポン・割引あり！");
  }
  const bonusText = bonusInfo.length > 0
    ? `\n【お得情報（最優先でアピールしてください）】\n${bonusInfo.join("\n")}`
    : "";

  return `あなたは楽天ROOMのインフルエンサーです。以下の商品情報をもとに、楽天ROOMへの投稿文を日本語で生成してください。

【商品情報】
- 商品名: ${item.itemName}
- 価格: ${item.itemPrice.toLocaleString()}円
- ショップ: ${item.shopName}
- 商品説明: ${item.itemCaption.slice(0, 200)}${bonusText}

【生成ルール】
1. スペックの羅列ではなく、「この商品を買うと生活がどう良くなるか」というベネフィットを強調してください
2. お得情報（ポイントアップ、クーポン）がある場合は必ず冒頭で最優先にアピールしてください
3. SNS映えする自然なトーンで、自動投稿だと悟らせない文章にしてください
4. 全体で150〜250文字程度（ハッシュタグ含む）に収めてください
5. 末尾に関連するハッシュタグを3〜5個付けてください（#楽天ROOM #買ってよかった を必ず含める）
6. 絵文字を適度に使って読みやすくしてください

投稿文のみを出力してください（前置きや説明は不要です）:`;
}

/**
 * 1つの商品に対してGeminiで紹介文を生成
 */
export async function generateCaption(item: RakutenItem): Promise<string> {
  if (!GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY が未設定です");
  }

  const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
  const prompt = buildPrompt(item);

  console.log(`[generator] 「${item.itemName.slice(0, 30)}...」の紹介文を生成中`);
  const caption = await generateWithRetry(genAI, prompt);
  console.log("[generator] 紹介文生成完了");
  return caption.trim();
}

/**
 * 複数商品に対してレート制限を考慮しながら紹介文を一括生成
 */
export async function generateCaptions(
  items: RakutenItem[]
): Promise<Array<{ item: RakutenItem; caption: string }>> {
  const results: Array<{ item: RakutenItem; caption: string }> = [];

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (!item) continue;

    try {
      const caption = await generateCaption(item);
      results.push({ item, caption });
    } catch (err) {
      console.error(`[generator] 商品「${item.itemName.slice(0, 30)}」の生成失敗:`, err);
      // 失敗した商品はスキップ
    }

    // 最後の商品以外はレート制限対策のウェイト
    if (i < items.length - 1) {
      console.log(`[generator] レート制限対策: ${REQUEST_INTERVAL_MS / 1000}秒待機...`);
      await sleep(REQUEST_INTERVAL_MS);
    }
  }

  return results;
}
