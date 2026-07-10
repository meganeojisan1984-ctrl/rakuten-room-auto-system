/**
 * agents/store.ts - 自己学習ループの状態永続化
 *
 * - strategy.json      : 司令官が更新する戦略（ジャンル重み・投稿タイプ重み・文体ヒント）
 * - post_history.json  : 投稿履歴（何を・いつ・どの戦略で投稿し、何いいね取れたか）
 * - agent_reports.json : 各エージェントの実行報告（司令官の監視対象）
 *
 * すべてリポジトリ直下のJSONで、GitHub Actionsがコミットして世代をまたいで学習する。
 */
import * as fs from "fs";
import * as path from "path";

const ROOT = process.cwd();
const STRATEGY_FILE = path.join(ROOT, "strategy.json");
const HISTORY_FILE = path.join(ROOT, "post_history.json");
const REPORTS_FILE = path.join(ROOT, "agent_reports.json");

const MAX_HISTORY = 300;
const MAX_REPORTS = 200;

// ============================================================
// 型定義
// ============================================================

export interface Strategy {
  generation: number; // 学習世代（司令官が更新するたび+1）
  updatedAt: string;
  /** ジャンル名→重み(0.5〜2.0)。商品選定エージェントの選択確率に影響 */
  genreWeights: Record<string, number>;
  /** 投稿タイプ(1=回遊/2=成約/3=送客)→重み */
  postTypeWeights: Record<string, number>;
  /** 価格帯→重み(0.5〜2.0)。高単価枠を含む商品選定の価格戦略 */
  priceBandWeights: Record<string, number>;
  /** フック(書き出しパターン)→重み(0.5〜2.0)。Promotion戦略の学習対象 */
  hookWeights: Record<string, number>;
  /** 司令官が更新する季節先取りキーワード（最大5件、商品検索に使用） */
  seasonalKeywords: string[];
  /** コメントエージェントのプロンプトに注入する勝ちパターン（最大3件） */
  styleHints: string[];
  /** 司令官の直近の分析メモ（次世代の判断材料） */
  commanderNotes: string;
}

/** 価格帯の定義（key: strategy.priceBandWeightsのキー） */
export const PRICE_BANDS: Record<string, { min: number; max: number }> = {
  "1000-3000": { min: 1000, max: 3000 },
  "3000-5000": { min: 3000, max: 5000 },
  "5000-10000": { min: 5000, max: 10000 },
  "10000-30000": { min: 10000, max: 30000 }, // 高単価枠（報酬単価が大きい）
};

/** 価格から所属価格帯キーを返す */
export function priceBandOf(price: number): string {
  for (const [key, r] of Object.entries(PRICE_BANDS)) {
    if (price >= r.min && price < r.max) return key;
  }
  return price < 1000 ? "〜1000" : "30000〜";
}

export interface PostRecord {
  ts: string;
  itemCode: string;
  itemName: string;
  genreName: string;
  price: number;
  postType: number;
  hour: number; // JST時間帯
  hook?: string; // 使用したフック(書き出しパターン)のキー
  captionHead?: string; // 投稿文の冒頭(重複回避・パターン分析用)
  trendKeyword?: string;
  likes?: number; // 計測エージェントが後から更新
  likesUpdatedAt?: string;
}

export interface AgentReport {
  ts: string;
  agent: string; // scout | copywriter | poster | promoter | metrics | analyst | commander
  ok: boolean;
  summary: string;
}

// ============================================================
// 読み書き
// ============================================================

function readJson<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(file, "utf-8")) as T;
  } catch {
    return fallback;
  }
}

function writeJson(file: string, data: unknown): void {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

export function defaultStrategy(): Strategy {
  return {
    generation: 0,
    updatedAt: new Date().toISOString(),
    genreWeights: {},
    postTypeWeights: { "1": 1, "2": 1, "3": 1 },
    // 初期は低価格帯寄り（実績が付いたら司令官が高単価枠を調整）
    priceBandWeights: { "1000-3000": 1.2, "3000-5000": 1.0, "5000-10000": 0.8, "10000-30000": 0.6 },
    hookWeights: {},
    seasonalKeywords: [],
    styleHints: [],
    commanderNotes: "",
  };
}

export function loadStrategy(): Strategy {
  const s = readJson<Partial<Strategy>>(STRATEGY_FILE, {});
  const d = defaultStrategy();
  return {
    generation: s.generation ?? d.generation,
    updatedAt: s.updatedAt ?? d.updatedAt,
    genreWeights: s.genreWeights ?? d.genreWeights,
    postTypeWeights: s.postTypeWeights ?? d.postTypeWeights,
    priceBandWeights: s.priceBandWeights ?? d.priceBandWeights,
    hookWeights: s.hookWeights ?? d.hookWeights,
    seasonalKeywords: (s.seasonalKeywords ?? []).slice(0, 5),
    styleHints: (s.styleHints ?? []).slice(0, 3),
    commanderNotes: s.commanderNotes ?? "",
  };
}

export function saveStrategy(strategy: Strategy): void {
  writeJson(STRATEGY_FILE, strategy);
}

export function loadHistory(): PostRecord[] {
  return readJson<PostRecord[]>(HISTORY_FILE, []);
}

export function saveHistory(history: PostRecord[]): void {
  writeJson(HISTORY_FILE, history.slice(-MAX_HISTORY));
}

export function appendHistory(records: PostRecord[]): void {
  const history = loadHistory();
  history.push(...records);
  saveHistory(history);
}

export function loadReports(): AgentReport[] {
  return readJson<AgentReport[]>(REPORTS_FILE, []);
}

export function report(agent: string, ok: boolean, summary: string): void {
  const reports = loadReports();
  reports.push({ ts: new Date().toISOString(), agent, ok, summary });
  writeJson(REPORTS_FILE, reports.slice(-MAX_REPORTS));
  console.log(`[report] ${ok ? "✅" : "❌"} ${agent}: ${summary}`);
}

// ============================================================
// 共通ユーティリティ
// ============================================================

/** 重み付きランダム選択。weightsに無いキーは重み1として扱う */
export function weightedPick<T>(
  items: T[],
  getKey: (item: T) => string,
  weights: Record<string, number>
): T {
  const ws = items.map((it) => Math.max(weights[getKey(it)] ?? 1, 0.01));
  const total = ws.reduce((a, b) => a + b, 0);
  let r = Math.random() * total;
  for (let i = 0; i < items.length; i++) {
    r -= ws[i]!;
    if (r <= 0) return items[i]!;
  }
  return items[items.length - 1]!;
}

/** 重みを0.5〜2.0にクランプ（暴走防止。司令官の更新は必ずこれを通す） */
export function clampWeights(weights: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(weights)) {
    if (typeof v !== "number" || !isFinite(v)) continue;
    out[k] = Math.min(2.0, Math.max(0.5, v));
  }
  return out;
}
