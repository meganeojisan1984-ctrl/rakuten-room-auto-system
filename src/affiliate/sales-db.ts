import Database from "better-sqlite3";
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
  return db;
}

export function upsertSalesRow(db: Database.Database, row: SalesRow): void {
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
