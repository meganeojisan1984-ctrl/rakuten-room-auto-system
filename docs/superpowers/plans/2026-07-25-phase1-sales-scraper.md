# Phase 1: 楽天アフィリエイト実売スクレイパー + sales.sqlite Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 楽天アフィリエイト管理画面から日次で実売データ（クリック数・成果件数・報酬額）を Cookie スクレイピングで取得し `data/sales.sqlite` に永続化する。Phase 3 の学習ループが正解ラベルとして使えるデータ層を確立する。

**Architecture:** (1) 既存 `tools/cookie-exporter.ts` の対 ROOM パターンを踏襲した `tools/export-affiliate-cookie.ts` を用意。(2) `src/affiliate/sales-db.ts` に `better-sqlite3` の CRUD を集約。(3) `src/affiliate/report-parser.ts` に CSV パースを分離（Playwright 非依存で単体テスト可能）。(4) `src/affiliate/sales-scraper.ts` が Playwright でログイン → レポートページ遷移 → CSV ダウンロード or DOM 抽出 → parser → DB。(5) 失敗時は screenshot + HTML dump + Discord 通知で診断可能に保つ。

**Tech Stack:** TypeScript / Playwright / better-sqlite3 (既存依存) / Node built-in `node:test` + `node:assert`（新規テスト実行環境。追加依存不要）

## Global Constraints

- 対象リポジトリ: `E:\rakuten-room-auto-system`
- Node.js: `20` 系
- 依存追加禁止（`package.json` の dependencies を増やさない）。テストは `node --test` + `node:assert` で書く
- Playwright を使うスクレイパーは Cookie 注入方式（`src/session.ts` の `parseCookiesFromEnv` パターンを踏襲）
- 新 Secret: `RAKUTEN_AFFILIATE_COOKIE`（JSON形式、export-affiliate-cookie.ts が出力するもの）
- 新 Vars（任意）: `RAKUTEN_AFFILIATE_REPORT_URL`（既定値をコード内定数として持つ。**spec 12章の `RAKUTEN_AFFILIATE_URL` から改名 + Secret→Vars 変更**：URL は機密ではなく可観測性を優先）
- スクレイプ失敗時: `data/affiliate-debug/<timestamp>.html` + `.png` を保存し、Discord に `notifyDomError` を送る
- DB は WAL モードで開き、同時実行は Phase 0 の `concurrency: main-writer` に乗る
- 全 commit は日本語メッセージ + `Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>` 付与
- Phase 0 と同じく `bash tools/safe-push.sh` を使って push する
- スペック本体: [docs/superpowers/specs/2026-07-25-rakuten-room-rebuild-sales-driven-design.md](../specs/2026-07-25-rakuten-room-rebuild-sales-driven-design.md) 第2章 G2, 第5章 P1, 第6.1章, 第7章, 第9章, 第12章
- Phase 0 プラン（前提となる基盤）: [../plans/2026-07-25-phase0-actions-stabilization.md](2026-07-25-phase0-actions-stabilization.md)

---

## File Structure

**新規作成:**
- `tools/export-affiliate-cookie.ts` — ローカルで手動ログイン → affiliate 用 Cookie を JSON で出力
- `src/affiliate/sales-db.ts` — `data/sales.sqlite` を管理する SQLite ラッパ（`initDb`, `upsertSalesRow`, `getSalesByDateRange`, `getScrapeSummary`）
- `src/affiliate/report-parser.ts` — CSV 文字列を `SalesRow[]` に変換する純関数（Playwright 非依存）
- `src/affiliate/sales-scraper.ts` — Playwright で affiliate にログイン → CSV DL → parser → DB
- `src/run_sales_scrape.ts` — スクレイパーの entry point（`npm run scrape-sales`）
- `.github/workflows/sales-scrape.yml` — 日次 02:00 JST cron
- `tests/sales-db.test.ts` — sales-db の in-memory テスト
- `tests/report-parser.test.ts` — CSV parser の単体テスト
- `data/affiliate-debug/.gitkeep` — 診断ダンプ用ディレクトリ（実データは .gitignore）

**変更:**
- `package.json` — scripts に `export-affiliate-cookie`, `scrape-sales`, `test` を追加
- `src/utils/cookie-diagnose.ts` — `diagnoseAffiliateCookie()` を追加
- `.gitignore` — `data/sales.sqlite*` と `data/affiliate-debug/*` を追加
- `README.md` — Phase 1 の Cookie 取得手順・スクレイプ動作説明を追記

**手を付けない:**
- 既存 workflow（Phase 0 で調整済み）
- 既存 `src/session.ts`（Phase 0 で修正済み）

---

### Task 1: `tools/export-affiliate-cookie.ts` — Affiliate Cookie の取得ツール

**Files:**
- Create: `tools/export-affiliate-cookie.ts`
- Modify: `package.json`（scripts に追加）

**Interfaces:**
- Consumes: なし（`playwright` は既存依存）
- Produces: `npm run export-affiliate-cookie` で起動、ブラウザが開き、ユーザーが手動ログイン後、`cookies-affiliate.json` にCookie配列を保存し、GitHub Secrets 用の1行JSONを標準出力にも出す
- Cookie 取得完了の判定: URL が `https://affiliate.rakuten.co.jp/` で始まる状態になる（ログイン後にリダイレクトされるトップ）

- [ ] **Step 1: スクリプトを作成**

`tools/export-affiliate-cookie.ts`:

