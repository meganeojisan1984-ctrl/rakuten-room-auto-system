import Groq from "groq-sdk";
import * as dotenv from "dotenv";
import type { RakutenItem } from "./fetcher";
dotenv.config();

const GROQ_API_KEY = process.env.GROQ_API_KEY ?? "";
const MODEL_NAME = "llama-3.3-70b-versatile";

// レート制限対策: リクエスト間隔 (ms)
const REQUEST_INTERVAL_MS = 2000;
const MAX_RETRIES = 3;
const RETRY_BASE_DELAY_MS = 5000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function generateWithRetry(
  client: Groq,
  prompt: string,
  attempt: number = 0
): Promise<string> {
  try {
    const completion = await client.chat.completions.create({
      model: MODEL_NAME,
      messages: [{ role: "user", content: prompt }],
      max_tokens: 512,
      temperature: 0.8,
    });
    const text = completion.choices[0]?.message?.content ?? "";
    if (!text) throw new Error("Groq APIからの応答が空です");
    return text;
  } catch (err: unknown) {
    const errorMsg = String(err);
    const isRateLimit =
      errorMsg.includes("429") ||
      errorMsg.includes("rate_limit") ||
      errorMsg.includes("Rate limit");

    if (isRateLimit && attempt < MAX_RETRIES) {
      const delay = RETRY_BASE_DELAY_MS * Math.pow(2, attempt);
      console.warn(
        `[generator] レート制限に達しました。${delay / 1000}秒後にリトライ (${attempt + 1}/${MAX_RETRIES})`
      );
      await sleep(delay);
      return generateWithRetry(client, prompt, attempt + 1);
    }
    throw err;
  }
}

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

export async function generateCaption(item: RakutenItem): Promise<string> {
  if (!GROQ_API_KEY) {
    throw new Error("GROQ_API_KEY が未設定です");
  }

  const client = new Groq({ apiKey: GROQ_API_KEY });
  const prompt = buildPrompt(item);

  console.log(`[generator] 「${item.itemName.slice(0, 30)}...」の紹介文を生成中`);
  const caption = await generateWithRetry(client, prompt);
  console.log("[generator] 紹介文生成完了");
  return caption.trim();
}

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
    }

    if (i < items.length - 1) {
      console.log(`[generator] レート制限対策: ${REQUEST_INTERVAL_MS / 1000}秒待機...`);
      await sleep(REQUEST_INTERVAL_MS);
    }
  }

  return results;
}
