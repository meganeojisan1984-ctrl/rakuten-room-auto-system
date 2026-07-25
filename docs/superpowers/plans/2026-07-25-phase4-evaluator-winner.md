# Phase 4: evaluator（勝者スロット確定 + activeSlot 自動切替）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** persona.evaluationWindow（既定14日）が経過したら 3スロットの実売スコアを比較し、勝者を persona.activeSlot に書き込む。以降は multi モードから勝者 slot 一本に投稿を集中させる。全 slot が stop-loss 閾値（¥3000/評価窓）未満の場合は自動切替せず、Discord に「候補ペルソナ差し替え要検討」を通知する。

**Architecture:** (1) `src/persona/evaluator.ts` に純粋関数 `evaluatePersona(history, sales, persona, now)` を配置。post_history × sales-db を JOIN して slot 別 sales_score を計算し、勝者 or stop-loss or keep-multi のいずれかを返す。副作用は分離。(2) `src/run_evaluate_persona.ts` が evaluator を呼び、判定結果に応じて persona.json を更新 + Discord 通知。(3) `.github/workflows/evaluate-persona.yml` が毎週日曜 JST 03:00 に実行（evaluationWindow 未経過なら「継続観察中」として no-op ログ）。

**Tech Stack:** TypeScript / better-sqlite3 / `node:test`

## Global Constraints

- 対象リポジトリ: `E:\rakuten-room-auto-system`
- Node.js `20` 系、依存追加禁止
- **勝者判定条件**: 各 slot の直近 `evaluationWindow` 日の sales_score を比較
- **stop-loss 発動条件**: 全 slot 合計 reward < ¥3000（2週間換算値）
- **evaluationWindow 未経過**: 単に log + Discord 「継続観察中: あとN日」通知のみ、persona.json は変更しない
- **既に確定 slot** (activeSlot ≠ multi): evaluator は「決定済み」ログのみ、勝者上書きしない（Phase 5 で再評価機能を検討）
- persona.evaluationStartedAt を起点として window 計算する
- 全 commit は日本語 + `Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>`
- push は `bash tools/safe-push.sh`
- Phase 0/1/2/3 完了前提
- スペック本体: [../specs/2026-07-25-rakuten-room-rebuild-sales-driven-design.md](../specs/2026-07-25-rakuten-room-rebuild-sales-driven-design.md) 第6.1章 evaluator, 第9章 P4, 第10章（stop-loss）

---

## File Structure

**新規:**
- `src/persona/evaluator.ts` — 純粋関数 `evaluatePersona(...)` + 判定結果型
- `src/run_evaluate_persona.ts` — CLI entry
- `.github/workflows/evaluate-persona.yml` — 毎週日曜 03:00 JST cron
- `tests/evaluator.test.ts`

**変更:**
- `package.json` — scripts に `evaluate-persona` を追加
- `README.md` — Phase 4 の挙動を追記

**手を付けない:**
- 既存 workflow (Phase 0/2 で調整済)
- persona.json （evaluationStartedAt を初期化するだけ、evaluator が読む）
- analyst / commander（Phase 3 の実装をそのまま活用）

---

### Task 1: `evaluator.ts` — 純粋な判定ロジック

**Files:**
- Create: `src/persona/evaluator.ts`
- Create: `tests/evaluator.test.ts`

**Interfaces:**
- Consumes: `Persona`, `SlotId` from `./persona`, `PostRecord` from `../agents/store`, `SalesRow` from `../affiliate/sales-db`, `aggregateSlotSales` + `SlotSalesAggregate` from `../agents/sales-aggregator`
- Produces:
  - `export type EvaluationVerdict = "winner-decided" | "stop-loss" | "keep-multi" | "already-decided" | "not-yet";`
  - `export interface EvaluationResult { verdict: EvaluationVerdict; winnerSlot?: SlotId; daysElapsed: number; daysRemaining: number; slotAggregates: SlotSalesAggregate[]; totalReward: number; summary: string; }`
  - `export const STOP_LOSS_MIN_REWARD = 3000;`
  - `export function evaluatePersona(history: PostRecord[], sales: SalesRow[], persona: Persona, now: Date): EvaluationResult`

