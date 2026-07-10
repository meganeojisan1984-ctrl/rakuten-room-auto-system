import axios from "axios";
import * as dotenv from "dotenv";
import { loadStrategy, weightedPick, PRICE_BANDS } from "./agents/store";
dotenv.config();

// 直近に選択されたジャンル名（学習ループの投稿履歴記録用）
let lastSelectedGenreName = "全体";
export function getLastSelectedGenre(): string {
  return lastSelectedGenreName;
}

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

// 検索APIフォールバック用キーワードプール (QOL家事系の文脈に合致)
// ランキングが枯れた時の無限供給源: 各キーワード×page 1-3 で最大~9000商品にアクセス可能
const SEARCH_FALLBACK_KEYWORDS = [
  "掃除 便利グッズ",
  "洗濯 便利",
  "キッチン 便利",
  "収納 アイデア",
  "生活雑貨 人気",
  "時短 家電",
  "トイレ 掃除",
  "お風呂 グッズ",
  "消耗品 まとめ買い",
  "日用品 セット",
  "ランドリー 収納",
  "玄関 収納",
  "隙間 収納",
  "水回り 掃除",
  "スポンジ 洗剤",
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
  affiliateRate?: number;
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
 * 楽天アイテム検索APIで商品を取得 (キーワード+ページ指定)
 */
async function fetchItemSearch(
  keyword: string,
  minPrice?: number,
  maxPrice?: number,
  genreId?: string,
  page: number = 1
): Promise<RakutenItem[]> {
  const params: Record<string, string | number> = {
    applicationId: RAKUTEN_APP_ID,
    accessKey: RAKUTEN_ACCESS_KEY,
    formatVersion: 2,
    hits: 30,
    page,
    sort: "-reviewCount",
    keyword,
    availability: 1,
  };
  if (minPrice !== undefined) params.minPrice = minPrice;
  if (maxPrice !== undefined) params.maxPrice = maxPrice;
  if (genreId) params.genreId = genreId;

  console.log(`[fetcher] アイテム検索API取得中 (キーワード: ${keyword}, page: ${page})`);

  try {
    const response = await axios.get<{
      Items: Array<{ Item: RakutenApiItem }>;
    }>("https://openapi.rakuten.co.jp/ichibams/api/IchibaItem/Search/20220601", {
      params,
      timeout: 15000,
      headers: { Referer: "https://github.com", Origin: "https://github.com" },
    });

    const items = response.data.Items.map((i) => i.Item);
    return convertSearchItems(items);
  } catch (err: unknown) {
    const status = (err as { response?: { status?: number } })?.response?.status;
    // page 超過や該当0件で 404/400 が返ることがある → 空配列で先へ進める
    if (status === 404 || status === 400) {
      console.warn(`[fetcher] アイテム検索 "${keyword}" p${page} 応答なし (${status})`);
      return [];
    }
    if (status === 429) {
      console.warn("[fetcher] 楽天API レート制限 (429)、30秒待機して再試行...");
      await new Promise((r) => setTimeout(r, 30000));
      const retry = await axios.get<{ Items: Array<{ Item: RakutenApiItem }> }>(
        "https://openapi.rakuten.co.jp/ichibams/api/IchibaItem/Search/20220601",
        { params, timeout: 15000, headers: { Referer: "https://github.com", Origin: "https://github.com" } }
      );
      return convertSearchItems(retry.data.Items.map((i) => i.Item));
    }
    throw err;
  }
}

/**
 * mediumImageUrlsから先頭の画像URLを取り出す。
 * formatVersion=1: [{imageUrl: "..."}] / formatVersion=2: ["..."] の両形式に対応
 */
function firstImageUrl(urls: unknown): string {
  if (!Array.isArray(urls) || urls.length === 0) return "";
  const first: unknown = urls[0];
  if (typeof first === "string") return first;
  if (first && typeof first === "object" && "imageUrl" in first) {
    return (first as { imageUrl?: string }).imageUrl ?? "";
  }
  return "";
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
      imageUrl: firstImageUrl(item.mediumImageUrls),
      shopName: item.shopName ?? "",
      pointRate: item.pointRate ?? 1,
      pointRateStartTime: item.pointRateStartTime || undefined,
      pointRateEndTime: item.pointRateEndTime || undefined,
      hasCoupon,
      hasPointBonus,
      availability: item.availability ?? 1,
      endTime: item.endTime || undefined,
      reviewAverage: item.reviewAverage,
      reviewCount: item.reviewCount,
      affiliateRate: item.affiliateRate,
    };
  });
}

