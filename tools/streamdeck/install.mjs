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
 *                  位置も指定できる (例: "codex:weekly@0,1")
 *   --row <n>      配置する行を指定（0 始まり）。未指定なら空いている行を自動で探す
 *   --col <n>      配置を始める列（0 始まり・既定 0）
 *   --profile <名> 書き込む既存プロファイルを名前で指定（--apply-current 用）
 */
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { assignPositions, buildProfileArchive, DEFAULT_KEYS, buildProfileManifest, resolveDeviceFields } from "./scripts/make-profile.mjs";
import {
  ACTION_UUID,
  PLUGIN_UUID,
  detectProfiles,
  isEntrypoint,
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
    else if (a === "--row") args.row = Number(argv[++i]);
    else if (a === "--col") args.startCol = Number(argv[++i]);
    else if (a === "--profile") args.profileName = argv[++i];
    else if (a === "--device-model") args.deviceModel = argv[++i];
    else if (a === "--help" || a === "-h") args.help = true;
  }
  return args;
}

/**
 * "codex:weekly,claude:5h" → キー定義。"codex:weekly@0,1" のように位置も指定できる。
 * 位置を省略したキーの配置は後段（assignPositions / placeKeys）で決める。
 */
export function parseKeysSpec(spec) {
  if (!spec) return DEFAULT_KEYS;
  // "@列,行" を含むためキー同士の区切りは , ではなく分割後に補正する
  const parts = spec.split(",").reduce((acc, chunk) => {
    if (/^\d+$/.test(chunk.trim()) && acc.length > 0 && acc[acc.length - 1].includes("@")) {
      acc[acc.length - 1] += `,${chunk.trim()}`; // "@0" + "1" → "@0,1"
    } else {
      acc.push(chunk.trim());
    }
    return acc;
  }, []);

  return parts.map((part) => {
    const [body, position] = part.split("@");
    const [provider, window] = body.split(":");
    if (!["codex", "claude"].includes(provider)) throw new Error(`不明なサービス: ${provider}`);
    if (!["weekly", "5h", "weekly_opus"].includes(window)) throw new Error(`不明な枠: ${window}`);
    if (position !== undefined && !/^\d+,\d+$/.test(position)) throw new Error(`不明な位置指定: ${position}`);
    return { ...(position ? { position } : {}), label: provider.toUpperCase(), provider, window };
  });
}

/** 既存アクションから盤面サイズ（列数・行数）を推測する。分からなければ 15 キー相当 */
export function guessLayout(actions) {
  let columns = 0;
  let rows = 0;
  for (const position of Object.keys(actions || {})) {
    const [col, row] = position.split(",").map(Number);
    if (Number.isFinite(col)) columns = Math.max(columns, col + 1);
    if (Number.isFinite(row)) rows = Math.max(rows, row + 1);
  }
  return { columns: Math.max(columns, 5), rows: Math.max(rows, 3) };
}

/**
 * 既存プロファイルの空きに合わせてキー位置を決める。
 * --row 未指定なら、必要数だけ連続して空いている場所を上の行から探す。
 * @returns {{keys: object[], overwrites: string[]}|null}
 */
export function placeKeys(keys, actions, options = {}) {
  const existing = actions || {};
  const startCol = options.startCol ?? 0;
  const free = (col, row) => !existing[`${col},${row}`];

  // 位置が明示されているキーはそのまま使う
  if (keys.every((key) => key.position)) {
    return { keys, overwrites: keys.filter((key) => existing[key.position]).map((key) => key.position) };
  }

  if (options.row !== undefined && Number.isFinite(options.row)) {
    const placed = assignPositions(keys, { row: options.row, startCol });
    return { keys: placed, overwrites: placed.filter((key) => existing[key.position]).map((key) => key.position) };
  }

  const { columns, rows } = guessLayout(existing);
  for (let row = 0; row < rows; row++) {
    for (let col = startCol; col + keys.length <= columns; col++) {
      if (!keys.every((_, index) => free(col + index, row))) continue;
      return { keys: assignPositions(keys, { row, startCol: col }), overwrites: [] };
    }
  }
  return null;
}

// AI_USAGE_METER_QUIET=1 で静かにする（テストから呼ぶとき用）
const log = (message) => {
  if (!process.env.AI_USAGE_METER_QUIET) console.log(message);
};

