/**
 * analyst-agent.ts - 分析エージェント
 *
 * post_history.json（いいね実績付き）を集計し、
 * 「どのジャンル・投稿タイプ・時間帯が伸びているか」を司令官に渡す形に整形する。
 * Phase 3: 追加で data/sales.sqlite を JOIN し、実売スコアも算出する。
 */
import { loadHistory, loadReports, report, priceBandOf, type AgentReport } from "./store";
import { initDb, getSalesByDateRange, type SalesRow } from "../affiliate/sales-db";
import {
  aggregateSlotSales,
  aggregateGenreSales,
  aggregatePriceBandSales,
  type SlotSalesAggregate,
  type KeyedSalesAggregate,
} from "./sales-aggregator";

export interface Aggregate {
  key: string;
  posts: number;
  measured: number; // いいね計測済み件数
  avgLikes: number;
}

export interface AnalysisResult {
  totalPosts: number;
  measuredPosts: number;
  byGenre: Aggregate[];
  byPostType: Aggregate[];
  byHour: Aggregate[];
  byPriceBand: Aggregate[];
  byHook: Aggregate[];
  topPosts: Array<{ itemName: string; likes: number; genreName: string; postType: number }>;
  agentHealth: Array<{ agent: string; runs: number; failures: number; lastError: string }>;
  // Phase 3: 実売集計
  salesDataAvailable: boolean;
  salesWindowDays: number;
  salesTotalReward: number;
  salesTotalClicks: number;
  slotSales: SlotSalesAggregate[];
  genreSales: KeyedSalesAggregate[];
  priceBandSales: KeyedSalesAggregate[];
}

function aggregate(records: Array<{ key: string; likes?: number }>): Aggregate[] {
  const map = new Map<string, { posts: number; measured: number; totalLikes: number }>();
  for (const r of records) {
    const e = map.get(r.key) ?? { posts: 0, measured: 0, totalLikes: 0 };
    e.posts++;
    if (r.likes !== undefined) {
      e.measured++;
      e.totalLikes += r.likes;
    }
    map.set(r.key, e);
  }
  return [...map.entries()]
    .map(([key, e]) => ({
      key,
      posts: e.posts,
      measured: e.measured,
      avgLikes: e.measured > 0 ? +(e.totalLikes / e.measured).toFixed(2) : 0,
    }))
    .sort((a, b) => b.avgLikes - a.avgLikes);
}

/** 直近報告からエージェントごとの健康状態を集計（司令官の監視材料） */
function healthCheck(reports: AgentReport[]): AnalysisResult["agentHealth"] {
  const recent = reports.slice(-100);
  const map = new Map<string, { runs: number; failures: number; lastError: string }>();
  for (const r of recent) {
    const e = map.get(r.agent) ?? { runs: 0, failures: 0, lastError: "" };
    e.runs++;
    if (!r.ok) {
      e.failures++;
      e.lastError = r.summary;
    }
    map.set(r.agent, e);
  }
  return [...map.entries()].map(([agent, e]) => ({ agent, ...e }));
}

export function runAnalystAgent(): AnalysisResult {
  const history = loadHistory();
  const measured = history.filter((h) => h.likes !== undefined);

  // Phase 3: 直近 salesWindowDays の実売を集計
  const salesWindowDays = 14;
  const to = new Date();
  const from = new Date(to.getTime() - salesWindowDays * 24 * 60 * 60 * 1000);
  const fmt = (d: Date): string => d.toISOString().slice(0, 10);

  let sales: SalesRow[] = [];
  try {
    const db = initDb();
    sales = getSalesByDateRange(db, fmt(from), fmt(to));
    db.close();
  } catch (err) {
    console.warn("[analyst] sales-db 読込失敗、実売集計をスキップ:", String(err).slice(0, 150));
  }
  const salesTotalReward = sales.reduce((a, s) => a + s.reward, 0);
  const salesTotalClicks = sales.reduce((a, s) => a + s.clicks, 0);
  const salesDataAvailable = sales.length >= 3;

  const slotSales = aggregateSlotSales(history, sales);
  const genreSales = aggregateGenreSales(history, sales);
  const priceBandSales = aggregatePriceBandSales(history, sales);

  const result: AnalysisResult = {
    totalPosts: history.length,
    measuredPosts: measured.length,
    byGenre: aggregate(history.map((h) => ({ key: h.genreName || "不明", likes: h.likes }))),
    byPostType: aggregate(history.map((h) => ({ key: String(h.postType), likes: h.likes }))),
    byHour: aggregate(history.map((h) => ({ key: `${h.hour}時`, likes: h.likes }))),
    byPriceBand: aggregate(history.map((h) => ({ key: priceBandOf(h.price), likes: h.likes }))),
    byHook: aggregate(history.map((h) => ({ key: h.hook ?? "未記録", likes: h.likes }))),
    topPosts: measured
      .sort((a, b) => (b.likes ?? 0) - (a.likes ?? 0))
      .slice(0, 5)
      .map((h) => ({
        itemName: h.itemName.slice(0, 40),
        likes: h.likes ?? 0,
        genreName: h.genreName,
        postType: h.postType,
      })),
    agentHealth: healthCheck(loadReports()),
    salesDataAvailable,
    salesWindowDays,
    salesTotalReward,
    salesTotalClicks,
    slotSales,
    genreSales,
    priceBandSales,
  };

  report(
    "analyst",
    true,
    `履歴${result.totalPosts}件(計測済${result.measuredPosts}) 実売${sales.length}件(¥${salesTotalReward}) mode=${salesDataAvailable ? "sales" : "likes"}`,
  );
  return result;
}
