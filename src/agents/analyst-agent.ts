/**
 * analyst-agent.ts - 分析エージェント
 *
 * post_history.json（いいね実績付き）を集計し、
 * 「どのジャンル・投稿タイプ・時間帯が伸びているか」を司令官に渡す形に整形する。
 */
import { loadHistory, loadReports, report, type AgentReport } from "./store";

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
  topPosts: Array<{ itemName: string; likes: number; genreName: string; postType: number }>;
  agentHealth: Array<{ agent: string; runs: number; failures: number; lastError: string }>;
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

  const result: AnalysisResult = {
    totalPosts: history.length,
    measuredPosts: measured.length,
    byGenre: aggregate(history.map((h) => ({ key: h.genreName || "不明", likes: h.likes }))),
    byPostType: aggregate(history.map((h) => ({ key: String(h.postType), likes: h.likes }))),
    byHour: aggregate(history.map((h) => ({ key: `${h.hour}時`, likes: h.likes }))),
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
  };

  report(
    "analyst",
    true,
    `履歴${result.totalPosts}件(計測済${result.measuredPosts})を集計。ジャンル${result.byGenre.length}種`
  );
  return result;
}
