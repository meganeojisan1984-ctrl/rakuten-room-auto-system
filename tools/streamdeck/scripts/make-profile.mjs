#!/usr/bin/env node
/**
 * 写真と同じ 3 キー（CODEX 週間 / CLAUDE 週間 / CLAUDE 5時間）を配置した
 * Stream Deck プロファイル（.streamDeckProfile）を生成する。
 *
 *   node tools/streamdeck/scripts/make-profile.mjs [--out <file>] [--device-model <model>]
 *
 * デバイス種別は既存プロファイルから複製するため、Stream Deck アプリを
 * 一度でも起動していれば自動で合う。
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { createZip } from "./zip.mjs";
import { ACTION_UUID, detectProfiles, isEntrypoint, pickPrimaryProfile } from "./streamdeck-paths.mjs";

/** 写真と同じ並び。左から Codex 週間 → Claude 週間 → Claude 5時間 */
export const DEFAULT_KEYS = [
  { label: "CODEX", provider: "codex", window: "weekly" },
  { label: "CLAUDE", provider: "claude", window: "weekly" },
  { label: "CLAUDE", provider: "claude", window: "5h" },
];

/**
 * 位置未指定のキーに "列,行" を順番に割り当てる（既に position があればそのまま）。
 * @param {object[]} keys
 * @param {{row?: number, startCol?: number}} [options]
 */
export function assignPositions(keys, options = {}) {
  const row = options.row ?? 0;
  const startCol = options.startCol ?? 0;
  let next = startCol;
  return keys.map((key) => (key.position ? key : { ...key, position: `${next++},${row}` }));
}

const uuid = () => crypto.randomUUID().toUpperCase().replace(/-/g, "");

function actionEntry(key) {
  return {
    ActionID: uuid(),
    Name: "AI 使用量",
    Settings: {
      provider: key.provider,
      window: key.window,
      label: key.label,
      lang: key.lang || "ja",
      refreshSeconds: key.refreshSeconds || 60,
    },
    State: 0,
    States: [
      {
        FFamily: "",
        FSize: "",
        FStyle: "",
        FUnderline: "",
        Title: "",
        TitleAlignment: "middle",
        TitleColor: "#ffffff",
        TitleShow: "",
      },
    ],
    UUID: ACTION_UUID,
  };
}

/**
 * プロファイル manifest を組み立てる。
 * @param {{deviceFields?: object, name?: string, keys?: object[]}} options
 */
export function buildProfileManifest(options = {}) {
  const keys = assignPositions(options.keys || DEFAULT_KEYS, { row: options.row, startCol: options.startCol });
  const actions = {};
  for (const key of keys) actions[key.position] = actionEntry(key);
  return {
    Name: options.name || "AI Usage",
    Version: "1.0",
    ...(options.deviceFields || {}),
    Actions: actions,
  };
}

/** @returns {{buffer: Buffer, manifest: object, folder: string}} */
export function buildProfileArchive(options = {}) {
  const manifest = buildProfileManifest(options);
  const folder = `${uuid()}.sdProfile`;
  const buffer = createZip([{ name: `${folder}/manifest.json`, data: Buffer.from(JSON.stringify(manifest, null, 2), "utf8") }]);
  return { buffer, manifest, folder };
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--out") args.out = argv[++i];
    else if (argv[i] === "--device-model") args.deviceModel = argv[++i];
    else if (argv[i] === "--name") args.name = argv[++i];
  }
  return args;
}

/** 既存プロファイルからデバイス指定を拝借する（失敗したら null） */
export function resolveDeviceFields(deviceModelOverride) {
  if (deviceModelOverride) return { Device: { Model: deviceModelOverride, UUID: "" }, DeviceModel: deviceModelOverride };
  const primary = pickPrimaryProfile(detectProfiles());
  if (!primary || Object.keys(primary.device).length === 0) return null;
  return primary.device;
}

if (isEntrypoint(import.meta.url)) {
  const args = parseArgs(process.argv.slice(2));
  const deviceFields = resolveDeviceFields(args.deviceModel);
  if (!deviceFields) {
    console.error(
      "既存プロファイルからデバイス情報を検出できませんでした。\n" +
        "Stream Deck アプリを一度起動してから再実行するか、--device-model <型番> を指定してください。"
    );
    process.exit(2);
  }
  const { buffer, manifest, folder } = buildProfileArchive({ deviceFields, name: args.name });
  const out = path.resolve(args.out || path.join(process.cwd(), "AI-Usage.streamDeckProfile"));
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, buffer);
  console.log(`プロファイルを書き出しました: ${out}`);
  console.log(`  デバイス: ${JSON.stringify(manifest.Device ?? manifest.DeviceModel ?? "(不明)")}`);
  console.log(`  キー: ${Object.keys(manifest.Actions).join(" / ")}  (${folder})`);
}
