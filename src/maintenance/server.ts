/**
 * maintenance/server.ts - メンテナンス司令部アプリ（ローカル専用）
 *
 * 通常運用は完全自動。このアプリは「見る・伝える・直す」ためだけの司令部:
 * - ペット(司令官・分析官)の表情でシステムの健康状態が一目でわかる
 * - 売上レポート登録 → 司令官の最重要学習シグナルとして戦略に反映
 * - 司令官との対話 → 質問への回答・指示がクラウドの次回学習で使われる
 * - ROOM Cookie更新・ワークフロー手動実行などのメンテナンス
 *
 * アプリで行った操作はすべて Git コミット(クラウドへ反映) + Discord通知(報告)される。
 */
import * as dotenv from "dotenv";
dotenv.config();

import express from "express";
import * as fs from "fs";
import * as path from "path";
import { execFileSync, spawnSync } from "child_process";
import {
  loadStrategy,
  loadHistory,
  loadReports,
  loadDialogue,
  appendDialogue,
  loadSalesReports,
  appendSalesReport,
  report,
  PRICE_BANDS,
  priceBandOf,
} from "../agents/store";
import { HOOK_PATTERNS } from "../generator";
import { notifyReport } from "../notifiers";
import { planSreRepairs, summarizeSreRepair, type SreAction, type SreExecutionResult } from "../agents/sre-agent";
import { scrapeAffiliateReport } from "../affiliate/sales-scraper";
import { buildRolePetImageMap } from "./pet-images";

const PORT = 3210;
const ROOT = process.cwd();
const REPO = "meganeojisan1984-ctrl/rakuten-room-auto-system";
const GH_CANDIDATES = ["C:\\Program Files\\GitHub CLI\\gh.exe", "gh"];
const PET_SOURCE_DIR = "C:\\Users\\megan\\OneDrive\\画像\\ペット用画像フォルダ";
const GENERATED_PET_DIR = path.join(ROOT, "public-maintenance", "pet-owner", "generated");

// ============================================================
// git / gh ヘルパー
// ============================================================

function ghPath(): string {
  for (const p of GH_CANDIDATES) {
    try {
      execFileSync(p, ["--version"], { stdio: "pipe" });
      return p;
    } catch {
      /* try next */
    }
  }
  throw new Error("gh CLI が見つかりません");
}

function ghToken(): string {
  const r = spawnSync("git", ["credential", "fill"], {
    input: "protocol=https\nhost=github.com\n\n",
    encoding: "utf-8",
  });
  const m = r.stdout.match(/^password=(.+)$/m);
  if (!m) throw new Error("git credential からトークンを取得できません");
  return m[1]!.trim();
}

function gh(args: string[], input?: string): string {
  return execFileSync(ghPath(), args, {
    input,
    encoding: "utf-8",
    env: { ...process.env, GH_TOKEN: ghToken() },
  });
}

function git(args: string[]): string {
  return execFileSync("git", args, { cwd: ROOT, encoding: "utf-8" });
}

/** クラウド側の最新状態を取り込む（失敗しても続行） */
function gitSync(): void {
  try {
    git(["pull", "--rebase", "--autostash", "-q", "origin", "main"]);
  } catch (e) {
    console.warn("[app] git pull 失敗（続行）:", String(e).slice(0, 120));
  }
}

/** アプリでの操作をコミット&プッシュしてクラウドの学習ループへ反映 */
function gitCommitPush(files: string[], message: string): void {
  git(["add", ...files]);
  try {
    git(["commit", "-q", "-m", `${message} [skip ci]`]);
  } catch {
    return; // 変更なし
  }
  try {
    git(["push", "-q", "origin", "main"]);
  } catch {
    gitSync();
    git(["push", "-q", "origin", "main"]);
  }
}

// ============================================================
// 状態の計算
// ============================================================

interface WorkflowStatus {
  name: string;
  conclusion: string;
  updatedAt: string;
}

function recentWorkflows(): WorkflowStatus[] {
  try {
    const out = gh([
      "run", "list", "-R", REPO, "-L", "15",
      "--json", "workflowName,conclusion,status,updatedAt",
    ]);
    const runs = JSON.parse(out) as Array<{ workflowName: string; conclusion: string; status: string; updatedAt: string }>;
    const latest = new Map<string, WorkflowStatus>();
    for (const r of runs) {
      if (!latest.has(r.workflowName)) {
        latest.set(r.workflowName, {
          name: r.workflowName,
          conclusion: r.status === "completed" ? r.conclusion : r.status,
          updatedAt: r.updatedAt,
        });
      }
    }
    return [...latest.values()];
  } catch (e) {
    console.warn("[app] gh run list 失敗:", String(e).slice(0, 120));
    return [];
  }
}