```typescript
/**
 * tools/export-affiliate-cookie.ts
 * ローカル用: ブラウザを開いてユーザーが手動ログイン後、
 * 楽天アフィリエイト管理画面の Cookie を取得・出力するツール
 *
 * 使い方: npm run export-affiliate-cookie
 */

import { chromium } from "playwright";
import * as fs from "fs";
import * as path from "path";

const AFFILIATE_TOP_URL = "https://affiliate.rakuten.co.jp/";
const LOGIN_URL =
  "https://grp01.id.rakuten.co.jp/rms/nid/login?service_id=s225&r=" +
  encodeURIComponent(AFFILIATE_TOP_URL);
const OUTPUT_FILE = path.join(process.cwd(), "cookies-affiliate.json");

async function main(): Promise<void> {
  console.log("=== 楽天アフィリエイト Cookie エクスポートツール ===");
  console.log("ブラウザが開きます。楽天IDでログインしてください。");
  console.log("ログイン完了後、このスクリプトが自動でCookieを取得します。\n");

  const browser = await chromium.launch({
    headless: false,
    args: ["--start-maximized"],
  });
  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    locale: "ja-JP",
    timezoneId: "Asia/Tokyo",
    viewport: null,
  });
  const page = await context.newPage();
  await page.goto(LOGIN_URL, { waitUntil: "domcontentloaded" });

  console.log(`楽天アフィリエイトのトップ (${AFFILIATE_TOP_URL}) に遷移するまで待機します（最大5分）...`);
  await page.waitForURL(
    (url) => url.href.startsWith(AFFILIATE_TOP_URL),
    { timeout: 300000 },
  );

  console.log("\nログイン完了を検知しました！Cookieを取得中...");
  const cookies = await context.cookies();

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(cookies, null, 2), "utf-8");
  console.log(`\n✅ Cookieを保存しました: ${OUTPUT_FILE}`);

  console.log("\n=== GitHub Secrets 用 (RAKUTEN_AFFILIATE_COOKIE の値) ===");
  console.log("以下の文字列をコピーして、GitHubリポジトリのSecrets > RAKUTEN_AFFILIATE_COOKIE に貼り付けてください:\n");
  console.log(JSON.stringify(cookies) + "\n");

  await browser.close();
  console.log("ブラウザを閉じました。");
}

main().catch((err: unknown) => {
  console.error("エラーが発生しました:", err);
  process.exit(1);
});
```

- [ ] **Step 2: package.json に script を追加**

`package.json` の scripts を以下のように変更（`export-cookie` の後に追加）:

```json
    "export-cookie": "npx tsx tools/cookie-exporter.ts",
    "export-affiliate-cookie": "npx tsx tools/export-affiliate-cookie.ts",
```

- [ ] **Step 3: `.gitignore` に `cookies-affiliate.json` を追加**

`.gitignore` に以下を追記:

```
cookies-affiliate.json
```

- [ ] **Step 4: 型チェック**

Run:
```bash
npx tsc --noEmit
```

Expected: エラー 0 件

- [ ] **Step 5: Commit**

```bash
git add tools/export-affiliate-cookie.ts package.json .gitignore
git commit -m "feat(P1): add affiliate cookie exporter tool

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 2: `src/affiliate/sales-db.ts` — SQLite ラッパ

**Files:**
- Create: `src/affiliate/sales-db.ts`
- Create: `tests/sales-db.test.ts`
- Modify: `package.json`（scripts に `test` を追加）
- Modify: `.gitignore`（`data/sales.sqlite*` を追加）

**Interfaces:**
- Consumes: `better-sqlite3`（既存依存 v12.8.0）
- Produces:
  - `export interface SalesRow { date: string; itemCode: string; trackingId: string; clicks: number; orders: number; reward: number; }`
  - `export function initDb(dbPath?: string): Database.Database` — WAL モードで開き、テーブルが無ければ作る。既定パス `data/sales.sqlite`
  - `export function upsertSalesRow(db: Database.Database, row: SalesRow): void` — 同一 `(date, item_code, tracking_id)` は上書き
  - `export function getSalesByDateRange(db: Database.Database, from: string, to: string): SalesRow[]` — YYYY-MM-DD 範囲
  - `export function getScrapeSummary(db: Database.Database, from: string, to: string): { rows: number; totalClicks: number; totalOrders: number; totalReward: number }`

- [ ] **Step 1: テストを書く**（TDD — Red）

`tests/sales-db.test.ts`:

```typescript
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  initDb,
  upsertSalesRow,
  getSalesByDateRange,
  getScrapeSummary,
} from "../src/affiliate/sales-db";

test("initDb creates sales table with expected columns", () => {
  const db = initDb(":memory:");
  const cols = db
    .prepare("PRAGMA table_info(sales)")
    .all() as Array<{ name: string }>;
  const names = cols.map((c) => c.name).sort();
  assert.deepEqual(names, [
    "clicks",
    "date",
    "item_code",
    "orders",
    "reward",
    "scraped_at",
    "tracking_id",
  ]);
  db.close();
});

test("upsertSalesRow inserts and upserts on same key", () => {
  const db = initDb(":memory:");
  upsertSalesRow(db, {
    date: "2026-07-25",
    itemCode: "shop:12345",
    trackingId: "slot0",
    clicks: 10,
    orders: 1,
    reward: 300,
  });
  upsertSalesRow(db, {
    date: "2026-07-25",
    itemCode: "shop:12345",
    trackingId: "slot0",
    clicks: 25,
    orders: 3,
    reward: 900,
  });
  const rows = getSalesByDateRange(db, "2026-07-25", "2026-07-25");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].clicks, 25);
  assert.equal(rows[0].orders, 3);
  assert.equal(rows[0].reward, 900);
  db.close();
});

test("getSalesByDateRange respects range boundaries", () => {
  const db = initDb(":memory:");
  const base = {
    itemCode: "shop:1",
    trackingId: "slot0",
    clicks: 1,
    orders: 0,
    reward: 0,
  };
  upsertSalesRow(db, { date: "2026-07-20", ...base });
  upsertSalesRow(db, { date: "2026-07-25", ...base });
  upsertSalesRow(db, { date: "2026-07-30", ...base });
  const rows = getSalesByDateRange(db, "2026-07-22", "2026-07-27");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].date, "2026-07-25");
  db.close();
});

