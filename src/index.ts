/**
 * index.ts - メイン起動ファイル
 * Webサーバー起動 + node-cron スケジューラー管理
 */
import * as dotenv from "dotenv";
dotenv.config();

import cron, { type ScheduledTask } from "node-cron";
import { createApp, initDatabase, getSetting, addLog } from "./api/server";
import { runAutoPost } from "./actions/auto_post";
import { runAutoLike } from "./actions/auto_like";
import { runAutoFollow } from "./actions/auto_follow";
import { runAutoDelete } from "./actions/auto_delete";
import { nowJST } from "./utils/helpers";

const PORT = parseInt(process.env.PORT ?? "3000", 10);

// ──────────────────────────────────────────────
// スケジューラー管理
// ──────────────────────────────────────────────
const scheduledTasks: Map<string, ScheduledTask> = new Map();

function isHeadless(): boolean {
  return getSetting("headless") !== "false";
}

async function executeTask(taskName: string): Promise<void> {
  const headless = isHeadless();
  console.log(`\n[scheduler] ===== ${taskName} 実行開始 ${nowJST()} =====`);

  try {
    switch (taskName) {
      case "auto_post": {
        const count = parseInt(getSetting("auto_post.count") ?? "1", 10);
        await runAutoPost(count, headless);
        break;
      }
      case "auto_like": {
        const max = parseInt(getSetting("auto_like.maxLikes") ?? "30", 10);
        await runAutoLike(max, headless);
        break;
      }
      case "auto_follow": {
        const max = parseInt(getSetting("auto_follow.maxFollows") ?? "10", 10);
        const ids = (getSetting("auto_follow.influencerIds") ?? "room_official")
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
        await runAutoFollow(max, ids, headless);
        break;
      }
      case "auto_delete": {
        const max = parseInt(getSetting("auto_delete.maxDeletes") ?? "10", 10);
        await runAutoDelete(max, headless);
        break;
      }
    }
    console.log(`[scheduler] ===== ${taskName} 完了 =====\n`);
  } catch (err) {
    console.error(`[scheduler] ${taskName} エラー:`, err);
    addLog("scheduler", "error", `${taskName} 実行エラー: ${String(err)}`);
  }
}

function scheduleTask(taskName: string): void {
  const enabledKey = `${taskName}.enabled`;
  const scheduleKey = `${taskName}.schedule`;

  const enabled = getSetting(enabledKey) === "true";
  const schedule = getSetting(scheduleKey);

  // 既存タスクを停止
  const existing = scheduledTasks.get(taskName);
  if (existing) {
    existing.stop();
    scheduledTasks.delete(taskName);
  }

  if (!enabled || !schedule) {
    console.log(`[scheduler] ${taskName}: 無効 (スキップ)`);
    return;
  }

  if (!cron.validate(schedule)) {
    console.warn(`[scheduler] ${taskName}: 無効なcron式 "${schedule}"`);
    return;
  }

  const task = cron.schedule(
    schedule,
    () => {
      void executeTask(taskName);
    },
    { timezone: "Asia/Tokyo" }
  );

  scheduledTasks.set(taskName, task);
  console.log(`[scheduler] ${taskName}: スケジュール設定 "${schedule}"`);
}

function reloadSchedules(): void {
  console.log("[scheduler] スケジュールを再読み込み中...");
  for (const taskName of ["auto_post", "auto_like", "auto_follow", "auto_delete"]) {
    scheduleTask(taskName);
  }
}

// ──────────────────────────────────────────────
// メイン起動
// ──────────────────────────────────────────────
async function main(): Promise<void> {
  console.log("=== 楽天ROOM 自動化システム 起動中 ===");
  console.log(`起動時刻: ${nowJST()}`);

  // DBを初期化
  initDatabase();

  // Expressアプリ作成
  const app = createApp({
    reloadSchedules,
    runNow: executeTask,
  });

  // HTTPサーバー起動
  app.listen(PORT, () => {
    console.log(`\n✅ Web UI 起動完了: http://localhost:${PORT}`);
    console.log("  ブラウザで上記URLを開いてダッシュボードを確認してください\n");
    addLog("system", "info", `システム起動 ポート:${PORT}`);
  });

  // スケジューラー起動
  reloadSchedules();

  console.log("=== システム稼働中 (Ctrl+C で停止) ===\n");
}

main().catch((err) => {
  console.error("致命的エラー:", err);
  process.exit(1);
});
