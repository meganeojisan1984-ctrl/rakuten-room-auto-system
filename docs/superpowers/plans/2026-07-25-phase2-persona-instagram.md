# Phase 2: ペルソナ定義 × Instagram 特化 × 3スロット並行投稿 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 3価格帯ペルソナ（低単価高回転 / 中単価QOL / 高単価ふるさと納税）を並行運用し、Instagram を主戦場に据える。楽天ROOM は 5→2投稿/日 に削減。各投稿を slot 属性でタグ付けし、Phase 3 の実売スコア切替で「どのスロットが売れたか」を集計可能にする。

**Architecture:** (1) `src/persona/persona.ts` に 3 slot の定義（口調・ジャンル・#タグ・CTA）を集約。`activeSlot: 'multi'|'slot0'|'slot1'|'slot2'` で複数運用/勝者集中を切替。(2) `src/persona/slot-rotator.ts` が JST時刻から本回の担当 slot を返す（multi 時 08→slot0/13→slot1/21→slot2、確定 slot 時は常にその slot）。(3) `src/ig/ig-post-engine.ts` に persona 引数を追加し、キャプション末尾に slot 固有 #タグ + CTA を挿入。(4) `src/main.ts` は slot を解決 → その slot の genre whitelist で fetcher を呼び → generator/poster/promoter に slot を伝搬 → PostRecord に `slot` + `itemCodeHash` (sha1(shopName|itemName)[0:12]) を記録。(5) auto-post.yml の cron を 5回/日 → 3回/日 (08/13/21 JST)。うち 08 と 21 のみ ROOM 投稿、13 は IG のみ。

**Tech Stack:** TypeScript / Playwright / Instagram Graph API (既存) / `node:test`

## Global Constraints

- 対象リポジトリ: `E:\rakuten-room-auto-system`
- Node.js `20` 系、依存追加禁止（既存 dependencies のみ利用）
- **`itemCodeHash` は Phase 1 の `deriveItemCode(shopName, itemName)` と一致させる** — attribution join のキー。src/affiliate/report-parser.ts の関数を再利用
- ペルソナ切替 (`activeSlot`) は persona.json の変更のみで Phase 4 に到達可能（コード変更不要）
- slot 別 trackingId は本 Phase では未反映（楽天ROOM 経由の投稿はすべて `計測ID=楽天ROOM` になる仕様上、Phase 2 では attribution は post_history × sales JOIN 経由で行い、trackingId 分離は Phase 4 以降で楽天アフィリの「サイト」機能を使って実現する）
- 全 commit は日本語メッセージ + `Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>` 付与
- 全 push は `bash tools/safe-push.sh`
- スペック本体: [../specs/2026-07-25-rakuten-room-rebuild-sales-driven-design.md](../specs/2026-07-25-rakuten-room-rebuild-sales-driven-design.md) 第4章・第5章・第6.1章・第6.2章
- Phase 0/1 完了前提

---

## File Structure

**新規:**
- `src/persona/persona.ts` — 型 + `loadPersona()` / `savePersona()` / `getSlot(id)`
- `src/persona/persona.json` — 3 slot データ
- `src/persona/slot-rotator.ts` — JST時刻 + activeSlot から本回の slot を返す
- `src/ig/ig-post-engine.ts` — persona 引数を受ける新 IG 投稿関数（内部は既存 postToInstagram のロジックを流用、末尾 CTA と #タグを差し替え）
- `src/attribution/attribute.ts` — post_history × sales-db を JOIN して slot 別 reward を集計
- `tests/slot-rotator.test.ts`
- `tests/persona.test.ts`
- `tests/attribute.test.ts`

**変更:**
- `src/fetcher.ts` — `fetchItems(count, excludeCodes, genreWhitelist?)` の3引数目を追加。whitelist があれば MAIN/SUB_GENRES をその名前でフィルタ
- `src/agents/store.ts` — `PostRecord` に `slot?: string` と `itemCodeHash?: string` を追加
- `src/main.ts` — 冒頭で `getActiveSlot()` を呼び、slot を全ステップで伝搬。PostRecord に slot と itemCodeHash を書き込む
- `src/sns.ts` — `crossPostToSns(items, opts?)` に `persona?: PersonaSlot` を追加。IG は ig-post-engine.ts に委譲、Threads は Phase 0 で無効化済のため触らない
- `.github/workflows/auto-post.yml` — cron を 5 → 3 に削減、`SKIP_ROOM=1` 環境変数を 13:00 の呼び出しで注入
- `README.md` — Phase 2 の運用説明

**手を付けない:**
- `src/generator.ts` — Phase 2 では tone 注入なし（persona.tone は Phase 3 で generator に伝搬）。ここに手を入れると diff が広がるので後回し

---

### Task 1: persona 型 + データ + ローダ

**Files:**
- Create: `src/persona/persona.ts`
- Create: `src/persona/persona.json`
- Create: `tests/persona.test.ts`

**Interfaces:**
- Consumes: なし
- Produces:
  - `export type SlotId = "slot0" | "slot1" | "slot2";`
  - `export interface PersonaSlot { id: SlotId; name: string; priceBand: [number, number]; trackingId: string; genres: string[]; tone: string; hashtags: string[]; ngWords: string[]; ctaLine: string; }`
  - `export interface Persona { activeSlot: "multi" | SlotId; evaluationWindow: number; evaluationStartedAt: string; slots: Record<SlotId, PersonaSlot>; }`
  - `export function loadPersona(): Persona`
  - `export function savePersona(p: Persona): void`
  - `export function getSlot(p: Persona, id: SlotId): PersonaSlot`

