import { test } from "node:test";
import assert from "node:assert/strict";
import type { RakutenItem } from "../src/fetcher";
import { buildThreadsCopyMessages, generateThreadsCopy, isThreadsCopyEnabled } from "../src/ig/threads-copy";

const item: RakutenItem = {
  itemName: "松屋 牛めしの具 プレミアム仕様",
  itemCode: "matsuya:us30",
  itemPrice: 2980,
  itemUrl: "https://item.rakuten.co.jp/matsuya/us30/",
  itemCaption: "冷凍庫に常備しておくだけで今日ごはんどうしようが秒速で解決。",
  imageUrl: "https://example.com/product.jpg",
  shopName: "松屋フーズ",
  pointRate: 5,
  hasCoupon: true,
  hasPointBonus: true,
  availability: 1,
  reviewAverage: 4.63,
  reviewCount: 14020,
};

test("buildThreadsCopyMessages embeds the product variables and link placeholder instructions", () => {
  const { system, user } = buildThreadsCopyMessages(item, { genre: "食品・冷凍食品" });

  assert.match(system, /Threadsで30,000表示以上を獲得する投稿を量産するSNSライター/);
  assert.match(system, /- ジャンル：食品・冷凍食品/);
  assert.match(system, /- 口調：親しみやすいけど丁寧な感じで/);
  assert.match(system, /\{\{RAKUTEN_LINK\}\}/);
  assert.match(system, /パターンA｜価格ギャップ重視型/);
  assert.match(system, /パターンB｜時短・手軽さ重視型/);
  assert.match(system, /パターンC｜逆張り・共感重視型/);
  assert.match(user, /松屋 牛めしの具 プレミアム仕様/);
  assert.match(user, /2,980円/);
  assert.match(user, /★4\.63/);
});

test("generateThreadsCopy substitutes the link placeholder with the real item URL and PR suffix", async () => {
  const text = await generateThreadsCopy(
    item,
    { genre: "食品・冷凍食品" },
    {
      apiKey: "test-key",
      client: async () => ({
        choices: [{ message: { content: "本文の続き\n{{RAKUTEN_LINK}}" } }],
      }),
    },
  );

  assert.equal(text, "本文の続き\nhttps://item.rakuten.co.jp/matsuya/us30/ PR");
});

test("generateThreadsCopy throws when no API key is available", async () => {
  await assert.rejects(() => generateThreadsCopy(item, { genre: "食品" }, { apiKey: "" }));
});

test("isThreadsCopyEnabled requires an OpenAI API key and respects the disable flag", () => {
  assert.equal(isThreadsCopyEnabled({ OPENAI_API_KEY: "key" } as NodeJS.ProcessEnv), true);
  assert.equal(isThreadsCopyEnabled({} as NodeJS.ProcessEnv), false);
  assert.equal(
    isThreadsCopyEnabled({ OPENAI_API_KEY: "key", THREADS_COPY_ENABLED: "0" } as NodeJS.ProcessEnv),
    false,
  );
});
