import { createHash, randomUUID } from "node:crypto";
import { closeSync, mkdirSync, openSync, unlinkSync } from "node:fs";
import * as path from "node:path";
import { validateBrowserPostBundle, type ValidatedBrowserPostBundle } from "./browser-post-bundle";
import { type BrowserPostStateStore, type BrowserReservation } from "./browser-post-state";
import type { PostResult } from "./poster";

export type BrowserBundlePublisher = (bundle: ValidatedBrowserPostBundle, profileUrl: string, headless: boolean) => Promise<PostResult>;
function profile(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.hostname !== "room.rakuten.co.jp" || url.search || url.hash || !/^\/room_[^/]+(?:\/items)?\/?$/.test(url.pathname)) throw new Error("BROWSER_ROOM_PROFILE_REQUIRED");
  return url.origin + "/" + url.pathname.split("/").filter(Boolean)[0];
}
export function isConfirmedRoomPostUrl(value: string | undefined, expectedProfile: string): value is string {
  if (!value) return false;
  try { const url = new URL(value); return url.origin + "/" + url.pathname.split("/")[1] === profile(expectedProfile) && /^\/room_[^/]+\/170\d+\/?$/.test(url.pathname) && !url.search && !url.hash; }
  catch { return false; }
}
export async function runBrowserBundlePost(options: {
  manifestPath: string; profileUrl: string; store: BrowserPostStateStore;
  headless?: boolean; lockDirectory?: string; publish?: BrowserBundlePublisher;
}): Promise<PostResult> {
  if (!options.manifestPath) throw new Error("ROOM_BROWSER_BUNDLE_REQUIRED");
  const destination = profile(options.profileUrl);
  const bundle = validateBrowserPostBundle(options.manifestPath);
  const lockDirectory = options.lockDirectory ?? path.join(process.cwd(), "data");
  mkdirSync(lockDirectory, { recursive: true });
  const lockPath = path.join(lockDirectory, ".browser-room-post.lock");
  const lock = openSync(lockPath, "wx", 0o600);
  closeSync(lock);
  try {
    let snapshot = await options.store.read();
    if (snapshot.state.active) throw new Error("BROWSER_ACTIVE_POST_UNRESOLVED");
    if (snapshot.excludedItemCodes.includes(bundle.item.itemCode)) throw new Error("BROWSER_PRODUCT_ALREADY_POSTED_OR_UNCERTAIN");
    if (snapshot.state.records.some(record => record.itemCode === bundle.item.itemCode || record.manifestHash === bundle.manifestHash || record.manifestId === bundle.manifestId || record.imageSha256 === bundle.image.sha256)) throw new Error("BROWSER_BUNDLE_ALREADY_CONSUMED");
    if (!options.publish) throw new Error("BROWSER_CUA_PUBLISHER_REQUIRED");
    const reservation: BrowserReservation = {
      requestId: randomUUID(), manifestId: bundle.manifestId, manifestHash: bundle.manifestHash,
      itemCode: bundle.item.itemCode, itemUrl: bundle.item.itemUrl, imageSha256: bundle.image.sha256,
      captionSha256: createHash("sha256").update(bundle.caption).digest("hex"),
      createdAt: new Date().toISOString(), status: "reserved",
    };
    // CAS and readback must succeed before any upload or publication can begin.
    snapshot = await options.store.save({ ...snapshot.state, active: reservation }, snapshot.revision);
    if (snapshot.excludedItemCodes.includes(bundle.item.itemCode)) throw new Error("BROWSER_PRODUCT_BECAME_EXCLUDED");
    const publish = options.publish;
    let result: PostResult;
    try {
      result = await publish(bundle, destination, options.headless ?? true);
      if (!result.success || result.unknown || !isConfirmedRoomPostUrl(result.roomPostUrl, destination)) throw new Error("BROWSER_POST_NOT_CONFIRMED");
    } catch (error) {
      // No retries. A failed/uncertain upload or submit retains the active reservation.
      await options.store.save({ ...snapshot.state, active: { ...reservation, status: "unknown" } }, snapshot.revision);
      throw error;
    }
    const published = { ...reservation, status: "published" as const, roomPostUrl: result.roomPostUrl };
    snapshot = await options.store.save({ ...snapshot.state, active: published }, snapshot.revision);
    await options.store.persistPosted(bundle.item.itemCode);
    // Only after both persistent writes and readback may this active slot clear.
    await options.store.save({ version: 1, active: null, records: [...snapshot.state.records, published] }, snapshot.revision);
    return result;
  } finally { unlinkSync(lockPath); }
}

export async function runBrowserPostFromEnvironment(headless = process.env.CI === "true" || process.env.HEADLESS !== "false"): Promise<PostResult> {
  const manifestPath = process.env.ROOM_BROWSER_BUNDLE;
  if (!manifestPath) throw new Error("ROOM_BROWSER_BUNDLE_REQUIRED: ChatGPTブラウザで作成・確認した商品画像bundleが必要です。AI APIへフォールバックしません。");
  if (process.env.SKIP_ROOM === "1") throw new Error("BROWSER_SNS_ROUTE_NOT_CONFIGURED: ROOMを投稿せずSNSだけへ送る経路は未接続です。");
  if (process.env.POST_COUNT && process.env.POST_COUNT !== "1") throw new Error("BROWSER_ROUTE_REQUIRES_ONE_BOUND_PRODUCT");
  validateBrowserPostBundle(manifestPath);
  // CUA is a supported assistant runtime, not an npm/Playwright browser connector.
  // An authorized scheduled worker performs the connector/CUA protocol instead.
  throw new Error("BROWSER_CUA_WORKER_REQUIRED: use room:transaction with the signed-in Mac browser; ROOM_COOKIE and AI API fallback are disabled.");
}
