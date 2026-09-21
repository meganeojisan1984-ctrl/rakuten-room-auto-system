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

test("buildAiLifestyleImagePrompts creates five product-grounded background-only prompts", () => {
  const prompts = buildAiLifestyleImagePrompts(item, persona);
  assert.equal(prompts.length, 5);
  assert.equal(prompts[0]!.includes("photorealistic"), true);
  assert.equal(prompts[0]!.includes("background image only"), true);
  assert.equal(prompts[0]!.includes("Do not render any readable text"), true);
  assert.equal(prompts[0]!.includes("Do not recreate the product"), true);
  assert.equal(prompts[0]!.includes("exact Rakuten product photo"), true);
  assert.equal(prompts[0]!.includes(item.itemName), true);
  assert.equal(prompts[0]!.includes("Slide 1 background"), true);
  assert.equal(prompts[1]!.includes("Slide 2 background"), true);
  assert.equal(prompts[2]!.includes("Slide 3 background"), true);
  assert.equal(prompts[3]!.includes("Slide 4 background"), true);
  assert.equal(prompts[4]!.includes("Slide 5 background"), true);
  assert.equal(prompts.join("\n").includes("プロフィール"), false);
  assert.equal(prompts.join("\n").includes("exact quoted copy"), false);
  assert.equal(prompts.some((prompt) => prompt.includes("organizer")), true);
  assert.equal(prompts.some((prompt) => prompt.includes("bathroom") || prompt.includes("washstand")), true);
});

test("buildAiLifestyleImagePrompts keeps changing product numbers out of generated backgrounds", () => {
  const itemWithStringReview = {
    ...item,
    reviewAverage: "4.71",
    reviewCount: "11954",
  } as unknown as RakutenItem;

  const prompts = buildAiLifestyleImagePrompts(itemWithStringReview, persona);

  assert.equal(prompts.length, 5);
  assert.doesNotMatch(prompts.join("\n"), /4\.71|11,954|レビュー|ポイント\d+倍|2980円/);
});

test("buildAiLifestyleImagePrompts adapts the first three slides to the product category", () => {
  const foodItem: RakutenItem = {
    ...item,
    itemName: "訳あり濃厚チーズケーキ お取り寄せスイーツ",
    itemCaption: "冷凍庫にあると週末のおやつや来客時にも便利な人気スイーツです。",
    itemCode: "sweets:test",
  };

  const prompts = buildAiLifestyleImagePrompts(foodItem, persona);

  assert.match(prompts[0]!, /dessert|cake|food styling|お菓子|食卓/);
  assert.match(prompts[1]!, /dessert|cake|food styling|お菓子|食卓/);
  assert.match(prompts[2]!, /dessert|cake|food styling|お菓子|食卓/);
  assert.doesNotMatch(prompts.slice(0, 3).join("\n"), /ごちゃつく|選ぶのが面倒|beauty|vanity|cosmetic/i);
});

test("buildAiLifestyleImagePrompts gives Office a relevant screen-free workspace background", () => {
  const officeItem: RakutenItem = {
    ...item,
    itemName: "【要エントリー！4時間限定】マイクロソフト Office Home 2024",
    itemCaption: "2台の Windows PC または Mac で使用可能。Word、Excel、PowerPoint、OneNote の永続版。",
  };
  const prompts = buildAiLifestyleImagePrompts(officeItem, persona);

  assert.match(prompts.join("\n"), /Category: パソコン用ソフトウェア/);
  assert.match(prompts[0]!, /home office|work-from-home|desktop workspace/i);
  assert.match(prompts.join("\n"), /all screens are off|no visible screen content|no logos or readable marks/i);
  assert.doesNotMatch(prompts.join("\n"), /4時間限定|要エントリー|vanity|dessert|bathroom/i);
});

