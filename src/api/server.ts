/**
 * server.ts - Express APIサーバー + SQLiteデータベース
 * Web UIの提供・設定管理・ログ記録を行う
 */
import express from "express";
import path from "path";
import Database from "better-sqlite3";
import fs from "fs";

const DB_PATH = path.join(process.cwd(), "data", "database.sqlite");

// ──────────────────────────────────────────────
// データベース初期化
// ──────────────────────────────────────────────
let db: Database.Database;

export function initDatabase(): Database.Database {
  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");

  // 設定テーブル
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  // ログテーブル
  db.exec(`
    CREATE TABLE IF NOT EXISTS logs (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      task      TEXT NOT NULL,
      level     TEXT NOT NULL,
      message   TEXT NOT NULL,
      created_at DATETIME DEFAULT (datetime('now', 'localtime'))
    );
  `);

  // デフォルト設定を挿入（存在しない場合のみ）
  const defaults: Record<string, string> = {
    // 機能オン/オフ
    "auto_post.enabled": "true",
    "auto_like.enabled": "false",
    "auto_follow.enabled": "false",
    "auto_delete.enabled": "false",

    // スケジュール (node-cron形式)
    "auto_post.schedule": "0 0,9,12,21,23 * * *",
    "auto_like.schedule": "30 10,19 * * *",
    "auto_follow.schedule": "0 11 * * *",
    "auto_delete.schedule": "0 3 * * 0",

    // 各機能のパラメータ
    "auto_post.count": "1",
    "auto_like.maxLikes": "30",
    "auto_follow.maxFollows": "10",
    "auto_follow.influencerIds": "room_official",
    "auto_delete.maxDeletes": "10",

    // 実行モード
    "headless": "true",
  };

  const insert = db.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)");
  for (const [key, value] of Object.entries(defaults)) {
    insert.run(key, value);
  }

  console.log("[db] データベース初期化完了:", DB_PATH);
  return db;
}

export function getDb(): Database.Database {
  if (!db) return initDatabase();
  return db;
}

// ──────────────────────────────────────────────
// 設定ヘルパー
// ──────────────────────────────────────────────
export function getSetting(key: string): string | null {
  const row = getDb().prepare("SELECT value FROM settings WHERE key = ?").get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

export function setSetting(key: string, value: string): void {
  getDb().prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").run(key, value);
}

export function getAllSettings(): Record<string, string> {
  const rows = getDb().prepare("SELECT key, value FROM settings").all() as Array<{ key: string; value: string }>;
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

// ──────────────────────────────────────────────
// ログヘルパー
// ──────────────────────────────────────────────
export function addLog(task: string, level: "info" | "warn" | "error", message: string): void {
  try {
    getDb().prepare("INSERT INTO logs (task, level, message) VALUES (?, ?, ?)").run(task, level, message);
  } catch {
    // DB未初期化時は無視
  }
}

export function getLogs(limit = 200): unknown[] {
  return getDb()
    .prepare("SELECT * FROM logs ORDER BY id DESC LIMIT ?")
    .all(limit);
}

// ──────────────────────────────────────────────
// Expressアプリ作成
// ──────────────────────────────────────────────
export function createApp(
  schedulerCallbacks: {
    reloadSchedules: () => void;
    runNow: (task: string) => Promise<void>;
  }
): express.Application {
  const app = express();
  app.use(express.json());
  app.use(express.static(path.join(process.cwd(), "public")));

  // ── 設定 API ──
  app.get("/api/settings", (_req, res) => {
    res.json(getAllSettings());
  });

  app.post("/api/settings", (req, res) => {
    const updates = req.body as Record<string, string>;
    for (const [key, value] of Object.entries(updates)) {
      setSetting(key, String(value));
    }
    schedulerCallbacks.reloadSchedules();
    res.json({ ok: true });
  });

  // ── ログ API ──
  app.get("/api/logs", (req, res) => {
    const limit = parseInt(String(req.query["limit"] ?? "100"), 10);
    res.json(getLogs(limit));
  });

  app.delete("/api/logs", (_req, res) => {
    getDb().prepare("DELETE FROM logs").run();
    res.json({ ok: true });
  });

  // ── 手動実行 API ──
  app.post("/api/run/:task", async (req, res) => {
    const task = req.params["task"];
    const validTasks = ["auto_post", "auto_like", "auto_follow", "auto_delete"];
    if (!task || !validTasks.includes(task)) {
      res.status(400).json({ error: "無効なタスク名" });
      return;
    }
    try {
      // 非同期実行（レスポンスはすぐ返す）
      void schedulerCallbacks.runNow(task);
      res.json({ ok: true, message: `${task} を実行開始しました` });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // ── ステータス API ──
  app.get("/api/status", (_req, res) => {
    res.json({
      uptime: Math.floor(process.uptime()),
      pid: process.pid,
      time: new Date().toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" }),
    });
  });

  return app;
}
