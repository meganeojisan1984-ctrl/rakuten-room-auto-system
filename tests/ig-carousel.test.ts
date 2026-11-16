import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  mapAssetToPublicUrl,
  publishCarouselAssetsToGitHub,
  type CarouselAsset,
} from "../src/ig/carousel";

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

