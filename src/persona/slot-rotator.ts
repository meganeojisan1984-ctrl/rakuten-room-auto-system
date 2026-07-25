import type { Persona, SlotId } from "./persona";

/**
 * 本回の投稿を担当する slot を決定。
 * activeSlot が確定なら常にそれ。multi なら JST 時刻でローテ:
 *   0-11時 → slot0, 12-17時 → slot1, 18-23時 → slot2
 */
export function resolveSlot(p: Persona, now: Date): SlotId {
  if (p.activeSlot !== "multi") return p.activeSlot;
  const jstHour = Number(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Tokyo",
      hour: "2-digit",
      hour12: false,
    }).format(now),
  );
  if (jstHour < 12) return "slot0";
  if (jstHour < 18) return "slot1";
  return "slot2";
}
