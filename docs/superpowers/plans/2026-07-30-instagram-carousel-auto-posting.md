# Instagram Carousel Auto Posting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build automatic Instagram carousel posts for Rakuten ROOM products with a safe fallback to the existing single-image post.

**Architecture:** Add a focused carousel content module, an SVG rendering module, and a carousel publishing path inside the existing persona Instagram engine. The existing `postToInstagramWithPersona` remains the integration point, so ROOM posting and history learning keep their current shape.

**Tech Stack:** TypeScript, Node built-in `fs/path/crypto`, existing `axios`, existing `node --test --import tsx` test runner, Instagram Graph API v21.0.

## Global Constraints

- Keep existing single-image Instagram posting as fallback.
- Use `IG_CAROUSEL_ENABLED=1` to opt into carousel posting.
- Use `IG_CAROUSEL_PUBLIC_BASE_URL` for the public HTTPS base URL of generated slide files.
- Use `IG_CAROUSEL_OUTPUT_DIR` for local output, defaulting to `public/generated/instagram`.
- Generate exactly 7 slides per item in the first version.
- Avoid new npm dependencies.
- Run `npm test` and `npm run build` before completion.

---

## File Structure

- Create `src/ig/carousel.ts`: slide data generation, SVG rendering, file writing, public URL mapping, and Graph API carousel publishing helpers.
- Modify `src/ig/ig-post-engine.ts`: call carousel helpers before the existing single-image path and fallback on failure.
- Test `tests/ig-carousel.test.ts`: focused unit tests for slide generation, SVG output, URL mapping, and mocked Graph API sequence.

### Task 1: Carousel Slide Generation And SVG Rendering

**Files:**
- Create: `src/ig/carousel.ts`
- Test: `tests/ig-carousel.test.ts`

**Interfaces:**
- Consumes: `RakutenItem` from `src/fetcher.ts`.
- Produces: `buildCarouselSlides(item: RakutenItem): CarouselSlide[]`, `renderSlideSvg(slide: CarouselSlide, item: RakutenItem): string`, `writeCarouselSlides(item: RakutenItem, slides: CarouselSlide[], options?: CarouselWriteOptions): CarouselAsset[]`.

- [ ] **Step 1: Write the failing tests**

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  buildCarouselSlides,
  mapAssetToPublicUrl,
  renderSlideSvg,
  writeCarouselSlides,
  type CarouselAsset,
} from "../src/ig/carousel";
import type { RakutenItem } from "../src/fetcher";

const item: RakutenItem = {
  itemName: "片手で使える収納ボックス 3個セット",
  itemCode: "shop:test",
  itemPrice: 2980,
  itemUrl: "https://example.com/item",
  itemCaption: "洗面台やキッチン周りの小物をすっきり収納できます。",
  imageUrl: "https://example.com/product.jpg",
  shopName: "暮らしショップ",
  pointRate: 5,
  hasCoupon: true,
  hasPointBonus: true,
  availability: 1,
  reviewAverage: 4.6,
  reviewCount: 128,
};

test("buildCarouselSlides creates seven mobile-readable slides", () => {
  const slides = buildCarouselSlides(item);
  assert.equal(slides.length, 7);
  assert.deepEqual(slides.map((s) => s.kind), [
    "hook",
    "problem",
    "discovery",
    "use_case",
    "proof",
    "room_bridge",
    "cta",
  ]);
  for (const slide of slides) {
    assert.ok(slide.headline.length > 0);
    assert.ok(slide.headline.length <= 34);
    assert.ok(slide.body.length <= 82);
  }
});

test("renderSlideSvg escapes text and includes product image", () => {
  const svg = renderSlideSvg(
    { index: 1, kind: "hook", headline: "A&B <収納>", body: "保存してあとで見る", badge: "01" },
    item,
  );
  assert.match(svg, /<svg/);
  assert.match(svg, /A&amp;B &lt;収納&gt;/);
  assert.match(svg, /https:\/\/example\.com\/product\.jpg/);
});

