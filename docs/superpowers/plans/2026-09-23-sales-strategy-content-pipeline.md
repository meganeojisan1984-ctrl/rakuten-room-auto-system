# 商品別販売戦略パイプライン Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 商品把握からニーズ分析、紹介文、画像プロンプト、画像内コメントまでを商品別の販売戦略ブリーフから一貫生成する。

**Architecture:** 商品ごとに `generateSalesStrategyBrief` を1回呼び出し、構造化された `SalesStrategyBrief` を生成する。API失敗時は既存の決定論的 `ProductContentBrief` を安全なフォールバックとして使い、同じブリーフをROOM、Instagram、カルーセル、AI画像生成へ渡す。

**Tech Stack:** TypeScript、Node.js test runner、tsx、既存のOpenAI Responses APIクライアント、Playwright画像処理。

**Spec:** `docs/superpowers/specs/2026-09-23-sales-strategy-content-pipeline-design.md`

## Global Constraints

- 商品情報・価格・レビュー・商品説明にない効果、体験、レビュー内容を創作しない。
- 女性向け5カテゴリは美容・見た目・続けやすさ・日常ケアを中心にする。
- 男性向け3カテゴリは機能・効率・接続性・耐久性・仕事や趣味の用途を中心にする。
- 投稿の順序は「悩み提示 → ニーズへの共感 → 商品による解決 → 価格・レビュー等の根拠 → 楽天ROOM購入導線」とする。
- API失敗時は決定論的フォールバックで投稿を継続する。
- 画像生成プロンプトには日本語の画像内文字を描画させず、正確な商品画像とコメントは後段合成する。
- 既存の楽天ROOM投稿、Instagramカルーセル5枚、GIF画像正規化の動作を壊さない。

## Review Focus

- APIがJSONではなく説明文や空応答を返した場合、投稿を止めずフォールバックする（Task 1）。
- 商品説明が短い、レビューがない、価格が0に近い場合でも販売戦略ブリーフを構成する（Task 1）。
- 女性／男性のカテゴリ境界が曖昧でも、カテゴリのaudienceを優先し根拠のない属性を追加しない（Task 1）。
- APIで生成した紹介文と画像コメントが異なる根拠・CTAにならない（Task 3）。
- APIキー未設定やAPIタイムアウトでもauto-postとInstagram処理が従来どおり継続する（Task 2）。

---

### Task 1: 販売戦略ブリーフ生成APIと安全なフォールバック

**Files:**
- Create: `src/sales-strategy.ts`
- Modify: `src/content-brief.ts`
- Test: `tests/sales-strategy.test.ts`

**Interfaces:**
- Consumes: `RakutenItem`, `PersonaSlot`, `ProductCategory`, `OpenAiTextClient`。
- Produces: `SalesStrategyBrief`, `generateSalesStrategyBrief(item, persona, category, options?)`。

- [ ] **Step 1: Write the failing tests**

  Add tests that call the public generator with an injected fake client. Assert that the request includes product name, price, category, persona audience, and the required journey order. Add one valid JSON response test, one malformed response test, and one API-error fallback test. The expected fallback must still include `problem`, `solution`, `proofLine`, and `purchaseCta`.

  ```ts
  const result = await generateSalesStrategyBrief(item, wife, category, {
    client: async (request) => JSON.stringify({
      target: "乾燥ケアを続けたい人",
      problem: "季節の乾燥対策に迷う",
      need: "毎日続けやすい保湿ケア",
      solution: "商品説明にある保湿用途を確認して選ぶ",
      angle: "女性目線で続けやすさを見る",
      proofLine: "12,800円・レビュー248件・★4.6",
      captionOutline: ["悩み", "共感", "解決", "根拠", "ROOM"],
      imageScene: "朝の洗面台、清潔で落ち着いた雰囲気",
      imageComment: "乾燥ケアを毎日の習慣に",
      purchaseCta: "詳細は楽天ROOMで確認",
    }),
  });
  assert.equal(result.source, "api");
  assert.equal(result.target, "乾燥ケアを続けたい人");
  ```

- [ ] **Step 2: Run the tests and verify they fail**

  Run `node --test --import tsx tests/sales-strategy.test.ts`.

  Expected: FAIL because `src/sales-strategy.ts` and `SalesStrategyBrief` do not yet exist.

- [ ] **Step 3: Implement the smallest API and validator**

  Define:

  ```ts
  export interface SalesStrategyBrief extends ProductContentBrief {
    source: "api" | "fallback";
    target: string;
    need: string;
    captionOutline: string[];
    imageScene: string;
    purchaseReason: string;
  }
  export function generateSalesStrategyBrief(
    item: RakutenItem,
    persona: PersonaSlot,
    category: ProductCategory,
    options?: { client?: OpenAiTextClient; now?: Date },
  ): Promise<SalesStrategyBrief>
  ```

  Build a Japanese prompt that requests JSON only, includes exact product facts, audience rules, and the five-stage journey. Parse the returned text after removing a fenced JSON wrapper, validate all required non-empty fields, and merge only validated values with factual fields from the item. On missing key/API error/invalid JSON, call `buildProductContentBrief` and mark `source: "fallback"`.

- [ ] **Step 4: Run the tests and verify they pass**

  Run `node --test --import tsx tests/sales-strategy.test.ts`.

  Expected: all strategy API, malformed response, and fallback tests PASS.

- [ ] **Step 5: Commit**

  ```bash
  git add src/sales-strategy.ts src/content-brief.ts tests/sales-strategy.test.ts
  git commit -m "feat: generate product sales strategy briefs"
  ```

### Task 2: Main／auto-postへ戦略ブリーフを接続

