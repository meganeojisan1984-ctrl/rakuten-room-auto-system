# Phase 0: GitHub Actions 安定化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** GitHub Actions のワークフローを安定化させ、失敗が必ず Discord に通知される状態を作る。Phase 1 以降の再構築の土台とする。

**Architecture:** (1) `git push || true` を廃止し、retry-with-backoff の共通シェルスクリプト `tools/safe-push.sh` に集約。(2) 並列実行の競合を防ぐため main へ書き込む全ワークフローに `concurrency: main-writer` を追加。(3) 現行の `src/notifiers.ts` を経由するエラー通知を、Playwright timeout / Cookie 失効 / DOM 変化のパスに必ず呼び出す。(4) 実売寄与測定不可のモジュール（auto_followback, trend-fetcher, X 投稿, Threads クロス投稿）を停止し、Actions のノイズを減らす。

**Tech Stack:** TypeScript / Playwright / GitHub Actions / bash (workflow steps) / axios (Discord webhook)

## Global Constraints

- 対象リポジトリ: `E:\rakuten-room-auto-system`（既に `origin` へ push 済み）
- ワークフローは Ubuntu ランナー上で bash 実行、ローカル操作は Windows PowerShell + Git Bash
- Node.js: `20` 系（`.github/workflows/*.yml` の `setup-node` で固定）
- 全 workflow で `permissions: contents: write` は既存維持
- 破壊的操作（rm/reset）は禁止。停止するワークフローは削除ではなく `.disabled` へリネームし復活可能に保つ
- コミットメッセージは日本語 + Co-Authored-By 付与。**pre-commit フックがある場合は絶対にスキップしない**（`--no-verify` 禁止）
- スペック本体: [docs/superpowers/specs/2026-07-25-rakuten-room-rebuild-sales-driven-design.md](../specs/2026-07-25-rakuten-room-rebuild-sales-driven-design.md) 第8章・第11章

---

## File Structure（この Phase で作成/変更するファイル）

**新規作成:**
- `tools/safe-push.sh` — main へ push する共通シェル（retry ×3、指数バックオフ）
- `src/utils/cookie-diagnose.ts` — ROOM Cookie の有効性を単発チェックする診断コマンド
- `docs/PHASE0-DISABLED-MODULES.md` — 停止したモジュールと復活手順の記録

**変更:**
- `.github/workflows/auto-post.yml` — concurrency 追加、safe-push.sh 呼び出し、失敗時 Discord 通知
- `.github/workflows/auto-learn.yml` — 同上
- `.github/workflows/auto-like.yml` — concurrency 追加（push なしの場合も直列化）
- `.github/workflows/auto-follow.yml` — 同上
- `.github/workflows/auto-delete.yml` — 同上
- `.github/workflows/auto-refresh.yml` — 同上
- `src/sns.ts` — X 投稿と Threads 投稿を早期リターンで無効化
- `src/notifiers.ts` — `notifyWorkflowFailure(workflowName, jobUrl)` を追加
- `package.json` — `"diagnose": "npx tsx src/utils/cookie-diagnose.ts"` スクリプト追加

**リネーム（停止）:**
- `.github/workflows/auto-followback.yml` → `.github/workflows/auto-followback.yml.disabled`

**手を付けない:**
- `src/trend-fetcher.ts` — Phase 2 の scout 改修時に呼び出しを外す。Phase 0 では触らない
- `src/affiliate/**` — 別サブシステム、影響なし

---

### Task 1: `tools/safe-push.sh` の作成

**Files:**
- Create: `tools/safe-push.sh`

**Interfaces:**
- Consumes: なし（ワークフロー環境で `git` コマンドが実行可能な前提）
- Produces: 環境変数不要のシェルスクリプト。呼び出し方: `bash tools/safe-push.sh`。終了コード: 0=成功、1=3回リトライ後も失敗
  - 内部で `git pull --rebase --autostash origin main` → `git push` を最大 3 回試行。各試行の間で `sleep 5*i` 秒（5s / 10s / 15s）

