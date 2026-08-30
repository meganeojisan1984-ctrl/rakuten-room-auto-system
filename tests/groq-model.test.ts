import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_GROQ_MODEL, resolveGroqModel } from "../src/groq-model";

test("resolveGroqModel defaults to the supported Groq replacement model", () => {
  assert.equal(resolveGroqModel({}), DEFAULT_GROQ_MODEL);
  assert.equal(DEFAULT_GROQ_MODEL, "openai/gpt-oss-120b");
});

test("resolveGroqModel trims and uses the requested env override", () => {
  assert.equal(
    resolveGroqModel({ GROQ_MODEL: "  qwen/qwen3.6-27b  " }, "GROQ_MODEL"),
    "qwen/qwen3.6-27b",
  );
});

test("resolveGroqModel supports affiliate-specific env override", () => {
  assert.equal(
    resolveGroqModel({ AFFILIATE_LLM_MODEL: "openai/gpt-oss-20b" }, "AFFILIATE_LLM_MODEL"),
    "openai/gpt-oss-20b",
  );
});
