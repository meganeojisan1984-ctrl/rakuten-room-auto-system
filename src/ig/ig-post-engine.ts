import axios from "axios";
import { buildInstagramFinalCaption, upscaleImageUrl } from "../sns";
import { notifyError } from "../notifiers";
import type { PersonaSlot } from "../persona/persona";
import type { RakutenItem } from "../fetcher";

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
