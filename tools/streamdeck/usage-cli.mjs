#!/usr/bin/env node
/**
 * 取得状況の確認と見た目のプレビュー用 CLI（Stream Deck が無くても動く）。
 *
 *   node tools/streamdeck/usage-cli.mjs probe     # Codex / Claude の残量を取得して表示
 *   node tools/streamdeck/usage-cli.mjs json      # 機械可読な JSON で出力
 *   node tools/streamdeck/usage-cli.mjs preview   # キー画像のプレビュー SVG を書き出す
 *   node tools/streamdeck/usage-cli.mjs raw       # Codex ログの rate_limits を生のまま表示（調査用）
 *   node tools/streamdeck/usage-cli.mjs auth      # Claude 認証情報の「構造だけ」表示（値は出さない）
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const lib = (name) => require(path.join(here, "jp.rakutenroom.aiusage.sdPlugin", "lib", name));

const { getUsage } = lib("usage.js");
const codex = lib("codex.js");
const claude = lib("claude.js");
const { renderKeySvg } = lib("render.js");
const { formatJstShort, formatRemaining } = lib("jst.js");

const WINDOW_NAMES = { "5h": "5時間枠", weekly: "週間枠", weekly_opus: "週間枠(Opus)" };

async function collect() {
  const [codex, claude] = await Promise.all([getUsage("codex", { force: true }), getUsage("claude", { force: true })]);
  return { codex, claude };
}

function printSnapshot(name, snapshot) {
  console.log(`\n[${name}]`);
  if (!snapshot.ok) {
    console.log(`  取得失敗: ${snapshot.error}`);
    if (snapshot.source) console.log(`  参照先: ${snapshot.source}`);
    return;
  }
  console.log(`  情報源: ${snapshot.source}`);
  for (const [key, win] of Object.entries(snapshot.windows)) {
    const reset = win.resetAt ? `${formatJstShort(new Date(win.resetAt))}（あと ${formatRemaining(new Date(win.resetAt) - Date.now())}）` : "不明";
    console.log(`  ${WINDOW_NAMES[key] || key}: 残り ${Math.round(win.remainingPercent)}%  リセット ${reset}`);
  }
}

/** 3 キー分を並べたプレビュー SVG */
function previewSvg(snapshots) {
  const keys = [
    { provider: "codex", window: "weekly", label: "CODEX" },
    { provider: "claude", window: "weekly", label: "CLAUDE" },
    { provider: "claude", window: "5h", label: "CLAUDE" },
  ];
  const cells = keys.map((key, index) => {
    const snapshot = snapshots[key.provider];
    const win = snapshot && snapshot.windows ? snapshot.windows[key.window] : null;
    const svg = renderKeySvg({
      provider: key.provider,
      label: key.label,
      window: key.window,
      remainingPercent: win ? win.remainingPercent : null,
      resetAt: win && win.resetAt ? new Date(win.resetAt) : null,
      stale: !(snapshot && snapshot.ok),
    });
    const inner = svg.replace(/^<svg[^>]*>/, "").replace(/<\/svg>$/, "");
    return `<g transform="translate(${index * 164 + 10}, 10)">${inner}</g>`;
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${keys.length * 164 + 6}" height="164" viewBox="0 0 ${
    keys.length * 164 + 6
  } 164"><rect width="100%" height="100%" fill="#1b1b1b"/>${cells.join("")}</svg>`;
}

const command = process.argv[2] || "probe";

/** Codex のセッションログから rate_limits を生のまま取り出す（キー名の差異を調べる用） */
function showRaw() {
  const home = codex.codexHome();
  const files = codex.findRecentSessionFiles(path.join(home, "sessions"), 5);
  console.log(`Codex ディレクトリ: ${home}`);
  console.log(`最近のセッション: ${files.length} 件`);
  let shown = 0;
  for (const file of files) {
    let parsed;
    try {
      const size = fs.statSync(file).size;
      const fd = fs.openSync(file, "r");
      const length = Math.min(size, 512 * 1024);
      const buf = Buffer.alloc(length);
      fs.readSync(fd, buf, 0, length, size - length);
      fs.closeSync(fd);
      parsed = codex.parseTailForRateLimits(buf.toString("utf8"));
    } catch {
      continue;
    }
    if (!parsed) continue;
    console.log(`\n--- ${path.basename(file)} ---`);
    console.log(`記録時刻: ${parsed.at ? parsed.at.toISOString() : "不明"}`);
    console.log(JSON.stringify(parsed.rateLimits, null, 2));
    if (++shown >= 2) break;
  }
  if (shown === 0) console.log("rate_limits を含む記録が見つかりませんでした。");
}

/** Claude 認証情報の構造だけを表示する（トークンの値は絶対に出さない） */
function showAuth() {
  for (const file of claude.credentialPaths()) {
    const exists = fs.existsSync(file);
    console.log(`${exists ? "あり" : "なし"}: ${file}`);
    if (!exists) continue;
    let json;
    try {
      json = JSON.parse(fs.readFileSync(file, "utf8"));
    } catch (err) {
      console.log(`  JSON として読めません: ${String(err)}`);
      continue;
    }
    console.log(`  構造: ${JSON.stringify(claude.describeCredentials(json), null, 2).split("\n").join("\n  ")}`);
    const token = claude.pickAccessToken(json);
    console.log(`  アクセストークン: ${token ? `検出できました（${token.length}文字）` : "見つかりません"}`);
    const expiresAt = json.claudeAiOauth && json.claudeAiOauth.expiresAt;
    if (typeof expiresAt === "number") {
      const at = new Date(expiresAt > 1e12 ? expiresAt : expiresAt * 1000);
      console.log(`  有効期限: ${at.toISOString()} (${at.getTime() < Date.now() ? "期限切れ" : "有効"})`);
    }
  }
  const env = process.env.CLAUDE_CODE_OAUTH_TOKEN || process.env.CLAUDE_OAUTH_TOKEN;
  console.log(`環境変数のトークン: ${env ? "あり" : "なし"}`);
}

if (command === "raw") {
  showRaw();
  process.exit(0);
}

if (command === "auth") {
  showAuth();
  process.exit(0);
}

const snapshots = await collect();

if (command === "json") {
  console.log(JSON.stringify(snapshots, null, 2));
} else if (command === "preview") {
  const out = path.resolve(process.argv[3] || path.join(here, "dist", "preview.svg"));
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, previewSvg(snapshots));
  console.log(`プレビューを書き出しました: ${out}`);
} else {
  console.log("== AI 使用量 取得チェック ==");
  printSnapshot("Codex", snapshots.codex);
  printSnapshot("Claude", snapshots.claude);
  console.log("\n取得できない場合は tools/streamdeck/README.md の「うまく取得できないとき」を参照してください。");
}
