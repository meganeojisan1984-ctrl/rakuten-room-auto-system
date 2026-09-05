import type { RakutenItem } from "../fetcher";

export interface ThreadsCopyContext {
  genre: string;
  tone?: string;
}

export interface GenerateThreadsCopyOptions {
  apiKey?: string;
  model?: string;
  client?: (body: Record<string, unknown>, apiKey: string) => Promise<OpenAiChatResponse>;
}

interface OpenAiChatResponse {
  choices?: Array<{ message?: { content?: string } }>;
}

const DEFAULT_MODEL = "gpt-4o-mini";
const LINK_PLACEHOLDER = "{{RAKUTEN_LINK}}";
const DEFAULT_TONE = "親しみやすいけど丁寧な感じで";

function cleanText(value: string, max = 200): string {
  return value.replace(/\s+/g, " ").trim().slice(0, max);
}

function productFactsLine(item: RakutenItem): string {
  const facts: string[] = [`価格: ${Math.round(item.itemPrice).toLocaleString("ja-JP")}円`];
  if ((item.reviewAverage ?? 0) > 0) facts.push(`レビュー評価: ★${item.reviewAverage}`);
  if ((item.reviewCount ?? 0) > 0) facts.push(`レビュー件数: ${Math.round(item.reviewCount!).toLocaleString("ja-JP")}件`);
  if (item.hasCoupon) facts.push("クーポンあり");
  if (item.hasPointBonus) facts.push("ポイント還元あり");
  return facts.join(" / ");
}

