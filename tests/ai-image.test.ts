import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { buildAiLifestyleImagePrompts, generateAiLifestyleImages, isOpenAiQuotaError } from "../src/ig/ai-image";
import { createInstagramCarouselAssets, InstagramSkippedError } from "../src/ig/ig-post-engine";
import { buildImageCreativePlan } from "../src/ig/image-creative";
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

test("AI prompts carry product-specific copy and visual direction for AI-rendered text", () => {
  const creativePlan = buildImageCreativePlan({
    ...item,
    itemName: "大風量ヘアドライヤー 美容家電",
    itemCaption: "大風量で髪を乾かしやすい。3段階の風量調節と冷風に対応。",
  });
  const prompts = buildAiLifestyleImagePrompts(item, persona, { creativePlan });

  assert.equal(prompts.length, 5);
  assert.match(prompts[1]!, /乾かす時間を見直したい日に/);
  assert.match(prompts[1]!, /手書き風|マーカー線|使う場面/);
  assert.match(prompts[1]!, /正確な日本語|正確な日本語文字/);
  assert.match(prompts[4]!, /気になったら楽天ROOMへ/);
  assert.match(prompts[4]!, /リンク風|矢印|プロフィール/);
  assert.doesNotMatch(prompts.join("\n"), /必ず|絶対|治る|痩せる/);
});

test("generateAiLifestyleImages writes five jpeg assets using the low-cost default model", async () => {
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
    assert.equal(calls.every((call) => call.get("model") === "gpt-image-1-mini"), true);
    assert.equal(calls.every((call) => call.get("quality") === "medium"), true);
    assert.equal(calls.every((call) => call.get("output_format") === "jpeg"), true);
    assert.equal(assets.every((asset) => asset.filePath.endsWith(".jpg")), true);
    assert.equal(assets.every((asset) => fs.existsSync(asset.filePath)), true);
    assert.equal(assets[0]!.publicUrl.startsWith("https://cdn.example.com/ig/2026-08-30-"), true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("AI画像生成が応答しない場合は指定時間でタイムアウトする", async () => {
  await assert.rejects(
    generateAiLifestyleImages(item, persona, {
      apiKey: "test-key",
      outputDir: fs.mkdtempSync(path.join(os.tmpdir(), "ai-timeout-")),
      publicBaseUrl: "https://example.test/assets",
      requestTimeoutMs: 20,
      loadProductImage: async () => ({ bytes: new Uint8Array([1, 2, 3]), mimeType: "image/png" }),
      client: async () => await new Promise<never>(() => {}),
    }),
    /タイムアウト|timed out/i,
  );
});


test("画像生成には紹介する商品の写真だけを添付し、ページ別の確定コピーを渡す", async () => {
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "ai-single-image-"));
  try {
    const creativePlan = buildImageCreativePlan(item);
    const calls: FormData[] = [];
    await generateAiLifestyleImages(item, persona, {
      outputDir,
      publicBaseUrl: "https://cdn.example.com/ig",
      apiKey: "test-key",
      creativePlan,
      loadProductImage: async () => ({ bytes: Buffer.from("product-reference"), mimeType: "image/jpeg" }),
      client: async (body: FormData) => {
        calls.push(body);
        return { data: [{ b64_json: Buffer.from("jpeg").toString("base64") }] };
      },
    });
    assert.equal(calls.length, 5);
    for (const [index, call] of calls.entries()) {
      const images = call.getAll("image[]") as Array<Blob & { name: string }>;
      assert.equal(images.length, 1);
      assert.equal(images[0]!.name, "rakuten-product.jpg");
      const prompt = String(call.get("prompt"));
      assert.match(prompt, new RegExp(`スライド${index + 1}`));
      assert.ok(prompt.includes(creativePlan.slides[index]!.overlayCopy.headline));
      assert.ok(prompt.includes(creativePlan.slides[index]!.overlayCopy.body));
      assert.match(prompt, /添付画像に写っていない種類の製品/);
      assert.doesNotMatch(prompt, /参考画像|background image only/);
    }
  } finally {
    fs.rmSync(outputDir, { recursive: true, force: true });
  }
});

test("確定コピーの指定がなくても商品データから5枚分の完成スライド指示を作る", () => {
  const prompts = buildAiLifestyleImagePrompts(item, persona);
  assert.equal(prompts.length, 5);
  assert.match(prompts[0]!, /インフォグラフィック/);
  assert.match(prompts[3]!, /2,980円/);
  assert.match(prompts[4]!, /気になったら楽天ROOMへ/);
});

test("AI画像を用意できない回はInstagram投稿を見送り、旧デザインの画像は作らない", async () => {
  const env = {
    IG_CAROUSEL_ENABLED: "1",
    IG_CAROUSEL_PUBLIC_BASE_URL: "https://cdn.example.com/ig",
    AI_IMAGE_ENABLED: "1",
    OPENAI_API_KEY: "test-key",
  } as NodeJS.ProcessEnv;
  await assert.rejects(
    createInstagramCarouselAssets(item, persona, {
      env,
      generateCopy: async () => { throw new Error("copy unavailable"); },
      generateAiImages: async () => { throw new Error("AI画像の検品で不合格: スライド1: 別の商品が描かれています"); },
    }),
    (error: unknown) => error instanceof InstagramSkippedError && /検品で不合格/.test(String(error)),
  );
  await assert.rejects(
    createInstagramCarouselAssets(item, persona, { env: { ...env, AI_IMAGE_ENABLED: "0" } as NodeJS.ProcessEnv }),
    InstagramSkippedError,
  );

  const aiAssets = [1, 2, 3, 4, 5].map((page) => ({ filePath: `ai-${page}.jpg`, publicUrl: `https://cdn.example.com/ig/ai-${page}.jpg`, page }));
  const assets = await createInstagramCarouselAssets(item, persona, {
    env,
    generateCopy: async () => { throw new Error("copy unavailable"); },
    generateAiImages: async (_item, _persona, options) => {
      assert.ok(options?.creativePlan);
      return aiAssets;
    },
  });
  assert.deepEqual(assets, aiAssets);
});
