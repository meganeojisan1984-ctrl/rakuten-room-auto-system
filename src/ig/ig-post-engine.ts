import axios from "axios";
import { buildInstagramFinalCaption } from "../sns";
import { notifyError } from "../notifiers";
import type { PersonaSlot } from "../persona/persona";
import { PRODUCT_CATEGORIES, type RakutenItem } from "../fetcher";
import { buildProductContentBrief } from "../content-brief";
import type { SalesStrategyBrief } from "../sales-strategy";
import { generateAiLifestyleImages, isAiLifestyleImagesEnabled, isOpenAiQuotaError } from "./ai-image";
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
import { generateThreadsCopy, isThreadsCopyEnabled } from "./threads-copy";
import { buildImageCreativePlan } from "./image-creative";

// sns.ts と揃える (Instagram Graph API 独自エンドポイント)
const GRAPH_API = "https://graph.instagram.com/v21.0";
interface PostToInstagramWithPersonaOptions {
  brief?: SalesStrategyBrief;
  buildCaption?: typeof buildInstagramFinalCaption;
  createAssets?: typeof createInstagramCarouselAssets;
  publishCarousel?: typeof publishInstagramCarousel;
  sendXDraft?: typeof sendXDraftIfEnabled;
  notify?: typeof notifyError;
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

/** Instagram captions do not make raw URLs clickable; send readers to the profile link. */
function withPersonaFooter(caption: string, persona: PersonaSlot): string {
  const hashtags = persona.hashtags.join(" ");
  const footer = [
    "商品リンクはプロフィールの楽天ROOMから確認できます。プロフィールのURLをタップしてチェックしてください🛒",
    "気になったら投稿を保存・いいね・フォローで応援してください。",
    hashtags,
  ].filter(Boolean).join("\n\n");
  const availableCaptionLength = Math.max(0, 2200 - footer.length - 2);
  return `${caption.trimEnd().slice(0, availableCaptionLength).trimEnd()}\n\n${footer}`;
}
export interface BuildXDraftTextOptions {
  generateThreadsCopy?: typeof generateThreadsCopy;
}

export async function buildXDraftText(
  item: RakutenItem,
  finalCaption: string,
  assets: CarouselAsset[],
  persona: PersonaSlot,
  options: BuildXDraftTextOptions = {},
): Promise<string> {
  const spareAssets = assets.slice(4);
  const generate = options.generateThreadsCopy ?? generateThreadsCopy;
  const genre = persona.genres[0] ?? persona.name;

  let threadsCopyBlock: string;
  if (!isThreadsCopyEnabled(process.env)) {
    threadsCopyBlock = "(OPENAI_API_KEY未設定のためAI生成をスキップしました。下記の元キャプションを参考に手動で投稿文を作成してください)";
  } else {
    try {
      threadsCopyBlock = await generate(item, { genre });
    } catch (err) {
      const msg = String(err).slice(0, 300);
      console.warn("[ig-post-engine] Threads投稿文のAI生成に失敗、元キャプションのみ案内します:", msg);
      threadsCopyBlock = `(AI生成に失敗したため、下記の元キャプションを参考に手動で投稿文を作成してください)\n${msg}`;
    }
  }

  return [
    "Threadsへの手動投稿用です。以下3パターンから気に入ったものを選び、【投稿（1文目）】を投稿してから、【リプライ1（2文目）】【リプライ2（3文目）】【リプライ3（4文目）】【リプライ4（5文目）】を1つずつ順番にリプライとして投稿してください（1投稿=1ブロック、まとめて投稿しない）。画像1〜4は最初の投稿に添付してください。",
    "",
    threadsCopyBlock,
    "",
    "【添付】画像1〜4を1文目の投稿に添付",
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
  brief?: SalesStrategyBrief;
  env?: NodeJS.ProcessEnv;
  generateAiImages?: typeof generateAiLifestyleImages;
  renderCarouselImages?: typeof writeCarouselImages;
}

export async function createInstagramCarouselAssets(
  item: RakutenItem,
  persona: PersonaSlot,
  options: CreateInstagramCarouselAssetsOptions = {},
): Promise<CarouselAsset[]> {
  const envVars = options.env ?? process.env;
  const writeOptions = getCarouselWriteOptions(envVars);
  const renderCarouselImages = options.renderCarouselImages ?? writeCarouselImages;
  console.log(`[ig-post-engine] slot=${persona.id} building source-grounded carousel assets...`);
  const personaGenres = Array.isArray(persona.genres) ? persona.genres : [];
  const category = PRODUCT_CATEGORIES.find((value) => personaGenres.includes(value.name)) ?? PRODUCT_CATEGORIES[0]!;
  const brief = options.brief ?? buildProductContentBrief(item, persona, category);
  const creativePlan = buildImageCreativePlan(item, brief);
  const slides = buildCarouselSlides(item, { brief, creativePlan });
  if (isAiLifestyleImagesEnabled(envVars)) {
    const generateAiImages = options.generateAiImages ?? generateAiLifestyleImages;
    console.log(`[ig-post-engine] slot=${persona.id} generating product-matched background images...`);
    try {
      const aiTextMode = envVars.AI_IMAGE_TEXT_MODE !== "0";
      const backgrounds = await generateAiImages(item, persona, {
        apiKey: envVars.OPENAI_API_KEY,
        outputDir: writeOptions.outputDir,
        publicBaseUrl: writeOptions.publicBaseUrl,
        model: envVars.AI_IMAGE_MODEL || undefined,
        quality: envVars.AI_IMAGE_QUALITY as "low" | "medium" | "high" | "auto" | undefined,
        size: envVars.AI_IMAGE_SIZE || undefined,
        brief,
        creativePlan,
        referenceImageDir: envVars.AI_IMAGE_REFERENCE_DIR || undefined,
        useAiText: aiTextMode,
      });
      if (backgrounds.length !== 5) {
        throw new Error(`AI background generation returned ${backgrounds.length} images; expected 5`);
      }
      if (aiTextMode) {
        console.log("[ig-post-engine] AI完成画像モード: 生成画像をそのままカルーセル素材へ使用");
        return backgrounds;
      }
      writeOptions.backgroundImagePaths = backgrounds.map((asset) => asset.filePath);
    } catch (error) {
      const reason = isOpenAiQuotaError(error) ? "OpenAI画像生成の残高不足" : "AI画像生成エラー";
      console.warn(`[ig-post-engine] ${reason}。文字入り決定論的カルーセルへフォールバック: ${String(error).slice(0, 220)}`);
      delete writeOptions.backgroundImagePaths;
    }
  }
  writeOptions.creativePlan = creativePlan;
  const assets = await renderCarouselImages(item, slides, writeOptions);
  if (assets.length !== 5) throw new Error(`Carousel renderer returned ${assets.length} images; expected 5`);
  return assets;
}
async function sendXDraftIfEnabled(
  item: RakutenItem,
  finalCaption: string,
  assets: CarouselAsset[],
  persona: PersonaSlot,
): Promise<void> {
  if (!isXDraftMailEnabled(process.env)) return;
  try {
    await sendXDraftMail({
      to: env("X_DRAFT_EMAIL_TO"),
      from: env("SMTP_FROM") || env("SMTP_USER"),
      subject: `X投稿用: ${item.itemName.slice(0, 40)}`,
      text: await buildXDraftText(item, finalCaption, assets, persona),
      attachments: buildXDraftAttachments(assets),
    });
    console.log("[ig-post-engine] X投稿用メール送信完了");
  } catch (err) {
    const msg = String(err).slice(0, 500);
    console.warn("[ig-post-engine] X投稿用メール送信失敗:", msg);
    await notifyError("X投稿用メール送信失敗", msg);
  }
}

function assertFiveCarouselAssets(assets: CarouselAsset[]): void {
  if (assets.length !== 5 || assets.some((asset, index) => asset.page !== index + 1 || !asset.publicUrl)) {
    throw new Error("Instagram投稿にはpage 1〜5の5枚すべてが必要です");
  }
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

  const notify = options.notify ?? notifyError;
  try {
    if (!isCarouselEnabled(process.env)) {
      throw new Error("Instagramは5枚カルーセル必須です。IG_CAROUSEL_ENABLED=1 と IG_CAROUSEL_PUBLIC_BASE_URL を設定してください。");
    }

    const buildCaption = options.buildCaption ?? buildInstagramFinalCaption;
    const createAssets = options.createAssets ?? createInstagramCarouselAssets;
    const publishCarousel = options.publishCarousel ?? publishInstagramCarousel;
    const sendXDraft = options.sendXDraft ?? sendXDraftIfEnabled;
    const baseCaption = await buildCaption(item, roomCaption, options.brief);
    const scrubbed = scrubNgWords(baseCaption, persona.ngWords);
    const finalCaption = withPersonaFooter(scrubbed, persona);

    let assets = await createAssets(item, persona, { brief: options.brief });
    assertFiveCarouselAssets(assets);
    if (process.env.IG_CAROUSEL_GITHUB_UPLOAD === "1") {
      assets = await publishCarouselAssetsToGitHub(assets, {
        repository: process.env.GITHUB_REPOSITORY ?? "",
        branch: process.env.GITHUB_REF_NAME ?? "main",
        token: process.env.GITHUB_TOKEN ?? "",
      });
      assertFiveCarouselAssets(assets);
    }

    console.log(`[ig-post-engine] slot=${persona.id} publishing five-slide carousel...`);
    await publishCarousel({
      graphApiBase: GRAPH_API,
      igUserId: IG_USER_ID,
      accessToken: IG_ACCESS_TOKEN,
      caption: finalCaption,
      assets,
    });
    console.log(`[ig-post-engine] ✓ five-slide carousel post success: ${item.itemName.slice(0, 30)}`);
    await sendXDraft(item, finalCaption, assets, persona);
    return true;
  } catch (err) {
    const msg = axios.isAxiosError(err)
      ? JSON.stringify(err.response?.data ?? err.message).slice(0, 500)
      : String(err).slice(0, 500);
    console.error(`[ig-post-engine] slot=${persona.id} 失敗:`, msg);
    await notify(`Instagram投稿失敗(slot=${persona.id})`, msg);
    return false;
  }
}
