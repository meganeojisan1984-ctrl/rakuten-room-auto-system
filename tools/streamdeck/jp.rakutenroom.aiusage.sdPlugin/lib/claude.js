"use strict";
/**
 * Claude Code の利用量（5時間枠 / 週間枠）を取得する。
 *
 * Claude Code にログイン済みの OAuth アクセストークンを使って
 * https://api.anthropic.com/api/oauth/usage を叩く（/usage コマンドと同じ情報源）。
 * トークンの保管場所は OS ごとに異なるため、順に探索する。
 */

const fs = require("fs");
const path = require("path");
const os = require("os");
const https = require("https");
const { execFileSync } = require("child_process");

const USAGE_URL = "https://api.anthropic.com/api/oauth/usage";
const OAUTH_BETA = "oauth-2025-04-20";

function readJsonFile(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

/** 認証情報 JSON から accessToken を取り出す（形式差異に寛容に） */
function pickAccessToken(creds) {
  if (!creds || typeof creds !== "object") return null;
  const oauth = creds.claudeAiOauth || creds.oauth || creds;
  const token = oauth.accessToken || oauth.access_token;
  return typeof token === "string" && token.length > 0 ? token : null;
}

/**
 * アクセストークンを探す。
 * 1) 環境変数  2) macOS キーチェーン  3) ~/.claude/.credentials.json
 */
function readAccessToken() {
  const envToken = process.env.CLAUDE_CODE_OAUTH_TOKEN || process.env.CLAUDE_OAUTH_TOKEN;
  if (envToken) return { token: envToken, source: "環境変数" };

  if (process.platform === "darwin") {
    try {
      const raw = execFileSync("security", ["find-generic-password", "-s", "Claude Code-credentials", "-w"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim();
      const token = pickAccessToken(JSON.parse(raw)) || (raw.startsWith("sk-") ? raw : null);
      if (token) return { token, source: "macOS キーチェーン" };
    } catch {
      /* キーチェーンに無い場合はファイルへフォールバック */
    }
  }

  const candidates = [
    path.join(os.homedir(), ".claude", ".credentials.json"),
    path.join(os.homedir(), ".config", "claude", ".credentials.json"),
  ];
  for (const file of candidates) {
    const token = pickAccessToken(readJsonFile(file));
    if (token) return { token, source: file };
  }
  return { token: null, source: null };
}

function httpsGetJson(url, headers, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, { method: "GET", headers }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        const body = Buffer.concat(chunks).toString("utf8");
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
          try {
            resolve(JSON.parse(body));
          } catch (err) {
            reject(new Error(`応答を JSON として解釈できません: ${String(err)}`));
          }
          return;
        }
        reject(new Error(`HTTP ${res.statusCode}`));
      });
    });
    req.setTimeout(timeoutMs, () => req.destroy(new Error("タイムアウト")));
    req.on("error", reject);
    req.end();
  });
}

const num = (...values) => values.find((v) => typeof v === "number" && Number.isFinite(v));

/** 1 枠分を {remainingPercent, resetAt} に正規化 */
function normalizeWindow(raw) {
  if (!raw || typeof raw !== "object") return null;
  const used = num(raw.utilization, raw.used_percent, raw.usedPercent, raw.percent_used);
  const remainingRaw = num(raw.remaining_percent, raw.remainingPercent);
  const remaining = remainingRaw != null ? remainingRaw : used != null ? 100 - used : null;
  if (remaining == null) return null;

  let resetAt = null;
  const resetsAt = raw.resets_at || raw.resetsAt || raw.reset_at;
  if (typeof resetsAt === "string") {
    const parsed = Date.parse(resetsAt);
    if (Number.isFinite(parsed)) resetAt = new Date(parsed);
  } else if (typeof resetsAt === "number") {
    // epoch 秒 / ミリ秒のどちらでも受ける
    resetAt = new Date(resetsAt > 1e12 ? resetsAt : resetsAt * 1000);
  }
  const resetsIn = num(raw.resets_in_seconds, raw.resetsInSeconds);
  if (!resetAt && resetsIn != null) resetAt = new Date(Date.now() + resetsIn * 1000);

  return { remainingPercent: Math.max(0, Math.min(100, remaining)), resetAt };
}

/** /api/oauth/usage のレスポンスを 5h / weekly / weekly_opus に振り分ける */
function normalizeUsagePayload(payload) {
  if (!payload || typeof payload !== "object") return {};
  const root = payload.usage && typeof payload.usage === "object" ? payload.usage : payload;
  const mapping = {
    "5h": [root.five_hour, root.fiveHour, root.five_hour_limit],
    weekly: [root.seven_day, root.sevenDay, root.seven_day_limit, root.weekly],
    weekly_opus: [root.seven_day_opus, root.sevenDayOpus, root.seven_day_opus_limit],
  };
  const windows = {};
  for (const [key, candidates] of Object.entries(mapping)) {
    for (const raw of candidates) {
      const win = normalizeWindow(raw);
      if (win) {
        windows[key] = win;
        break;
      }
    }
  }
  return windows;
}

/**
 * Claude の使用状況スナップショットを返す。
 * @returns {Promise<{ok: boolean, source: string|null, error?: string, observedAt: Date, windows: object}>}
 */
async function readClaudeUsage() {
  const { token, source } = readAccessToken();
  if (!token) {
    return {
      ok: false,
      source: null,
      error: "Claude Code のログイン情報が見つかりません（claude /login 済みか確認）",
      observedAt: new Date(),
      windows: {},
    };
  }

  let payload;
  try {
    payload = await httpsGetJson(USAGE_URL, {
      Authorization: `Bearer ${token}`,
      "anthropic-beta": OAUTH_BETA,
      "Content-Type": "application/json",
      Accept: "application/json",
      "User-Agent": "streamdeck-ai-usage-meter/1.0",
    });
  } catch (err) {
    const message = String(err && err.message ? err.message : err);
    const hint = message.includes("401") || message.includes("403") ? "（トークン期限切れの可能性：claude を一度起動して再ログイン）" : "";
    return { ok: false, source, error: `使用量 API に接続できません: ${message}${hint}`, observedAt: new Date(), windows: {} };
  }

  const windows = normalizeUsagePayload(payload);
  if (Object.keys(windows).length === 0) {
    return { ok: false, source, error: "使用量 API の形式を解釈できません", observedAt: new Date(), windows: {} };
  }
  return { ok: true, source, observedAt: new Date(), windows };
}

module.exports = {
  USAGE_URL,
  pickAccessToken,
  readAccessToken,
  normalizeWindow,
  normalizeUsagePayload,
  readClaudeUsage,
};