- [ ] **Step 1: スクリプトを作成**

`tools/safe-push.sh`:

```bash
#!/usr/bin/env bash
# main への push をリトライ付きで実行する。
# 競合時のみ retry し、それ以外のエラー（認証等）は即失敗。
set -euo pipefail

MAX_RETRIES=3
for i in 1 2 3; do
  if git pull --rebase --autostash origin main && git push; then
    echo "[safe-push] success on attempt ${i}"
    exit 0
  fi
  wait=$((i * 5))
  echo "[safe-push] attempt ${i}/${MAX_RETRIES} failed, retrying in ${wait}s..."
  sleep "${wait}"
done

echo "::error::[safe-push] failed after ${MAX_RETRIES} retries"
exit 1
```

- [ ] **Step 2: 実行権限を付与し構文チェック**

Run:
```bash
chmod +x tools/safe-push.sh
bash -n tools/safe-push.sh
echo "syntax OK: exit $?"
```

Expected: `syntax OK: exit 0`

- [ ] **Step 3: 空 commit で smoke test（実 push は行わない）**

Run:
```bash
git status
# 変更が無いことを確認してから、pull だけ走らせて exit 0 を確認
git pull --rebase --autostash origin main
echo "pull OK: exit $?"
```

Expected: `pull OK: exit 0`

- [ ] **Step 4: Commit**

```bash
git add tools/safe-push.sh
git commit -m "feat(P0): add safe-push.sh with retry-with-backoff

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 2: `notifyWorkflowFailure` 通知関数の追加

**Files:**
- Modify: `src/notifiers.ts`（末尾に関数追加）

**Interfaces:**
- Consumes: 環境変数 `DISCORD_WEBHOOK_URL`, `GITHUB_SERVER_URL`, `GITHUB_REPOSITORY`, `GITHUB_RUN_ID`（Actions 実行時に自動注入）
- Produces: `export async function notifyWorkflowFailure(workflowName: string, contextMsg?: string): Promise<void>` — Actions 上で呼ばれた場合はジョブ URL 付きで Discord へ通知

- [ ] **Step 1: 関数を追加**

`src/notifiers.ts` の末尾（既存 `notifyError` の下）に追記:

```typescript
/**
 * GitHub Actions ワークフローの失敗を通知する（ジョブURL付き）
 * Actions 上で環境変数 GITHUB_SERVER_URL/REPOSITORY/RUN_ID が自動注入される前提
 */
export async function notifyWorkflowFailure(
  workflowName: string,
  contextMsg?: string,
): Promise<void> {
  const server = process.env.GITHUB_SERVER_URL ?? "";
  const repo = process.env.GITHUB_REPOSITORY ?? "";
  const runId = process.env.GITHUB_RUN_ID ?? "";
  const jobUrl = server && repo && runId ? `${server}/${repo}/actions/runs/${runId}` : "(ローカル実行)";
  const message =
    `🛑 **Workflow 失敗: ${workflowName}**\n` +
    (contextMsg ? `${contextMsg}\n` : "") +
    `Job: ${jobUrl}`;
  await sendToDiscord(message);
}
```

- [ ] **Step 2: 型チェック**

Run:
```bash
npx tsc --noEmit
```

Expected: エラー 0 件

- [ ] **Step 3: ローカルで手動呼び出し確認（Discord Webhook が有効な場合）**

Run:
```bash
node -e "require('tsx/cjs'); require('./src/notifiers.ts').notifyWorkflowFailure('smoke-test', 'phase0 setup');"
```

Expected: Discord に "🛑 **Workflow 失敗: smoke-test**" 通知が届く。Webhook 未設定なら stderr に `[notifiers] DISCORD_WEBHOOK_URL が未設定のため通知をスキップします` が出て exit 0。

- [ ] **Step 4: Commit**

```bash
git add src/notifiers.ts
git commit -m "feat(P0): add notifyWorkflowFailure for Actions error surfacing

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 3: Cookie 診断コマンド `src/utils/cookie-diagnose.ts` の追加

