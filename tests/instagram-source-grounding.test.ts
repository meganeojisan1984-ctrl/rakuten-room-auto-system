import { test } from "node:test";
import assert from "node:assert/strict";
import { buildVerifiedProductCaption, cleanProductDisplayName } from "../src/ig/product-copy";
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

test("Instagram caption keeps current listing values and exact review precision", () => {
  const caption = buildVerifiedProductCaption(officeItem);

  assert.match(caption, /価格: 41,360円/);
  assert.match(caption, /レビュー: ★4\.74・917件/);
  assert.doesNotMatch(caption, /9\/19|4時間限定|ポイントアップ|買ってよかった|時間短縮/);
});