/**
 * 売上期待値スコア: レビュー実績×お得情報×期待報酬額の複合評価
 * - レビュー: 評価×件数の対数（実績のない商品は成約率が低い）
 * - ポイントアップ/クーポン: クリック率・成約率を直接押し上げる
 * - 期待報酬額: 価格×アフィリエイト料率（高単価×高料率が正当に評価される）
 */
export function salesScore(item: RakutenItem): number {
  const review =
    (item.reviewAverage ?? 0) * Math.log10(Math.max(item.reviewCount ?? 0, 1) + 1);
  const bonus = (item.hasPointBonus ? 3 : 0) + (item.hasCoupon ? 1.5 : 0);
  // 1成約あたりの期待報酬(円) = 価格 × 料率。対数で圧縮して他要素とバランスさせる
  const commission = item.itemPrice * ((item.affiliateRate ?? 2) / 100);
  const revenue = Math.log10(commission + 1) * 3;
  return review + bonus + revenue;
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
      imageUrl: firstImageUrl(item.mediumImageUrls),
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

  // ランキング全滅時: 検索APIキーワード×ページ ローテーションで無限供給
  console.warn("[fetcher] ランキング系フォールバック全て0件。検索APIへ切替");
  const searchResult = await fetchSearchWithRotation(minPrice, maxPrice, excludeCodes);
  if (searchResult.length > 0) return searchResult;

  // 検索も0件なら価格帯を緩和して検索 (min/2, max*2, 上限10000円)
  const relaxedMin = minPrice !== undefined ? Math.max(500, Math.floor(minPrice / 2)) : undefined;
  const relaxedMax = Math.min(10000, maxPrice * 2);
  console.warn(
    `[fetcher] 検索も0件。価格帯を緩和して再検索 (${relaxedMin ?? "-"}〜${relaxedMax}円)`
  );
  const relaxedSearch = await fetchSearchWithRotation(relaxedMin, relaxedMax, excludeCodes);
  if (relaxedSearch.length > 0) return relaxedSearch;

  // 最終フォールバック: 最後に取得したランキングデータに緩和価格で再フィルタ
  if (lastRawItems.length > 0) {
    const relaxed = applyItemFilter(
      lastRawItems,
      relaxedMin,
      relaxedMax,
      excludeCodes,
      "最終(ランキング+価格緩和)"
    );
    if (relaxed.length > 0) return relaxed;
  }

  return [];
}

/**
 * 検索APIでキーワード×ページをランダムローテーションし、
 * フィルタ通過する商品を見つけるまで試行する (無限供給フォールバック)
 */