**Files:**
- Create: `src/utils/cookie-diagnose.ts`
- Modify: `package.json`（scripts に `diagnose` を追加）

**Interfaces:**
- Consumes: 既存 `src/session.ts` の `createAuthenticatedContext`, `validateSession`
- Produces: `npm run diagnose` で実行可能な CLI。exit code 0=Cookie 有効、1=無効。標準出力に `[diagnose] ROOM_COOKIE: valid` などを出す
  - 将来 Phase 1 で affiliate 用 Cookie も追加チェックできるよう関数を分けて書く

- [ ] **Step 1: スクリプトを作成**

`src/utils/cookie-diagnose.ts`:

```typescript
import { createAuthenticatedContext, validateSession } from "../session";
import { notifyCookieExpired } from "../notifiers";

async function diagnoseRoomCookie(): Promise<boolean> {
  const { browser, context } = await createAuthenticatedContext(true);
  try {
    const ok = await validateSession(context);
    console.log(`[diagnose] ROOM_COOKIE: ${ok ? "valid" : "INVALID"}`);
    if (!ok) {
      await notifyCookieExpired();
    }
    return ok;
  } finally {
    await context.close();
    await browser.close();
  }
}

async function main(): Promise<void> {
  const roomOk = await diagnoseRoomCookie();
  // 将来 diagnoseAffiliateCookie() を追加する
  process.exit(roomOk ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error("[diagnose] fatal:", err);
  process.exit(2);
});
```

- [ ] **Step 2: package.json にスクリプトを追加**

`package.json` の scripts オブジェクトに追記:

```json
    "diagnose": "npx tsx src/utils/cookie-diagnose.ts",
```

追加後の scripts 全体は以下:

```json
  "scripts": {
    "start": "npx tsx src/index.ts",
    "start:post-only": "npx tsx src/main.ts",
    "learn": "npx tsx src/run_learn.ts",
    "app": "npx tsx src/maintenance/server.ts",
    "export-cookie": "npx tsx tools/cookie-exporter.ts",
    "affiliate": "npx tsx src/affiliate/server.ts",
    "affiliate:run": "npx tsx src/affiliate/run.ts",
    "diagnose": "npx tsx src/utils/cookie-diagnose.ts",
    "build": "npx tsc"
  },
```

- [ ] **Step 3: 型チェック**

Run:
```bash
npx tsc --noEmit
```

Expected: エラー 0 件

- [ ] **Step 4: ローカルで実行して動作確認**

Run:
```bash
npm run diagnose
```

Expected: `[diagnose] ROOM_COOKIE: valid` または `[diagnose] ROOM_COOKIE: INVALID`（Cookie 状態による）。fatal では終わらない。

- [ ] **Step 5: Commit**

```bash
git add src/utils/cookie-diagnose.ts package.json
git commit -m "feat(P0): add npm run diagnose for cookie health check

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 4: `auto-post.yml` に concurrency と safe-push、失敗時通知を導入

**Files:**
- Modify: `.github/workflows/auto-post.yml`

**Interfaces:**
- Consumes: `tools/safe-push.sh`（Task 1）、`src/notifiers.ts` の `notifyWorkflowFailure`（Task 2）
- Produces: 並列実行の直列化・push リトライ・失敗時 Discord 通知が付いた workflow

- [ ] **Step 1: `on:` の直下（`permissions:` の前）に concurrency を追加**

`.github/workflows/auto-post.yml` の `permissions:` ブロックの**直前**に以下を挿入:

```yaml
concurrency:
  group: main-writer
  cancel-in-progress: false