- [ ] **Step 1: テストを書く**

`tests/evaluator.test.ts`:

```typescript
import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluatePersona, STOP_LOSS_MIN_REWARD } from "../src/persona/evaluator";
import { deriveItemCode } from "../src/affiliate/report-parser";
import type { Persona } from "../src/persona/persona";
import type { PostRecord } from "../src/agents/store";
import type { SalesRow } from "../src/affiliate/sales-db";

const basePersona = (activeSlot: Persona["activeSlot"], startedAt: string, evalWindow = 14): Persona => ({
  activeSlot,
  evaluationWindow: evalWindow,
  evaluationStartedAt: startedAt,
  slots: {
    slot0: { id: "slot0", name: "s0", priceBand: [1, 2], trackingId: "", genres: [], tone: "", hashtags: [], ngWords: [], ctaLine: "" },
    slot1: { id: "slot1", name: "s1", priceBand: [1, 2], trackingId: "", genres: [], tone: "", hashtags: [], ngWords: [], ctaLine: "" },
    slot2: { id: "slot2", name: "s2", priceBand: [1, 2], trackingId: "", genres: [], tone: "", hashtags: [], ngWords: [], ctaLine: "" },
  },
});

const H = (slot: string, hash: string): PostRecord => ({
  ts: "2026-07-25T00:00:00Z",
  itemCode: "x",
  itemName: "x",
  genreName: "",
  price: 1000,
  postType: 1,
  hour: 8,
  slot,
  itemCodeHash: hash,
}) as unknown as PostRecord;

const S = (itemCode: string, reward: number, clicks: number = 0): SalesRow => ({
  date: "2026-07-25", itemCode, trackingId: "", clicks, orders: 1, reward,
});

test("evaluator: 未経過なら verdict='not-yet' で persona は変わらない", () => {
  const now = new Date("2026-08-01T00:00:00Z"); // 7日経過
  const persona = basePersona("multi", "2026-07-25T00:00:00Z", 14);
  const r = evaluatePersona([], [], persona, now);
  assert.equal(r.verdict, "not-yet");
  assert.equal(r.daysRemaining, 7);
});

test("evaluator: already-decided なら activeSlot 変更しない", () => {
  const now = new Date("2026-09-01T00:00:00Z");
  const persona = basePersona("slot1", "2026-07-25T00:00:00Z", 14);
  const r = evaluatePersona([], [], persona, now);
  assert.equal(r.verdict, "already-decided");
});

test("evaluator: 全 slot の reward が STOP_LOSS 未満 → 'stop-loss'", () => {
  const now = new Date("2026-08-09T00:00:00Z"); // 15日経過
  const persona = basePersona("multi", "2026-07-25T00:00:00Z", 14);
  const hA = deriveItemCode("s", "a");
  const history = [H("slot0", hA), H("slot1", hA)];
  const sales = [S(hA, 500)]; // 総 reward 500 << 3000
  const r = evaluatePersona(history, sales, persona, now);
  assert.equal(r.verdict, "stop-loss");
  assert.ok(r.totalReward < STOP_LOSS_MIN_REWARD);
});

test("evaluator: 総 reward >= STOP_LOSS かつ 明確な勝者 → 'winner-decided'", () => {
  const now = new Date("2026-08-09T00:00:00Z");
  const persona = basePersona("multi", "2026-07-25T00:00:00Z", 14);
  const hA = deriveItemCode("s", "a");
  const hB = deriveItemCode("s", "b");
  const hC = deriveItemCode("s", "c");
  const history = [H("slot0", hA), H("slot1", hB), H("slot2", hC)];
  const sales = [
    S(hA, 1000), // slot0
    S(hB, 500),  // slot1
    S(hC, 3500), // slot2 (winner)
  ];
  const r = evaluatePersona(history, sales, persona, now);
  assert.equal(r.verdict, "winner-decided");
  assert.equal(r.winnerSlot, "slot2");
});

test("evaluator: 勝者と2位の差が小さい (< 20%) 場合は 'keep-multi'", () => {
  const now = new Date("2026-08-09T00:00:00Z");
  const persona = basePersona("multi", "2026-07-25T00:00:00Z", 14);
  const hA = deriveItemCode("s", "a");
  const hB = deriveItemCode("s", "b");
  const history = [H("slot0", hA), H("slot1", hB)];
  const sales = [S(hA, 2100), S(hB, 2000)]; // 差 5%
  const r = evaluatePersona(history, sales, persona, now);
  assert.equal(r.verdict, "keep-multi");
  assert.ok(r.summary.includes("僅差"));
});
```

