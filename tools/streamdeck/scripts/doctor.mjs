#!/usr/bin/env node
/**
 * 「キーに何も表示されない」ときの切り分け用。
 * 導入状態・Stream Deck のバージョン・プロファイルへの配置・ログ・データ取得を一度に確認する。
 *
 *   node tools/streamdeck/scripts/doctor.mjs
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

import { ACTION_UUID, PLUGIN_UUID, detectProfiles, isStreamDeckRunning, pluginsDir, streamDeckDataDir } from "./streamdeck-paths.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const pluginRoot = path.join(here, "..", `${PLUGIN_UUID}.sdPlugin`);

const problems = [];
const ok = (message) => console.log(`  OK   ${message}`);
const ng = (message, hint) => {
  console.log(`  NG   ${message}`);
  problems.push(hint || message);
};
const info = (message) => console.log(`       ${message}`);
const section = (title) => console.log(`\n■ ${title}`);

const exists = (file) => {
  try {
    fs.statSync(file);
    return true;
  } catch {
    return false;
  }
};

/** Stream Deck アプリのバージョン（取得できなければ null） */
function appVersion() {
  try {
    if (process.platform === "win32") {
      for (const base of [process.env["ProgramFiles"], process.env["ProgramFiles(x86)"]].filter(Boolean)) {
        const exe = path.join(base, "Elgato", "StreamDeck", "StreamDeck.exe");
        if (!exists(exe)) continue;
        return execFileSync(
          "powershell",
          ["-NoProfile", "-Command", `(Get-Item '${exe}').VersionInfo.ProductVersion`],
          { encoding: "utf8" }
        ).trim();
      }
    } else if (process.platform === "darwin") {
      return execFileSync("defaults", ["read", "/Applications/Stream Deck.app/Contents/Info.plist", "CFBundleShortVersionString"], {
        encoding: "utf8",
      }).trim();
    }
  } catch {}
  return null;
}

/** ログディレクトリ（OS ごと） */
function logDirs() {
  const dataDir = streamDeckDataDir();
  const dirs = [];
  if (dataDir) dirs.push(path.join(dataDir, "logs"));
  if (process.platform === "darwin") dirs.push(path.join(os.homedir(), "Library", "Logs", "ElgatoStreamDeck"));
  return dirs.filter(exists);
}

/** ログから本プラグイン関連の行を拾う */
function recentPluginLogLines(limit = 12) {
  const lines = [];
  for (const dir of logDirs()) {
    for (const name of fs.readdirSync(dir)) {
      if (!name.endsWith(".log")) continue;
      const file = path.join(dir, name);
      let text = "";
      try {
        const size = fs.statSync(file).size;
        const fd = fs.openSync(file, "r");
        const length = Math.min(size, 256 * 1024);
        const buf = Buffer.alloc(length);
        fs.readSync(fd, buf, 0, length, size - length);
        fs.closeSync(fd);
        text = buf.toString("utf8");
      } catch {
        continue;
      }
      for (const line of text.split("\n")) {
        if (line.includes("ai-usage") || line.includes(PLUGIN_UUID)) lines.push(`${name}: ${line.trim()}`);
      }
    }
  }
  return lines.slice(-limit);
}

console.log("== AI Usage Meter 診断 ==");
console.log(`  OS: ${process.platform} / Node: ${process.version}`);

section("1. Stream Deck アプリ");
const dataDir = streamDeckDataDir();
if (!dataDir) {
  ng("Stream Deck のデータディレクトリが見つかりません（mac / Windows で実行してください）");
} else {
  ok(`データディレクトリ: ${dataDir}`);
  const version = appVersion();
  if (!version) info("アプリのバージョンを判定できませんでした（Settings → About で確認してください。6.5 以上が必要）");
  else if (Number.parseFloat(version) < 6.5) ng(`アプリが ${version} です。Node プラグインには 6.5 以上が必要`, `Stream Deck アプリを 6.5 以上に更新してください（現在 ${version}）`);
  else ok(`アプリのバージョン: ${version}`);
  info(`起動中: ${isStreamDeckRunning() ? "はい" : "いいえ"}`);
}

