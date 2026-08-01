import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  buildCarouselSlides,
  mapAssetToPublicUrl,
  writeCarouselImages,
  publishCarouselAssetsToGitHub,
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
    { index: 2, kind: "problem", headline: "A&B <収納>", body: "保存してあとで見る", badge: "02" },
    item,
  );
  assert.match(svg, /<svg/);
  assert.match(svg, /A&amp;B &lt;収納&gt;/);
  assert.match(svg, /https:\/\/example\.com\/product\.jpg/);
});

test("carousel slides use friendly emoji copy and character speech bubble", () => {
  const dir = fs.mkdtempSync(path.join(process.cwd(), "tmp-carousel-character-"));
  try {
    const iconPath = path.join(dir, "icon.png");
    const backgroundPath = path.join(dir, "room.png");
    fs.writeFileSync(iconPath, Buffer.from("fake-png"));
    fs.writeFileSync(backgroundPath, Buffer.from("fake-room"));
    const slides = buildCarouselSlides(item);
    assert.equal(slides.some((slide) => /[✨😳💡🙌👀🛒📌]/u.test(slide.body)), true);
    const coverSvg = renderSlideSvg(slides[0]!, item, { characterImagePath: iconPath, backgroundImagePath: backgroundPath });
    assert.match(coverSvg, /data:image\/png;base64/);
    assert.match(coverSvg, /<text x="540" y="393" text-anchor="middle" class="coverKicker">/);
    assert.match(coverSvg, /<text x="540" y="538" text-anchor="middle" class="coverTitle">おすすめの/);
    assert.match(coverSvg, /<text x="960" y="1000" text-anchor="end" class="swipe">SWIPE/);

    const svg = renderSlideSvg(slides[1]!, item, { characterImagePath: iconPath, backgroundImagePath: backgroundPath });
    assert.match(svg, /data:image\/png;base64/);
    assert.match(svg, /<path d="M34 86 A52 52 0 1 1 34 190 L150 138 Z"/);
    assert.match(svg, /<rect x="34" y="278" width="1012" height="300" rx="54" class="messagePanel"/);
    assert.match(svg, /<rect x="34" y="624" width="638" height="348" rx="0" class="productCard"/);
    assert.match(svg, /x="686" y="608" width="322" height="382"/);
    assert.match(svg, /x="704" y="954" width="326" height="70"/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
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
    assert.equal(assets.every((asset: CarouselAsset) => asset.publicUrl.endsWith(".svg")), true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("writeCarouselImages writes jpeg files for Instagram media URLs", async () => {
  const dir = fs.mkdtempSync(path.join(process.cwd(), "tmp-carousel-jpeg-"));
  try {
    const slides = buildCarouselSlides(item);
    const assets = await writeCarouselImages(item, slides, {
      outputDir: dir,
      publicBaseUrl: "https://cdn.example.com/ig",
      now: new Date("2026-07-30T01:02:03Z"),
      renderer: async (svg, filePath) => {
        assert.match(svg, /<svg/);
        fs.writeFileSync(filePath, "fake-jpeg");
      },
    });
    assert.equal(assets.length, 7);
    assert.ok(fs.existsSync(assets[0]!.filePath));
    assert.equal(assets.every((asset: CarouselAsset) => asset.filePath.endsWith(".jpg")), true);
    assert.equal(assets.every((asset: CarouselAsset) => asset.publicUrl.endsWith(".jpg")), true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("mapAssetToPublicUrl rejects missing public base url", () => {
  assert.throws(() => mapAssetToPublicUrl("slide.svg", ""));
});

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
  assert.equal(calls.filter((call) => call.params.is_carousel_item === true).length, 3);
  assert.equal(
    calls.some((call) => call.params.media_type === "CAROUSEL" && call.params.children === "child-1,child-2,child-3"),
    true,
  );
  assert.equal(calls.at(-1)?.url.endsWith("/media_publish"), true);
});

test("isCarouselEnabled requires enabled flag and public base url", async () => {
  const { isCarouselEnabled } = await import("../src/ig/carousel");
  assert.equal(
    isCarouselEnabled({ IG_CAROUSEL_ENABLED: "1", IG_CAROUSEL_PUBLIC_BASE_URL: "https://cdn.example.com/ig" }),
    true,
  );
  assert.equal(isCarouselEnabled({ IG_CAROUSEL_ENABLED: "1" }), false);
  assert.equal(isCarouselEnabled({ IG_CAROUSEL_PUBLIC_BASE_URL: "https://cdn.example.com/ig" }), false);
});

test("publishCarouselAssetsToGitHub uploads files and rewrites raw public urls", async () => {
  const dir = fs.mkdtempSync(path.join(process.cwd(), "tmp-carousel-upload-"));
  try {
    const filePath = path.join(dir, "slide.jpg");
    fs.writeFileSync(filePath, "jpeg-bytes");
    const calls: Array<{ method: string; url: string; body?: Record<string, unknown> }> = [];
    const client = {
      get: async (url: string) => {
        calls.push({ method: "get", url });
        const err = new Error("missing") as Error & { response?: { status: number } };
        err.response = { status: 404 };
        throw err;
      },
      put: async (url: string, body: Record<string, unknown>) => {
        calls.push({ method: "put", url, body });
        return { data: { content: { path: "public/generated/instagram/slide.jpg" } } };
      },
    };
    const uploaded = await publishCarouselAssetsToGitHub(
      [{ filePath, publicUrl: "https://old.example.com/slide.jpg", page: 1 }],
      {
        repository: "owner/repo",
        branch: "main",
        token: "token",
        client,
        waitMs: async () => {},
      },
    );
    assert.equal(calls.some((call) => call.method === "put"), true);
    assert.equal(
      calls.find((call) => call.method === "put")?.body?.content,
      Buffer.from("jpeg-bytes").toString("base64"),
    );
    assert.match(uploaded[0]!.publicUrl, /^https:\/\/raw\.githubusercontent\.com\/owner\/repo\/main\/tmp-carousel-upload-.*\/slide\.jpg$/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
