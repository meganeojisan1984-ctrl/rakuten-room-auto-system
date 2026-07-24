# Phase 0 で停止したモジュール一覧

Phase 0（Actions 安定化）で以下を停止した。実売寄与測定不可のため。
Phase 4 以降、実売データを元に復活検討する。

## 停止したワークフロー
- `.github/workflows/auto-followback.yml.disabled` — フォロバ自動化
  - 復活方法: `git mv .github/workflows/auto-followback.yml.disabled .github/workflows/auto-followback.yml`

## 停止したコードパス
- `src/sns.ts` の Threads 投稿系（`postToThreads`）— Phase 0 で早期リターンで無効化。関数シグネチャは維持
- `src/trend-fetcher.ts` の呼び出し — Phase 2 の scout 改修時に外す（Phase 0 では未着手）
- X 投稿系: `src/` 配下に実装が存在しないため Phase 0 での処置なし。workflow の Secret 参照だけ残置

## 参照
- スペック: [superpowers/specs/2026-07-25-rakuten-room-rebuild-sales-driven-design.md](superpowers/specs/2026-07-25-rakuten-room-rebuild-sales-driven-design.md) 第11章
- 実装プラン: [superpowers/plans/2026-07-25-phase0-actions-stabilization.md](superpowers/plans/2026-07-25-phase0-actions-stabilization.md)

## 完了履歴
- 2026-07-25 Phase 0 完了: Actions 安定化・失敗通知必達・停止モジュール整理（`npm run diagnose` = valid 確認済み）
