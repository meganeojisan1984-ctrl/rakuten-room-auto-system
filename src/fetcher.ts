import axios from "axios";
import * as dotenv from "dotenv";
dotenv.config();

const RAKUTEN_APP_ID = process.env.RAKUTEN_APP_ID ?? "";
const RAKUTEN_ACCESS_KEY = process.env.RAKUTEN_ACCESS_KEY ?? "";
const MAX_PRICE = parseInt(process.env.MAX_PRICE ?? "5000", 10);
const MIN_PRICE = parseInt(process.env.MIN_PRICE ?? "1000", 10);
const TARGET_GENRE = process.env.TARGET_GENRE ?? "general";

// メインジャンル: QOLが向上する家事用品（投稿の6〜7割）
// 条件: 商品数多い・注目度高い・悩みが明確・消耗品&買い替え需要あり
const MAIN_GENRES = [
  { name: "日用品雑貨・掃除・洗濯用品", genreId: "215684", minPrice: 1000, maxPrice: 5000 },
  { name: "整理収納・片付けグッズ", genreId: "215697", minPrice: 1000, maxPrice: 5000 },
  { name: "掃除用品・消耗品", genreId: "215684", minPrice: 1000, maxPrice: 5000 },
  { name: "洗濯・衣類ケアグッズ", genreId: "215684", minPrice: 1000, maxPrice: 5000 },
  { name: "キッチン消耗品・日用品", genreId: "216129", minPrice: 1000, maxPrice: 5000 },
  { name: "バス・トイレ用品", genreId: "215684", minPrice: 1000, maxPrice: 5000 },
  { name: "家事効率化グッズ", genreId: "215684", minPrice: 1000, maxPrice: 5000 },
];

// サブジャンル: メインジャンル関連・同悩みの延長・使用シーン重複
const SUB_GENRES = [
  { name: "ハイエンド・スタイリッシュ家電", genreId: "215783", minPrice: 1000, maxPrice: 5000 },
  { name: "時短ガジェット・小型家電", genreId: "215783", minPrice: 1000, maxPrice: 5000 },
  { name: "キッチン便利グッズ・調理器具", genreId: "216129", minPrice: 1000, maxPrice: 5000 },
  { name: "生活必需品・補充消耗品", genreId: "215684", minPrice: 1000, maxPrice: 5000 },
  { name: "省エネ・節約家電小物", genreId: "215783", minPrice: 1000, maxPrice: 5000 },
];

// ジャンルID設定（後方互換）
const GENRE_IDS: Record<string, string> = {
  general: "",
  furusato: process.env.GENRE_ID_FURUSATO ?? "553066",
  electronics: process.env.GENRE_ID_ELECTRONICS ?? "215783",
  "1000yen": "",
};

// ジャンル別価格設定（デフォルトは1000〜3000円）
const GENRE_PRICE_OVERRIDES: Record<string, { min: number; max: number }> = {
  "1000yen": { min: 900, max: 1100 },
  furusato: { min: 2000, max: 30000 },
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
  reviewAverage?: number;
  reviewCount?: number;
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
  reviewAverage?: number;
  reviewCount?: number;
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

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * 楽天ランキングAPIから商品を取得（1ページ分）
 * - 429: 60秒待機して1回だけ再試行
 * - 404/400: 空配列を返す（呼び出し側でフォールバック）
 */
async function fetchRankingPage(genreId: string | undefined, page: number): Promise<RakutenItem[]> {
  const params: Record<string, string | number> = {
    applicationId: RAKUTEN_APP_ID,
    accessKey: RAKUTEN_ACCESS_KEY,
    formatVersion: 2,
    hits: 30,
    page,
  };
  if (genreId) params.genreId = genreId;

  console.log(`[fetcher] ランキングAPI取得中 (ジャンルID: ${genreId || "全体"}, page: ${page})`);

  const endpoint = "https://openapi.rakuten.co.jp/ichibaranking/api/IchibaItem/Ranking/20220601";
  const headers = { Referer: "https://github.com", Origin: "https://github.com" };

  try {
    const response = await axios.get<{ Items: Array<RakutenRankingApiItem> }>(endpoint, {
      params,
      timeout: 15000,
      headers,
    });
    return convertRankingItems(response.data.Items ?? []);
  } catch (err: unknown) {
    const status = (err as { response?: { status?: number } })?.response?.status;
    if (status === 429) {
      console.warn("[fetcher] 楽天API レート制限 (429)、60秒待機して再試行...");
      await sleep(60000);
      const retry = await axios.get<{ Items: Array<RakutenRankingApiItem> }>(endpoint, {
        params,
        timeout: 15000,
        headers,
      });
      return convertRankingItems(retry.data.Items ?? []);
    }
    if (status === 404 || status === 400) {
      console.warn(`[fetcher] ランキング取得失敗 (${status}, genreId=${genreId || "全体"}, page=${page})`);
      return [];
    }
    throw err;
  }
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
      reviewAverage: item.reviewAverage,
      reviewCount: item.reviewCount,
    };
  });
}

