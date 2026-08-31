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

function buildXDraftText(item: RakutenItem, finalCaption: string, assets: CarouselAsset[]): string {
  return [
    "Instagram投稿が完了しました。Xへの手動投稿用に本文と画像を添付します。",
    "",
    "【X投稿本文】",
    finalCaption,
    "",
    "【商品URL】",
    item.itemUrl,
    "",
    "【画像URL】",
    assets.map((asset) => `- ${asset.publicUrl}`).join("\n"),
  ].join("\n");
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
      attachments: assets.map((asset) => ({ filePath: asset.filePath })),
    });
    console.log("[ig-post-engine] X投稿用メール送信完了");
  } catch (err) {
    const msg = String(err).slice(0, 500);
    console.warn("[ig-post-engine] X投稿用メール送信失敗:", msg);
    await notifyError("X投稿用メール送信失敗", msg);
  }
}

export async function postToInstagramWithPersona(
  item: RakutenItem,
  roomCaption: string,
  persona: PersonaSlot,
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
    const baseCaption = await buildInstagramFinalCaption(item, roomCaption);
    const scrubbed = scrubNgWords(baseCaption, persona.ngWords);
    const finalCaption = withPersonaFooter(scrubbed, persona);
    if (isCarouselEnabled(process.env)) {
      try {
        console.log(`[ig-post-engine] slot=${persona.id} carousel media creating...`);
        let assets = await createInstagramCarouselAssets(item, persona);
        if (process.env.IG_CAROUSEL_GITHUB_UPLOAD === "1") {
          assets = await publishCarouselAssetsToGitHub(assets, {
            repository: process.env.GITHUB_REPOSITORY ?? "",
            branch: process.env.GITHUB_REF_NAME ?? "main",
            token: process.env.GITHUB_TOKEN ?? "",
          });
        }
        await publishInstagramCarousel({
          graphApiBase: GRAPH_API,
          igUserId: IG_USER_ID,
          accessToken: IG_ACCESS_TOKEN,
          caption: finalCaption,
          assets,
        });
        console.log(`[ig-post-engine] ✓ carousel post success: ${item.itemName.slice(0, 30)}`);
        await sendXDraftIfEnabled(item, finalCaption, assets);
        return true;
      } catch (err) {
        const msg = String(err).slice(0, 500);
        if (wantsAiLifestyleImages(process.env)) {
          console.warn(`[ig-post-engine] ChatGPT text-in-image carousel failed; old carousel fallback is disabled: ${msg}`);
          await notifyError("ChatGPT画像生成失敗", msg);
          return false;
        }
        console.warn(`[ig-post-engine] carousel failed, falling back to single image: ${String(err).slice(0, 200)}`);
      }
    }
    const imageUrl = upscaleImageUrl(item.imageUrl);
    console.log(`[ig-post-engine] slot=${persona.id} メディア作成中...`);
    const createRes = await axios.post<{ id: string }>(
      `${GRAPH_API}/${IG_USER_ID}/media`,
      null,
      { params: { image_url: imageUrl, caption: finalCaption, access_token: IG_ACCESS_TOKEN }, timeout: 30000 },
    );
    const creationId = createRes.data.id;
    for (let i = 0; i < 12; i++) {
      const s = await axios.get<{ status_code: string }>(
        `${GRAPH_API}/${creationId}`,
        { params: { fields: "status_code", access_token: IG_ACCESS_TOKEN }, timeout: 15000 },
      );
      if (s.data.status_code === "FINISHED") break;
      if (s.data.status_code === "ERROR") throw new Error("Instagramメディア処理エラー");
      await sleep(5000);
    }
    console.log(`[ig-post-engine] slot=${persona.id} 公開中...`);
    await axios.post(
      `${GRAPH_API}/${IG_USER_ID}/media_publish`,
      null,
      { params: { creation_id: creationId, access_token: IG_ACCESS_TOKEN }, timeout: 30000 },
    );
    console.log(`[ig-post-engine] ✅ slot=${persona.id} 投稿成功: ${item.itemName.slice(0, 30)}`);
    return true;
  } catch (err) {
    const msg = axios.isAxiosError(err)
      ? JSON.stringify(err.response?.data ?? err.message).slice(0, 500)
      : String(err);
    console.error(`[ig-post-engine] slot=${persona.id} 失敗:`, msg);
    await notifyError(`Instagram投稿失敗(slot=${persona.id})`, msg);
    return false;
  }
}