function petImageMap(): Record<string, Record<string, string>> {
  return buildRolePetImageMap({
    commander: fs.existsSync(path.join(GENERATED_PET_DIR, "commander_single.png")) ? "commander_single.png" : undefined,
    analyst: fs.existsSync(path.join(GENERATED_PET_DIR, "analyst_single.png")) ? "analyst_single.png" : undefined,
  });
}

async function executeSreAction(action: SreAction): Promise<SreExecutionResult> {
  try {
    if (action.type === "run-workflow") {
      const file = ALLOWED_WORKFLOWS[action.workflowKey];
      gh(["workflow", "run", file, "-R", REPO]);
      return { action: `${file} rerun`, ok: true };
    }
    if (action.type === "scrape-sales") {
      const result = await scrapeAffiliateReport({ headless: false, slowMoMs: 120 });
      return {
        action: `sales scrape ${result.date}`,
        ok: result.ok,
        error: result.ok ? undefined : result.error,
      };
    }
    return { action: action.reason, ok: false, error: "owner action required" };
  } catch (err) {
    return { action: action.reason, ok: false, error: String(err).slice(0, 180) };
  }
}

function agentHealth() {
  const recent = loadReports().slice(-100);
  const byAgent = new Map<string, typeof recent>();
  for (const r of recent) {
    if (!byAgent.has(r.agent)) byAgent.set(r.agent, []);
    byAgent.get(r.agent)!.push(r);
  }
  return [...byAgent.entries()].map(([agent, reports]) => {
    const failures = reports.filter((r) => !r.ok);
    // 直近からの連続失敗数（過去の失敗を引きずらない指標）
    let failStreak = 0;
    for (let i = reports.length - 1; i >= 0 && !reports[i]!.ok; i--) failStreak++;
    return {
      agent,
      runs: reports.length,
      failures: failures.length,
      failStreak,
      lastOk: reports[reports.length - 1]?.ok ?? true,
      lastError: failures[failures.length - 1]?.summary ?? "",
      lastTs: reports[reports.length - 1]?.ts ?? "",
    };
  });
}

/** ペットの状態決定: 表情でシステムの健康がわかる */
function petStates(health: ReturnType<typeof agentHealth>, pendingQuestion: boolean, workflows: WorkflowStatus[]) {
  const now = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;
  // 「いま」失敗しているエージェントのみ問題視する（直近2連続失敗以上）
  const failedAgents = health.filter((h) => h.failStreak >= 2);
  const cookieTrouble = health.some((h) => !h.lastOk && h.lastError.includes("Cookie"));
  const learn = workflows.find((w) => w.name.includes("学習"));
  const post = workflows.find((w) => w.name.includes("自動投稿"));

  // 司令官: 対話待ち>異常>学習成功>通常
  let commander: { pose: string; message: string };
  if (pendingQuestion) {
    commander = { pose: "think", message: "オーナーに聞きたいことがあります!下の対話欄を見てください💬" };
  } else if (cookieTrouble) {
    commander = { pose: "alert", message: "ROOM Cookieが切れています!メンテナンス欄から更新してください🚨" };
  } else if (failedAgents.length > 0) {
    commander = { pose: "sad", message: `${failedAgents.map((f) => f.agent).join("・")}エージェントの調子が悪いです…` };
  } else if (learn && learn.conclusion === "success" && now - new Date(learn.updatedAt).getTime() < dayMs) {
    commander = { pose: "joy", message: "昨晩の学習完了!戦略は最新です✨" };
  } else {
    commander = { pose: "hello", message: "異常なし!部隊は自動運用中です" };
  }

  // 分析官: 投稿成功>データ収集中>異常
  let analyst: { pose: string; message: string };
  const metricsBad = health.find((h) => h.agent === "metrics" && h.failStreak >= 2);
  if (metricsBad) {
    analyst = { pose: "sad", message: "いいね計測が失敗続き…ROOMのUI変更かも。Claudeに相談してください" };
  } else if (post && post.conclusion === "success" && now - new Date(post.updatedAt).getTime() < 6 * 60 * 60 * 1000) {
    analyst = { pose: "work", message: "直近の投稿成功!データ収集中です📊" };
  } else if (post && post.conclusion !== "success") {
    analyst = { pose: "alert", message: "直近の投稿ワークフローが失敗しています。ログを確認!" };
  } else {
    analyst = { pose: "hello", message: "実績データを見守っています" };
  }

  return { commander, analyst };
}