/**
 * トレンドキーワードで楽天商品を検索
 * レビュー評価4.0以上・10件以上でフィルタリング
 */
export async function fetchItemsByKeyword(
  keyword: string,
  count: number = 3,
  excludeCodes: Set<string> = new Set()
): Promise<RakutenItem[]> {
  if (!RAKUTEN_APP_ID) {
    throw new Error("RAKUTEN_APP_ID が未設定です");
  }

  const params: Record<string, string | number> = {
    applicationId: RAKUTEN_APP_ID,
    formatVersion: 2,
    hits: 30,
    sort: "-reviewCount",
    keyword,
    availability: 1,
    maxPrice: 10000,
    minPrice: MIN_PRICE,
  };

  console.log(`[fetcher] キーワード検索中: 「${keyword}」`);

  let rawItems: RakutenApiItem[];
  try {
    const response = await axios.get<{ Items: Array<{ Item: RakutenApiItem }> }>(
      "https://openapi.rakuten.co.jp/ichibams/api/IchibaItem/Search/20220601",
      {
        params,
        timeout: 15000,
        headers: { Referer: "https://github.com", Origin: "https://github.com" },
      }
    );
    rawItems = response.data.Items.map((i) => i.Item);
  } catch (err) {
    throw new Error(`楽天キーワード検索エラー: ${String(err)}`);
  }

  const converted = convertSearchItems(rawItems);

  const filtered = converted.filter((item) => {
    if (item.availability !== 1) return false;
    if (item.endTime && new Date(item.endTime) < new Date()) return false;
    if (item.itemPrice > 10000) return false;
    if (item.itemPrice < MIN_PRICE) return false;
    // レビュー品質フィルタ（口コミ実績がある商品を優先）
    if ((item.reviewAverage ?? 0) < 4.0) return false;
    if ((item.reviewCount ?? 0) < 10) return false;
    if (excludeCodes.has(item.itemCode)) return false;
    return true;
  });

  // レビュー評価の高い順にソート
  filtered.sort((a, b) => {
    const scoreA = (a.reviewAverage ?? 0) * Math.log10(Math.max(a.reviewCount ?? 1, 10));
    const scoreB = (b.reviewAverage ?? 0) * Math.log10(Math.max(b.reviewCount ?? 1, 10));
    return scoreB - scoreA;
  });

  console.log(`[fetcher] キーワード検索: ${filtered.length}件 (フィルタ後), ${count}件を使用`);
  return filtered.slice(0, count);
}

interface FilterOpts {
  minPrice?: number;
  maxPrice: number;
  excludeCodes: Set<string>;
}

function applyItemFilter(items: RakutenItem[], opts: FilterOpts): RakutenItem[] {
  return items.filter((item) => {
    if (item.availability !== 1) return false;
    if (item.endTime && new Date(item.endTime) < new Date()) return false;
    if (item.itemPrice > opts.maxPrice) return false;
    if (opts.minPrice !== undefined && item.itemPrice < opts.minPrice) return false;
    if (opts.excludeCodes.has(item.itemCode)) return false;
    return true;
  });
}

function sortByBonus(a: RakutenItem, b: RakutenItem): number {
  const scoreA = (a.hasPointBonus ? 2 : 0) + (a.hasCoupon ? 1 : 0);
  const scoreB = (b.hasPointBonus ? 2 : 0) + (b.hasCoupon ? 1 : 0);
  return scoreB - scoreA;
}

/**
 * ターゲットジャンルに基づき商品を取得・フィルタリングして返す
 *
 * 商品確保のための多段フォールバック:
 *   Stage1: 選択ジャンルの page 1〜3
 *   Stage2: 他のMAIN/SUBジャンル（page 1）を順に試行
 *   Stage3: 全体ランキング（genreIdなし, page 1）
 *   Stage4: 収集済み商品に対して価格レンジを段階緩和
 *   Stage5: excludeCodes を無視して最終フォールバック
 */
