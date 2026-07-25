# Phase 3: 学習ループの正解ラベル切替 (likes → sales_score) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** commander の戦略更新を「いいね数」→「実売スコア (`reward*0.7 + click*0.3`)」に切替。Phase 1 で取り込んでいる `data/sales.sqlite` と Phase 2 で PostRecord に埋め込んだ `slot`/`itemCodeHash` を JOIN し、slot 別・ジャンル別・価格帯別の実売実績を strategy.json に反映させる。実売データが薄い日は既存 likes ベースに自動フォールバックし、目隠し最適化ではなく可視化された最適化に切り替える。

**Architecture:** (1) `src/agents/sales-aggregator.ts` を新設し、post_history × sales-db を JOIN して slot/genre/priceBand 別の sales_score を計算する純粋関数群を集約。(2) `analyst-agent.ts` の `AnalysisResult` に `salesDataAvailable`, `slotSales`, `genreSales`, `priceBandSales` を追加し、runAnalystAgent 実行時に自動で JOIN。(3) `commander.ts` の `heuristicDecision` と LLM プロンプトを分岐: `salesDataAvailable=true` なら sales_score ベースで weight を再配分（top +50%, bottom -50%, クランプ 0.5-2.0）、false なら既存 likes ベース。判断根拠に `mode: "sales" | "likes"` を Discord レポートに明記。(4) `Strategy` 型に `salesGen?: boolean` と `salesGenSince?: string` を追加。sales モードで更新した世代は `salesGen: true` でマーキング。

**Tech Stack:** TypeScript / better-sqlite3 (既存) / `node:test`

## Global Constraints

- 対象リポジトリ: `E:\rakuten-room-auto-system`
- Node.js `20` 系、依存追加禁止
- `sales_score = reward * 0.7 + click * 0.3` （spec 第3節）
- 実売データ「薄い」の定義: `slotSales の合計 rows < 3` （3件未満なら likes ベースへフォールバック）
- weight クランプは既存 `clampWeights` (0.5〜2.0) を維持
- sales_score 導入後も `likes` は補助指標として `AnalysisResult` に保持（比較ログ用）
- 全 commit は日本語メッセージ + `Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>` 付与
- 全 push は `bash tools/safe-push.sh`
- スペック本体: [../specs/2026-07-25-rakuten-room-rebuild-sales-driven-design.md](../specs/2026-07-25-rakuten-room-rebuild-sales-driven-design.md) 第2章G1, 第3節, 第6.2章, 第9章P3, 第10章
- Phase 0/1/2 完了前提。特に Phase 2 の `PostRecord.slot` と `PostRecord.itemCodeHash` が Phase 3 の JOIN キー

---

## File Structure

**新規:**
- `src/agents/sales-aggregator.ts` — post_history × sales-db を JOIN する純粋関数群
- `tests/sales-aggregator.test.ts`

**変更:**
- `src/agents/store.ts` — `Strategy` 型に `salesGen?: boolean`, `salesGenSince?: string`, `slotWeights?: Record<string, number>` を追加
- `src/agents/analyst-agent.ts` — `AnalysisResult` に sales 系フィールド追加、runAnalystAgent で JOIN 実施
- `src/agents/commander.ts` — heuristicDecision と LLM プロンプトを sales モードに分岐、Discord レポートに mode 明示
- `README.md` — Phase 3 の学習ループ挙動を追記

**手を付けない:**
- `src/agents/metrics-agent.ts` — likes 収集は継続（比較指標として保持）
- `run_learn.ts` — 順序は同じ（metrics → analyst → commander）

---

### Task 1: `Strategy` 型に sales モード用フィールドを追加

**Files:**
- Modify: `src/agents/store.ts`

**Interfaces:**
- Consumes: なし
- Produces: `Strategy` 型に以下 optional フィールド追加（後方互換）:
  - `salesGen?: boolean` — この世代が sales_score モードで作られたか
  - `salesGenSince?: string` — sales モードに切替わった時刻 (ISO)
  - `slotWeights?: Record<string, number>` — slot 別重み（Phase 4 で activeSlot 決定に使用）

- [ ] **Step 1: 現在の Strategy 型を確認**

