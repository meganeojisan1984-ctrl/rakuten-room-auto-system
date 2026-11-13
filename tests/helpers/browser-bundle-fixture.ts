import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { deflateSync } from "node:zlib";
export function browserBundleFixture(t: { after: (fn: () => void) => void }) {
  const dir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "browser-run-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const hash = (b: Buffer) => createHash("sha256").update(b).digest("hex");
  const chunk = (name: string, data: Buffer) => {
    const bytes = Buffer.alloc(data.length + 12); bytes.writeUInt32BE(data.length); bytes.write(name, 4); data.copy(bytes, 8);
    let crc = 0xffffffff;
    for (const byte of bytes.subarray(4, -4)) { crc ^= byte; for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); }
    bytes.writeUInt32BE((crc ^ 0xffffffff) >>> 0, bytes.length - 4); return bytes;
  };
  const header = Buffer.alloc(13); header.writeUInt32BE(1); header.writeUInt32BE(1, 4); header[8] = 8; header[9] = 6;
  const png = Buffer.concat([Buffer.from("89504e470d0a1a0a", "hex"), chunk("IHDR", header), chunk("IDAT", deflateSync(Buffer.from([0, 0, 0, 0, 255]))), chunk("IEND", Buffer.alloc(0))]);
  const item = { roomCollectUrl: "https://room.rakuten.co.jp/mix/collect?itemcode=12345", itemCode: "shop:test", itemName: "Sample", itemUrl: "https://item.rakuten.co.jp/shop/test/", itemCaption: "Sample product", imageUrl: "https://example.com/p.png", itemPrice: 1000, shopName: "Shop", pointRate: 1, hasCoupon: false, hasPointBonus: false, availability: 1 };
  const data: Record<string, Buffer> = { product: Buffer.from(JSON.stringify(item)), prompt: Buffer.from("/showcase\nSample"), caption: Buffer.from("商品紹介"), image: png };
  const manifest: any = { version: 1, id: "sample-bundle", item: { itemCode: item.itemCode, itemName: item.itemName, itemUrl: item.itemUrl, roomCollectUrl: item.roomCollectUrl }, files: {}, provenance: { source: "ChatGPT Web", model: "observed label", mode: "image", generatedAt: "2026-11-11T00:00:00Z" }, review: { reviewer: "test", reviewedAt: "2026-11-11T00:01:00Z", visualFidelity: true, groundedCopy: true, productDestination: true, hashes: {} } };
  for (const [name, bytes] of Object.entries(data)) {
    fs.writeFileSync(path.join(dir, name), bytes);
    manifest.files[name] = { path: name, sha256: hash(bytes), ...(name === "image" ? { mimeType: "image/png" } : {}) };
    manifest.review.hashes[name] = hash(bytes);
  }
  const manifestPath = path.join(dir, "manifest.json"); fs.writeFileSync(manifestPath, JSON.stringify(manifest));
  return { dir, manifestPath, item, png };
}