test("getScrapeSummary aggregates totals", () => {
  const db = initDb(":memory:");
  upsertSalesRow(db, {
    date: "2026-07-25",
    itemCode: "shop:1",
    trackingId: "slot0",
    clicks: 10,
    orders: 1,
    reward: 300,
  });
  upsertSalesRow(db, {
    date: "2026-07-25",
    itemCode: "shop:2",
    trackingId: "slot1",
    clicks: 5,
    orders: 2,
    reward: 800,
  });
  const s = getScrapeSummary(db, "2026-07-25", "2026-07-25");
  assert.equal(s.rows, 2);
  assert.equal(s.totalClicks, 15);
  assert.equal(s.totalOrders, 3);
  assert.equal(s.totalReward, 1100);
  db.close();
});
```

- [ ] **Step 2: package.json に test script を追加**

`package.json` の scripts を以下のように変更（`diagnose` の直後）:

```json
    "diagnose": "npx tsx src/utils/cookie-diagnose.ts",
    "test": "node --test --import tsx tests/*.test.ts",
```

- [ ] **Step 3: テストが失敗することを確認**

Run:
```bash
npm test 2>&1 | tail -20
```

Expected: `Cannot find module '../src/affiliate/sales-db'` 相当のエラー

- [ ] **Step 4: 実装を書く**

`src/affiliate/sales-db.ts`:

```typescript
import Database from "better-sqlite3";
import * as fs from "fs";
import * as path from "path";

export interface SalesRow {
  date: string;
  itemCode: string;
  trackingId: string;
  clicks: number;
  orders: number;
  reward: number;
}

const DEFAULT_DB_PATH = path.join(process.cwd(), "data", "sales.sqlite");

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS sales (
  date        TEXT NOT NULL,
  item_code   TEXT NOT NULL,
  tracking_id TEXT NOT NULL,
  clicks      INTEGER NOT NULL DEFAULT 0,
  orders      INTEGER NOT NULL DEFAULT 0,
  reward      INTEGER NOT NULL DEFAULT 0,
  scraped_at  TEXT NOT NULL,
  PRIMARY KEY (date, item_code, tracking_id)
);
CREATE INDEX IF NOT EXISTS idx_sales_date ON sales(date);
CREATE INDEX IF NOT EXISTS idx_sales_slot ON sales(tracking_id);
`;

export function initDb(dbPath: string = DEFAULT_DB_PATH): Database.Database {
  if (dbPath !== ":memory:") {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  }
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.exec(SCHEMA_SQL);
  return db;
}

export function upsertSalesRow(db: Database.Database, row: SalesRow): void {
  const stmt = db.prepare(`
    INSERT INTO sales (date, item_code, tracking_id, clicks, orders, reward, scraped_at)
    VALUES (@date, @itemCode, @trackingId, @clicks, @orders, @reward, @scrapedAt)
    ON CONFLICT(date, item_code, tracking_id) DO UPDATE SET
      clicks = excluded.clicks,
      orders = excluded.orders,
      reward = excluded.reward,
      scraped_at = excluded.scraped_at
  `);
  stmt.run({ ...row, scrapedAt: new Date().toISOString() });
}

export function getSalesByDateRange(
  db: Database.Database,
  from: string,
  to: string,
): SalesRow[] {
  const rows = db
    .prepare(
      "SELECT date, item_code as itemCode, tracking_id as trackingId, clicks, orders, reward FROM sales WHERE date BETWEEN ? AND ? ORDER BY date, item_code",
    )
    .all(from, to) as SalesRow[];
  return rows;
}

export function getScrapeSummary(
  db: Database.Database,
  from: string,
  to: string,
): { rows: number; totalClicks: number; totalOrders: number; totalReward: number } {
  const r = db
    .prepare(
      "SELECT COUNT(*) as rows, COALESCE(SUM(clicks),0) as totalClicks, COALESCE(SUM(orders),0) as totalOrders, COALESCE(SUM(reward),0) as totalReward FROM sales WHERE date BETWEEN ? AND ?",
    )
    .get(from, to) as { rows: number; totalClicks: number; totalOrders: number; totalReward: number };
  return r;
}
```

- [ ] **Step 5: .gitignore を更新**

`.gitignore` に以下を追記:

```
data/sales.sqlite
data/sales.sqlite-shm
data/sales.sqlite-wal
data/affiliate-debug/*
!data/affiliate-debug/.gitkeep
```

- [ ] **Step 6: テストが通ることを確認**

Run:
```bash
npm test 2>&1 | tail -20
```

Expected: `# pass 4` `# fail 0`

- [ ] **Step 7: 型チェック**

Run:
```bash
npx tsc --noEmit
```

Expected: エラー 0 件

- [ ] **Step 8: Commit**

```bash
git add src/affiliate/sales-db.ts tests/sales-db.test.ts package.json .gitignore
git commit -m "feat(P1): sales-db (sqlite wrapper) with 4 unit tests

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 3: `src/affiliate/report-parser.ts` — CSV パーサ

**Files:**
- Create: `src/affiliate/report-parser.ts`
- Create: `tests/report-parser.test.ts`

**Interfaces:**
- Consumes: `SalesRow` from `src/affiliate/sales-db.ts`
- Produces:
  - `export function parseAffiliateCsv(csv: string, opts: { date: string; defaultTrackingId?: string }): SalesRow[]`
  - CSV は Shift_JIS の可能性があるため呼び出し側で decode 済み UTF-8 文字列を渡す前提
  - 楽天アフィリレポートCSVの想定ヘッダ（実物確認は Task 8）:
    - 「商品コード」or「商品ID」or「item_code」→ itemCode
    - 「クリック数」or「クリック」or「clicks」→ clicks
    - 「成果件数」or「成果」or「注文件数」or「orders」→ orders
    - 「報酬額」or「報酬」or「reward」→ reward (円、カンマ・「¥」記号を除去して整数化)
    - 「トラッキングID」or「tracking_id」→ trackingId（無ければ `opts.defaultTrackingId ?? ""`）
  - 空行と全角スペース行は無視、ヘッダに該当カラムが無ければ throw

- [ ] **Step 1: テストを書く**（TDD — Red）

`tests/report-parser.test.ts`:

```typescript
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseAffiliateCsv } from "../src/affiliate/report-parser";