Run:
```bash
grep -nA 15 "^export interface Strategy" src/agents/store.ts
```

- [ ] **Step 2: 3 フィールドを追加**

`src/agents/store.ts` の `Strategy` 定義の末尾に:

```typescript
export interface Strategy {
  generation: number;
  updatedAt: string;
  // ... 既存フィールド ...
  commanderNotes: string;
  salesGen?: boolean;                    // Phase 3: sales_score で更新された世代のマーク
  salesGenSince?: string;                // Phase 3: sales モード切替時刻
  slotWeights?: Record<string, number>;  // Phase 3: slot 別重み (Phase 4 で activeSlot 決定に使う)
}
```

- [ ] **Step 3: `defaultStrategy()` にデフォルト値を追加**（optional なのでそのままでも動くが、明示的に追加）

`defaultStrategy()` 関数内の return オブジェクトに以下を追加（他のプロパティの後）:

```typescript
    salesGen: false,
    slotWeights: { slot0: 1, slot1: 1, slot2: 1 },
```

- [ ] **Step 4: 型チェック**

Run: `npx tsc --noEmit 2>&1 | tail -3`
Expected: エラー 0 件

- [ ] **Step 5: Commit**

```bash
git add src/agents/store.ts
git commit -m "feat(P3): Strategy に salesGen / slotWeights フィールド追加

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 2: `sales-aggregator.ts` — sales_score 計算の純粋関数

**Files:**
- Create: `src/agents/sales-aggregator.ts`
- Create: `tests/sales-aggregator.test.ts`

**Interfaces:**
- Consumes: `PostRecord` from `./store`, `SalesRow` from `../affiliate/sales-db`
- Produces:
  - `export const SALES_SCORE_WEIGHT = { reward: 0.7, clicks: 0.3 };`
  - `export function salesScore(row: { reward: number; clicks: number }): number` — 単一行のスコア
  - `export interface SlotSalesAggregate { slot: string; posts: number; matchedSales: number; totalReward: number; totalClicks: number; salesScore: number; }`
  - `export function aggregateSlotSales(history: PostRecord[], sales: SalesRow[]): SlotSalesAggregate[]`
  - `export interface KeyedSalesAggregate { key: string; posts: number; matchedSales: number; totalReward: number; totalClicks: number; salesScore: number; }`
  - `export function aggregateGenreSales(history: PostRecord[], sales: SalesRow[]): KeyedSalesAggregate[]`
  - `export function aggregatePriceBandSales(history: PostRecord[], sales: SalesRow[]): KeyedSalesAggregate[]`
- 3 aggregate は全て `salesScore` 降順ソート

- [ ] **Step 1: テストを書く**

`tests/sales-aggregator.test.ts`:

```typescript
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  salesScore,
  aggregateSlotSales,
  aggregateGenreSales,
  aggregatePriceBandSales,
  SALES_SCORE_WEIGHT,
} from "../src/agents/sales-aggregator";
import { deriveItemCode } from "../src/affiliate/report-parser";

test("salesScore: reward*0.7 + clicks*0.3", () => {
  assert.equal(salesScore({ reward: 100, clicks: 10 }), 100 * 0.7 + 10 * 0.3);
  assert.equal(salesScore({ reward: 0, clicks: 0 }), 0);
});

test("SALES_SCORE_WEIGHT: reward=0.7, clicks=0.3", () => {
  assert.equal(SALES_SCORE_WEIGHT.reward, 0.7);
  assert.equal(SALES_SCORE_WEIGHT.clicks, 0.3);
});