export async function fetchItems(count: number = 5, excludeCodes: Set<string> = new Set()): Promise<RakutenItem[]> {
  if (!RAKUTEN_APP_ID) {
    throw new Error("RAKUTEN_APP_ID が未設定です");
  }

  // 1000yenモードは従来どおりキーワード検索
  if (TARGET_GENRE === "1000yen") {
    const priceOverride = GENRE_PRICE_OVERRIDES["1000yen"]!;
    const raw = await fetchItemSearch("1000円ポッキリ 送料無料", priceOverride.min, priceOverride.max);
    const filtered = applyItemFilter(raw, {
      minPrice: priceOverride.min,
      maxPrice: priceOverride.max,
      excludeCodes,
    });
    filtered.sort(sortByBonus);
    console.log(`[fetcher] ${filtered.length}件の商品を取得 (フィルタ後), ${count}件を使用`);
    return filtered.slice(0, count);
  }

  // ジャンル・価格帯の選択
  let primaryGenreId: string | undefined;
  let primaryMinPrice: number;
  let primaryMaxPrice: number;
  if (TARGET_GENRE === "general" || !TARGET_GENRE) {
    const useMain = Math.random() < 0.65;
    const pool = useMain ? MAIN_GENRES : SUB_GENRES;
    const selected = pool[Math.floor(Math.random() * pool.length)]!;
    primaryGenreId = selected.genreId;
    primaryMinPrice = selected.minPrice;
    primaryMaxPrice = selected.maxPrice;
    console.log(`[fetcher] ジャンル選択: ${useMain ? "メイン" : "サブ"}: ${selected.name}`);
  } else {
    const priceOverride = GENRE_PRICE_OVERRIDES[TARGET_GENRE];
    primaryMinPrice = priceOverride?.min ?? MIN_PRICE;
    primaryMaxPrice = priceOverride?.max ?? MAX_PRICE;
    primaryGenreId = GENRE_IDS[TARGET_GENRE] || undefined;
  }

  // 収集した商品を itemCode で重複排除しながら保持
  const collected = new Map<string, RakutenItem>();
  const addItems = (items: RakutenItem[]): void => {
    for (const item of items) {
      if (!collected.has(item.itemCode)) collected.set(item.itemCode, item);
    }
  };
  const filterAll = (opts: FilterOpts): RakutenItem[] => applyItemFilter([...collected.values()], opts);
  const finalize = (items: RakutenItem[], stage: string): RakutenItem[] => {
    items.sort(sortByBonus);
    console.log(`[fetcher] ${stage}: ${items.length}件の商品を取得 (フィルタ後), ${count}件を使用`);
    return items.slice(0, count);
  };

  const primaryFilter: FilterOpts = {
    minPrice: primaryMinPrice,
    maxPrice: primaryMaxPrice,
    excludeCodes,
  };

  // Stage 1: 選択ジャンルの page 1〜3
  for (let page = 1; page <= 3; page++) {
    if (page > 1) await sleep(1100); // レート制限対策 (1req/sec)
    try {
      addItems(await fetchRankingPage(primaryGenreId, page));
    } catch (err) {
      console.warn(`[fetcher] Stage1 page${page} エラー: ${String(err)}`);
    }
    const hit = filterAll(primaryFilter);
    if (hit.length >= count) return finalize(hit, `Stage1 page${page}`);
  }

  // Stage 2: 他のMAIN/SUBジャンルを順に試行
  const otherGenres = [...MAIN_GENRES, ...SUB_GENRES].filter((g) => g.genreId !== primaryGenreId);
  for (const g of otherGenres) {
    await sleep(1100);
    try {
      addItems(await fetchRankingPage(g.genreId, 1));
    } catch (err) {
      console.warn(`[fetcher] Stage2 ${g.name} エラー: ${String(err)}`);
      continue;
    }
    const hit = filterAll(primaryFilter);
    if (hit.length >= count) return finalize(hit, `Stage2 ${g.name}`);
  }

  // Stage 3: 全体ランキング
  await sleep(1100);
  try {
    addItems(await fetchRankingPage(undefined, 1));
  } catch (err) {
    console.warn(`[fetcher] Stage3 全体ランキングエラー: ${String(err)}`);
  }
  const stage3 = filterAll(primaryFilter);
  if (stage3.length >= count) return finalize(stage3, "Stage3 全体");

  // Stage 4: 価格レンジ緩和（収集済みデータに対して再フィルタ）
  const priceFallbacks: FilterOpts[] = [
    { minPrice: primaryMinPrice, maxPrice: 8000, excludeCodes },
    { minPrice: 500, maxPrice: 10000, excludeCodes },
    { minPrice: 0, maxPrice: Number.MAX_SAFE_INTEGER, excludeCodes },
  ];
  for (const pf of priceFallbacks) {
    const hit = filterAll(pf);
    if (hit.length >= count) return finalize(hit, `Stage4 価格緩和(${pf.minPrice}〜${pf.maxPrice})`);
  }

  // Stage 5: excludeCodes を無視（重複投稿のリスクを許容して空振り回避）
  const stage5 = filterAll({
    minPrice: 0,
    maxPrice: Number.MAX_SAFE_INTEGER,
    excludeCodes: new Set(),
  });
  if (stage5.length > 0) {
    console.warn("[fetcher] Stage5: excludeCodesを無視して返却（重複投稿の可能性あり）");
    return finalize(stage5, "Stage5 既投稿除外を無視");
  }

  throw new Error("全段階のフォールバックを試行しましたが商品が取得できませんでした");
}
