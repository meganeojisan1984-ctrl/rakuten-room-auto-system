import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import type { RakutenItem } from "../fetcher";
import type { PersonaSlot } from "../persona/persona";
import { mapAssetToPublicUrl, type CarouselAsset } from "./carousel";
import { cleanProductDisplayName } from "./product-copy";
import type { ProductContentBrief } from "../content-brief";
import type { SalesStrategyBrief } from "../sales-strategy";
import { normalizeImageForUpload } from "./image-normalize";
import { buildImageCreativePlan, type ImageCreativePlan } from "./image-creative";
import { verifyAiImages, type AiImageVerifyInput, type AiImageVerifyResult } from "./ai-image-verify";

/**
 * Instagramカルーセル用の完成スライド画像（文字入り・5枚）を生成する。
 * ECの商品ページ風インフォグラフィック（表紙→機能→利用シーン→価格・評価→楽天ROOM導線）で、
 * 画像に描く文字は ImageCreativePlan の確定テキストだけに限定する。
 */
interface OpenAiImageResponse {
  data?: Array<{ b64_json?: string; url?: string }>;
}

export interface GenerateAiLifestyleImagesOptions {
  outputDir?: string;
  publicBaseUrl?: string;
  apiKey?: string;
  model?: string;
  quality?: "low" | "medium" | "high" | "auto";
  size?: string;
  loadProductImage?: (url: string) => Promise<{ bytes: Uint8Array; mimeType: string }>;
  now?: Date;
  brief?: ProductContentBrief | SalesStrategyBrief;
  creativePlan?: ImageCreativePlan;
  requestTimeoutMs?: number;
  /** 公開前の検品。未指定時、本番（clientを差し替えていない場合）は既定の検品を行う */
  verifier?: (input: AiImageVerifyInput) => Promise<AiImageVerifyResult>;
  client?: (body: FormData, apiKey: string) => Promise<OpenAiImageResponse>;
}

export interface AiLifestyleImagePromptOptions {
  brief?: ProductContentBrief | SalesStrategyBrief;
  creativePlan?: ImageCreativePlan;
}

const DEFAULT_OUTPUT_DIR = path.join(process.cwd(), "public", "generated", "instagram");
// 低コストモデルを既定にする。上位モデルへ変える場合は AI_IMAGE_MODEL / AI_IMAGE_QUALITY で上書きする。
const DEFAULT_MODEL = "gpt-image-1-mini";
const DEFAULT_QUALITY: NonNullable<GenerateAiLifestyleImagesOptions["quality"]> = "medium";

export function isOpenAiQuotaError(error: unknown): boolean {
  const text = String(error).toLowerCase();
  return text.includes("credit_balance_exhausted") || text.includes("insufficient_quota") || text.includes("no credits remaining");
}

function cleanText(value: string, max = 140): string {
  return value.replace(/\s+/g, " ").trim().slice(0, max);
}

function productTitle(item: RakutenItem): string {
  return cleanText(cleanProductDisplayName(item.itemName), 42);
}

function timestamp(now: Date): string {
  return now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

export function buildAiLifestyleImagePrompts(
  item: RakutenItem,
  _persona: PersonaSlot,
  options: AiLifestyleImagePromptOptions = {},
): string[] {
  const plan = options.creativePlan ?? buildImageCreativePlan(item, options.brief);
  const name = productTitle(item);
  const total = plan.slides.length;
  const imageScene = (options.brief as Partial<SalesStrategyBrief> | undefined)?.imageScene ?? options.brief?.useCase;
  return plan.slides.map((slide) => [
    `日本のInstagram向け商品紹介カルーセル（全${total}枚）の${slide.index}枚目として、完成済みの正方形スライド画像を1枚作る。ECの商品ページのように情報が整理された、プロのデザイナーが組んだインフォグラフィック広告の仕上がりにする。`,
    `【デザインテーマ（全${total}枚で統一）】${plan.themeStyle} 写真はフォトリアルで、文字・カード・アイコンは整列させ、余白を保つ。`,
    `【商品】添付画像が紹介する商品。形・色・質感・比率を保ち、同じ商品として自然な光で描く。別の商品に置き換えない。添付画像に写っていない種類の製品（別の家電・雑貨・容器など）を主役や脇役として描き足さない。商品名（参考情報。確定テキストにある場合だけ描画）: ${name}。カテゴリ: ${plan.analysis.category}。${imageScene ? `背景の生活シーンの参考: ${cleanText(imageScene, 60)}。` : ""}`,
    slide.prompt,
    "【共通ルール】確定テキスト以外の文字・数字・ロゴ・QRコード・URL・アカウント名・フォロワー数を描かない。架空の口コミ、体験談、ランキング、割引、受賞表記を描かない。日本語は太めで大きく、つぶれない字形で描く。文字同士や文字と商品を重ねない。",
  ].join("\n"));
}

async function defaultOpenAiClient(body: FormData, apiKey: string): Promise<OpenAiImageResponse> {
  const response = await fetch("https://api.openai.com/v1/images/edits", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body,
    signal: AbortSignal.timeout(120_000),
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`OpenAI image generation failed: ${response.status} ${detail.slice(0, 300)}`);
  }
  return response.json() as Promise<OpenAiImageResponse>;
}

