#!/usr/bin/env node
/**
 * Stream Deck に「AI Usage Meter」プラグインを導入し、写真と同じ 3 キーを自動配置する。
 *
 *   node tools/streamdeck/install.mjs                # 導入 + プロファイル取り込み + 再起動
 *   node tools/streamdeck/install.mjs --apply-current # 今使っているプロファイルに直接 3 キーを書き込む
 *   node tools/streamdeck/install.mjs --dry-run       # 何もせず計画だけ表示
 *
 * オプション:
 *   --no-profile   キー配置を行わずプラグイン導入だけ
 *   --no-restart   Stream Deck アプリを再起動しない
 *   --dest <dir>   Plugins ディレクトリを明示指定（検証用）
 *   --keys <spec>  配置を指定 (例: "codex:weekly,claude:weekly,claude:5h")
 */
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildProfileArchive, DEFAULT_KEYS, buildProfileManifest, resolveDeviceFields } from "./scripts/make-profile.mjs";
import {
  ACTION_UUID,
  PLUGIN_UUID,
  detectProfiles,
  isStreamDeckRunning,
  pickPrimaryProfile,
  pluginsDir,
  streamDeckDataDir,
} from "./scripts/streamdeck-paths.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const SOURCE_PLUGIN = path.join(here, `${PLUGIN_UUID}.sdPlugin`);

function parseArgs(argv) {
  const args = { profile: true, restart: true, dryRun: false, applyCurrent: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--no-profile") args.profile = false;
    else if (a === "--no-restart") args.restart = false;
    else if (a === "--dry-run") args.dryRun = true;
    else if (a === "--apply-current") args.applyCurrent = true;
    else if (a === "--dest") args.dest = argv[++i];
    else if (a === "--keys") args.keys = argv[++i];
    else if (a === "--device-model") args.deviceModel = argv[++i];
    else if (a === "--help" || a === "-h") args.help = true;
  }
  return args;
}

/** "codex:weekly,claude:5h" → キー定義 */
export function parseKeysSpec(spec) {
  if (!spec) return DEFAULT_KEYS;
  return spec.split(",").map((part, index) => {
    const [provider, window] = part.trim().split(":");
    if (!["codex", "claude"].includes(provider)) throw new Error(`不明なサービス: ${provider}`);
    if (!["weekly", "5h", "weekly_opus"].includes(window)) throw new Error(`不明な枠: ${window}`);
    return { position: `${index},0`, label: provider.toUpperCase(), provider, window };
  });
}

const log = (message) => console.log(message);

