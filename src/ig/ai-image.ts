import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import type { RakutenItem } from "../fetcher";
import type { PersonaSlot } from "../persona/persona";
import { mapAssetToPublicUrl, type CarouselAsset } from "./carousel";

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
  now?: Date;
  client?: (body: Record<string, unknown>, apiKey: string) => Promise<OpenAiImageResponse>;
}

const DEFAULT_OUTPUT_DIR = path.join(process.cwd(), "public", "generated", "instagram");
const DEFAULT_MODEL = "gpt-image-2";

function cleanText(value: string, max = 140): string {
  return value.replace(/\s+/g, " ").trim().slice(0, max);
}

function productTitle(item: RakutenItem): string {
  return cleanText(item.itemName.replace(/[【】≪≫＜＞()[\]{}]/g, " "), 42);
}

function productBenefits(item: RakutenItem): string[] {
  const text = `${item.itemName} ${item.itemCaption}`;
  if (/食品|米|水|コーヒー|お茶|菓子|チョコ|うなぎ|肉|魚|プロテイン|スイーツ|グルメ/.test(text)) {
    return ["手軽に楽しめる", "家でちょっと贅沢", "ストックしやすい"];
  }
  if (/服|キッズ|子供服|バッグ|靴|ワンピ|シャツ|パンツ|ニット|ファッション/.test(text)) {
    return ["着回しやすい", "毎日使いやすい", "写真でも映える"];
  }
  if (/美容|コスメ|スキンケア|ヘアケア|メイク|化粧|リップ|美容液/.test(text)) {
    return ["毎日のケアに足せる", "見た目の印象アップ", "気分が上がる"];
  }
  if (/家電|ガジェット|スマホ|充電|イヤホン|加湿器|ライト|掃除機/.test(text)) {
    return ["時短になる", "置き場所に困りにくい", "使うたびラク"];
  }
  return ["片付けがラク", "生活感を抑える", "毎日使いやすい"];
}

