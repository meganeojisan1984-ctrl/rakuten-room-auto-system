import type { SalesRow } from "./sales-db";

const HEADER_ALIASES = {
  itemCode: ["商品コード", "商品ID", "item_code", "itemcode"],
  clicks: ["クリック数", "クリック", "clicks"],
  orders: ["成果件数", "成果", "注文件数", "orders"],
  reward: ["報酬額", "報酬", "reward"],
  trackingId: ["トラッキングID", "トラッキングid", "tracking_id", "trackingid"],
} as const;

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuote = false;
  for (const ch of line) {
    if (ch === '"') {
      inQuote = !inQuote;
    } else if (ch === "," && !inQuote) {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

function findIndex(header: string[], aliases: readonly string[]): number {
  const norm = header.map((h) => h.trim().toLowerCase());
  for (const a of aliases) {
    const i = norm.indexOf(a.toLowerCase());
    if (i >= 0) return i;
  }
  return -1;
}

function toIntStrict(raw: string): number {
  const cleaned = raw.replace(/[¥,\s"]/g, "");
  if (cleaned === "") return 0;
  const n = Number.parseInt(cleaned, 10);
  return Number.isFinite(n) ? n : 0;
}

export function parseAffiliateCsv(
  csv: string,
  opts: { date: string; defaultTrackingId?: string },
): SalesRow[] {
  const lines = csv
    .split(/\r?\n/)
    .filter((l) => l.replace(/[\s　]/g, "").length > 0);
  if (lines.length < 2) return [];

  const header = splitCsvLine(lines[0]);
  const iItemCode = findIndex(header, HEADER_ALIASES.itemCode);
  const iClicks = findIndex(header, HEADER_ALIASES.clicks);
  const iOrders = findIndex(header, HEADER_ALIASES.orders);
  const iReward = findIndex(header, HEADER_ALIASES.reward);
  const iTracking = findIndex(header, HEADER_ALIASES.trackingId);

  if (iItemCode < 0) throw new Error("商品コード列が見つかりません");
  if (iClicks < 0) throw new Error("クリック数列が見つかりません");
  if (iOrders < 0) throw new Error("成果件数列が見つかりません");
  if (iReward < 0) throw new Error("報酬額列が見つかりません");

  const defaultTid = opts.defaultTrackingId ?? "";

  const rows: SalesRow[] = [];
  for (let li = 1; li < lines.length; li++) {
    const cols = splitCsvLine(lines[li]);
    const itemCode = (cols[iItemCode] ?? "").trim();
    if (!itemCode) continue;
    const trackingId =
      iTracking >= 0 && cols[iTracking]?.trim() ? cols[iTracking].trim() : defaultTid;
    rows.push({
      date: opts.date,
      itemCode,
      trackingId,
      clicks: toIntStrict(cols[iClicks] ?? "0"),
      orders: toIntStrict(cols[iOrders] ?? "0"),
      reward: toIntStrict(cols[iReward] ?? "0"),
    });
  }
  return rows;
}