- [ ] **Step 2: テストの Red 確認**

Run: `npm test 2>&1 | tail -8`
Expected: evaluator 系が module not found で fail

- [ ] **Step 3: 実装**

`src/persona/evaluator.ts`:

```typescript
import type { Persona, SlotId } from "./persona";
import type { PostRecord } from "../agents/store";
import type { SalesRow } from "../affiliate/sales-db";
import { aggregateSlotSales, type SlotSalesAggregate } from "../agents/sales-aggregator";

export const STOP_LOSS_MIN_REWARD = 3000;
/** 勝者判定に必要な 1位 vs 2位 の相対差 (20%) */
export const WINNER_MIN_MARGIN = 0.2;

export type EvaluationVerdict =
  | "winner-decided"
  | "stop-loss"
  | "keep-multi"
  | "already-decided"
  | "not-yet";

export interface EvaluationResult {
  verdict: EvaluationVerdict;
  winnerSlot?: SlotId;
  daysElapsed: number;
  daysRemaining: number;
  slotAggregates: SlotSalesAggregate[];
  totalReward: number;
  summary: string;
}

function daysBetween(a: Date, b: Date): number {
  const ms = a.getTime() - b.getTime();
  return Math.floor(ms / (24 * 60 * 60 * 1000));
}

export function evaluatePersona(
  history: PostRecord[],
  sales: SalesRow[],
  persona: Persona,
  now: Date,
): EvaluationResult {
  // 既に確定していれば触らない
  if (persona.activeSlot !== "multi") {
    return {
      verdict: "already-decided",
      daysElapsed: daysBetween(now, new Date(persona.evaluationStartedAt)),
      daysRemaining: 0,
      slotAggregates: [],
      totalReward: 0,
      summary: `activeSlot は既に "${persona.activeSlot}" で確定済み`,
    };
  }

  const started = new Date(persona.evaluationStartedAt);
  const daysElapsed = daysBetween(now, started);
  const daysRemaining = Math.max(0, persona.evaluationWindow - daysElapsed);

  if (daysElapsed < persona.evaluationWindow) {
    return {
      verdict: "not-yet",
      daysElapsed,
      daysRemaining,
      slotAggregates: [],
      totalReward: 0,
      summary: `評価窓 ${persona.evaluationWindow}日 のうち ${daysElapsed}日 経過、あと ${daysRemaining}日`,
    };
  }

  const slotAggregates = aggregateSlotSales(history, sales)
    .filter((s) => s.slot === "slot0" || s.slot === "slot1" || s.slot === "slot2");
  const totalReward = slotAggregates.reduce((a, s) => a + s.totalReward, 0);

  if (totalReward < STOP_LOSS_MIN_REWARD) {
    return {
      verdict: "stop-loss",
      daysElapsed,
      daysRemaining: 0,
      slotAggregates,
      totalReward,
      summary: `${persona.evaluationWindow}日で総報酬¥${totalReward} < ¥${STOP_LOSS_MIN_REWARD}。3候補の差し替えを検討してください`,
    };
  }

  // slotAggregates は既に salesScore 降順
  const sorted = [...slotAggregates].sort((a, b) => b.salesScore - a.salesScore);
  const top = sorted[0];
  const second = sorted[1];

  if (!top) {
    return {
      verdict: "keep-multi",
      daysElapsed,
      daysRemaining: 0,
      slotAggregates,
      totalReward,
      summary: "slot 別集計が空。multi モード維持",
    };
  }

  // 2位との差が僅差なら結論保留
  if (second && second.salesScore > 0) {
    const margin = (top.salesScore - second.salesScore) / top.salesScore;
    if (margin < WINNER_MIN_MARGIN) {
      return {
        verdict: "keep-multi",
        daysElapsed,
        daysRemaining: 0,
        slotAggregates,
        totalReward,
        summary: `僅差 (top ${top.slot}=${top.salesScore.toFixed(0)}, 2nd ${second.slot}=${second.salesScore.toFixed(0)}, margin ${(margin * 100).toFixed(0)}%)。multi モード継続`,
      };
    }
  }

  return {
    verdict: "winner-decided",
    winnerSlot: top.slot as SlotId,
    daysElapsed,
    daysRemaining: 0,
    slotAggregates,
    totalReward,
    summary: `勝者=${top.slot} (score=${top.salesScore.toFixed(0)}, reward=¥${top.totalReward}) を activeSlot に確定`,
  };
}
```

