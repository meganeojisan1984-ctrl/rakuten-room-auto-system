import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// インストーラの進捗ログを止める（node:test の stdout と混ざらないように）
process.env.AI_USAGE_METER_QUIET = "1";

const STREAMDECK_DIR = path.join(__dirname, "..", "tools", "streamdeck");
const importTool = (relative: string) => import(path.join(STREAMDECK_DIR, relative));

/** ProfilesV2 に既存プロファイルが 1 つある状態の Stream Deck データディレクトリを作る */
function fakeDataDir(existingActions: Record<string, unknown> = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sd-data-"));
  const profileDir = path.join(dir, "ProfilesV2", "ABCDEF.sdProfile");
  fs.mkdirSync(profileDir, { recursive: true });
  fs.writeFileSync(
    path.join(profileDir, "manifest.json"),
    JSON.stringify({ Name: "既存プロファイル", Version: "1.0", Device: { Model: "20GAA9901", UUID: "DEVICE-1" }, Actions: existingActions }, null, 2)
  );
  return { dir, manifestPath: path.join(profileDir, "manifest.json") };
}

async function withDataDir<T>(dir: string, fn: () => Promise<T> | T): Promise<T> {
  const previous = process.env.STREAMDECK_DATA_DIR;
  process.env.STREAMDECK_DATA_DIR = dir;
  try {
    return await fn();
  } finally {
    if (previous === undefined) delete process.env.STREAMDECK_DATA_DIR;
    else process.env.STREAMDECK_DATA_DIR = previous;
  }
}

test("parseKeysSpec: 既定は写真と同じ 3 キー（位置は後で決める）", async () => {
  const { parseKeysSpec } = await importTool("install.mjs");
  const keys = parseKeysSpec(undefined);
  assert.deepEqual(
    keys.map((k: any) => `${k.provider}:${k.window}`),
    ["codex:weekly", "claude:weekly", "claude:5h"]
  );
  assert.equal(keys[0].position, undefined);
});

test("parseKeysSpec: 指定文字列を解釈し、不正値は弾く", async () => {
  const { parseKeysSpec } = await importTool("install.mjs");
  const keys = parseKeysSpec("claude:5h,codex:weekly");
  assert.equal(keys[0].provider, "claude");
  assert.equal(keys[1].provider, "codex");
  assert.throws(() => parseKeysSpec("gemini:weekly"), /不明なサービス/);
  assert.throws(() => parseKeysSpec("codex:daily"), /不明な枠/);
});

test("parseKeysSpec: @列,行 で位置を直接指定できる", async () => {
  const { parseKeysSpec } = await importTool("install.mjs");
  const keys = parseKeysSpec("codex:weekly@0,1,claude:weekly@1,1,claude:5h@2,1");
  assert.deepEqual(keys.map((k: any) => k.position), ["0,1", "1,1", "2,1"]);
  assert.throws(() => parseKeysSpec("codex:weekly@x"), /不明な位置指定/);
});

test("guessLayout: 既存キーから盤面サイズを推測する（最低 5x3）", async () => {
  const { guessLayout } = await importTool("install.mjs");
  assert.deepEqual(guessLayout({}), { columns: 5, rows: 3 });
  assert.deepEqual(guessLayout({ "7,3": {} }), { columns: 8, rows: 4 });
});

test("placeKeys: 空いている行を自動で探して並べる", async () => {
  const { parseKeysSpec, placeKeys } = await importTool("install.mjs");
  // スクリーンショットと同じ状況: 1 行目と 3 行目が埋まり、2 行目が空き
  const actions = Object.fromEntries(
    ["0,0", "1,0", "2,0", "3,0", "4,0", "0,2", "1,2", "2,2", "3,2", "4,2"].map((p) => [p, { UUID: "com.example.other" }])
  );
  const placement = placeKeys(parseKeysSpec(undefined), actions);
  assert.deepEqual(placement.keys.map((k: any) => k.position), ["0,1", "1,1", "2,1"]);
  assert.deepEqual(placement.overwrites, [], "使用中のキーは踏まない");
});

test("placeKeys: 行を指定した場合は既存キーの上書きを報告する", async () => {
  const { parseKeysSpec, placeKeys } = await importTool("install.mjs");
  const actions = { "1,0": { UUID: "com.example.other" } };
  const placement = placeKeys(parseKeysSpec(undefined), actions, { row: 0 });
  assert.deepEqual(placement.keys.map((k: any) => k.position), ["0,0", "1,0", "2,0"]);
  assert.deepEqual(placement.overwrites, ["1,0"]);
});

test("placeKeys: 連続した空きが無ければ null を返す", async () => {
  const { parseKeysSpec, placeKeys } = await importTool("install.mjs");
  const actions: Record<string, unknown> = {};
  for (let row = 0; row < 3; row++) for (let col = 0; col < 5; col++) actions[`${col},${row}`] = { UUID: "x" };
  assert.equal(placeKeys(parseKeysSpec(undefined), actions), null);
});

test("buildProfileManifest: キー位置ごとにアクションと設定を並べる", async () => {
  const { buildProfileManifest } = await importTool("scripts/make-profile.mjs");
  const manifest = buildProfileManifest({ deviceFields: { Device: { Model: "20GAA9901", UUID: "X" } } });
  assert.deepEqual(Object.keys(manifest.Actions), ["0,0", "1,0", "2,0"]);
  assert.equal(manifest.Actions["0,0"].UUID, "jp.rakutenroom.aiusage.meter");
  assert.equal(manifest.Actions["0,0"].Settings.provider, "codex");
  assert.equal(manifest.Actions["2,0"].Settings.window, "5h");
  assert.equal(manifest.Device.Model, "20GAA9901");
});

