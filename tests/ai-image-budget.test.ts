import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { estimateCostPerImageUsd, readAiImageUsage, refundAiImageBudget, reserveAiImageBudget } from "../src/ig/ai-image-budget";
import { createInstagramCarouselAssets } from "../src/ig/ig-post-engine";
import type { RakutenItem } from "../src/fetcher";
import type { PersonaSlot } from "../src/persona/persona";

function ledger(): string {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), "ai-budget-")), "ai_image_usage.json");
}

const baseEnv = { AI_IMAGE_MODEL: "gpt-image-1-mini", AI_IMAGE_QUALITY: "high" };

test("1枚あたりの見積もりは単価表＋入力分で、未知のモデルは高めに見積もる", () => {
  assert.equal(estimateCostPerImageUsd(baseEnv), 0.04);
  assert.equal(estimateCostPerImageUsd({ AI_IMAGE_MODEL: "gpt-image-1-mini", AI_IMAGE_QUALITY: "medium" }), 0.015);
  assert.equal(estimateCostPerImageUsd({ AI_IMAGE_MODEL: "some-new-model", AI_IMAGE_QUALITY: "high" }), 0.25);
  assert.equal(estimateCostPerImageUsd({ ...baseEnv, AI_IMAGE_COST_PER_IMAGE_USD: "0.1" }), 0.1);
});

test("台帳ファイルが未設定なら予算ガードは働かない", () => {
  assert.equal(reserveAiImageBudget(baseEnv, 5), undefined);
});

test("1日の回数上限を超えるAI画像投稿は許可しない", () => {
  const file = ledger();
  const env = { ...baseEnv, AI_IMAGE_USAGE_FILE: file, AI_IMAGE_DAILY_POSTS: "1" };
  const morning = new Date("2026-11-17T08:00:00+09:00");
  const first = reserveAiImageBudget(env, 5, morning)!;
  assert.equal(first.allowed, true);
  assert.equal(first.usage.images, 5);
  assert.equal(first.usage.estimatedUsd, 0.2);

  const night = reserveAiImageBudget(env, 5, new Date("2026-11-17T21:00:00+09:00"))!;
  assert.equal(night.allowed, false);
  assert.match(night.reason!, /本日のAI画像投稿数の上限/);

  const nextDay = reserveAiImageBudget(env, 5, new Date("2026-11-18T08:00:00+09:00"))!;
  assert.equal(nextDay.allowed, true);
  assert.equal(nextDay.usage.estimatedUsd, 0.4);
});

test("月額上限を超える生成は許可せず、月が替わるとリセットされる", () => {
  const file = ledger();
  const env = { ...baseEnv, AI_IMAGE_USAGE_FILE: file, AI_IMAGE_MONTHLY_BUDGET_USD: "0.5", AI_IMAGE_DAILY_POSTS: "10" };
  const day = new Date("2026-11-20T08:00:00+09:00");
  assert.equal(reserveAiImageBudget(env, 5, day)!.allowed, true);
  assert.equal(reserveAiImageBudget(env, 5, day)!.allowed, true);
  const third = reserveAiImageBudget(env, 5, day)!;
  assert.equal(third.allowed, false);
  assert.match(third.reason!, /今月のAI画像予算/);
  assert.equal(readAiImageUsage(file, day).estimatedUsd, 0.4);

  const december = reserveAiImageBudget(env, 5, new Date("2026-12-01T08:00:00+09:00"))!;
  assert.equal(december.allowed, true);
  assert.equal(december.usage.month, "2026-12");
  assert.equal(december.usage.estimatedUsd, 0.2);
});

test("既定の月額上限は5ドルで、高品質5枚なら月25回まで", () => {
  const file = ledger();
  const env = { ...baseEnv, AI_IMAGE_USAGE_FILE: file, AI_IMAGE_DAILY_POSTS: "100" };
  const day = new Date("2026-11-20T08:00:00+09:00");
  let allowed = 0;
  for (let i = 0; i < 40; i++) if (reserveAiImageBudget(env, 5, day)!.allowed) allowed++;
  assert.equal(allowed, 25);
  assert.ok(readAiImageUsage(file, day).estimatedUsd <= 5);
});

test("壊れた台帳では生成を許可しない", () => {
  const file = ledger();
  fs.writeFileSync(file, "{broken");
  assert.throws(() => reserveAiImageBudget({ ...baseEnv, AI_IMAGE_USAGE_FILE: file }, 5), /利用台帳を読み込めません/);
});

test("残高不足の失敗は計上を取り消す", () => {
  const file = ledger();
  const env = { ...baseEnv, AI_IMAGE_USAGE_FILE: file };
  const day = new Date("2026-11-20T08:00:00+09:00");
  reserveAiImageBudget(env, 5, day);
  refundAiImageBudget(env, 5, day);
  const usage = readAiImageUsage(file, day);
  assert.equal(usage.images, 0);
  assert.equal(usage.estimatedUsd, 0);
  assert.deepEqual(usage.days, {});
  assert.equal(reserveAiImageBudget(env, 5, day)!.allowed, true);
});

test("予算を超えた投稿はAI画像を呼ばず文字合成カルーセルで続行する", async () => {
  const file = ledger();
  const item = {
    itemName: "収納ボックス", itemCode: "shop:box", itemPrice: 2980, itemUrl: "https://example.com/i",
    itemCaption: "洗面台の小物を収納できます。", imageUrl: "https://example.com/p.jpg", shopName: "店",
    pointRate: 1, hasCoupon: false, hasPointBonus: false, availability: 1, reviewAverage: 4.5, reviewCount: 10,
  } as RakutenItem;
  const persona = { id: "slot1", name: "p", genres: [], hashtags: [], ngWords: [] } as unknown as PersonaSlot;
  const env = {
    ...baseEnv, IG_CAROUSEL_ENABLED: "1", IG_CAROUSEL_PUBLIC_BASE_URL: "https://cdn.example.com/ig",
    AI_IMAGE_ENABLED: "1", OPENAI_API_KEY: "test-key", AI_IMAGE_USAGE_FILE: file, AI_IMAGE_DAILY_POSTS: "1",
  } as NodeJS.ProcessEnv;
  let aiCalls = 0;
  let rendered = 0;
  const run = () => createInstagramCarouselAssets(item, persona, {
    env,
    generateCopy: async () => { throw new Error("no copy in test"); },
    generateAiImages: async () => {
      aiCalls++;
      return [1, 2, 3, 4, 5].map((page) => ({ filePath: `ai-${page}.jpg`, publicUrl: `https://cdn.example.com/ig/ai-${page}.jpg`, page }));
    },
    renderCarouselImages: async () => {
      rendered++;
      return [1, 2, 3, 4, 5].map((page) => ({ filePath: `fb-${page}.jpg`, publicUrl: `https://cdn.example.com/ig/fb-${page}.jpg`, page }));
    },
  });

  const first = await run();
  const second = await run();
  assert.equal(aiCalls, 1);
  assert.equal(rendered, 1);
  assert.equal(first[0]!.filePath, "ai-1.jpg");
  assert.equal(second[0]!.filePath, "fb-1.jpg");
});
