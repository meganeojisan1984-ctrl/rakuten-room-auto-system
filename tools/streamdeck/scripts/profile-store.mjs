/**
 * プロファイルのキー（Actions）がどこに保存されているかを吸収するレイヤ。
 *
 * - V2 まで: <profile>.sdProfile/manifest.json の Actions
 * - V3 (Stream Deck 7.x): <profile>.sdProfile/Profiles/<ページID>/manifest.json の
 *   Controllers[n].Actions（プロファイル側 manifest.json にはページ ID の一覧しか無い）
 */
import fs from "node:fs";
import path from "node:path";

/** 大文字小文字を無視してディレクトリを探す（ページ ID は manifest と実体で表記が異なる） */
function findDirInsensitive(parent, name) {
  if (!parent || !name) return null;
  const direct = path.join(parent, name);
  try {
    if (fs.statSync(direct).isDirectory()) return direct;
  } catch {}
  let entries;
  try {
    entries = fs.readdirSync(parent, { withFileTypes: true });
  } catch {
    return null;
  }
  const lower = name.toLowerCase();
  const hit = entries.find((entry) => entry.isDirectory() && entry.name.toLowerCase() === lower);
  return hit ? path.join(parent, hit.name) : null;
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function backupAndWrite(file, data, dryRun) {
  const backup = `${file}.bak-${Date.now()}`;
  if (!dryRun) {
    if (fs.existsSync(file)) fs.copyFileSync(file, backup);
    fs.writeFileSync(file, JSON.stringify(data, null, 2), "utf8");
  }
  return backup;
}

/** V3: 表示中のページ（Current → Default → 先頭）の manifest を開く */
function resolveV3(profile) {
  const pages = profile.manifest.Pages || {};
  const pageId = pages.Current || pages.Default || (Array.isArray(pages.Pages) ? pages.Pages[0] : null);
  if (!pageId) return null;

  const pagesDir = findDirInsensitive(profile.dir, "Profiles");
  const pageDir = findDirInsensitive(pagesDir, pageId);
  if (!pageDir) return null;

  const pageManifestPath = path.join(pageDir, "manifest.json");
  const pageManifest = readJson(pageManifestPath);
  if (!pageManifest || !Array.isArray(pageManifest.Controllers) || pageManifest.Controllers.length === 0) return null;

  // キーパッド（キー）を持つコントローラを選ぶ。Type 未指定なら先頭を使う
  let index = pageManifest.Controllers.findIndex((controller) => controller && controller.Type === "Keypad");
  if (index < 0) index = 0;
  const controller = pageManifest.Controllers[index];
  if (!controller || typeof controller !== "object") return null;

  return {
    kind: "v3",
    pageId,
    path: pageManifestPath,
    actions: controller.Actions && typeof controller.Actions === "object" ? controller.Actions : {},
    write(nextActions, dryRun = false) {
      pageManifest.Controllers[index] = { ...controller, Actions: nextActions };
      return backupAndWrite(pageManifestPath, pageManifest, dryRun);
    },
  };
}

/** V2 以前: プロファイル直下の manifest.json の Actions */
function resolveV2(profile) {
  const actions = profile.manifest.Actions;
  if (!actions || typeof actions !== "object" || Array.isArray(actions)) return null;
  return {
    kind: "v2",
    path: profile.manifestPath,
    actions,
    write(nextActions, dryRun = false) {
      return backupAndWrite(profile.manifestPath, { ...profile.manifest, Actions: nextActions }, dryRun);
    },
  };
}

/**
 * キーの読み書き口を返す。形式が判別できなければ null。
 * @param {{dir: string, manifestPath: string, manifest: object}} profile
 */
export function resolveKeyStore(profile) {
  if (!profile || !profile.manifest) return null;
  if (String(profile.manifest.Version || "").startsWith("3")) return resolveV3(profile);
  return resolveV2(profile) || resolveV3(profile);
}

/** 表示用のキー数（形式を問わず） */
export function countActions(profile) {
  const store = resolveKeyStore(profile);
  return store ? Object.keys(store.actions).length : 0;
}