```

- [ ] **Step 2: 「投稿済みリストをコミット」ステップの push を safe-push.sh に差し替え**

現在の該当ステップ（80-90行目付近）:

```yaml
      - name: 投稿済みリストをコミット
        if: always()
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "github-actions[bot]@users.noreply.github.com"
          git add posted_items.json post_history.json agent_reports.json
          git diff --staged --quiet || git commit -m "chore: 投稿済み商品リストを更新 [skip ci]"
          git pull --rebase --autostash origin main || true
          git push || true
```

これを以下に置換:

```yaml
      - name: 投稿済みリストをコミット
        if: always()
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "github-actions[bot]@users.noreply.github.com"
          git add posted_items.json post_history.json agent_reports.json
          if git diff --staged --quiet; then
            echo "no staged changes, skip commit"
            exit 0
          fi
          git commit -m "chore: 投稿済み商品リストを更新 [skip ci]"
          bash tools/safe-push.sh
```

- [ ] **Step 3: ジョブ末尾に「失敗時 Discord 通知」ステップを追加**

「実行ログをアップロード」ステップの**直後**（ファイル末尾）に追記:

```yaml
      - name: 失敗時 Discord 通知
        if: failure()
        env:
          DISCORD_WEBHOOK_URL: ${{ secrets.DISCORD_WEBHOOK_URL }}
          GITHUB_SERVER_URL: ${{ github.server_url }}
          GITHUB_REPOSITORY: ${{ github.repository }}
          GITHUB_RUN_ID: ${{ github.run_id }}
        run: |
          npx tsx -e "require('./src/notifiers.ts').notifyWorkflowFailure('auto-post', 'ジョブが失敗しました');"
```

- [ ] **Step 4: workflow の構文検証**

Run:
```bash
# Node があれば YAML パースだけ確認
node -e "const yaml=require('js-yaml'); yaml.load(require('fs').readFileSync('.github/workflows/auto-post.yml','utf8')); console.log('yaml OK');" 2>&1 || echo "js-yaml 無し。cat で目視確認する"
cat .github/workflows/auto-post.yml | grep -E "concurrency:|safe-push|notifyWorkflowFailure"
```

Expected: `concurrency:`, `bash tools/safe-push.sh`, `notifyWorkflowFailure` の3行が全て見える

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/auto-post.yml
git commit -m "chore(P0): auto-post に concurrency と safe-push と失敗通知を導入

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 5: `auto-learn.yml` に同じ変更を適用

**Files:**
- Modify: `.github/workflows/auto-learn.yml`

**Interfaces:** Task 4 と同じ

- [ ] **Step 1: `on:` と `permissions:` の間に concurrency を追加**

```yaml
concurrency:
  group: main-writer
  cancel-in-progress: false
```

- [ ] **Step 2: 「学習結果をコミット」ステップの push を safe-push.sh に差し替え**

現在の該当ステップ:

```yaml
      - name: 学習結果をコミット
        if: always()
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "github-actions[bot]@users.noreply.github.com"
          git add strategy.json post_history.json agent_reports.json dialogue.json sales_reports.json
          git diff --staged --quiet || git commit -m "chore: 学習ループ実行 - 戦略を更新 [skip ci]"
          git pull --rebase --autostash origin main || true
          git push || true
```

これを以下に置換:

```yaml
      - name: 学習結果をコミット
        if: always()
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "github-actions[bot]@users.noreply.github.com"
          git add strategy.json post_history.json agent_reports.json dialogue.json sales_reports.json
          if git diff --staged --quiet; then
            echo "no staged changes, skip commit"
            exit 0
          fi
          git commit -m "chore: 学習ループ実行 - 戦略を更新 [skip ci]"
          bash tools/safe-push.sh
```

- [ ] **Step 3: ジョブ末尾に失敗時通知を追加**

ファイル末尾に追記:

```yaml
      - name: 失敗時 Discord 通知
        if: failure()
        env:
          DISCORD_WEBHOOK_URL: ${{ secrets.DISCORD_WEBHOOK_URL }}
          GITHUB_SERVER_URL: ${{ github.server_url }}
          GITHUB_REPOSITORY: ${{ github.repository }}
          GITHUB_RUN_ID: ${{ github.run_id }}
        run: |
          npx tsx -e "require('./src/notifiers.ts').notifyWorkflowFailure('auto-learn', '学習ループが失敗しました');"
