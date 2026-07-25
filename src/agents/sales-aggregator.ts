import type { PostRecord } from "./store";
import type { SalesRow } from "../affiliate/sales-db";
import { priceBandOf } from "./store";

export const SALES_SCORE_WEIGHT = { reward: 0.7, clicks: 0.3 } as const;

export function salesScore(row: { reward: number; clicks: number }): number {
  return row.reward * SALES_SCORE_WEIGHT.reward + row.clicks * SALES_SCORE_WEIGHT.clicks;
}

export interface SlotSalesAggregate {
  slot: string;
  posts: number;
  matchedSales: number;
  totalReward: number;
  totalClicks: number;
  salesScore: number;
}

export interface KeyedSalesAggregate {
  key: string;
  posts: number;
  matchedSales: number;
  totalReward: number;
  totalClicks: number;
  salesScore: number;
}

/** history の itemCodeHash × sales.itemCode で JOIN し key ごとに集計 */
function aggregateBy(
  history: PostRecord[],
  sales: SalesRow[],
  keyOf: (h: PostRecord) => string,
): KeyedSalesAggregate[] {
  const salesByHash = new Map<string, SalesRow[]>();
  for (const s of sales) {
    const arr = salesByHash.get(s.itemCode) ?? [];
    arr.push(s);
    salesByHash.set(s.itemCode, arr);
  }
  const acc = new Map<string, KeyedSalesAggregate>();
  for (const h of history) {
    const key = keyOf(h);
    const cur = acc.get(key) ?? {
      key, posts: 0, matchedSales: 0, totalReward: 0, totalClicks: 0, salesScore: 0,
    };
    cur.posts += 1;
    if (h.itemCodeHash) {
      const matches = salesByHash.get(h.itemCodeHash) ?? [];
      for (const m of matches) {
        cur.matchedSales += 1;
        cur.totalReward += m.reward;
        cur.totalClicks += m.clicks;
      }
    }
    acc.set(key, cur);
  }
  for (const v of acc.values()) {
    v.salesScore = salesScore({ reward: v.totalReward, clicks: v.totalClicks });
  }
  return Array.from(acc.values()).sort((a, b) => b.salesScore - a.salesScore);
}

export function aggregateSlotSales(history: PostRecord[], sales: SalesRow[]): SlotSalesAggregate[] {
  const kv = aggregateBy(history, sales, (h) => h.slot ?? "unknown");
  return kv.map((k) => ({ ...k, slot: k.key }));
}

export function aggregateGenreSales(history: PostRecord[], sales: SalesRow[]): KeyedSalesAggregate[] {
  return aggregateBy(history, sales, (h) => h.genreName || "不明");
}

export function aggregatePriceBandSales(history: PostRecord[], sales: SalesRow[]): KeyedSalesAggregate[] {
  return aggregateBy(history, sales, (h) => priceBandOf(h.price));
}
