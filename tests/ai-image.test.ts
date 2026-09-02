import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { buildAiLifestyleImagePrompts, generateAiLifestyleImages } from "../src/ig/ai-image";
import { createInstagramCarouselAssets } from "../src/ig/ig-post-engine";
import type { RakutenItem } from "../src/fetcher";
import type { PersonaSlot } from "../src/persona/persona";

const item: RakutenItem = {
  itemName: "片手で使える収納ボックス 3個セット",
  itemCode: "shop:test",
  itemPrice: 2980,
  itemUrl: "https://example.com/item",
  itemCaption: "洗面台やキッチン周りの小物をすっきり収納できます。",
  imageUrl: "https://example.com/product.jpg",
  shopName: "暮らしショップ",
  pointRate: 5,
  hasCoupon: true,
  hasPointBonus: true,
  availability: 1,
  reviewAverage: 4.6,
  reviewCount: 128,
};

const persona: PersonaSlot = {
  id: "slot1",
  name: "一人暮らしQOL上げる家電",
  priceBand: [2000, 8000],
  trackingId: "slot1-qol",
  genres: ["整理収納・片付けグッズ"],
  tone: "一人暮らしの実感ベースで伝える",
  hashtags: ["#一人暮らしQOL"],
  ngWords: [],
  ctaLine: "詳細はプロフのリンク",
};

test("buildAiLifestyleImagePrompts creates five Japanese text-in-image carousel prompts", () => {
  const prompts = buildAiLifestyleImagePrompts(item, persona);
  assert.equal(prompts.length, 5);
  assert.equal(prompts[0]!.includes("photorealistic"), true);
  assert.equal(prompts[0]!.includes("Japanese text inside the image"), true);
  assert.equal(prompts[0]!.includes("real buyer trust"), true);
  assert.equal(prompts[0]!.includes("avoid plastic-looking"), true);
  assert.equal(prompts[0]!.includes(item.itemName), true);
  assert.equal(prompts[0]!.includes("Slide 1: cover"), true);
  assert.equal(prompts[1]!.includes("Slide 2: before-use problem"), true);
  assert.equal(prompts[2]!.includes("Slide 3: solution list"), true);
  assert.equal(prompts[3]!.includes("Slide 4: product features"), true);
  assert.equal(prompts[4]!.includes("Slide 5: thank-you and profile CTA"), true);
  assert.equal(prompts[4]!.includes("プロフィール"), true);
  assert.equal(prompts.some((prompt) => prompt.includes("kitchen")), true);
  assert.equal(prompts.some((prompt) => prompt.includes("bathroom") || prompt.includes("washstand")), true);
});

test("buildAiLifestyleImagePrompts accepts Rakuten review numbers delivered as strings", () => {
  const itemWithStringReview = {
    ...item,
    reviewAverage: "4.71",
    reviewCount: "11954",
  } as unknown as RakutenItem;

  const prompts = buildAiLifestyleImagePrompts(itemWithStringReview, persona);

  assert.equal(prompts.length, 5);
  assert.equal(prompts[3]!.includes("高評価 4.7"), true);
  assert.equal(prompts[3]!.includes("レビュー11,954件"), true);
});

test("buildAiLifestyleImagePrompts adapts the first three slides to the product category", () => {
  const foodItem: RakutenItem = {
    ...item,
    itemName: "訳あり濃厚チーズケーキ お取り寄せスイーツ",
    itemCaption: "冷凍庫にあると週末のおやつや来客時にも便利な人気スイーツです。",
    itemCode: "sweets:test",
  };

  const prompts = buildAiLifestyleImagePrompts(foodItem, persona);

  assert.match(prompts[0]!, /週末|ご褒美|おうちカフェ/);
  assert.match(prompts[1]!, /甘いもの|来客|おやつ/);
  assert.match(prompts[2]!, /手軽に楽しめる|家でちょっと贅沢/);
  assert.doesNotMatch(prompts.slice(0, 3).join("\n"), /ごちゃつく|選ぶのが面倒/);
});