```

- [ ] **Step 4: 構文確認**

Run:
```bash
grep -E "concurrency:|safe-push|notifyWorkflowFailure" .github/workflows/auto-learn.yml
```

Expected: 3行ヒット

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/auto-learn.yml
git commit -m "chore(P0): auto-learn に concurrency と safe-push と失敗通知を導入

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 6: `auto-like.yml` / `auto-follow.yml` / `auto-delete.yml` / `auto-refresh.yml` に concurrency と失敗通知を追加

**Files:**
- Modify: `.github/workflows/auto-like.yml`
- Modify: `.github/workflows/auto-follow.yml`
- Modify: `.github/workflows/auto-delete.yml`
- Modify: `.github/workflows/auto-refresh.yml`

**Interfaces:** Task 4 と同じ。ただしこれら 4 workflow は基本 main へ push しない想定なので safe-push.sh 導入は不要（もし push している行があれば同時に差し替える）

- [ ] **Step 1: 各ファイルに concurrency を追加**

`auto-like.yml`, `auto-follow.yml`, `auto-delete.yml`, `auto-refresh.yml` の各ファイルで `permissions:` の**直前**に以下を挿入:

```yaml
concurrency:
  group: main-writer
  cancel-in-progress: false
```

- [ ] **Step 2: 各ファイルに push 処理があるかチェック**

Run:
```bash
grep -l "git push" .github/workflows/auto-like.yml .github/workflows/auto-follow.yml .github/workflows/auto-delete.yml .github/workflows/auto-refresh.yml 2>&1
```

Expected: 該当ファイルのみ出力される。ヒットしたファイルは Task 4 と同じ要領で safe-push.sh に差し替える（`git pull --rebase --autostash origin main || true` と `git push || true` の2行を `bash tools/safe-push.sh` に置換）

- [ ] **Step 3: 各ファイルに失敗時通知ステップを追加**

各ファイルの最後のステップとして以下を追記（workflow 名だけ差し替え）:

```yaml
      - name: 失敗時 Discord 通知
        if: failure()
        env:
          DISCORD_WEBHOOK_URL: ${{ secrets.DISCORD_WEBHOOK_URL }}
          GITHUB_SERVER_URL: ${{ github.server_url }}
          GITHUB_REPOSITORY: ${{ github.repository }}
          GITHUB_RUN_ID: ${{ github.run_id }}
        run: |
          npx tsx -e "require('./src/notifiers.ts').notifyWorkflowFailure('<WORKFLOW_NAME>', 'ジョブが失敗しました');"
```

- `auto-like.yml` → `notifyWorkflowFailure('auto-like', ...)`
- `auto-follow.yml` → `notifyWorkflowFailure('auto-follow', ...)`
- `auto-delete.yml` → `notifyWorkflowFailure('auto-delete', ...)`
- `auto-refresh.yml` → `notifyWorkflowFailure('auto-refresh', ...)`

- [ ] **Step 4: 確認**

Run:
```bash
for f in auto-like auto-follow auto-delete auto-refresh; do
  echo "=== $f ==="
  grep -c "concurrency:" .github/workflows/$f.yml
  grep -c "notifyWorkflowFailure" .github/workflows/$f.yml
