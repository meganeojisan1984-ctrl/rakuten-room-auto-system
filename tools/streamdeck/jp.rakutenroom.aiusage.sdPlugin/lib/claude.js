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

/** 認証情報ファイルの候補 */
function credentialPaths() {
  return [
    path.join(os.homedir(), ".claude", ".credentials.json"),
    path.join(os.homedir(), ".config", "claude", ".credentials.json"),
  ];
}

function readJsonFile(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

/**
 * 認証情報 JSON から accessToken を取り出す。
 * Claude Code のバージョンで入れ子や名前が変わるため、よくある場所を見たうえで
 * 見つからなければ access token 系のキーを再帰的に探す。
 */
function pickAccessToken(creds, depth = 0) {
  if (!creds || typeof creds !== "object" || depth > 4) return null;
  const oauth = creds.claudeAiOauth || creds.oauth || creds;
  const direct = oauth.accessToken || oauth.access_token;
  if (typeof direct === "string" && direct.length > 0) return direct;

  for (const [key, value] of Object.entries(creds)) {
    if (typeof value === "string" && value.length > 20 && /access[_-]?token/i.test(key)) return value;
    if (value && typeof value === "object") {
      const found = pickAccessToken(value, depth + 1);
      if (found) return found;
    }
  }
  return null;
}

/** 認証情報の構造だけを返す（値は出さない）。診断用 */
function describeCredentials(value, depth = 0) {
  if (value === null) return "null";
  if (Array.isArray(value)) return `配列(${value.length})`;
  if (typeof value === "object") {
    if (depth > 3) return "オブジェクト(…)";
    return Object.fromEntries(Object.entries(value).map(([key, inner]) => [key, describeCredentials(inner, depth + 1)]));
  }
  if (typeof value === "string") return `string(${value.length}文字)`;
  return typeof value;
}

/** Windows 資格情報マネージャーに登録されている Claude 関連のターゲット名を集める */
function windowsCredentialTargets() {
  const defaults = ["Claude Code-credentials", "Claude Code", "claude-code-credentials"];
  try {
    const out = execFileSync("cmdkey", ["/list"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    const found = [...out.matchAll(/Target:\s*(.+)/gi)]
      .map((match) => match[1].trim())
      .map((target) => (target.includes("target=") ? target.slice(target.indexOf("target=") + 7) : target))
      .filter((target) => /claude/i.test(target));
    return [...new Set([...found, ...defaults])];
  } catch {
    return defaults;
  }
}

/**
 * Windows 資格情報マネージャーから 1 件読む。
 * PowerShell 経由で CredRead を呼び、中身を base64 で受け取る（値はログに出さない）。
 */
function readWindowsCredential(target) {
  const script = `
$ErrorActionPreference='Stop'
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public class SdCred {
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
  public struct CREDENTIAL {
    public int Flags; public int Type; public IntPtr TargetName; public IntPtr Comment;
    public long LastWritten; public int CredentialBlobSize; public IntPtr CredentialBlob;
    public int Persist; public int AttributeCount; public IntPtr Attributes;
    public IntPtr TargetAlias; public IntPtr UserName;
  }
  [DllImport("advapi32.dll", SetLastError=true, CharSet=CharSet.Unicode, EntryPoint="CredReadW")]
  public static extern bool CredRead(string target, int type, int flags, out IntPtr credential);
}
"@
$ptr=[IntPtr]::Zero
if ([SdCred]::CredRead(${JSON.stringify(target)}, 1, 0, [ref]$ptr)) {
  $cred=[SdCred+CREDENTIAL][System.Runtime.InteropServices.Marshal]::PtrToStructure($ptr,[type][SdCred+CREDENTIAL])
  if ($cred.CredentialBlobSize -gt 0) {
    $bytes=New-Object byte[] $cred.CredentialBlobSize
    [System.Runtime.InteropServices.Marshal]::Copy($cred.CredentialBlob,$bytes,0,$cred.CredentialBlobSize)
    [Convert]::ToBase64String($bytes)
  }
}`;
  try {
    const encoded = Buffer.from(script, "utf16le").toString("base64");
    const out = execFileSync("powershell", ["-NoProfile", "-NonInteractive", "-EncodedCommand", encoded], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 10000,
    }).trim();
    if (!out) return null;
    const buf = Buffer.from(out, "base64");
    // keytar は UTF-8、Windows 標準は UTF-16LE で保存されることがあるため両方試す
    for (const encoding of ["utf8", "utf16le"]) {
      const text = buf.toString(encoding).replace(/\u0000+$/, "");
      if (text.trim().startsWith("{")) return text;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * アクセストークンを探す。
 * 1) 環境変数  2) macOS キーチェーン / Windows 資格情報マネージャー  3) ~/.claude/.credentials.json
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

  if (process.platform === "win32") {
    for (const target of windowsCredentialTargets()) {
      const raw = readWindowsCredential(target);
      if (!raw) continue;
      let token = null;
      try {
        token = pickAccessToken(JSON.parse(raw));
      } catch {
        token = raw.trim().length > 20 && !raw.includes("{") ? raw.trim() : null;
      }
      if (token) return { token, source: `Windows 資格情報マネージャー (${target})` };
    }
  }

  for (const file of credentialPaths()) {
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
      error:
        "Claude Code のログイン情報が見つかりません" +
        "（claude で /login するか、claude setup-token で発行したトークンを " +
        "環境変数 CLAUDE_CODE_OAUTH_TOKEN に設定してください）",
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
  describeCredentials,
  windowsCredentialTargets,
  readWindowsCredential,
  credentialPaths,
  pickAccessToken,
  readAccessToken,
  normalizeWindow,
  normalizeUsagePayload,
  readClaudeUsage,
};