test("aggregateSlotSales: slot 別に score/reward/clicks を集計 (降順)", () => {
  const hA = deriveItemCode("shopA", "itemA");
  const hB = deriveItemCode("shopB", "itemB");
  const history = [
    { ts: "", itemCode: "", itemName: "", genreName: "", price: 1000, postType: 1, hour: 8, slot: "slot0", itemCodeHash: hA },
    { ts: "", itemCode: "", itemName: "", genreName: "", price: 5000, postType: 2, hour: 13, slot: "slot1", itemCodeHash: hB },
  ] as never[];
  const sales = [
    { date: "2026-07-25", itemCode: hA, trackingId: "", clicks: 5, orders: 1, reward: 100 },
    { date: "2026-07-25", itemCode: hB, trackingId: "", clicks: 20, orders: 3, reward: 900 },
  ];
  const result = aggregateSlotSales(history, sales);
  const s1 = result.find((r) => r.slot === "slot1");
  const s0 = result.find((r) => r.slot === "slot0");
  assert.ok(s1 && s0);
  assert.equal(s1.totalReward, 900);
  assert.equal(s1.totalClicks, 20);
  assert.equal(s1.salesScore, 900 * 0.7 + 20 * 0.3);
  assert.equal(s0.salesScore, 100 * 0.7 + 5 * 0.3);
  // 降順
  assert.equal(result[0].slot, "slot1");
});

test("aggregateGenreSales: genre 別集計", () => {
  const hA = deriveItemCode("s", "a");
  const history = [
    { ts: "", itemCode: "", itemName: "", genreName: "キッチン消耗品", price: 1000, postType: 1, hour: 8, slot: "slot0", itemCodeHash: hA },
  ] as never[];
  const sales = [
    { date: "2026-07-25", itemCode: hA, trackingId: "", clicks: 10, orders: 1, reward: 300 },
  ];
  const result = aggregateGenreSales(history, sales);
  assert.equal(result.length, 1);
  assert.equal(result[0].key, "キッチン消耗品");
  assert.equal(result[0].totalReward, 300);
});

test("aggregatePriceBandSales: 価格帯別集計", () => {
  const hA = deriveItemCode("s", "a");
  const hB = deriveItemCode("s", "b");
  const history = [
    { ts: "", itemCode: "", itemName: "", genreName: "", price: 1500, postType: 1, hour: 8, slot: "", itemCodeHash: hA },
    { ts: "", itemCode: "", itemName: "", genreName: "", price: 7000, postType: 1, hour: 8, slot: "", itemCodeHash: hB },
  ] as never[];
  const sales = [
    { date: "2026-07-25", itemCode: hA, trackingId: "", clicks: 10, orders: 1, reward: 300 },
    { date: "2026-07-25", itemCode: hB, trackingId: "", clicks: 5, orders: 1, reward: 800 },
  ];
  const result = aggregatePriceBandSales(history, sales);
  assert.ok(result.length >= 2);
  // 価格帯キー命名は既存 priceBandOf() を使うため実キー名は "1000-3000" / "5000-10000" などになる想定
  for (const r of result) {
    assert.ok(r.key.length > 0);
    assert.ok(r.salesScore > 0);
  }
});

test("aggregateSlotSales: 履歴に対応 sales が無ければ salesScore=0 でもエントリは作る", () => {
  const history = [
    { ts: "", itemCode: "", itemName: "", genreName: "", price: 1000, postType: 1, hour: 8, slot: "slot0", itemCodeHash: "no-match" },
  ] as never[];
  const result = aggregateSlotSales(history, []);
  const s = result.find((r) => r.slot === "slot0");
  assert.ok(s);
  assert.equal(s.posts, 1);
  assert.equal(s.matchedSales, 0);
  assert.equal(s.salesScore, 0);
});
```

- [ ] **Step 2: テスト失敗を確認**

Run: `npm test 2>&1 | tail -5`
Expected: sales-aggregator 系が module not found で fail

- [ ] **Step 3: 実装**

`src/agents/sales-aggregator.ts`:

```typescript
import type { PostRecord } from "./store";
import type { SalesRow } from "../affiliate/sales-db";
import { priceBandOf } from "./store";

export const SALES_SCORE_WEIGHT = { reward: 0.7, clicks: 0.3 } as const;

export function salesScore(row: { reward: number; clicks: number }): number {
  return row.reward * SALES_SCORE_WEIGHT.reward + row.clicks * SALES_SCORE_WEIGHT.clicks;
}

export interface SlotSalesAggregate {
  slot: string;
  posts: number;
  matchedSales: number;
  totalReward: number;
  totalClicks: number;
  salesScore: number;
}