test("writeCarouselSlides writes seven svg files with stable public urls", () => {
  const dir = fs.mkdtempSync(path.join(process.cwd(), "tmp-carousel-"));
  try {
    const slides = buildCarouselSlides(item);
    const assets = writeCarouselSlides(item, slides, {
      outputDir: dir,
      publicBaseUrl: "https://cdn.example.com/ig",
      now: new Date("2026-07-30T00:00:00Z"),
    });
    assert.equal(assets.length, 7);
    assert.ok(fs.existsSync(assets[0]!.filePath));
    assert.equal(assets[0]!.publicUrl.startsWith("https://cdn.example.com/ig/2026-07-30-"), true);
    assert.equal(assets.every((a: CarouselAsset) => a.publicUrl.endsWith(".svg")), true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("mapAssetToPublicUrl rejects missing public base url", () => {
  assert.throws(() => mapAssetToPublicUrl("slide.svg", ""));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/ig-carousel.test.ts`

Expected: FAIL because `src/ig/carousel.ts` does not exist.

- [ ] **Step 3: Write minimal implementation**

Create `src/ig/carousel.ts` with exported types and functions. Use deterministic template copy, text truncation, XML escaping, and SVG rendering with a square 1080 viewport.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/ig-carousel.test.ts`

Expected: PASS.

### Task 2: Instagram Carousel Graph API Publisher

**Files:**
- Modify: `src/ig/carousel.ts`
- Test: `tests/ig-carousel.test.ts`

**Interfaces:**
- Consumes: `CarouselAsset[]`, final Instagram caption, `axios`-compatible HTTP client.
- Produces: `publishInstagramCarousel(args: PublishCarouselArgs): Promise<string>`.

- [ ] **Step 1: Add failing Graph API sequence test**

```ts
test("publishInstagramCarousel creates child containers before parent carousel", async () => {
  const calls: Array<{ method: string; url: string; params: Record<string, unknown> }> = [];
  const client = {
    post: async (url: string, _body: unknown, options: { params: Record<string, unknown> }) => {
      calls.push({ method: "post", url, params: options.params });
      if (options.params.media_type === "CAROUSEL") return { data: { id: "parent" } };
      if (url.endsWith("/media_publish")) return { data: { id: "published" } };
      return { data: { id: `child-${calls.length}` } };
    },
    get: async (url: string, options: { params: Record<string, unknown> }) => {
      calls.push({ method: "get", url, params: options.params });
      return { data: { status_code: "FINISHED" } };
    },
  };
  const assets = [1, 2, 3].map((n) => ({
    filePath: `slide-${n}.svg`,
    publicUrl: `https://cdn.example.com/slide-${n}.svg`,
    page: n,
  }));
  const { publishInstagramCarousel } = await import("../src/ig/carousel");
  const id = await publishInstagramCarousel({
    graphApiBase: "https://graph.instagram.com/v21.0",
    igUserId: "1789",
    accessToken: "token",
    caption: "caption",
    assets,
    client,
    waitMs: async () => {},
  });
  assert.equal(id, "published");
  assert.equal(calls.filter((c) => c.params.is_carousel_item === true).length, 3);
  assert.equal(calls.some((c) => c.params.media_type === "CAROUSEL" && c.params.children === "child-1,child-2,child-3"), true);
  assert.equal(calls.at(-1)?.url.endsWith("/media_publish"), true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/ig-carousel.test.ts`

Expected: FAIL because `publishInstagramCarousel` is not implemented.

- [ ] **Step 3: Implement publisher**

Add `PublishCarouselArgs`, create each child media with `image_url` and `is_carousel_item=true`, create parent with `media_type=CAROUSEL`, poll parent status, and call `/media_publish`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/ig-carousel.test.ts`

Expected: PASS.

### Task 3: Wire Carousel Into Persona Instagram Posting

**Files:**
- Modify: `src/ig/ig-post-engine.ts`
- Test: `tests/ig-carousel.test.ts`

**Interfaces:**
- Consumes: `buildCarouselSlides`, `writeCarouselSlides`, `publishInstagramCarousel`.
- Produces: `tryPostCarouselWithPersona(item, finalCaption): Promise<boolean>` internal helper.

- [ ] **Step 1: Add focused tests for configuration helpers**

Extend `src/ig/carousel.ts` with `isCarouselEnabled(env: NodeJS.ProcessEnv): boolean` and `getCarouselWriteOptions(env: NodeJS.ProcessEnv)`.

Test:

```ts
test("isCarouselEnabled requires enabled flag and public base url", async () => {
  const { isCarouselEnabled } = await import("../src/ig/carousel");
  assert.equal(isCarouselEnabled({ IG_CAROUSEL_ENABLED: "1", IG_CAROUSEL_PUBLIC_BASE_URL: "https://cdn.example.com/ig" }), true);
  assert.equal(isCarouselEnabled({ IG_CAROUSEL_ENABLED: "1" }), false);
  assert.equal(isCarouselEnabled({ IG_CAROUSEL_PUBLIC_BASE_URL: "https://cdn.example.com/ig" }), false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/ig-carousel.test.ts`

Expected: FAIL because configuration helpers do not exist.

- [ ] **Step 3: Implement configuration helpers and integration**

In `postToInstagramWithPersona`, after building `finalCaption`, check `isCarouselEnabled(process.env)`. If true, build slides, write assets, publish carousel, return true on success. Catch carousel errors, log them, and continue to the existing single-image code.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/ig-carousel.test.ts`

Expected: PASS.

### Task 4: Full Verification

**Files:**
- Modify as needed based on TypeScript or test failures.

**Interfaces:**
- Consumes: all prior task outputs.
- Produces: buildable and tested carousel-capable posting path.

- [ ] **Step 1: Run all tests**

Run: `npm test`

Expected: PASS.

- [ ] **Step 2: Run TypeScript build**

Run: `npm run build`

Expected: PASS.

- [ ] **Step 3: Inspect generated files manually with a dry test**

Run: `npm test -- tests/ig-carousel.test.ts`

Expected: generated SVG file assertions pass and temporary files are cleaned.

## Self-Review

- Spec coverage: The plan covers slide generation, SVG output, URL mapping, Graph carousel publishing, fallback configuration, and verification.
- Placeholder scan: No task relies on unspecified file names, function names, or test commands.
- Type consistency: `CarouselSlide`, `CarouselAsset`, `CarouselWriteOptions`, and `PublishCarouselArgs` are introduced before use.
