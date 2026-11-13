import Database from "better-sqlite3";
import {createHash} from "crypto";
import * as fs from "fs";
import * as path from "path";

export interface SalesRow {
  date: string;
  itemCode: string;
  trackingId: string;
  clicks: number;
  orders: number;
  reward: number;
}

const DEFAULT_DB_PATH = path.join(process.cwd(), "data", "sales.sqlite");

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS sales (
  date        TEXT NOT NULL,
  item_code   TEXT NOT NULL,
  tracking_id TEXT NOT NULL,
  clicks      INTEGER NOT NULL DEFAULT 0,
  orders      INTEGER NOT NULL DEFAULT 0,
  reward      INTEGER NOT NULL DEFAULT 0,
  scraped_at  TEXT NOT NULL,
  PRIMARY KEY (date, item_code, tracking_id)
);
CREATE TABLE IF NOT EXISTS sales_coverage (
  date TEXT PRIMARY KEY,
  fetched_at TEXT NOT NULL,
  source_month TEXT NOT NULL,
  source_sha256 TEXT NOT NULL,
  row_count INTEGER NOT NULL,
  rows_sha256 TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status = 'complete')
);
CREATE INDEX IF NOT EXISTS idx_sales_date ON sales(date);
CREATE INDEX IF NOT EXISTS idx_sales_slot ON sales(tracking_id);
`;

export function initDb(dbPath: string = DEFAULT_DB_PATH): Database.Database {
  if (dbPath !== ":memory:") {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  }
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.exec(SCHEMA_SQL);
  const cols = db.prepare('PRAGMA table_info(sales_coverage)').all() as {name:string}[];
  if (!cols.some(c => c.name === 'rows_sha256')) db.exec("ALTER TABLE sales_coverage ADD COLUMN rows_sha256 TEXT NOT NULL DEFAULT ''");
  return db;
}

export function upsertSalesRow(db: Database.Database, row: SalesRow): void {
  db.prepare('DELETE FROM sales_coverage WHERE date = ?').run(row.date);
  const stmt = db.prepare(`
    INSERT INTO sales (date, item_code, tracking_id, clicks, orders, reward, scraped_at)
    VALUES (@date, @itemCode, @trackingId, @clicks, @orders, @reward, @scrapedAt)
    ON CONFLICT(date, item_code, tracking_id) DO UPDATE SET
      clicks = excluded.clicks,
      orders = excluded.orders,
      reward = excluded.reward,
      scraped_at = excluded.scraped_at
  `);
  stmt.run({ ...row, scrapedAt: new Date().toISOString() });
}

export function getSalesByDateRange(
  db: Database.Database,
  from: string,
  to: string,
): SalesRow[] {
  const rows = db
    .prepare(
      "SELECT date, item_code as itemCode, tracking_id as trackingId, clicks, orders, reward FROM sales WHERE date BETWEEN ? AND ? ORDER BY date, item_code",
    )
    .all(from, to) as SalesRow[];
  return rows;
}

export function getScrapeSummary(
  db: Database.Database,
  from: string,
  to: string,
): { rows: number; totalClicks: number; totalOrders: number; totalReward: number } {
  const r = db
    .prepare(
      "SELECT COUNT(*) as rows, COALESCE(SUM(clicks),0) as totalClicks, COALESCE(SUM(orders),0) as totalOrders, COALESCE(SUM(reward),0) as totalReward FROM sales WHERE date BETWEEN ? AND ?",
    )
    .get(from, to) as { rows: number; totalClicks: number; totalOrders: number; totalReward: number };
  return r;
}

/** Coverage records prove ingestion, not that provisional commissions are finalized. */
export function validDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}
function rowsDigest(rows: SalesRow[]): string {
  const canonical = rows.map(r => [r.date,r.itemCode,r.trackingId,r.clicks,r.orders,r.reward])
    .sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}
export function replaceSalesDay(db: Database.Database, date: string, rows: SalesRow[], evidence: { fetchedAt: string; sourceMonth: string; sha256: string }): void {
  if (!validDate(date) || evidence.sourceMonth !== date.slice(0, 7) ||
      !/^\d{4}-\d{2}-\d{2}T.*Z$/.test(evidence.fetchedAt) || !Number.isFinite(Date.parse(evidence.fetchedAt)) ||
      !/^[a-f0-9]{64}$/.test(evidence.sha256)) throw new Error('invalid sales evidence');
  if (date > latestAvailableSalesDay(new Date(evidence.fetchedAt))) throw new Error('report publication window incomplete');
  const keys = new Set<string>();
  for (const row of rows) {
    const key = JSON.stringify([row.itemCode, row.trackingId]);
    if (row.date !== date || !row.itemCode || keys.has(key) ||
        ![row.clicks, row.orders, row.reward].every(n => Number.isSafeInteger(n) && n >= 0)) throw new Error('invalid sales rows');
    keys.add(key);
  }
  db.transaction(() => {
    db.prepare('DELETE FROM sales WHERE date = ?').run(date);
    for (const row of rows) upsertSalesRow(db, row);
    db.prepare(`INSERT INTO sales_coverage (date,fetched_at,source_month,source_sha256,row_count,rows_sha256,status) VALUES (?, ?, ?, ?, ?, ?, 'complete')
      ON CONFLICT(date) DO UPDATE SET fetched_at=excluded.fetched_at, source_month=excluded.source_month,
      source_sha256=excluded.source_sha256, row_count=excluded.row_count, rows_sha256=excluded.rows_sha256, status=excluded.status`)
      .run(date, evidence.fetchedAt, evidence.sourceMonth, evidence.sha256, rows.length, rowsDigest(rows));
  })();
}
/** Official report: yesterday is fully reflected by noon JST, not overnight. */
export function latestAvailableSalesDay(now: Date): string {
  if (!Number.isFinite(now.getTime())) throw new Error('invalid report clock');
  const end = new Date(now.getTime() + 9 * 3600000);
  end.setUTCDate(end.getUTCDate() - (end.getUTCHours() < 12 ? 2 : 1));
  return end.toISOString().slice(0,10);
}
export function completedJstWindow(now: Date, days: number): { from: string; to: string } {
  if (!Number.isFinite(now.getTime()) || !Number.isSafeInteger(days) || days < 1 || days > 366) throw new Error('invalid window');
  const end = new Date(latestAvailableSalesDay(now));
  const start = new Date(end); start.setUTCDate(start.getUTCDate() - days + 1);
  return { from: start.toISOString().slice(0,10), to: end.toISOString().slice(0,10) };
}
export function getVerifiedSalesWindow(db: Database.Database, from: string, to: string) {
  if (!validDate(from) || !validDate(to) || from > to || (Date.parse(to)-Date.parse(from))/86400000 > 365) throw new Error('invalid date range');
  return db.transaction(() => {
  const missingDates: string[] = [];
  const fetchedAt: string[] = [];
  const coverage = db.prepare('SELECT row_count,rows_sha256,fetched_at FROM sales_coverage WHERE date = ? AND status = ?');
  const count = db.prepare('SELECT COUNT(*) AS n FROM sales WHERE date = ?');
  for (let t = Date.parse(from); t <= Date.parse(to); t += 86400000) {
    const date = new Date(t).toISOString().slice(0,10);
    const c = coverage.get(date, 'complete') as {row_count: number;rows_sha256:string;fetched_at:string} | undefined;
    const actual = count.get(date) as {n: number};
    if (!c || !Number.isFinite(Date.parse(c.fetched_at)) || date > latestAvailableSalesDay(new Date(c.fetched_at)) || c.row_count !== actual.n || c.rows_sha256 !== rowsDigest(getSalesByDateRange(db,date,date))) missingDates.push(date);
    else fetchedAt.push(c.fetched_at);
  }
  return missingDates.length ? {status: 'missing' as const, missingDates, rows: null} :
    {status: 'complete' as const, missingDates, rows: getSalesByDateRange(db, from, to), oldestFetchedAt: fetchedAt.sort()[0], newestFetchedAt: fetchedAt[fetchedAt.length-1]};
  })();
}
