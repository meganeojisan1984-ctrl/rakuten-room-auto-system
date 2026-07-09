/**
 * commander.ts - 司令官エージェント
 *
 * 役割:
 * 1. 監視: 各エージェントの実行報告を点検し、機能不全（連続失敗・Cookie切れ等）を検知して警告
 * 2. 学習: 分析エージェントの集計をもとに戦略（ジャンル重み・投稿タイプ重み・文体ヒント）を更新
 * 3. 報告: 世代・調整内容・部隊の健康状態をDiscordへデイリーレポート
 *
 * 戦略更新はLLM(Groq)が提案し、必ずclampWeights(0.5〜2.0)を通して暴走を防ぐ。
 * LLMが失敗した場合はルールベースの調整（実績上位ジャンルを+20%）にフォールバックする。
 */
import Groq from "groq-sdk";
import {
  loadStrategy,
  saveStrategy,
  clampWeights,
  report,
  type Strategy,
} from "./store";
import type { AnalysisResult } from "./analyst-agent";
import { notifyError, notifyReport } from "../notifiers";

const MODEL_NAME = "llama-3.3-70b-versatile";

// ============================================================
// 1. 監視（ルールベース: LLMに任せず確実に検知する）
// ============================================================

export interface HealthAlert {
  agent: string;
  message: string;
}

export function inspectAgents(analysis: AnalysisResult): HealthAlert[] {
  const alerts: HealthAlert[] = [];
  for (const h of analysis.agentHealth) {
    const failRate = h.runs > 0 ? h.failures / h.runs : 0;
    if (h.runs >= 3 && failRate >= 0.5) {
      alerts.push({
        agent: h.agent,
        message: `失敗率${Math.round(failRate * 100)}% (${h.failures}/${h.runs}回)。直近エラー: ${h.lastError}`,
      });
    }
    if (h.lastError.includes("Cookie") || h.lastError.includes("ログイン要求")) {
      alerts.push({ agent: h.agent, message: "Cookie期限切れの兆候。ROOM_COOKIEの更新が必要" });
    }
  }
  if (analysis.totalPosts >= 10 && analysis.measuredPosts === 0) {
    alerts.push({
      agent: "metrics",
      message: "投稿はあるのに、いいね計測が0件。計測エージェントが機能していない可能性",
    });
  }
  return alerts;
}

// ============================================================
// 2. 学習（LLM提案 → クランプ → フォールバック）
// ============================================================

function buildCommanderPrompt(strategy: Strategy, analysis: AnalysisResult): string {
  return `あなたは楽天ROOMアフィリエイト自動化部隊の司令官です。以下の実績データを分析し、次世代の戦略を決定してください。

【現在の戦略 (第${strategy.generation}世代)】
${JSON.stringify({ genreWeights: strategy.genreWeights, postTypeWeights: strategy.postTypeWeights, styleHints: strategy.styleHints }, null, 1)}
前世代のメモ: ${strategy.commanderNotes || "なし"}

【実績集計】
- 総投稿: ${analysis.totalPosts}件 / いいね計測済み: ${analysis.measuredPosts}件
- ジャンル別平均いいね: ${JSON.stringify(analysis.byGenre.slice(0, 8))}
- 投稿タイプ別 (1=回遊/2=成約/3=送客): ${JSON.stringify(analysis.byPostType)}
- 時間帯別: ${JSON.stringify(analysis.byHour.slice(0, 6))}
- トップ投稿: ${JSON.stringify(analysis.topPosts)}

【指示】
1. genreWeights: 平均いいねが高いジャンルの重みを上げ、低いジャンルを下げる（0.5〜2.0、計測済み3件未満のジャンルは大きく動かさない）
2. postTypeWeights: 同様に調整（0.5〜2.0）
3. styleHints: トップ投稿の共通パターンから、コメント生成AIへの具体的な指示を最大3つ（各60文字以内、日本語）。データ不足なら空配列
4. notes: 今回の判断理由を200文字以内で

以下のJSONのみを出力（説明・マークダウン不要）:
{"genreWeights":{...},"postTypeWeights":{"1":1.0,"2":1.0,"3":1.0},"styleHints":[],"notes":"..."}`;
}

interface CommanderDecision {
  genreWeights: Record<string, number>;
  postTypeWeights: Record<string, number>;
  styleHints: string[];
  notes: string;
}