test("image edit requests use the Rakuten product image only as a category reference", async () => {
  const dir = fs.mkdtempSync(path.join(process.cwd(), "tmp-ai-reference-images-"));
  try {
    const calls: FormData[] = [];
    const assets = await generateAiLifestyleImages(item, persona, {
      outputDir: dir,
      publicBaseUrl: "https://cdn.example.com/ig",
      apiKey: "test-key",
      loadProductImage: async () => ({ bytes: Buffer.from("product-reference"), mimeType: "image/jpeg" }),
      client: async (body: FormData) => {
        calls.push(body);
        return { data: [{ b64_json: Buffer.from(`jpeg-${calls.length}`).toString("base64") }] };
      },
    });

    assert.equal(assets.length, 5);
    assert.equal(calls.length, 5);
    for (const call of calls) {
      const refs = call.getAll("image[]") as Array<Blob & { name: string }>;
      assert.equal(refs.length, 1);
      assert.equal(refs[0]!.name, "rakuten-product.jpg");
      assert.equal(call.get("quality"), "high");
      assert.match(String(call.get("prompt")), /background image only/);
      assert.match(String(call.get("prompt")), /Do not recreate the product/);
      assert.match(String(call.get("prompt")), /片手で使える収納ボックス/);
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("buildAiLifestyleImagePrompts keeps beauty carousel slides focused on cosmetics", () => {
  const beautyItem: RakutenItem = {
    ...item,
    itemName: "高保湿 美容液 セラム スキンケア 化粧品",
    itemCaption: "乾燥が気になる朝晩のケアに使いやすい美容液。メイク前にも肌を整えやすい。",
    itemCode: "beauty:test",
  };
  const beautyPersona: PersonaSlot = {
    ...persona,
    name: "時短できれいに整えたい美容好き",
    genres: ["美容・コスメ・スキンケア"],
  };

  const prompts = buildAiLifestyleImagePrompts(beautyItem, beautyPersona);
  const firstFour = prompts.slice(0, 4).join("\n");

  assert.match(firstFour, /化粧品|美容液|スキンケア|cosmetic|vanity|makeup|self-care/);
  assert.match(prompts[0]!, /product reference|product category|美容液|スキンケア/);
  assert.match(prompts[1]!, /vanity|washstand|cosmetic/);
  assert.match(prompts[2]!, /vanity|washstand|cosmetic/);
  assert.match(prompts[3]!, /vanity|washstand|cosmetic/);
  assert.doesNotMatch(firstFour, /乾燥対策|肌が変わる/i);
  assert.doesNotMatch(firstFour, /sweet|dessert|food|dining|kitchen|pantry|breakfast|おやつ|甘いもの|来客|食卓|鍋/);
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

test("buildAiLifestyleImagePrompts rotates visual structure by day and time while matching the product", () => {
  const morningPrompts = buildAiLifestyleImagePrompts(item, persona, {
    now: new Date("2026-09-07T07:30:00+09:00"),
  });
  const nightPrompts = buildAiLifestyleImagePrompts(item, persona, {
    now: new Date("2026-09-07T21:30:00+09:00"),
  });

  assert.notEqual(morningPrompts[0], nightPrompts[0]);
  assert.match(morningPrompts[0]!, /soft morning daylight/);
  assert.match(nightPrompts[0]!, /soft evening indoor light/);
  assert.doesNotMatch(morningPrompts.join("\n"), /sale-alert|limited deal|ranking badge/i);
  assert.doesNotMatch(nightPrompts.join("\n"), /sale-alert|limited deal|ranking badge/i);
  assert.match(morningPrompts.slice(0, 3).join("\n"), /収納|片付け|washstand|storage|tidy/);
  assert.match(nightPrompts.slice(0, 3).join("\n"), /収納|片付け|washstand|storage|tidy/);
});

test("generateAiLifestyleImages writes five jpeg assets using high quality", async () => {
  const dir = fs.mkdtempSync(path.join(process.cwd(), "tmp-ai-images-"));
  try {
    const calls: FormData[] = [];
    const client = async (body: FormData) => {
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
      loadProductImage: async () => ({ bytes: Buffer.from("product-reference"), mimeType: "image/jpeg" }),
      client,
    });

    assert.equal(assets.length, 5);
    assert.equal(calls.length, 5);
    assert.equal(calls.every((call) => call.get("model") === "gpt-image-2"), true);
    assert.equal(calls.every((call) => call.get("quality") === "high"), true);
    assert.equal(calls.every((call) => call.get("output_format") === "jpeg"), true);
    assert.equal(assets.every((asset) => asset.filePath.endsWith(".jpg")), true);
    assert.equal(assets.every((asset) => fs.existsSync(asset.filePath)), true);
    assert.equal(assets[0]!.publicUrl.startsWith("https://cdn.example.com/ig/2026-08-30-"), true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("createInstagramCarouselAssets passes generated backgrounds into the accurate carousel renderer", async () => {
  let aiImageCalled = false;
  let renderedAssetsCalled = false;
  const backgroundImagePaths = [1, 2, 3, 4, 5].map((index) => `background-${index}.jpg`);

  const assets = await createInstagramCarouselAssets(item, persona, {
    env: {
      IG_CAROUSEL_ENABLED: "1",
      IG_CAROUSEL_PUBLIC_BASE_URL: "https://cdn.example.com/ig",
      AI_IMAGE_ENABLED: "1",
      OPENAI_API_KEY: "test-key",
    } as NodeJS.ProcessEnv,
    generateAiImages: async (_item, _persona, options) => {
      aiImageCalled = true;
      assert.equal(options?.apiKey, "test-key");
      return backgroundImagePaths.map((filePath, index) => ({
        filePath,
        publicUrl: `https://cdn.example.com/ig/${filePath}`,
        page: index + 1,
      }));
    },
    renderCarouselImages: async (_item, slides, renderOptions) => {
      renderedAssetsCalled = true;
      assert.equal(slides.length, 5);
      assert.deepEqual(renderOptions?.backgroundImagePaths, backgroundImagePaths);
      return [{ filePath: "verified-01.jpg", publicUrl: "https://cdn.example.com/ig/verified-01.jpg", page: 1 }];
    },
  });

  assert.equal(aiImageCalled, true);
  assert.equal(renderedAssetsCalled, true);
  assert.equal(assets[0]!.filePath, "verified-01.jpg");
});

