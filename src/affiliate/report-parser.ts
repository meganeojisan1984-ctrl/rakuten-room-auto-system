import * as crypto from "crypto";
import type { SalesRow } from "./sales-db";

/**
 * 楽天アフィリエイト「注文別成果」CSV を SalesRow[] に変換する。
 *
 * CSV 実物の形（2026-07 実行時に確認済み）:
 *   1行目 : "注文別成果: 2026.07"（タイトル）
 *   2-9行目: 空行 + ステータス/リンクタイプ/デバイスタイプの凡例（ヘッダ+3-5行）
 *   その後 : 空行
 *   ヘッダ行 (日本語): 発生日,成果報酬,料率,売上金額,ジャンル名,ショップ名,商品名,ステータス,リンクタイプ,デバイスタイプ,計測ID
 *   ヘッダ行 (英語)  : date,rewards,rate,amount,genre_name,shop_name,item_name,status,link_type,device_type,measurement_id
 *   データ行         : "2026-07-04 21:54:33",93,3.0,3132,...
 *
 * SalesRow への集約:
 *   - 1注文 = 1行 なので (発生日 YYYY-MM-DD, itemCode, trackingId) で GROUP BY
 *   - itemCode は CSV に含まれないため sha1(shop_name|item_name) の頭12桁を採用（安定・衝突現実的に無視可）
 *   - trackingId は「計測ID」列（未設定なら opts.defaultTrackingId）
 *   - clicks はこの CSV には無いため 0（Phase 2/3 で 期間別レポート と JOIN して補完）
 *   - orders は行数、reward は 成果報酬 の合計
 */
export function parseOrderCsv(
  csv: string,
  opts: { defaultTrackingId?: string; targetDate?: string } = {},
): SalesRow[] {
  const lines = csv.replace(/^﻿/, "").split(/\r?\n/);
  const headerIdx = lines.findIndex((l) => /^\s*date,rewards,rate,amount/.test(l));
  if (headerIdx < 0) {
    throw new Error("英語ヘッダ行 (date,rewards,...) が見つかりません");
  }
  const dataLines = lines.slice(headerIdx + 1).filter((l) => l.trim().length > 0);
  const defaultTid = opts.defaultTrackingId ?? "";

  type Key = string;
  const groups = new Map<Key, SalesRow>();

  for (const line of dataLines) {
    const cols = splitCsvLine(line);
    if (cols.length < 11) continue;
    const timestamp = stripQuotes(cols[0]).trim();
    if (!timestamp) continue;
    const date = timestamp.slice(0, 10); // "YYYY-MM-DD"
    if (opts.targetDate && date !== opts.targetDate) continue;

    const reward = toIntStrict(cols[1]);
    const shopName = stripQuotes(cols[5]);
    const itemName = stripQuotes(cols[6]);
    const measurementId = stripQuotes(cols[10]);
    const trackingId = measurementId || defaultTid;

    const itemCode = deriveItemCode(shopName, itemName);
    const key = `${date}|${itemCode}|${trackingId}`;

    const cur = groups.get(key);
    if (cur) {
      cur.orders += 1;
      cur.reward += reward;
    } else {
      groups.set(key, {
        date,
        itemCode,
        trackingId,
        clicks: 0,
        orders: 1,
        reward,
      });
    }
  }

  return Array.from(groups.values()).sort((a, b) =>
    a.date === b.date ? a.itemCode.localeCompare(b.itemCode) : a.date.localeCompare(b.date),
  );
}

/** 1行を CSV としてトークン分割（ダブルクォート内のカンマ保護）。 */
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
  return out;
}

function stripQuotes(s: string | undefined): string {
  if (!s) return "";
  return s.replace(/^"|"$/g, "");
}

function toIntStrict(raw: string | undefined): number {
  if (!raw) return 0;
  const cleaned = raw.replace(/[¥,\s"]/g, "");
  if (cleaned === "") return 0;
  const n = Number.parseInt(cleaned, 10);
  return Number.isFinite(n) ? n : 0;
}

/** shop_name + item_name から安定 12桁 itemCode を導出。 */
export function deriveItemCode(shopName: string, itemName: string): string {
  const src = `${shopName || ""}|${itemName || ""}`;
  return crypto.createHash("sha1").update(src, "utf8").digest("hex").slice(0, 12);
}
