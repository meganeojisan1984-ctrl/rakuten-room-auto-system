import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import type { RakutenItem } from "../fetcher";
import type { PersonaSlot } from "../persona/persona";
import { mapAssetToPublicUrl, type CarouselAsset } from "./carousel";
import { classifyProductCategory } from "../fetcher";
import { cleanProductDisplayName, extractProductFacts, isSoftwareProduct } from "./product-copy";
import type { ProductContentBrief } from "../content-brief";
import { normalizeImageForUpload } from "./image-normalize";

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
  brief?: ProductContentBrief;
  client?: (body: FormData, apiKey: string) => Promise<OpenAiImageResponse>;
}

export interface AiLifestyleImagePromptOptions {
  now?: Date;
  brief?: ProductContentBrief;
}

const DEFAULT_OUTPUT_DIR = path.join(process.cwd(), "public", "generated", "instagram");
const DEFAULT_MODEL = "gpt-image-2";
const DEFAULT_QUALITY: NonNullable<GenerateAiLifestyleImagesOptions["quality"]> = "high";

function cleanText(value: string, max = 140): string {
  return value.replace(/\s+/g, " ").trim().slice(0, max);
}

function productTitle(item: RakutenItem): string {
  return cleanText(cleanProductDisplayName(item.itemName), 42);
}

