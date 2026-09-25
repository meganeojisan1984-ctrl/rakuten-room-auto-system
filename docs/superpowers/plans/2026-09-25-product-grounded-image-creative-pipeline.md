# Product-Grounded Image Creative Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 商品情報から商品別の訴求文・スライド役割・文字入り画像プロンプトを作り、OpenAI画像生成が失敗しても正確で見栄えのするInstagramカルーセルを投稿できるようにする。

**Architecture:** `RakutenItem` と `SalesStrategyBrief` から、商品事実と禁止事項を抽出する `ProductAnalysis` を作る。`ImageCreativePlan` が5枚の役割と商品タイプ別の②、コピー、装飾、レイアウトを決め、AIプロンプトと決定論的レンダラーが同じ計画を使う。AI文字は描画させず、プロンプトには文字設計を含め、最終文字は一度だけSVG合成する。

**Tech Stack:** TypeScript, Node test runner, tsx, Playwright, existing SVG/JPEG carousel renderer, OpenAI text/image clients.

**Spec:** `docs/superpowers/specs/2026-09-25-product-grounded-image-creative-pipeline-design.md`

## Global Constraints

- 商品情報にない効果、体験、寸法、レビュー内容、割引条件を生成しない。
- サイズ情報がない商品に寸法線、定規、人物比較を表示しない。
- 1枚の画像で文字の担当はレンダラーだけにし、AIと合成文字を重複させない。
- AI画像生成の失敗はInstagramカルーセル全体の失敗にしない。
- 既存の5枚構成、楽天ROOM投稿、GitHub Actionsの公開経路を壊さない。

## Review Focus

- サイズ情報がない商品で寸法表現が混入しない — Task 1のカテゴリ切替テスト。
- 化粧品・美容家電・キャンプ用品で②の訴求が用途に切り替わる — Task 1の実商品分類テスト。
- コピーが商品説明の事実から外れない — Task 1の禁止語・根拠テスト。
- 文字入りプロンプトと最終合成文字が二重にならない — Task 2のレンダー検証。
- OpenAI残高不足でもROOM/Instagramの実行経路が停止しない — Task 3の429フォールバックテスト。

### Task 1: 商品分析とスライド企画

**Files:**
- Create: `src/ig/image-creative.ts`
- Modify: `src/ig/carousel.ts`
- Test: `tests/image-creative.test.ts`

**Interfaces:**
- Consumes: `RakutenItem`, `ProductContentBrief` / `SalesStrategyBrief`
- Produces: `ProductAnalysis`, `ImageCreativePlan`, `buildImageCreativePlan(item, brief)`

- [ ] **Step 1: Write failing tests** for `size_visual`, `beauty_use`, `camp_use`, `feature_visual`, source-grounded copy, five distinct slide roles, and no unsupported dimensions.
- [ ] **Step 2: Run `node --test --import tsx tests/image-creative.test.ts` and confirm the new module/behavior fails for the expected reason.**
- [ ] **Step 3: Implement analysis and deterministic fallback planning**, including exact facts, usage evidence, size evidence, forbidden claims, category-specific slide 2, dynamic Japanese copy, visual decorations, text zones, and `overlayCopy`.
- [ ] **Step 4: Run the focused test and confirm it passes.**
- [ ] **Step 5: Commit the task changes.**

### Task 2: Text-aware prompts and polished deterministic rendering

**Files:**
- Modify: `src/ig/ai-image.ts`
- Modify: `src/ig/carousel.ts`
- Modify: `src/ig/ig-post-engine.ts`
- Test: `tests/ai-image.test.ts`, `tests/ig-carousel.test.ts`

**Interfaces:**
- Consumes: `ImageCreativePlan`
- Produces: five slide-specific prompts containing copy design, and final images where text is rendered once by SVG.

- [ ] **Step 1: Write failing tests** asserting prompts contain the exact per-slide headline/copy/layout/decorations while explicitly assigning text rendering to the compositor, and asserting rendered SVG contains each overlay copy once.
- [ ] **Step 2: Run the focused tests and confirm they fail against the old background-only prompt and generic renderer.**
- [ ] **Step 3: Implement plan-aware prompt construction and category-specific visual treatments**; pass the plan through asset creation; upgrade renderer typography/decorations without duplicating AI text.
- [ ] **Step 4: Run focused tests and confirm they pass.**
- [ ] **Step 5: Commit the task changes.**

### Task 3: Image-generation fallback and posting observability

**Files:**
- Modify: `src/ig/ig-post-engine.ts`
- Modify: `src/ig/ai-image.ts`
- Modify: `src/notifiers.ts`
- Modify: `.github/workflows/auto-post.yml`
- Test: `tests/ig-post-engine.test.ts`, `tests/ai-image.test.ts`

**Interfaces:**
- Consumes: OpenAI image responses and errors, existing deterministic carousel renderer.
- Produces: fallback carousel assets, explicit quota diagnostics, and workflow failure when ROOM posting itself fails.

- [ ] **Step 1: Write failing tests** for `credit_balance_exhausted` classification, AI failure fallback to deterministic images, and a diagnostic message that distinguishes ROOM success/Instagram failure.
- [ ] **Step 2: Run focused tests and confirm they fail because AI errors currently abort asset creation.**
- [ ] **Step 3: Implement quota/error classification, safe fallback to deterministic backgrounds, and workflow logging/notification that reports partial success accurately.**
- [ ] **Step 4: Run focused tests and confirm they pass.**
- [ ] **Step 5: Commit the task changes.**

### Task 4: Full verification and operational documentation

**Files:**
- Modify: `README.md`
- Modify: `SETUP-SNS.md`
- Test: full suite and TypeScript build

- [ ] **Step 1: Add documentation** for the analysis → plan → prompt → render flow, the OpenAI fallback, and the required credit/configuration checks.
- [ ] **Step 2: Run `npm test` and `npm run build`; inspect all output.**
- [ ] **Step 3: Render a local sample carousel with a product fixture and visually inspect generated JPEGs.**
- [ ] **Step 4: Commit documentation and verification fixes.**