function finiteNumber(value: unknown): number | undefined {
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value === "string") {
    const parsed = Number(value.replace(/,/g, "").trim());
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function productFeatures(item: RakutenItem): string[] {
  const features: string[] = [];
  const reviewAverage = finiteNumber(item.reviewAverage);
  const reviewCount = finiteNumber(item.reviewCount);
  const itemPrice = finiteNumber(item.itemPrice) ?? 0;
  if (item.hasCoupon) features.push("クーポンあり");
  if (item.hasPointBonus) features.push("ポイントUP");
  if ((reviewAverage ?? 0) >= 4.3) features.push(`高評価 ${reviewAverage!.toFixed(1)}`);
  if ((reviewCount ?? 0) >= 50) features.push(`レビュー${Math.round(reviewCount!).toLocaleString("ja-JP")}件`);
  features.push(`${Math.round(itemPrice).toLocaleString("ja-JP")}円`);
  return features.slice(0, 4);
}

function timestamp(now: Date): string {
  return now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function sceneHints(item: RakutenItem): string[] {
  const text = `${item.itemName} ${item.itemCaption}`.toLowerCase();
  if (/食品|米|水|コーヒー|お茶|菓子|チョコ|うなぎ|肉|魚|プロテイン/.test(text)) {
    return [
      "a cozy kitchen counter with the product naturally prepared for breakfast",
      "a dining table moment with appetizing food styling and real household dishes",
      "a close hand-held smartphone snapshot of someone casually serving it at home",
      "a warm shelf or pantry scene after grocery unpacking",
      "a relaxed evening table scene that looks candid and delicious",
    ];
  }
  if (/収納|片付け|ハンガー|ラック|チェスト|ケース|ボックス|衣類/.test(text)) {
    return [
      "a kitchen counter or washstand corner after tidying, with the product in everyday use",
      "a bright bedroom storage scene with folded clothes and lived-in details",
      "a hand-held snapshot of someone organizing small household items",
      "a clean shelf scene with natural shadows and realistic clutter nearby",
      "a before-going-out moment with the item quietly useful in the background",
    ];
  }
  if (/洗濯|柔軟剤|洗剤|タオル|掃除|トイレ|風呂|バス|加湿器|シャワー/.test(text)) {
    return [
      "a bright laundry or washstand scene with the product being used naturally",
      "a bathroom shelf or sink-side scene with soft morning light",
      "a hand-held close-up of a simple daily cleaning routine",
      "a realistic utility area with towels, bottles, and household texture",
      "a calm after-cleaning room detail that feels fresh and useful",
    ];
  }
  return [
    "a natural kitchen counter scene where the product looks useful in daily life",
    "a bright living room shelf scene with the product casually placed",
    "a hand-held smartphone photo of someone using the item at home",
    "a clean table-top product moment on white fabric with daylight",
    "a relaxed daily-life scene that feels convenient and pleasant",
  ];
}

export function buildAiLifestyleImagePrompts(item: RakutenItem, persona: PersonaSlot): string[] {
  const name = productTitle(item);
  const description = cleanText(item.itemCaption, 220);
  const genre = persona.genres[0] ?? persona.name;
  const benefits = productBenefits(item);
  const features = productFeatures(item);
  const base =
    `photorealistic Japanese Instagram carousel design, authentic product-review post, real buyer trust, ` +
    `Japanese text inside the image, crisp readable Japanese typography, bold friendly SNS fonts, large high-contrast headings, ` +
    `short text only, clean magazine-like layout, natural daylight product photography, realistic home interior, ` +
    `subtle imperfect smartphone-photo texture, no watermark, no random logo, no garbled characters, no tiny text, ` +
    `no artificial CGI look, no over-polished advertisement, avoid plastic-looking skin or objects. ` +
    `The post may recommend the product category, but must not falsely claim the creator personally bought or used it. ` +
    `Product reference: ${name}. Product image URL for visual reference if accessible: ${item.imageUrl}. Category: ${genre}. Description: ${description}.`;

  const scenes = sceneHints(item);
  return [
    `${base} Slide 1: cover. Compose a scroll-stopping Japanese Instagram cover with a large title and a clear product photo. Put this exact Japanese headline in the image: 「これ、地味に助かる」. Add a smaller readable product title: 「${name}」. Scene: ${scenes[0]}. Use pink, cream, black, and warm yellow accents like a popular Japanese product carousel.`,
    `${base} Slide 2: before-use problem. Show a realistic person or room looking mildly troubled before using the product, not exaggerated. Put this Japanese headline in the image: 「こんな悩みない？」. Add 2 short pain points as readable Japanese labels: 「ごちゃつく」「選ぶのが面倒」. Scene: ${scenes[1]}.`,
    `${base} Slide 3: solution list. Make a clean list-style Japanese carousel page with a realistic usage image on the right. Put this Japanese headline in the image: 「これでラクになる」. Add these readable checklist items in Japanese: 「${benefits[0]}」「${benefits[1]}」「${benefits[2]}」. Scene: ${scenes[2]}.`,
    `${base} Slide 4: product features. Show the product photo large with friendly handwritten-style annotations and feature badges. Put this Japanese headline in the image: 「推せるポイント」. Add these readable Japanese feature labels: 「${features.join("」「")}」. Scene: ${scenes[3]}.`,
    `${base} Slide 5: thank-you and profile CTA. Create a clean profile-guidance final slide with a soft screenshot-like profile area on the right, no real account name or real profile photo. Put this Japanese message in the image: 「最後までありがとう」 and 「気になる人はプロフィールへ」. Also include a big simple arrow shape pointing to the profile area. Scene: ${scenes[4]}.`,
  ];
}

async function defaultOpenAiClient(body: Record<string, unknown>, apiKey: string): Promise<OpenAiImageResponse> {
  const response = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`OpenAI image generation failed: ${response.status} ${detail.slice(0, 300)}`);
  }
  return response.json() as Promise<OpenAiImageResponse>;
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
  const quality = options.quality ?? (process.env.AI_IMAGE_QUALITY as GenerateAiLifestyleImagesOptions["quality"]) ?? "low";
  const size = options.size ?? process.env.AI_IMAGE_SIZE ?? "1024x1024";
  const now = options.now ?? new Date();
  const client = options.client ?? defaultOpenAiClient;
  const day = now.toISOString().slice(0, 10);
  const stamp = timestamp(now);
  const hash = crypto.createHash("sha1").update(`${item.itemCode}|${item.itemName}`).digest("hex").slice(0, 10);

  fs.mkdirSync(outputDir, { recursive: true });

  const prompts = buildAiLifestyleImagePrompts(item, persona);
  const assets: CarouselAsset[] = [];
  for (let i = 0; i < prompts.length; i++) {
    const body: Record<string, unknown> = {
      model,
      prompt: prompts[i],
      n: 1,
      size,
      quality,
      output_format: "jpeg",
      output_compression: 90,
    };
    const response = await client(body, apiKey);
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
  return assets;
}