/** 学習進捗: フック・価格帯ごとの計測数と統計的に見えてくるまでの目安 */
function learningProgress() {
  const history = loadHistory();
  const measured = history.filter((h) => h.likes !== undefined);
  const TARGET_PER_KEY = 3;

  const hookKeys = Object.keys(HOOK_PATTERNS);
  const hooks = hookKeys.map((k) => ({
    key: k,
    measured: measured.filter((h) => h.hook === k).length,
    target: TARGET_PER_KEY,
  }));
  const bands = Object.keys(PRICE_BANDS).map((k) => ({
    key: k,
    measured: measured.filter((h) => priceBandOf(h.price) === k).length,
    target: TARGET_PER_KEY,
  }));
  const done = [...hooks, ...bands].reduce((a, x) => a + Math.min(x.measured, x.target), 0);
  const total = (hooks.length + bands.length) * TARGET_PER_KEY;
  return {
    totalPosts: history.length,
    measuredPosts: measured.length,
    hooks,
    bands,
    progressPercent: Math.round((done / total) * 100),
  };
}

// ============================================================
// Express アプリ
// ============================================================

const app = express();
app.use(express.json({ limit: "2mb" }));
app.use(express.static(path.join(ROOT, "public-maintenance")));
if (fs.existsSync(PET_SOURCE_DIR)) {
  app.use("/pet-owner", express.static(PET_SOURCE_DIR));
}
app.use("/pet-owner/generated", express.static(GENERATED_PET_DIR));

app.get("/api/ping", (_req, res) => res.json({ ok: true }));

app.get("/api/status", (_req, res) => {
  try {
    gitSync();
    const strategy = loadStrategy();
    const dialogue = loadDialogue().slice(-12);
    // 未回答の質問: 最後の司令官メッセージの後にユーザー返信がない場合
    const lastCommanderIdx = dialogue.map((d) => d.from).lastIndexOf("commander");
    const lastUserIdx = dialogue.map((d) => d.from).lastIndexOf("user");
    const pendingQuestion = lastCommanderIdx >= 0 && lastCommanderIdx > lastUserIdx;

    const health = agentHealth();
    const workflows = recentWorkflows();
    const srePlan = planSreRepairs({ workflows, health });
    res.json({
      strategy: {
        generation: strategy.generation,
        updatedAt: strategy.updatedAt,
        seasonalKeywords: strategy.seasonalKeywords,
        priceBandWeights: strategy.priceBandWeights,
        hookWeights: strategy.hookWeights,
        commanderNotes: strategy.commanderNotes,
      },
      progress: learningProgress(),
      health,
      workflows,
      dialogue,
      pendingQuestion,
      salesReports: loadSalesReports().slice(-5),
      pets: petStates(health, pendingQuestion, workflows),
      petImages: petImageMap(),
      srePlan,
      recentReports: loadReports().slice(-15).reverse(),
    });
  } catch (err) {
    res.status(500).json({ error: String(err).slice(0, 300) });
  }
});

app.post("/api/autofix", async (req, res) => {
  try {
    const { safeOnly } = (req.body ?? {}) as { safeOnly?: boolean };
    const health = agentHealth();
    const workflows = recentWorkflows();
    const plan = planSreRepairs({ workflows, health });
    const actions = safeOnly
      ? plan.actions.filter((a) => a.type === "run-workflow")
      : plan.actions;
    if (actions.length === 0) {
      return res.json({ ok: true, plan, results: [], summary: "修復不要、または安全に自動実行できるアクションなし" });
    }
    const results: SreExecutionResult[] = [];
    for (const action of actions) {
      results.push(await executeSreAction(action));
    }
    const summary = summarizeSreRepair(results);
    appendDialogue({
      ts: new Date().toISOString(),
      from: "commander",
      text: `SREサブエージェントの自己修復結果: ${summary}`,
    });
    report("sre", results.every((r) => r.ok), summary);
    gitCommitPush(["agent_reports.json", "dialogue.json"], "chore: SREサブエージェント自己修復");
    res.json({ ok: true, plan, results, summary });
  } catch (err) {
    res.status(500).json({ error: String(err).slice(0, 300) });
  }
});