function timestamp(now: Date): string {
  return now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function sceneHints(item: RakutenItem): string[] {
  const text = `${item.itemName} ${item.itemCaption}`.toLowerCase();
  if (isSoftwareProduct(text) || /ソフト|アプリ|ライセンス|パソコン|pc|mac|office|microsoft/.test(text)) {
    return [
      "a tidy home office desk with a closed laptop, keyboard, notebook, and warm daylight; all screens are off",
      "a quiet work-from-home corner with a desk, chair, stationery, and no visible screen content",
      "a clean desktop workspace with a blank monitor turned away from camera and neutral office supplies",
      "a natural desk scene with a laptop closed beside a notebook and pen, with no logos or readable marks",
      "a calm evening home-office setting with a desk lamp, closed computer, and uncluttered work surface",
    ];
  }
  if (/美容|コスメ|スキンケア|ヘアケア|メイク|化粧|リップ|美容液|セラム|香水|保湿|乾燥/.test(text)) {
    return [
      "a soft morning vanity scene with a mirror, folded towel, and restrained neutral cosmetic tools",
      "a realistic washstand scene with a mirror and clean neutral surfaces, with no bottles or labels",
      "a bright vanity tabletop with a comb, hand mirror, and soft daylight, without cosmetics or packaging",
      "a calm vanity corner with a mirror, folded towels, and a small plant, with no branded containers",
      "a simple makeup-prep corner with a clean mirror and neutral accessories, without a person or product",
    ];
  }
  if (/収納|片付け|ハンガー|ラック|チェスト|ケース|ボックス|衣類/.test(text)) {
    return [
      "a realistic tidy home storage corner with an open shelf and neatly folded neutral fabrics, no organizers",
      "a clean shelf or washstand with a few small everyday objects arranged neatly, no storage containers",
      "a bright uncluttered closet corner with hanging neutral clothes and empty shelf space",
      "a calm home storage area with natural light and clear surfaces, without boxes or organizers",
      "a simple bedroom corner with a chair and folded fabric, free of branded or distinctive objects",
    ];
  }
  if (/洗濯|柔軟剤|洗剤|タオル|掃除|トイレ|風呂|バス|シャワー/.test(text)) {
    return [
      "a realistic laundry-room counter with folded towels and an empty sink, without detergent bottles",
      "a bright bathroom sink-side scene with clean tile and a folded neutral towel, no product containers",
      "a simple utility area with a laundry basket and uncluttered counter, no branded objects",
      "a calm bath-area scene with folded towels and natural light, without bottles or labels",
      "a clean home utility corner with plain surfaces and soft daylight, no cleaning products visible",
    ];
  }
  if (classifyProductCategory(item) === "便利家電") {
    return [
      "a clean everyday home counter with open space where a small appliance would be used, no appliance shown",
      "a quiet room corner with an outlet, clear tabletop, and realistic natural daylight",
      "a bright living area with an empty side table and no visible electronics or logos",
      "a simple kitchen or home workspace with clear counter space and only neutral household props",
      "a calm home interior with a practical empty surface and soft natural light",
    ];
  }
  if (/食品|スイーツ|菓子|ケーキ|グルメ|飲料|コーヒー|お茶|うなぎ|肉|魚|チーズ/.test(text)) {
    return [
      "a warm home dessert-time table with plain dishes and a clean empty serving plate, no food shown",
      "a bright dessert tea-time table with simple cups, linen, and an empty plate, with no readable packaging",
      "a quiet dessert-table setting with neutral tableware and soft daylight, no food or labels",
      "a cozy dessert-serving counter with an empty serving board and neutral utensils, no ingredients shown",
      "a calm evening dessert tea table with plain cups and uncluttered surfaces, no food or branded objects",
    ];
  }
  return [
    "a natural home setting that matches the listed item's stated purpose, with no product or packaging shown",
    "a bright uncluttered shelf or counter with neutral props related to the item's stated use",
    "a realistic close view of a clean surface in a room suited to the product category, no product visible",
    "a simple tabletop scene with natural daylight and only neutral, category-relevant props",
    "a calm everyday room that fits the product description without adding distinctive objects",
  ];
}

export function buildAiLifestyleImagePrompts(
  item: RakutenItem,
  persona: PersonaSlot,
  options: AiLifestyleImagePromptOptions = {},
): string[] {
  const name = productTitle(item);
  const description = cleanText(extractProductFacts(item.itemCaption, 1)[0] ?? "", 160);
  const brief = options.brief;
  const genre = isSoftwareProduct(item.itemName)
    ? "パソコン用ソフトウェア"
    : classifyProductCategory(item) ?? "商品説明から判断する商品カテゴリ";
  const hourInJapan = Number(
    new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Tokyo", hour: "numeric", hourCycle: "h23" })
      .format(options.now ?? new Date()),
  );
  const timeContext = hourInJapan < 16 ? "soft morning daylight" : "soft evening indoor light";
  const base =
    `Create a polished, photorealistic square background image only for a Japanese Instagram product carousel. ` +
    `This is a photographic backdrop, not a finished advertisement or product card. Use natural light, realistic materials, ` +
    `clear focus, restrained props, and a calm everyday editorial style. ` +
    `The input image is the exact Rakuten product photo and is provided only to identify the product category and general color context. ` +
    `Do not recreate the product, its packaging, or any substitute item; the exact source product photo will be overlaid later. ` +
    `Do not render any readable text, Japanese or English letters, numbers, logos, icons, badges, prices, ratings, labels, charts, or UI. ` +
    `Do not include a screen with visible content. Do not invent features, discounts, rankings, or personal-use claims. ` +
    `Product name for context only: ${name}. Category: ${brief?.category ?? genre}. Listing description for context only: ${description}. ` +
    `${brief ? `Editorial angle for this series: ${brief.angle}. Problem context: ${brief.problem}. Solution context: ${brief.solution}. Purchase-story context: ${brief.purchaseCta}. Image comment to keep semantically aligned: ${brief.imageComment}. ` : ""}` +
    `Use these details only to choose a relevant room and neutral props; never write or depict them. ` +
    `Leave the central area visually quiet because accurate product imagery and all Japanese copy are composited afterward. ` +
    `Do not draw text panels, a collage, a mockup, a package, or a product.`;

  const scenes = sceneHints(item);
  return [
    ...scenes.map((scene, index) => `${base} Slide ${index + 1} background: ${scene}. Overall lighting: ${timeContext}. Keep the backdrop uncluttered and free of products, people, text, and logos.`),
  ];
}

async function defaultOpenAiClient(body: FormData, apiKey: string): Promise<OpenAiImageResponse> {
  const response = await fetch("https://api.openai.com/v1/images/edits", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body,
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`OpenAI image generation failed: ${response.status} ${detail.slice(0, 300)}`);
  }
  return response.json() as Promise<OpenAiImageResponse>;
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
  const loadProductImage = options.loadProductImage ?? downloadProductImage;
  const productImage = await loadProductImage(item.imageUrl).then((image) => normalizeImageForUpload(image.bytes, image.mimeType));
  const day = now.toISOString().slice(0, 10);
  const stamp = timestamp(now);
  const hash = crypto.createHash("sha1").update(`${item.itemCode}|${item.itemName}`).digest("hex").slice(0, 10);

  fs.mkdirSync(outputDir, { recursive: true });

  const prompts = buildAiLifestyleImagePrompts(item, persona, { now, brief: options.brief });
  const assets: CarouselAsset[] = [];
  for (let i = 0; i < prompts.length; i++) {
    const body = buildEditForm(prompts[i]!, model, size, quality, productImage);
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

