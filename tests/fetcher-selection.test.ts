import { test } from "node:test";
import assert from "node:assert/strict";
import { PRODUCT_CATEGORIES, ITEM_SEARCH_API_URL, buildItemSearchParams, canonicalizeRakutenItemUrl, isRoomPostableProductUrl, scoreProductCandidate } from "../src/fetcher";

const baseItem = {
  itemName: "高評価の美容機器",
  itemCode: "shop:item",
  itemPrice: 18000,
  itemUrl: "https://item.rakuten.co.jp/shop/item/",
  itemCaption: "秋の乾燥対策に使いやすい美容機器。自宅ケア向け。",
  imageUrl: "https://example.com/item.jpg",
  shopName: "ショップ",
  pointRate: 1,
  hasCoupon: false,
  hasPointBonus: false,
  availability: 1,
  reviewAverage: 4.8,
  reviewCount: 1200,
};

test("候補スコアは高単価だけでなくレビュー・季節一致・特典を加点する", () => {
  const category = PRODUCT_CATEGORIES.find((item) => item.name === "美容機器")!;
  const scored = scoreProductCandidate(
    { ...baseItem, hasCoupon: true, hasPointBonus: true },
    category,
    new Date("2026-10-01T00:00:00Z"),
  );
  const weak = scoreProductCandidate(
    { ...baseItem, itemPrice: 1000, reviewAverage: 3.8, reviewCount: 5 },
    category,
    new Date("2026-10-01T00:00:00Z"),
  );
  assert.ok(scored > weak);
});

test("ROOM投稿非対応URLを候補から除外する", () => {
  assert.equal(isRoomPostableProductUrl("https://item.rakuten.co.jp/book/123/"), false);
  assert.equal(isRoomPostableProductUrl("https://item.rakuten.co.jp/shop/item/"), true);
});

test("商品検索APIは現行バージョンとアフィリエイトIDを使う", () => {
  assert.match(ITEM_SEARCH_API_URL, /IchibaItem\/Search\/20260401$/);
  assert.deepEqual(
    buildItemSearchParams({ applicationId: "", accessKey: "", keyword: "美容機器 人気", minPrice: 5000, maxPrice: 50000, page: 1, affiliateId: "aff-123" }),
    {
      applicationId: "",
      accessKey: "",
      affiliateId: "aff-123",
      formatVersion: 2,
      hits: 30,
      page: 1,
      sort: "-reviewCount",
      keyword: "美容機器 人気",
      availability: 1,
      minPrice: 5000,
      maxPrice: 50000,
    },
  );
});

test("アフィリエイトURLのitemUrlをROOM用の商品URLへ正規化する", () => {
  const affiliateUrl = "https://hb.afl.rakuten.co.jp/hgc/test/?pc=https%3A%2F%2Fitem.rakuten.co.jp%2Fshop%2Fitem%2F&m=http%3A%2F%2Fm.rakuten.co.jp%2Fshop%2Fi%2F1%2F";
  assert.equal(canonicalizeRakutenItemUrl(affiliateUrl), "https://item.rakuten.co.jp/shop/item/");
  assert.equal(canonicalizeRakutenItemUrl("https://item.rakuten.co.jp/shop/item/"), "https://item.rakuten.co.jp/shop/item/");
});
