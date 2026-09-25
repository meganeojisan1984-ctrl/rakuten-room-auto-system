import { test } from "node:test";
import assert from "node:assert/strict";
import { buildImageCreativePlan, type ImageCreativePlan } from "../src/ig/image-creative";
import type { RakutenItem } from "../src/fetcher";

const baseItem: RakutenItem = {
  itemName: "商品",
  itemCode: "shop:item",
  itemPrice: 3980,
  itemUrl: "https://item.rakuten.co.jp/shop/item/",
  itemCaption: "毎日の生活で使いやすい商品です。",
  imageUrl: "https://example.com/item.jpg",
  shopName: "ショップ",
  pointRate: 1,
  hasCoupon: false,
  hasPointBonus: false,
  availability: 1,
  reviewAverage: 4.5,
  reviewCount: 120,
};

function plan(item: Partial<RakutenItem>): ImageCreativePlan {
  return buildImageCreativePlan({ ...baseItem, ...item } as RakutenItem);
}

test("美容家電の2枚目はサイズではなく使用場面の紹介になる", () => {
  const result = plan({
    itemName: "大風量ヘアドライヤー 美容家電",
    itemCaption: "大風量で髪を乾かしやすい。3段階の風量調節と冷風に対応。",
  });

  assert.equal(result.analysis.slide2Type, "beauty_use");
  assert.match(result.slides[1]!.overlayCopy.headline, /乾か|風量|髪/);
  assert.doesNotMatch(result.slides[1]!.prompt, /寸法線|定規|人物との比較/);
});

test("キャンプ用品の2枚目は設営・携帯の説明になる", () => {
  const result = plan({
    itemName: "折りたたみキャンプチェア アウトドア",
    itemCaption: "キャンプや車中泊で使える折りたたみチェア。収納袋付きで持ち運べます。",
  });

  assert.equal(result.analysis.slide2Type, "camp_use");
  assert.match(`${result.slides[1]!.overlayCopy.headline} ${result.slides[1]!.overlayCopy.body}`, /キャンプ|持ち運|収納/);
});

test("明記された幅と高さがある収納用品は寸法紹介になる", () => {
  const result = plan({
    itemName: "スリム収納ラック",
    itemCaption: "洗面所のすき間に置ける収納ラック。幅20cm、高さ85cm、奥行き30cm。",
  });

  assert.equal(result.analysis.slide2Type, "size_visual");
  assert.match(result.slides[1]!.overlayCopy.body, /幅20cm|高さ85cm|奥行き30cm/);
  assert.match(result.slides[1]!.prompt, /dimension|寸法|幅20cm/);
});

test("サイズのない商品には寸法表現を生成しない", () => {
  const result = plan({
    itemName: "保湿美容液 化粧品",
    itemCaption: "乾燥が気になる朝晩のスキンケアに使いやすい美容液。",
  });

  assert.notEqual(result.analysis.slide2Type, "size_visual");
  assert.doesNotMatch(result.prompt, /幅\s*\d+|高さ\s*\d+|奥行き\s*\d+|定規|dimension line/i);
});

test("各スライドにニーズ起点の文字設計と禁止事項がある", () => {
  const result = plan({
    itemName: "ソロキャンプ用ランタン アウトドア",
    itemCaption: "夜のキャンプサイトを照らすLEDランタン。USB充電式で防災用にも使えます。",
  });

  assert.equal(result.slides.length, 5);
  assert.deepEqual(result.slides.map((slide) => slide.role), ["hook", "product_understanding", "use_case", "proof", "room_bridge"]);
  for (const slide of result.slides) {
    assert.ok(slide.overlayCopy.headline.length > 0);
    assert.ok(slide.overlayCopy.body.length > 0);
    assert.ok(slide.textPlacement.length > 0);
    assert.ok(slide.decorations.length > 0);
    assert.match(slide.prompt, /文字は最終合成|文字を描画しない/);
  }
  assert.doesNotMatch(result.prompt, /必ず|絶対|治る|痩せる/);
});
