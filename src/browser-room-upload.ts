import type { Page, Locator } from "playwright";
import { verifyBrowserPostImage, canonicalRoomCollectUrl, type BrowserPostImage } from "./browser-post-bundle";

/** Signed-in ROOM UI observed 2026-11-08. No broad text/file/image fallback. */
export const ROOM_IMAGE_UI = {
  edit: 'button[ng-click="image()"]',
  add: 'div.btns.btnUpdate[ng-click="addImage()"]',
  input: 'input#image_file_input[name="image_file"][type="file"]',
  cropPreview: 'img.cliped-img',
  cropSave: 'button.submit-btn[ng-click="save()"]',
  managementPreview: 'div.img img[ng-show="items.length >= 1"]',
  apply: 'button[ng-click="main(true)"]',
  caption: 'textarea#collect-content[name="content"][ng-model="$parent.content"]',
  mainPreview: 'form.collect-form a[ng-click="linkImage(item)"] img[src^="https://room.r10s.jp/"]',
  publish: 'form.collect-form .submit-btn-centered button.collect-btn[ng-click="collect()"]',
  publishedLink: '.ichiba-in-page--pnpTD > a.link--2vBG3',
  publishedContainer: 'div.stack--yyK8y.stack-horizontal--2AXqW',
  publishedPhoto: '.slideshow-container--3L665 .swiper-slide-active .image-wrapper--1sssU > img',
} as const;
export type RoomImageSelectors = { add: string };
export function getRoomImageSelectors(): RoomImageSelectors {
  return { add: ROOM_IMAGE_UI.add };
}

export async function readyRoomButton(page: Page, selector: string): Promise<Locator> {
  const visible = page.locator(`${selector}:visible`);
  await visible.waitFor({ state: "visible", timeout: 15000 });
  if (await visible.count() !== 1) throw new Error("ROOM_IMAGE_CONTROL_NOT_UNIQUE");
  if (!await visible.isEnabled() || await visible.getAttribute("aria-disabled") === "true" || /(?:^|\s)disabled(?:\s|$)/.test(await visible.getAttribute("class") ?? "")) throw new Error("ROOM_IMAGE_CONTROL_DISABLED");
  return visible;
}

async function previewSources(page: Page, selector: string): Promise<string[]> {
  return page.locator(selector).evaluateAll(nodes => nodes.map(n => n instanceof HTMLImageElement ? n.currentSrc || n.src : ""));
}

/** Require one visible decoded preview, excluding hidden carousel clones. */
async function waitForPreview(page: Page, selector: string, before: string[], kind: "crop" | "remote", expected?: string): Promise<string> {
  const result = await page.waitForFunction(({ selector, before, kind, expected }) => {
    const visible = Array.from(document.querySelectorAll(selector)).filter(node => {
      const rect = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
    });
    if (visible.length !== 1 || !(visible[0] instanceof HTMLImageElement)) return false;
    const img = visible[0];
    const src = img.currentSrc || img.src;
    if (!img.complete || img.naturalWidth < 350 || img.naturalHeight < 350 || before.includes(src) || (expected && src !== expected)) return false;
    if (kind === "crop" ? !/^data:image\/(jpeg|png);base64,/.test(src) : !src.startsWith("https://room.r10s.jp/")) return false;
    return src;
  }, { selector, before, kind, expected }, { timeout: 30000 });
  try { return await result.jsonValue() as string; } finally { await result.dispose(); }
}