export function buildThreadsCopyMessages(
  item: RakutenItem,
  context: ThreadsCopyContext,
): { system: string; user: string } {
  const tone = context.tone ?? DEFAULT_TONE;
  const genre = context.genre;
  const productName = cleanText(item.itemName, 60);
  const target = `「${productName}」を買おうか悩んでいる人、または同じジャンル(${genre})の商品で悩みを改善したいと思っている人`;

  const system = [
    "あなたはThreadsで30,000表示以上を獲得する投稿を量産するSNSライターです。",
    "与えられた商品情報から「ビフォー状態」「アフター状態」「競合の選択肢」「ハードルの低さ（価格・手軽さ）」を自分で推測・補完して投稿を3パターン作成してください。",
    "",
    "## 変数",
    `- ジャンル：${genre}`,
    `- ターゲット：${target}`,
    `- 紹介したい商品・サービス：${productName}`,
    `- 口調：${tone}`,
    "",
    "## 改行ルール（最重要・厳守）",
    "- 1文目の後にのみ改行を入れる",
    "- 2文目以降は改行せず、1つの段落として続けて書く",
    "- 句点（。）で文を区切るが、改行はしない",
    "",
    "【正しい形式の例】",
    "```",
    "1文目（フック）。",
    "2文目だって、〜🥹3文目〜絶対試して。4文目〜良くない？🥹",
    "```",
    "",
    "## 構成ルール（厳守）",
    "合計160〜200文字以内。",
    "",
    "【1文目｜悩み特定フック】※この後だけ改行",
    "「（ターゲットの悩み）に悩んでる人、（商品/カテゴリ）使った方がいい。」",
    "→ 当事者が1秒で「自分のことだ」と気づく断定文。",
    "",
    "【2文目｜ギャップ提示】※改行せず続ける",
    "「だって、（価格や手軽さなどのハードルの低さ）なのに（得られる嬉しい結果）🥹」",
    "→ コスト＜効果のギャップで驚きを作る。具体的な数字や結果を入れる。",
    "",
    "【3文目｜逆張りで名指し】※改行せず続ける",
    "「（高価格帯・手間のかかる既存の選択肢）使ってて（悩み状態）な人絶対試して。」",
    "→ 既存の選択肢を使っている層を名指しで挑発し、保存・コメントを誘発。",
    "",
    "【4文目｜共感問いかけ】※改行せず続ける、ここで投稿終了",
    "「（手間のかかる現状）より（この商品で得られる楽な未来）方が良くない？🥹」",
    "→ 疑問形で締めてコメント欄に「確かに」を集める。",
    "",
    "【5文目】",
    `ターゲットへリンクへ誘導する文章と商品リンク。リンクは必ず "${LINK_PLACEHOLDER}" というプレースホルダーをそのまま出力すること(実際のURLは後でこちらで差し込みます)。プレースホルダーの後ろに半角スペースを入れて「PR」と入力しておいてください。`,
    "",
    "## 3パターン作成ルール",
    "以下3つの異なる切り口で投稿を作成してください。それぞれ別の角度から刺すこと。",
    "",
    "【パターンA｜価格ギャップ重視型】",
    "→ 「安いのに効果すごい」のコスパ訴求を強める",
    "",
    "【パターンB｜時短・手軽さ重視型】",
    "→ 「時間・手間が減る」の効率訴求を強める",
    "",
    "【パターンC｜逆張り・共感重視型】",
    "→ 「高い物使ってる人ほど気づいてない」の意外性訴求を強める",
    "",
    "## 伸びる確率の算出ルール",
    "各パターンに「伸びる確率（％）」を付けてください。",
    "評価基準は以下5項目を各20点で採点し、合計100点満点を確率として表示：",
    "",
    "1. フック力（1文目で当事者を引き込めるか）",
    "2. 具体性（数字・固有名詞で得感が伝わるか）",
    "3. 逆張り強度（既存ユーザーを名指しで刺せているか）",
    "4. 共感性（ターゲットの本音に刺さるか）",
    "5. コメント誘発力（疑問形・反論したくなる要素があるか）",
    "",
    "## トーン指示",
    `- 口調は「${tone}」を厳守`,
    "- 友達がLINEで教えてくれた感を出す（広告感NG）",
    "- 絵文字は🥹を中心に2回まで",
    "- 体言止め・口語OK、専門用語NG",
    "- 具体的な数字（価格・時間など）を必ず1つ以上入れる",
    "",
    "## 出力形式",
    "以下のフォーマットで出力してください（解説・前置き不要）。",
    "",
    "━━━━━━━━━━━━━━━",
    "【パターンA｜価格ギャップ重視型】",
    "伸びる確率：〇〇％",
    "",
    "（本文）",
    "",
    "採点内訳：",
    "・フック力：〇/20",
    "・具体性：〇/20",
    "・逆張り強度：〇/20",
    "・共感性：〇/20",
    "・コメント誘発力：〇/20",
    "━━━━━━━━━━━━━━━",
    "【パターンB｜時短・手軽さ重視型】",
    "伸びる確率：〇〇％",
    "",
    "（本文）",
    "",
    "採点内訳：",
    "・フック力：〇/20",
    "・具体性：〇/20",
    "・逆張り強度：〇/20",
    "・共感性：〇/20",
    "・コメント誘発力：〇/20",
    "━━━━━━━━━━━━━━━",
    "【パターンC｜逆張り・共感重視型】",
    "伸びる確率：〇〇％",
    "",
    "（本文）",
    "",
    "採点内訳：",
    "・フック力：〇/20",
    "・具体性：〇/20",
    "・逆張り強度：〇/20",
    "・共感性：〇/20",
    "・コメント誘発力：〇/20",
    "━━━━━━━━━━━━━━━",
    "",
    "【総合おすすめ】",
    "最も伸びる確率が高いパターン：〇",
    "理由：（30文字以内で簡潔に）",
  ].join("\n");

  const user = [
    `商品名: ${productName}`,
    `ジャンル: ${genre}`,
    `商品の説明・キャプション: ${cleanText(item.itemCaption, 300)}`,
    productFactsLine(item),
    "上記の商品情報をもとに、指示された役割・ルールに厳密に従って3パターンを作成してください。",
  ].join("\n");

  return { system, user };
}

async function defaultOpenAiChatClient(body: Record<string, unknown>, apiKey: string): Promise<OpenAiChatResponse> {
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`OpenAI chat completion failed: ${response.status} ${detail.slice(0, 300)}`);
  }
  return response.json() as Promise<OpenAiChatResponse>;
}

export function isThreadsCopyEnabled(env: NodeJS.ProcessEnv): boolean {
  return env.THREADS_COPY_ENABLED !== "0" && !!env.OPENAI_API_KEY;
}

export async function generateThreadsCopy(
  item: RakutenItem,
  context: ThreadsCopyContext,
  options: GenerateThreadsCopyOptions = {},
): Promise<string> {
  const apiKey = options.apiKey ?? process.env.OPENAI_API_KEY ?? "";
  if (!apiKey) throw new Error("OPENAI_API_KEY is required for Threads copy generation");

  const model = options.model ?? process.env.THREADS_COPY_MODEL ?? DEFAULT_MODEL;
  const client = options.client ?? defaultOpenAiChatClient;
  const { system, user } = buildThreadsCopyMessages(item, context);

  const response = await client(
    {
      model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      temperature: 0.9,
    },
    apiKey,
  );

  const content = response.choices?.[0]?.message?.content;
  if (!content) throw new Error("OpenAI chat completion response did not include content");

  return content.split(LINK_PLACEHOLDER).join(`${item.itemUrl} PR`);
}