section("2. プラグインの導入状態");
const installed = dataDir ? path.join(pluginsDir(dataDir), `${PLUGIN_UUID}.sdPlugin`) : null;
if (!installed || !exists(installed)) {
  ng(`プラグインが導入されていません: ${installed || "(不明)"}`, "npm run streamdeck:install -- --apply-current を実行してください");
} else {
  ok(`導入先: ${installed}`);
  for (const required of ["manifest.json", "plugin.js", "lib/usage.js", "imgs/key.png", "pi/index.html"]) {
    if (exists(path.join(installed, required))) ok(`  ${required}`);
    else ng(`  ${required} がありません`, "プラグインを再インストールしてください（npm run streamdeck:install）");
  }
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(installed, "manifest.json"), "utf8"));
    info(`UUID: ${manifest.UUID} / バージョン: ${manifest.Version} / Node: ${manifest.Nodejs?.Version}`);
    const source = JSON.parse(fs.readFileSync(path.join(pluginRoot, "manifest.json"), "utf8"));
    if (manifest.Version !== source.Version) info(`! リポジトリ側は ${source.Version} です。再インストールで更新できます`);
  } catch (err) {
    ng(`manifest.json を読めません: ${String(err)}`, "プラグインを再インストールしてください");
  }
}

section("3. プロファイルへの配置");
const profiles = detectProfiles();
if (profiles.length === 0) {
  ng("プロファイルを検出できません", "Stream Deck アプリを一度起動してから再実行してください");
  // 新しいアプリでは保存場所が変わっている可能性があるため、実際の中身を出しておく
  if (dataDir && exists(dataDir)) {
    info(`${dataDir} の中身:`);
    for (const entry of fs.readdirSync(dataDir, { withFileTypes: true })) {
      info(`  ${entry.isDirectory() ? "[dir] " : "      "}${entry.name}`);
    }
  }
} else {
  let placed = 0;
  for (const profile of profiles) {
    const slots = Object.entries(profile.manifest.Actions || {}).filter(([, action]) => action && action.UUID === ACTION_UUID);
    placed += slots.length;
    const detail = slots.map(([position, action]) => `${position}(${action.Settings?.provider}/${action.Settings?.window})`).join(", ");
    info(`${profile.name}: 全${profile.actionCount}キー中 ${slots.length} キー${detail ? ` → ${detail}` : ""}`);
  }
  if (placed === 0) ng("どのプロファイルにも配置されていません", "npm run streamdeck:install -- --apply-current を実行するか、右パネルから手動でドラッグしてください");
  else ok(`配置済み: 合計 ${placed} キー`);
}

section("4. Stream Deck のログ");
const logLines = recentPluginLogLines();
if (logLines.length === 0) {
  info("プラグイン関連のログが見つかりません（＝プラグインが一度も起動していない可能性があります）");
} else {
  for (const line of logLines) info(line);
}

section("5. データ取得");
const lib = (name) => require(path.join(pluginRoot, "lib", name));
const { getUsage } = lib("usage.js");
const { formatJstShort } = lib("jst.js");
for (const provider of ["codex", "claude"]) {
  const snapshot = await getUsage(provider, { force: true });
  if (!snapshot.ok) {
    ng(`${provider}: ${snapshot.error}`, `${provider} の取得設定を確認してください: ${snapshot.error}`);
    continue;
  }
  const detail = Object.entries(snapshot.windows)
    .map(([key, win]) => `${key}=${Math.round(win.remainingPercent)}%${win.resetAt ? `(${formatJstShort(new Date(win.resetAt))})` : ""}`)
    .join(" ");
  ok(`${provider}: ${detail}`);
}

console.log("\n== まとめ ==");
if (problems.length === 0) {
  console.log("  問題は見つかりませんでした。キーが黒いままなら Stream Deck アプリを再起動してください。");
} else {
  problems.forEach((problem, index) => console.log(`  ${index + 1}. ${problem}`));
}
