import axios from "axios";
import * as dotenv from "dotenv";
dotenv.config();

const RAKUTEN_APP_ID = process.env.RAKUTEN_APP_ID ?? "";
const RAKUTEN_ACCESS_KEY = process.env.RAKUTEN_ACCESS_KEY ?? "";
const MAX_PRICE = parseInt(process.env.MAX_PRICE ?? "10000", 10);
const TARGET_GENRE = process.env.TARGET_GENRE ?? "general";

// ジャンルID設定
const GENRE_IDS: Record<string, string> = {
  general: process.env.GENRE_ID_GENERAL ?? "",
  furusato: process.env.GENRE_ID_FURUSATO ?? "553066",
  electronics: process.env.GENRE_ID_ELECTRONICS ?? "215783",
  "1000yen": "",
};

// 1000円ポッキリの価格設定
const GENRE_PRICE_OVERRIDES: Record<string, { min: number; max: number }> = {
  "1000yen": { min: 900, max: 1100 },
  furusato: { min: 1000, max: 100000 },
};

export interface RakutenItem {
  itemName: string;
  itemCode: string;
  itemPrice: number;
  itemUrl: string;
  itemCaption: string;
  imageUrl: string;
  shopName: string;
  pointRate: number;
  pointRateStartTime?: string;
  pointRateEndTime?: string;
  hasCoupon: boolean;
  hasPointBonus: boolean;
  availability: number; // 1=販売中, 0=販売停止
  endTime?: string;
}

interface RakutenApiItem {
  itemName: string;
  itemCode: string;
  itemPrice: number;
  itemUrl: string;
  itemCaption: string;
  mediumImageUrls: Array<{ imageUrl: string }>;
  shopName: string;
  pointRate: number;
  pointRateStartTime: string;
  pointRateEndTime: string;
  availability: number;
  endTime: string;
}

interface RakutenRankingApiItem {
  rank: number;
  carrier: number;
  itemName: string;
  catchcopy: string;
  itemCode: string;
  itemPrice: number;
  itemCaption: string;
  itemUrl: string;
  affiliateUrl: string;
  imageFlag: number;
  smallImageUrls: Array<{ imageUrl: string }>;
  mediumImageUrls: Array<{ imageUrl: string }>;
  availability: number;
  taxFlag: number;
  postageFlag: number;
  creditCardFlag: number;
  shopOfTheYearFlag: number;
  shipOverseasFlag: number;
  shipOverseasArea: string;
  asurakuFlag: number;
  asurakuClosingTime: string;
  asurakuArea: string;
  affiliateRate: number;
  startTime: string;
  endTime: string;
  reviewCount: number;
  reviewAverage: number;
  pointRate: number;
  pointRateStartTime: string;
  pointRateEndTime: string;
  shopName: string;
  shopCode: string;
  shopUrl: string;
  genreId: string;
  tagIds: number[];
}

/**
 * 商品が販売可能かバリデーション
 */
function isAvailable(item: RakutenRankingApiItem | RakutenApiItem): boolean {
  // availability: 1=販売中, 0=取り扱い停止
  if (item.availability !== 1) return false;
  // 販売期間終了チェック
  if (item.endTime) {
    const endTime = new Date(item.endTime);
    if (endTime < new Date()) return false;
  }
  return true;
}

/**
 * ポイントアップ・クーポン情報を検知してフラグ付け
 */
function detectBonusInfo(item: RakutenRankingApiItem | RakutenApiItem): {
  hasPointBonus: boolean;
  hasCoupon: boolean;
} {
  const hasPointBonus = item.pointRate > 1; // 通常ポイント率(1倍)より高い
  // クーポン情報はキャプションや商品名に含まれるキーワードで検知
  const couponKeywords = ["クーポン", "coupon", "割引", "OFF", "off", "円引き"];
  const searchText = `${item.itemName} ${item.itemCaption}`;
  const hasCoupon = couponKeywords.some((kw) =>
    searchText.toLowerCase().includes(kw.toLowerCase())
  );
  return { hasPointBonus, hasCoupon };
}

/**
 * 楽天ランキングAPIから商品を取得
 */
async function fetchRanking(genreId?: string): Promise<RakutenItem[]> {
  const params: Record<string, string | number> = {
    applicationId: RAKUTEN_APP_ID,
    accessKey: RAKUTEN_ACCESS_KEY,
    formatVersion: 2,
    hits: 30,
    page: 1,
  };
  if (genreId) params.genreId = genreId;

  console.log(`[fetcher] ランキングAPI取得中 (ジャンルID: ${genreId || "全体"})`);

  const response = await axios.get<{
    Items: Array<RakutenRankingApiItem>;
  }>("https://openapi.rakuten.co.jp/ichibaranking/api/IchibaItem/Ranking/20220601", {
    params,
    timeout: 15000,
    headers: { Referer: "https://github.com", Origin: "https://github.com" },
  });

  const items = response.data.Items ?? [];
  return convertRankingItems(items);
}

