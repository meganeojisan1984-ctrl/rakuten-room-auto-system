import { test } from "node:test";
import assert from "node:assert/strict";
import { buildCarouselSlides, renderSlideSvg } from "../src/ig/carousel";
import { buildVerifiedProductCaption, cleanProductDisplayName } from "../src/ig/product-copy";
import { createInstagramCarouselAssets } from "../src/ig/ig-post-engine";
import type { RakutenItem } from "../src/fetcher";
import type { PersonaSlot } from "../src/persona/persona";

const officeItem: RakutenItem = {
  itemName: "【要エントリー！9/19 20時開始 4時間限定ポイントアップ対象】マイクロソフト Office Home 2024【おひとり様5枚限り】",
  itemCode: "superdeal:10004731",
  itemPrice: 41360,
  itemUrl: "https://example.com/item",
  itemCaption: "■主な特徴<br>・2台の Windows PC または Mac で使用可能。<br>・Word、Excel、PowerPoint、OneNote の永続版。<br>・9/19 20時開始 4時間限定ポイントアップ対象",
  imageUrl: "https://example.com/office-home-2024.jpg",
  shopName: "ショップ",
  pointRate: 1,
  hasCoupon: false,
  hasPointBonus: false,
  availability: 1,
  reviewAverage: 4.74,
  reviewCount: 917,
};

test("Instagram slides use the Rakuten product identity, listing facts, and image", () => {
  const slides = buildCarouselSlides(officeItem);
  const copy = slides.map((slide) => `${slide.headline} ${slide.body}`).join("\n");
  const cover = renderSlideSvg(slides[0]!, officeItem);
  const visibleText = cover.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ");

  assert.equal(cleanProductDisplayName(officeItem.itemName), "マイクロソフト Office Home 2024");
  assert.match(copy, /2台の Windows PC または Mac で使用可能/);
  assert.doesNotMatch(copy, /9\/19|4時間限定|ポイントアップ|おひとり様/);
  assert.match(cover, /https:\/\/example\.com\/office-home-2024\.jpg/);
  assert.match(visibleText, /マイクロソフト Office Home 2024/);
  assert.doesNotMatch(cover, /Home &amp; Business/);
  assert.match(cover, /fill="#e8eef4"/);
});

test("Instagram caption keeps current listing values and exact review precision", () => {
  const caption = buildVerifiedProductCaption(officeItem);

  assert.match(caption, /価格: 41,360円/);
  assert.match(caption, /レビュー: ★4\.74・917件/);
  assert.doesNotMatch(caption, /9\/19|4時間限定|ポイントアップ|買ってよかった|時間短縮/);
});

test("automatic Instagram carousel ignores the AI image setting", async () => {
  let aiCalled = false;
  let rendererCalled = false;
  await createInstagramCarouselAssets(officeItem, { id: "slot1" } as PersonaSlot, {
    env: { AI_IMAGE_ENABLED: "1", OPENAI_API_KEY: "test-key" },
    generateAiImages: async () => {
      aiCalled = true;
      throw new Error("AI image generation must not be used for auto-posts");
    },
    renderCarouselImages: async (_item, slides) => {
      rendererCalled = true;
      assert.match(slides[0]!.body, /2台の Windows PC または Mac で使用可能/);
      return [];
    },
  });

  assert.equal(aiCalled, false);
  assert.equal(rendererCalled, true);
});