**Files:**
- Modify: `src/generator.ts`
- Modify: `src/main.ts`
- Modify: `src/actions/auto_post.ts`
- Test: `tests/generator-prompt.test.ts`
- Test: `tests/main-strategy.test.ts`

**Interfaces:**
- Consumes: `SalesStrategyBrief`, `generateSalesStrategyBrief` from Task 1。
- Produces: `generateCaptions(items, postType, briefs)` using the strategy fields in its prompt; captioned item records retain an optional `brief` for downstream SNS posting。

- [ ] **Step 1: Write the failing tests**

  Add a generator test asserting that the prompt contains target, need, problem, solution, proof, and CTA in the required order. Add a main/auto-post seam test using injected strategy generation to assert one brief is generated per item and the same brief is passed into caption generation.

- [ ] **Step 2: Run the tests and verify they fail**

  Run `node --test --import tsx tests/generator-prompt.test.ts tests/main-strategy.test.ts`.

  Expected: FAIL because the current captioned record does not carry the strategy brief and the prompt has no target/need sections.

- [ ] **Step 3: Implement the connection**

  Extend `buildPrompt` with a `SalesStrategyBrief` block and the explicit order instruction. Change the captioned record type to `{ item, caption, hook, brief? }`. In `main.ts` and `src/actions/auto_post.ts`, resolve the selected category, call `generateSalesStrategyBrief` once per item, create a `Map<string, SalesStrategyBrief>`, and pass it to `generateCaptions`. Preserve trend-mode behavior by using the deterministic fallback brief when trend generation bypasses the normal ROOM generator.

- [ ] **Step 4: Run the tests and verify they pass**

  Run `node --test --import tsx tests/generator-prompt.test.ts tests/main-strategy.test.ts tests/content-brief.test.ts`.

  Expected: all prompt and connection tests PASS.

- [ ] **Step 5: Commit**

  ```bash
  git add src/generator.ts src/main.ts src/actions/auto_post.ts tests/generator-prompt.test.ts tests/main-strategy.test.ts
  git commit -m "feat: connect sales strategy to room copy generation"
  ```

### Task 3: Instagram紹介文・カルーセル・画像プロンプトの統一

**Files:**
- Modify: `src/sns.ts`
- Modify: `src/ig/ig-post-engine.ts`
- Modify: `src/ig/carousel.ts`
- Modify: `src/ig/ai-image.ts`
- Test: `tests/instagram-strategy.test.ts`
- Test: `tests/ig-carousel.test.ts`
- Test: `tests/ai-image.test.ts`

**Interfaces:**
- Consumes: captioned item records containing `SalesStrategyBrief` from Task 2。
- Produces: Instagram text, five slides, image prompts, and image comments that use the same `target`, `problem`, `solution`, `imageScene`, `imageComment`, and `purchaseCta`.

- [ ] **Step 1: Write the failing tests**

  Add tests that provide one women-oriented and one men-oriented brief. Assert Instagram copy includes the target/problem/solution/CTA, carousel slide order is problem → solution → proof → ROOM, and AI prompts include the audience and image scene while retaining the no-readable-text rule. Assert the exact `imageComment` and CTA appear in the rendered carousel content.

- [ ] **Step 2: Run the tests and verify they fail**

  Run `node --test --import tsx tests/instagram-strategy.test.ts tests/ig-carousel.test.ts tests/ai-image.test.ts`.

  Expected: FAIL because Instagram and AI layers currently reconstruct or omit strategy fields.

- [ ] **Step 3: Implement shared downstream use**

  Pass the brief from `crossPostToSns` into `postToInstagramWithPersona` and `createInstagramCarouselAssets`. Update `buildInstagramFinalCaption` to accept an optional brief and use its outline rather than generic sanitized facts. Update `buildCarouselSlides` to render the brief's problem, solution, factual proof, image comment, and purchase CTA in sequence. Update `buildAiLifestyleImagePrompts` to use `target`, `imageScene`, and `angle` as context only; retain exact product overlay and prohibit rendered text.

- [ ] **Step 4: Run the tests and verify they pass**

  Run `node --test --import tsx tests/instagram-strategy.test.ts tests/ig-carousel.test.ts tests/ai-image.test.ts tests/image-normalize.test.ts`.

  Expected: all shared-content and image tests PASS.

- [ ] **Step 5: Commit**

  ```bash
  git add src/sns.ts src/ig/ig-post-engine.ts src/ig/carousel.ts src/ig/ai-image.ts tests/instagram-strategy.test.ts tests/ig-carousel.test.ts tests/ai-image.test.ts
  git commit -m "feat: align instagram assets with sales strategy"
  ```

### Task 4: Full verification and delivery

**Files:**
- Modify: `README.md` only if environment/configuration documentation is missing.
- Test: existing full suite `tests/*.test.ts`.

- [ ] **Step 1: Run focused strategy tests**

  Run `node --test --import tsx tests/sales-strategy.test.ts tests/main-strategy.test.ts tests/instagram-strategy.test.ts tests/content-brief.test.ts tests/generator-prompt.test.ts tests/ig-carousel.test.ts tests/ai-image.test.ts tests/image-normalize.test.ts`.

- [ ] **Step 2: Run the full test suite**

  Run `npm test` and record unrelated baseline failures without masking them.

- [ ] **Step 3: Run the TypeScript build**

  Run `npm run build` and verify no new errors originate in the strategy pipeline files.

- [ ] **Step 4: Review the diff and repository state**

  Run `git diff --check`, `git status --short`, and inspect `git diff origin/main...HEAD` to ensure unrelated untracked user files are not staged.

- [ ] **Step 5: Rebase and push**

  ```bash
  git fetch origin main
  git rebase origin/main
  git push origin main
  ```

  Report the final commit hash, focused test result, full-suite baseline failures, and whether a real GitHub Actions Instagram run has completed.