- [ ] **Step 4: テスト**

Run: `npm test 2>&1 | tail -10`
Expected: 全 pass（推定 34 tests = 前 29 + 新 5）

- [ ] **Step 5: 型チェック**

Run: `npx tsc --noEmit`

- [ ] **Step 6: Commit**

```bash
git add src/persona/evaluator.ts tests/evaluator.test.ts
git commit -m "feat(P4): evaluator (勝者スロット判定 + stop-loss)

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 2: `run_evaluate_persona.ts` — CLI エントリ + persona.json 更新 + Discord 通知

**Files:**
- Create: `src/run_evaluate_persona.ts`
- Modify: `package.json`（scripts に `evaluate-persona` 追加）

**Interfaces:**
- Consumes: `evaluatePersona`, `loadPersona`, `savePersona`, `loadHistory`, `initDb + getSalesByDateRange`, `notifyReport`, `notifyError`
- Produces: `npm run evaluate-persona` で実行。verdict に応じた副作用:
  - `winner-decided`: persona.activeSlot を勝者に更新 → Discord に🏆通知 → exit 0
  - `stop-loss`: persona.json 変更なし → Discord に🚨通知 → exit 0
  - `keep-multi`: persona.json 変更なし → Discord に⚖️通知 → exit 0
  - `not-yet` / `already-decided`: 変更なし → 標準出力にログのみ、Discord 通知は skip → exit 0

- [ ] **Step 1: エントリを作成**

`src/run_evaluate_persona.ts`:

```typescript
import * as dotenv from "dotenv";
dotenv.config();
import { loadPersona, savePersona } from "./persona/persona";
import { evaluatePersona } from "./persona/evaluator";
import { loadHistory } from "./agents/store";
import { initDb, getSalesByDateRange } from "./affiliate/sales-db";
import { notifyReport, notifyError } from "./notifiers";

