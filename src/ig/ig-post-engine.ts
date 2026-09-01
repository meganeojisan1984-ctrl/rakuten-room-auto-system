import axios from "axios";
import { buildInstagramFinalCaption, upscaleImageUrl } from "../sns";
import { notifyError } from "../notifiers";
import type { PersonaSlot } from "../persona/persona";
import type { RakutenItem } from "../fetcher";
import { generateAiLifestyleImages } from "./ai-image";
import {
  buildCarouselSlides,
  getCarouselWriteOptions,
  isCarouselEnabled,
  publishCarouselAssetsToGitHub,
  publishInstagramCarousel,
  writeCarouselImages,
  type CarouselAsset,
} from "./carousel";
import { isXDraftMailEnabled, sendXDraftMail } from "./x-draft-mailer";

// sns.ts と揃える (Instagram Graph API 独自エンドポイント)
const GRAPH_API = "https://graph.instagram.com/v21.0";
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

interface InstagramHttpClient {
  post<T>(url: string, body: unknown, options: { params: Record<string, unknown>; timeout?: number }): Promise<{ data: T }>;
  get<T>(url: string, options: { params: Record<string, unknown>; timeout?: number }): Promise<{ data: T }>;
}

interface PostToInstagramWithPersonaOptions {
  buildCaption?: typeof buildInstagramFinalCaption;
  createAssets?: typeof createInstagramCarouselAssets;
  publishCarousel?: typeof publishInstagramCarousel;
  sendXDraft?: typeof sendXDraftIfEnabled;
  singleImageClient?: InstagramHttpClient;
  notify?: typeof notifyError;
  waitMs?: (ms: number) => Promise<void>;
}

function env(key: string): string {
  return process.env[key] ?? "";
}

/** NG ワードを ### に置換 */
function scrubNgWords(text: string, ngWords: string[]): string {
  let out = text;
  for (const w of ngWords) {
    if (!w) continue;
    out = out.split(w).join("###");
  }
  return out;
}

/** persona.ctaLine と #タグをキャプション末尾に付与 */
function withPersonaFooter(caption: string, persona: PersonaSlot): string {
  const hashtags = persona.hashtags.join(" ");
  return `${caption.trimEnd()}\n\n${persona.ctaLine}\n\n${hashtags}`;
}

function firstUsefulLine(text: string): string {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0 && !line.startsWith("#")) ?? "";
}

function compactProductName(itemName: string): string {
  return itemName
    .replace(/[【】《》「」]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 34);
}

export function buildXDraftText(item: RakutenItem, finalCaption: string, assets: CarouselAsset[]): string {
  const hook = firstUsefulLine(finalCaption) || `${compactProductName(item.itemName)}、これ良さそう！`;
  const spareAssets = assets.slice(4);
  return [
    "Xへの手動投稿用です。1通目を投稿してから、2通目をリプ欄に続けてください。",
    "",
    "【X 1通目】",
    "友達にこっそり教えたくなるやつ見つけた！",
    hook,
    "これならちょっと見てみたいかも。",
    "画像も一緒に見ると伝わるやつ✨",
    "これから友達にも紹介してやる☺",
    "#楽天ROOM #買ってよかった #暮らしのアイテム",
    "",
    "【添付】画像1〜4を1通目に添付",
    "",
    "【X 2通目（リプ欄）】",
    "毎日、1,000円台で買える「本当に良いモノ」だけ厳選して紹介しています。フォローしてチェック！✨",
    item.itemUrl,
    "",
    "【元キャプション（必要なら調整用）】",
    finalCaption,
    "",
    "【予備画像URL】",
    spareAssets.length > 0
      ? spareAssets.map((asset) => `- ${asset.publicUrl}`).join("\n")
      : "なし",
  ].join("\n");
}

export function buildXDraftAttachments(assets: CarouselAsset[]): Array<{ filePath: string; filename: string }> {
  return assets.slice(0, 4).map((asset, index) => ({
    filePath: asset.filePath,
    filename: `x-post-${String(index + 1).padStart(2, "0")}.jpg`,
  }));
}

interface CreateInstagramCarouselAssetsOptions {
  env?: NodeJS.ProcessEnv;
  generateAiImages?: typeof generateAiLifestyleImages;
  renderCarouselImages?: typeof writeCarouselImages;
}

function wantsAiLifestyleImages(envVars: NodeJS.ProcessEnv): boolean {
  return envVars.AI_IMAGE_ENABLED !== "0" && !!envVars.OPENAI_API_KEY;
}

export async function createInstagramCarouselAssets(
  item: RakutenItem,
  persona: PersonaSlot,
  options: CreateInstagramCarouselAssetsOptions = {},
): Promise<CarouselAsset[]> {
  const envVars = options.env ?? process.env;
  const writeOptions = getCarouselWriteOptions(envVars);
  const generateAiImages = options.generateAiImages ?? generateAiLifestyleImages;
  const renderCarouselImages = options.renderCarouselImages ?? writeCarouselImages;

  if (wantsAiLifestyleImages(envVars)) {
    console.log(`[ig-post-engine] slot=${persona.id} ChatGPT text-in-image carousel generating...`);
    return generateAiImages(item, persona, writeOptions);
  }

  const slides = buildCarouselSlides(item);
  return renderCarouselImages(item, slides, writeOptions);
}

