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

function getPostTypeLabel(postType: PostType): string {
  switch (postType) {
    case 1: return "評価取り投稿（クリック・ROOM回遊目的）";
    case 2: return "売上投稿（成約目的）";
    case 3: return "送客投稿（楽天市場誘導）";
  }
}

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

  // 投稿タイプ別の指示
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

function buildXPrompt(item: RakutenItem, postType: PostType): string {
  // 投稿タイプ別のX向け指示
  let postTypeInstruction = "";
  switch (postType) {
    case 1:
      postTypeInstruction = `
【投稿タイプ】認知拡大・回遊誘導
- 「こんな商品があるの知らなかった」「これ知ってる人だけ得してる」というトーンで興味を引く
- 次の関連商品への期待を最後に1行添える（例：「次は〇〇と組み合わせると最強になるアイテム紹介します」）`;
      break;
    case 2:
      postTypeInstruction = `
【投稿タイプ】購買促進
- 「今すぐ買うべき理由」を強調し、購買衝動を強く引き出す
- ポイント・クーポン情報があれば「今だけ」「期間限定」で緊急性を出す`;
      break;
    case 3:
      postTypeInstruction = `
【投稿タイプ】楽天市場への送客
- 「楽天で検索して」「楽天ROOMのリンクから」など楽天への誘導ワードを自然に入れる
- 楽天スーパーセール・お買い物マラソンなどのイベントへの言及があると効果的`;
      break;
  }

  return `あなたはフォロワー数十万人のライフスタイル系インフルエンサーです。X（旧Twitter）でバズる投稿を量産しており、「認識→共感→欲しい！」の流れを一瞬で作れるプロです。
${postTypeInstruction}

【商品情報】
- 商品名: ${item.itemName}
- 価格: ${item.itemPrice.toLocaleString()}円
- 商品説明: ${item.itemCaption.slice(0, 200)}

【バズる投稿の必須構成（この順番で）】
1. 【フック】「え、これ知らなかった人いる？」「これ見つけた瞬間買い物かごに即入れた」など、スクロールが止まる冒頭1行
2. 【共感】自分の体験として「ずっと〇〇で困ってたんだけど」「〇〇好きな人に刺さりすぎる」と読者の日常と接続する
3. 【提案】「◯◯と組み合わせると最強」という組み合わせ提案または購入後の変化を1〜2行
4. 【CTA】「ROOMに詳細載せてるから見てみて」「気になる人はチェックして」で自然に誘導。末尾にハッシュタグ

【絶対に守るルール】
1. 全体180〜220文字以内（URLを別途付けるため短めに）
2. 広告感・AI感ゼロ。友達へのDMみたいなリアルな口調
3. 絵文字でテンポと感情の強弱をつける（多用しすぎない）
4. スマホで読みやすいよう適度に改行を入れる
5. ハッシュタグは末尾に3〜5個（#楽天ROOM #QOL向上 必須＋商品カテゴリキーワード）
6. 検索されやすいキーワード（「時短」「便利グッズ」「買ってよかった」など）を文中に自然に入れる

投稿文のみを出力してください（前置き・説明・タイトル等は一切不要）:`;
}

export async function generateCaption(item: RakutenItem, postType: PostType = 2): Promise<string> {
  if (!GROQ_API_KEY) {
    throw new Error("GROQ_API_KEY が未設定です");
  }

  const client = new Groq({ apiKey: GROQ_API_KEY });
  const prompt = buildPrompt(item, postType);

  console.log(`[generator] 「${item.itemName.slice(0, 30)}...」の紹介文を生成中 (${getPostTypeLabel(postType)})`);
  const caption = await generateWithRetry(client, prompt);
  console.log("[generator] 紹介文生成完了");
  return caption.trim();
}

export async function generateCaptions(
  items: RakutenItem[],
  postType: PostType = 2
): Promise<Array<{ item: RakutenItem; caption: string; xCaption: string }>> {
  const results: Array<{ item: RakutenItem; caption: string; xCaption: string }> = [];

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (!item) continue;

    try {
      const caption = await generateCaption(item, postType);

      await sleep(REQUEST_INTERVAL_MS);

      const client = new Groq({ apiKey: GROQ_API_KEY });
      console.log(`[generator] 「${item.itemName.slice(0, 30)}...」のX用投稿文を生成中`);
      const xCaption = await generateWithRetry(client, buildXPrompt(item, postType));
      console.log("[generator] X用投稿文生成完了");

      results.push({ item, caption, xCaption: xCaption.trim() });
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