async function fetchSearchWithRotation(
  minPrice: number | undefined,
  maxPrice: number,
  excludeCodes: Set<string>
): Promise<RakutenItem[]> {
  const MAX_PAGES_PER_KEYWORD = 3;
  // キーワードはランダム順、ページは 1 → 2 → 3 の順で試行
  // これで 1キーワード最大90商品 × 全キーワードで数千商品にアクセス可能
  const keywords = [...SEARCH_FALLBACK_KEYWORDS].sort(() => Math.random() - 0.5);

  for (const keyword of keywords) {
    for (let page = 1; page <= MAX_PAGES_PER_KEYWORD; page++) {
      let rawItems: RakutenItem[];
      try {
        rawItems = await fetchItemSearch(keyword, minPrice, maxPrice, undefined, page);
      } catch (err) {
        console.warn(`[fetcher] 検索 "${keyword}" p${page} 失敗: ${String(err)}`);
        break; // このキーワードは打ち切り、次のキーワードへ
      }
      // 該当0件のページに達したら、このキーワードはもう打ち切り
      if (rawItems.length === 0) break;

      const filtered = applyItemFilter(
        rawItems,
        minPrice,
        maxPrice,
        excludeCodes,
        `検索 "${keyword}" p${page}`
      );
      if (filtered.length > 0) return filtered;
    }
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

  // generalの場合は司令官の戦略（価格帯・季節キーワード・ジャンル重み）に従って選定
  let seasonalKeyword: string | undefined;
  if (TARGET_GENRE === "general" || !TARGET_GENRE) {
    const strategy = loadStrategy();

    // 価格帯を司令官の学習済み重みで選択（高単価枠を含む）
    const bandKey = weightedPick(Object.keys(PRICE_BANDS), (k) => k, strategy.priceBandWeights);
    const band = PRICE_BANDS[bandKey]!;
    minPrice = band.min;
    maxPrice = band.max;

    // 約3割は司令官が指定した季節先取りキーワードで商品検索（ニーズの波を掴む）
    if (strategy.seasonalKeywords.length > 0 && Math.random() < 0.3) {
      seasonalKeyword =
        strategy.seasonalKeywords[Math.floor(Math.random() * strategy.seasonalKeywords.length)];
      selectedGenreName = `季節: ${seasonalKeyword}`;
      lastSelectedGenreName = `季節:${seasonalKeyword}`;
      console.log(`[fetcher] 季節キーワード選択: 「${seasonalKeyword}」 価格帯: ${bandKey}円`);
    } else {
      // メインを6〜7割、サブを3〜4割の比率で選択し、ジャンル重みで重み付き選択
      const useMain = Math.random() < 0.65;
      const pool = useMain ? MAIN_GENRES : SUB_GENRES;
      const selected = weightedPick(pool, (g) => g.name, strategy.genreWeights);
      genreId = selected.genreId;
      selectedGenreName = `${useMain ? "メイン" : "サブ"}: ${selected.name}`;
      lastSelectedGenreName = selected.name;
      console.log(`[fetcher] ジャンル選択: ${selectedGenreName} 価格帯: ${bandKey}円`);
    }
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
    } else if (seasonalKeyword) {
      // 季節キーワード検索（page1→2の順に、フィルタ通過が出るまで試行）
      filtered = [];
      for (let page = 1; page <= 2 && filtered.length === 0; page++) {
        const rawItems = await fetchItemSearch(seasonalKeyword, minPrice, maxPrice, undefined, page);
        if (rawItems.length === 0) break;
        filtered = applyItemFilter(rawItems, minPrice, maxPrice, excludeCodes, `季節 "${seasonalKeyword}" p${page}`);
      }
      // 季節検索で見つからない場合は通常の検索ローテーションへフォールバック
      if (filtered.length === 0) {
        console.warn(`[fetcher] 季節キーワード「${seasonalKeyword}」で0件、検索ローテーションへ`);
        filtered = await fetchSearchWithRotation(minPrice, maxPrice, excludeCodes);
      }
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

  // レビューがあるのに低評価(3.5未満)の商品は成約率が低いので除外
  filtered = filtered.filter(
    (item) => !((item.reviewCount ?? 0) >= 5 && (item.reviewAverage ?? 0) < 3.5)
  );

  // 売上期待値スコア（レビュー実績×お得情報×アフィリエイト料率）で優先ソート
  filtered.sort((a, b) => salesScore(b) - salesScore(a));

  console.log(`[fetcher] ${filtered.length}件の商品を取得 (フィルタ後), ${count}件を使用`);
  return filtered.slice(0, count);
}