test("parseAffiliateCsv: 基本形（クリック/成果/報酬 列）", () => {
  const csv = [
    "商品コード,商品名,クリック数,成果件数,報酬額",
    "shop-a:10001,テスト商品A,15,2,600",
    "shop-b:20002,テスト商品B,3,0,0",
  ].join("\n");
  const rows = parseAffiliateCsv(csv, { date: "2026-07-25", defaultTrackingId: "slot0" });
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], {
    date: "2026-07-25",
    itemCode: "shop-a:10001",
    trackingId: "slot0",
    clicks: 15,
    orders: 2,
    reward: 600,
  });
  assert.equal(rows[1].reward, 0);
});

test("parseAffiliateCsv: カンマ入り金額と円記号を除去", () => {
  const csv = [
    "商品コード,クリック数,成果件数,報酬額",
    "shop:1,120,3,\"¥1,250\"",
  ].join("\n");
  const rows = parseAffiliateCsv(csv, { date: "2026-07-25" });
  assert.equal(rows[0].reward, 1250);
});

test("parseAffiliateCsv: トラッキングID列が存在すればそれを優先", () => {
  const csv = [
    "商品コード,クリック数,成果件数,報酬額,トラッキングID",
    "shop:1,5,1,300,slot2-furusato",
  ].join("\n");
  const rows = parseAffiliateCsv(csv, { date: "2026-07-25", defaultTrackingId: "slot0" });
  assert.equal(rows[0].trackingId, "slot2-furusato");
});

test("parseAffiliateCsv: 必須列が無い場合は throw", () => {
  const csv = "商品名,クリック数\nテスト,10";
  assert.throws(
    () => parseAffiliateCsv(csv, { date: "2026-07-25" }),
    /商品コード列が見つかりません/,
  );
});

