/**
 * run_learn.ts - 自己学習ループ実行（GitHub Actionsで毎晩実行）
 *
 * 計測エージェント → 分析エージェント → 司令官 の順に実行し、
 * strategy.json を次世代へ更新する。翌日の投稿エージェント群はこの戦略を読んで動く。
 */
import * as dotenv from "dotenv";
dotenv.config();

import { runMetricsAgent } from "./agents/metrics-agent";
import { runAnalystAgent } from "./agents/analyst-agent";
import { runCommander } from "./agents/commander";
import { notifyError } from "./notifiers";

async function main(): Promise<void> {
  console.log("=== 自己学習ループ 開始 ===");
  console.log(`実行時刻: ${new Date().toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })}\n`);

  // [1/3] 計測: 自ROOMのいいね数を収集して履歴に反映
  console.log("--- [1/3] 計測エージェント ---");
  const headless = process.env.CI === "true" || process.env.HEADLESS !== "false";
  await runMetricsAgent(headless);

  // [2/3] 分析: ジャンル・投稿タイプ・時間帯別に集計
  console.log("\n--- [2/3] 分析エージェント ---");
  const analysis = runAnalystAgent();

  // [3/3] 司令官: 監視・戦略更新・レポート
  console.log("\n--- [3/3] 司令官 ---");
  const strategy = await runCommander(analysis);

  console.log(`\n=== 自己学習ループ 完了: 第${strategy.generation}世代 ===`);
}

main().catch(async (err) => {
  console.error("学習ループ致命的エラー:", err);
  await notifyError("自己学習ループ失敗", String(err).slice(0, 500));
  process.exit(1);
});
