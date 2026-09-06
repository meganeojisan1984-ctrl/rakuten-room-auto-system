import { test } from "node:test";
import assert from "node:assert/strict";
import type { RakutenItem } from "../src/fetcher";
import {
  buildThreadsCopyMessages,
  generateThreadsCopy,
  hasSplitReplyBlocks,
  isThreadsCopyEnabled,
} from "../src/ig/threads-copy";

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
  assert.match(system, /1文目を投稿し、その投稿に自分で4回リプライして2文目・3文目・4文目・5文目を1つずつ投稿する/);
  assert.match(
    system,
    /1文目・2文目・3文目・4文目・5文目は、それぞれ単独で160文字以上200文字以内とすること/,
  );
  assert.doesNotMatch(system, /【リプライ（2〜5文目）】/);
  for (const heading of ["【投稿（1文目）】", "【リプライ1（2文目）】", "【リプライ2（3文目）】", "【リプライ3（4文目）】", "【リプライ4（5文目）】"]) {
    assert.equal(system.split(heading).length - 1 >= 3, true, `${heading} が3パターン分出力形式に含まれていること`);
  }
  assert.match(user, /5ブロックを必ず分けて出力し、各ブロックを160〜200文字に/);
  assert.match(user, /松屋 牛めしの具 プレミアム仕様/);
  assert.match(user, /2,980円/);
  assert.match(user, /★4\.63/);
});

function splitFormattedContent(body: string): string {
  return ["A", "B", "C"]
    .map((pattern) =>
      [
        `【パターン${pattern}】`,
        "【投稿（1文目）】",
        "1文目",
        "【リプライ1（2文目）】",
        "2文目",
        "【リプライ2（3文目）】",
        "3文目",
        "【リプライ3（4文目）】",
        "4文目",
        "【リプライ4（5文目）】",
        body,
      ].join("\n"),
    )
    .join("\n");
}

test("generateThreadsCopy substitutes the link placeholder with the real item URL and PR suffix", async () => {
  const text = await generateThreadsCopy(
    item,
    { genre: "食品・冷凍食品" },
    {
      apiKey: "test-key",
      client: async () => ({
        choices: [{ message: { content: splitFormattedContent("本文の続き {{RAKUTEN_LINK}}") } }],
      }),
    },
  );

  assert.equal(
    text,
    splitFormattedContent("本文の続き https://item.rakuten.co.jp/matsuya/us30/ PR"),
  );
});

test("hasSplitReplyBlocks rejects a merged 2〜5文目 block and accepts split ones", () => {
  assert.equal(hasSplitReplyBlocks("【投稿（1文目）】\nA\n【リプライ（2〜5文目）】\nB"), false);
  assert.equal(hasSplitReplyBlocks(splitFormattedContent("リンク文")), true);
});

test("generateThreadsCopy retries once when the reply blocks are merged", async () => {
  const responses = [
    "【投稿（1文目）】\n1文目\n【リプライ（2〜5文目）】\n2〜5文目まとめ",
    splitFormattedContent("リンク誘導文 {{RAKUTEN_LINK}}"),
  ];
  const sentMessages: Array<Array<{ role: string; content: string }>> = [];

  const text = await generateThreadsCopy(
    item,
    { genre: "食品・冷凍食品" },
    {
      apiKey: "test-key",
      client: async (body) => {
        sentMessages.push(body.messages as Array<{ role: string; content: string }>);
        return { choices: [{ message: { content: responses.shift()! } }] };
      },
    },
  );

  assert.equal(sentMessages.length, 2);
  assert.equal(sentMessages[1].length, 4);
  assert.match(sentMessages[1][3].content, /2文目〜5文目がまとまってしまっています/);
  assert.equal(hasSplitReplyBlocks(text), true);
  assert.match(text, /https:\/\/item\.rakuten\.co\.jp\/matsuya\/us30\/ PR/);
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
