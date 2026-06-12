/**
 * run.ts - キャンペーン生成のCLIエントリポイント
 *
 * 使い方:
 *   AFFILIATE_OFFER="AI学習スクール" npx tsx src/affiliate/run.ts
 *   npx tsx src/affiliate/run.ts "AI学習スクール"
 *
 * GitHub Actions の workflow_dispatch から案件名を渡して実行できる。
 * 結果は案件ごとの新しいタブとしてGoogleスプレッドシートへ書き込まれる。
 */
import * as dotenv from "dotenv";
dotenv.config();

import fs from "fs";
import path from "path";
import { resolveOffer } from "./offers";
import { runCampaign } from "./orchestrator";
import { getExistingPosts, writeCampaign, isSheetsConfigured } from "./sheets";
import { isLlmConfigured } from "./llm";

async function main(): Promise<void> {
  const offerName = process.argv[2] || process.env.AFFILIATE_OFFER || "";
  if (!offerName) {
    console.error("案件名を指定してください。例: npx tsx src/affiliate/run.ts \"AI学習スクール\"");
    process.exit(1);
  }

  if (!isLlmConfigured()) {
    console.warn("⚠️ GROQ_API_KEY 未設定。生成品質が大きく低下します（フォールバック動作）。");
  }
  if (!isSheetsConfigured()) {
    console.warn("⚠️ Googleスプレッドシート未設定。data/affiliate/output/ にローカル出力します。");
  }

  const offer = resolveOffer(offerName);
  console.log(`=== キャンペーン生成開始: ${offer.name} (${offer.id}) ===`);

  const existingPosts = await getExistingPosts();
  console.log(`[run] 既出投稿 ${existingPosts.length} 件を重複回避対象として読込`);

  const result = await runCampaign(offer, {
    existingPosts,
    onProgress: (step, detail) => console.log(`  [${step}] ${detail ?? ""}`),
  });

  const dest = await writeCampaign(result);
  console.log(`\n✅ 完了: ${dest.destination === "google-sheets" ? `タブ「${dest.tab}」に書き込みました` : `ローカル出力 ${dest.localPath}`}`);
  console.log(`   指揮官 総合評価: 信憑性 ${result.overallCredibility} / 完成度 ${result.overallCompleteness}`);
  if (dest.reportPath) console.log(`   Markdownレポート: ${path.relative(process.cwd(), dest.reportPath)}`);
  if (dest.url) console.log(`   スプレッドシート: ${dest.url}`);

  // GitHub Actions（Issueトリガー）がコメント投稿に使うサマリを書き出す
  const summary = {
    offer: offer.name,
    report: dest.reportPath ? path.relative(process.cwd(), dest.reportPath) : "",
    credibility: result.overallCredibility,
    completeness: result.overallCompleteness,
    summary: result.commanderSummary,
    sheetUrl: dest.url ?? "",
  };
  const dir = path.join(process.cwd(), "reports", "affiliate");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "_last.json"), JSON.stringify(summary, null, 2), "utf-8");
}

main().catch((err) => {
  console.error("致命的エラー:", err);
  process.exit(1);
});
