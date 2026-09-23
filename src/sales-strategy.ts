import type { RakutenItem, ProductCategory } from "./fetcher";
import type { PersonaSlot } from "./persona/persona";
import { buildProductContentBrief, type ProductContentBrief } from "./content-brief";
import {
  buildOpenAiTextRequest,
  defaultOpenAiTextClient,
  extractOpenAiText,
  type OpenAiTextClient,
} from "./openai-text";

export interface SalesStrategyBrief extends ProductContentBrief {
  source: "api" | "fallback";
  target: string;
  need: string;
  purchaseReason: string;
  captionOutline: string[];
  imageScene: string;
}

export interface SalesStrategyOptions {
  client?: OpenAiTextClient;
  apiKey?: string;
  now?: Date;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function parseJson(text: string): Record<string, unknown> {
  const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  const parsed: unknown = JSON.parse(cleaned);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("販売戦略APIのJSON形式が不正です");
  return parsed as Record<string, unknown>;
}

function validateStrategy(value: Record<string, unknown>): void {
  const required = ["target", "problem", "need", "solution", "angle", "imageScene", "imageComment", "purchaseCta", "purchaseReason"];
  if (required.some((key) => !isNonEmptyString(value[key]))) throw new Error("販売戦略APIの必須項目が不足しています");
  if (!Array.isArray(value.captionOutline) || value.captionOutline.length < 4 || value.captionOutline.some((part) => !isNonEmptyString(part))) {
    throw new Error("販売戦略APIのcaptionOutlineが不正です");
  }
}

function buildPrompt(item: RakutenItem, persona: PersonaSlot, category: ProductCategory, now: Date): string {
  const fallback = buildProductContentBrief(item, persona, category, now);
  return `あなたは楽天ROOMとInstagramの販売戦略担当です。商品情報から、誰のどの悩みをどう解決し、なぜ楽天ROOMで確認・購入するのかを設計してください。

商品情報:
- 商品名: ${item.itemName}
- 価格: ${item.itemPrice.toLocaleString()}円
- 商品説明: ${item.itemCaption.slice(0, 500)}
- レビュー: ${item.reviewAverage ? `★${item.reviewAverage}` : "不明"} / ${item.reviewCount ? `${item.reviewCount}件` : "件数不明"}
- クーポン: ${item.hasCoupon ? "あり" : "なし"} / ポイント: ${item.hasPointBonus ? `${item.pointRate}倍` : "通常"}
- カテゴリ: ${category.name}
- 視点: ${category.audience === "wife" ? "女性目線（美容・見た目・続けやすさ・日常ケア）" : "男性目線（機能・効率・接続性・耐久性・仕事や趣味）"}
- persona: ${persona.name}
- 現在の季節文脈: ${fallback.seasonalHook || "商品説明に明記された季節要素なし"}

必ず次の順序で設計してください: 悩み提示 → ニーズへの共感 → 商品による解決 → 価格・レビュー等の根拠 → 楽天ROOM購入導線。
商品情報にない効果、使用体験、レビュー内容、割引条件を作らないでください。
JSONのみを返してください。キーは target, problem, need, solution, angle, captionOutline（5要素以上の配列）, imageScene, imageComment, purchaseCta, purchaseReason。`;
}

export async function generateSalesStrategyBrief(
  item: RakutenItem,
  persona: PersonaSlot,
  category: ProductCategory,
  options: SalesStrategyOptions = {},
): Promise<SalesStrategyBrief> {
  const now = options.now ?? new Date();
  const fallback = buildProductContentBrief(item, persona, category, now);
  const apiKey = options.apiKey ?? process.env.OPENAI_API_KEY ?? "";
  if (!apiKey) return toFallbackBrief(fallback);

  try {
    const client = options.client ?? defaultOpenAiTextClient;
    const response = await client(buildOpenAiTextRequest(buildPrompt(item, persona, category, now)), apiKey);
    const strategy = parseJson(extractOpenAiText(response));
    validateStrategy(strategy);
    return {
      ...fallback,
      source: "api",
      target: strategy.target as string,
      problem: strategy.problem as string,
      need: strategy.need as string,
      solution: strategy.solution as string,
      angle: strategy.angle as string,
      captionOutline: (strategy.captionOutline as string[]).map((part) => part.trim()),
      imageScene: strategy.imageScene as string,
      imageComment: strategy.imageComment as string,
      purchaseCta: strategy.purchaseCta as string,
      purchaseReason: strategy.purchaseReason as string,
    };
  } catch (error) {
    console.warn(`[sales-strategy] API失敗、商品情報ベースへフォールバック: ${String(error).slice(0, 180)}`);
    return toFallbackBrief(fallback);
  }
}

function toFallbackBrief(brief: ProductContentBrief): SalesStrategyBrief {
  return {
    ...brief,
    source: "fallback",
    target: brief.audience === "wife" ? "日常のケアを無理なく続けたい人" : "用途に合う機能で効率を上げたい人",
    need: brief.audience === "wife" ? "生活に取り入れやすく比較できる選択肢" : "仕事や趣味の用途に合う仕様を比較できる選択肢",
    purchaseReason: "価格・レビュー・販売条件を確認して比較できる",
    captionOutline: ["悩み", "共感", "解決", "根拠", "ROOM"],
    imageScene: brief.useCase,
  };
}
