"use strict";
/**
 * Codex CLI のレート制限（5時間枠 / 週間枠）をローカルのセッションログから読み取る。
 *
 * Codex CLI は ~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl にセッションを追記し、
 * token_count イベントに rate_limits（primary=短期 / secondary=週間）を含める。
 * バージョン差異があるため「rate_limits を含む最後の行」を寛容にパースする方針。
 */

const fs = require("fs");
const path = require("path");
const os = require("os");

const TAIL_BYTES = 512 * 1024;

function codexHome() {
  return process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
}

/**
 * 新しいディレクトリ（YYYY/MM/DD 名）から順に降りて .jsonl を最大 limit 件集める。
 * セッションが数千件あっても全走査しないようにするための枝刈り付き探索。
 */
function findRecentSessionFiles(root, limit = 5, depth = 0) {
  let entries;
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return [];
  }
  const files = entries
    .filter((e) => e.isFile() && e.name.endsWith(".jsonl"))
    .map((e) => {
      const full = path.join(root, e.name);
      let mtimeMs = 0;
      try {
        mtimeMs = fs.statSync(full).mtimeMs;
      } catch {}
      return { full, mtimeMs };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .map((f) => f.full);

  const result = files.slice(0, limit);
  if (result.length >= limit || depth >= 4) return result;

  const dirs = entries
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort((a, b) => b.localeCompare(a)); // 2026 > 2025, 12 > 01 の順で新しい方から
  for (const dir of dirs) {
    if (result.length >= limit) break;
    result.push(...findRecentSessionFiles(path.join(root, dir), limit - result.length, depth + 1));
  }
  return result;
}

/** ファイル末尾だけを読む（巨大ログ対策） */
function readTail(file, bytes = TAIL_BYTES) {
  const fd = fs.openSync(file, "r");
  try {
    const size = fs.fstatSync(fd).size;
    const length = Math.min(size, bytes);
    const buf = Buffer.alloc(length);
    fs.readSync(fd, buf, 0, length, size - length);
    return buf.toString("utf8");
  } finally {
    fs.closeSync(fd);
  }
}

/** JSON 行の入れ子のどこかにある rate_limits を拾う */
function extractRateLimits(obj) {
  if (!obj || typeof obj !== "object") return null;
  if (obj.rate_limits && typeof obj.rate_limits === "object") return obj.rate_limits;
  if (obj.rateLimits && typeof obj.rateLimits === "object") return obj.rateLimits;
  for (const value of Object.values(obj)) {
    if (value && typeof value === "object") {
      const found = extractRateLimits(value);
      if (found) return found;
    }
  }
  return null;
}

/** 末尾テキストから「最後の rate_limits を持つ行」を取り出す */
function parseTailForRateLimits(text) {
  const lines = text.split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (!line || line[0] !== "{" || !line.includes("rate_limit")) continue;
    let json;
    try {
      json = JSON.parse(line);
    } catch {
      continue; // 先頭が途中で切れた行など
    }
    const rateLimits = extractRateLimits(json);
    if (!rateLimits) continue;
    const ts = Date.parse(json.timestamp || json.time || json.created_at || "");
    return { rateLimits, at: Number.isFinite(ts) ? new Date(ts) : null };
  }
  return null;
}

const num = (...values) => values.find((v) => typeof v === "number" && Number.isFinite(v));

/** rate_limits の 1 枠を {remainingPercent, resetAt, windowMinutes} に正規化 */
function normalizeWindow(raw, baseAt) {
  if (!raw || typeof raw !== "object") return null;
  const used = num(raw.used_percent, raw.usedPercent, raw.percent_used);
  const remainingRaw = num(raw.remaining_percent, raw.remainingPercent);
  const remaining = remainingRaw != null ? remainingRaw : used != null ? 100 - used : null;
  if (remaining == null) return null;

  const windowMinutes = num(raw.window_minutes, raw.windowMinutes, raw.window_size_minutes) ?? null;
  const resetsInSeconds = num(raw.resets_in_seconds, raw.resetsInSeconds, raw.reset_in_seconds);
  let resetAt = null;
  if (typeof raw.resets_at === "string" || typeof raw.resetsAt === "string") {
    const parsed = Date.parse(raw.resets_at || raw.resetsAt);
    if (Number.isFinite(parsed)) resetAt = new Date(parsed);
  }
  if (!resetAt && resetsInSeconds != null) {
    // ログ記録時刻を基準にする（ログが古くてもリセット時刻自体は正しく出る）
    resetAt = new Date((baseAt ? baseAt.getTime() : Date.now()) + resetsInSeconds * 1000);
  }
  return {
    remainingPercent: Math.max(0, Math.min(100, remaining)),
    resetAt,
    windowMinutes,
  };
}

/** primary/secondary を 5h / weekly に振り分ける */
function normalizeRateLimits(rateLimits, baseAt) {
  const windows = {};
  const candidates = [
    ["5h", rateLimits.primary ?? rateLimits.five_hour ?? rateLimits.fiveHour],
    ["weekly", rateLimits.secondary ?? rateLimits.weekly ?? rateLimits.seven_day],
  ];
  for (const [fallbackKey, raw] of candidates) {
    const win = normalizeWindow(raw, baseAt);
    if (!win) continue;
    // window_minutes が取れる場合はそちらを信頼する（24時間以下＝短期枠）
    const key = win.windowMinutes != null ? (win.windowMinutes <= 24 * 60 ? "5h" : "weekly") : fallbackKey;
    windows[key] = win;
  }
  return windows;
}

/**
 * Codex の使用状況スナップショットを返す。
 * @returns {{ok: boolean, source: string, error?: string, observedAt: Date|null, windows: object}}
 */
function readCodexUsage() {
  const home = codexHome();
  const sessionsDir = path.join(home, "sessions");
  const roots = [sessionsDir, home].filter((dir) => {
    try {
      return fs.statSync(dir).isDirectory();
    } catch {
      return false;
    }
  });
  if (roots.length === 0) {
    return { ok: false, source: home, error: "Codex CLI のデータ (~/.codex) が見つかりません", observedAt: null, windows: {} };
  }

  let best = null;
  for (const root of roots) {
    for (const file of findRecentSessionFiles(root, 5)) {
      let parsed;
      try {
        parsed = parseTailForRateLimits(readTail(file));
      } catch {
        continue;
      }
      if (!parsed) continue;
      const at = parsed.at ? parsed.at.getTime() : 0;
      if (!best || at > best.at) best = { at, parsed, file };
    }
    if (best) break;
  }

  if (!best) {
    return {
      ok: false,
      source: sessionsDir,
      error: "レート制限の記録が見つかりません（Codex で 1 回会話すると記録されます）",
      observedAt: null,
      windows: {},
    };
  }

  const observedAt = best.parsed.at;
  const windows = normalizeRateLimits(best.parsed.rateLimits, observedAt);
  if (Object.keys(windows).length === 0) {
    return { ok: false, source: best.file, error: "レート制限の形式を解釈できません", observedAt, windows: {} };
  }
  return { ok: true, source: best.file, observedAt, windows };
}

module.exports = {
  codexHome,
  findRecentSessionFiles,
  parseTailForRateLimits,
  normalizeRateLimits,
  normalizeWindow,
  readCodexUsage,
};
