#!/usr/bin/env node
/**
 * プロファイル manifest の構造を要約表示する（Stream Deck のバージョン差異を調べる用）。
 *
 *   node tools/streamdeck/scripts/dump-profile.mjs [--full]
 *
 * 既定では構造の要約のみ。--full で先頭 4000 文字の JSON も出す。
 */
import fs from "node:fs";
import path from "node:path";

import { detectProfiles, streamDeckDataDir } from "./streamdeck-paths.mjs";

const full = process.argv.includes("--full");

/** 値の形を 1 行で表す */
function shape(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return `配列(${value.length})`;
  if (typeof value === "object") {
    const keys = Object.keys(value);
    return `オブジェクト(${keys.length}) 例: ${keys.slice(0, 6).join(", ")}${keys.length > 6 ? " …" : ""}`;
  }
  return `${typeof value}: ${JSON.stringify(value)}`;
}

const dataDir = streamDeckDataDir();
console.log(`データディレクトリ: ${dataDir}`);

const profiles = detectProfiles();
if (profiles.length === 0) {
  console.log("プロファイルが見つかりません。");
  process.exit(1);
}

for (const profile of profiles) {
  console.log(`\n=== ${profile.name} ===`);
  console.log(`パス: ${profile.manifestPath}`);
  console.log(`バックアップ: ${fs.readdirSync(profile.dir).filter((f) => f.includes(".bak-")).join(", ") || "なし"}`);
  for (const [key, value] of Object.entries(profile.manifest)) {
    console.log(`  ${key}: ${shape(value)}`);
  }

  // キーがどこに入っているか（Actions / Controllers いずれの形式か）を推定して 1 件だけ中身を見せる
  const actions = profile.manifest.Actions;
  if (actions && typeof actions === "object") {
    const entries = Object.entries(actions);
    console.log(`  → Actions: ${entries.length} 件`);
    for (const [position, action] of entries.slice(0, 3)) {
      console.log(`     ${position}: ${action && action.UUID ? action.UUID : shape(action)}`);
    }
  }
  const controllers = profile.manifest.Controllers;
  if (controllers) console.log(`  → Controllers: ${shape(controllers)}`);

  if (full) {
    console.log("--- JSON（先頭 4000 文字）---");
    console.log(JSON.stringify(profile.manifest, null, 1).slice(0, 4000));
  }
}
