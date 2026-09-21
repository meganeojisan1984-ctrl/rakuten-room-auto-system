import type { RakutenItem } from "../fetcher";

const PROMOTION_MARKERS = /要エントリー|エントリー|ポイント(?:アップ|バック|還元|倍)|\d+\s*時間限定|期間限定|おひとり様|限り|クーポン|セール|\bDEAL\b|タイムセール|お買い物マラソン|キャンペーン|\d+\s*%\s*OFF|割引/i;

function stripMarkup(value: string): string {
  return value
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(/<\/(?:p|div|li|tr|h[1-6])\s*>/gi, "\n")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'");
}

function isPromotionLabel(value: string): boolean {
  return PROMOTION_MARKERS.test(value);
}

/** Remove campaign and purchase-limit labels while keeping the listed product name. */
export function cleanProductDisplayName(value: string): string {
  return stripMarkup(value)
    .replace(/【[^】]*】|［[^］]*］|\[[^\]]*\]|（[^）]*）/g, (label) =>
      isPromotionLabel(label) ? " " : label,
    )
    .replace(/^\s*\d+(?:\.\d+)?\s*％?\s*ポイント(?:バック|還元|アップ|倍)\s*(?:[〜～~]\s*)?(?:\d{1,2}\/\d{1,2}(?:\([^)]*\))?\s*\d{1,2}:\d{2}まで)?/iu, " ")
    .replace(/^\s*ポイント\s*\d+\s*倍\s*/iu, " ")
    .replace(/\s+/g, " ")
    .replace(/^[\s|｜:：,，、!！・]+|[\s|｜:：,，、!！・]+$/g, "")
    .trim();
}

export function isSoftwareProduct(value: string): boolean {
  return /microsoft|office(?:\s|　|$)|ソフトウェア|アプリケーション|ライセンス/i.test(value);
}

/** Return short, non-promotional statements copied from the Rakuten description. */
export function extractProductFacts(value: string, limit = 5): string[] {
  const text = stripMarkup(value).replace(/\r/g, "\n");
  const pieces = text
    .split(/\n+|(?<=[。！？])\s*|[●■◆◇▶▷]/u)
    .flatMap((part) => part.split(/(?:^|\s)・/u));
  const facts: string[] = [];

  for (const piece of pieces) {
    const fact = piece
      .replace(/^[\s・●■◆◇※▶▷\-－]+/u, "")
      .replace(/^主な特徴\s*/u, "")
      .replace(/\s+/g, " ")
      .trim();
    if (fact.length < 6 || isPromotionLabel(fact) || /https?:\/\//i.test(fact) || /^(商品紹介|商品説明|主な特徴|商品名)[:：]?$/u.test(fact)) continue;
    if (!facts.includes(fact)) facts.push(fact);
    if (facts.length >= limit) break;
  }

  return facts;
}

export function buildVerifiedProductCaption(item: RakutenItem): string {
  const name = cleanProductDisplayName(item.itemName);
  const facts = extractProductFacts(item.itemCaption, 2);
  const lines = [name];
  lines.push(...facts);

  const price = Number(item.itemPrice);
  if (Number.isFinite(price) && price > 0) lines.push(`価格: ${Math.round(price).toLocaleString("ja-JP")}円`);

  const rating = Number(item.reviewAverage);
  const reviewCount = Number(item.reviewCount);
  if (Number.isFinite(rating) && rating > 0 && Number.isFinite(reviewCount) && reviewCount > 0) {
    const ratingText = rating.toLocaleString("ja-JP", { maximumFractionDigits: 2 });
    lines.push(`レビュー: ★${ratingText}・${Math.round(reviewCount).toLocaleString("ja-JP")}件`);
  }

  lines.push("仕様と最新の販売条件は商品ページでご確認ください。", "詳細はプロフィールの楽天ROOMから確認できます。", "#楽天ROOM #商品情報 #商品紹介");
  return lines.filter(Boolean).join("\n").slice(0, 2200);
}

