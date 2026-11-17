import * as fs from "fs";

/**
 * AI画像生成の月額上限ガード。
 * 生成前に「今月の見積もり額＋今回分」が上限を超えないか確認し、超える場合は生成せず
 * Instagram投稿を見送らせる。見積もりは実費より高めに倒す。
 */
export interface AiImageUsage {
  month: string;
  images: number;
  estimatedUsd: number;
  days: Record<string, number>;
}

export interface AiImageBudgetDecision {
  allowed: boolean;
  reason?: string;
  costUsd: number;
  usage: AiImageUsage;
}

type EnvLike = Record<string, string | undefined>;

// 1024x1024・1枚あたりの出力単価（USD）。料金改定時は AI_IMAGE_COST_PER_IMAGE_USD で上書きする。
const OUTPUT_COST_USD: Record<string, Record<string, number>> = {
  "gpt-image-1-mini": { low: 0.005, medium: 0.011, high: 0.036 },
  "gpt-image-1": { low: 0.011, medium: 0.042, high: 0.167 },
};
// 商品画像・参考画像・プロンプトの入力分を上乗せする安全側の定額
const INPUT_SURCHARGE_USD = 0.004;
// 単価表にないモデルは高めに見積もる
const UNKNOWN_MODEL_COST_USD = 0.25;

export const DEFAULT_MONTHLY_BUDGET_USD = 5;
export const DEFAULT_DAILY_AI_POSTS = 1;

function nonNegativeNumber(value: string | undefined): number | undefined {
  const parsed = Number.parseFloat(value ?? "");
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

export function estimateCostPerImageUsd(env: EnvLike): number {
  const override = nonNegativeNumber(env.AI_IMAGE_COST_PER_IMAGE_USD);
  if (override !== undefined && override > 0) return override;
  const model = env.AI_IMAGE_MODEL?.trim() || "gpt-image-1-mini";
  const quality = env.AI_IMAGE_QUALITY?.trim() || "medium";
  const output = OUTPUT_COST_USD[model]?.[quality];
  return output === undefined ? UNKNOWN_MODEL_COST_USD : Math.round((output + INPUT_SURCHARGE_USD) * 10000) / 10000;
}

function jstParts(now: Date): { month: string; day: string } {
  const day = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tokyo" }).format(now);
  return { month: day.slice(0, 7), day };
}

function emptyUsage(month: string): AiImageUsage {
  return { month, images: 0, estimatedUsd: 0, days: {} };
}

export function readAiImageUsage(filePath: string, now: Date): AiImageUsage {
  const { month } = jstParts(now);
  try {
    const raw = JSON.parse(fs.readFileSync(filePath, "utf-8")) as Partial<AiImageUsage>;
    if (raw.month !== month) return emptyUsage(month);
    return {
      month,
      images: Number(raw.images) || 0,
      estimatedUsd: Number(raw.estimatedUsd) || 0,
      days: raw.days && typeof raw.days === "object" ? { ...raw.days } : {},
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return emptyUsage(month);
    // 読めない台帳で上限を素通りさせない
    throw new Error(`AI画像の利用台帳を読み込めません: ${String(error).slice(0, 160)}`);
  }
}

/** 予算内なら今回分を台帳へ先に計上して許可する（途中失敗でも過少計上しない）。 */
export function reserveAiImageBudget(
  env: EnvLike,
  imageCount: number,
  now: Date = new Date(),
): AiImageBudgetDecision | undefined {
  const filePath = env.AI_IMAGE_USAGE_FILE?.trim();
  if (!filePath) return undefined;

  const usage = readAiImageUsage(filePath, now);
  const { day } = jstParts(now);
  const costUsd = estimateCostPerImageUsd(env) * imageCount;
  const monthlyBudget = nonNegativeNumber(env.AI_IMAGE_MONTHLY_BUDGET_USD) ?? DEFAULT_MONTHLY_BUDGET_USD;
  const dailyPosts = nonNegativeNumber(env.AI_IMAGE_DAILY_POSTS) ?? DEFAULT_DAILY_AI_POSTS;

  if ((usage.days[day] ?? 0) >= dailyPosts) {
    return { allowed: false, reason: `本日のAI画像投稿数の上限（${dailyPosts}回）に達しています`, costUsd, usage };
  }
  if (usage.estimatedUsd + costUsd > monthlyBudget + 1e-9) {
    return {
      allowed: false,
      reason: `今月のAI画像予算（$${monthlyBudget.toFixed(2)}）を超えるため生成しません（利用見積もり $${usage.estimatedUsd.toFixed(2)}）`,
      costUsd,
      usage,
    };
  }

  const next: AiImageUsage = {
    month: usage.month,
    images: usage.images + imageCount,
    estimatedUsd: Math.round((usage.estimatedUsd + costUsd) * 10000) / 10000,
    days: { ...usage.days, [day]: (usage.days[day] ?? 0) + 1 },
  };
  fs.writeFileSync(filePath, JSON.stringify(next, null, 2) + "\n");
  return { allowed: true, costUsd, usage: next };
}

/** 残高不足など、1枚も課金されなかったと分かっている失敗のときに計上を取り消す。 */
export function refundAiImageBudget(env: EnvLike, imageCount: number, now: Date = new Date()): void {
  const filePath = env.AI_IMAGE_USAGE_FILE?.trim();
  if (!filePath) return;
  const usage = readAiImageUsage(filePath, now);
  const { day } = jstParts(now);
  const costUsd = estimateCostPerImageUsd(env) * imageCount;
  const days = { ...usage.days };
  const remaining = (days[day] ?? 0) - 1;
  if (remaining > 0) days[day] = remaining; else delete days[day];
  const next: AiImageUsage = {
    month: usage.month,
    images: Math.max(0, usage.images - imageCount),
    estimatedUsd: Math.max(0, Math.round((usage.estimatedUsd - costUsd) * 10000) / 10000),
    days,
  };
  fs.writeFileSync(filePath, JSON.stringify(next, null, 2) + "\n");
}

/** 作り直しで追加生成した枚数を計上する（回数枠は消費しない）。 */
export function recordExtraAiImages(env: EnvLike, imageCount: number, now: Date = new Date()): void {
  const filePath = env.AI_IMAGE_USAGE_FILE?.trim();
  if (!filePath || imageCount <= 0) return;
  const usage = readAiImageUsage(filePath, now);
  const next: AiImageUsage = {
    ...usage,
    images: usage.images + imageCount,
    estimatedUsd: Math.round((usage.estimatedUsd + estimateCostPerImageUsd(env) * imageCount) * 10000) / 10000,
  };
  fs.writeFileSync(filePath, JSON.stringify(next, null, 2) + "\n");
}

/**
 * 生成はしたが投稿に至らなかった回（検品不合格など）の「1日の回数枠」だけを戻す。
 * 費用は発生しているので金額の計上は残す。同じ日の次の回でもう一度試せるようにするため。
 */
export function releaseAiImageDaySlot(env: EnvLike, now: Date = new Date()): void {
  const filePath = env.AI_IMAGE_USAGE_FILE?.trim();
  if (!filePath) return;
  const usage = readAiImageUsage(filePath, now);
  const { day } = jstParts(now);
  const days = { ...usage.days };
  const remaining = (days[day] ?? 0) - 1;
  if (remaining > 0) days[day] = remaining; else delete days[day];
  fs.writeFileSync(filePath, JSON.stringify({ ...usage, days }, null, 2) + "\n");
}
