import { test } from "node:test";
import assert from "node:assert/strict";
import type { RakutenItem } from "../src/fetcher";
import {
  SENTENCE_MAX_CHARS,
  SENTENCE_MIN_CHARS,
  buildThreadsCopyMessages,
  extractPatternBodyLines,
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

/** 「1文目」＋「2〜4文目の段落」の2行構成のサンプルを作る（改行ルール通りの正しい形） */
function buildSample(firstChars: number, restChars: number): string {
  const first = `${"あ".repeat(Math.max(0, firstChars - 1))}。`;
  const rest = `${"い".repeat(Math.max(0, restChars - 1))}🥹`;
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

test("buildThreadsCopyMessages requires 160-200 characters per sentence, not in total", () => {
  const { system } = buildThreadsCopyMessages(item, { genre: "食品・冷凍食品" });

  assert.match(system, /「それぞれ単独で」160〜200文字/);
  assert.match(system, /- 1文目（悩み特定フック）：160〜200文字/);
  assert.match(system, /- 4文目（共感問いかけ）：160〜200文字/);
  assert.match(system, /→ 4文合わせて640〜800文字になる。/);
  assert.match(system, /【1文目｜悩み特定フック】160〜200文字/);
  assert.doesNotMatch(system, /合計160〜200文字/);
});

test("extractPatternBodyLines keeps only the body lines, dropping the link line and the score block", () => {
  const lines = extractPatternBodyLines(buildSample(180, 540));

  assert.equal(lines.length, 1);
  assert.deepEqual(lines[0].map((line) => Array.from(line).length), [180, 540]);
  assert.doesNotMatch(lines[0].join(""), /RAKUTEN_LINK|採点内訳|フック力/);
});

test("findCopyRuleViolations checks each sentence against 160-200 characters", () => {
  // 1文目180字 + 2〜4文目540字(=3文×180字) は適合
  assert.deepEqual(findCopyRuleViolations(buildSample(180, 540)), []);

  // 1文目が下限割れ
  assert.deepEqual(findCopyRuleViolations(buildSample(141, 540)), [
    `パターンA 1文目: 141文字（${SENTENCE_MIN_CHARS}文字未満）`,
  ]);

  // 2〜4文目がまとめて下限割れ（3文分＝480字が下限）
  assert.deepEqual(findCopyRuleViolations(buildSample(180, 300)), [
    `パターンA 2文目〜4文目: 300文字（${SENTENCE_MIN_CHARS * 3}文字未満）`,
  ]);

  // 上限超過（3文分＝600字が上限）
  assert.deepEqual(findCopyRuleViolations(buildSample(180, 700)), [
    `パターンA 2文目〜4文目: 700文字（${SENTENCE_MAX_CHARS * 3}文字超過）`,
  ]);

  // パターン見出しが無い出力(テスト用の短いモック等)は判定対象外
  assert.deepEqual(findCopyRuleViolations("本文の続き"), []);
});

test("findCopyRuleViolations reports a body that arrived as a single unbroken line", () => {
  const oneLine = [
    "━━━━━━━━━━━━━━━",
    "【パターンA｜価格ギャップ重視型】",
    "伸びる確率：85％",
    "",
    `${"あ".repeat(140)}。`,
    "",
    "チェックしてみて→ {{RAKUTEN_LINK}}",
    "━━━━━━━━━━━━━━━",
  ].join("\n");

  assert.deepEqual(findCopyRuleViolations(oneLine), [
    "パターンA: 1文目の後に改行が無い",
    `パターンA 1文目〜4文目: 141文字（${SENTENCE_MIN_CHARS * 4}文字未満）`,
  ]);
});

test("findCopyRuleViolations validates each sentence individually when the model breaks all four lines", () => {
  const fourLines = buildSample(180, 540).replace(
    `${"い".repeat(539)}🥹`,
    [`${"い".repeat(179)}。`, `${"う".repeat(179)}。`, `${"え".repeat(99)}🥹`].join("\n"),
  );

  assert.deepEqual(findCopyRuleViolations(fourLines), [
    `パターンA 4文目: 100文字（${SENTENCE_MIN_CHARS}文字未満）`,
  ]);
});

test("generateThreadsCopy regenerates once when a sentence is under the character minimum", async () => {
  const sent: string[] = [];
  const replies = [buildSample(141, 540), buildSample(180, 540)];
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
  assert.match(sent[1], /直前の出力は文字数ルール違反です（パターンA 1文目: 141文字（160文字未満））。/);
  assert.match(sent[1], /「それぞれ単独で」160〜200文字になるよう書き直してください（合計ではなく1文ごと）/);
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
        return { choices: [{ message: { content: buildSample(141, 540) } }] };
      },
    },
  );

  assert.equal(calls, 2);
  assert.match(text, /【パターンA｜価格ギャップ重視型】/);
});
