import { chromium, type Cookie, type APIRequestContext } from "playwright";
import * as fs from "fs";
import * as path from "path";
import * as dotenv from "dotenv";
import { parseOrderCsv } from "./report-parser";
import {
  initDb,
  upsertSalesRow,
  getScrapeSummary,
  type SalesRow,
} from "./sales-db";
import { notifyDomError, notifyReport } from "../notifiers";
dotenv.config();

const ORDER_API_TEMPLATE =
  "https://affiliate.rakuten.co.jp/api/report/download/order?format=csv&date=";
const REPORT_TOP_URL = "https://affiliate.rakuten.co.jp/report/summary";
const DEBUG_DIR = path.join(process.cwd(), "data", "affiliate-debug");

export interface ScrapeResult {
  ok: boolean;
  date: string;         // 対象日 (YYYY-MM-DD)
  monthFetched: string; // 取得対象月 (YYYY-MM)
  rowsInserted: number;
  totalReward: number;
  totalOrders: number;
  error?: string;
  debugArtifact?: string;
}

function parseCookiesFromEnv(): Cookie[] {
  const raw = process.env.RAKUTEN_AFFILIATE_COOKIE ?? "";
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) return parsed as Cookie[];
    } catch {
      console.warn("[sales-scraper] RAKUTEN_AFFILIATE_COOKIE のパース失敗、cookies-affiliate.json へフォールバック");
    }
  }
  const file = path.join(process.cwd(), "cookies-affiliate.json");
  if (fs.existsSync(file)) {
    const parsed = JSON.parse(fs.readFileSync(file, "utf-8")) as unknown;
    if (Array.isArray(parsed)) return parsed as Cookie[];
  }
  throw new Error("RAKUTEN_AFFILIATE_COOKIE 未設定（環境変数・cookies-affiliate.json ともに無い）");
}

/** YYYY-MM-DD の JST 昨日 */
function yesterdayJst(): string {
  const now = new Date();
  const jstNow = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  jstNow.setUTCDate(jstNow.getUTCDate() - 1);
  return jstNow.toISOString().slice(0, 10);
}

function tsStamp(): string {
  return new Date().toISOString().replace(/[-:.T]/g, "").slice(0, 15);
}

function monthOf(date: string): string {
  return date.slice(0, 7); // YYYY-MM
}

/**
 * 楽天アフィリエイト「注文別成果」CSVを Cookie 認証で API 直取得し、
 * 指定日の行を DB へ upsert する。API は月単位で返るので、
 * 呼び出し月の全データを引き、対象日の分だけ抽出して保存する。
 */
export async function scrapeAffiliateReport(
  opts: { date?: string; dbPath?: string } = {},
): Promise<ScrapeResult> {
  const date = opts.date ?? yesterdayJst();
  const month = monthOf(date);
  fs.mkdirSync(DEBUG_DIR, { recursive: true });

  const cookies = parseCookiesFromEnv();
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    locale: "ja-JP",
    timezoneId: "Asia/Tokyo",
  });
  await context.addCookies(cookies);

  const dumpDebug = async (label: string, extra?: { body?: Buffer | string }): Promise<string> => {
    const base = path.join(DEBUG_DIR, `${tsStamp()}-${label}`);
    try {
      if (extra?.body !== undefined) {
        fs.writeFileSync(`${base}.bin`, typeof extra.body === "string" ? extra.body : extra.body);
      }
      // sanity 用に report top のスクショも撮る
      const page = await context.newPage();
      await page.goto(REPORT_TOP_URL, { waitUntil: "domcontentloaded", timeout: 20000 }).catch(() => {});
      await page.screenshot({ path: `${base}.png`, fullPage: true }).catch(() => {});
      try {
        fs.writeFileSync(`${base}.html`, await page.content(), "utf-8");
      } catch { /* ignore */ }
      await page.close();
    } catch (e) {
      console.warn("[sales-scraper] dumpDebug 失敗:", e);
    }
    return base;
  };

  try {
    const apiUrl = ORDER_API_TEMPLATE + month;
    console.log(`[sales-scraper] fetch: ${apiUrl}`);
    const req: APIRequestContext = context.request;
    const resp = await req.get(apiUrl, { timeout: 30000 });
    const status = resp.status();
    const ct = resp.headers()["content-type"] ?? "";
    console.log(`[sales-scraper] status=${status} content-type=${ct}`);

    if (status === 401 || status === 403 || status >= 500) {
      const body = await resp.body();
      const artifact = await dumpDebug("api-status-fail", { body });
      await notifyDomError(`楽天アフィリ API ${status} 応答（Cookie 失効の可能性）\ndebug: ${artifact}`);
      return {
        ok: false, date, monthFetched: month, rowsInserted: 0, totalReward: 0, totalOrders: 0,
        error: `api-status-${status}`, debugArtifact: artifact,
      };
    }

    // ログイン切れは 200 でもHTML(ログインページ)が返ることがある
    if (!ct.includes("csv")) {
      const body = await resp.body();
      const preview = body.toString("utf-8").slice(0, 200);
      const artifact = await dumpDebug("non-csv-response", { body });
      await notifyDomError(`API が CSV を返さない (ct=${ct}, prefix="${preview}")\ndebug: ${artifact}`);
      return {
        ok: false, date, monthFetched: month, rowsInserted: 0, totalReward: 0, totalOrders: 0,
        error: "non-csv-response", debugArtifact: artifact,
      };
    }

    const csv = (await resp.body()).toString("utf-8");

    let parsed: SalesRow[];
    try {
      parsed = parseOrderCsv(csv, { targetDate: date });
    } catch (e) {
      const artifact = await dumpDebug("csv-parse-failed", { body: csv });
      await notifyDomError(`CSVパース失敗: ${(e as Error).message}\ndebug: ${artifact}`);
      return {
        ok: false, date, monthFetched: month, rowsInserted: 0, totalReward: 0, totalOrders: 0,
        error: `parse-failed: ${(e as Error).message}`, debugArtifact: artifact,
      };
    }

    const db = initDb(opts.dbPath);
    for (const row of parsed) upsertSalesRow(db, row);
    const summary = getScrapeSummary(db, date, date);
    db.close();

    await notifyReport(
      "📊 楽天アフィリ実売取り込み",
      `date=${date} month=${month} rows=${summary.rows} orders=${summary.totalOrders} reward=¥${summary.totalReward}`,
    );

    return {
      ok: true, date, monthFetched: month,
      rowsInserted: summary.rows,
      totalReward: summary.totalReward,
      totalOrders: summary.totalOrders,
    };
  } finally {
    await context.close();
    await browser.close();
  }
}
