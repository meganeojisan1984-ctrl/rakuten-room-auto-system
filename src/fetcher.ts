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

/**
 * 楽天ランキングAPIから商品を取得
 */
async function fetchRanking(genreId?: string, page: number = 1): Promise<RakutenItem[]> {
  const params: Record<string, string | number> = {
    applicationId: RAKUTEN_APP_ID,
    accessKey: RAKUTEN_ACCESS_KEY,
    formatVersion: 2,
    hits: 30,
    page,
  };
  if (genreId) params.genreId = genreId;

  console.log(`[fetcher] ランキングAPI取得中 (ジャンルID: ${genreId || "全体"}, page: ${page})`);

  try {
    const response = await axios.get<{
      Items: Array<RakutenRankingApiItem>;
    }>("https://openapi.rakuten.co.jp/ichibaranking/api/IchibaItem/Ranking/20220601", {
      params,
      timeout: 15000,
      headers: { Referer: "https://github.com", Origin: "https://github.com" },
    });

    const items = response.data.Items ?? [];
    return convertRankingItems(items);
  } catch (err: unknown) {
    const status = (err as { response?: { status?: number } })?.response?.status;
    if (status === 429) {
      console.warn("[fetcher] 楽天API レート制限 (429)、60秒待機して再試行...");
      await new Promise((r) => setTimeout(r, 60000));
      const retry = await axios.get<{ Items: Array<RakutenRankingApiItem> }>(
        "https://openapi.rakuten.co.jp/ichibaranking/api/IchibaItem/Ranking/20220601",
        { params, timeout: 15000, headers: { Referer: "https://github.com", Origin: "https://github.com" } }
      );
      return convertRankingItems(retry.data.Items ?? []);
    }
    if (genreId && (status === 404 || status === 400)) {
      console.warn(`[fetcher] ジャンルID ${genreId} が無効 (${status})、全体ランキングで再試行`);
      delete params.genreId;
      const fallback = await axios.get<{ Items: Array<RakutenRankingApiItem> }>(
        "https://openapi.rakuten.co.jp/ichibaranking/api/IchibaItem/Ranking/20220601",
        { params, timeout: 15000, headers: { Referer: "https://github.com", Origin: "https://github.com" } }
      );
      return convertRankingItems(fallback.data.Items ?? []);
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

/**
 * 商品一覧にフィルタを適用し、理由別内訳ログと共にフィルタ結果を返す
 */
function applyItemFilter(
  rawItems: RakutenItem[],
  minPrice: number | undefined,
  maxPrice: number,
  excludeCodes: Set<string>,
  label: string
): RakutenItem[] {
  const stats = {
    unavailable: 0,
    expired: 0,
    overMax: 0,
    underMin: 0,
    alreadyPosted: 0,
    passed: 0,
  };
  const now = new Date();

  const filtered = rawItems.filter((item) => {
    if (item.availability !== 1) {
      stats.unavailable++;
      return false;
    }
    if (item.endTime && new Date(item.endTime) < now) {
      stats.expired++;
      return false;
    }
    if (item.itemPrice > maxPrice) {
      stats.overMax++;
      return false;
    }
    if (minPrice !== undefined && item.itemPrice < minPrice) {
      stats.underMin++;
      return false;
    }
    if (excludeCodes.has(item.itemCode)) {
      stats.alreadyPosted++;
      return false;
    }
    stats.passed++;
    return true;
  });

  console.log(
    `[fetcher] フィルタ内訳 [${label}] raw=${rawItems.length}, 通過=${stats.passed}, ` +
      `販売停止=${stats.unavailable}, 期限切=${stats.expired}, 価格>${maxPrice}=${stats.overMax}, ` +
      `価格<${minPrice ?? "-"}=${stats.underMin}, 投稿済=${stats.alreadyPosted}`
  );

  return filtered;
}

/**
 * ランキングをフォールバック順に試行し、最初に非空となった候補を返す
 * 1. 指定ジャンル page1
 * 2. 指定ジャンル page2
 * 3. 他のジャンルを順番に試行 (page1)
 * 4. 全体ランキング (ジャンル指定なし) page1
 * 5. 全体ランキング page2
 * それでも0件なら、最後の試行で価格帯を緩和して再フィルタ
 */
async function fetchRankingWithFallback(
  primaryGenreId: string | undefined,
  primaryGenreName: string,
  minPrice: number | undefined,
  maxPrice: number,
  excludeCodes: Set<string>
): Promise<RakutenItem[]> {
  // フォールバック用のジャンル候補: メイン+サブをマージし重複ジャンルIDを除去
  const alternativeGenres = [...MAIN_GENRES, ...SUB_GENRES].filter(
    (g) => g.genreId !== primaryGenreId
  );
  const seenGenres = new Set<string>();
  const uniqueAlternatives = alternativeGenres.filter((g) => {
    if (seenGenres.has(g.genreId)) return false;
    seenGenres.add(g.genreId);
    return true;
  });

  type Attempt = { label: string; genreId?: string; page: number };
  const attempts: Attempt[] = [
    { label: `${primaryGenreName} p1`, genreId: primaryGenreId, page: 1 },
    { label: `${primaryGenreName} p2`, genreId: primaryGenreId, page: 2 },
    ...uniqueAlternatives.map((g) => ({
      label: `代替ジャンル: ${g.name} p1`,
      genreId: g.genreId,
      page: 1,
    })),
    { label: "全体ランキング p1", genreId: undefined, page: 1 },
    { label: "全体ランキング p2", genreId: undefined, page: 2 },
  ];

  let lastRawItems: RakutenItem[] = [];

  for (const attempt of attempts) {
    let rawItems: RakutenItem[];
    try {
      rawItems = await fetchRanking(attempt.genreId, attempt.page);
    } catch (err) {
      console.warn(`[fetcher] ${attempt.label} 取得失敗: ${String(err)}`);
      continue;
    }
    lastRawItems = rawItems;
    const filtered = applyItemFilter(rawItems, minPrice, maxPrice, excludeCodes, attempt.label);
    if (filtered.length > 0) return filtered;
  }

  // 全試行が0件なら、最後に取得したitemsに対して価格帯を緩和して再フィルタ
  if (lastRawItems.length > 0) {
    const relaxedMin = minPrice !== undefined ? Math.max(500, Math.floor(minPrice / 2)) : undefined;
    const relaxedMax = Math.min(10000, maxPrice * 2);
    console.warn(
      `[fetcher] 全試行0件。価格帯を緩和して再フィルタ (${relaxedMin ?? "-"}〜${relaxedMax}円)`
    );
    const relaxed = applyItemFilter(
      lastRawItems,
      relaxedMin,
      relaxedMax,
      excludeCodes,
      "価格緩和"
    );
    if (relaxed.length > 0) return relaxed;
  }

  return [];
}

/**
 * ターゲットジャンルに基づき商品を取得・フィルタリングして返す
 */
export async function fetchItems(count: number = 5, excludeCodes: Set<string> = new Set()): Promise<RakutenItem[]> {
  if (!RAKUTEN_APP_ID) {
    throw new Error("RAKUTEN_APP_ID が未設定です");
  }

  let maxPrice = MAX_PRICE;
  let minPrice: number | undefined;
  let genreId: string | undefined;
  let selectedGenreName = "全体";

  // generalの場合はメイン(6〜7割)/サブ(3〜4割)ジャンルからランダム選択
  if (TARGET_GENRE === "general" || !TARGET_GENRE) {
    // メインを6〜7割、サブを3〜4割の比率で選択
    const useMain = Math.random() < 0.65;
    const pool = useMain ? MAIN_GENRES : SUB_GENRES;
    const selected = pool[Math.floor(Math.random() * pool.length)]!;
    genreId = selected.genreId;
    minPrice = selected.minPrice;
    maxPrice = selected.maxPrice;
    selectedGenreName = `${useMain ? "メイン" : "サブ"}: ${selected.name}`;
    console.log(`[fetcher] ジャンル選択: ${selectedGenreName}`);
  } else {
    const priceOverride = GENRE_PRICE_OVERRIDES[TARGET_GENRE];
    minPrice = priceOverride?.min ?? MIN_PRICE;
    maxPrice = priceOverride?.max ?? MAX_PRICE;
    genreId = GENRE_IDS[TARGET_GENRE] || undefined;
  }

  let filtered: RakutenItem[];
  try {
    if (TARGET_GENRE === "1000yen") {
      const rawItems = await fetchItemSearch("1000円ポッキリ 送料無料", minPrice, maxPrice);
      filtered = applyItemFilter(rawItems, minPrice, maxPrice, excludeCodes, "1000円ポッキリ");
    } else {
      filtered = await fetchRankingWithFallback(
        genreId,
        selectedGenreName,
        minPrice,
        maxPrice,
        excludeCodes
      );
    }
  } catch (err) {
    throw new Error(`楽天APIエラー: ${String(err)}`);
  }

  // ポイントアップ・クーポン情報ありを優先ソート
  filtered.sort((a, b) => {
    const scoreA = (a.hasPointBonus ? 2 : 0) + (a.hasCoupon ? 1 : 0);
    const scoreB = (b.hasPointBonus ? 2 : 0) + (b.hasCoupon ? 1 : 0);
    return scoreB - scoreA;
  });

  console.log(`[fetcher] ${filtered.length}件の商品を取得 (フィルタ後), ${count}件を使用`);
  return filtered.slice(0, count);
}