done
```

Expected: 各 workflow で `1` `1` が出る

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/auto-like.yml .github/workflows/auto-follow.yml .github/workflows/auto-delete.yml .github/workflows/auto-refresh.yml
git commit -m "chore(P0): like/follow/delete/refresh に concurrency と失敗通知を追加

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 7: `auto-followback.yml` を `.disabled` にリネームして停止

**Files:**
- Rename: `.github/workflows/auto-followback.yml` → `.github/workflows/auto-followback.yml.disabled`
- Create: `docs/PHASE0-DISABLED-MODULES.md`

**Interfaces:** なし（純粋に停止）

- [ ] **Step 1: リネーム**

Run:
```bash
git mv .github/workflows/auto-followback.yml .github/workflows/auto-followback.yml.disabled
```

- [ ] **Step 2: 復活手順を残す**

`docs/PHASE0-DISABLED-MODULES.md` を作成:

```markdown
# Phase 0 で停止したモジュール一覧

Phase 0（Actions 安定化）で以下を停止した。実売寄与測定不可のため。
Phase 4 以降、実売データを元に復活検討する。

## 停止したワークフロー
- `.github/workflows/auto-followback.yml.disabled` — フォロバ自動化
  - 復活方法: `git mv .github/workflows/auto-followback.yml.disabled .github/workflows/auto-followback.yml`

## 停止したコードパス
- `src/sns.ts` の X 投稿系（`X_API_*` 参照箇所）— Phase 0 で早期リターンで無効化（Task 8）
- `src/sns.ts` の Threads 投稿系 — Phase 0 で早期リターンで無効化（Task 8）
- `src/trend-fetcher.ts` の呼び出し — Phase 2 の scout 改修時に外す（Phase 0 では未着手）

