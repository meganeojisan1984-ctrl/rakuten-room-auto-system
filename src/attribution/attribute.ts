import type { PostRecord } from "../agents/store";
import type { SalesRow } from "../affiliate/sales-db";

export interface SlotAttribution {
  slot: string;
  posts: number;
  matchedSales: number;
  totalReward: number;
  totalOrders: number;
}

export function attributeSlots(history: PostRecord[], sales: SalesRow[]): SlotAttribution[] {
  const salesByHash = new Map<string, SalesRow[]>();
  for (const s of sales) {
    const arr = salesByHash.get(s.itemCode) ?? [];
    arr.push(s);
    salesByHash.set(s.itemCode, arr);
  }

  const acc = new Map<string, SlotAttribution>();
  const ensure = (slot: string): SlotAttribution => {
    const cur = acc.get(slot);
    if (cur) return cur;
    const fresh: SlotAttribution = { slot, posts: 0, matchedSales: 0, totalReward: 0, totalOrders: 0 };
    acc.set(slot, fresh);
    return fresh;
  };

  for (const h of history) {
    const slot = h.slot ?? "unknown";
    const bucket = ensure(slot);
    bucket.posts += 1;
    if (h.itemCodeHash) {
      const matches = salesByHash.get(h.itemCodeHash) ?? [];
      for (const m of matches) {
        bucket.matchedSales += 1;
        bucket.totalOrders += m.orders;
        bucket.totalReward += m.reward;
      }
    }
  }
  return Array.from(acc.values()).sort((a, b) => b.totalReward - a.totalReward);
}