/**
 * 楽天アイテム検索APIから「1000円ポッキリ」商品を取得
 */
async function fetchItemSearch(keyword: string, minPrice?: number, maxPrice?: number, genreId?: string): Promise<RakutenItem[]> {
  const params: Record<string, string | number> = {
    applicationId: RAKUTEN_APP_ID,
    accessKey: RAKUTEN_ACCESS_KEY,
    formatVersion: 2,
    hits: 30,
    sort: "-reviewCount",
    keyword,
  };
  if (minPrice !== undefined) params.minPrice = minPrice;
  if (maxPrice !== undefined) params.maxPrice = maxPrice;
  if (genreId) params.genreId = genreId;

  console.log(`[fetcher] アイテム検索API取得中 (キーワード: ${keyword})`);

  const response = await axios.get<{
    Items: Array<{ Item: RakutenApiItem }>;
  }>("https://openapi.rakuten.co.jp/ichibams/api/IchibaItem/Search/20220601", {
    params,
    timeout: 15000,
    headers: { Referer: "https://github.com", Origin: "https://github.com" },
  });

  const items = response.data.Items.map((i) => i.Item);
  return convertSearchItems(items);
}

function convertRankingItems(items: RakutenRankingApiItem[]): RakutenItem[] {
  return items.map((item) => {
    const { hasPointBonus, hasCoupon } = detectBonusInfo(item);
    return {
      itemName: item.itemName,
      itemCode: item.itemCode,
      itemPrice: typeof item.itemPrice === "string" ? parseInt(item.itemPrice, 10) : item.itemPrice,
      itemUrl: item.itemUrl,
      itemCaption: item.itemCaption ?? "",
      imageUrl: item.mediumImageUrls?.[0]?.imageUrl ?? "",
      shopName: item.shopName ?? "",
      pointRate: item.pointRate ?? 1,
      pointRateStartTime: item.pointRateStartTime || undefined,
      pointRateEndTime: item.pointRateEndTime || undefined,
      hasCoupon,
      hasPointBonus,
      availability: item.availability ?? 1,
      endTime: item.endTime || undefined,
    };
  });
}

function convertSearchItems(items: RakutenApiItem[]): RakutenItem[] {
  return items.map((item) => {
    const { hasPointBonus, hasCoupon } = detectBonusInfo(item);
    return {
      itemName: item.itemName,
      itemCode: item.itemCode,
      itemPrice: item.itemPrice,
      itemUrl: item.itemUrl,
      itemCaption: item.itemCaption,
      imageUrl: item.mediumImageUrls[0]?.imageUrl ?? "",
      shopName: item.shopName,
      pointRate: item.pointRate,
      pointRateStartTime: item.pointRateStartTime || undefined,
      pointRateEndTime: item.pointRateEndTime || undefined,
      hasCoupon,
      hasPointBonus,
      availability: item.availability,
      endTime: item.endTime || undefined,
    };
  });
}

/**
 * ターゲットジャンルに基づき商品を取得・フィルタリングして返す
 */
export async function fetchItems(count: number = 5): Promise<RakutenItem[]> {
  if (!RAKUTEN_APP_ID) {
    throw new Error("RAKUTEN_APP_ID が未設定です");
  }

  let rawItems: RakutenItem[] = [];
  const priceOverride = GENRE_PRICE_OVERRIDES[TARGET_GENRE];
  const minPrice = priceOverride?.min;
  const maxPrice = priceOverride?.max ?? MAX_PRICE;
  const genreId = GENRE_IDS[TARGET_GENRE] || undefined;

  try {
    if (TARGET_GENRE === "1000yen") {
      rawItems = await fetchItemSearch("1000円ポッキリ 送料無料", minPrice, maxPrice);
    } else {
      rawItems = await fetchRanking(genreId);
    }
  } catch (err) {
    throw new Error(`楽天APIエラー: ${String(err)}`);
  }

  // フィルタリング
  let filtered = rawItems.filter((item) => {
    // 在庫チェック
    if (item.availability !== 1) return false;
    // 販売期間チェック
    if (item.endTime) {
      if (new Date(item.endTime) < new Date()) return false;
    }
    // 価格フィルタ（ふるさと納税は上限なし）
    if (TARGET_GENRE !== "furusato") {
      if (item.itemPrice > maxPrice) return false;
    }
    if (minPrice !== undefined && item.itemPrice < minPrice) return false;
    return true;
  });

  // ポイントアップ・クーポン情報ありを優先ソート
  filtered.sort((a, b) => {
    const scoreA = (a.hasPointBonus ? 2 : 0) + (a.hasCoupon ? 1 : 0);
    const scoreB = (b.hasPointBonus ? 2 : 0) + (b.hasCoupon ? 1 : 0);
    return scoreB - scoreA;
  });

  console.log(`[fetcher] ${filtered.length}件の商品を取得 (フィルタ後), ${count}件を使用`);
  return filtered.slice(0, count);
}
