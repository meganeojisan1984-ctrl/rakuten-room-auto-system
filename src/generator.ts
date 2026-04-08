import Groq from "groq-sdk";
import * as dotenv from "dotenv";
import type { RakutenItem } from "./fetcher";
dotenv.config();

const GROQ_API_KEY = process.env.GROQ_API_KEY ?? "";
const MODEL_NAME = "llama-3.3-70b-versatile";

const REQUEST_INTERVAL_MS = 2000;
const MAX_RETRIES = 3;
const RETRY_BASE_DELAY_MS = 5000;

/**
 * 投稿タイプ:
 * 1 = 評価取り投稿（クリック・ROOM回遊目的）
 * 2 = 売上投稿（成約目的）
 * 3 = 送客投稿（楽天市場への誘導）
 */
export type PostType = 1 | 2 | 3;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function generateWithRetry(
  client: Groq,
  prompt: string,
  temperature: number,
  attempt: number = 0
): Promise<string> {
  try {
    const completion = await client.chat.completions.create({
      model: MODEL_NAME,
      messages: [{ role: "user", content: prompt }],
      max_tokens: 512,
      temperature,
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
      return generateWithRetry(client, prompt, temperature, attempt + 1);
    }
    throw err;
  }
}

function getPostTypeLabel(postType: PostType): string {
  switch (postType) {
    case 1: return "評価取り投稿（クリック・ROOM回遊目的）";
    case 2: return "売上投稿（成約目的）";
    case 3: return "送客投稿（楽天市場誘導）";
  }
}

// ============================================================
// 楽天ROOM用プロンプト
// ============================================================

function buildPrompt(item: RakutenItem, postType: PostType): string {
  const bonusInfo: string[] = [];
  if (item.hasPointBonus) {
    bonusInfo.push(`🎯 ポイント${item.pointRate}倍獲得チャンス！`);
  }
  if (item.hasCoupon) {
    bonusInfo.push("🎫 クーポン・割引あり！");
  }
  const bonusText = bonusInfo.length > 0
    ? `\n【お得情報（文頭で必ずアピールすること）】\n${bonusInfo.join("\n")}`
    : "";

  let postTypeInstruction = "";
  switch (postType) {
    case 1:
      postTypeInstruction = `
【今回の投稿タイプ】発見・共感誘導（回遊目的）
- 「知らなかった人、損してた〜！」「これ見つけたとき思わず2度見したw」のような発見・驚きトーンで書く
- この商品単体より「◯◯と組み合わせるともっと便利」「△△と一緒に使ったら最強だった」という"相乗効果"を必ず触れる
- 文末は「次はこれと組み合わせると更に最強になるアイテム紹介するね✨」「続きはROOMで確認してみて🔍」でROOM回遊を促す
- 軽くて読みやすい友達LINEの延長線上のトーン。読んで「あ〜わかる！」となるような共感ワードを入れる`;
      break;
    case 2:
      postTypeInstruction = `
【今回の投稿タイプ】購買促進（成約目的）
- 「正直、買う前は半信半疑だったんだけど…」「これ買ってから生活変わりすぎて笑えない」のような本音体験談から入る
- 購入前の"あるある悩み"→購入後の"劇的な変化"をセットで描写し、読者が「これ私のことだ」と思わせる
- この商品＋「◯◯と組み合わせたらさらに最強セットになる」という関連欲を刺激するひと言を入れる
- ポイント・クーポン情報があれば「今だけ！」「このタイミング逃したら後悔するやつ」で緊急性を演出`;
      break;
    case 3:
      postTypeInstruction = `
【今回の投稿タイプ】楽天市場への送客
- 「楽天でこれ見つけたときテンション上がりすぎた」から始まり、楽天市場ならではのお得感を前面に出す
- 「◯◯（前に紹介した商品）と組み合わせると最強の時短セットが楽天だけで全部揃う」という楽天完結の魅力を伝える
- 「楽天スーパーセール・お買い物マラソン前にチェックしておいて！」という準備行動を促す`;
      break;
  }

  return `あなたはフォロワー数十万人を持つ楽天ROOMのトップインフルエンサーです。毎月の楽天ROOMランキング上位常連であり、読んだ人が思わず「いいね」「保存」「購入」したくなる投稿を作るプロです。

今回は以下の商品の楽天ROOM投稿文を生成してください。
${postTypeInstruction}

【商品情報】
- 商品名: ${item.itemName}
- 価格: ${item.itemPrice.toLocaleString()}円
- ショップ: ${item.shopName}
- 商品説明: ${item.itemCaption.slice(0, 300)}${bonusText}

【トップインフルエンサーの書き方ルール（必ず全部守ること）】
1. 冒頭1〜2行は「思わず止まってしまう」フック。驚き・共感・ビフォーアフター・問いかけのどれかで引き込む
2. 「使う前は〇〇で困ってた」→「使い始めたら△△が変わった！」という体験談スタイルで書く（スペック羅列は絶対NG）
3. 必ず「◯◯と組み合わせると最強」「△△と一緒に使うともっと便利」という"組み合わせ提案"を1回入れる
4. 文章に緩急をつけ、絵文字を感情の強弱に合わせて戦略的に使う（多すぎず少なすぎず）
5. AI感・広告感・コピペ感ゼロ。友達に「これ絶対いいよ！」と勧めるときのリアルな口調で書く
6. 全体200〜280文字程度（ハッシュタグ含む）
7. 末尾のハッシュタグは5〜7個。#楽天ROOM #買ってよかった #QOL向上 は必須で、商品カテゴリの検索ワードも入れる
8. 次の投稿・次の商品への期待感を最後に添えて「また見に来たい」と思わせる導線を作る

投稿文のみを出力してください（前置き・説明・タイトル等は一切不要）:`;
}

// ============================================================
// Gemini Flash — トレンド投稿用 (YouTube必勝構成)
// ============================================================

function buildGeminiRoomPrompt(keyword: string, item: RakutenItem): string {
  const reviewInfo =
    item.reviewAverage && item.reviewCount
      ? `レビュー: ${item.reviewAverage}点 (${item.reviewCount}件)`
      : "";

  return `あなたはフォロワー数十万人を持つ楽天ROOMのトップインフルエンサーです。

今「${keyword}」がトレンドになっています。このトレンドに乗じて以下の商品を楽天ROOMで紹介してください。

【商品情報】
- 商品名: ${item.itemName}
- 価格: ${item.itemPrice.toLocaleString()}円
- ショップ: ${item.shopName}
- 説明: ${item.itemCaption.slice(0, 250)}
${reviewInfo ? `- ${reviewInfo}` : ""}

【YouTube必勝構成で書くこと（この順番で）】
1. メリット（冒頭で最大のベネフィットを強調。「${keyword}」に悩む人への解決策として提示）
2. 信頼・口コミ要素（レビュー数・評価・「私も使ってみたら…」という体験談で信頼感を演出）
3. 今すぐ買う理由（「今${keyword}が話題だから今すぐチェックして！」「今がタイミング」という緊急性）

【ルール】
- 全体200〜280文字（ハッシュタグ含む）
- ハッシュタグ5〜7個。#楽天ROOM #買ってよかった #QOL向上 は必須
- 友達LINEのような口語体。AI感ゼロ
- 絵文字で感情の強弱をつける

投稿文のみを出力してください（前置き・説明不要）:`;
}

/**
 * トレンドキーワードに基づいてGroqで投稿文を一括生成 (YouTube必勝構成)
 */
export async function generateTrendCaptions(
  keyword: string,
  items: RakutenItem[]
): Promise<Array<{ item: RakutenItem; caption: string }>> {
  if (!GROQ_API_KEY) throw new Error("GROQ_API_KEY が未設定です");
  const client = new Groq({ apiKey: GROQ_API_KEY });
  const results: Array<{ item: RakutenItem; caption: string }> = [];

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (!item) continue;

    try {
      console.log(`[generator] 「${item.itemName.slice(0, 30)}...」ROOM文生成中 (トレンド: ${keyword})`);
      const caption = await generateWithRetry(client, buildGeminiRoomPrompt(keyword, item), 0.95);

      results.push({ item, caption: caption.trim() });
    } catch (err) {
      console.error(`[generator] トレンド生成失敗 「${item.itemName.slice(0, 30)}」:`, err);
    }

    if (i < items.length - 1) await sleep(REQUEST_INTERVAL_MS);
  }

  return results;
}

// ============================================================
// 公開API
// ============================================================

export async function generateCaption(item: RakutenItem, postType: PostType = 2): Promise<string> {
  if (!GROQ_API_KEY) {
    throw new Error("GROQ_API_KEY が未設定です");
  }

  const client = new Groq({ apiKey: GROQ_API_KEY });
  const prompt = buildPrompt(item, postType);

  console.log(`[generator] 「${item.itemName.slice(0, 30)}...」の紹介文を生成中 (${getPostTypeLabel(postType)})`);
  const caption = await generateWithRetry(client, prompt, 0.8);
  console.log("[generator] 紹介文生成完了");
  return caption.trim();
}

export async function generateCaptions(
  items: RakutenItem[],
  postType: PostType = 2
): Promise<Array<{ item: RakutenItem; caption: string }>> {
  const results: Array<{ item: RakutenItem; caption: string }> = [];

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (!item) continue;

    try {
      const caption = await generateCaption(item, postType);
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