export interface KeyedSalesAggregate {
  key: string;
  posts: number;
  matchedSales: number;
  totalReward: number;
  totalClicks: number;
  salesScore: number;
}

/** history の itemCodeHash × sales.itemCode で JOIN し key ごとに集計 */
function aggregateBy(
  history: PostRecord[],
  sales: SalesRow[],
  keyOf: (h: PostRecord) => string,
): KeyedSalesAggregate[] {
  const salesByHash = new Map<string, SalesRow[]>();
  for (const s of sales) {
    const arr = salesByHash.get(s.itemCode) ?? [];
    arr.push(s);
    salesByHash.set(s.itemCode, arr);
  }
  const acc = new Map<string, KeyedSalesAggregate>();
  for (const h of history) {
    const key = keyOf(h);
    const cur = acc.get(key) ?? {
      key, posts: 0, matchedSales: 0, totalReward: 0, totalClicks: 0, salesScore: 0,
    };
    cur.posts += 1;
    if (h.itemCodeHash) {
      const matches = salesByHash.get(h.itemCodeHash) ?? [];
      for (const m of matches) {
        cur.matchedSales += 1;
        cur.totalReward += m.reward;
        cur.totalClicks += m.clicks;
      }
    }
    acc.set(key, cur);
  }
  for (const v of acc.values()) {
    v.salesScore = salesScore({ reward: v.totalReward, clicks: v.totalClicks });
  }
  return Array.from(acc.values()).sort((a, b) => b.salesScore - a.salesScore);
}

export function aggregateSlotSales(history: PostRecord[], sales: SalesRow[]): SlotSalesAggregate[] {
  const kv = aggregateBy(history, sales, (h) => h.slot ?? "unknown");
  return kv.map((k) => ({ ...k, slot: k.key }));
}

export function aggregateGenreSales(history: PostRecord[], sales: SalesRow[]): KeyedSalesAggregate[] {
  return aggregateBy(history, sales, (h) => h.genreName || "不明");
}

export function aggregatePriceBandSales(history: PostRecord[], sales: SalesRow[]): KeyedSalesAggregate[] {
  return aggregateBy(history, sales, (h) => priceBandOf(h.price));
}
```

- [ ] **Step 4: テスト**

Run: `npm test 2>&1 | tail -10`
Expected: 全 pass（推定 28 tests = 前 23 + 新 5）

- [ ] **Step 5: 型チェック**

Run: `npx tsc --noEmit`

- [ ] **Step 6: Commit**

```bash
git add src/agents/sales-aggregator.ts tests/sales-aggregator.test.ts
git commit -m "feat(P3): sales-aggregator (slot/genre/priceBand 別 sales_score 集計)

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 3: analyst-agent 拡張 (sales JOIN)

**Files:**
- Modify: `src/agents/analyst-agent.ts`

**Interfaces:**
- Consumes: `sales-aggregator` の 3 関数, `initDb`, `getSalesByDateRange` from `../affiliate/sales-db`
- Produces: `AnalysisResult` に以下追加:
  - `salesDataAvailable: boolean`（sales rows 合計 ≥ 3）
  - `slotSales: SlotSalesAggregate[]`
  - `genreSales: KeyedSalesAggregate[]`
  - `priceBandSales: KeyedSalesAggregate[]`
  - `salesWindowDays: number` (集計対象日数、既定14)
  - `salesTotalReward: number`
  - `salesTotalClicks: number`

- [ ] **Step 1: import 追加**

`src/agents/analyst-agent.ts` の import 部を以下に置換:

```typescript
import { loadHistory, loadReports, report, priceBandOf, type AgentReport, type PostRecord } from "./store";
import { initDb, getSalesByDateRange, type SalesRow } from "../affiliate/sales-db";
import {
  aggregateSlotSales,
  aggregateGenreSales,
  aggregatePriceBandSales,
  type SlotSalesAggregate,
  type KeyedSalesAggregate,
} from "./sales-aggregator";
```

- [ ] **Step 2: AnalysisResult に sales 系フィールドを追加**

`AnalysisResult` インターフェース定義を以下に置換:

