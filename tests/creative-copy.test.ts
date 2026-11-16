import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { buildCreativeCopyPrompt, generateCreativeCopy, parseCreativeCopy } from "../src/ig/creative-copy";
import { buildImageCreativePlan, chooseCreativeTheme } from "../src/ig/image-creative";
import { buildAiLifestyleImagePrompts, generateAiLifestyleImages } from "../src/ig/ai-image";
import { createInstagramCarouselAssets } from "../src/ig/ig-post-engine";
import type { RakutenItem } from "../src/fetcher";
import type { PersonaSlot } from "../src/persona/persona";

const item: RakutenItem = {
  itemName: "スマートリモコン ハブ3 赤外線家電をスマホで操作",
  itemCode: "shop:hub3",
  itemPrice: 16980,
  itemUrl: "https://item.rakuten.co.jp/shop/hub3/",
  itemCaption: "赤外線リモコンをまとめてスマホで操作できます。温度と湿度を表示。外出先からエアコンを操作。音声操作に対応。2.4インチのモニター搭載。",
  imageUrl: "https://example.com/hub3.jpg",
  shopName: "ショップ",
  pointRate: 1,
  hasCoupon: false,
  hasPointBonus: false,
  availability: 1,
  reviewAverage: 4.6,
  reviewCount: 312,
};

const persona = { id: "slot1", name: "家電", genres: ["家電製品"], hashtags: [], ngWords: [] } as unknown as PersonaSlot;

const validCopy = {
  hookQuestion: "そのリモコン操作、まだ手動でやってる？",
  hookHeadline: "これ1台でまとめて操作",
  tagline: "暮らしをもっとスマートに。",
  chips: ["スマホで操作", "音声操作に対応", "温度と湿度を表示", "家電をまとめて管理"],
  features: [
    { title: "家電をまとめて操作", detail: "赤外線リモコンをスマホにまとめる" },
    { title: "温湿度をひと目で", detail: "温度と湿度をモニターに表示" },
    { title: "外出先から操作", detail: "帰宅前にエアコンを操作できる" },
  ],
  scenes: ["帰宅前にエアコン操作", "寝室の照明をまとめて", "リモコン探しを減らす"],
  recommendFor: ["リモコンが多くて探しがちな方", "外出先から家電を操作したい方", "部屋の温湿度が気になる方"],
};

test("スライド用コピーは商品データにある数値だけを許可する", () => {
  const copy = parseCreativeCopy(JSON.stringify(validCopy), item);
  assert.equal(copy.chips.length, 4);
  assert.equal(copy.features.length, 3);

  assert.throws(
    () => parseCreativeCopy(JSON.stringify({ ...validCopy, tagline: "レシピ30種でもっと快適に" }), item),
    /number not found/,
  );
});

test("スライド用コピーは口コミ・誇大表現・長すぎる文を拒否する", () => {
  assert.throws(() => parseCreativeCopy(JSON.stringify({ ...validCopy, hookHeadline: "口コミで話題の1台" }), item), /unsupported claim/);
  assert.throws(() => parseCreativeCopy(JSON.stringify({ ...validCopy, tagline: "絶対に後悔しない選択" }), item), /unsupported claim/);
  assert.throws(() => parseCreativeCopy(JSON.stringify({ ...validCopy, chips: ["とても長いチップの文言は入りきらない", "b2", "c3", "d4"] }), item), /too long/);
  assert.throws(() => parseCreativeCopy(JSON.stringify({ ...validCopy, chips: ["スマホで操作"] }), item), /must contain 4/);
});

test("コピー生成は低コストのテキストモデルへ商品データだけを渡す", async () => {
  let requested: Record<string, unknown> | undefined;
  const copy = await generateCreativeCopy(item, {
    apiKey: "test-key",
    env: {},
    client: async (body) => {
      requested = body;
      return { output_text: JSON.stringify(validCopy) };
    },
  });
  assert.equal(copy.hookQuestion, validCopy.hookQuestion);
  assert.equal(requested?.model, "gpt-5-mini");
  const prompt = buildCreativeCopyPrompt(item);
  assert.match(prompt, /温度と湿度を表示/);
  assert.match(prompt, /口コミ、レビュー、体験談/);
  assert.doesNotMatch(prompt, /16,?980|4\.6|312/);
});

