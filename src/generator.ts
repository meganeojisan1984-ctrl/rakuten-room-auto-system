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
    ? `\n【お得情報（最優先でアピールしてください）】\n${bonusInfo.join("\n")}`
    : "";

  // 投稿タイプ別の指示
  let postTypeInstruction = "";
  switch (postType) {
    case 1:
      // 評価取り投稿: 興味を引いてROOMを回遊させる。次の商品への期待を高めて「また来る」導線を作る
      postTypeInstruction = `
【今回の投稿タイプ】評価取り投稿（クリック・ROOM回遊目的）
- 商品の"存在"を知ってもらい、気になって他の投稿も見たくなるような文章にする
- ガッツリ買わせようとせず、「へ〜こんな商品あるんだ！」「これ気になる！」と思わせるトーンで書く
- 文末に「次はこの商品と組み合わせると最強の家事効率化になるアイテムを紹介します✨」のように、次回投稿への期待を高めるひと言を添える
- 投稿を見た人が他の投稿も覗きたくなるような軽くて親しみやすいトーンにする`;
      break;
    case 2:
      // 売上投稿: 強い購買意欲を喚起。ポイント・クーポン強調。今すぐ買わせる
      postTypeInstruction = `
【今回の投稿タイプ】売上投稿（成約目的）
- 「今すぐ買わないと損！」という強い緊急性と購買衝動を引き出す
- 購入前→購入後の劇的な変化をリアルに描写し、「これを買えば悩みが解決する」と確信させる
- ポイントアップ・クーポン情報を文頭で強調し、「今が一番お得！」という限定感を出す
- 末尾に「気になる方はROOMのリンクからチェックしてね🛒」で行動を促す`;
      break;
    case 3:
      // 送客投稿: 楽天市場への誘導。検索方法・店舗名を具体的に伝える
      postTypeInstruction = `
【今回の投稿タイプ】送客投稿（楽天市場誘導）
- 「楽天市場で○○と検索してみて！」「楽天のROOMリンクから直接飛べます」のように楽天市場への具体的な動線を作る
- 商品の魅力を伝えつつ、「楽天市場でまとめ買いするとさらにお得」「楽天スーパーセール前に要チェック」などで楽天への誘導ワードを自然に入れる
- 前回紹介した商品との組み合わせで「最強の家事セット」になることを伝え、楽天で両方揃えることを勧める`;
      break;
  }

  return `あなたは楽天ROOMで月100万円以上を稼ぐトップランカーです。SNS投稿のプロとして、読んだ人が「欲しい！」「買おう！」と思うような購買意欲を高める紹介文を日本語で生成してください。
${postTypeInstruction}

【商品情報】
- 商品名: ${item.itemName}
- 価格: ${item.itemPrice.toLocaleString()}円
- ショップ: ${item.shopName}
- 商品説明: ${item.itemCaption.slice(0, 300)}${bonusText}

【絶対に守るルール】
1. 【購入前→購入後の変化】を具体的に描写する。「使う前は〇〇だったのに、使い始めてから△△が変わった！」という体験談スタイルで書く
2. 【購入後のメリット・ベネフィット】を中心に据え、スペックや機能の羅列は避ける
3. お得情報（ポイントアップ、クーポン）がある場合は文頭で強調し、「今がチャンス！」という緊急性を演出する
4. 【文章の強弱】を意識し、絵文字を戦略的に使って重要な部分を目立たせる
5. 広告感・コピペ感・自動生成感を一切出さない。実際に使った人が友達に「これほんとによかった！」と伝えるような自然な口調で書く
6. 冒頭の1〜2行で「思わず読んでしまう」フックを作る（驚き・共感・問いかけ・ビフォーアフター等）
7. 全体で200〜280文字程度（ハッシュタグ含む）に収める
8. 末尾に関連ハッシュタグを5〜7個付ける（#楽天ROOM #買ってよかった #QOL向上 を必ず含める）

投稿文のみを出力してください（前置き・説明・タイトル等は一切不要です）:`;
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

  return `あなたはフォロワー10万人超えのインフルエンサーです。X（旧Twitter）で検索アルゴリズムに引っかかりやすく、かつ「認識→共感→購買」の購買プロセスに沿った投稿文を日本語で生成してください。
${postTypeInstruction}

【商品情報】
- 商品名: ${item.itemName}
- 価格: ${item.itemPrice.toLocaleString()}円
- 商品説明: ${item.itemCaption.slice(0, 200)}

【必須の3ステップ構成（この順番で書く）】
1. 【認識】読者が「あ、これ私のことだ」と思う悩みや状況を1〜2行で提示する。絵文字で冒頭から引きつけること
2. 【共感】「私もずっとそうでした」「わかりすぎる」など、投稿者自身の体験として共感を示す1行
3. 【購買】この商品で状況が変わったことを伝え、「詳しくはこちら」「チェックしてみて」などで購買行動を促す1〜2行。末尾にハッシュタグ

【絶対に守るルール】
1. 全体で200〜230文字以内（URLを別途付けるため短めに抑える）
2. 広告感・自動生成感ゼロ。リアルな体験談口調で書く
3. 絵文字を使って感情の強弱・テンポをつける
4. ハッシュタグは末尾に3〜5個（#楽天ROOM #家事効率化 #QOL向上 を含め、商品カテゴリに関連した検索されやすいキーワードもタグに入れる）
5. 改行を入れてスマホで読みやすいリズムにする
6. 【検索アルゴリズム対策】商品ジャンルの具体的なキーワード（例：「掃除 時短」「キッチン 便利グッズ」「家事 楽になった」）を文中に自然に盛り込む

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