```typescript
export interface AnalysisResult {
  totalPosts: number;
  measuredPosts: number;
  byGenre: Aggregate[];
  byPostType: Aggregate[];
  byHour: Aggregate[];
  byPriceBand: Aggregate[];
  byHook: Aggregate[];
  topPosts: Array<{ itemName: string; likes: number; genreName: string; postType: number }>;
  agentHealth: Array<{ agent: string; runs: number; failures: number; lastError: string }>;
  // Phase 3: 実売集計
  salesDataAvailable: boolean;
  salesWindowDays: number;
  salesTotalReward: number;
  salesTotalClicks: number;
  slotSales: SlotSalesAggregate[];
  genreSales: KeyedSalesAggregate[];
  priceBandSales: KeyedSalesAggregate[];
}
```

- [ ] **Step 3: runAnalystAgent 内で sales JOIN を実施**

`runAnalystAgent()` 関数を以下に置換:

```typescript
export function runAnalystAgent(): AnalysisResult {
  const history = loadHistory();
  const measured = history.filter((h) => h.likes !== undefined);

  // Phase 3: 直近 salesWindowDays の実売を集計
  const salesWindowDays = 14;
  const to = new Date();
  const from = new Date(to.getTime() - salesWindowDays * 24 * 60 * 60 * 1000);
  const fmt = (d: Date): string => d.toISOString().slice(0, 10);

  let sales: SalesRow[] = [];
  try {
    const db = initDb();
    sales = getSalesByDateRange(db, fmt(from), fmt(to));
    db.close();
  } catch (err) {
    console.warn("[analyst] sales-db 読込失敗、実売集計をスキップ:", String(err).slice(0, 150));
  }
  const salesTotalReward = sales.reduce((a, s) => a + s.reward, 0);
  const salesTotalClicks = sales.reduce((a, s) => a + s.clicks, 0);
  const salesDataAvailable = sales.length >= 3;

  const slotSales = aggregateSlotSales(history, sales);
  const genreSales = aggregateGenreSales(history, sales);
  const priceBandSales = aggregatePriceBandSales(history, sales);

  const result: AnalysisResult = {
    totalPosts: history.length,
    measuredPosts: measured.length,
    byGenre: aggregate(history.map((h) => ({ key: h.genreName || "不明", likes: h.likes }))),
    byPostType: aggregate(history.map((h) => ({ key: String(h.postType), likes: h.likes }))),
    byHour: aggregate(history.map((h) => ({ key: `${h.hour}時`, likes: h.likes }))),
    byPriceBand: aggregate(history.map((h) => ({ key: priceBandOf(h.price), likes: h.likes }))),
    byHook: aggregate(history.map((h) => ({ key: h.hook ?? "未記録", likes: h.likes }))),
    topPosts: measured
      .sort((a, b) => (b.likes ?? 0) - (a.likes ?? 0))
      .slice(0, 5)
      .map((h) => ({
        itemName: h.itemName.slice(0, 40),
        likes: h.likes ?? 0,
        genreName: h.genreName,
        postType: h.postType,
      })),
    agentHealth: healthCheck(loadReports()),
    salesDataAvailable,
    salesWindowDays,
    salesTotalReward,
    salesTotalClicks,
    slotSales,
    genreSales,
    priceBandSales,
  };

  report(
    "analyst",
    true,
    `履歴${result.totalPosts}件(計測済${result.measuredPosts}) 実売${sales.length}件(¥${salesTotalReward}) mode=${salesDataAvailable ? "sales" : "likes"}`,
  );
  return result;
}
```

- [ ] **Step 4: 型チェック**

Run: `npx tsc --noEmit 2>&1 | tail -3`
Expected: エラー 0 件

- [ ] **Step 5: ローカルで analyst 単独実行**

Run:
```bash
npx tsx -e "const {runAnalystAgent}=require('./src/agents/analyst-agent.ts'); const r=runAnalystAgent(); console.log('salesDataAvailable:',r.salesDataAvailable,'totalReward:¥'+r.salesTotalReward,'slot sales rows:',r.slotSales.length);"
```

Expected: 実データの投稿履歴（Phase 2 で 1 件書き込み済 = slot=slot1）と実売DB (¥1,198/6件) が JOIN される。JOIN で matched 0 でも salesDataAvailable=true（sales の数で判定）

