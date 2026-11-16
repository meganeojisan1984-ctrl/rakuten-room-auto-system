import { defaultOpenAiTextClient, extractOpenAiText, resolveOpenAiTextModel, type OpenAiTextClient } from "../openai-text";

/**
 * AI生成スライドの公開前チェック。
 * 楽天の商品画像と生成スライドを低コストの画像対応モデルに見せ、
 * 「別の商品が描かれている」「指定した価格と違う」スライドが1枚でもあれば不合格にする。
 * 不合格・判定不能のときは呼び出し側で文字合成カルーセルへ切り替える。
 */
export interface AiImageVerifyInput {
  productName: string;
  productImage: { bytes: Uint8Array; mimeType: string };
  slides: Array<{ bytes: Uint8Array; mimeType: string }>;
  /** 画像内に出てよい価格表記（例: "33,000円"）。未指定なら価格は検査しない */
  expectedPrice?: string;
}

export interface AiImageVerifyResult {
  ok: boolean;
  problems: string[];
}

export interface AiImageVerifyOptions {
  apiKey: string;
  env?: Record<string, string | undefined>;
  client?: OpenAiTextClient;
  timeoutMs?: number;
}

function dataUrl(image: { bytes: Uint8Array; mimeType: string }): string {
  return `data:${image.mimeType};base64,${Buffer.from(image.bytes).toString("base64")}`;
}

export function buildAiImageVerifyRequest(input: AiImageVerifyInput, env: Record<string, string | undefined>): Record<string, unknown> {
  const instruction = `あなたは広告画像の検品担当です。1枚目は販売する商品の公式写真、2枚目以降はその商品を紹介するために生成したスライド（順に1〜${input.slides.length}番）です。
商品名: ${input.productName}
${input.expectedPrice ? `正しい価格表記: ${input.expectedPrice}` : "価格の検査は不要です。"}

各スライドについて次を判定してください。
- wrongProduct: 主役として描かれている製品が、1枚目の商品と別の種類の製品である（例: 冷蔵庫の広告なのに電気ケトルが描かれている）。色や角度の違い、背景の小物は問題にしない。商品が描かれていない文字中心のスライドは false。
- wrongPrice: 円の価格が書かれていて、正しい価格表記と数字が異なる。価格が書かれていない、または検査不要なら false。

JSONだけを出力してください: {"slides":[{"wrongProduct":false,"wrongPrice":false}]}（slides はスライドの枚数ぶん、順番どおり）`;
  return {
    model: resolveOpenAiTextModel(env),
    input: [
      {
        role: "user",
        content: [
          { type: "input_text", text: instruction },
          { type: "input_image", image_url: dataUrl(input.productImage), detail: "low" },
          ...input.slides.map((slide) => ({ type: "input_image", image_url: dataUrl(slide), detail: "low" })),
        ],
      },
    ],
    max_output_tokens: 1200,
    reasoning: { effort: "minimal" },
  };
}

export function parseAiImageVerifyResponse(raw: string, slideCount: number): AiImageVerifyResult {
  const json = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const parsed = JSON.parse(json) as { slides?: unknown };
  if (!Array.isArray(parsed.slides) || parsed.slides.length !== slideCount) {
    throw new Error("AI image verification returned an unexpected number of slides");
  }
  const problems: string[] = [];
  parsed.slides.forEach((value, index) => {
    const slide = (value ?? {}) as Record<string, unknown>;
    if (typeof slide.wrongProduct !== "boolean" || typeof slide.wrongPrice !== "boolean") {
      throw new Error("AI image verification returned an invalid slide verdict");
    }
    if (slide.wrongProduct) problems.push(`スライド${index + 1}: 別の商品が描かれています`);
    if (slide.wrongPrice) problems.push(`スライド${index + 1}: 価格表記が商品データと異なります`);
  });
  return { ok: problems.length === 0, problems };
}

export async function verifyAiImages(input: AiImageVerifyInput, options: AiImageVerifyOptions): Promise<AiImageVerifyResult> {
  const env = options.env ?? process.env;
  const client = options.client ?? defaultOpenAiTextClient;
  const timeoutMs = options.timeoutMs ?? 90_000;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const response = await Promise.race([
      client(buildAiImageVerifyRequest(input, env), options.apiKey),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`AI image verification timed out (${timeoutMs}ms)`)), timeoutMs);
      }),
    ]);
    return parseAiImageVerifyResponse(extractOpenAiText(response), input.slides.length);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