test("商品カテゴリでデザインテーマが切り替わる", () => {
  assert.equal(chooseCreativeTheme(item), "dark_luxury");
  assert.equal(chooseCreativeTheme({ ...item, itemName: "ベビー 浴衣ロンパース 帯付き", itemCaption: "赤ちゃんの夏祭りに。綿素材。" }), "soft_pastel");
  assert.equal(chooseCreativeTheme({ ...item, itemName: "ホットアイマスク 美容家電", itemCaption: "目元をあたためてリラックス。" }), "warm_rose");
});

test("完成スライドのプロンプトはLP風5枚構成で確定テキストだけを描画させる", () => {
  const copy = parseCreativeCopy(JSON.stringify(validCopy), item);
  const creativePlan = buildImageCreativePlan(item, undefined, copy);
  const prompts = buildAiLifestyleImagePrompts(item, persona, { creativePlan });

  assert.equal(prompts.length, 5);
  for (const prompt of prompts) {
    assert.match(prompt, /インフォグラフィック/);
    assert.match(prompt, /シャンパンゴールド/);
    assert.match(prompt, /添付画像が紹介する商品/);
    assert.doesNotMatch(prompt, /【参考画像】/);
    assert.match(prompt, /架空の口コミ、体験談/);
    assert.doesNotMatch(prompt, /background image only|Do not recreate the product|Do not render any readable text/);
  }
  assert.match(prompts[0]!, /そのリモコン操作、まだ手動でやってる？/);
  assert.match(prompts[0]!, /これ1台でまとめて操作/);
  assert.match(prompts[0]!, /「スマホで操作」「音声操作に対応」/);
  assert.match(prompts[1]!, /機能カード1: タイトル「家電をまとめて操作」/);
  assert.match(prompts[1]!, /こんな方におすすめ/);
  assert.match(prompts[2]!, /「帰宅前にエアコン操作」/);
  assert.match(prompts[3]!, /16,980円/);
  assert.match(prompts[3]!, /★4\.6・レビュー312件/);
  assert.match(prompts[3]!, /お客様の声の吹き出しは置かず/);
  assert.match(prompts[4]!, /気になったら楽天ROOMへ/);
  assert.match(prompts[4]!, /アカウント名やフォロワー数の創作/);
});

test("レビューがない商品は評価バッジを描かせない", () => {
  const plan = buildImageCreativePlan({ ...item, reviewAverage: 0, reviewCount: 0 });
  assert.match(plan.slides[3]!.prompt, /評価バッジや星は描かない/);
  assert.match(plan.slides[3]!.overlayCopy.body, /レビューは商品ページで確認/);
});

test("投稿エンジンは生成コピーを画像プロンプト計画へ渡し、失敗時は定型コピーで続行する", async () => {
  const env = { IG_CAROUSEL_ENABLED: "1", IG_CAROUSEL_PUBLIC_BASE_URL: "https://cdn.example.com/ig", AI_IMAGE_ENABLED: "1", OPENAI_API_KEY: "test-key" } as NodeJS.ProcessEnv;
  const aiAssets = [1, 2, 3, 4, 5].map((page) => ({ filePath: `ai-${page}.jpg`, publicUrl: `https://cdn.example.com/ig/ai-${page}.jpg`, page }));
  const headlines: string[] = [];
  for (const generateCopy of [
    async () => parseCreativeCopy(JSON.stringify(validCopy), item),
    async () => { throw new Error("quota"); },
  ]) {
    await createInstagramCarouselAssets(item, persona, {
      env,
      generateCopy,
      generateAiImages: async (_item, _persona, options) => {
        headlines.push(options!.creativePlan!.slides[0]!.overlayCopy.headline);
        return aiAssets;
      },
    });
  }
  assert.equal(headlines[0], validCopy.hookQuestion);
  assert.notEqual(headlines[1], validCopy.hookQuestion);
  assert.ok(headlines[1]!.length > 0);
});