- [ ] **Step 6: Commit**

```bash
git add src/agents/analyst-agent.ts
git commit -m "feat(P3): analyst に sales JOIN を追加 (slot/genre/priceBand 実売集計)

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 4: commander を sales_score モードに対応

**Files:**
- Modify: `src/agents/commander.ts`

**Interfaces:**
- Consumes: 拡張された `AnalysisResult`
- Produces:
  - `heuristicDecision` を `salesDataAvailable=true` 時に sales_score から weight を作るロジックに分岐
  - LLM プロンプトに sales 情報を含める（fallback 判断のため両方 LLM に見せる）
  - `runCommander` の戻り値 `Strategy` に `salesGen: true` と `salesGenSince` を書く（sales モード時のみ）
  - Discord レポートに `mode: sales | likes` を明記

- [ ] **Step 1: heuristicDecision に sales モード分岐を追加**

`src/agents/commander.ts` の `heuristicDecision` 関数（likes 版）はそのままにしつつ、その直前に以下を追加:

```typescript
/**
 * Phase 3: sales_score ベースの重み更新。
 * top 3 keys を weight *= 1.5, bottom 3 を *= 0.5 で更新。
 * ゼロ実績の key は変更しない（データ不足）。
 */
function salesHeuristicDecision(strategy: Strategy, analysis: AnalysisResult): CommanderDecision {
  const genreWeights = { ...strategy.genreWeights };
  const priceBandWeights = { ...strategy.priceBandWeights };
  const slotWeights = { ...(strategy.slotWeights ?? {}), slot0: strategy.slotWeights?.slot0 ?? 1, slot1: strategy.slotWeights?.slot1 ?? 1, slot2: strategy.slotWeights?.slot2 ?? 1 };

  const nonZero = <T extends { salesScore: number }>(arr: T[]): T[] => arr.filter((a) => a.salesScore > 0);

  const genreTop = nonZero(analysis.genreSales).slice(0, 3);
  const genreBot = nonZero(analysis.genreSales).slice(-3);
  for (const g of genreTop) genreWeights[g.key] = (genreWeights[g.key] ?? 1) * 1.5;
  for (const g of genreBot) genreWeights[g.key] = (genreWeights[g.key] ?? 1) * 0.5;

  const priceTop = nonZero(analysis.priceBandSales).slice(0, 2);
  const priceBot = nonZero(analysis.priceBandSales).slice(-2);
  for (const p of priceTop) priceBandWeights[p.key] = (priceBandWeights[p.key] ?? 1) * 1.5;
  for (const p of priceBot) priceBandWeights[p.key] = (priceBandWeights[p.key] ?? 1) * 0.5;

  for (const s of analysis.slotSales) {
    if (s.salesScore > 0) {
      const prev = slotWeights[s.slot] ?? 1;
      slotWeights[s.slot] = prev * (1 + Math.min(0.5, s.salesScore / 5000)); // 実売5000で +50%
    }
  }

  return {
    genreWeights,
    postTypeWeights: strategy.postTypeWeights,
    priceBandWeights,
    hookWeights: strategy.hookWeights,
    seasonalKeywords: strategy.seasonalKeywords,
    styleHints: strategy.styleHints.slice(0, 3),
    notes: `sales_score ベース: 総報酬¥${analysis.salesTotalReward}, 総クリック${analysis.salesTotalClicks}, top genres: ${genreTop.map((g) => g.key).join("/") || "-"}`,
    slotWeights,
  };
}
```

**注意**: `CommanderDecision` 型に `slotWeights?: Record<string, number>` が既に無い場合は型定義に追加。既存の commander.ts で `CommanderDecision` を検索してその interface に `slotWeights?: Record<string, number>` を追加すること。

- [ ] **Step 2: `CommanderDecision` に `slotWeights` を追加**

`src/agents/commander.ts` の `interface CommanderDecision` を検索:

```bash
grep -nA 12 "interface CommanderDecision" src/agents/commander.ts
```

interface に以下を追加（末尾）:

```typescript
  slotWeights?: Record<string, number>; // Phase 3: sales モード時の slot 別重み