/** Every click is single-attempt. A timeout/disabled control leaves submit unreachable. */
export async function attachRoomImage(page: Page, image: BrowserPostImage, itemCode: string, selectors = getRoomImageSelectors()): Promise<string> {
  const bytes = verifyBrowserPostImage(image, itemCode);
  await page.locator(ROOM_IMAGE_UI.caption).waitFor({ state: "visible", timeout: 15000 });
  const mainBefore = await previewSources(page, ROOM_IMAGE_UI.mainPreview);
  await (await readyRoomButton(page, ROOM_IMAGE_UI.edit)).click({ timeout: 10000 });
  const managementBefore = await previewSources(page, ROOM_IMAGE_UI.managementPreview);
  await (await readyRoomButton(page, selectors.add)).click({ timeout: 10000 });
  const input = page.locator(ROOM_IMAGE_UI.input);
  await input.waitFor({ state: "attached", timeout: 15000 });
  if (await input.count() !== 1) throw new Error("ROOM_IMAGE_INPUT_NOT_UNIQUE");
  const cropBefore = await previewSources(page, ROOM_IMAGE_UI.cropPreview);
  // Playwright setInputFiles supports the observed hidden input; never click it.
  await input.setInputFiles({ name: "showcase-" + image.sha256.slice(0, 16) + (image.mimeType === "image/png" ? ".png" : ".jpg"), mimeType: image.mimeType, buffer: bytes }, { timeout: 30000 });
  await waitForPreview(page, ROOM_IMAGE_UI.cropPreview, cropBefore, "crop");
  await (await readyRoomButton(page, ROOM_IMAGE_UI.cropSave)).click({ timeout: 10000 });
  const savedSource = await waitForPreview(page, ROOM_IMAGE_UI.managementPreview, managementBefore, "remote");
  await (await readyRoomButton(page, ROOM_IMAGE_UI.apply)).click({ timeout: 10000 });
  await page.locator(ROOM_IMAGE_UI.caption).waitFor({ state: "visible", timeout: 15000 });
  await waitForPreview(page, ROOM_IMAGE_UI.mainPreview, mainBefore, "remote", savedSource);
  return savedSource;
}

/** Recheck attachment immediately before publishing; no click is performed here. */
export async function assertRoomImageAttached(page: Page, source: string): Promise<void> {
  await waitForPreview(page, ROOM_IMAGE_UI.mainPreview, [], "remote", source);
}

/** A generic toast is insufficient for a browser-image post. Require a new
 * permalink under the expected profile, the exact selected product link and
 * the uploaded image still decoded on that detail page. */
export async function confirmBrowserRoomPost(page: Page, itemUrl: string, imageSource: string, profileUrl: string): Promise<string> {
  const result = await page.waitForFunction(({ itemUrl, imageSource, profileUrl, selectors }) => {
    const expected = new URL(itemUrl), expectedImage = new URL(imageSource), profile = new URL(profileUrl), current = new URL(location.href);
    if (current.origin !== profile.origin || current.pathname.split("/")[1] !== profile.pathname.split("/")[1] ||
        !/^\/room_[^/]+\/170\d+\/?$/.test(current.pathname) || current.search || current.hash) return false;
    const links = Array.from(document.querySelectorAll(selectors.publishedLink)).filter(node => {
      const rect = node.getBoundingClientRect(), style = getComputedStyle(node);
      return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
    });
    if (links.length !== 1) return false;
    const link = links[0] as HTMLAnchorElement;
    if (!link.querySelector('button[aria-label="楽天市場で見る"]')) return false;
    let target: URL;
    try {
      const href = new URL(link.href);
      target = href.hostname === "hb.afl.rakuten.co.jp" && href.protocol === "https:"
        ? new URL(href.searchParams.get("pc") || "") : href;
    } catch { return false; }
    if (target.origin !== expected.origin || target.pathname !== expected.pathname) return false;
    const post = link.closest(selectors.publishedContainer);
    if (!post) return false;
    const photos = Array.from(post.querySelectorAll(selectors.publishedPhoto)).filter(node => {
      const rect = node.getBoundingClientRect(), style = getComputedStyle(node);
      return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
    });
    if (photos.length !== 1 || !(photos[0] instanceof HTMLImageElement)) return false;
    const img = photos[0], actualImage = new URL(img.currentSrc || img.src);
    if (!img.complete || img.naturalWidth <= 0 || actualImage.origin !== "https://room.r10s.jp" ||
        expectedImage.origin !== actualImage.origin || expectedImage.pathname !== actualImage.pathname) return false;
    return current.href;
  }, { itemUrl, imageSource, profileUrl, selectors: ROOM_IMAGE_UI }, { timeout: 20000 });
  try { return await result.jsonValue() as string; } finally { await result.dispose(); }
}

export { assertRoomAccount } from "./room-account";

/** Verify the reviewed collect destination, not unrelated product links.
 * ROOM's observed collect form contains no item.rakuten.co.jp anchor. */
export async function assertBrowserPostForm(page: Page, expectedCaption: string, expectedCollectUrl: string): Promise<void> {
  const caption = page.locator(ROOM_IMAGE_UI.caption);
  if (await caption.count() !== 1 || await caption.inputValue() !== expectedCaption) throw new Error("ROOM_REVIEWED_CAPTION_MISMATCH");
  if (canonicalRoomCollectUrl(page.url()) !== canonicalRoomCollectUrl(expectedCollectUrl)) throw new Error("ROOM_FORM_PRODUCT_NOT_VERIFIED");
}
