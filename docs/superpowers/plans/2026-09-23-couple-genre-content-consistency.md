# 夫婦運用向けジャンル選定・コンテンツ一貫性 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 楽天ROOMの投稿候補を指定8ジャンルへ限定し、妻/夫の視点、商品選定スコア、本文、画像、画像内コメントを一貫させる。

**Architecture:** 商品カテゴリ定義を妻/夫の担当グループと価格・季節情報を持つ単一の選定カタログへ置き換える。商品ごとに共通の`ProductContentBrief`を作り、ROOM本文とInstagramカルーセルの両方へ渡す。候補選定は検索/ランキングの候補を集めてスコア順に並べ、ROOM非対応商品を選定前に除外する。

**Tech Stack:** TypeScript, Node test runner, Playwright, OpenAI image edits, existing Rakuten API and Instagram carousel pipeline.

**Spec:** `docs/superpowers/specs/2026-09-23-couple-genre-content-consistency-design.md`

## Global Constraints

- 投稿候補は美容機器、化粧品、美容家電、ダイエット器具、ダイエット商品、PCガジェット、アウトドア、家電製品に限定する。
- `slot0` と `slot1` は妻、`slot2` は夫として運用する。
- 商品説明にない体験談、効能、数値、割引を生成しない。
- 楽天ROOM非対応商品、販売停止、期限切れ、価格帯外、投稿済み商品は候補から除外する。
- 既存の画像生成モデル、Actionsスケジュール、SNS連携方式は変更しない。

## Review Focus

- 8ジャンル以外のカテゴリが検索・ランキング・トレンドのどの経路からも漏れ込まないこと。
- 夫婦スロットの交替時に、本文・ハッシュタグ・画像背景の視点が一致すること。
- 高単価スコアが低評価商品を過剰に押し上げないこと。
- 季節キーワードが商品説明にない効能や利用体験を作らないこと。
- 商品画像がGIFなど未対応形式でも、ROOM投稿成功後にSNSだけが安全に失敗扱いになること。

### Task 1: 選定カタログと夫婦スロット

**Files:**
- Modify: `src/fetcher.ts`
- Modify: `src/persona/persona.json`
- Modify: `tests/category-selection.test.ts`
- Modify: `tests/fetcher-selection.test.ts`

**Interfaces:**
- Produces `ProductCategory` entries with `audience`, `keywords`, `seasonalKeywords`, `minPrice`, and `maxPrice`.
- Produces `isRoomPostableProductUrl` and `scoreProductCandidate(item, category, now)` for later selection/content tasks.

- [ ] Write failing tests for the exact 8 categories, wife/husband group membership, unsupported URLs, and candidate score ordering.
- [ ] Run `node --test --import tsx tests/category-selection.test.ts tests/fetcher-selection.test.ts` and confirm the new assertions fail before implementation.
- [ ] Replace the five generic categories with the specified eight categories and assign keyword/season/price metadata.
- [ ] Add deterministic candidate scoring using price proximity, review rating/count, seasonal keyword matches, and point/coupon bonuses.
- [ ] Apply the same category and ROOM-postability filters to keyword, ranking, and trend fallback candidates.
- [ ] Update `persona.json` so slot0/slot1 contain wife categories and slot2 contains husband categories.
- [ ] Run the focused tests and commit as `feat: narrow product selection to couple genres`.

### Task 2: Shared product content brief

**Files:**
- Create: `src/content-brief.ts`
- Modify: `src/generator.ts`
- Modify: `src/main.ts`
- Test: `tests/content-brief.test.ts`
- Modify: `tests/generator-prompt.test.ts`

**Interfaces:**
- `buildProductContentBrief(item, persona, category, now): ProductContentBrief`.
- `ProductContentBrief` contains display name, audience, category, facts, use case, angle, seasonal hook, proof, and image comment.
- `generateCaptions` consumes the brief context without changing its public return shape.

- [ ] Write failing tests proving wife/夫 angles, seasonal hook selection, factual feature extraction, and stable image comment generation.
- [ ] Run the focused tests and confirm they fail because the brief does not exist.
- [ ] Implement the brief builder with deterministic facts and no unsupported claims.
- [ ] Inject brief fields into ROOM prompt generation and align forbidden/required language with the audience.
- [ ] Pass the selected category and persona from `main.ts` into caption generation.
- [ ] Run focused tests and commit as `feat: share product briefs across content generation`.

### Task 3: Align carousel copy and image prompts

**Files:**
- Modify: `src/ig/carousel.ts`
- Modify: `src/ig/ai-image.ts`
- Modify: `src/ig/ig-post-engine.ts`
- Test: `tests/ig-carousel.test.ts`
- Modify: `tests/ai-image.test.ts`
- Modify: `tests/instagram-source-grounding.test.ts`

**Interfaces:**
- Carousel builders accept the same `ProductContentBrief` used by ROOM copy.
- AI background prompts receive the brief angle/category and continue to forbid readable generated text and substitute products.

- [ ] Write failing tests that assert product name, brief facts, audience angle, and the same short comment appear consistently across carousel slides and image prompt inputs.
- [ ] Run the focused tests and confirm the consistency assertions fail.
- [ ] Update carousel slide construction to use the brief for headlines, facts, proof, and CTA context.
- [ ] Update AI background prompts to use the brief while leaving exact product-image compositing unchanged.
- [ ] Ensure GIF/unsupported product references fail only the promoter path and do not change successful ROOM posting.
- [ ] Run the focused tests and commit as `feat: align carousel assets with product briefs`.

### Task 4: Full verification and integration

**Files:**
- Modify: none unless verification exposes a required regression.

- [ ] Run `node --test --import tsx tests/*.test.ts` and record any pre-existing failures separately from this change.
- [ ] Run `npx tsc --noEmit` and record unrelated baseline type errors if present.
- [ ] Inspect the final diff for category leakage, ungrounded claims, and accidental changes to Actions/SNS scheduling.
- [ ] Commit any required verification fixes with TDD coverage.
- [ ] Push the completed implementation to `main`.
