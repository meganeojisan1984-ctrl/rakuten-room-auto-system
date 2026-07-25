import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { loadPersona, getSlot, savePersona } from "../src/persona/persona";

test("loadPersona: persona.json をパースし 3 slot 全て取得できる", () => {
  const p = loadPersona();
  assert.equal(typeof p.activeSlot, "string");
  assert.ok(["multi", "slot0", "slot1", "slot2"].includes(p.activeSlot));
  assert.equal(Object.keys(p.slots).length, 3);
  for (const id of ["slot0", "slot1", "slot2"] as const) {
    const s = getSlot(p, id);
    assert.ok(s.name.length > 0);
    assert.ok(s.hashtags.length > 0);
    assert.ok(s.genres.length > 0);
    assert.equal(s.priceBand.length, 2);
    assert.ok(s.priceBand[0] < s.priceBand[1]);
  }
});

test("getSlot: 不明 slot は throw", () => {
  const p = loadPersona();
  // @ts-expect-error 不正な id
  assert.throws(() => getSlot(p, "slot99"));
});

test("savePersona/loadPersona: ラウンドトリップ (override path)", () => {
  const dir = fs.mkdtempSync(path.join(process.cwd(), "tmp-persona-"));
  const savedPath = path.join(dir, "persona.json");
  const original = loadPersona();
  process.env.PERSONA_PATH_OVERRIDE = savedPath;
  try {
    savePersona({ ...original, activeSlot: "slot1" });
    const loaded = loadPersona();
    assert.equal(loaded.activeSlot, "slot1");
  } finally {
    delete process.env.PERSONA_PATH_OVERRIDE;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