async function sendXDraftIfEnabled(item: RakutenItem, finalCaption: string, assets: CarouselAsset[]): Promise<void> {
  if (!isXDraftMailEnabled(process.env)) return;
  try {
    await sendXDraftMail({
      to: env("X_DRAFT_EMAIL_TO"),
      from: env("SMTP_FROM") || env("SMTP_USER"),
      subject: `X投稿用: ${item.itemName.slice(0, 40)}`,
      text: buildXDraftText(item, finalCaption, assets),
      attachments: buildXDraftAttachments(assets),
    });
    console.log("[ig-post-engine] X投稿用メール送信完了");
  } catch (err) {
    const msg = String(err).slice(0, 500);
    console.warn("[ig-post-engine] X投稿用メール送信失敗:", msg);
    await notifyError("X投稿用メール送信失敗", msg);
  }
}

async function publishSingleInstagramImage(
  item: RakutenItem,
  finalCaption: string,
  client: InstagramHttpClient,
  waitMs: (ms: number) => Promise<void>,
): Promise<void> {
  const IG_USER_ID = env("IG_USER_ID");
  const IG_ACCESS_TOKEN = env("IG_ACCESS_TOKEN");
  const imageUrl = upscaleImageUrl(item.imageUrl);
  console.log(`[ig-post-engine] slot fallback single image creating...`);
  const createRes = await client.post<{ id: string }>(
    `${GRAPH_API}/${IG_USER_ID}/media`,
    null,
    { params: { image_url: imageUrl, caption: finalCaption, access_token: IG_ACCESS_TOKEN }, timeout: 30000 },
  );
  const creationId = createRes.data.id;
  for (let i = 0; i < 12; i++) {
    const s = await client.get<{ status_code: string }>(
      `${GRAPH_API}/${creationId}`,
      { params: { fields: "status_code", access_token: IG_ACCESS_TOKEN }, timeout: 15000 },
    );
    if (s.data.status_code === "FINISHED") break;
    if (s.data.status_code === "ERROR") throw new Error("Instagramメディア処理エラー");
    await waitMs(5000);
  }
  console.log(`[ig-post-engine] slot fallback single image publishing...`);
  await client.post(
    `${GRAPH_API}/${IG_USER_ID}/media_publish`,
    null,
    { params: { creation_id: creationId, access_token: IG_ACCESS_TOKEN }, timeout: 30000 },
  );
}

export async function postToInstagramWithPersona(
  item: RakutenItem,
  roomCaption: string,
  persona: PersonaSlot,
  options: PostToInstagramWithPersonaOptions = {},
): Promise<boolean> {
  const IG_USER_ID = env("IG_USER_ID");
  const IG_ACCESS_TOKEN = env("IG_ACCESS_TOKEN");
  if (!IG_USER_ID || !IG_ACCESS_TOKEN) {
    console.log("[ig-post-engine] Instagram: 環境変数未設定のためスキップ");
    return false;
  }
  if (!item.imageUrl) {
    console.warn("[ig-post-engine] Instagram: 画像URL空のためスキップ");
    return false;
  }
  try {
    const buildCaption = options.buildCaption ?? buildInstagramFinalCaption;
    const createAssets = options.createAssets ?? createInstagramCarouselAssets;
    const publishCarousel = options.publishCarousel ?? publishInstagramCarousel;
    const sendXDraft = options.sendXDraft ?? sendXDraftIfEnabled;
    const singleImageClient = options.singleImageClient ?? axios;
    const notify = options.notify ?? notifyError;
    const waitMs = options.waitMs ?? sleep;
    const baseCaption = await buildCaption(item, roomCaption);
    const scrubbed = scrubNgWords(baseCaption, persona.ngWords);
    const finalCaption = withPersonaFooter(scrubbed, persona);
    let xDraftAssets: CarouselAsset[] = [];
    if (isCarouselEnabled(process.env)) {
      try {
        console.log(`[ig-post-engine] slot=${persona.id} carousel media creating...`);
        let assets = await createAssets(item, persona);
        xDraftAssets = assets;
        if (process.env.IG_CAROUSEL_GITHUB_UPLOAD === "1") {
          assets = await publishCarouselAssetsToGitHub(assets, {
            repository: process.env.GITHUB_REPOSITORY ?? "",
            branch: process.env.GITHUB_REF_NAME ?? "main",
            token: process.env.GITHUB_TOKEN ?? "",
          });
          xDraftAssets = assets;
        }
        await publishCarousel({
          graphApiBase: GRAPH_API,
          igUserId: IG_USER_ID,
          accessToken: IG_ACCESS_TOKEN,
          caption: finalCaption,
          assets,
        });
        console.log(`[ig-post-engine] ✓ carousel post success: ${item.itemName.slice(0, 30)}`);
        await sendXDraft(item, finalCaption, assets);
        return true;
      } catch (err) {
        const msg = String(err).slice(0, 500);
        console.warn(`[ig-post-engine] carousel failed, falling back to single product image: ${msg}`);
        await notify("Instagramカルーセル投稿失敗", `${msg}\n商品画像1枚投稿へフォールバックします。`);
      }
    }
    await publishSingleInstagramImage(item, finalCaption, singleImageClient, waitMs);
    console.log(`[ig-post-engine] ✅ slot=${persona.id} 1枚画像投稿成功: ${item.itemName.slice(0, 30)}`);
    if (xDraftAssets.length > 0) {
      await sendXDraft(item, finalCaption, xDraftAssets);
    }
    return true;
  } catch (err) {
    const msg = axios.isAxiosError(err)
      ? JSON.stringify(err.response?.data ?? err.message).slice(0, 500)
      : String(err);
    console.error(`[ig-post-engine] slot=${persona.id} 失敗:`, msg);
    await (options.notify ?? notifyError)(`Instagram投稿失敗(slot=${persona.id})`, msg);
    return false;
  }
}
