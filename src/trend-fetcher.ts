/**
 * trend-fetcher.ts - トレンドキーワード取得
 * Primary: Yahoo! リアルタイム検索スクレイピング
 * Fallback: 季節性定番キーワードリスト
 */
import axios from "axios";

/** ニュース・政治・災害など商品と無関係なキーワードをブロック */
const BLOCK_PATTERNS = [
  /政治|選挙|首相|大臣|国会|政党|与党|野党|議員|知事|市長/,
  /地震|台風|洪水|火災|噴火|津波|大雨|暴風|避難/,
  /事故|事件|逮捕|死亡|死者|負傷|遺体|犯罪|裁判|判決/,
  /戦争|紛争|テロ|爆発|攻撃|ミサイル/,
  /コロナ|感染|ウイルス|ワクチン|陽性|医療崩壊/,
  /株価|為替|円安|円高|金利|日銀|FRB|GDP/,
  /[ぁ-ん]{1}$/, // 助詞1文字のみ
];

/** 季節性フォールバックキーワード（商品紹介に適した生活系ワード） */
const SEASONAL_FALLBACK = [
  "掃除グッズ", "収納アイテム", "キッチン便利グッズ", "洗濯グッズ",
  "バス用品", "アロマ", "日焼け止め", "保湿クリーム", "水筒",
  "エコバッグ", "消臭グッズ", "ヘアケア", "スキンケア", "詰め替え容器",
  "時短グッズ", "節約グッズ", "ミニマリスト雑貨", "おしゃれ収納",
  "テレワーク便利グッズ", "ベッドまわり", "デスク周り整理", "断捨離",
];

/**
 * Yahoo! リアルタイム検索からトレンドキーワードを取得
 * 取得できない場合は季節性フォールバックキーワードを返す
 */
export async function fetchTrendKeyword(): Promise<string> {
  try {
    const keyword = await scrapeYahooRealtime();
    if (keyword) {
      console.log(`[trend-fetcher] Yahoo!トレンドキーワード取得成功: 「${keyword}」`);
      return keyword;
    }
  } catch (err) {
    console.warn("[trend-fetcher] Yahoo!スクレイピング失敗:", String(err).slice(0, 100));
  }

  const fallback = SEASONAL_FALLBACK[Math.floor(Math.random() * SEASONAL_FALLBACK.length)]!;
  console.log(`[trend-fetcher] フォールバックキーワード使用: 「${fallback}」`);
  return fallback;
}

async function scrapeYahooRealtime(): Promise<string | null> {
  const response = await axios.get<string>("https://search.yahoo.co.jp/realtime", {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      "Accept-Language": "ja,en-US;q=0.9",
      Accept: "text/html,application/xhtml+xml",
    },
    timeout: 12000,
    responseType: "text",
  });

  const html = response.data;
  const keywords = extractKeywords(html);

  if (keywords.length === 0) {
    console.warn("[trend-fetcher] Yahoo!ページからキーワードを抽出できませんでした");
    return null;
  }

  // 上位5件からランダムに1件選択（毎回同じキーワードにならないように）
  const topN = keywords.slice(0, 5);
  return topN[Math.floor(Math.random() * topN.length)] ?? null;
}

function extractKeywords(html: string): string[] {
  const candidates = new Set<string>();

  // Yahoo! リアルタイム検索の構造に合わせた複数パターンで抽出
  const patterns = [
    // ランキング番号付きのキーワード
    />\s*(\d{1,2})\s*<\/[^>]+>\s*<[^>]+>\s*([^\s<]{2,20})\s*</g,
    // ランキングリスト項目
    /class="[^"]*(?:RankWord|rankWord|trendWord|keyword|rank-word)[^"]*"[^>]*>([^<]{2,20})</g,
    // href にキーワードを含むリンク
    /href="[^"]*[?&]p=([^&"]{2,20})[^"]*"/g,
    // 一般的なリスト形式
    /<(?:li|span|a)[^>]*>\s*([^\s<]{2,15})\s*<\/(?:li|span|a)>/g,
  ];

  for (const pattern of patterns) {
    let match;
    const re = new RegExp(pattern.source, pattern.flags);
    while ((match = re.exec(html)) !== null) {
      const raw = (match[2] ?? match[1] ?? "").trim();
      const kw = decodeURIComponent(raw).replace(/\+/g, " ").trim();
      if (isValidKeyword(kw)) {
        candidates.add(kw);
      }
    }
  }

  return [...candidates];
}

function isValidKeyword(kw: string): boolean {
  if (kw.length < 2 || kw.length > 20) return false;
  // 数字のみ・記号のみは除外
  if (/^[\d\s\-_.,!?！？。、]+$/.test(kw)) return false;
  // ブロックパターンに引っかかるものを除外
  if (BLOCK_PATTERNS.some((p) => p.test(kw))) return false;
  return true;
}