## 参照
- スペック: [docs/superpowers/specs/2026-07-25-rakuten-room-rebuild-sales-driven-design.md](superpowers/specs/2026-07-25-rakuten-room-rebuild-sales-driven-design.md) 第11章
```

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/auto-followback.yml.disabled docs/PHASE0-DISABLED-MODULES.md
git commit -m "chore(P0): auto-followback を停止（実売寄与測定不可のため）

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 8: `src/sns.ts` の Threads 投稿を早期リターンで無効化

**Files:**
- Modify: `src/sns.ts`（`postToThreads` の先頭のみ）

**Interfaces:**
- Consumes: 既存 `postToThreads(item: RakutenItem, caption: string): Promise<boolean>` の入口
- Produces: 呼ばれても即 `return false;` する動作。関数シグネチャは維持
- 対象外: `postToInstagram`（Phase 2 で主戦場に格上げ、触らない）、`crossPostToSns`（Threads が false を返せば自動的に threads=false になる）
- **注記:** `src` 配下に X 投稿コードは存在しないため、この Task で X の処置は不要。workflow の Secret は残置

- [ ] **Step 1: `postToThreads` の先頭に早期リターンを追加**

`src/sns.ts` の 175 行目付近、以下を差し替え:

Before（175-181行）:
```typescript
export async function postToThreads(item: RakutenItem, caption: string): Promise<boolean> {
  const THREADS_USER_ID = env("THREADS_USER_ID");
  const THREADS_ACCESS_TOKEN = env("THREADS_ACCESS_TOKEN");
  if (!THREADS_USER_ID || !THREADS_ACCESS_TOKEN) {
    console.log("[sns] Threads: 環境変数未設定のためスキップ");
    return false;
  }
```

After:
```typescript
export async function postToThreads(item: RakutenItem, caption: string): Promise<boolean> {
  // Phase 0: Threads 投稿は無効化中（Phase 4 まで停止）。実売寄与測定不可のため。
  console.log("[sns] Threads: Phase 0 で無効化中。スキップします");
  return false;
  // --- 以下、既存コードはそのまま残す（Phase 4 復活用） ---
  const THREADS_USER_ID = env("THREADS_USER_ID");
  const THREADS_ACCESS_TOKEN = env("THREADS_ACCESS_TOKEN");
  if (!THREADS_USER_ID || !THREADS_ACCESS_TOKEN) {
    console.log("[sns] Threads: 環境変数未設定のためスキップ");
    return false;
  }
```

- [ ] **Step 2: 型チェック**

Run:
```bash
npx tsc --noEmit
```

Expected: エラー 0 件（early return 以降のコードは「unreachable code」の警告は出ないはず。出た場合はコメントアウトで対応）

- [ ] **Step 3: 呼び出し側が壊れていないことを確認**

Run:
```bash
grep -rn "postToThreads" src/
```

Expected: 呼び出しは `src/sns.ts` の `crossPostToSns` のみ（既存の `threads = ... await postToThreads(...)` は boolean を受けているので false を返しても壊れない）

- [ ] **Step 4: Commit**

```bash
git add src/sns.ts
git commit -m "chore(P0): Threads 投稿を早期リターンで無効化（IG は Phase 2 の主戦場として維持）

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 9: Playwright エラーと Cookie 失効の通知を必達にする

**Files:**
- Modify: `src/poster.ts`（Playwright timeout / navigation error のパスに通知呼び出し）
- Modify: `src/session.ts`（`validateSession` が false のときに `notifyCookieExpired()` を呼ぶ）

**Interfaces:**
- Consumes: `notifyDomError`, `notifyCookieExpired`, `notifyError`
- Produces: 失敗しても sink されず、必ず Discord に通知される

- [ ] **Step 1: `src/session.ts` の `validateSession` に通知を追加**

**1a. import 追加（1行目付近、既存 import 群の末尾）:**

```typescript
import { notifyCookieExpired } from "./notifiers";
```

**1b. 現在（56-69行目）の分岐を差し替え:**

Before:
```typescript
if (currentUrl.includes(LOGIN_URL) || currentUrl.includes("/login") || currentUrl.includes("signin")) {
  console.warn("[session] セッション無効: ログインページへリダイレクトされました");
  return false;
}
```

After:
```typescript
if (currentUrl.includes(LOGIN_URL) || currentUrl.includes("/login") || currentUrl.includes("signin")) {
  console.warn("[session] セッション無効: ログインページへリダイレクトされました");
  // Phase 0: Cookie 失効を必ず通知する（Cookie診断・投稿・学習の全経路で発火）
  await notifyCookieExpired();
  return false;
}
```

- [ ] **Step 2: `src/poster.ts` の最上位 catch（260-268行）に通知を追加**

Before（260-268行、投稿が失敗しても呼び出し側に `success: false` を返して sink する箇所）:

```typescript
  } catch (err) {
    const errorMsg = String(err);
    console.error(`[poster] 投稿失敗: ${errorMsg}`);
    return {
      success: false,
      itemName: item.itemName,
      itemUrl: item.itemUrl,
      error: errorMsg,
    };
  } finally {
```

After（`notifyError` を呼び、Cookie 失効時は `notifyCookieExpired` を優先。既存の import 行 `import { notifyCookieExpired, notifyCaptchaDetected, notifyDomError, notifySuccess } from "./notifiers";` を活かして `notifyError` を追加インポートする）:

```typescript
  } catch (err) {
    const errorMsg = String(err);
    console.error(`[poster] 投稿失敗: ${errorMsg}`);
    // Phase 0: エラーを必ず Discord へ通知する。既存の catch 内 notifyDomError と重複することもあるが冪等でOK
    if (errorMsg.includes("Cookie期限切れ") || errorMsg.includes("ログイン要求")) {
      await notifyCookieExpired();
    } else if (errorMsg.includes("CAPTCHA")) {
      await notifyCaptchaDetected();
    } else {
      await notifyError("楽天ROOM投稿失敗", errorMsg);
    }
    return {
      success: false,
      itemName: item.itemName,
      itemUrl: item.itemUrl,
      error: errorMsg,
    };
  } finally {
```

- [ ] **Step 3: `notifyError` をインポートに追加**

`src/poster.ts` 4行目の import を書き換え:

Before:
```typescript
import { notifyCookieExpired, notifyCaptchaDetected, notifyDomError, notifySuccess } from "./notifiers";
```

After:
```typescript
import { notifyCookieExpired, notifyCaptchaDetected, notifyDomError, notifySuccess, notifyError } from "./notifiers";
```

- [ ] **Step 4: 型チェック**

Run:
```bash
npx tsc --noEmit
```

Expected: エラー 0 件

- [ ] **Step 5: Commit**

```bash
git add src/session.ts src/poster.ts
git commit -m "feat(P0): Cookie失効と Playwright エラーを必ず Discord 通知する

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 10: 最終スモークテスト — ローカルで diagnose を通し、workflow を手動発火する

**Files:** なし（検証のみ）

**Interfaces:** 全 Task の完了確認

- [ ] **Step 1: ローカル型チェック**

Run:
```bash
npx tsc --noEmit
```

Expected: エラー 0 件

- [ ] **Step 2: ローカル diagnose**

Run:
```bash
npm run diagnose
```

Expected: `[diagnose] ROOM_COOKIE: valid` または `INVALID` のいずれか（fatal で終わらないこと）。INVALID の場合は Discord に Cookie 失効通知が届く

- [ ] **Step 3: 全変更を push**

Run:
```bash
git status
git log --oneline origin/main..HEAD
git push origin main
```

Expected: すべてのローカル commit がリモートに上がる

- [ ] **Step 4: GitHub Actions を手動発火して緑を確認**

Run（gh CLI が使える場合）:
```bash
gh workflow run auto-post.yml
sleep 30
gh run list --workflow=auto-post.yml --limit 1
```

gh CLI が使えない場合はブラウザで `https://github.com/meganeojisan1984-ctrl/rakuten-room-auto-system/actions` を開き、`楽天ROOM 自動投稿` を選び `Run workflow` を手動実行する。

Expected: 実行が緑（✓）で終わるか、赤（✗）で終わっても Discord に `🛑 Workflow 失敗: auto-post` 通知が届く

- [ ] **Step 5: 失敗時 Discord 通知の動作検証（意図的に赤くする）**

Run: `.github/workflows/auto-post.yml` を一時的に編集し、`- name: 自動投稿を実行` の run コマンドを `exit 1` に差し替え → commit → workflow_dispatch で発火 → Discord に赤通知が届くのを確認 → 変更を revert

```bash
# 検証後の revert
git revert --no-edit HEAD
git push origin main
```

Expected: Discord に `🛑 **Workflow 失敗: auto-post**` メッセージが届き、Job リンクが有効

- [ ] **Step 6: 完了コミット**

Phase 0 完了マーカーとして README または CHANGELOG に一行追記:

```bash
echo "- 2026-07-25 Phase 0 完了: Actions 安定化・失敗通知必達・停止モジュール整理" >> docs/PHASE0-DISABLED-MODULES.md
git add docs/PHASE0-DISABLED-MODULES.md
git commit -m "docs(P0): Phase 0 完了マーカーを記録

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
git push origin main
```

---

## 完了判定

Phase 0 は以下すべてが満たされた時点で完了とする:

1. `tools/safe-push.sh` が存在し、実行権限が付与されている
2. `npm run diagnose` が exit 0/1 で正常に終了する
3. `.github/workflows/*.yml` の main へ push する全 workflow に `concurrency: main-writer` が入っている
4. main へ push する全 workflow が `bash tools/safe-push.sh` を使っている（`git push || true` が残っていない）
5. すべての workflow に「失敗時 Discord 通知」ステップがある
6. `auto-followback.yml` が `.disabled` にリネームされている
7. `src/sns.ts` の X / Threads 系関数が早期リターンで無効化されている
8. `src/session.ts` の Cookie 失効パスと `src/poster.ts` の catch から Discord 通知が出る
9. 手動発火した workflow が緑で終わる、または赤で終わっても必ず Discord 通知が届く

## 次フェーズ

Phase 1: 実売スクレイパー + sales.sqlite の構築。Phase 0 の安定した基盤の上で、`RAKUTEN_AFFILIATE_COOKIE` Secret を追加し、`src/affiliate/sales-scraper.ts` を作る。別プランで管理する。
