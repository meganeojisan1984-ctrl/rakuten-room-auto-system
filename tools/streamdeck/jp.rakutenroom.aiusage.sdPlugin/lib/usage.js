"use strict";
/**
 * プロバイダ横断の取得口。キー（ボタン）が複数あっても API / ログ読みは 1 回で済むよう
 * プロバイダ単位でキャッシュ＆同時実行のまとめ込みを行う。
 */

const fs = require("fs");
const path = require("path");
const os = require("os");

const { readCodexUsage } = require("./codex");
const { readClaudeUsage } = require("./claude");

const OVERRIDE_FILE = path.join(os.homedir(), ".ai-usage-meter", "override.json");

/**
 * 手動フィード用の抜け道。自動取得できない環境向けに
 * ~/.ai-usage-meter/override.json があればそれを優先する。
 * 形式: {"codex":{"weekly":{"remainingPercent":68,"resetAt":"2026-09-24T09:17:00Z"}}}
 */
function readOverride(provider) {
  let json;
  try {
    json = JSON.parse(fs.readFileSync(OVERRIDE_FILE, "utf8"));
  } catch {
    return null;
  }
  const entry = json && json[provider];
  if (!entry || typeof entry !== "object") return null;
  const windows = {};
  for (const [key, raw] of Object.entries(entry)) {
    if (!raw || typeof raw !== "object") continue;
    const remaining = typeof raw.remainingPercent === "number" ? raw.remainingPercent : null;
    if (remaining == null) continue;
    const parsed = raw.resetAt ? Date.parse(raw.resetAt) : NaN;
    windows[key] = { remainingPercent: remaining, resetAt: Number.isFinite(parsed) ? new Date(parsed) : null };
  }
  if (Object.keys(windows).length === 0) return null;
  return { ok: true, source: OVERRIDE_FILE, observedAt: new Date(), windows };
}

const fetchers = {
  codex: async () => readOverride("codex") || readCodexUsage(),
  claude: async () => readOverride("claude") || (await readClaudeUsage()),
};

/** provider -> {snapshot, fetchedAt, pending} */
const cache = new Map();

/**
 * @param {"codex"|"claude"} provider
 * @param {{ttlMs?: number, force?: boolean}} [options]
 */
async function getUsage(provider, options = {}) {
  const ttlMs = options.ttlMs ?? 60000;
  const fetcher = fetchers[provider];
  if (!fetcher) throw new Error(`未知のプロバイダ: ${provider}`);

  const entry = cache.get(provider);
  const now = Date.now();
  if (!options.force && entry && entry.snapshot && now - entry.fetchedAt < ttlMs) return entry.snapshot;
  if (entry && entry.pending) return entry.pending;

  const pending = (async () => {
    try {
      return await fetcher();
    } catch (err) {
      return {
        ok: false,
        source: null,
        error: String(err && err.message ? err.message : err),
        observedAt: new Date(),
        windows: {},
      };
    }
  })().then((snapshot) => {
    cache.set(provider, { snapshot, fetchedAt: Date.now(), pending: null });
    return snapshot;
  });

  cache.set(provider, { snapshot: entry ? entry.snapshot : null, fetchedAt: entry ? entry.fetchedAt : 0, pending });
  return pending;
}

function clearCache() {
  cache.clear();
}

module.exports = { OVERRIDE_FILE, readOverride, getUsage, clearCache };
