import { chromium, type Cookie } from "playwright";
import * as fs from "fs";
import * as path from "path";
import * as dotenv from "dotenv";
import { parseAffiliateCsv } from "./report-parser";
import {
  initDb,
  upsertSalesRow,
  getScrapeSummary,
  type SalesRow,
} from "./sales-db";
import { notifyDomError, notifyReport } from "../notifiers";
dotenv.config();

const DEFAULT_REPORT_URL = "https://affiliate.rakuten.co.jp/rp/mypage/report/";
const DEBUG_DIR = path.join(process.cwd(), "data", "affiliate-debug");

export interface ScrapeResult {
  ok: boolean;
  date: string;
  rowsInserted: number;
  totalReward: number;
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

/** CSV バッファを UTF-8 → 失敗時 Shift_JIS で decode */
function decodeCsv(buf: Buffer): string {
  const utf8 = buf.toString("utf-8");
  if (/商品コード|クリック数/.test(utf8)) return utf8;
  const sjis = new TextDecoder("shift_jis").decode(buf);
  return sjis;
}

export async function scrapeAffiliateReport(
  opts: { date?: string; dbPath?: string } = {},
): Promise<ScrapeResult> {
  const date = opts.date ?? yesterdayJst();
  const reportUrl = process.env.RAKUTEN_AFFILIATE_REPORT_URL ?? DEFAULT_REPORT_URL;
  fs.mkdirSync(DEBUG_DIR, { recursive: true });

  const cookies = parseCookiesFromEnv();
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    locale: "ja-JP",
    timezoneId: "Asia/Tokyo",
    acceptDownloads: true,
  });
  await context.addCookies(cookies);
  const page = await context.newPage();

  const dumpDebug = async (label: string): Promise<string> => {
    const base = path.join(DEBUG_DIR, `${tsStamp()}-${label}`);
    try {
      await page.screenshot({ path: `${base}.png`, fullPage: true });
      const html = await page.content();
      fs.writeFileSync(`${base}.html`, html, "utf-8");
    } catch (e) {
      console.warn("[sales-scraper] dumpDebug 失敗:", e);
    }
    return base;
  };

  try {
    console.log(`[sales-scraper] レポートページ: ${reportUrl}`);
    await page.goto(reportUrl, { waitUntil: "domcontentloaded", timeout: 30000 });

    const url = page.url();
    if (url.includes("login") || url.includes("signin") || url.includes("grp01.id.rakuten.co.jp")) {
      const artifact = await dumpDebug("cookie-expired");
      await notifyDomError(`楽天アフィリエイト Cookie 失効（RAKUTEN_AFFILIATE_COOKIE を更新してください）\ndebug: ${artifact}`);
      return { ok: false, date, rowsInserted: 0, totalReward: 0, error: "cookie-expired", debugArtifact: artifact };
    }

    const csvCandidateRe = /CSV.*(ダウンロード|出力|DL)|(ダウンロード|出力|DL).*CSV/i;
    const [download] = await Promise.all([
      page.waitForEvent("download", { timeout: 20000 }).catch(() => null),
      page.getByText(csvCandidateRe).first().click({ timeout: 10000 }).catch(() => null),
    ]);
    if (!download) {
      const artifact = await dumpDebug("csv-button-not-found");
      await notifyDomError(`CSVダウンロード導線が見つかりません。UI変更の可能性。debug: ${artifact}`);
      return { ok: false, date, rowsInserted: 0, totalReward: 0, error: "csv-button-not-found", debugArtifact: artifact };
    }

    const dlPath = await download.path();
    if (!dlPath) {
      const artifact = await dumpDebug("csv-download-failed");
      return { ok: false, date, rowsInserted: 0, totalReward: 0, error: "csv-download-failed", debugArtifact: artifact };
    }
    const buf = fs.readFileSync(dlPath);
    const csv = decodeCsv(buf);

    let parsed: SalesRow[];
    try {
      parsed = parseAffiliateCsv(csv, { date, defaultTrackingId: "" });
    } catch (e) {
      const artifact = await dumpDebug("csv-parse-failed");
      fs.writeFileSync(`${artifact}.csv`, csv, "utf-8");
      await notifyDomError(`CSVパース失敗: ${(e as Error).message}\ndebug: ${artifact}`);
      return { ok: false, date, rowsInserted: 0, totalReward: 0, error: `parse-failed: ${(e as Error).message}`, debugArtifact: artifact };
    }

    const db = initDb(opts.dbPath);
    for (const row of parsed) upsertSalesRow(db, row);
    const summary = getScrapeSummary(db, date, date);
    db.close();

    await notifyReport(
      "📊 楽天アフィリ実売取り込み",
      `date=${date} rows=${summary.rows} clicks=${summary.totalClicks} orders=${summary.totalOrders} reward=¥${summary.totalReward}`,
    );

    return { ok: true, date, rowsInserted: summary.rows, totalReward: summary.totalReward };
  } finally {
    await context.close();
    await browser.close();
  }
}
