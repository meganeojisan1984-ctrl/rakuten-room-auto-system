import { scrapeAffiliateReport } from "./affiliate/sales-scraper";

async function main(): Promise<void> {
  console.log("[run_sales_scrape] 楽天アフィリエイト実売取り込み開始");
  const result = await scrapeAffiliateReport();
  console.log("[run_sales_scrape] 結果:", JSON.stringify(result));
  process.exit(result.ok ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error("[run_sales_scrape] fatal:", err);
  process.exit(2);
});
