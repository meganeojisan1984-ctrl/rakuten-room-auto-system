import * as fs from "fs";
import * as path from "path";
import { buildCarouselSlides, writeCarouselImages } from "../src/ig/carousel";
import type { RakutenItem } from "../src/fetcher";

const productSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="700" height="520" viewBox="0 0 700 520">
  <rect width="700" height="520" fill="#eef7f5"/>
  <rect x="150" y="115" width="400" height="250" rx="28" fill="#ffffff" stroke="#0f766e" stroke-width="10"/>
  <rect x="190" y="160" width="320" height="50" rx="18" fill="#d1fae5"/>
  <rect x="190" y="235" width="150" height="92" rx="18" fill="#99f6e4"/>
  <rect x="360" y="235" width="150" height="92" rx="18" fill="#bae6fd"/>
  <text x="350" y="435" text-anchor="middle" font-family="Arial" font-size="38" font-weight="700" fill="#111827">収納ボックス 3個セット</text>
</svg>`;

const item: RakutenItem = {
  itemName: "20％ポイントバック 〜08/14(金)9:59まで【DEAL】毎日使える収納ボックス 3個セット",
  itemCode: "demo:storage-box",
  itemPrice: 2980,
  itemUrl: "https://example.com/item",
  itemCaption: "洗面台やキッチン周りの小物をすっきり収納。ごちゃつきやすい場所が一気に見やすくなります。",
  imageUrl: `data:image/svg+xml;base64,${Buffer.from(productSvg).toString("base64")}`,
  shopName: "暮らしショップ",
  pointRate: 5,
  hasCoupon: true,
  hasPointBonus: true,
  availability: 1,
  reviewAverage: 4.6,
  reviewCount: 128,
};

async function main(): Promise<void> {
  const dir = path.join(process.cwd(), "public", "generated", "instagram-demo");
  fs.rmSync(dir, { recursive: true, force: true });
  const assets = await writeCarouselImages(item, buildCarouselSlides(item), {
    outputDir: dir,
    publicBaseUrl: "https://example.com/ig-demo",
    now: new Date("2026-07-30T12:10:00Z"),
  });
  console.log(JSON.stringify(assets.map((asset) => asset.filePath), null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
