import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeImageForUpload } from "../src/ig/image-normalize";

const ONE_PIXEL_GIF = Uint8Array.from(Buffer.from(
  "R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==",
  "base64",
));

test("GIFの商品画像をInstagram向けPNGへ正規化する", async () => {
  const normalized = await normalizeImageForUpload(ONE_PIXEL_GIF, "image/gif");

  assert.equal(normalized.mimeType, "image/png");
  assert.ok(normalized.bytes.byteLength > 0);
  assert.match(Buffer.from(normalized.bytes).toString("hex"), /^89504e470d0a1a0a/);
});

test("対応済みのJPEGは不要な変換をしない", async () => {
  const bytes = Uint8Array.from([1, 2, 3]);
  const normalized = await normalizeImageForUpload(bytes, "image/jpeg");

  assert.equal(normalized.mimeType, "image/jpeg");
  assert.equal(normalized.bytes, bytes);
});
