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

/** .sdProfile 配下のファイル構成を列挙する（V3 はページごとに別ファイルを持つ） */
function walk(root, depth = 0, results = [], base = root) {
  if (depth > 3) return results;
  let entries;
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return results;
  }
  for (const entry of entries) {
    const full = path.join(root, entry.name);
    results.push({ relative: path.relative(base, full), dir: entry.isDirectory(), full });
    if (entry.isDirectory()) walk(full, depth + 1, results, base);
  }
  return results;
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

  // ページごとのファイル（V3）を探して、キーがどこに入っているかを突き止める
  const files = walk(profile.dir).filter((f) => !f.relative.includes(".bak-"));
  console.log(`  ファイル構成 (${files.length} 件):`);
  for (const file of files.slice(0, 30)) console.log(`     ${file.dir ? "[dir] " : "      "}${file.relative}`);
  if (files.length > 30) console.log(`     … 他 ${files.length - 30} 件`);

  for (const file of files.filter((f) => !f.dir && f.full !== profile.manifestPath).slice(0, 3)) {
    let json;
    try {
      json = JSON.parse(fs.readFileSync(file.full, "utf8"));
    } catch {
      continue;
    }
    console.log(`  --- ${file.relative} ---`);
    for (const [key, value] of Object.entries(json)) console.log(`     ${key}: ${shape(value)}`);
    const actions = json.Actions || json.Controllers;
    if (actions && typeof actions === "object") {
      for (const [position, action] of Object.entries(actions).slice(0, 4)) {
        console.log(`       ${position}: ${action && action.UUID ? action.UUID : shape(action)}`);
      }
    }
  }

  if (full) {
    console.log("--- JSON（先頭 4000 文字）---");
    console.log(JSON.stringify(profile.manifest, null, 1).slice(0, 4000));
  }
}
