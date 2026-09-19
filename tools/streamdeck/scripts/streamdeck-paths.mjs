/**
 * Stream Deck アプリのデータ配置を OS ごとに解決するユーティリティ。
 */
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const PLUGIN_UUID = "jp.rakutenroom.aiusage";
export const ACTION_UUID = "jp.rakutenroom.aiusage.meter";

/**
 * Stream Deck のデータディレクトリ（存在しなくてもパスは返す）。
 * 非標準の場所にインストールしている場合とテスト用に STREAMDECK_DATA_DIR で上書きできる。
 */
export function streamDeckDataDir() {
  if (process.env.STREAMDECK_DATA_DIR) return process.env.STREAMDECK_DATA_DIR;
  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support", "com.elgato.StreamDeck");
  }
  if (process.platform === "win32") {
    const appData = process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming");
    return path.join(appData, "Elgato", "StreamDeck");
  }
  return null; // Linux に公式アプリは無い
}

export function pluginsDir(dataDir = streamDeckDataDir()) {
  return dataDir ? path.join(dataDir, "Plugins") : null;
}

const isDir = (p) => {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
};

/** ProfilesV2 / Profiles ディレクトリを新しい方から列挙 */
export function profilesRoots(dataDir = streamDeckDataDir()) {
  if (!dataDir) return [];
  return ["ProfilesV2", "Profiles"].map((name) => path.join(dataDir, name)).filter(isDir);
}

// 走査しても無駄なディレクトリ（巨大 or プロファイルを含まない）
const SKIP_DIRS = new Set(["Plugins", "logs", "Logs", "node_modules", "CustomImages", "Temp", "Cache"]);

/**
 * `*.sdProfile`（manifest.json を持つディレクトリ）を再帰的に探す。
 * Stream Deck のバージョンによって ProfilesV2 直下だったりデバイス別だったりするため、
 * 決め打ちせずデータディレクトリ配下を掘る。
 */
export function findProfileDirs(root, depth = 0, results = []) {
  if (!root || depth > 4) return results;
  let entries;
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return results;
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(root, entry.name);
    if (entry.name.endsWith(".sdProfile")) {
      if (isDir(full) && fs.existsSync(path.join(full, "manifest.json"))) results.push(full);
      continue; // プロファイル内は掘らない（入れ子プロファイル対策）
    }
    findProfileDirs(full, depth + 1, results);
  }
  return results;
}

/** 既存プロファイルの manifest.json を読み、デバイス情報を集める */
export function detectProfiles(dataDir = streamDeckDataDir()) {
  const found = [];
  for (const dir of findProfileDirs(dataDir)) {
    const manifestPath = path.join(dir, "manifest.json");
    let manifest;
    try {
      manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    } catch {
      continue;
    }
    found.push({
      root: path.dirname(dir),
      dir,
      manifestPath,
      manifest,
      name: manifest.Name || path.basename(dir),
      device: deviceFields(manifest),
      actionCount: Object.keys(manifest.Actions || {}).length,
    });
  }
  return found;
}

/**
 * プロファイル manifest からデバイス指定に関わるキーだけを抜き出す。
 * Stream Deck のバージョンで "Device": {...} だったり "DeviceModel" だったりするため、
 * 既存ファイルの書式をそのまま複製する方針にしている。
 */
export function deviceFields(manifest) {
  const fields = {};
  for (const key of ["Device", "DeviceModel", "DeviceUUID", "DeviceType"]) {
    if (manifest && manifest[key] !== undefined) fields[key] = manifest[key];
  }
  return fields;
}

/** 配置先として最有力の既存プロファイル（アクション数が多い＝実際に使っているもの） */
export function pickPrimaryProfile(profiles) {
  if (profiles.length === 0) return null;
  return [...profiles].sort((a, b) => b.actionCount - a.actionCount)[0];
}

export function isStreamDeckRunning() {
  try {
    if (process.platform === "darwin") {
      return execSync("pgrep -x 'Stream Deck' || true", { encoding: "utf8" }).trim().length > 0;
    }
    if (process.platform === "win32") {
      const out = execSync('tasklist /FI "IMAGENAME eq StreamDeck.exe" /NH', { encoding: "utf8" });
      return /StreamDeck\.exe/i.test(out);
    }
  } catch {}
  return false;
}

/**
 * そのファイルが「node で直接実行された」かどうか。
 * import.meta.url と argv[1] の単純な文字列比較は Windows で必ず不一致になる
 * （file:///C:/... と C:\... を比べることになる）ため、パスに正規化して比較する。
 */
export function isEntrypoint(importMetaUrl, argv1 = process.argv[1]) {
  if (!importMetaUrl || !argv1) return false;
  try {
    return path.resolve(fileURLToPath(importMetaUrl)) === path.resolve(argv1);
  } catch {
    return false;
  }
}
