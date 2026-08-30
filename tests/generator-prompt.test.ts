import { test } from "node:test";
import assert from "node:assert/strict";
import { buildFallbackCaption, HUMAN_BUYER_COPY_RULES } from "../src/generator";
import type { RakutenItem } from "../src/fetcher";

test("HUMAN_BUYER_COPY_RULES discourages AI-like copy while keeping purchase intent", () => {
  assert.match(HUMAN_BUYER_COPY_RULES, /AIっぽい/);
  assert.match(HUMAN_BUYER_COPY_RULES, /購入/);
  assert.match(HUMAN_BUYER_COPY_RULES, /断言しない/);
  assert.match(HUMAN_BUYER_COPY_RULES, /生活/);
});

test("fallback caption keeps posting alive when the text model is unavailable", () => {
  const item = {
    itemName: "収納ボックス",
    itemPrice: 1980,
    itemCaption: "棚のすき間に置きやすい収納用品です。",
    reviewAverage: 4.5,
    reviewCount: 123,
  } as RakutenItem;
  const caption = buildFallbackCaption(item);
  assert.match(caption, /収納ボックス/);
  assert.match(caption, /123件/);
  assert.doesNotMatch(caption, /実際に使った|買ってから生活が変わった/);
});