function quitStreamDeck() {
  try {
    if (process.platform === "darwin") execFileSync("osascript", ["-e", 'quit app "Stream Deck"'], { stdio: "ignore" });
    else if (process.platform === "win32") execFileSync("taskkill", ["/IM", "StreamDeck.exe", "/F"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function launchStreamDeck() {
  try {
    if (process.platform === "darwin") {
      spawn("open", ["-a", "Stream Deck"], { detached: true, stdio: "ignore" }).unref();
      return true;
    }
    if (process.platform === "win32") {
      const candidates = [
        path.join(process.env["ProgramFiles"] || "C:/Program Files", "Elgato", "StreamDeck", "StreamDeck.exe"),
        path.join(process.env["ProgramFiles(x86)"] || "C:/Program Files (x86)", "Elgato", "StreamDeck", "StreamDeck.exe"),
      ];
      const exe = candidates.find((file) => fs.existsSync(file));
      if (!exe) return false;
      spawn(exe, [], { detached: true, stdio: "ignore" }).unref();
      return true;
    }
  } catch {}
  return false;
}

function openFile(file) {
  try {
    if (process.platform === "darwin") spawn("open", [file], { detached: true, stdio: "ignore" }).unref();
    else if (process.platform === "win32") spawn("cmd", ["/c", "start", "", file], { detached: true, stdio: "ignore" }).unref();
    else return false;
    return true;
  } catch {
    return false;
  }
}

/** 既存プロファイルの manifest.json に 3 キーを直接書き込む（バックアップ付き） */
export function applyToCurrentProfile(keys, dryRun) {
  const profiles = detectProfiles();
  const target = pickPrimaryProfile(profiles);
  if (!target) {
    log("! 既存プロファイルが見つからないため、直接書き込みはスキップしました。");
    return false;
  }
  const manifest = JSON.parse(JSON.stringify(target.manifest));
  const generated = buildProfileManifest({ keys });
  manifest.Actions = { ...(manifest.Actions || {}), ...generated.Actions };

  const occupied = keys.filter((key) => (target.manifest.Actions || {})[key.position]);
  if (occupied.length > 0) {
    log(`! 上書きされるキー: ${occupied.map((k) => k.position).join(", ")}（バックアップを作成します）`);
  }
  const backup = `${target.manifestPath}.bak-${Date.now()}`;
  log(`- 書き込み先: ${target.manifestPath}  (プロファイル "${target.name}")`);
  log(`- バックアップ: ${backup}`);
  if (dryRun) return true;
  fs.copyFileSync(target.manifestPath, backup);
  fs.writeFileSync(target.manifestPath, JSON.stringify(manifest, null, 2), "utf8");
  return true;
}

export function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(fs.readFileSync(fileURLToPath(import.meta.url), "utf8").split("*/")[0].replace(/^\/\*\*?/, ""));
    return;
  }

  const keys = parseKeysSpec(args.keys);
  const dataDir = streamDeckDataDir();
  const dest = args.dest ? path.resolve(args.dest) : pluginsDir(dataDir);

  log("== Stream Deck AI Usage Meter セットアップ ==");
  if (!dest) {
    console.error(
      "この OS には Elgato Stream Deck アプリがありません（mac / Windows 用です）。\n" +
        "検証目的なら --dest <ディレクトリ> でコピー先を指定できます。"
    );
    process.exit(2);
  }
  if (!fs.existsSync(SOURCE_PLUGIN)) {
    console.error(`プラグイン本体が見つかりません: ${SOURCE_PLUGIN}`);
    process.exit(2);
  }

  const target = path.join(dest, `${PLUGIN_UUID}.sdPlugin`);
  log(`- プラグイン: ${SOURCE_PLUGIN}`);
  log(`- 導入先    : ${target}`);

  const running = isStreamDeckRunning();
  if (running && args.restart && !args.dryRun) {
    log("- Stream Deck を終了します…");
    quitStreamDeck();
  } else if (running && !args.restart) {
    log("! Stream Deck が起動中です。プラグインを反映するには手動で再起動してください。");
  }

  if (!args.dryRun) {
    fs.mkdirSync(dest, { recursive: true });
    fs.rmSync(target, { recursive: true, force: true });
    fs.cpSync(SOURCE_PLUGIN, target, { recursive: true });
    log("- プラグインをコピーしました。");
  } else {
    log("- (dry-run) コピーは行いません。");
  }

  let profileFile = null;
  if (args.profile) {
    if (args.applyCurrent) {
      applyToCurrentProfile(keys, args.dryRun);
    } else {
      const deviceFields = resolveDeviceFields(args.deviceModel);
      if (!deviceFields) {
        log(
          "! デバイス情報を検出できずプロファイルを作れませんでした。\n" +
            "  Stream Deck アプリを一度起動してから再実行するか、--device-model <型番> を指定してください。\n" +
            "  （プラグイン自体は導入済みなので、手動でキーにドラッグしても使えます）"
        );
      } else {
        const { buffer } = buildProfileArchive({ deviceFields, keys, name: "AI Usage" });
        profileFile = path.join(here, "dist", "AI-Usage.streamDeckProfile");
        if (!args.dryRun) {
          fs.mkdirSync(path.dirname(profileFile), { recursive: true });
          fs.writeFileSync(profileFile, buffer);
        }
        log(`- プロファイルを生成: ${profileFile}`);
        log(`  キー配置: ${keys.map((k) => `${k.position}=${k.provider}/${k.window}`).join(", ")}`);
      }
    }
  }

  if (args.restart && !args.dryRun) {
    log("- Stream Deck を起動します…");
    launchStreamDeck();
  }

  if (profileFile && !args.dryRun) {
    setTimeout(() => {
      openFile(profileFile);
      log("- プロファイルを Stream Deck に取り込みます（ダイアログが出たら「インポート」を選択）。");
    }, 4000).unref?.();
  }

  log("\n完了。キーに何も出ない場合は tools/streamdeck/README.md のトラブルシュートを参照してください。");
  log(`アクション UUID: ${ACTION_UUID}`);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
