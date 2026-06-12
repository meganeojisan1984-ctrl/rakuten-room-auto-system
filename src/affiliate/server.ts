/**
 * server.ts - アフィリエイト送客システムの Web サーバー（スマホ/タブレット対応）
 *
 * 案件名を入力 → バックグラウンドで指揮官＋エージェントがキャンペーンを生成 →
 * Googleスプレッドシートの新しいタブへ書き込み。UIは進捗をポーリング表示する。
 *
 * 起動: npx tsx src/affiliate/server.ts  （デフォルト http://localhost:3100 ）
 */
import * as dotenv from "dotenv";
dotenv.config();

import express from "express";
import path from "path";
import { randomUUID } from "crypto";
import { loadOffers, resolveOffer, saveOffer } from "./offers";
import { loadFunnel, saveFunnel } from "./funnel";
import type { FunnelConfig } from "./types";
import { runCampaign } from "./orchestrator";
import { getExistingPosts, isSheetsConfigured, writeCampaign, type WriteResult } from "./sheets";
import { isLlmConfigured } from "./llm";
import type { Offer } from "./types";

const PORT = parseInt(process.env.AFFILIATE_PORT ?? "3100", 10);

// ──────────────────────────────────────────────
// ジョブ管理（インメモリ）
// ──────────────────────────────────────────────
interface Job {
  id: string;
  offer: string;
  status: "running" | "done" | "error";
  progress: { step: string; detail: string; at: string }[];
  result?: WriteResult & { credibility: number; completeness: number; summary: string };
  error?: string;
  startedAt: string;
}

const jobs = new Map<string, Job>();

async function startJob(offerName: string): Promise<string> {
  const id = randomUUID();
  const job: Job = {
    id,
    offer: offerName,
    status: "running",
    progress: [],
    startedAt: new Date().toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" }),
  };
  jobs.set(id, job);

  // 非同期実行
  void (async () => {
    try {
      const offer = resolveOffer(offerName);
      const existingPosts = await getExistingPosts();
      const result = await runCampaign(offer, {
        existingPosts,
        onProgress: (step, detail) => {
          job.progress.push({
            step,
            detail: detail ?? "",
            at: new Date().toLocaleTimeString("ja-JP", { timeZone: "Asia/Tokyo" }),
          });
        },
      });
      const dest = await writeCampaign(result);
      job.result = {
        ...dest,
        credibility: result.overallCredibility,
        completeness: result.overallCompleteness,
        summary: result.commanderSummary,
      };
      job.status = "done";
    } catch (err) {
      job.error = String(err);
      job.status = "error";
      console.error(`[affiliate-server] ジョブ失敗 (${offerName}):`, err);
    }
  })();

  return id;
}

// ──────────────────────────────────────────────
// Express
// ──────────────────────────────────────────────
export function createAffiliateApp(): express.Application {
  const app = express();
  app.use(express.json());
  app.use(express.static(path.join(process.cwd(), "public", "affiliate")));

  // システム状態
  app.get("/api/affiliate/health", (_req, res) => {
    res.json({
      llm: isLlmConfigured(),
      sheets: isSheetsConfigured(),
      time: new Date().toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" }),
    });
  });

  // 誘導先(CTA)設定
  app.get("/api/affiliate/funnel", (_req, res) => {
    res.json(loadFunnel());
  });
  app.post("/api/affiliate/funnel", (req, res) => {
    const cur = loadFunnel();
    const body = req.body as Partial<FunnelConfig>;
    const merged: FunnelConfig = { ...cur, ...body };
    saveFunnel(merged);
    res.json(merged);
  });

  // 案件一覧
  app.get("/api/affiliate/offers", (_req, res) => {
    res.json(loadOffers());
  });

  // 案件の保存/更新
  app.post("/api/affiliate/offers", (req, res) => {
    const body = req.body as Partial<Offer> & { name?: string };
    if (!body.name && !body.id) {
      res.status(400).json({ error: "name または id が必要です" });
      return;
    }
    const base = resolveOffer(body.id || body.name!);
    const merged: Offer = { ...base, ...body, id: base.id, name: body.name || base.name };
    saveOffer(merged);
    res.json(merged);
  });

  // キャンペーン生成開始
  app.post("/api/affiliate/run", async (req, res) => {
    const offerName = String((req.body as { offer?: string }).offer ?? "").trim();
    if (!offerName) {
      res.status(400).json({ error: "offer（案件名）が必要です" });
      return;
    }
    const id = await startJob(offerName);
    res.json({ jobId: id });
  });

  // ジョブ状況
  app.get("/api/affiliate/jobs/:id", (req, res) => {
    const job = jobs.get(req.params["id"] ?? "");
    if (!job) {
      res.status(404).json({ error: "ジョブが見つかりません" });
      return;
    }
    res.json(job);
  });

  return app;
}

// 直接起動された場合
if (require.main === module) {
  const app = createAffiliateApp();
  app.listen(PORT, () => {
    console.log(`\n✅ アフィリエイト送客システム 起動: http://localhost:${PORT}`);
    console.log(`   LLM(Groq): ${isLlmConfigured() ? "✓" : "✗ 未設定"} / Sheets: ${isSheetsConfigured() ? "✓" : "✗ 未設定(ローカル出力)"}\n`);
  });
}
