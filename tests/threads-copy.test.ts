import { test } from "node:test";
import assert from "node:assert/strict";
import type { RakutenItem } from "../src/fetcher";
import {
  BODY_MAX_CHARS,
  BODY_MIN_CHARS,
  buildThreadsCopyMessages,
  extractPatternBodies,
  findCopyRuleViolations,
  generateThreadsCopy,
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
  assert.match(system, /各パターンの本文は必ず1文目〜4文目をすべて書くこと/);
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

test("generateThreadsCopy collapses a duplicated PR label when the model writes one itself", async () => {
  const text = await generateThreadsCopy(
    item,
    { genre: "食品・冷凍食品" },
    {
      apiKey: "test-key",
      client: async () => ({
        choices: [{ message: { content: "チェックしてみて→ {{RAKUTEN_LINK}} PR" } }],
      }),
    },
  );

  assert.equal(text, "チェックしてみて→ https://item.rakuten.co.jp/matsuya/us30/ PR");
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

function buildSample(bodyChars: number): string {
  // 固定部分（1文目の語尾17文字 + 2〜4文目71文字 = 88文字）に「あ」を足して狙った文字数に揃える
  const first = `${"あ".repeat(Math.max(0, bodyChars - 88))}に悩んでる人、これ使った方がいい。`;
  const rest = "だって、たった4,800円なのに肌がつるんと整うんだから🥹高い化粧品使ってて満足できてない人、絶対試して。手間をかけるより楽な方が良くない？🥹";
  return [
    "━━━━━━━━━━━━━━━",
    "【パターンA｜価格ギャップ重視型】",
    "伸びる確率：85％",
    "",
    first,
    rest,
    "",
    "チェックしてみて→ {{RAKUTEN_LINK}}",
    "",
    "採点内訳：",
    "・フック力：17/20",
    "━━━━━━━━━━━━━━━",
  ].join("\n");
}

test("buildThreadsCopyMessages states the 160-200 character requirement with a per-sentence breakdown", () => {
  const { system } = buildThreadsCopyMessages(item, { genre: "食品・冷凍食品" });

  assert.match(system, /1文目〜4文目の合計は必ず160〜200文字/);
  assert.match(system, /- 1文目（悩み特定フック）：40〜50文字/);
  assert.match(system, /- 4文目（共感問いかけ）：30〜40文字/);
  assert.match(system, /5文目（リンク誘導文と商品リンク）はこの文字数に含めない/);
  assert.doesNotMatch(system, /合計160〜200文字以内。/);
});

test("extractPatternBodies keeps only the 1-4 sentence body, dropping the link line and the score block", () => {
  const bodies = extractPatternBodies(buildSample(170));

  assert.equal(bodies.length, 1);
  assert.equal(Array.from(bodies[0]).length, 170);
  assert.doesNotMatch(bodies[0], /RAKUTEN_LINK|採点内訳|フック力/);
});

test("findCopyRuleViolations flags bodies shorter than the minimum and passes compliant ones", () => {
  assert.deepEqual(findCopyRuleViolations(buildSample(170)), []);
  assert.deepEqual(findCopyRuleViolations(buildSample(141)), [
    `パターンA: 141文字（${BODY_MIN_CHARS}文字未満）`,
  ]);
  assert.deepEqual(findCopyRuleViolations(buildSample(210)), [
    `パターンA: 210文字（${BODY_MAX_CHARS}文字超過）`,
  ]);
  // パターン見出しが無い出力(テスト用の短いモック等)は判定対象外
  assert.deepEqual(findCopyRuleViolations("本文の続き"), []);

  // 1文しか書かれていない場合は文字数と文数の両方を指摘する
  const oneSentence = buildSample(170).replace(
    "だって、たった4,800円なのに肌がつるんと整うんだから🥹高い化粧品使ってて満足できてない人、絶対試して。手間をかけるより楽な方が良くない？🥹",
    "",
  );
  assert.deepEqual(findCopyRuleViolations(oneSentence), [
    "パターンA: 99文字（160文字未満）",
    "パターンA: 1文（1文目〜4文目が揃っていない）",
  ]);
});

test("generateThreadsCopy regenerates once when the body is under the character minimum", async () => {
  const sent: string[] = [];
  const replies = [buildSample(141), buildSample(170)];
  const text = await generateThreadsCopy(
    item,
    { genre: "食品・冷凍食品" },
    {
      apiKey: "test-key",
      client: async (body) => {
        const messages = (body.messages ?? []) as Array<{ role: string; content: string }>;
        sent.push(messages.at(-1)!.content);
        return { choices: [{ message: { content: replies.shift()! } }] };
      },
    },
  );

  assert.equal(sent.length, 2);
  assert.match(sent[1], /直前の出力は文字数ルール違反です（パターンA: 141文字（160文字未満））。/);
  assert.deepEqual(findCopyRuleViolations(text), []);
  assert.match(text, /https:\/\/item\.rakuten\.co\.jp\/matsuya\/us30\/ PR/);
});

test("generateThreadsCopy gives up after the retry instead of failing the mail", async () => {
  let calls = 0;
  const text = await generateThreadsCopy(
    item,
    { genre: "食品・冷凍食品" },
    {
      apiKey: "test-key",
      client: async () => {
        calls += 1;
        return { choices: [{ message: { content: buildSample(141) } }] };
      },
    },
  );

  assert.equal(calls, 2);
  assert.match(text, /【パターンA｜価格ギャップ重視型】/);
});
