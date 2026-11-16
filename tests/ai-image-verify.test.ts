import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { buildAiImageVerifyRequest, parseAiImageVerifyResponse, verifyAiImages } from "../src/ig/ai-image-verify";
import { generateAiLifestyleImages } from "../src/ig/ai-image";
import { buildImageCreativePlan } from "../src/ig/image-creative";
import { generateCreativeCopy } from "../src/ig/creative-copy";
import type { RakutenItem } from "../src/fetcher";
import type { PersonaSlot } from "../src/persona/persona";

const item: RakutenItem = {
  itemName: "【中古】冷蔵庫 電子レンジ 2点セット 地域限定送料・設置無料 set_2_5_o",
  itemCode: "shop:set",
  itemPrice: 33000,
  itemUrl: "https://item.rakuten.co.jp/shop/set/",
  itemCaption: "新生活を始めるのにお得で便利な中古家電のセット品です。駐車できない、設置場所から駐車位置が遠い等の状況により、軒下または玄関でのお渡しのみとなる場合が御座います。冷蔵庫は2ドアで自炊に使いやすい容量です。",
  imageUrl: "https://example.com/set.jpg",
  shopName: "ショップ",
  pointRate: 1,
  hasCoupon: false,
  hasPointBonus: false,
  availability: 1,
  reviewAverage: 4.75,
  reviewCount: 4,
};
const persona = { id: "slot2", name: "家電", genres: ["家電製品"], hashtags: [], ngWords: [] } as unknown as PersonaSlot;
const image = { bytes: new Uint8Array([1, 2, 3]), mimeType: "image/jpeg" };

test("検品リクエストは商品写真と全スライドを画像として渡す", () => {
  const request = buildAiImageVerifyRequest(
    { productName: "冷蔵庫 電子レンジ 2点セット", productImage: image, slides: [image, image], expectedPrice: "33,000円" },
    {},
  ) as { model: string; input: Array<{ content: Array<{ type: string; text?: string }> }> };
  const content = request.input[0]!.content;
  assert.equal(request.model, "gpt-5-mini");
  assert.equal(content.filter((part) => part.type === "input_image").length, 3);
  assert.match(content[0]!.text!, /正しい価格表記: 33,000円/);
});

test("別商品や価格違いが1枚でもあれば不合格にする", () => {
  const pass = parseAiImageVerifyResponse('{"slides":[{"wrongProduct":false,"wrongPrice":false},{"wrongProduct":false,"wrongPrice":false}]}', 2);
  assert.equal(pass.ok, true);
  const fail = parseAiImageVerifyResponse('```json\n{"slides":[{"wrongProduct":true,"wrongPrice":false},{"wrongProduct":false,"wrongPrice":true}]}\n```', 2);
  assert.equal(fail.ok, false);
  assert.deepEqual(fail.problems, ["スライド1: 別の商品が描かれています", "スライド2: 価格表記が商品データと異なります"]);
  assert.throws(() => parseAiImageVerifyResponse('{"slides":[{"wrongProduct":false,"wrongPrice":false}]}', 2), /unexpected number/);
  assert.throws(() => parseAiImageVerifyResponse('{"slides":[{"wrongProduct":"no"}]}', 1), /invalid slide verdict/);
});

test("検品は低コストのテキストモデルを1回だけ呼ぶ", async () => {
  let calls = 0;
  const result = await verifyAiImages(
    { productName: "冷蔵庫", productImage: image, slides: [image] },
    { apiKey: "k", env: {}, client: async () => { calls++; return { output_text: '{"slides":[{"wrongProduct":false,"wrongPrice":false}]}' }; } },
  );
  assert.equal(calls, 1);
  assert.equal(result.ok, true);
});

test("検品で不合格の生成画像は破棄してエラーにする", async () => {
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "ai-verify-"));
  try {
    await assert.rejects(
      generateAiLifestyleImages(item, persona, {
        outputDir,
        publicBaseUrl: "https://cdn.example.com/ig",
        apiKey: "test-key",
        creativePlan: buildImageCreativePlan(item),
        loadProductImage: async () => ({ bytes: Buffer.from("product"), mimeType: "image/jpeg" }),
        client: async () => ({ data: [{ b64_json: Buffer.from("jpeg").toString("base64") }] }),
        verifier: async (input) => {
          assert.equal(input.slides.length, 5);
          assert.equal(input.expectedPrice, "33,000円");
          return { ok: false, problems: ["スライド1: 別の商品が描かれています"] };
        },
      }),
      /AI画像の検品で不合格: スライド1/,
    );
    assert.deepEqual(fs.readdirSync(outputDir), []);
  } finally {
    fs.rmSync(outputDir, { recursive: true, force: true });
  }
});

test("配送・設置条件や管理コードは画像のコピーに使わない", () => {
  const plan = buildImageCreativePlan(item);
  assert.doesNotMatch(plan.prompt, /set_2_5_o/);
  assert.doesNotMatch(plan.prompt, /駐車|軒下|玄関でのお渡し/);
  assert.match(plan.prompt, /新生活を始めるのにお得で便利な中古家電のセット品です/);
  assert.match(plan.analysis.displayName, /冷蔵庫 電子レンジ 2点セット/);
});

test("コピーが検証で不採用のときは理由を伝えて1回だけ作り直す", async () => {
  const good = {
    hookQuestion: "新生活の家電選び、迷っていませんか",
    hookHeadline: "2点セットでまとめて準備",
    tagline: "新生活をすっきり始める。",
    chips: ["冷蔵庫と電子レンジ", "2点セット", "新生活向け", "中古家電"],
    features: [
      { title: "2点まとめて", detail: "冷蔵庫と電子レンジのセット品" },
      { title: "2ドア冷蔵庫", detail: "自炊に使いやすい容量" },
      { title: "中古家電", detail: "新生活を始めるのにお得" },
    ],
    scenes: ["一人暮らしの準備", "引っ越し直後に", "自炊を始める日に"],
    recommendFor: ["新生活の家電をそろえたい方", "まとめて準備したい方", "自炊を始めたい方"],
  };
  const tooLong = { ...good, features: [{ title: "とても長すぎる機能カードのタイトルです", detail: "説明" }, good.features[1], good.features[2]] };
  const prompts: string[] = [];
  const copy = await generateCreativeCopy(item, {
    apiKey: "k",
    env: {},
    client: async (body) => {
      prompts.push(String(body.input));
      return { output_text: JSON.stringify(prompts.length === 1 ? tooLong : good) };
    },
  });
  assert.equal(prompts.length, 2);
  assert.match(prompts[1]!, /前回の出力は次の理由で不採用でした/);
  assert.equal(copy.hookHeadline, good.hookHeadline);
});