```

- [ ] **Step 3: `runCommander` を sales モード対応に改修**

`runCommander` 関数内、`try { decision = await askLlm(...) } catch { decision = heuristicDecision(...) }` の部分を以下に置換:

```typescript
  let decision: CommanderDecision;
  let usedLlm = true;
  const mode: "sales" | "likes" = analysis.salesDataAvailable ? "sales" : "likes";
  try {
    decision = await askLlm(strategy, analysis);
  } catch (err) {
    console.warn(`[commander] LLM判断失敗、ルールベース(${mode})へ:`, String(err).slice(0, 150));
    decision = mode === "sales"
      ? salesHeuristicDecision(strategy, analysis)
      : heuristicDecision(strategy, analysis);
    usedLlm = false;
  }
```

さらに `next: Strategy` の構築に slot/salesGen を反映:

`const next: Strategy = { ... }` を以下に置換:

```typescript
  const next: Strategy = {
    generation: strategy.generation + 1,
    updatedAt: new Date().toISOString(),
    genreWeights: clampWeights({ ...strategy.genreWeights, ...decision.genreWeights }),
    postTypeWeights: clampWeights({ ...strategy.postTypeWeights, ...decision.postTypeWeights }),
    priceBandWeights: clampWeights({ ...strategy.priceBandWeights, ...decision.priceBandWeights }),
    hookWeights: clampWeights({ ...strategy.hookWeights, ...decision.hookWeights }),
    seasonalKeywords: decision.seasonalKeywords.length > 0 ? decision.seasonalKeywords : strategy.seasonalKeywords,
    styleHints: decision.styleHints,
    commanderNotes: `[mode=${mode}] ${decision.notes}`,
    salesGen: mode === "sales",
    salesGenSince: mode === "sales" ? (strategy.salesGenSince ?? new Date().toISOString()) : strategy.salesGenSince,
    slotWeights: decision.slotWeights
      ? clampWeights({ ...(strategy.slotWeights ?? { slot0: 1, slot1: 1, slot2: 1 }), ...decision.slotWeights })
      : strategy.slotWeights,
  };
  saveStrategy(next);
```

- [ ] **Step 4: Discord レポートに mode + 実売サマリを追記**

`await notifyReport(...)` の配列に以下を追加（`**判断** ...` の直前）:

```typescript
      `**mode**: ${mode === "sales" ? `📊 sales_score (直近${analysis.salesWindowDays}日 総¥${analysis.salesTotalReward} clicks${analysis.salesTotalClicks})` : "👍 likes ベース (実売データ不足)"}`,
      mode === "sales" && analysis.slotSales.length > 0 ? `**slot別実売スコア**: ${analysis.slotSales.map((s) => `${s.slot}=${s.salesScore.toFixed(0)}`).join(" / ")}` : "",
```

- [ ] **Step 5: askLlm プロンプトに sales サマリを付与**

`askLlm` 関数内で `analysis` を LLM プロンプト化している箇所（`byGenre`, `byPostType` 等を渡している場所）を検索し、sales 情報を追加:

Run:
```bash
grep -nE "byGenre|byPriceBand" src/agents/commander.ts | head -10
```

見つかった LLM プロンプト構築部で、以下のような形で sales 情報を注入する:

```typescript
  const salesSection = analysis.salesDataAvailable
    ? `\n\n直近${analysis.salesWindowDays}日の実売:\n- 総報酬: ¥${analysis.salesTotalReward}\n- 総クリック: ${analysis.salesTotalClicks}\n- slot別: ${analysis.slotSales.map((s) => `${s.slot}=¥${s.totalReward}`).join(", ")}\n- ジャンル top: ${analysis.genreSales.slice(0, 3).map((g) => `${g.key}(¥${g.totalReward})`).join(", ")}`
    : "\n\n実売データ不足（3件未満）のため likes ベースで判断してください";
