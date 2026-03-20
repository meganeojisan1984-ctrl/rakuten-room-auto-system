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

  return `あなたは楽天ROOMで月100万円以上を稼ぐトップランカーです。SNS投稿のプロとして、読んだ人が「欲しい！」「買おう！」と思うような購買意欲を高める紹介文を日本語で生成してください。

【商品情報】
- 商品名: ${item.itemName}
- 価格: ${item.itemPrice.toLocaleString()}円
- ショップ: ${item.shopName}
- 商品説明: ${item.itemCaption.slice(0, 300)}${bonusText}

【絶対に守るルール】
1. 【購入前→購入後の変化】を具体的に描写する。「使う前は〇〇だったのに、使い始めてから△△が変わった！」という体験談スタイルで書く
2. 【購入後のメリット・ベネフィット】を中心に据え、スペックや機能の羅列は避ける。「これを使うと毎日の〇〇が楽になる」「〇〇が劇的に変わった」など、生活の変化や感情的な満足感を伝える
3. お得情報（ポイントアップ、クーポン）がある場合は文頭で強調し、「今がチャンス！」という緊急性を演出する
4. 【文章の強弱】を意識し、絵文字を戦略的に使って重要な部分を目立たせる。文末・改行・箇条書きなどで読みやすいリズムを作る
5. 広告感・コピペ感・自動生成感を一切出さない。実際に使った人が友達に「これほんとによかった！」と伝えるような自然な口調で書く
6. 冒頭の1〜2行で「思わず読んでしまう」フックを作る（驚き・共感・問いかけ・ビフォーアフター等）
7. 全体で200〜280文字程度（ハッシュタグ含む）に収める
8. 末尾に関連ハッシュタグを5〜7個付ける（#楽天ROOM #買ってよかった を必ず含める）

【絵文字の使い方ガイド】
- ✨💕🙌 → 感動・おすすめポイントの強調
- ⚠️🔥💥 → 緊急性・お得情報の強調
- ✅▶️◆ → 箇条書き・ポイント整理
- 🛒💰 → 購買への誘導
- 改行前後に絵文字を置いて、視覚的にメリハリをつける

投稿文のみを出力してください（前置き・説明・タイトル等は一切不要です）:`;
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