- [ ] **Step 1: テストを書く**

`tests/persona.test.ts`:

```typescript
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { loadPersona, getSlot, savePersona } from "../src/persona/persona";

test("loadPersona: persona.json をパースし 3 slot 全て取得できる", () => {
  const p = loadPersona();
  assert.equal(typeof p.activeSlot, "string");
  assert.ok(["multi", "slot0", "slot1", "slot2"].includes(p.activeSlot));
  assert.equal(Object.keys(p.slots).length, 3);
  for (const id of ["slot0", "slot1", "slot2"] as const) {
    const s = getSlot(p, id);
    assert.ok(s.name.length > 0);
    assert.ok(s.hashtags.length > 0);
    assert.ok(s.genres.length > 0);
    assert.equal(s.priceBand.length, 2);
    assert.ok(s.priceBand[0] < s.priceBand[1]);
  }
});

test("getSlot: 不明 slot は throw", () => {
  const p = loadPersona();
  // @ts-expect-error 不正な id
  assert.throws(() => getSlot(p, "slot99"));
});

test("savePersona/loadPersona: ラウンドトリップ", () => {
  const dir = fs.mkdtempSync(path.join(process.cwd(), "tmp-persona-"));
  const savedPath = path.join(dir, "persona.json");
  process.env.PERSONA_PATH_OVERRIDE = savedPath;
  try {
    const original = loadPersona();
    savePersona({ ...original, activeSlot: "slot1" });
    const loaded = loadPersona();
    assert.equal(loaded.activeSlot, "slot1");
  } finally {
    delete process.env.PERSONA_PATH_OVERRIDE;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: persona.json を作成**

`src/persona/persona.json`:

```json
{
  "activeSlot": "multi",
  "evaluationWindow": 14,
  "evaluationStartedAt": "2026-07-25T00:00:00Z",
  "slots": {
    "slot0": {
      "id": "slot0",
      "name": "毎月これ買ってる（消耗品リピート）",
      "priceBand": [500, 2000],
      "trackingId": "slot0-consume",
      "genres": [
        "キッチン消耗品・日用品",
        "生活必需品・補充消耗品",
        "洗濯・衣類ケアグッズ",
        "掃除用品・消耗品",
        "バス・トイレ用品"
      ],
      "tone": "毎月リピートしている定番の実用アイテムを、無理なく淡々と紹介する。誇張しない",
      "hashtags": ["#毎月これ買ってる", "#定番リピート", "#楽天ROOM", "#買ってよかった", "#暮らしの定番"],
      "ngWords": ["最安", "激安", "神", "バグ"],
      "ctaLine": "毎月の定番はプロフのリンクから → @meganeojisan1984 (楽天ROOM)"
    },
    "slot1": {
      "id": "slot1",
      "name": "一人暮らしQOL上げる家電",
      "priceBand": [2000, 8000],
      "trackingId": "slot1-qol",
      "genres": [
        "ハイエンド・スタイリッシュ家電",
        "時短ガジェット・小型家電",
        "家事効率化グッズ",
        "省エネ・節約家電小物",
        "キッチン便利グッズ・調理器具"
      ],
      "tone": "一人暮らしの実感ベースで『これ買って生活変わった』を素直に伝える",
      "hashtags": ["#一人暮らしQOL", "#買ってよかった", "#時短家電", "#暮らしを楽に", "#楽天ROOM"],
      "ngWords": ["最安", "激安"],
      "ctaLine": "詳細はプロフのリンク → @meganeojisan1984 (楽天ROOM)"
    },
    "slot2": {
      "id": "slot2",
      "name": "ふるさと納税で得する家計",
      "priceBand": [10000, 30000],
      "trackingId": "slot2-furusato",
      "genres": [
        "食品",
        "ハイエンド・スタイリッシュ家電",
        "整理収納・片付けグッズ"
      ],
      "tone": "還元率・実質負担・年内枠を淡々と伝え、比較で選びやすくする",
      "hashtags": ["#ふるさと納税", "#返礼品", "#実質2000円", "#楽天ふるさと納税", "#楽天ROOM"],
      "ngWords": ["最安"],
      "ctaLine": "返礼品リストはプロフのリンク → @meganeojisan1984 (楽天ROOM)"
    }
  }
}
```

- [ ] **Step 3: persona.ts を実装**

`src/persona/persona.ts`:

```typescript
import * as fs from "fs";
import * as path from "path";

export type SlotId = "slot0" | "slot1" | "slot2";

export interface PersonaSlot {
  id: SlotId;
  name: string;
  priceBand: [number, number];
  trackingId: string;
  genres: string[];
  tone: string;
  hashtags: string[];
  ngWords: string[];
  ctaLine: string;
}

export interface Persona {
  activeSlot: "multi" | SlotId;
  evaluationWindow: number;
  evaluationStartedAt: string;
  slots: Record<SlotId, PersonaSlot>;
}

function personaPath(): string {
  return process.env.PERSONA_PATH_OVERRIDE
    ?? path.join(process.cwd(), "src", "persona", "persona.json");
}

export function loadPersona(): Persona {
  const p = personaPath();
  if (!fs.existsSync(p)) {
    throw new Error(`persona.json が見つかりません: ${p}`);
  }
  return JSON.parse(fs.readFileSync(p, "utf-8")) as Persona;
}

