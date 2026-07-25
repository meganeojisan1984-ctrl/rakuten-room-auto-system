import type { Persona, SlotId } from "./persona";
import type { PostRecord } from "../agents/store";
import type { SalesRow } from "../affiliate/sales-db";
import { aggregateSlotSales, type SlotSalesAggregate } from "../agents/sales-aggregator";

export const STOP_LOSS_MIN_REWARD = 3000;
/** 勝者判定に必要な 1位 vs 2位 の相対差 (20%) */
export const WINNER_MIN_MARGIN = 0.2;

export type EvaluationVerdict =
  | "winner-decided"
  | "stop-loss"
  | "keep-multi"
  | "already-decided"
  | "not-yet";

export interface EvaluationResult {
  verdict: EvaluationVerdict;
  winnerSlot?: SlotId;
  daysElapsed: number;
  daysRemaining: number;
  slotAggregates: SlotSalesAggregate[];
  totalReward: number;
  summary: string;
}

function daysBetween(a: Date, b: Date): number {
  const ms = a.getTime() - b.getTime();
  return Math.floor(ms / (24 * 60 * 60 * 1000));
}

export function evaluatePersona(
  history: PostRecord[],
  sales: SalesRow[],
  persona: Persona,
  now: Date,
): EvaluationResult {
  // 既に確定していれば触らない
  if (persona.activeSlot !== "multi") {
    return {
      verdict: "already-decided",
      daysElapsed: daysBetween(now, new Date(persona.evaluationStartedAt)),
      daysRemaining: 0,
      slotAggregates: [],
      totalReward: 0,
      summary: `activeSlot は既に "${persona.activeSlot}" で確定済み`,
    };
  }

  const started = new Date(persona.evaluationStartedAt);
  const daysElapsed = daysBetween(now, started);
  const daysRemaining = Math.max(0, persona.evaluationWindow - daysElapsed);

  if (daysElapsed < persona.evaluationWindow) {
    return {
      verdict: "not-yet",
      daysElapsed,
      daysRemaining,
      slotAggregates: [],
      totalReward: 0,
      summary: `評価窓 ${persona.evaluationWindow}日 のうち ${daysElapsed}日 経過、あと ${daysRemaining}日`,
    };
  }

  const slotAggregates = aggregateSlotSales(history, sales)
    .filter((s) => s.slot === "slot0" || s.slot === "slot1" || s.slot === "slot2");
  const totalReward = slotAggregates.reduce((a, s) => a + s.totalReward, 0);

  if (totalReward < STOP_LOSS_MIN_REWARD) {
    return {
      verdict: "stop-loss",
      daysElapsed,
      daysRemaining: 0,
      slotAggregates,
      totalReward,
      summary: `${persona.evaluationWindow}日で総報酬¥${totalReward} < ¥${STOP_LOSS_MIN_REWARD}。3候補の差し替えを検討してください`,
    };
  }

  const sorted = [...slotAggregates].sort((a, b) => b.salesScore - a.salesScore);
  const top = sorted[0];
  const second = sorted[1];

  if (!top) {
    return {
      verdict: "keep-multi",
      daysElapsed,
      daysRemaining: 0,
      slotAggregates,
      totalReward,
      summary: "slot 別集計が空。multi モード維持",
    };
  }

  if (second && second.salesScore > 0) {
    const margin = (top.salesScore - second.salesScore) / top.salesScore;
    if (margin < WINNER_MIN_MARGIN) {
      return {
        verdict: "keep-multi",
        daysElapsed,
        daysRemaining: 0,
        slotAggregates,
        totalReward,
        summary: `僅差 (top ${top.slot}=${top.salesScore.toFixed(0)}, 2nd ${second.slot}=${second.salesScore.toFixed(0)}, margin ${(margin * 100).toFixed(0)}%)。multi モード継続`,
      };
    }
  }

  return {
    verdict: "winner-decided",
    winnerSlot: top.slot as SlotId,
    daysElapsed,
    daysRemaining: 0,
    slotAggregates,
    totalReward,
    summary: `勝者=${top.slot} (score=${top.salesScore.toFixed(0)}, reward=¥${top.totalReward}) を activeSlot に確定`,
  };
}
