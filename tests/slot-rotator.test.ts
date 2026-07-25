import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveSlot } from "../src/persona/slot-rotator";
import type { Persona } from "../src/persona/persona";

const dummyPersona = (activeSlot: Persona["activeSlot"]): Persona => ({
  activeSlot,
  evaluationWindow: 14,
  evaluationStartedAt: "2026-07-25T00:00:00Z",
  slots: {
    slot0: { id: "slot0", name: "", priceBand: [1, 2], trackingId: "", genres: [], tone: "", hashtags: [], ngWords: [], ctaLine: "" },
    slot1: { id: "slot1", name: "", priceBand: [1, 2], trackingId: "", genres: [], tone: "", hashtags: [], ngWords: [], ctaLine: "" },
    slot2: { id: "slot2", name: "", priceBand: [1, 2], trackingId: "", genres: [], tone: "", hashtags: [], ngWords: [], ctaLine: "" },
  },
});

/** 指定 JST 時刻の Date を UTC 経由で作る */
function jst(hour: number): Date {
  const utcHour = (hour - 9 + 24) % 24;
  return new Date(Date.UTC(2026, 6, 25, utcHour, 0, 0));
}

test("resolveSlot: activeSlot が確定なら時刻に関係なく同一 slot", () => {
  const p = dummyPersona("slot1");
  assert.equal(resolveSlot(p, jst(3)), "slot1");
  assert.equal(resolveSlot(p, jst(15)), "slot1");
  assert.equal(resolveSlot(p, jst(23)), "slot1");
});

test("resolveSlot: multi モード, 朝→slot0", () => {
  const p = dummyPersona("multi");
  assert.equal(resolveSlot(p, jst(8)), "slot0");
  assert.equal(resolveSlot(p, jst(11)), "slot0");
});

test("resolveSlot: multi モード, 昼→slot1", () => {
  const p = dummyPersona("multi");
  assert.equal(resolveSlot(p, jst(13)), "slot1");
  assert.equal(resolveSlot(p, jst(17)), "slot1");
});

test("resolveSlot: multi モード, 夜→slot2", () => {
  const p = dummyPersona("multi");
  assert.equal(resolveSlot(p, jst(21)), "slot2");
  assert.equal(resolveSlot(p, jst(23)), "slot2");
});