async function main(): Promise<void> {
  console.log("=== evaluator: ペルソナ勝者判定 開始 ===");
  const persona = loadPersona();
  const now = new Date();

  const to = now;
  const from = new Date(now.getTime() - persona.evaluationWindow * 24 * 60 * 60 * 1000);
  const fmt = (d: Date): string => d.toISOString().slice(0, 10);
  const db = initDb();
  const sales = getSalesByDateRange(db, fmt(from), fmt(to));
  db.close();

  const history = loadHistory();
  const result = evaluatePersona(history, sales, persona, now);
  console.log("[evaluator] verdict:", result.verdict, "|", result.summary);

  if (result.verdict === "winner-decided" && result.winnerSlot) {
    const next = { ...persona, activeSlot: result.winnerSlot };
    savePersona(next);
    console.log(`[evaluator] persona.activeSlot -> ${result.winnerSlot}`);
    await notifyReport(
      `🏆 勝者ペルソナ確定 (${result.winnerSlot})`,
      [
        result.summary,
        `**slot別実売**: ${result.slotAggregates.map((s) => `${s.slot}: score=${s.salesScore.toFixed(0)} reward=¥${s.totalReward} orders=${s.matchedSales}`).join("\n")}`,
        `以降 ${result.winnerSlot} に投稿を集中させます (persona.activeSlot 更新済)`,
      ].join("\n"),
    );
  } else if (result.verdict === "stop-loss") {
    await notifyReport(
      `🚨 全ペルソナ stop-loss 発動`,
      [
        result.summary,
        `**slot別実売**: ${result.slotAggregates.map((s) => `${s.slot}: reward=¥${s.totalReward}`).join("\n")}`,
        `\`src/persona/persona.json\` の 3 slot を差し替えるか、activeSlot を手動で指定してください。activeSlot 未変更のまま multi 継続します`,
      ].join("\n"),
    );
  } else if (result.verdict === "keep-multi") {
    await notifyReport(
      `⚖️ 勝者未確定 (multi モード継続)`,
      [
        result.summary,
        `**slot別実売**: ${result.slotAggregates.map((s) => `${s.slot}: score=${s.salesScore.toFixed(0)} reward=¥${s.totalReward}`).join("\n")}`,
        `次回評価まで multi モードで観察を継続します`,
      ].join("\n"),
    );
  } else if (result.verdict === "not-yet") {
    console.log(`[evaluator] 評価窓未経過（あと${result.daysRemaining}日）。通知はスキップ`);
  } else if (result.verdict === "already-decided") {
    console.log("[evaluator] activeSlot 確定済み。何もしない");
  }

  console.log("=== evaluator: 完了 ===");
}

main().catch(async (err: unknown) => {
  console.error("[evaluator] fatal:", err);
  await notifyError("evaluator 実行失敗", String(err).slice(0, 500));
  process.exit(1);
});
```

- [ ] **Step 2: package.json に script 追加**

`package.json` の scripts に追加（`scrape-sales` の直後）:

```json
    "scrape-sales": "npx tsx src/run_sales_scrape.ts",
    "evaluate-persona": "npx tsx src/run_evaluate_persona.ts",
```

- [ ] **Step 3: 型チェック**

Run: `npx tsc --noEmit`

- [ ] **Step 4: ローカル動作確認**（現在 evaluationStartedAt=2026-07-25 なので "not-yet" が期待される）

Run:
```bash
npm run evaluate-persona 2>&1 | tail -8
```

Expected: `[evaluator] verdict: not-yet | 評価窓 14日 のうち 0日 経過、あと 14日`

- [ ] **Step 5: Commit**

```bash
git add src/run_evaluate_persona.ts package.json
git commit -m "feat(P4): npm run evaluate-persona (勝者判定 + persona.json 更新 + Discord)

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 3: `.github/workflows/evaluate-persona.yml` — 毎週日曜 cron

**Files:**
- Create: `.github/workflows/evaluate-persona.yml`

**Interfaces:**
- Consumes: `data/sales.sqlite` を cache から復元、`RAKUTEN_AFFILIATE_COOKIE` は不要（既存 DB を読むだけ）
- Produces: 毎週日曜 JST 03:00 に発火。persona.json の変更があれば safe-push で commit

- [ ] **Step 1: ワークフローを作成**

`.github/workflows/evaluate-persona.yml`:

```yaml
name: ペルソナ評価 (winner 判定)

on:
  schedule:
    # 毎週日曜 JST 03:00 → UTC 土曜 18:00
    - cron: "0 18 * * 6"
  workflow_dispatch:

concurrency:
  group: main-writer
  cancel-in-progress: false

permissions:
  contents: write

jobs:
  evaluate:
    runs-on: ubuntu-latest
    timeout-minutes: 10

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

      - name: evaluator 実行
        env:
          CI: "true"
          DISCORD_WEBHOOK_URL: ${{ secrets.DISCORD_WEBHOOK_URL }}
        run: npm run evaluate-persona

      - name: persona.json をコミット (変更があれば)
        if: always()
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "github-actions[bot]@users.noreply.github.com"
          git add src/persona/persona.json
          if git diff --staged --quiet; then
            echo "no persona changes"
            exit 0
          fi
          git commit -m "chore: evaluator が persona.activeSlot を更新 [skip ci]"
          bash tools/safe-push.sh

      - name: 失敗時 Discord 通知
        if: failure()
        env:
          DISCORD_WEBHOOK_URL: ${{ secrets.DISCORD_WEBHOOK_URL }}
          GITHUB_SERVER_URL: ${{ github.server_url }}
          GITHUB_REPOSITORY: ${{ github.repository }}
          GITHUB_RUN_ID: ${{ github.run_id }}
        run: |
          npx tsx -e "require('./src/notifiers.ts').notifyWorkflowFailure('evaluate-persona', 'ペルソナ評価が失敗しました');"
```