async function callImageClient(
  client: (body: FormData, apiKey: string) => Promise<OpenAiImageResponse>,
  body: FormData,
  apiKey: string,
  timeoutMs: number,
): Promise<OpenAiImageResponse> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      client(body, apiKey),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`OpenAI画像生成がタイムアウトしました (${timeoutMs}ms)`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function downloadProductImage(url: string): Promise<{ bytes: Uint8Array; mimeType: string }> {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:") throw new Error("商品参照画像はHTTPS URLが必要です");
  const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`商品参照画像を取得できません (${response.status})`);
  const mimeType = (response.headers.get("content-type") ?? "").split(";")[0]!.toLowerCase();
  if (!new Set(["image/jpeg", "image/png", "image/webp"]).has(mimeType)) {
    throw new Error(`商品参照画像の形式に対応していません: ${mimeType || "unknown"}`);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength === 0 || bytes.byteLength > 20 * 1024 * 1024) {
    throw new Error("商品参照画像のサイズが不正です");
  }
  return { bytes, mimeType };
}

function bytesToBlob(bytes: Uint8Array, mimeType: string): Blob {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return new Blob([buffer], { type: mimeType });
}

function buildEditForm(
  prompt: string,
  model: string,
  size: string,
  quality: string,
  productImage: { bytes: Uint8Array; mimeType: string },
): FormData {
  const form = new FormData();
  form.append("model", model);
  form.append("prompt", prompt);
  form.append("n", "1");
  form.append("size", size);
  form.append("quality", quality);
  form.append("output_format", "jpeg");
  form.append("output_compression", "90");
  const ext = productImage.mimeType === "image/png" ? "png" : productImage.mimeType === "image/webp" ? "webp" : "jpg";
  // 添付するのは紹介する商品の写真だけ。別商品の写った見本画像は混入の原因になるため渡さない。
  form.append("image[]", bytesToBlob(productImage.bytes, productImage.mimeType), `rakuten-product.${ext}`);
  return form;
}

export function isAiLifestyleImagesEnabled(env: NodeJS.ProcessEnv): boolean {
  return env.AI_IMAGE_ENABLED !== "0" && !!env.OPENAI_API_KEY;
}

export async function generateAiLifestyleImages(
  item: RakutenItem,
  persona: PersonaSlot,
  options: GenerateAiLifestyleImagesOptions = {},
): Promise<CarouselAsset[]> {
  const apiKey = options.apiKey ?? process.env.OPENAI_API_KEY ?? "";
  if (!apiKey) throw new Error("OPENAI_API_KEY is required for AI image generation");

  const outputDir = options.outputDir ?? process.env.IG_CAROUSEL_OUTPUT_DIR ?? DEFAULT_OUTPUT_DIR;
  const publicBaseUrl = options.publicBaseUrl ?? process.env.IG_CAROUSEL_PUBLIC_BASE_URL ?? "";
  const model = options.model ?? process.env.AI_IMAGE_MODEL ?? DEFAULT_MODEL;
  const quality: NonNullable<GenerateAiLifestyleImagesOptions["quality"]> =
    options.quality ?? (process.env.AI_IMAGE_QUALITY as GenerateAiLifestyleImagesOptions["quality"]) ?? DEFAULT_QUALITY;
  const size = options.size ?? process.env.AI_IMAGE_SIZE ?? "1024x1024";
  const now = options.now ?? new Date();
  const client = options.client ?? defaultOpenAiClient;
  const requestTimeoutMs = options.requestTimeoutMs ?? 120_000;
  const loadProductImage = options.loadProductImage ?? downloadProductImage;
  const productImage = await loadProductImage(item.imageUrl).then((image) => normalizeImageForUpload(image.bytes, image.mimeType));
  const day = now.toISOString().slice(0, 10);
  const stamp = timestamp(now);
  const hash = crypto.createHash("sha1").update(`${item.itemCode}|${item.itemName}`).digest("hex").slice(0, 10);

  fs.mkdirSync(outputDir, { recursive: true });

  const prompts = buildAiLifestyleImagePrompts(item, persona, { brief: options.brief, creativePlan: options.creativePlan });
  const assets: CarouselAsset[] = [];
  for (let i = 0; i < prompts.length; i++) {
    const body = buildEditForm(prompts[i]!, model, size, quality, productImage);
    const response = await callImageClient(client, body, apiKey, requestTimeoutMs);
    const encoded = response.data?.[0]?.b64_json;
    if (!encoded) throw new Error("OpenAI image response did not include b64_json");
    const fileName = `${day}-${stamp}-${hash}-ai-${String(i + 1).padStart(2, "0")}.jpg`;
    const filePath = path.join(outputDir, fileName);
    fs.writeFileSync(filePath, Buffer.from(encoded, "base64"));
    assets.push({
      filePath,
      publicUrl: mapAssetToPublicUrl(fileName, publicBaseUrl),
      page: i + 1,
    });
  }

  const verifier = options.verifier
    ?? (options.client || process.env.AI_IMAGE_VERIFY === "0"
      ? undefined
      : (input: AiImageVerifyInput) => verifyAiImages(input, { apiKey }));
  if (verifier) {
    const verdict = await verifier({
      productName: productTitle(item),
      productImage,
      slides: assets.map((asset) => ({ bytes: new Uint8Array(fs.readFileSync(asset.filePath)), mimeType: "image/jpeg" })),
      expectedPrice: item.itemPrice ? `${item.itemPrice.toLocaleString()}円` : undefined,
    });
    if (!verdict.ok) {
      for (const asset of assets) fs.rmSync(asset.filePath, { force: true });
      throw new Error(`AI画像の検品で不合格: ${verdict.problems.join(" / ")}`);
    }
    console.log("[ai-image] 公開前の検品に合格（商品の一致・価格表記）");
  }
  return assets;
}