export function savePersona(p: Persona): void {
  const target = personaPath();
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, JSON.stringify(p, null, 2), "utf-8");
}

export function getSlot(p: Persona, id: SlotId): PersonaSlot {
  const s = p.slots[id];
  if (!s) throw new Error(`unknown slot: ${id}`);
  return s;
}
```

- [ ] **Step 4: テストが通る**

Run:
```bash
npm test 2>&1 | tail -20
```

Expected: `# pass 16` (13 existing + 3 new)

- [ ] **Step 5: Commit**

```bash
git add src/persona/persona.ts src/persona/persona.json tests/persona.test.ts
git commit -m "feat(P2): persona 型 + 3 slot データ + loader

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 2: slot-rotator（JST時刻から本回のslotを決定）

**Files:**
- Create: `src/persona/slot-rotator.ts`
- Create: `tests/slot-rotator.test.ts`

**Interfaces:**
- Consumes: `Persona`, `SlotId` from `persona.ts`
- Produces: `export function resolveSlot(p: Persona, jstDate: Date): SlotId`
  - `activeSlot` が確定 slot なら常にそれ
  - `activeSlot === "multi"` なら JST時刻でローテ: `hour < 12 → slot0`, `hour < 18 → slot1`, `else → slot2`

- [ ] **Step 1: テストを書く**

`tests/slot-rotator.test.ts`:

```typescript
import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveSlot } from "../src/persona/slot-rotator";
import type { Persona } from "../src/persona/persona";

const dummyPersona = (activeSlot: Persona["activeSlot"]): Persona => ({
  activeSlot,
  evaluationWindow: 14,
  evaluationStartedAt: "2026-07-25T00:00:00Z",
  slots: {
    slot0: { id: "slot0", name: "", priceBand: [1, 2], trackingId: "", genres: [], tone: "", hashtags: [], ngWords: [], ctaLine: "" },
    slot1: { id: "slot1", name: "", priceBand: [1, 2], trackingId: "", genres: [], tone: "", hashtags: [], ngWords: [], ctaLine: "" },
    slot2: { id: "slot2", name: "", priceBand: [1, 2], trackingId: "", genres: [], tone: "", hashtags: [], ngWords: [], ctaLine: "" },
  },
});

function jst(hour: number): Date {
  // 実UTC時刻 hour-9 を渡し、内部で JST に変換される想定
  const utcHour = (hour - 9 + 24) % 24;
  return new Date(Date.UTC(2026, 6, 25, utcHour, 0, 0));
}

test("resolveSlot: activeSlot が確定なら時刻に関係なく同一 slot", () => {
  const p = dummyPersona("slot1");
  assert.equal(resolveSlot(p, jst(3)), "slot1");
  assert.equal(resolveSlot(p, jst(15)), "slot1");
  assert.equal(resolveSlot(p, jst(23)), "slot1");
});

test("resolveSlot: multi モード, 朝→slot0", () => {
  const p = dummyPersona("multi");
  assert.equal(resolveSlot(p, jst(8)), "slot0");
  assert.equal(resolveSlot(p, jst(11)), "slot0");
});

test("resolveSlot: multi モード, 昼→slot1", () => {
  const p = dummyPersona("multi");
  assert.equal(resolveSlot(p, jst(13)), "slot1");
  assert.equal(resolveSlot(p, jst(17)), "slot1");
});

test("resolveSlot: multi モード, 夜→slot2", () => {
  const p = dummyPersona("multi");
  assert.equal(resolveSlot(p, jst(21)), "slot2");
  assert.equal(resolveSlot(p, jst(23)), "slot2");
  assert.equal(resolveSlot(p, jst(0)), "slot2");
});
```

- [ ] **Step 2: 実装**

`src/persona/slot-rotator.ts`:

```typescript
import type { Persona, SlotId } from "./persona";

/**
 * 本回の投稿を担当する slot を決定。
 * activeSlot が確定なら常にそれ。multi なら JST 時刻でローテ。
 */
export function resolveSlot(p: Persona, now: Date): SlotId {
  if (p.activeSlot !== "multi") return p.activeSlot;
  const jstHour = Number(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Tokyo",
      hour: "2-digit",
      hour12: false,
    }).format(now),
  );
  if (jstHour < 12) return "slot0";
  if (jstHour < 18) return "slot1";
  return "slot2";
}
```

- [ ] **Step 3: テストが通る**

Run: `npm test 2>&1 | tail -20`
Expected: `# pass 20` (前 16 + 新 4)

- [ ] **Step 4: Commit**

