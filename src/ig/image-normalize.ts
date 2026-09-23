export interface NormalizedImage {
  bytes: Uint8Array;
  mimeType: "image/jpeg" | "image/png" | "image/webp";
}

const SUPPORTED_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

/** Convert animated/unsupported product images to a still PNG for upload APIs. */
export async function normalizeImageForUpload(bytes: Uint8Array, mimeType: string): Promise<NormalizedImage> {
  const normalizedMimeType = mimeType.toLowerCase().split(";", 1)[0];
  if (SUPPORTED_MIME_TYPES.has(normalizedMimeType)) {
    return { bytes, mimeType: normalizedMimeType as NormalizedImage["mimeType"] };
  }
  if (normalizedMimeType !== "image/gif") {
    throw new Error(`商品画像の形式に対応していません: ${normalizedMimeType || "unknown"}`);
  }

  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1, height: 1 }, deviceScaleFactor: 1 });
    const dataUrl = `data:image/gif;base64,${Buffer.from(bytes).toString("base64")}`;
    await page.setContent(`<img id="product" src="${dataUrl}" />`, { waitUntil: "load" });
    await page.locator("#product").waitFor({ state: "visible" });
    const png = await page.locator("#product").screenshot({ type: "png" });
    return { bytes: new Uint8Array(png), mimeType: "image/png" };
  } finally {
    await browser.close();
  }
}
