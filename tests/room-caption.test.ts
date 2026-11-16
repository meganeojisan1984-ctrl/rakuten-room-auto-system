import { test } from "node:test";
import assert from "node:assert/strict";
import { prepareRoomCaption, assertRoomCaption, assertRoomFormReady } from "../src/poster";

test("ROOM captions retain 500 UTF-16 units and truncate 514 units", () => {
  assert.equal(prepareRoomCaption("あ".repeat(500)), "あ".repeat(500));
  assert.equal(prepareRoomCaption("あ".repeat(514)), "あ".repeat(500));
  assert.equal(prepareRoomCaption("  説明  "), "説明");
});

test("ROOM truncation preserves emoji surrogate pairs at the boundary", () => {
  assert.equal(prepareRoomCaption("あ".repeat(499) + "😀続き"), "あ".repeat(499));
  assert.equal(prepareRoomCaption("あ".repeat(498) + "😀続き"), "あ".repeat(498) + "😀");
  assert.equal(prepareRoomCaption("😀".repeat(251)), "😀".repeat(250));
});

test("ROOM validation rejects empty, whitespace and overlong actual DOM values", () => {
  for (const text of ["", " \n\t ", "あ".repeat(501)]) {
    assert.throws(() => assertRoomCaption(text), /空欄または500文字超過/);
  }
  assert.throws(() => prepareRoomCaption(" \n "), /空欄/);
  assert.doesNotThrow(() => assertRoomCaption("あ".repeat(500)));
});

function formFixture(options: {
  text?: string; nativeInvalid?: boolean; angularInvalid?: boolean;
  invalidForm?: boolean; invalidField?: boolean; enabled?: boolean; disabledLink?: boolean;
} = {}) {
  const form = {
    matches: () => !!options.invalidForm,
    querySelector: () => options.invalidField ? {} : null,
  };
  return {
    captionInput: {
      inputValue: async () => options.text ?? "正常な紹介文",
      evaluate: async (fn: any) => fn({
        validity: { valid: !options.nativeInvalid },
        matches: () => !!options.angularInvalid,
        closest: () => form,
      }),
    },
    postButton: {
      isEnabled: async () => options.enabled ?? true,
      evaluate: async (fn: any) => fn({ matches: () => !!options.disabledLink }),
    },
  };
}

test("ROOM pre-submit guard accepts a valid form", async () => {
  const { captionInput, postButton } = formFixture();
  await assertRoomFormReady(captionInput, postButton);
});

test("ROOM pre-submit guard blocks invalid DOM/model and disabled buttons or links", async () => {
  for (const options of [
    { text: "" }, { text: "あ".repeat(514) }, { nativeInvalid: true },
    { angularInvalid: true }, { invalidForm: true }, { invalidField: true },
    { enabled: false }, { disabledLink: true },
  ]) {
    const { captionInput, postButton } = formFixture(options);
    await assert.rejects(assertRoomFormReady(captionInput, postButton), /送信を中止/);
  }
});

test("ROOM pre-submit guard fails closed when form inspection fails", async () => {
  const { captionInput, postButton } = formFixture();
  captionInput.inputValue = async () => { throw new Error("detached"); };
  await assert.rejects(assertRoomFormReady(captionInput, postButton), /detached/);
});

test("上限超過時は末尾のハッシュタグ行を残して本文を文末で詰める", () => {
  const tags = "#PCガジェット #家電 #楽天ROOM #買ってよかった";
  const body = "一文目です。".repeat(110);
  const result = prepareRoomCaption(`${body}\n\n${tags}`);
  assert.ok(result.length <= 500);
  assert.ok(result.endsWith(tags));
  assert.match(result, /一文目です。\n\n#PCガジェット/);
  const short = `短い紹介文です。\n\n${tags}`;
  assert.equal(prepareRoomCaption(short), short);
});

test("商品一覧のテキストから今回の紹介文の掲載を判定する", async () => {
  const { captionAppearsInProfileText } = await import("../src/poster");
  const caption = "メーカー希望小売価格はメーカーサイトに基づいて掲載しています 32L冷凍庫 【前開き式】家庭用冷蔵庫と同じように扉を前に開くタイプで、冷凍庫内を一目で確認できます\n\n#楽天ROOM";
  const profile = "商品\n595\nメーカー希望小売価格はメ\nーカーサイトに基づいて掲\n載しています 32L冷凍庫 【前開き式】家庭用冷蔵庫と同じように扉を前に開くタイプで…\n￥19,800〜";
  assert.equal(captionAppearsInProfileText(profile, caption), true);
  assert.equal(captionAppearsInProfileText("商品\n595\n別の商品の紹介文です。\n￥1,980", caption), false);
  assert.equal(captionAppearsInProfileText(profile, "短い"), false);
});
