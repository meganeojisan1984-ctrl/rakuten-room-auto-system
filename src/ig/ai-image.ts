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
  const name = cleanText(item.itemName);
  const description = cleanText(item.itemCaption, 220);
  const genre = persona.genres[0] ?? persona.name;
  const base =
    `photorealistic Japanese Instagram lifestyle photo, authentic user-generated smartphone photography, ` +
    `natural daylight, realistic home interior, real buyer trust, subtle imperfect composition, no text, no captions, no watermark, ` +
    `no brand logos, no artificial CGI look, no illustration, no over-polished advertisement, avoid plastic-looking skin or objects. ` +
    `The scene should suggest a person could be using this product category in daily life without claiming actual ownership. ` +
    `Product reference: ${name}. Category: ${genre}. Description: ${description}.`;

  return sceneHints(item).map((scene, index) => {
    const focus =
      index === 0
        ? "Make this the cover image: inviting, useful, scroll-stopping, but still candid."
        : "Make it feel like a different real moment from the same daily routine.";
    return `${base} Scene: ${scene}. ${focus}`;
  });
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
  return env.AI_IMAGE_ENABLED === "1" && !!env.OPENAI_API_KEY;
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
