/**
 * offers.ts - 案件レジストリ & 案件プロファイラ
 *
 * 案件は data/affiliate/offers.json に保存され、いつでも追加・編集できる
 * （色々な案件が出せるよう融通がきく設計）。案件名だけ与えられた場合は
 * LLMが「調べて」ジャンル・ターゲット・無料面談内容などを補完する。
 */
import fs from "fs";
import path from "path";
import type { Offer, OfferProfile } from "./types";
import { generateItems, isLlmConfigured } from "./llm";

const OFFERS_PATH = path.join(process.cwd(), "data", "affiliate", "offers.json");

/** 同梱のサンプル案件（ユーザー提示の AI学習 案件） */
const DEFAULT_OFFERS: Record<string, Offer> = {
  "ai-gakushu": {
    id: "ai-gakushu",
    name: "AI学習スクール",
    genre: "AI学習",
    price: "14,800円",
    reward: "新規無料セミナー予約 2,257円 / 新規入会申込 7,519円",
    consultContent: "AIを使った副業・業務効率化の個別無料相談（学習ロードマップ提示）",
    consultBenefits: "自分に合ったAI活用の始め方・収益化までの最短ルートが分かる",
    targetHint: "AIに興味はあるが何から始めればいいか分からない初心者・副業希望者",
    followers: 0,
    goalLeads: 10,
    goalRevenue: "10万円",
    notes: "誇大表現NG。『必ず稼げる』等の断定は避ける。",
  },
};

function slugify(name: string): string {
  const base = name
    .trim()
    .toLowerCase()
    .replace(/[\s　]+/g, "-")
    .replace(/[^\w\-ぁ-んァ-ヶー一-龠々〇]/g, "");
  return base || `offer-${Date.now()}`;
}

function ensureDir(): void {
  const dir = path.dirname(OFFERS_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

export function loadOffers(): Record<string, Offer> {
  ensureDir();
  if (!fs.existsSync(OFFERS_PATH)) {
    fs.writeFileSync(OFFERS_PATH, JSON.stringify(DEFAULT_OFFERS, null, 2), "utf-8");
    return { ...DEFAULT_OFFERS };
  }
  try {
    const data = JSON.parse(fs.readFileSync(OFFERS_PATH, "utf-8")) as Record<string, Offer>;
    return data;
  } catch {
    return { ...DEFAULT_OFFERS };
  }
}

export function saveOffer(offer: Offer): Offer {
  const offers = loadOffers();
  offers[offer.id] = offer;
  ensureDir();
  fs.writeFileSync(OFFERS_PATH, JSON.stringify(offers, null, 2), "utf-8");
  return offer;
}

/**
 * 案件名（または部分一致のid）から Offer を解決する。
 * 既存になければ最小構成の新規案件を生成して登録する。
 */
export function resolveOffer(nameOrId: string): Offer {
  const offers = loadOffers();
  const key = nameOrId.trim();
  // id 完全一致
  if (offers[key]) return offers[key]!;
  // 名前一致（大文字小文字無視）
  const byName = Object.values(offers).find(
    (o) => o.name.toLowerCase() === key.toLowerCase()
  );
  if (byName) return byName;
  // 新規作成
  const id = slugify(key);
  const created: Offer = offers[id] ? { ...offers[id]! } : { id, name: key };
  return saveOffer(created);
}

/**
 * 案件プロファイラ。案件名＋既知情報から、◯◯ を埋めるための
 * ジャンル・ターゲット・無料面談内容などをLLMが推定する。
 * LLM未設定時はヒューリスティックなフォールバックを返す。
 */
export async function profileOffer(offer: Offer): Promise<OfferProfile> {
  if (!isLlmConfigured()) {
    return fallbackProfile(offer);
  }

  const known = [
    `案件名: ${offer.name}`,
    offer.genre ? `ジャンル: ${offer.genre}` : "",
    offer.price ? `価格: ${offer.price}` : "",
    offer.reward ? `成果報酬: ${offer.reward}` : "",
    offer.consultContent ? `無料面談の内容: ${offer.consultContent}` : "",
    offer.consultBenefits ? `面談で得られること: ${offer.consultBenefits}` : "",
    offer.targetHint ? `ターゲットヒント: ${offer.targetHint}` : "",
    offer.notes ? `備考: ${offer.notes}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  const prompt = `あなたは高単価アフィリエイトとX集客に精通したマーケティングリサーチャーです。
以下のアフィリエイト案件について、Xで集客し無料面談に送客する前提で、不足している情報を妥当な範囲で推定・補完してください。
事実が不明な点は「一般的に妥当な仮定」を置き、誇大・虚偽・コンプライアンス違反（薬機法・景表法・誇大広告）にならないよう注意してください。

【既知情報】
${known}

次の1件のオブジェクトを items 配列に入れて返してください:
- genre: この案件をXで売る際の最適なジャンル名
- priceBand: 想定価格帯
- rewardModel: 想定される成果報酬モデルの説明
- consultContent: 無料面談で実際に話す内容（具体的に）
- consultBenefits: 見込み客が無料面談で得られること（ベネフィット）
- targetSummary: 最も反応しそうなターゲット像の要約
- cautions: 訴求時に避けるべき表現・コンプラ注意点（文字列の配列）`;

  try {
    const items = await generateItems<OfferProfile>(prompt, { temperature: 0.6, maxTokens: 1500 });
    const p = items[0];
    if (!p) return fallbackProfile(offer);
    return {
      genre: p.genre || offer.genre || offer.name,
      priceBand: p.priceBand || offer.price || "不明",
      rewardModel: p.rewardModel || offer.reward || "成果報酬型",
      consultContent: p.consultContent || offer.consultContent || "無料個別相談",
      consultBenefits: p.consultBenefits || offer.consultBenefits || "悩み解決の具体策が分かる",
      targetSummary: p.targetSummary || offer.targetHint || "悩みが深く今すぐ解決したい層",
      cautions: Array.isArray(p.cautions) && p.cautions.length > 0 ? p.cautions : defaultCautions(),
    };
  } catch (err) {
    console.warn("[offers] プロファイル生成失敗、フォールバック使用:", String(err).slice(0, 120));
    return fallbackProfile(offer);
  }
}

function defaultCautions(): string[] {
  return [
    "「必ず稼げる」「100%」等の断定・誇大表現を避ける",
    "効果・収入を保証する表現を避ける（景表法・特商法）",
    "体験談は個人の感想である旨を明確にする",
  ];
}

function fallbackProfile(offer: Offer): OfferProfile {
  return {
    genre: offer.genre || offer.name,
    priceBand: offer.price || "不明",
    rewardModel: offer.reward || "成果報酬型（無料面談送客）",
    consultContent: offer.consultContent || `${offer.name}に関する無料個別相談`,
    consultBenefits: offer.consultBenefits || "自分に合った始め方と最短ルートが分かる",
    targetSummary: offer.targetHint || "悩みが深く、今すぐ解決したい初心者層",
    cautions: defaultCautions(),
  };
}