test("buildProfileArchive: ZIP 形式の .streamDeckProfile を作る", async () => {
  const { buildProfileArchive } = await importTool("scripts/make-profile.mjs");
  const { buffer, folder } = buildProfileArchive({ deviceFields: { DeviceModel: "20GAA9901" } });
  assert.equal(buffer.subarray(0, 2).toString("ascii"), "PK", "ZIP シグネチャ");
  assert.ok(buffer.includes(Buffer.from(`${folder}/manifest.json`, "utf8")), "manifest.json を含む");
  assert.ok(folder.endsWith(".sdProfile"));
});

test("resolveDeviceFields: 既存プロファイルからデバイス情報を引き継ぐ", async () => {
  const { dir } = fakeDataDir();
  const { resolveDeviceFields } = await importTool("scripts/make-profile.mjs");
  try {
    const fields = await withDataDir(dir, () => resolveDeviceFields());
    assert.deepEqual(fields, { Device: { Model: "20GAA9901", UUID: "DEVICE-1" } });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("applyToCurrentProfile: 既存キーを残したまま 3 キーを追記し、バックアップを作る", async () => {
  const { dir, manifestPath } = fakeDataDir({ "4,2": { Name: "既存ボタン", UUID: "com.example.other" } });
  const { applyToCurrentProfile, parseKeysSpec } = await importTool("install.mjs");
  try {
    const applied = await withDataDir(dir, () => applyToCurrentProfile(parseKeysSpec(undefined), false));
    assert.equal(applied, true);

    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    assert.equal(manifest.Actions["4,2"].UUID, "com.example.other", "既存キーは残る");
    assert.equal(manifest.Actions["0,0"].UUID, "jp.rakutenroom.aiusage.meter");
    assert.equal(manifest.Actions["1,0"].Settings.provider, "claude");
    assert.equal(manifest.Name, "既存プロファイル", "プロファイル名は変えない");
    assert.equal(manifest.Device.UUID, "DEVICE-1", "デバイス指定は変えない");

    const backups = fs.readdirSync(path.dirname(manifestPath)).filter((f) => f.includes("manifest.json.bak-"));
    assert.equal(backups.length, 1, "バックアップが 1 つ作られる");
    const backup = JSON.parse(fs.readFileSync(path.join(path.dirname(manifestPath), backups[0]), "utf8"));
    assert.equal(Object.keys(backup.Actions).length, 1, "バックアップは書き込み前の内容");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("applyToCurrentProfile: dry-run ではファイルを書き換えない", async () => {
  const { dir, manifestPath } = fakeDataDir();
  const { applyToCurrentProfile, parseKeysSpec } = await importTool("install.mjs");
  const before = fs.readFileSync(manifestPath, "utf8");
  try {
    await withDataDir(dir, () => applyToCurrentProfile(parseKeysSpec(undefined), true));
    assert.equal(fs.readFileSync(manifestPath, "utf8"), before);
    assert.equal(fs.readdirSync(path.dirname(manifestPath)).length, 1, "バックアップも作られない");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("applyToCurrentProfile: プロファイルが無ければ false を返して何もしない", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sd-empty-"));
  const { applyToCurrentProfile, parseKeysSpec } = await importTool("install.mjs");
  try {
    assert.equal(await withDataDir(dir, () => applyToCurrentProfile(parseKeysSpec(undefined), false)), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("applyToCurrentProfile: 使用中プロファイルの空き行（2段目）に配置する", async () => {
  // スクリーンショットの Default Profile 相当: 1 段目=モニタ系, 3 段目=音量系, 2 段目が空き
  const occupied = ["0,0", "1,0", "2,0", "3,0", "4,0", "0,2", "1,2", "2,2", "3,2", "4,2"];
  const { dir, manifestPath } = fakeDataDir(Object.fromEntries(occupied.map((p) => [p, { Name: p, UUID: "com.example.other" }])));
  const { applyToCurrentProfile, parseKeysSpec } = await importTool("install.mjs");
  try {
    assert.equal(await withDataDir(dir, () => applyToCurrentProfile(parseKeysSpec(undefined), false)), true);
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    for (const position of occupied) {
      assert.equal(manifest.Actions[position].UUID, "com.example.other", `${position} は元のまま`);
    }
    assert.equal(manifest.Actions["0,1"].Settings.provider, "codex");
    assert.equal(manifest.Actions["1,1"].Settings.provider, "claude");
    assert.equal(manifest.Actions["2,1"].Settings.window, "5h");
    assert.equal(manifest.Actions["3,1"], undefined, "余った空きキーは触らない");
    assert.equal(Object.keys(manifest.Actions).length, occupied.length + 3);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("applyToCurrentProfile: --profile で書き込み先を名前指定できる", async () => {
  const { dir } = fakeDataDir();
  const second = path.join(dir, "ProfilesV2", "XYZ.sdProfile");
  fs.mkdirSync(second, { recursive: true });
  fs.writeFileSync(
    path.join(second, "manifest.json"),
    JSON.stringify({ Name: "配信用", Version: "1.0", Device: { Model: "20GAA9901", UUID: "DEVICE-1" }, Actions: {} })
  );
  const { applyToCurrentProfile, parseKeysSpec } = await importTool("install.mjs");
  try {
    const ok = await withDataDir(dir, () => applyToCurrentProfile(parseKeysSpec(undefined), false, { profileName: "配信用" }));
    assert.equal(ok, true);
    const manifest = JSON.parse(fs.readFileSync(path.join(second, "manifest.json"), "utf8"));
    assert.equal(manifest.Actions["0,0"].UUID, "jp.rakutenroom.aiusage.meter");
    // 名前が一致しない場合は何もしない
    assert.equal(await withDataDir(dir, () => applyToCurrentProfile(parseKeysSpec(undefined), false, { profileName: "存在しない" })), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
