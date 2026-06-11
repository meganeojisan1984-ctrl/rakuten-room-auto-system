/**
 * llm.ts - Groq を用いた汎用LLMクライアント
 *
 * - JSON出力（{"items":[...]} 形式）を安定して取得
 * - レート制限への指数バックオフリトライ
 * - 大量出力はバッチ分割で安定生成（30投稿などをチャンクで生成）
 */
import Groq from "groq-sdk";
import * as dotenv from "dotenv";
dotenv.config();

const GROQ_API_KEY = process.env.GROQ_API_KEY ?? "";
const MODEL_NAME = process.env.AFFILIATE_LLM_MODEL ?? "llama-3.3-70b-versatile";

const REQUEST_INTERVAL_MS = 1500;
const MAX_RETRIES = 4;
const RETRY_BASE_DELAY_MS = 4000;

export function isLlmConfigured(): boolean {
  return GROQ_API_KEY.length > 0;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

let client: Groq | null = null;
function getClient(): Groq {
  if (!GROQ_API_KEY) {
    throw new Error("GROQ_API_KEY が未設定です。.env または GitHub Secrets に設定してください。");
  }
  if (!client) client = new Groq({ apiKey: GROQ_API_KEY });
  return client;
}

interface GenOpts {
  temperature?: number;
  maxTokens?: number;
  /** JSONモードを使う場合 true（プロンプトに "JSON" の語が必須） */
  json?: boolean;
}

async function chat(prompt: string, opts: GenOpts = {}, attempt = 0): Promise<string> {
  const { temperature = 0.85, maxTokens = 4096, json = false } = opts;
  try {
    const completion = await getClient().chat.completions.create({
      model: MODEL_NAME,
      messages: [{ role: "user", content: prompt }],
      max_tokens: maxTokens,
      temperature,
      ...(json ? { response_format: { type: "json_object" as const } } : {}),
    });
    const text = completion.choices[0]?.message?.content ?? "";
    if (!text) throw new Error("Groq APIからの応答が空です");
    return text;
  } catch (err: unknown) {
    const msg = String(err);
    const isRateLimit = msg.includes("429") || /rate.?limit/i.test(msg);
    if (isRateLimit && attempt < MAX_RETRIES) {
      const delay = RETRY_BASE_DELAY_MS * Math.pow(2, attempt);
      console.warn(`[llm] レート制限。${delay / 1000}秒後にリトライ (${attempt + 1}/${MAX_RETRIES})`);
      await sleep(delay);
      return chat(prompt, opts, attempt + 1);
    }
    throw err;
  }
}

/** 自由テキストを生成 */
export async function generateText(prompt: string, opts: GenOpts = {}): Promise<string> {
  const text = await chat(prompt, opts);
  return text.trim();
}

/**
 * レスポンスから JSON を抽出してパース。
 * ```json ... ``` フェンスや前後の説明文が混ざっても可能な限り救出する。
 */
function extractJson(raw: string): unknown {
  let s = raw.trim();
  // コードフェンス除去
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence && fence[1]) s = fence[1].trim();
  // 最初の { から最後の } までを抜き出す
  const first = s.indexOf("{");
  const last = s.lastIndexOf("}");
  if (first !== -1 && last !== -1 && last > first) {
    s = s.slice(first, last + 1);
  }
  return JSON.parse(s);
}

/**
 * items 配列の各要素を個別にパースして救出する。
 * モデルが一部の要素で不正なJSON（カンマ区切りの複数値など）を返しても、
 * 壊れた要素だけスキップして残りを取り出す。
 */
function salvageItems<T>(raw: string): T[] {
  const itemsKey = raw.indexOf('"items"');
  const arrStart = raw.indexOf("[", itemsKey >= 0 ? itemsKey : 0);
  const s = arrStart >= 0 ? raw.slice(arrStart) : raw;
  const objs: T[] = [];
  let depth = 0;
  let start = -1;
  let inStr = false;
  let esc = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === "{") {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0 && start >= 0) {
        try {
          objs.push(JSON.parse(s.slice(start, i + 1)) as T);
        } catch {
          /* 壊れた要素はスキップ */
        }
        start = -1;
      }
    } else if (ch === "]" && depth === 0) {
      break;
    }
  }
  return objs;
}

/**
 * {"items": [...]} 形式のJSONを生成して items 配列を返す。
 * パース失敗時は要素単位の救出を行い、それも無理なら空配列を返す（例外は投げない）。
 */
export async function generateItems<T>(prompt: string, opts: GenOpts = {}): Promise<T[]> {
  const fullPrompt = `${prompt}

【出力形式（厳守）】
必ず次の構造の JSON のみを出力してください。前置き・説明・コードフェンスは一切不要です。
各フィールドの値は必ず1つの文字列または数値にすること（カンマ区切りで複数値を入れない）。
{"items": [ ... ]}`;
  const raw = await chat(fullPrompt, { ...opts, json: true });
  try {
    const parsed = extractJson(raw) as { items?: T[] } | T[];
    if (Array.isArray(parsed)) return parsed;
    if (parsed.items) return parsed.items;
  } catch {
    /* フォールバックへ */
  }
  const salvaged = salvageItems<T>(raw);
  if (salvaged.length === 0) {
    console.warn("[llm] JSONパース失敗、救出も0件:", raw.slice(0, 160).replace(/\n/g, " "));
  } else {
    console.warn(`[llm] JSON一部破損のため ${salvaged.length} 件を救出`);
  }
  return salvaged;
}

/**
 * 大量アイテムをバッチ分割で生成する。
 * @param buildPrompt (batchCount, alreadyHave) => prompt 文字列
 * @param total       目標件数
 * @param batchSize    1回あたりの生成件数
 */
export async function generateItemsBatched<T>(
  buildPrompt: (batchCount: number, produced: T[]) => string,
  total: number,
  batchSize: number,
  opts: GenOpts = {}
): Promise<T[]> {
  const produced: T[] = [];
  let guard = 0;
  while (produced.length < total && guard < Math.ceil(total / batchSize) + 2) {
    guard++;
    const need = Math.min(batchSize, total - produced.length);
    const items = await generateItems<T>(buildPrompt(need, produced), opts);
    if (items.length === 0) break;
    produced.push(...items);
    if (produced.length < total) await sleep(REQUEST_INTERVAL_MS);
  }
  return produced.slice(0, total);
}

/** 単発生成の間に挟む待機（連続呼び出しのレート制限対策） */
export function pace(): Promise<void> {
  return sleep(REQUEST_INTERVAL_MS);
}

export { MODEL_NAME };
