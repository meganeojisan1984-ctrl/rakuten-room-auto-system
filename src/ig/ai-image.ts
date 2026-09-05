import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import type { RakutenItem } from "../fetcher";
import type { PersonaSlot } from "../persona/persona";
import { mapAssetToPublicUrl, type CarouselAsset } from "./carousel";
import { buildProductStoryProfile } from "./product-story";

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

export interface AiLifestyleImagePromptOptions {
  now?: Date;
}

const DEFAULT_OUTPUT_DIR = path.join(process.cwd(), "public", "generated", "instagram");
const DEFAULT_MODEL = "gpt-image-2";

function cleanText(value: string, max = 140): string {
  return value.replace(/\s+/g, " ").trim().slice(0, max);
}

function productTitle(item: RakutenItem): string {
  return cleanText(item.itemName.replace(/[【】≪≫＜＞()[\]{}]/g, " "), 42);
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
  if (/美容|コスメ|スキンケア|ヘアケア|メイク|化粧|リップ|美容液|香水/.test(text)) {
    return [
      "a soft morning vanity scene with the product neatly placed near a mirror",
      "a close-up hand applying the product with clean, soft-focus skin texture",
      "a bathroom or washstand shelf scene with cosmetic bottles and natural light",
      "a hand-held smartphone snapshot of the product on a bedside table",
      "a calm self-care moment scene that feels fresh and inviting",
    ];
  }
  if (/食品|お米|お水|ミネラルウォーター|コーヒー|お茶|菓子|チョコ|うなぎ|お肉|鮮魚|干物|プロテイン/.test(text)) {
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

export function buildAiLifestyleImagePrompts(
  item: RakutenItem,
  persona: PersonaSlot,
  options: AiLifestyleImagePromptOptions = {},
): string[] {
  const name = productTitle(item);
  const description = cleanText(item.itemCaption, 220);
  const genre = persona.genres[0] ?? persona.name;
  const story = buildProductStoryProfile(item, { now: options.now });
  const benefits = story.benefits;
  const features = productFeatures(item);
  const base =
    `photorealistic Japanese Instagram carousel design, authentic product-review post, real buyer trust, ` +
    `Japanese text inside the image, crisp readable Japanese typography, bold friendly SNS fonts, large high-contrast headings, ` +
    `short text only, clean magazine-like layout, natural daylight product photography, realistic home interior, ` +
    `subtle imperfect smartphone-photo texture, no watermark, no random logo, no garbled characters, no tiny text, ` +
    `no artificial CGI look, no over-polished advertisement, avoid plastic-looking skin or objects. ` +
    `The post may recommend the product category, but must not falsely claim the creator personally bought or used it. ` +
    `Product reference: ${name}. Product image URL for visual reference if accessible: ${item.imageUrl}. Category: ${genre}. Description: ${description}. ` +
    `Creative rule for this post: ${story.visualTemplate}. Hook angle: ${story.hookAngle}. Layout mood: ${story.layoutMood}. Time context: ${story.timeMood}. ` +
    `Keep all slides visually coherent as one carousel, but change composition, scale, cropping, badges, and text placement from slide to slide.`;

  const scenes = sceneHints(item);
  return [
    `${base} Slide 1: cover. Compose a scroll-stopping Japanese Instagram cover with the selected visual template, a large title, and a clear product photo. Make it feel different from a plain review card. Put this exact Japanese headline in the image: 「${story.coverHeadline}」. Add a smaller readable kicker: 「${story.coverKicker}」. Add a smaller readable product title: 「${name}」. Scene: ${scenes[0]}, ${story.coverSceneTone}. Use ${story.paletteHint} like a popular Japanese product carousel.`,
    `${base} Slide 2: swipe hook. Use a different composition than slide 1: comparison card, speech bubble, circled details, or bold warning badge depending on the hook angle. Show a realistic person or room before the benefit, not exaggerated. Put this Japanese headline in the image: 「${story.problemHeadline}」. Add 2 short pain points as readable Japanese labels: 「${story.painPoints[0]}」「${story.painPoints[1]}」. Scene: ${scenes[1]}.`,
    `${base} Slide 3: benefit reveal. Do not repeat the slide 2 structure. Use checklist, before-after, three-scene mini catalog, or annotation layout. Put this Japanese headline in the image: 「${story.solutionHeadline}」. Add these readable checklist items in Japanese: 「${benefits[0]}」「${benefits[1]}」「${benefits[2]}」. Scene: ${scenes[2]}.`,
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

  const prompts = buildAiLifestyleImagePrompts(item, persona, { now });
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
