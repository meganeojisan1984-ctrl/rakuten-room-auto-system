import { test } from "node:test";
import assert from "node:assert/strict";
import { PRODUCT_CATEGORIES, pickProductCategory } from "../src/fetcher";
import { loadPersona } from "../src/persona/persona";

const expected = [
  "暮らし・インテリア",
  "ファッション・子供服",
  "グルメ・スイーツ",
  "美容・コスメ",
  "家電・ガジェット",
];

test("PRODUCT_CATEGORIES contains the five requested random categories", () => {
  assert.deepEqual(PRODUCT_CATEGORIES.map((category) => category.name), expected);
  for (const category of PRODUCT_CATEGORIES) {
    assert.ok(category.keywords.length >= 3);
    assert.ok(category.minPrice < category.maxPrice);
  }
});

test("pickProductCategory can deterministically select each requested category", () => {
  for (let i = 0; i < expected.length; i++) {
    const picked = pickProductCategory(i / expected.length + 0.001);
    assert.equal(picked.name, expected[i]);
  }
});

test("persona slots allow all requested product categories", () => {
  const persona = loadPersona();
  for (const slot of Object.values(persona.slots)) {
    assert.deepEqual(slot.genres, expected);
  }
});