```

そして LLM に渡すプロンプト文字列（likely `prompt` or `content` 変数）に `salesSection` を追記。**もし既存プロンプト構築が複雑な場合は、pull を止めて既存構造を最小改変で組み込む**。

具体的な差込位置は既存コード次第だが、少なくとも「実売サマリを LLM に渡す」処理が入っていれば OK。判断根拠には反映される。

- [ ] **Step 6: 型チェック**

Run: `npx tsc --noEmit 2>&1 | tail -5`
Expected: エラー 0 件

- [ ] **Step 7: Commit**

```bash
git add src/agents/commander.ts
git commit -m "feat(P3): commander を sales_score モードに対応

- salesHeuristicDecision (top+50%/bot-50%) を追加
- CommanderDecision.slotWeights を追加
- Strategy に salesGen / salesGenSince / slotWeights を保存
- Discord レポートに mode と slot別スコアを明記
- LLM プロンプトに実売サマリを注入 (fallback なら likes モード宣言)

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 5: 学習ループを実行して sales モードで strategy.json が更新されることを確認

**Files:** なし（検証）

- [ ] **Step 1: 全テスト**

Run: `npm test 2>&1 | tail -10`
Expected: 全 pass

- [ ] **Step 2: ローカルで run_learn を実行**

Run:
```bash
npm run learn 2>&1 | tail -30
```

Expected:
- `[analyst] 履歴N件(計測済M) 実売K件(¥X) mode=sales|likes` のログ
- `[commander] 第N世代へ更新` のログ
- strategy.json の diff で `salesGen: true` (もし実売≥3) と `slotWeights: {...}` の追加が見える

- [ ] **Step 3: strategy.json の diff を確認**

Run:
```bash
git diff strategy.json | head -30
```

Expected: `salesGen`, `salesGenSince`, `slotWeights` フィールドが追加されているか、既存 weight が更新されている

- [ ] **Step 4: Commit + push**

```bash
git add strategy.json
git commit -m "chore(P3): 学習ループを sales モードで初回実行 (第N+1世代)

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"

bash tools/safe-push.sh
```

- [ ] **Step 5: GitHub Actions で auto-learn を手動発火して緑を確認**

Run:
```bash
gh workflow run auto-learn.yml --repo meganeojisan1984-ctrl/rakuten-room-auto-system
sleep 30
gh run list --workflow=auto-learn.yml --repo meganeojisan1984-ctrl/rakuten-room-auto-system --limit 1
```

Expected: 実行が緑（✓）で、log に `mode=sales` or `mode=likes` が出る

---

### Task 6: README に Phase 3 の挙動を追記

**Files:**
- Modify: `README.md`

- [ ] **Step 1: README 末尾に追記**

以下を `README.md` に追加:

```markdown
---

## 🧠 Phase 3: 学習ループの正解ラベル切替 (likes → 実売)

Phase 3 で `commander.ts` の戦略更新を「いいね数」から「実売スコア」に切替。

- **sales_score** = `reward * 0.7 + clicks * 0.3`
- 直近14日の `data/sales.sqlite` × `post_history.json` を `itemCodeHash` で JOIN
- 実売データが3件以上あれば sales モード、それ未満なら likes モードに自動フォールバック
- 各世代の `strategy.json` に `salesGen: true` フラグと slot 別重みが記録される

### 挙動確認

```bash
npm run learn
```

Discord に届く司令官デイリーレポートの `**mode**:` 行で `sales` か `likes` かが分かる。
```

- [ ] **Step 2: Commit + push**

```bash
git add README.md
git commit -m "docs(P3): 学習ループの sales_score 切替を README に追記

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"

bash tools/safe-push.sh
```

---

## 完了判定

Phase 3 は以下すべてが満たされた時点で完了とする:

1. `npm test` が全 pass（推定 28+ tests）
2. `npx tsc --noEmit` エラー 0 件
3. `AnalysisResult` に sales 系フィールドが揃っている
4. `Strategy` に `salesGen` / `slotWeights` が保存される
5. `npm run learn` の実行後、strategy.json に mode が反映される
6. GitHub Actions で auto-learn が緑
7. Discord レポートに mode と slot 別実売スコアが明示される

## 次フェーズ

Phase 4 (Day 15–): evaluator が 2週間の実売で勝者スロットを決定し、`persona.activeSlot` を書き換える。勝者に投稿頻度を集中させる。別プランで管理する。