```bash
git add src/persona/slot-rotator.ts tests/slot-rotator.test.ts
git commit -m "feat(P2): slot-rotator (JST時刻から本回スロット決定)

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 3: PostRecord に slot + itemCodeHash を追加

**Files:**
- Modify: `src/agents/store.ts`（PostRecord 型に 2 フィールド追加）

**Interfaces:**
- Produces: `PostRecord` に `slot?: SlotId | string` と `itemCodeHash?: string`（後方互換のため両方 optional）

- [ ] **Step 1: 現在の PostRecord を確認**

Run:
```bash
grep -nA 15 "^export interface PostRecord" src/agents/store.ts
```

- [ ] **Step 2: 型に 2 フィールドを追加**

`src/agents/store.ts` の `PostRecord` 定義に以下を追加:

```typescript
export interface PostRecord {
  ts: string;
  itemCode: string;
  // ... 既存フィールド ...
  slot?: string;          // Phase 2 で追加。"slot0" | "slot1" | "slot2"
  itemCodeHash?: string;  // Phase 2 で追加。sha1(shopName|itemName)[0:12]
}
```

**具体的な位置**: `hook?`, `captionHead?`, `trendKeyword?` などの optional の並びに `slot?` と `itemCodeHash?` を追加する。既存フィールド名は変えない。

- [ ] **Step 3: 型チェック**

Run: `npx tsc --noEmit 2>&1 | tail -5`
Expected: エラー 0 件

- [ ] **Step 4: Commit**

```bash
git add src/agents/store.ts
git commit -m "feat(P2): PostRecord に slot と itemCodeHash を追加

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 4: fetcher に slot ジャンル絞込を追加

**Files:**
- Modify: `src/fetcher.ts`

**Interfaces:**
- Consumes: なし
- Produces: `export async function fetchItems(count: number, excludeCodes: Set<string>, genreWhitelist?: string[]): Promise<RakutenItem[]>`
  - 第3引数が渡された場合、内部の MAIN_GENRES / SUB_GENRES を `genres.filter(g => whitelist.includes(g.name))` する
  - 空配列や undefined なら現状通り全ジャンル対象

- [ ] **Step 1: 現在のシグネチャを確認**

Run:
```bash
grep -nE "^export.*fetchItems" src/fetcher.ts
```

- [ ] **Step 2: シグネチャに `genreWhitelist?: string[]` を追加**

`src/fetcher.ts` の `fetchItems` 関数のシグネチャを:

```typescript
export async function fetchItems(
  count: number,
  excludedCodes: Set<string>,
  genreWhitelist?: string[],
): Promise<RakutenItem[]> {
```

- [ ] **Step 3: 関数本文冒頭で MAIN_GENRES と SUB_GENRES をフィルタ**

`fetchItems` 関数の最初の方で MAIN_GENRES/SUB_GENRES を使っている箇所を探し、以下のパターンで絞る:

```typescript
  const whitelist = genreWhitelist && genreWhitelist.length > 0
    ? new Set(genreWhitelist)
    : null;
  const mainGenres = whitelist ? MAIN_GENRES.filter((g) => whitelist.has(g.name)) : MAIN_GENRES;
  const subGenres  = whitelist ? SUB_GENRES.filter((g) => whitelist.has(g.name))  : SUB_GENRES;
```

以降、既存コードが `MAIN_GENRES` / `SUB_GENRES` を参照している箇所を `mainGenres` / `subGenres` に置換する。**参照が MAIN_GENRES / SUB_GENRES のままで放置されると whitelist が効かない**ため要注意。

- [ ] **Step 4: 型チェック**

Run: `npx tsc --noEmit 2>&1 | tail -5`
Expected: エラー 0 件

- [ ] **Step 5: 呼び出し側（main.ts）に既存の 2 引数呼び出しが残っていることを確認**

Run:
```bash
grep -n "fetchItems(" src/main.ts
```

Expected: 既存呼び出しは 2 引数のまま（3引数目省略で全ジャンル）。Task 5 で slot 対応に切り替える

- [ ] **Step 6: Commit**

```bash
git add src/fetcher.ts
git commit -m "feat(P2): fetcher に slot ジャンル絞込 (第3引数 whitelist) を追加

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 5: ig-post-engine.ts — persona-aware IG 投稿

**Files:**
- Create: `src/ig/ig-post-engine.ts`
- Modify: `src/sns.ts`（`crossPostToSns` に persona 引数を追加、IG は ig-post-engine に委譲）

**Interfaces:**
- Consumes: `PersonaSlot` from `src/persona/persona.ts`, 既存 `RakutenItem`, `buildInstagramFinalCaption` の内部ロジック
- Produces:
  - `export async function postToInstagramWithPersona(item: RakutenItem, roomCaption: string, persona: PersonaSlot): Promise<boolean>`
  - キャプション末尾に `\n\n${persona.ctaLine}\n\n${persona.hashtags.join(" ")}` を差し込む
  - `persona.ngWords` がキャプションに含まれる場合は該当語を伏字化（`###` に置換）してから投稿

- [ ] **Step 1: ig-post-engine.ts を作成**

`src/ig/ig-post-engine.ts`:

```typescript
import axios from "axios";
import { buildInstagramFinalCaption, upscaleImageUrl } from "../sns";
import { notifyError } from "../notifiers";
import type { PersonaSlot } from "../persona/persona";

// sns.ts と揃える (Instagram Graph API 独自エンドポイント)
const GRAPH_API = "https://graph.instagram.com/v21.0";
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

function env(key: string): string {
  return process.env[key] ?? "";
}

/** NG ワードを ### に置換 */
function scrubNgWords(text: string, ngWords: string[]): string {
  let out = text;
  for (const w of ngWords) {
    if (!w) continue;
    out = out.split(w).join("###");
  }
  return out;
}

/** persona.ctaLine と #タグをキャプション末尾に付与 */
function withPersonaFooter(caption: string, persona: PersonaSlot): string {
  const hashtags = persona.hashtags.join(" ");
  return `${caption.trimEnd()}\n\n${persona.ctaLine}\n\n${hashtags}`;
}

export async function postToInstagramWithPersona(
  item: { itemName: string; imageUrl?: string },
  roomCaption: string,
  persona: PersonaSlot,
): Promise<boolean> {
  const IG_USER_ID = env("IG_USER_ID");
  const IG_ACCESS_TOKEN = env("IG_ACCESS_TOKEN");
  if (!IG_USER_ID || !IG_ACCESS_TOKEN) {
    console.log("[ig-post-engine] Instagram: 環境変数未設定のためスキップ");
    return false;
  }
  if (!item.imageUrl) {
    console.warn("[ig-post-engine] Instagram: 画像URL空のためスキップ");
    return false;
  }
  try {
    const baseCaption = await buildInstagramFinalCaption(item as never, roomCaption);
    const scrubbed = scrubNgWords(baseCaption, persona.ngWords);
    const finalCaption = withPersonaFooter(scrubbed, persona);
    const imageUrl = upscaleImageUrl(item.imageUrl);
    console.log(`[ig-post-engine] slot=${persona.id} メディア作成中...`);
    const createRes = await axios.post<{ id: string }>(
      `${GRAPH_API}/${IG_USER_ID}/media`,
      null,
      { params: { image_url: imageUrl, caption: finalCaption, access_token: IG_ACCESS_TOKEN }, timeout: 30000 },
    );
    const creationId = createRes.data.id;
    for (let i = 0; i < 12; i++) {
      const s = await axios.get<{ status_code: string }>(
        `${GRAPH_API}/${creationId}`,
        { params: { fields: "status_code", access_token: IG_ACCESS_TOKEN }, timeout: 15000 },
      );
      if (s.data.status_code === "FINISHED") break;
      if (s.data.status_code === "ERROR") throw new Error("Instagramメディア処理エラー");
      await sleep(5000);
    }
    console.log(`[ig-post-engine] slot=${persona.id} 公開中...`);
    await axios.post(
      `${GRAPH_API}/${IG_USER_ID}/media_publish`,
      null,
      { params: { creation_id: creationId, access_token: IG_ACCESS_TOKEN }, timeout: 30000 },
    );
    console.log(`[ig-post-engine] ✅ slot=${persona.id} 投稿成功: ${item.itemName.slice(0, 30)}`);
    return true;
  } catch (err) {
    const msg = axios.isAxiosError(err)
      ? JSON.stringify(err.response?.data ?? err.message).slice(0, 500)
      : String(err);
    console.error(`[ig-post-engine] slot=${persona.id} 失敗:`, msg);
    await notifyError(`Instagram投稿失敗(slot=${persona.id})`, msg);
    return false;
  }
}
```

- [ ] **Step 2: sns.ts の `crossPostToSns` に persona 引数を追加し、IG 分岐**

`src/sns.ts` の `crossPostToSns` を以下のように改修:

Before（既存 227-245 行付近）:
```typescript
export async function crossPostToSns(
  items: Array<{ item: RakutenItem; caption: string }>
): Promise<{ attempted: boolean; instagram: boolean; threads: boolean }> {
  const none = { attempted: false, instagram: false, threads: false };
  const first = items[0];
  if (!first) return none;

  const igEnabled = !!(env("IG_USER_ID") && env("IG_ACCESS_TOKEN"));
  const threadsEnabled = !!(env("THREADS_USER_ID") && env("THREADS_ACCESS_TOKEN"));
  ...
  const instagram = igEnabled ? await postToInstagram(first.item, first.caption) : false;
  const threads = threadsEnabled ? await postToThreads(first.item, first.caption) : false;
  return { attempted: true, instagram, threads };
}
```

After:
```typescript
export async function crossPostToSns(
  items: Array<{ item: RakutenItem; caption: string }>,
  opts?: { persona?: import("./persona/persona").PersonaSlot },
): Promise<{ attempted: boolean; instagram: boolean; threads: boolean }> {
  const none = { attempted: false, instagram: false, threads: false };
  const first = items[0];
  if (!first) return none;

  const igEnabled = !!(env("IG_USER_ID") && env("IG_ACCESS_TOKEN"));
  if (!igEnabled) {
    console.log("[sns] Instagram未設定。クロス投稿をスキップ");
    return none;
  }

  console.log("\n--- SNSクロス投稿 (認知度拡大) ---");
  let instagram: boolean;
  if (opts?.persona) {
    const { postToInstagramWithPersona } = await import("./ig/ig-post-engine");
    instagram = await postToInstagramWithPersona(first.item, first.caption, opts.persona);
  } else {
    instagram = await postToInstagram(first.item, first.caption);
  }
  // Threads は Phase 0 で無効化済み。呼ばない
  return { attempted: true, instagram, threads: false };
}
```

**重要**: `buildInstagramFinalCaption` と `upscaleImageUrl` は既に `sns.ts` から export されているので、ig-post-engine からの import はそのまま通る。もし export 済みでなければ `export` キーワードを追加してから import する。

- [ ] **Step 3: sns.ts で `buildInstagramFinalCaption` と `upscaleImageUrl` が export されているか確認**

Run:
```bash
grep -nE "^export.*(buildInstagramFinalCaption|upscaleImageUrl)" src/sns.ts
```

もし片方でも export されていなければ、その関数の宣言に `export` を追加:

```typescript
export function upscaleImageUrl(imageUrl: string, size = 640): string { ... }
export async function buildInstagramFinalCaption(...) { ... }
```

- [ ] **Step 4: 型チェック**

Run: `npx tsc --noEmit 2>&1 | tail -5`
Expected: エラー 0 件