app.post("/api/sales/auto", async (_req, res) => {
  try {
    const result = await scrapeAffiliateReport({ headless: false, slowMoMs: 120 });
    const note = result.ok
      ? `自動取得: ${result.date} orders=${result.totalOrders} reward=${result.totalReward} rows=${result.rowsInserted}`
      : `自動取得失敗: ${result.date} ${result.error ?? "unknown error"}`;
    appendSalesReport({ ts: new Date().toISOString(), period: result.monthFetched, note });
    report("sales-operator", result.ok, note);
    gitCommitPush(["sales_reports.json", "agent_reports.json"], `chore: 売上レポート自動取得 (${result.monthFetched})`);
    res.json({ ok: result.ok, result, note });
  } catch (err) {
    res.status(500).json({ error: String(err).slice(0, 300) });
  }
});

app.post("/api/sales", async (req, res) => {
  try {
    const { period, note } = req.body as { period?: string; note?: string };
    if (!period || !note?.trim()) return res.status(400).json({ error: "期間と内容を入力してください" });
    appendSalesReport({ ts: new Date().toISOString(), period, note: note.trim().slice(0, 1000) });
    gitCommitPush(["sales_reports.json"], `chore: 売上レポート登録 (${period})`);
    await notifyReport(
      "💰 売上レポートが登録されました",
      `期間: ${period}\n${note.trim().slice(0, 500)}\n→ 今夜の学習ループから司令官の最重要シグナルとして戦略に反映されます`
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: String(err).slice(0, 300) });
  }
});

app.post("/api/answer", async (req, res) => {
  try {
    const { text } = req.body as { text?: string };
    if (!text?.trim()) return res.status(400).json({ error: "メッセージを入力してください" });
    appendDialogue({ ts: new Date().toISOString(), from: "user", text: text.trim().slice(0, 1000) });
    gitCommitPush(["dialogue.json"], "chore: オーナーから司令官への回答・指示");
    await notifyReport("💬 オーナーから司令官へ回答・指示", `${text.trim().slice(0, 500)}\n→ 今夜の学習ループで司令官が考慮します`);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: String(err).slice(0, 300) });
  }
});

app.post("/api/cookie", async (req, res) => {
  try {
    const { cookie } = req.body as { cookie?: string };
    const parsed = JSON.parse(cookie ?? "");
    if (!Array.isArray(parsed) || parsed.length === 0 || !parsed[0].name) {
      return res.status(400).json({ error: "Cookie形式が不正です（cookie-exporterの出力JSONを貼ってください）" });
    }
    gh(["secret", "set", "ROOM_COOKIE", "-R", REPO], JSON.stringify(parsed));
    // ローカル .env も更新
    const envPath = path.join(ROOT, ".env");
    if (fs.existsSync(envPath)) {
      const env = fs.readFileSync(envPath, "utf-8");
      const line = `ROOM_COOKIE=${JSON.stringify(parsed)}`;
      fs.writeFileSync(envPath, /^ROOM_COOKIE=/m.test(env) ? env.replace(/^ROOM_COOKIE=.*$/m, line) : env + `\n${line}\n`);
    }
    await notifyReport("🔑 ROOM Cookieが更新されました", "メンテナンスアプリからGitHub Secretsへ反映済み。次回の投稿から新Cookieが使われます");
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: String(err).slice(0, 300) });
  }
});

const ALLOWED_WORKFLOWS: Record<string, string> = {
  post: "auto-post.yml",
  learn: "auto-learn.yml",
  refresh: "auto-refresh.yml",
};

app.post("/api/workflow", async (req, res) => {
  try {
    const { name } = req.body as { name?: string };
    const file = ALLOWED_WORKFLOWS[name ?? ""];
    if (!file) return res.status(400).json({ error: "不明なワークフロー" });
    gh(["workflow", "run", file, "-R", REPO]);
    res.json({ ok: true, message: `${file} を起動しました（結果はDiscordに届きます）` });
  } catch (err) {
    res.status(500).json({ error: String(err).slice(0, 300) });
  }
});

app.listen(PORT, "127.0.0.1", () => {
  console.log(`🎖 ROOM司令部アプリ起動: http://localhost:${PORT}`);
});