test("parseAffiliateCsv: 空行を無視", () => {
  const csv = [
    "商品コード,クリック数,成果件数,報酬額",
    "",
    "shop:1,10,1,300",
    "   ",
    "shop:2,5,0,0",
  ].join("\n");
  const rows = parseAffiliateCsv(csv, { date: "2026-07-25" });
  assert.equal(rows.length, 2);
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run:
```bash
npm test 2>&1 | tail -30
```

Expected: `report-parser` 系のテストが全て失敗（モジュール未実装）

- [ ] **Step 3: 実装を書く**

`src/affiliate/report-parser.ts`:

```typescript
import type { SalesRow } from "./sales-db";

const HEADER_ALIASES = {
  itemCode: ["商品コード", "商品ID", "item_code", "itemcode"],
  clicks: ["クリック数", "クリック", "clicks"],
  orders: ["成果件数", "成果", "注文件数", "orders"],
  reward: ["報酬額", "報酬", "reward"],
  trackingId: ["トラッキングID", "トラッキングid", "tracking_id", "trackingid"],
} as const;

/** 1行を CSV としてトークン分割（ダブルクォート内のカンマを保護）。 */
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuote = false;
  for (const ch of line) {
    if (ch === '"') {
      inQuote = !inQuote;
    } else if (ch === "," && !inQuote) {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

function findIndex(header: string[], aliases: readonly string[]): number {
  const norm = header.map((h) => h.trim().toLowerCase());
  for (const a of aliases) {
    const i = norm.indexOf(a.toLowerCase());
    if (i >= 0) return i;
  }
  return -1;
}

function toIntStrict(raw: string): number {
  const cleaned = raw.replace(/[¥,\s"]/g, "");
  if (cleaned === "") return 0;
  const n = Number.parseInt(cleaned, 10);
  return Number.isFinite(n) ? n : 0;
}

export function parseAffiliateCsv(
  csv: string,
  opts: { date: string; defaultTrackingId?: string },
): SalesRow[] {
  const lines = csv
    .split(/\r?\n/)
    .filter((l) => l.replace(/[\s\u3000]/g, "").length > 0);
  if (lines.length < 2) return [];

  const header = splitCsvLine(lines[0]);
  const iItemCode = findIndex(header, HEADER_ALIASES.itemCode);
  const iClicks = findIndex(header, HEADER_ALIASES.clicks);
  const iOrders = findIndex(header, HEADER_ALIASES.orders);
  const iReward = findIndex(header, HEADER_ALIASES.reward);
  const iTracking = findIndex(header, HEADER_ALIASES.trackingId);

  if (iItemCode < 0) throw new Error("商品コード列が見つかりません");
  if (iClicks < 0) throw new Error("クリック数列が見つかりません");
  if (iOrders < 0) throw new Error("成果件数列が見つかりません");
  if (iReward < 0) throw new Error("報酬額列が見つかりません");

  const defaultTid = opts.defaultTrackingId ?? "";

  const rows: SalesRow[] = [];
  for (let li = 1; li < lines.length; li++) {
    const cols = splitCsvLine(lines[li]);
    const itemCode = (cols[iItemCode] ?? "").trim();
    if (!itemCode) continue;
    const trackingId =
      iTracking >= 0 && cols[iTracking]?.trim() ? cols[iTracking].trim() : defaultTid;
    rows.push({
      date: opts.date,
      itemCode,
      trackingId,
      clicks: toIntStrict(cols[iClicks] ?? "0"),
      orders: toIntStrict(cols[iOrders] ?? "0"),
      reward: toIntStrict(cols[iReward] ?? "0"),
    });
  }
  return rows;
}
```

- [ ] **Step 4: テストが通ることを確認**

Run:
```bash
npm test 2>&1 | tail -30
```

Expected: 全テスト成功（sales-db 4 + report-parser 5 = 9 tests, 0 fail）

- [ ] **Step 5: 型チェック**

Run:
```bash
npx tsc --noEmit
```

Expected: エラー 0 件

- [ ] **Step 6: Commit**

```bash
git add src/affiliate/report-parser.ts tests/report-parser.test.ts
git commit -m "feat(P1): CSV parser for affiliate report (5 tests)

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 4: `src/affiliate/sales-scraper.ts` — Playwright スクレイパー

**Files:**
- Create: `src/affiliate/sales-scraper.ts`
- Create: `data/affiliate-debug/.gitkeep`

**Interfaces:**
- Consumes:
  - `parseAffiliateCsv` from `report-parser.ts`
  - `SalesRow`, `initDb`, `upsertSalesRow`, `getScrapeSummary` from `sales-db.ts`
  - `notifyDomError`, `notifyReport` from `../notifiers`
  - 環境変数 `RAKUTEN_AFFILIATE_COOKIE`（JSON配列、Playwright Cookie形式）
  - 環境変数 `RAKUTEN_AFFILIATE_REPORT_URL`（任意、既定 `https://affiliate.rakuten.co.jp/rp/mypage/report/`）
- Produces:
  - `export interface ScrapeResult { ok: boolean; date: string; rowsInserted: number; totalReward: number; error?: string; debugArtifact?: string }`
  - `export async function scrapeAffiliateReport(opts?: { date?: string; dbPath?: string }): Promise<ScrapeResult>` — 既定は「昨日」のレポートを取得（YYYY-MM-DD, JST）
- 動作:
  1. Cookie 注入で `RAKUTEN_AFFILIATE_REPORT_URL` にアクセス
  2. ページ内で「CSVダウンロード」or「CSV出力」ボタンを探しクリック（download イベント受け取り）
  3. 取得できた CSV は Shift_JIS の可能性が高いので `iconv-lite` を使わず、まず UTF-8 で試し、`商品コード` 等が読めなければ Shift_JIS として `Buffer.from(...).toString("binary")` の後 `TextDecoder("shift_jis")` を試す
  4. 成功: parser で解析 → DB upsert → summary を返す
  5. 失敗（Cookie失効/DOM変化/CSV未取得）: `data/affiliate-debug/YYYYMMDD-HHmmss.{html,png}` を保存し、Discord 通知、`{ ok: false, ..., debugArtifact }` を返す

- [ ] **Step 1: `.gitkeep` を作成**

```bash
mkdir -p data/affiliate-debug
touch data/affiliate-debug/.gitkeep
```

- [ ] **Step 2: スクレイパーを実装**

`src/affiliate/sales-scraper.ts`:

```typescript
import { chromium, type Cookie } from "playwright";
import * as fs from "fs";
import * as path from "path";
import * as dotenv from "dotenv";
import { parseAffiliateCsv } from "./report-parser";
import {
  initDb,
  upsertSalesRow,
  getScrapeSummary,
  type SalesRow,
} from "./sales-db";
import { notifyDomError, notifyReport } from "../notifiers";
dotenv.config();

const DEFAULT_REPORT_URL = "https://affiliate.rakuten.co.jp/rp/mypage/report/";
const DEBUG_DIR = path.join(process.cwd(), "data", "affiliate-debug");

export interface ScrapeResult {
  ok: boolean;
  date: string;
  rowsInserted: number;
  totalReward: number;
  error?: string;
  debugArtifact?: string;
}

function parseCookiesFromEnv(): Cookie[] {
  const raw = process.env.RAKUTEN_AFFILIATE_COOKIE ?? "";
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) return parsed as Cookie[];
    } catch {
      console.warn("[sales-scraper] RAKUTEN_AFFILIATE_COOKIE のパース失敗、cookies-affiliate.json へフォールバック");
    }
  }
  const file = path.join(process.cwd(), "cookies-affiliate.json");
  if (fs.existsSync(file)) {
    const parsed = JSON.parse(fs.readFileSync(file, "utf-8")) as unknown;
    if (Array.isArray(parsed)) return parsed as Cookie[];
  }
  throw new Error("RAKUTEN_AFFILIATE_COOKIE 未設定（環境変数・cookies-affiliate.json ともに無い）");
}

/** YYYY-MM-DD の JST 昨日 */
function yesterdayJst(): string {
  const now = new Date();
  const jstNow = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  jstNow.setUTCDate(jstNow.getUTCDate() - 1);
  return jstNow.toISOString().slice(0, 10);
}

function tsStamp(): string {
  return new Date().toISOString().replace(/[-:.T]/g, "").slice(0, 15);
}

/** CSV バッファを UTF-8 → 失敗時 Shift_JIS で decode */
function decodeCsv(buf: Buffer): string {
  const utf8 = buf.toString("utf-8");
  if (/商品コード|クリック数/.test(utf8)) return utf8;
  const sjis = new TextDecoder("shift_jis").decode(buf);
  return sjis;
}

export async function scrapeAffiliateReport(
  opts: { date?: string; dbPath?: string } = {},
): Promise<ScrapeResult> {
  const date = opts.date ?? yesterdayJst();
  const reportUrl = process.env.RAKUTEN_AFFILIATE_REPORT_URL ?? DEFAULT_REPORT_URL;
  fs.mkdirSync(DEBUG_DIR, { recursive: true });

  const cookies = parseCookiesFromEnv();
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    locale: "ja-JP",
    timezoneId: "Asia/Tokyo",
    acceptDownloads: true,
  });
  await context.addCookies(cookies);
  const page = await context.newPage();

  const dumpDebug = async (label: string): Promise<string> => {
    const base = path.join(DEBUG_DIR, `${tsStamp()}-${label}`);
    try {
      await page.screenshot({ path: `${base}.png`, fullPage: true });
      const html = await page.content();
      fs.writeFileSync(`${base}.html`, html, "utf-8");
    } catch (e) {
      console.warn("[sales-scraper] dumpDebug 失敗:", e);
    }
    return base;
  };

  try {
    console.log(`[sales-scraper] レポートページ: ${reportUrl}`);
    await page.goto(reportUrl, { waitUntil: "domcontentloaded", timeout: 30000 });

    const url = page.url();
    if (url.includes("login") || url.includes("signin") || url.includes("grp01.id.rakuten.co.jp")) {
      const artifact = await dumpDebug("cookie-expired");
      await notifyDomError(`楽天アフィリエイト Cookie 失効（RAKUTEN_AFFILIATE_COOKIE を更新してください）\ndebug: ${artifact}`);
      return { ok: false, date, rowsInserted: 0, totalReward: 0, error: "cookie-expired", debugArtifact: artifact };
    }

    // 「CSVダウンロード」相当のリンク/ボタンを複数候補で探す
    const csvCandidateRe = /CSV.*(ダウンロード|出力|DL)|(ダウンロード|出力|DL).*CSV/i;
    const [download] = await Promise.all([
      page.waitForEvent("download", { timeout: 20000 }).catch(() => null),
      page.getByText(csvCandidateRe).first().click({ timeout: 10000 }).catch(() => null),
    ]);
    if (!download) {
      const artifact = await dumpDebug("csv-button-not-found");
      await notifyDomError(`CSVダウンロード導線が見つかりません。UI変更の可能性。debug: ${artifact}`);
      return { ok: false, date, rowsInserted: 0, totalReward: 0, error: "csv-button-not-found", debugArtifact: artifact };
    }

    const dlPath = await download.path();
    if (!dlPath) {
      const artifact = await dumpDebug("csv-download-failed");
      return { ok: false, date, rowsInserted: 0, totalReward: 0, error: "csv-download-failed", debugArtifact: artifact };
    }
    const buf = fs.readFileSync(dlPath);
    const csv = decodeCsv(buf);

    let parsed: SalesRow[];
    try {
      parsed = parseAffiliateCsv(csv, { date, defaultTrackingId: "" });
    } catch (e) {
      const artifact = await dumpDebug("csv-parse-failed");
      // 生CSVも保存（診断用）
      fs.writeFileSync(`${artifact}.csv`, csv, "utf-8");
      await notifyDomError(`CSVパース失敗: ${(e as Error).message}\ndebug: ${artifact}`);
      return { ok: false, date, rowsInserted: 0, totalReward: 0, error: `parse-failed: ${(e as Error).message}`, debugArtifact: artifact };
    }

    const db = initDb(opts.dbPath);
    for (const row of parsed) upsertSalesRow(db, row);
    const summary = getScrapeSummary(db, date, date);
    db.close();

    await notifyReport(
      "📊 楽天アフィリ実売取り込み",
      `date=${date} rows=${summary.rows} clicks=${summary.totalClicks} orders=${summary.totalOrders} reward=¥${summary.totalReward}`,
    );

    return { ok: true, date, rowsInserted: summary.rows, totalReward: summary.totalReward };
  } finally {
    await context.close();
    await browser.close();
  }
}
```

- [ ] **Step 3: 型チェック**

Run:
```bash
npx tsc --noEmit
```

Expected: エラー 0 件

- [ ] **Step 4: Commit**

```bash
git add src/affiliate/sales-scraper.ts data/affiliate-debug/.gitkeep
git commit -m "feat(P1): affiliate sales scraper (Playwright + CSV download)

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 5: `src/run_sales_scrape.ts` エントリポイント + npm script

**Files:**
- Create: `src/run_sales_scrape.ts`
- Modify: `package.json`（scripts に `scrape-sales` を追加）

**Interfaces:**
- Consumes: `scrapeAffiliateReport` from `src/affiliate/sales-scraper.ts`
- Produces: `npm run scrape-sales` で実行。exit 0=成功、1=失敗

- [ ] **Step 1: エントリを作成**

`src/run_sales_scrape.ts`:

```typescript
import { scrapeAffiliateReport } from "./affiliate/sales-scraper";

async function main(): Promise<void> {
  console.log("[run_sales_scrape] 楽天アフィリエイト実売取り込み開始");
  const result = await scrapeAffiliateReport();
  console.log("[run_sales_scrape] 結果:", JSON.stringify(result));
  process.exit(result.ok ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error("[run_sales_scrape] fatal:", err);
  process.exit(2);
});
```

- [ ] **Step 2: package.json に script を追加**

`package.json` の scripts に追加（`export-affiliate-cookie` の後）:

```json
    "export-affiliate-cookie": "npx tsx tools/export-affiliate-cookie.ts",
    "scrape-sales": "npx tsx src/run_sales_scrape.ts",
```

- [ ] **Step 3: 型チェック**

Run:
```bash
npx tsc --noEmit
```

Expected: エラー 0 件

- [ ] **Step 4: Commit**

```bash
git add src/run_sales_scrape.ts package.json
git commit -m "feat(P1): npm run scrape-sales entry point

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 6: `cookie-diagnose.ts` に affiliate Cookie チェックを追加

**Files:**
- Modify: `src/utils/cookie-diagnose.ts`

**Interfaces:**
- Consumes: `chromium` from playwright, `notifyCookieExpired` from `../notifiers`
- Produces: `npm run diagnose` が ROOM Cookie に加え affiliate Cookie もチェック。exit 0=両方 valid、1=どちらか INVALID

- [ ] **Step 1: `diagnoseAffiliateCookie` を追加**

`src/utils/cookie-diagnose.ts` を以下に置換:

```typescript
import { chromium, type Cookie } from "playwright";
import * as fs from "fs";
import * as path from "path";
import { createAuthenticatedContext, validateSession } from "../session";
import { notifyCookieExpired } from "../notifiers";

const AFFILIATE_TOP = "https://affiliate.rakuten.co.jp/";

async function diagnoseRoomCookie(): Promise<boolean> {
  const { browser, context } = await createAuthenticatedContext(true);
  try {
    const ok = await validateSession(context);
    console.log(`[diagnose] ROOM_COOKIE: ${ok ? "valid" : "INVALID"}`);
    if (!ok) await notifyCookieExpired();
    return ok;
  } finally {
    await context.close();
    await browser.close();
  }
}

function parseAffiliateCookies(): Cookie[] | null {
  const raw = process.env.RAKUTEN_AFFILIATE_COOKIE ?? "";
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) return parsed as Cookie[];
    } catch { /* fallthrough */ }
  }
  const file = path.join(process.cwd(), "cookies-affiliate.json");
  if (fs.existsSync(file)) {
    const parsed = JSON.parse(fs.readFileSync(file, "utf-8")) as unknown;
    if (Array.isArray(parsed)) return parsed as Cookie[];
  }
  return null;
}

async function diagnoseAffiliateCookie(): Promise<boolean> {
  const cookies = parseAffiliateCookies();
  if (!cookies) {
    console.log("[diagnose] RAKUTEN_AFFILIATE_COOKIE: 未設定");
    return false;
  }
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    locale: "ja-JP",
    timezoneId: "Asia/Tokyo",
  });
  await context.addCookies(cookies);
  const page = await context.newPage();
  try {
    await page.goto(AFFILIATE_TOP, { waitUntil: "domcontentloaded", timeout: 30000 });
    const url = page.url();
    const ok = !(url.includes("login") || url.includes("signin") || url.includes("grp01.id.rakuten.co.jp"));
    console.log(`[diagnose] RAKUTEN_AFFILIATE_COOKIE: ${ok ? "valid" : "INVALID"}`);
    return ok;
  } catch (err) {
    console.error(`[diagnose] affiliate check エラー:`, err);
    return false;
  } finally {
    await context.close();
    await browser.close();
  }
}

async function main(): Promise<void> {
  const roomOk = await diagnoseRoomCookie();
  const affiliateOk = await diagnoseAffiliateCookie();
  process.exit(roomOk && affiliateOk ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error("[diagnose] fatal:", err);
  process.exit(2);
});
```

- [ ] **Step 2: 型チェック**

Run:
```bash
npx tsc --noEmit
```

Expected: エラー 0 件

- [ ] **Step 3: ローカルで実行**（affiliate Cookie 未設定なら「未設定」と出て exit 1）

Run:
```bash
npm run diagnose 2>&1 | tail -5
```

Expected: `[diagnose] ROOM_COOKIE: valid` + `[diagnose] RAKUTEN_AFFILIATE_COOKIE: 未設定 or valid`。fatal で終わらない

- [ ] **Step 4: Commit**

```bash
git add src/utils/cookie-diagnose.ts
git commit -m "feat(P1): diagnose も affiliate Cookie を検査

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 7: `sales-scrape.yml` — 日次 GitHub Actions ワークフロー

**Files:**
- Create: `.github/workflows/sales-scrape.yml`

**Interfaces:**
- Consumes: Secrets `RAKUTEN_AFFILIATE_COOKIE`, `DISCORD_WEBHOOK_URL`
- Produces: 毎日 JST 02:00 に自動実行、`data/sales.sqlite` の更新は cache に載せて次回に持ち越し（DB は Git 管理外だが Actions cache で保持）
- Phase 0 の `concurrency: main-writer` に乗る

- [ ] **Step 1: ワークフローを作成**

`.github/workflows/sales-scrape.yml`:

```yaml
name: 楽天アフィリエイト 実売取り込み

on:
  schedule:
    # JST 02:00 → UTC 17:00 (前日) — 楽天アフィリのレポート確定が遅めなので早朝
    - cron: "0 17 * * *"
  workflow_dispatch:
    inputs:
      date:
        description: "取得対象日 (YYYY-MM-DD, 空欄=昨日)"
        required: false
        default: ""

concurrency:
  group: main-writer
  cancel-in-progress: false

permissions:
  contents: write

jobs:
  scrape:
    runs-on: ubuntu-latest
    timeout-minutes: 15

    steps:
      - name: リポジトリをチェックアウト
        uses: actions/checkout@v4

      - name: Node.js のセットアップ
        uses: actions/setup-node@v4
        with:
          node-version: "20"
          cache: "npm"

      - name: sales.sqlite をキャッシュから復元
        uses: actions/cache@v4
        with:
          path: |
            data/sales.sqlite
            data/sales.sqlite-shm
            data/sales.sqlite-wal
          key: sales-db-${{ github.run_id }}
          restore-keys: |
            sales-db-

      - name: 依存関係をインストール
        run: npm ci

      - name: Playwright Chromium をインストール
        run: npx playwright install chromium --with-deps

      - name: 実売レポートを取得して DB へ upsert
        env:
          CI: "true"
          RAKUTEN_AFFILIATE_COOKIE: ${{ secrets.RAKUTEN_AFFILIATE_COOKIE }}
          RAKUTEN_AFFILIATE_REPORT_URL: ${{ vars.RAKUTEN_AFFILIATE_REPORT_URL || '' }}
          DISCORD_WEBHOOK_URL: ${{ secrets.DISCORD_WEBHOOK_URL }}
          SCRAPE_DATE: ${{ github.event.inputs.date || '' }}
        run: |
          if [ -n "${SCRAPE_DATE}" ]; then
            npx tsx -e "require('./src/affiliate/sales-scraper.ts').scrapeAffiliateReport({date: process.env.SCRAPE_DATE}).then(r => { console.log(JSON.stringify(r)); process.exit(r.ok ? 0 : 1); }).catch(e => { console.error(e); process.exit(2); });"
          else
            npm run scrape-sales
          fi

      - name: 診断アーティファクトをアップロード（失敗時）
        if: failure()
        uses: actions/upload-artifact@v4
        with:
          name: affiliate-debug-${{ github.run_id }}
          path: data/affiliate-debug/
          retention-days: 7
          if-no-files-found: ignore

      - name: 失敗時 Discord 通知
        if: failure()
        env:
          DISCORD_WEBHOOK_URL: ${{ secrets.DISCORD_WEBHOOK_URL }}
          GITHUB_SERVER_URL: ${{ github.server_url }}
          GITHUB_REPOSITORY: ${{ github.repository }}
          GITHUB_RUN_ID: ${{ github.run_id }}
        run: |
          npx tsx -e "require('./src/notifiers.ts').notifyWorkflowFailure('sales-scrape', 'アフィリレポート取り込みが失敗しました');"
```

- [ ] **Step 2: 構文の目視確認**

Run:
```bash
grep -E "concurrency:|scrape-sales|notifyWorkflowFailure" .github/workflows/sales-scrape.yml
```

Expected: 3行ヒット

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/sales-scrape.yml
git commit -m "feat(P1): sales-scrape.yml (日次 02:00 JST cron)

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 8: ローカル dry-run + README 更新 + push

**Files:**
- Modify: `README.md`（Phase 1 セットアップ手順を追記）

**Interfaces:** なし（検証・ドキュメント）

- [ ] **Step 1: 全テストを再実行**

Run:
```bash
npm test 2>&1 | tail -20
```

Expected: `# pass 9` `# fail 0`

- [ ] **Step 2: 型チェック**

Run:
```bash
npx tsc --noEmit
```

Expected: エラー 0 件

- [ ] **Step 3: 手動で affiliate Cookie を取得（ユーザー作業）**

Run:
```bash
npm run export-affiliate-cookie
```

ブラウザが開くので楽天IDでログイン → `affiliate.rakuten.co.jp/` に遷移するのを待つ → 標準出力に出た1行JSONをコピー。

- [ ] **Step 4: Cookie を GitHub Secrets に登録（ユーザー作業）**

GitHub リポジトリ → Settings → Secrets and variables → Actions → New repository secret

- Name: `RAKUTEN_AFFILIATE_COOKIE`
- Secret: Step 3 でコピーした1行JSON

- [ ] **Step 5: ローカル dry-run**

Run:
```bash
npm run scrape-sales 2>&1 | tail -20
```

Expected の3通り:

- **成功パターン**: `[sales-scraper] レポートページ: https://...` → `[sales-scraper] ...` → `📊 楽天アフィリ実売取り込み date=... rows=N ...` → `[run_sales_scrape] 結果: {"ok":true,...}` → exit 0
- **CSVボタン発見失敗**: `data/affiliate-debug/<ts>-csv-button-not-found.html` が保存される。ファイルを見てセレクタ調整が必要
- **Cookie失効**: `data/affiliate-debug/<ts>-cookie-expired.html` が保存される。Step 3 からやり直し

- [ ] **Step 6: 診断アーティファクト or 成功結果を確認**

- 成功なら SQLite に行が入ったか確認:

  ```bash
  npx tsx -e "const {initDb,getScrapeSummary}=require('./src/affiliate/sales-db.ts'); const d=initDb(); const s=getScrapeSummary(d,'2000-01-01','2099-12-31'); console.log(s); d.close();"
  ```

  Expected: `{ rows: N, totalClicks: N, totalOrders: N, totalReward: N }`

- 失敗なら `data/affiliate-debug/` の最新ダンプを開き、CSVダウンロードボタンの実際の text/セレクタを確認 → `src/affiliate/sales-scraper.ts` の `csvCandidateRe` を調整 → 再実行

- [ ] **Step 7: README に Phase 1 手順を追記**

`README.md` の最終セクションに以下を追加:

```markdown
---

## 📈 Phase 1: 楽天アフィリエイト実売データ取り込み

Phase 1 では楽天アフィリエイト管理画面から日次で実売データ（クリック数・成果件数・報酬額）を取得し `data/sales.sqlite` に永続化します。

### セットアップ（初回のみ）

1. **Affiliate Cookie を取得**

    ```bash
    npm run export-affiliate-cookie
    ```

    ブラウザが開くので楽天IDでログイン。`affiliate.rakuten.co.jp/` に遷移すると自動でCookieが保存されます。

2. **GitHub Secrets に登録**

    - Name: `RAKUTEN_AFFILIATE_COOKIE`
    - Secret: 手順1の標準出力に出た1行JSON

3. **（任意）レポートURLの上書き**

    デフォルトは `https://affiliate.rakuten.co.jp/rp/mypage/report/`。異なる場合は Variables に `RAKUTEN_AFFILIATE_REPORT_URL` を設定。

### 動作確認

```bash
npm run diagnose        # ROOM + Affiliate Cookie の有効性チェック
npm run scrape-sales    # 昨日のレポートを取得して DB に反映
npm test                # sales-db / report-parser の単体テスト
```

### 自動実行

`.github/workflows/sales-scrape.yml` が毎日 JST 02:00 に発火します。失敗時は Discord に通知＋診断アーティファクトが Actions の Artifacts に上がります。
```

- [ ] **Step 8: Commit + Push**

```bash
git add README.md
git commit -m "docs(P1): Phase 1 セットアップ手順を README に追記

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"

bash tools/safe-push.sh
```

Expected: `[safe-push] success on attempt 1`

---

## 完了判定

Phase 1 は以下すべてが満たされた時点で完了とする:

1. `npm test` が **9 pass 0 fail**（sales-db 4 + report-parser 5）
2. `npx tsc --noEmit` がエラー 0 件
3. `npm run diagnose` が ROOM/Affiliate 両方 valid を返す
4. `npm run scrape-sales` が最低1回成功し `data/sales.sqlite` に行が入る（または diagnostic dump が出て原因が特定される）
5. `.github/workflows/sales-scrape.yml` が push 済みで、手動発火した run が緑を返す
6. `RAKUTEN_AFFILIATE_COOKIE` が GitHub Secrets に登録済み

## 次フェーズ

Phase 2 (Day 4–7): persona.json 定義 + `src/ig/ig-post-engine.ts` + scout の3スロット並行モード + ROOM投稿削減。実売データを元に Phase 3 で学習ループの正解ラベル切替へ。別プランで管理する。
