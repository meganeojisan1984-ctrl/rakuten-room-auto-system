import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluatePersona, STOP_LOSS_MIN_REWARD } from "../src/persona/evaluator";
import { deriveItemCode } from "../src/affiliate/report-parser";
import type { Persona } from "../src/persona/persona";
import type { PostRecord } from "../src/agents/store";
import type { SalesRow } from "../src/affiliate/sales-db";

const basePersona = (activeSlot: Persona["activeSlot"], startedAt: string, evalWindow = 14): Persona => ({
  activeSlot,
  evaluationWindow: evalWindow,
  evaluationStartedAt: startedAt,
  slots: {
    slot0: { id: "slot0", name: "s0", priceBand: [1, 2], trackingId: "", genres: [], tone: "", hashtags: [], ngWords: [], ctaLine: "" },
    slot1: { id: "slot1", name: "s1", priceBand: [1, 2], trackingId: "", genres: [], tone: "", hashtags: [], ngWords: [], ctaLine: "" },
    slot2: { id: "slot2", name: "s2", priceBand: [1, 2], trackingId: "", genres: [], tone: "", hashtags: [], ngWords: [], ctaLine: "" },
  },
});

const H = (slot: string, hash: string): PostRecord => ({
  ts: "2026-07-25T00:00:00Z",
  itemCode: "x",
  itemName: "x",
  genreName: "",
  price: 1000,
  postType: 1,
  hour: 8,
  slot,
  itemCodeHash: hash,
}) as unknown as PostRecord;

const S = (itemCode: string, reward: number, clicks: number = 0): SalesRow => ({
  date: "2026-07-25", itemCode, trackingId: "", clicks, orders: 1, reward,
});

test("evaluator: 未経過なら verdict='not-yet'", () => {
  const now = new Date("2026-08-01T00:00:00Z");
  const persona = basePersona("multi", "2026-07-25T00:00:00Z", 14);
  const r = evaluatePersona([], [], persona, now);
  assert.equal(r.verdict, "not-yet");
  assert.equal(r.daysRemaining, 7);
});

test("evaluator: already-decided なら activeSlot 変更しない", () => {
  const now = new Date("2026-09-01T00:00:00Z");
  const persona = basePersona("slot1", "2026-07-25T00:00:00Z", 14);
  const r = evaluatePersona([], [], persona, now);
  assert.equal(r.verdict, "already-decided");
});

test("evaluator: 全 slot の reward が STOP_LOSS 未満 → 'stop-loss'", () => {
  const now = new Date("2026-08-09T00:00:00Z");
  const persona = basePersona("multi", "2026-07-25T00:00:00Z", 14);
  const hA = deriveItemCode("s", "a");
  const history = [H("slot0", hA), H("slot1", hA)];
  const sales = [S(hA, 500)];
  const r = evaluatePersona(history, sales, persona, now);
  assert.equal(r.verdict, "stop-loss");
  assert.ok(r.totalReward < STOP_LOSS_MIN_REWARD);
});

test("evaluator: 総 reward >= STOP_LOSS かつ 明確な勝者 → 'winner-decided'", () => {
  const now = new Date("2026-08-09T00:00:00Z");
  const persona = basePersona("multi", "2026-07-25T00:00:00Z", 14);
  const hA = deriveItemCode("s", "a");
  const hB = deriveItemCode("s", "b");
  const hC = deriveItemCode("s", "c");
  const history = [H("slot0", hA), H("slot1", hB), H("slot2", hC)];
  const sales = [
    S(hA, 1000),
    S(hB, 500),
    S(hC, 3500),
  ];
  const r = evaluatePersona(history, sales, persona, now);
  assert.equal(r.verdict, "winner-decided");
  assert.equal(r.winnerSlot, "slot2");
});

test("evaluator: 勝者と2位の差が小さい (< 20%) 場合は 'keep-multi'", () => {
  const now = new Date("2026-08-09T00:00:00Z");
  const persona = basePersona("multi", "2026-07-25T00:00:00Z", 14);
  const hA = deriveItemCode("s", "a");
  const hB = deriveItemCode("s", "b");
  const history = [H("slot0", hA), H("slot1", hB)];
  const sales = [S(hA, 2100), S(hB, 2000)];
  const r = evaluatePersona(history, sales, persona, now);
  assert.equal(r.verdict, "keep-multi");
  assert.ok(r.summary.includes("僅差"));
});