- [ ] **Step 2: 目視確認**

Run:
```bash
grep -E "cron:|concurrency:|evaluate-persona|notifyWorkflowFailure" .github/workflows/evaluate-persona.yml
```

Expected: 各 4 行以上ヒット

- [ ] **Step 3: Commit + push**

```bash
git add .github/workflows/evaluate-persona.yml
git commit -m "feat(P4): evaluate-persona.yml (週次日曜 03:00 JST cron)

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"

bash tools/safe-push.sh
```

- [ ] **Step 4: 手動発火して緑を確認**

Run:
```bash
gh workflow run evaluate-persona.yml --repo meganeojisan1984-ctrl/rakuten-room-auto-system
sleep 30
gh run list --workflow=evaluate-persona.yml --repo meganeojisan1984-ctrl/rakuten-room-auto-system --limit 1
```

Expected: 緑（✓）。ログに `verdict: not-yet` が出る（現在は評価窓未経過のため）

---

### Task 4: README + 手動 activeSlot 切替手順

**Files:**
- Modify: `README.md`

- [ ] **Step 1: 追記**

`README.md` の末尾に:

```markdown
---

## 🏆 Phase 4: 勝者ペルソナ確定 (evaluator)

Phase 4 の `evaluator` が `persona.evaluationWindow` (既定14日) 経過後に勝者スロットを判定します。

### 挙動

- **not-yet**: 評価窓未経過。何もしない
- **already-decided**: `activeSlot` が既に "slotN" に確定。何もしない
- **winner-decided**: 勝者が明確 (2位との差 ≥ 20%) → `persona.activeSlot` に上書き → 🏆 Discord 通知
- **keep-multi**: 全 slot が拮抗 (差 < 20%) → multi 継続 → ⚖️ Discord 通知
- **stop-loss**: 総報酬 < ¥3000/14日 → 3候補の差し替えを促す 🚨 Discord 通知（activeSlot は変更しない）

### 手動再評価

```bash
npm run evaluate-persona
```

### 手動 activeSlot 切替（勝者を覆したい場合）

`src/persona/persona.json` を直接編集:

```json
{ "activeSlot": "multi" }  // 全 slot を再評価対象に戻す
```

再度勝者を確定させたい場合は `evaluationStartedAt` を今の時刻に更新して window を再開。
```

- [ ] **Step 2: Commit + push**

```bash
git add README.md
git commit -m "docs(P4): evaluator の挙動と手動切替手順を追記

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"

bash tools/safe-push.sh
```

---

## 完了判定

Phase 4 は以下すべてが満たされた時点で完了とする:

1. `npm test` 全 pass（推定 34+ tests）
2. `npx tsc --noEmit` エラー 0 件
3. `npm run evaluate-persona` が not-yet/already-decided/winner-decided/stop-loss/keep-multi の 5 verdict 全てを型として扱える
4. `.github/workflows/evaluate-persona.yml` が push 済み、手動発火で緑
5. evaluator が勝者確定した場合、persona.json が上書き + Discord 🏆 通知が飛ぶ（挙動を単体テストで検証済）

## 次フェーズ

現時点で spec に定義された P0-P4 は全て完了。以降の改善（trackingId 分離・LINE公式・IG Reels など）は別スペックとして設計する。