function quitStreamDeck() {
  try {
    if (process.platform === "darwin") execFileSync("osascript", ["-e", 'quit app "Stream Deck"'], { stdio: "ignore" });
    else if (process.platform === "win32") execFileSync("taskkill", ["/IM", "StreamDeck.exe", "/F"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/** 起動に失敗してもプロセスを落とさないよう error を握りつぶして detach する */
function spawnDetached(command, args, options = {}) {
  const child = spawn(command, args, { detached: true, stdio: "ignore", ...options });
  child.on("error", () => {}); // EACCES などで 'error' が投げっぱなしになるのを防ぐ
  child.unref();
  return child;
}

function launchStreamDeck() {
  try {
    if (process.platform === "darwin") {
      spawnDetached("open", ["-a", "Stream Deck"]);
      return true;
    }
    if (process.platform === "win32") {
      const candidates = [
        path.join(process.env["ProgramFiles"] || "C:/Program Files", "Elgato", "StreamDeck", "StreamDeck.exe"),
        path.join(process.env["ProgramFiles(x86)"] || "C:/Program Files (x86)", "Elgato", "StreamDeck", "StreamDeck.exe"),
      ];
      const exe = candidates.find((file) => fs.existsSync(file));
      if (!exe) return false;
      // exe を直接 spawn すると環境によって EACCES になるため cmd の start 経由で起動する
      spawnDetached("cmd", ["/c", "start", "", exe], { windowsHide: true });
      return true;
    }
  } catch {}
  return false;
}

function openFile(file) {
  try {
    if (process.platform === "darwin") spawnDetached("open", [file]);
    else if (process.platform === "win32") spawnDetached("cmd", ["/c", "start", "", file], { windowsHide: true });
    else return false;
    return true;
  } catch {
    return false;
  }
}

/**
 * 既存プロファイルの manifest.json にキーを直接書き込む（バックアップ付き）。
 * 位置指定が無ければ空いている行を自動で探すので、使用中のキーは踏まない。
 */
export function applyToCurrentProfile(keys, dryRun, options = {}) {
  const profiles = detectProfiles();
  const target = options.profileName
    ? profiles.find((p) => p.name === options.profileName)
    : pickPrimaryProfile(profiles);
  if (!target) {
    if (options.profileName) {
      log(`! プロファイル "${options.profileName}" が見つかりません。検出済み: ${profiles.map((p) => p.name).join(" / ") || "なし"}`);
    } else {
      log("! 既存プロファイルが見つからないため、直接書き込みはスキップしました。");
    }
    return false;
  }

  const existing = target.manifest.Actions || {};
  const placement = placeKeys(keys, existing, { row: options.row, startCol: options.startCol });
  if (!placement) {
    log(
      `! プロファイル "${target.name}" に ${keys.length} 個ぶんの連続した空きキーが見つかりませんでした。\n` +
        "  --row <行> や --keys \"codex:weekly@0,1,...\" で配置先を指定してください。"
    );
    return false;
  }

  const manifest = JSON.parse(JSON.stringify(target.manifest));
  const generated = buildProfileManifest({ keys: placement.keys });
  manifest.Actions = { ...existing, ...generated.Actions };

  log(`- 書き込み先: ${target.manifestPath}  (プロファイル "${target.name}")`);
  log(`- キー配置  : ${placement.keys.map((k) => `${k.position}=${k.provider}/${k.window}`).join(", ")}`);
  if (placement.overwrites.length > 0) log(`! 上書きされるキー: ${placement.overwrites.join(", ")}`);
  const backup = `${target.manifestPath}.bak-${Date.now()}`;
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
      applyToCurrentProfile(keys, args.dryRun, { row: args.row, startCol: args.startCol, profileName: args.profileName });
    } else {
      const deviceFields = resolveDeviceFields(args.deviceModel);
      if (!deviceFields) {
        log(
          "! デバイス情報を検出できずプロファイルを作れませんでした。\n" +
            "  Stream Deck アプリを一度起動してから再実行するか、--device-model <型番> を指定してください。\n" +
            "  （プラグイン自体は導入済みなので、手動でキーにドラッグしても使えます）"
        );
      } else {
        const placed = assignPositions(keys, { row: args.row ?? 0, startCol: args.startCol ?? 0 });
        const { buffer } = buildProfileArchive({ deviceFields, keys: placed, name: "AI Usage" });
        profileFile = path.join(here, "dist", "AI-Usage.streamDeckProfile");
        if (!args.dryRun) {
          fs.mkdirSync(path.dirname(profileFile), { recursive: true });
          fs.writeFileSync(profileFile, buffer);
        }
        log(`- プロファイルを生成: ${profileFile}`);
        log(`  キー配置: ${placed.map((k) => `${k.position}=${k.provider}/${k.window}`).join(", ")}`);
      }
    }
  }

  if (args.restart && !args.dryRun) {
    log("- Stream Deck を起動します…");
    if (!launchStreamDeck()) log("! 自動起動できませんでした。Stream Deck を手動で起動してください。");
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

if (isEntrypoint(import.meta.url)) main();
