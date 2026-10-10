import { test } from "node:test";
import assert from "node:assert/strict";
import { getProductNavigationOptions, getProductPageUrl, waitForPostCompletion } from "../src/poster";
import { getChromiumLaunchOptions } from "../src/session";
import { isRoomPostableProductUrl } from "../src/fetcher";

test("商品ページ遷移用URLから楽天の追跡クエリを除去する", () => {
  assert.equal(
    getProductPageUrl("https://item.rakuten.co.jp/book/18814391/?rafcid=wsc_i_ra_123"),
    "https://item.rakuten.co.jp/book/18814391/"
  );
});

test("商品ページ遷移用URLはハッシュも除去する", () => {
  assert.equal(
    getProductPageUrl("https://item.rakuten.co.jp/shop/item/?scid=af_pc_etc&foo=bar#review"),
    "https://item.rakuten.co.jp/shop/item/"
  );
});

test("楽天ブックス商品はROOM投稿候補から除外する", () => {
  assert.equal(isRoomPostableProductUrl("https://item.rakuten.co.jp/book/18763170/"), false);
  assert.equal(isRoomPostableProductUrl("https://books.rakuten.co.jp/rb/18763170/"), false);
  assert.equal(isRoomPostableProductUrl("https://item.rakuten.co.jp/shop/item/"), true);
});

test("楽天商品ページのHTTP/2プロトコルエラーを避けるChromium設定を使う", () => {
  const options = getChromiumLaunchOptions(true);

  assert.equal(options.headless, true);
  assert.ok(options.args?.includes("--disable-http2"));
});

test("楽天商品ページはDOMContentLoadedを待たずレスポンス確立後に処理する", () => {
  const options = getProductNavigationOptions();

  assert.equal(options.waitUntil, "commit");
  assert.equal(options.timeout, 30000);
});


test("投稿完了確認のタイムアウトは成功扱いしない", async () => {
  const page = {
    waitForSelector: async () => { throw new Error("timeout"); },
    waitForURL: async () => { throw new Error("timeout"); },
  };
  assert.equal(await waitForPostCompletion(page), false);
});

test("投稿完了確認の成功は確認済みとして扱う", async () => {
  const page = {
    waitForSelector: async () => undefined,
    waitForURL: async () => new Promise(() => {}),
  };
  assert.equal(await waitForPostCompletion(page), true);
});
