import { test } from "node:test";
import assert from "node:assert/strict";
import type { RakutenItem } from "../src/fetcher";
import type { PersonaSlot } from "../src/persona/persona";
import { buildXDraftAttachments, buildXDraftText, postToInstagramWithPersona } from "../src/ig/ig-post-engine";

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

const persona: PersonaSlot = {
  id: "slot1",
  name: "一人暮らしQOL上げる家電",
  priceBand: [2000, 8000],
  trackingId: "slot1-qol",
  genres: ["整理収納・片付けグッズ"],
  tone: "一人暮らしの実感ベースで伝える",
  hashtags: ["#一人暮らしQOL"],
  ngWords: [],
  ctaLine: "詳細はプロフのリンク",
};

test("postToInstagramWithPersona falls back to single product image when carousel media fetch fails", async () => {
  const previousEnv = { ...process.env };
  process.env.IG_USER_ID = "1789";
  process.env.IG_ACCESS_TOKEN = "token";
  process.env.IG_CAROUSEL_ENABLED = "1";
  process.env.IG_CAROUSEL_PUBLIC_BASE_URL = "https://raw.githubusercontent.com/owner/repo/main/public/generated/instagram";
  process.env.OPENAI_API_KEY = "test-openai-key";

  const calls: string[] = [];
  try {
    const ok = await (postToInstagramWithPersona as unknown as Function)(item, "ROOM caption", persona, {
      buildCaption: async () => "IG caption",
      createAssets: async () => [
        {
          filePath: "slide-01.jpg",
          publicUrl: "https://raw.githubusercontent.com/owner/repo/main/public/generated/instagram/slide-01.jpg",
          page: 1,
        },
        {
          filePath: "slide-02.jpg",
          publicUrl: "https://raw.githubusercontent.com/owner/repo/main/public/generated/instagram/slide-02.jpg",
          page: 2,
        },
      ],
      publishCarousel: async () => {
        throw new Error("Only photo or video can be accepted as media type.");
      },
      sendXDraft: async () => {
        calls.push("x-draft");
      },
      singleImageClient: {
        post: async (url: string, _body: unknown, options: { params: Record<string, unknown> }) => {
          calls.push(url.endsWith("/media_publish") ? "publish-single" : "create-single");
          assert.equal(options.params.access_token, "token");
          if (url.endsWith("/media_publish")) return { data: { id: "published" } };
          assert.equal(options.params.image_url, "https://example.com/product.jpg?_ex=640x640");
          assert.equal(options.params.caption, "IG caption\n\n詳細はプロフのリンク\n\n#一人暮らしQOL");
          return { data: { id: "single-container" } };
        },
        get: async () => {
          calls.push("status-single");
          return { data: { status_code: "FINISHED" } };
        },
      },
      notify: async () => {},
      waitMs: async () => {},
    });

    assert.equal(ok, true);
    assert.deepEqual(calls, ["create-single", "status-single", "publish-single", "x-draft"]);
  } finally {
    process.env = previousEnv;
  }
});

test("buildXDraftText wraps AI-generated Threads copy with attachment and spare-image guidance", async () => {
  const assets = [1, 2, 3, 4, 5].map((page) => ({
    filePath: `slide-${page}.jpg`,
    publicUrl: `https://cdn.example.com/slide-${page}.jpg`,
    page,
  }));

  const previousEnv = { ...process.env };
  process.env.OPENAI_API_KEY = "test-openai-key";
  try {
    const text = await buildXDraftText(
      item,
      "寝るときも授乳も“涼しくキレイ”でいたいあなたへ\n\nレビューは★4.62/4440件と信頼感もバッチリ",
      assets,
      persona,
      {
        generateThreadsCopy: async (calledItem, context) => {
          assert.equal(calledItem, item);
          assert.equal(context.genre, "整理収納・片付けグッズ");
          return "【パターンA｜価格ギャップ重視型】\n伸びる確率：88％\n\n本文サンプル";
        },
      },
    );

    assert.match(text, /Threadsへの手動投稿用です/);
    assert.match(text, /【パターンA｜価格ギャップ重視型】/);
    assert.match(text, /伸びる確率：88％/);
    assert.match(text, /【添付】画像1〜4を投稿に添付/);
    assert.match(text, /【元キャプション（必要なら調整用）】/);
    assert.match(text, /【予備画像URL】/);
    assert.match(text, /https:\/\/cdn\.example\.com\/slide-5\.jpg/);
  } finally {
    process.env = previousEnv;
  }
});

test("buildXDraftText falls back to a manual-copy notice when Threads copy generation fails", async () => {
  const assets = [1, 2, 3, 4].map((page) => ({
    filePath: `slide-${page}.jpg`,
    publicUrl: `https://cdn.example.com/slide-${page}.jpg`,
    page,
  }));

  const previousEnv = { ...process.env };
  process.env.OPENAI_API_KEY = "test-openai-key";
  try {
    const text = await buildXDraftText(item, "元キャプション本文", assets, persona, {
      generateThreadsCopy: async () => {
        throw new Error("rate limited");
      },
    });

    assert.match(text, /AI生成に失敗したため/);
    assert.match(text, /元キャプション本文/);
  } finally {
    process.env = previousEnv;
  }
});

test("buildXDraftText skips AI generation when OPENAI_API_KEY is not set", async () => {
  const assets = [1, 2, 3, 4].map((page) => ({
    filePath: `slide-${page}.jpg`,
    publicUrl: `https://cdn.example.com/slide-${page}.jpg`,
    page,
  }));

  const previousEnv = { ...process.env };
  delete process.env.OPENAI_API_KEY;
  try {
    const text = await buildXDraftText(item, "元キャプション本文", assets, persona);
    assert.match(text, /OPENAI_API_KEY未設定のためAI生成をスキップ/);
  } finally {
    process.env = previousEnv;
  }
});

test("buildXDraftAttachments keeps the first four images for the main X post", () => {
  const assets = [1, 2, 3, 4, 5].map((page) => ({
    filePath: `slide-${page}.jpg`,
    publicUrl: `https://cdn.example.com/slide-${page}.jpg`,
    page,
  }));

  assert.deepEqual(buildXDraftAttachments(assets), [
    { filePath: "slide-1.jpg", filename: "x-post-01.jpg" },
    { filePath: "slide-2.jpg", filename: "x-post-02.jpg" },
    { filePath: "slide-3.jpg", filename: "x-post-03.jpg" },
    { filePath: "slide-4.jpg", filename: "x-post-04.jpg" },
  ]);
});