test("buildAiLifestyleImagePrompts varies the cover mood by product instead of using one fixed top image", () => {
  const storagePrompts = buildAiLifestyleImagePrompts(item, persona);
  const foodPrompts = buildAiLifestyleImagePrompts(
    {
      ...item,
      itemName: "訳あり濃厚チーズケーキ お取り寄せスイーツ",
      itemCaption: "冷凍庫にあると週末のおやつや来客時にも便利な人気スイーツです。",
      itemCode: "sweets:test",
    },
    persona,
  );

  assert.notEqual(storagePrompts[0], foodPrompts[0]);
  assert.doesNotMatch(foodPrompts[0]!, /これ、地味に助かる/);
});

test("generateAiLifestyleImages writes five jpeg assets using low quality", async () => {
  const dir = fs.mkdtempSync(path.join(process.cwd(), "tmp-ai-images-"));
  try {
    const calls: Array<Record<string, unknown>> = [];
    const client = async (body: Record<string, unknown>) => {
      calls.push(body);
      return {
        data: [{ b64_json: Buffer.from(`jpeg-${calls.length}`).toString("base64") }],
      };
    };

    const assets = await generateAiLifestyleImages(item, persona, {
      outputDir: dir,
      publicBaseUrl: "https://cdn.example.com/ig",
      apiKey: "test-key",
      now: new Date("2026-08-30T01:02:03Z"),
      client,
    });

    assert.equal(assets.length, 5);
    assert.equal(calls.length, 5);
    assert.equal(calls.every((call) => call.model === "gpt-image-2"), true);
    assert.equal(calls.every((call) => call.quality === "low"), true);
    assert.equal(calls.every((call) => call.output_format === "jpeg"), true);
    assert.equal(assets.every((asset) => asset.filePath.endsWith(".jpg")), true);
    assert.equal(assets.every((asset) => fs.existsSync(asset.filePath)), true);
    assert.equal(assets[0]!.publicUrl.startsWith("https://cdn.example.com/ig/2026-08-30-"), true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("createInstagramCarouselAssets does not fall back to rendered carousel when AI images are enabled", async () => {
  let renderedFallbackCalled = false;

  await assert.rejects(
    () =>
      createInstagramCarouselAssets(item, persona, {
        env: {
          IG_CAROUSEL_ENABLED: "1",
          IG_CAROUSEL_PUBLIC_BASE_URL: "https://cdn.example.com/ig",
          AI_IMAGE_ENABLED: "1",
          OPENAI_API_KEY: "test-key",
        } as NodeJS.ProcessEnv,
        generateAiImages: async () => {
          throw new Error("ChatGPT image generation failed");
        },
        renderCarouselImages: async () => {
          renderedFallbackCalled = true;
          return [];
        },
      }),
    /ChatGPT image generation failed/,
  );

  assert.equal(renderedFallbackCalled, false);
});

test("createInstagramCarouselAssets uses AI images by default when an OpenAI key is present", async () => {
  let aiImageCalled = false;
  let renderedFallbackCalled = false;

  const assets = await createInstagramCarouselAssets(item, persona, {
    env: {
      IG_CAROUSEL_ENABLED: "1",
      IG_CAROUSEL_PUBLIC_BASE_URL: "https://cdn.example.com/ig",
      OPENAI_API_KEY: "test-key",
    } as NodeJS.ProcessEnv,
    generateAiImages: async () => {
      aiImageCalled = true;
      return [{ filePath: "ai-01.jpg", publicUrl: "https://cdn.example.com/ig/ai-01.jpg", page: 1 }];
    },
    renderCarouselImages: async () => {
      renderedFallbackCalled = true;
      return [];
    },
  });

  assert.equal(aiImageCalled, true);
  assert.equal(renderedFallbackCalled, false);
  assert.equal(assets[0]!.filePath, "ai-01.jpg");
});