- [ ] **Step 5: Commit**

```bash
git add src/ig/ig-post-engine.ts src/sns.ts
git commit -m "feat(P2): ig-post-engine と crossPostToSns の persona 対応

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 6: main.ts を slot 対応に改修

**Files:**
- Modify: `src/main.ts`

**Interfaces:**
- Consumes: `loadPersona`, `resolveSlot`, `getSlot`, `PersonaSlot`, `deriveItemCode`
- Produces:
  - 起動時に `loadPersona()` → `resolveSlot(persona, new Date())` → `getSlot(persona, slotId)` で本回の persona を確定
  - `fetchItems(POST_COUNT, postedCodes, persona.genres)` で slot 絞込
  - `crossPostToSns(succeededItems, { persona })` で slot 別 IG 投稿
  - `PostRecord` に `slot: slotId` と `itemCodeHash: deriveItemCode(item.shopName, item.itemName)` を書き込む
  - `SKIP_ROOM=1` 環境変数の場合は Step 3（ROOM投稿）と Step 4（履歴記録の一部）をスキップして IG のみ実行

- [ ] **Step 1: import を追加**

`src/main.ts` 冒頭の import 群に:

```typescript
import { loadPersona, getSlot } from "./persona/persona";
import { resolveSlot } from "./persona/slot-rotator";
import { deriveItemCode } from "./affiliate/report-parser";
```

- [ ] **Step 2: main() 関数の冒頭で slot 解決を追加**

`async function main(): Promise<void> {` の直後、`const { codes, postTypeIndex } = loadState();` の直前に:

```typescript
  const persona = loadPersona();
  const slotId = resolveSlot(persona, new Date());
  const slot = getSlot(persona, slotId);
  const SKIP_ROOM = process.env.SKIP_ROOM === "1";
  console.log(`[main] active persona: ${slot.id} (${slot.name}) SKIP_ROOM=${SKIP_ROOM}`);
```

- [ ] **Step 3: fetchItems に slot.genres を渡す**

`src/main.ts` 内の `await fetchItems(POST_COUNT, postedCodes)` を:

```typescript
items = await fetchItems(POST_COUNT, postedCodes, slot.genres);
```

もし fetcher が複数箇所で呼ばれていれば、両方に `slot.genres` を追加。

- [ ] **Step 4: Step 3（ROOM投稿）を SKIP_ROOM で分岐**

`--- [3/3] 楽天ROOMへ投稿中 ---` のブロックを以下に置換:

```typescript
  let results: import("./poster").PostResult[];
  if (SKIP_ROOM) {
    console.log("--- [3/3] SKIP_ROOM=1 のため ROOM 投稿をスキップ ---");
    // IG 投稿の材料として全件を「成功」扱いにする
    results = captionedItems.map((c) => ({ success: true, itemName: c.item.itemName, itemUrl: c.item.itemUrl }));
  } else {
    try {
      console.log("--- [3/3] 楽天ROOMへ投稿中 ---");
      const headless = process.env.CI === "true" || process.env.HEADLESS !== "false";
      results = await postItems(captionedItems, headless);
    } catch (err) {
      const msg = String(err);
      console.error("投稿処理中に予期しないエラー:", msg);
      await notifyError("投稿処理エラー", msg);
      process.exit(1);
    }
  }
```

- [ ] **Step 5: crossPostToSns に persona を渡す**

`const sns = await crossPostToSns(succeededItems);` を:

```typescript
const sns = await crossPostToSns(succeededItems, { persona: slot });
```

- [ ] **Step 6: PostRecord に slot + itemCodeHash を追加**

`const historyRecords: PostRecord[] = succeededItems.map((c) => ({` ブロックの中に以下を追加:

```typescript
  const historyRecords: PostRecord[] = succeededItems.map((c) => ({
    ts: new Date().toISOString(),
    itemCode: c.item.itemCode,
    itemName: c.item.itemName,
    genreName: trendKeyword ? `トレンド:${trendKeyword}` : getLastSelectedGenre(),
    price: c.item.itemPrice,
    postType,
    hour: jstHour,
    hook: c.hook,
    captionHead: c.caption.replace(/\s+/g, " ").slice(0, 25),
    trendKeyword,
    // Phase 2: slot 属性と実売DB join 用のハッシュを付与
    slot: slot.id,
    itemCodeHash: deriveItemCode((c.item as { shopName?: string }).shopName ?? "", c.item.itemName),
  }));
```

- [ ] **Step 7: SKIP_ROOM 時の poster 報告も対応**

`report("poster", succeeded > 0, ...);` の直前に以下を挿入して、SKIP_ROOM 時は poster 報告をスキップ:

```typescript
  if (!SKIP_ROOM) {
    report("poster", succeeded > 0, `成功${succeeded}件/失敗${failed}件${failed > 0 ? ` (${results.find((r) => !r.success)?.error?.slice(0, 80) ?? ""})` : ""}`);
  } else {
    report("poster", true, "skipped (SKIP_ROOM=1)");
  }
```

- [ ] **Step 8: 型チェック + テスト**

Run:
```bash
npx tsc --noEmit 2>&1 | tail -5
npm test 2>&1 | tail -10
```

Expected: 型エラー 0、全テスト pass

- [ ] **Step 9: Commit**

```bash
git add src/main.ts
git commit -m "feat(P2): main.ts を slot 対応に改修（persona → fetcher/IG/history）

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 7: attribution モジュール（post_history × sales JOIN で slot 別集計）

**Files:**
- Create: `src/attribution/attribute.ts`
- Create: `tests/attribute.test.ts`

**Interfaces:**
- Consumes: `PostRecord` from `../agents/store`, `SalesRow`/`getSalesByDateRange` from `../affiliate/sales-db`, `deriveItemCode`
- Produces:
  - `export interface SlotAttribution { slot: string; posts: number; matchedSales: number; totalReward: number; totalOrders: number; }`
  - `export function attributeSlots(history: PostRecord[], sales: SalesRow[]): SlotAttribution[]`
    - 履歴を `slot` でグルーピング → 各 slot の投稿の `itemCodeHash` と `sales.itemCode` が一致する行を JOIN → orders/reward を集計

- [ ] **Step 1: テストを書く**

`tests/attribute.test.ts`:

```typescript
import { test } from "node:test";
import assert from "node:assert/strict";
import { attributeSlots } from "../src/attribution/attribute";
import { deriveItemCode } from "../src/affiliate/report-parser";

test("attributeSlots: slot 別に matched sales を集計", () => {
  const hashA = deriveItemCode("shopA", "itemA");
  const hashB = deriveItemCode("shopB", "itemB");
  const history = [
    { ts: "2026-07-25T00:00:00Z", itemCode: "shopA:1", itemName: "itemA", genreName: "", price: 1000, postType: 1, hour: 8, slot: "slot0", itemCodeHash: hashA },
    { ts: "2026-07-25T13:00:00Z", itemCode: "shopB:2", itemName: "itemB", genreName: "", price: 5000, postType: 2, hour: 13, slot: "slot1", itemCodeHash: hashB },
  ] as never[];
  const sales = [
    { date: "2026-07-25", itemCode: hashA, trackingId: "楽天ROOM", clicks: 0, orders: 1, reward: 300 },
    { date: "2026-07-25", itemCode: hashB, trackingId: "楽天ROOM", clicks: 0, orders: 2, reward: 800 },
  ];
  const result = attributeSlots(history, sales);
  const s0 = result.find((r) => r.slot === "slot0");
  const s1 = result.find((r) => r.slot === "slot1");
  assert.ok(s0);
  assert.equal(s0.matchedSales, 1);
  assert.equal(s0.totalReward, 300);
  assert.ok(s1);
  assert.equal(s1.totalReward, 800);
});

test("attributeSlots: slot 未設定の履歴は 'unknown' でまとめる", () => {
  const history = [{ ts: "2026-07-25T00:00:00Z", itemCode: "x", itemName: "x", genreName: "", price: 1, postType: 1, hour: 1 }] as never[];
  const result = attributeSlots(history, []);
  const unk = result.find((r) => r.slot === "unknown");
  assert.ok(unk);
  assert.equal(unk.posts, 1);
  assert.equal(unk.matchedSales, 0);
});
```

- [ ] **Step 2: 実装**

`src/attribution/attribute.ts`:

```typescript
import type { PostRecord } from "../agents/store";
import type { SalesRow } from "../affiliate/sales-db";

export interface SlotAttribution {
  slot: string;
  posts: number;
  matchedSales: number;
  totalReward: number;
  totalOrders: number;
}

export function attributeSlots(history: PostRecord[], sales: SalesRow[]): SlotAttribution[] {
  const salesByHash = new Map<string, SalesRow[]>();
  for (const s of sales) {
    const arr = salesByHash.get(s.itemCode) ?? [];
    arr.push(s);
    salesByHash.set(s.itemCode, arr);
  }

  const acc = new Map<string, SlotAttribution>();
  const ensure = (slot: string): SlotAttribution => {
    const cur = acc.get(slot);
    if (cur) return cur;
    const fresh: SlotAttribution = { slot, posts: 0, matchedSales: 0, totalReward: 0, totalOrders: 0 };
    acc.set(slot, fresh);
    return fresh;
  };

  for (const h of history) {
    const slot = h.slot ?? "unknown";
    const bucket = ensure(slot);
    bucket.posts += 1;
    if (h.itemCodeHash) {
      const matches = salesByHash.get(h.itemCodeHash) ?? [];
      for (const m of matches) {
        bucket.matchedSales += 1;
        bucket.totalOrders += m.orders;
        bucket.totalReward += m.reward;
      }
    }
  }
  return Array.from(acc.values()).sort((a, b) => b.totalReward - a.totalReward);
}
```

- [ ] **Step 3: テスト**

Run: `npm test 2>&1 | tail -10`
Expected: 全 pass

- [ ] **Step 4: Commit**

```bash
git add src/attribution/attribute.ts tests/attribute.test.ts
git commit -m "feat(P2): attribution module (post_history × sales JOIN)

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 8: auto-post.yml の cron を 3 回/日に削減 + SKIP_ROOM 環境変数

**Files:**
- Modify: `.github/workflows/auto-post.yml`

**Interfaces:** なし

- [ ] **Step 1: cron ブロックを差し替える**

`auto-post.yml` の `schedule:` ブロックを以下に置換:

```yaml
  schedule:
    # JST 08:00 → UTC 23:00 (前日) — slot0 (multi ローテ時)
    - cron: "0 23 * * *"
    # JST 13:00 → UTC 04:00 — slot1 (multi ローテ時)。IG のみ (SKIP_ROOM=1)
    - cron: "0 4 * * *"
    # JST 21:00 → UTC 12:00 — slot2 (multi ローテ時)
    - cron: "0 12 * * *"
```

- [ ] **Step 2: 「自動投稿を実行」ステップに SKIP_ROOM 判定を追加**

`env:` ブロックの直後、`run: npx tsx src/main.ts` を以下に置換:

```yaml
        run: |
          # UTC 04時 (JST 13時) の cron 発火時のみ IG のみ (SKIP_ROOM=1)
          if [ "$(date -u +%H)" = "04" ] && [ "${{ github.event_name }}" = "schedule" ]; then
            export SKIP_ROOM=1
            echo "[auto-post] SKIP_ROOM=1 (JST13 は IG のみ)"
          fi
          npx tsx src/main.ts
```

- [ ] **Step 3: 検証**

Run:
```bash
grep -c "cron:" .github/workflows/auto-post.yml
```

Expected: `3`

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/auto-post.yml
git commit -m "chore(P2): auto-post を 3 crons/日 に削減 + JST13 は IG のみ

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 9: ローカル dry-run + README + Push

**Files:**
- Modify: `README.md`

- [ ] **Step 1: 全テスト**

Run: `npm test 2>&1 | tail -10`
Expected: 全テスト pass（推定 22-24 tests）

- [ ] **Step 2: 型チェック**

Run: `npx tsc --noEmit`
Expected: エラー 0

- [ ] **Step 3: ローカル dry-run — persona → fetcher → generator のみ**（実 IG/ROOM 投稿はしない）

Run:
```bash
npx tsx -e "
const {loadPersona, getSlot} = require('./src/persona/persona.ts');
const {resolveSlot} = require('./src/persona/slot-rotator.ts');
const {fetchItems} = require('./src/fetcher.ts');
(async () => {
  const p = loadPersona();
  const slotId = resolveSlot(p, new Date());
  const slot = getSlot(p, slotId);
  console.log('active slot:', slot.id, slot.name);
  console.log('genres:', slot.genres);
  const items = await fetchItems(2, new Set(), slot.genres);
  console.log('fetched:', items.length);
  for (const it of items) console.log('-', it.shopName, '/', it.itemName.slice(0,40), '¥'+it.itemPrice);
})();
"
```

Expected: 2 商品が slot のジャンル whitelist に沿って取れる。fetch 失敗（APIレート・0件）ならログ上で理由が判別できる

- [ ] **Step 4: README に Phase 2 節を追加**

`README.md` の末尾に:

```markdown
---

## 🎭 Phase 2: 3ペルソナ並行 × Instagram 特化

Phase 2 では 3 価格帯ペルソナ（低単価高回転 / 中単価QOL / 高単価ふるさと納税）を並行運用します。

### スケジュール

- JST 08:00 → slot0 (multi ローテ時。ROOM + IG)
- JST 13:00 → slot1 (multi ローテ時。IG のみ、SKIP_ROOM=1)
- JST 21:00 → slot2 (multi ローテ時。ROOM + IG)

Net: 3 IG 投稿/日、2 ROOM 投稿/日。

### ペルソナの編集

`src/persona/persona.json` を編集するとその内容が翌回の投稿に反映されます。

- `activeSlot` を `"multi"` から `"slot0"` などに変更すると、以降そのスロット1本に集中します（Phase 4 の勝者ペルソナ確定はこの切替で実現）
- 各 slot の `hashtags` / `ctaLine` / `ngWords` を編集

### slot 別実売の集計

```bash
npx tsx -e "
const {loadHistory} = require('./src/agents/store.ts');
const {initDb, getSalesByDateRange} = require('./src/affiliate/sales-db.ts');
const {attributeSlots} = require('./src/attribution/attribute.ts');
const db = initDb();
const from = '2026-07-01', to = '2026-07-31';
console.log(attributeSlots(loadHistory(), getSalesByDateRange(db, from, to)));
db.close();
"
```
```

- [ ] **Step 5: 全 commit を push**

Run:
```bash
git add README.md
git commit -m "docs(P2): Phase 2 セットアップと集計手順を追記

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"

bash tools/safe-push.sh
```

Expected: `[safe-push] success on attempt 1`

- [ ] **Step 6: 手動発火で end-to-end 検証**

```bash
gh workflow run auto-post.yml --repo meganeojisan1984-ctrl/rakuten-room-auto-system
sleep 90
gh run list --workflow=auto-post.yml --repo meganeojisan1984-ctrl/rakuten-room-auto-system --limit 1
```

Expected: 緑（✓）、または赤なら Discord に失敗通知 + 診断アーティファクトが取得できる。log で `active persona: slotN` の行が出ていることを確認

---

## 完了判定

Phase 2 は以下すべてが満たされた時点で完了とする:

1. `npm test` が全 pass（推定 22+ tests）
2. `npx tsc --noEmit` エラー 0 件
3. `src/persona/persona.json` が存在し、3 slot 全て埋まっている
4. auto-post.yml の cron が 3 回/日
5. 手動発火した auto-post ワークフローが緑で終わる、または赤なら診断できる
6. `PostRecord` に `slot` と `itemCodeHash` が記録される（新しい投稿1件以上で確認）
7. `attributeSlots(history, sales)` が slot 別 reward 集計を返す

## 次フェーズ

Phase 3 (Day 8–14): commander の正解ラベルを likes → sales_score に切替。attribution モジュールを学習ループに接続。別プランで管理する。
