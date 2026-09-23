import { test } from "node:test";
import assert from "node:assert/strict";
import { PRODUCT_CATEGORIES, pickProductCategory } from "../src/fetcher";
import { loadPersona } from "../src/persona/persona";

const expected = [
  "美容機器",
  "化粧品",
  "美容家電",
  "ダイエット器具",
  "ダイエット商品",
  "PCガジェット",
  "アウトドア",
  "家電製品",
];

test("PRODUCT_CATEGORIES contains the eight requested couple categories", () => {
  assert.deepEqual(PRODUCT_CATEGORIES.map((category) => category.name), expected);
  for (const category of PRODUCT_CATEGORIES) {
    assert.ok(category.keywords.length >= 3);
    assert.ok(category.seasonalKeywords.length >= 1);
    assert.ok(category.minPrice < category.maxPrice);
    assert.ok(["wife", "husband"].includes(category.audience));
  }
});

test("pickProductCategory can deterministically select each requested category", () => {
  for (let i = 0; i < expected.length; i++) {
    const picked = pickProductCategory(i / expected.length + 0.001);
    assert.equal(picked.name, expected[i]);
  }
});

test("persona slots separate wife and husband categories", () => {
  const persona = loadPersona();
  assert.deepEqual(persona.slots.slot0.genres, expected.slice(0, 5));
  assert.deepEqual(persona.slots.slot1.genres, expected.slice(0, 5));
  assert.deepEqual(persona.slots.slot2.genres, expected.slice(5));
});