async function askLlm(strategy: Strategy, analysis: AnalysisResult): Promise<CommanderDecision> {
  const apiKey = process.env.GROQ_API_KEY ?? "";
  if (!apiKey) throw new Error("GROQ_API_KEY未設定");
  const client = new Groq({ apiKey });
  const completion = await client.chat.completions.create({
    model: MODEL_NAME,
    messages: [{ role: "user", content: buildCommanderPrompt(strategy, analysis) }],
    max_tokens: 1024,
    temperature: 0.3,
  });
  const text = completion.choices[0]?.message?.content ?? "";
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error("司令官LLMの応答からJSONを抽出できず");
  const parsed = JSON.parse(jsonMatch[0]) as Partial<CommanderDecision>;
  return {
    genreWeights: parsed.genreWeights ?? {},
    postTypeWeights: parsed.postTypeWeights ?? {},
    styleHints: (parsed.styleHints ?? []).filter((s) => typeof s === "string").map((s) => s.slice(0, 60)).slice(0, 3),
    notes: (parsed.notes ?? "").slice(0, 300),
  };
}

/** LLM不通時のルールベース調整: 実績1位ジャンル+20%、最下位-10%、他は1.0へ緩やかに回帰 */
function heuristicDecision(strategy: Strategy, analysis: AnalysisResult): CommanderDecision {
  const genreWeights = { ...strategy.genreWeights };
  const measured = analysis.byGenre.filter((g) => g.measured >= 3);
  for (const key of Object.keys(genreWeights)) {
    genreWeights[key] = 1 + (genreWeights[key]! - 1) * 0.8; // 1.0へ回帰
  }
  if (measured.length >= 2) {
    const top = measured[0]!;
    const bottom = measured[measured.length - 1]!;
    genreWeights[top.key] = (genreWeights[top.key] ?? 1) * 1.2;
    genreWeights[bottom.key] = (genreWeights[bottom.key] ?? 1) * 0.9;
  }
  return {
    genreWeights,
    postTypeWeights: strategy.postTypeWeights,
    styleHints: strategy.styleHints,
    notes: "LLM不通のためルールベース調整（上位ジャンル+20%・最下位-10%・平均回帰）",
  };
}

// ============================================================
// 3. 実行 & 報告
// ============================================================

export async function runCommander(analysis: AnalysisResult): Promise<Strategy> {
  const strategy = loadStrategy();

  // 監視
  const alerts = inspectAgents(analysis);
  for (const a of alerts) {
    await notifyError(`司令官警告: ${a.agent}エージェント異常`, a.message);
  }

  // 学習
  let decision: CommanderDecision;
  let usedLlm = true;
  try {
    decision = await askLlm(strategy, analysis);
  } catch (err) {
    console.warn("[commander] LLM判断失敗、ルールベースへ:", String(err).slice(0, 150));
    decision = heuristicDecision(strategy, analysis);
    usedLlm = false;
  }

  const next: Strategy = {
    generation: strategy.generation + 1,
    updatedAt: new Date().toISOString(),
    genreWeights: clampWeights({ ...strategy.genreWeights, ...decision.genreWeights }),
    postTypeWeights: clampWeights({ ...strategy.postTypeWeights, ...decision.postTypeWeights }),
    styleHints: decision.styleHints,
    commanderNotes: decision.notes,
  };
  saveStrategy(next);

  // 報告
  const weightsSummary = Object.entries(next.genreWeights)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([k, v]) => `${k}: ${v.toFixed(2)}`)
    .join(" / ");
  const healthSummary = analysis.agentHealth
    .map((h) => `${h.failures > 0 ? "⚠️" : "✅"} ${h.agent}: ${h.runs - h.failures}/${h.runs}成功`)
    .join("\n");

  await notifyReport(
    `🎖 司令官デイリーレポート (第${next.generation}世代)`,
    [
      `**実績**: 投稿${analysis.totalPosts}件 / 計測済${analysis.measuredPosts}件`,
      `**ジャンル重み上位**: ${weightsSummary || "初期値"}`,
      `**投稿タイプ重み**: ${JSON.stringify(next.postTypeWeights)}`,
      `**文体ヒント**: ${next.styleHints.join(" | ") || "なし"}`,
      `**判断** (${usedLlm ? "LLM" : "ルールベース"}): ${next.commanderNotes}`,
      `**部隊状況**:\n${healthSummary || "報告なし"}`,
      alerts.length > 0 ? `**🚨 警告${alerts.length}件** (個別通知済み)` : "",
    ]
      .filter(Boolean)
      .join("\n")
  );

  report("commander", true, `第${next.generation}世代へ更新 (${usedLlm ? "LLM" : "ルールベース"})、警告${alerts.length}件`);
  return next;
}
