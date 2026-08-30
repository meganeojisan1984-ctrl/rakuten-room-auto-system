import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildOpenAiTextRequest,
  extractOpenAiText,
  resolveOpenAiTextModel,
} from "../src/openai-text";

test("OpenAI text request uses Responses API and a configurable low-cost model", () => {
  const request = buildOpenAiTextRequest("紹介文を書いて", { OPENAI_TEXT_MODEL: "  gpt-5-mini  " });
  assert.equal(request.model, "gpt-5-mini");
  assert.equal(request.input, "紹介文を書いて");
  assert.equal(request.max_output_tokens, 1024);
  assert.deepEqual(request.reasoning, { effort: "minimal" });
  assert.equal(resolveOpenAiTextModel({}), "gpt-5-mini");
});

test("extractOpenAiText reads output_text and rejects empty responses", () => {
  assert.equal(extractOpenAiText({ output_text: "  自然な紹介文です。  " }), "自然な紹介文です。");
  assert.equal(
    extractOpenAiText({
      output: [{ type: "message", content: [{ type: "output_text", text: "REST応答の紹介文です。" }] }],
    }),
    "REST応答の紹介文です。",
  );
  assert.equal(
    extractOpenAiText({
      output: [{ content: [{ type: "text", text: "別形式の紹介文です。" }] }],
    }),
    "別形式の紹介文です。",
  );
  assert.equal(
    extractOpenAiText({ output: [{ content: [{ text: "種類なしの本文です。" }] }] }),
    "種類なしの本文です。",
  );
  assert.throws(() => extractOpenAiText({ output_text: "   " }), /空/);
});
