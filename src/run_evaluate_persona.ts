import * as dotenv from "dotenv";
dotenv.config();
import { loadPersona, savePersona } from "./persona/persona";
import { evaluatePersona } from "./persona/evaluator";
import { loadHistory } from "./agents/store";
import { initDb, getSalesByDateRange } from "./affiliate/sales-db";
import { notifyReport, notifyError } from "./notifiers";

async function main(): Promise<void> {
  console.log("=== evaluator: ペルソナ勝者判定 開始 ===");
  const persona = loadPersona();
  const now = new Date();

  const to = now;
  const from = new Date(now.getTime() - persona.evaluationWindow * 24 * 60 * 60 * 1000);
  const fmt = (d: Date): string => d.toISOString().slice(0, 10);
  const db = initDb();
  const sales = getSalesByDateRange(db, fmt(from), fmt(to));
  db.close();

  const history = loadHistory();
  const result = evaluatePersona(history, sales, persona, now);
  console.log("[evaluator] verdict:", result.verdict, "|", result.summary);

  if (result.verdict === "winner-decided" && result.winnerSlot) {
    const next = { ...persona, activeSlot: result.winnerSlot };
    savePersona(next);
    console.log(`[evaluator] persona.activeSlot -> ${result.winnerSlot}`);
    await notifyReport(
      `🏆 勝者ペルソナ確定 (${result.winnerSlot})`,
      [
        result.summary,
        `**slot別実売**: ${result.slotAggregates.map((s) => `${s.slot}: score=${s.salesScore.toFixed(0)} reward=¥${s.totalReward} orders=${s.matchedSales}`).join("\n")}`,
        `以降 ${result.winnerSlot} に投稿を集中させます (persona.activeSlot 更新済)`,
      ].join("\n"),
    );
  } else if (result.verdict === "stop-loss") {
    await notifyReport(
      `🚨 全ペルソナ stop-loss 発動`,
      [
        result.summary,
        `**slot別実売**: ${result.slotAggregates.map((s) => `${s.slot}: reward=¥${s.totalReward}`).join("\n")}`,
        `\`src/persona/persona.json\` の 3 slot を差し替えるか、activeSlot を手動で指定してください。activeSlot 未変更のまま multi 継続します`,
      ].join("\n"),
    );
  } else if (result.verdict === "keep-multi") {
    await notifyReport(
      `⚖️ 勝者未確定 (multi モード継続)`,
      [
        result.summary,
        `**slot別実売**: ${result.slotAggregates.map((s) => `${s.slot}: score=${s.salesScore.toFixed(0)} reward=¥${s.totalReward}`).join("\n")}`,
        `次回評価まで multi モードで観察を継続します`,
      ].join("\n"),
    );
  } else if (result.verdict === "not-yet") {
    console.log(`[evaluator] 評価窓未経過（あと${result.daysRemaining}日）。通知はスキップ`);
  } else if (result.verdict === "already-decided") {
    console.log("[evaluator] activeSlot 確定済み。何もしない");
  }

  console.log("=== evaluator: 完了 ===");
}

main().catch(async (err: unknown) => {
  console.error("[evaluator] fatal:", err);
  await notifyError("evaluator 実行失敗", String(err).slice(0, 500));
  process.exit(1);
});
