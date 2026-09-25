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
import { buildImageCreativePlan } from "../src/ig/image-creative";

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

test("buildCarouselSlides creates five mobile-readable slides", () => {
  const slides = buildCarouselSlides(item);
  assert.equal(slides.length, 5);
  assert.deepEqual(slides.map((s) => s.kind), [
    "hook",
    "problem",
    "use_case",
    "proof",
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

test("carousel slides follow a product-grounded problem-to-ROOM story", () => {
  const dir = fs.mkdtempSync(path.join(process.cwd(), "tmp-carousel-character-"));
  try {
    const iconPath = path.join(dir, "icon.png");
    const backgroundPath = path.join(dir, "room.png");
    fs.writeFileSync(iconPath, Buffer.from("fake-png"));
    fs.writeFileSync(backgroundPath, Buffer.from("fake-room"));
    const slides = buildCarouselSlides(item);
    assert.match(slides[0]!.headline, /迷っていませんか/);
    assert.match(slides[1]!.body, /洗面台やキッチン周りの小物をすっきり収納できます/);
    assert.match(slides[2]!.headline, /選ぶヒント/);
    assert.match(slides[3]!.body, /¥2,980.*★4\.6 \/ 128件/);
    assert.match(slides[4]!.headline, /プロフィールから楽天ROOMへ/);
    assert.match(slides[4]!.body, /保存・いいね・フォロー/);
    const coverSvg = renderSlideSvg(slides[0]!, item, { characterImagePath: iconPath, backgroundImagePath: backgroundPath });
    assert.match(coverSvg, /data:image\/png;base64/);
    assert.match(coverSvg, /<text x="104" y="382" class="coverTitle">商品選びで迷って/);
    assert.match(coverSvg, /<text x="770" y="727" text-anchor="middle" class="coverProduct">片手で使える収納ボックス/);
    assert.match(coverSvg, /商品ページで詳細を確認/);
    assert.match(coverSvg, /<text x="970" y="872" text-anchor="end" class="swipe">SWIPE/);

    const svg = renderSlideSvg(slides[1]!, item, { characterImagePath: iconPath, backgroundImagePath: backgroundPath });
    assert.match(svg, /data:image\/png;base64/);
    assert.match(svg, /<path d="M34 86 A52 52 0 1 1 34 190 L150 138 Z"/);
    assert.match(svg, /<rect x="34" y="278" width="1012" height="300" rx="54" class="messagePanel"/);
    assert.match(svg, /<rect x="34" y="624" width="638" height="348" rx="0" class="productCard"/);
    assert.match(svg, /<tspan x="88" dy="0">/);
    assert.match(svg, /<tspan x="88" dy="34">/);
    assert.match(svg, /x="686" y="608" width="322" height="382"/);
    assert.match(svg, /x="704" y="954" width="326" height="70"/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
test("carousel copy stays source-grounded and product text stays inside the card area", () => {
  const longNameItem = {
    ...item,
    itemName: "20％ポイントバック 〜08/14(金)9:59まで【DEAL】毎日使える高見えアクセサリー収納ケース",
  };
  const slides = buildCarouselSlides(longNameItem);
  assert.match(slides[0]!.headline, /迷っていませんか/);
  assert.match(slides[1]!.body, /洗面台やキッチン周りの小物をすっきり収納できます/);
  assert.match(slides[2]!.body, /毎日使える高見えアクセサリー収納ケース/);
  assert.match(slides[3]!.body, /¥2,980.*★4\.6 \/ 128件/);
  assert.match(slides[4]!.body, /保存・いいね・フォロー/);
  assert.doesNotMatch(slides.map((slide) => `${slide.headline} ${slide.body}`).join("\n"), /20％ポイントバック|08\/14|DEAL/);

  const svg = renderSlideSvg(slides[1]!, longNameItem);
  assert.doesNotMatch(svg, /20％ポイントバック 〜08\/14\(金\)9:59まで【DEAL】毎日使える高見えアクセサリー収納ケース/);
  assert.match(svg, /<text x="88" y="884" class="productTitle">/);
  assert.match(svg, /<text x="88" y="966" class="productMeta">/);
});
test("buildCarouselSlides uses food listing facts and the same story stages", () => {
  const foodItem: RakutenItem = {
    ...item,
    itemName: "訳あり濃厚チーズケーキ お取り寄せスイーツ",
    itemCaption: "冷凍庫にあると週末のおやつや来客時にも便利な人気スイーツです。",
    itemCode: "sweets:test",
  };

  const slides = buildCarouselSlides(foodItem);

  assert.match(slides[0]!.headline, /迷っていませんか/);
  assert.match(slides[1]!.body, /冷凍庫にあると週末のおやつや来客時にも便利な人気スイーツです/);
  assert.match(slides[2]!.body, /希望条件/);
  assert.doesNotMatch(slides[2]!.body, /キッチン、洗面台、玄関/);
});
test("buildCarouselSlides keeps the story consistent across posting times", () => {
  const morningSlides = buildCarouselSlides(item, {
    now: new Date("2026-09-07T07:30:00+09:00"),
  });
  const nightSlides = buildCarouselSlides(item, {
    now: new Date("2026-09-07T21:30:00+09:00"),
  });

  assert.equal(morningSlides[0]!.headline, nightSlides[0]!.headline);
  assert.equal(morningSlides[0]!.body, nightSlides[0]!.body);
  assert.match(morningSlides[0]!.headline, /迷っていませんか/);
  assert.match(nightSlides[0]!.body, /商品名だけでは違いがわかりにくい/);
});

test("creative plan supplies product-specific overlay copy exactly once", () => {
  const creativePlan = buildImageCreativePlan({
    ...item,
    itemName: "大風量ヘアドライヤー 美容家電",
    itemCaption: "大風量で髪を乾かしやすい。3段階の風量調節と冷風に対応。",
  });
  const slides = buildCarouselSlides(item, { creativePlan });
  assert.equal(slides[1]!.headline, creativePlan.slides[1]!.overlayCopy.headline);
  assert.equal(slides[1]!.body, creativePlan.slides[1]!.overlayCopy.body);
  const svg = renderSlideSvg(slides[1]!, item, { creativePlan });
  const escaped = creativePlan.slides[1]!.overlayCopy.headline.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  assert.equal((svg.match(new RegExp(escaped, "g")) ?? []).length, 1);
  assert.match(svg, /handUnderline|creative/);
});
test("brief carousel follows problem, solution, proof, and purchase CTA order", () => {
  const brief = {
    itemName: item.itemName,
    displayName: "収納ボックス",
    audience: "wife" as const,
    category: "化粧品",
    facts: ["乾燥対策に使いやすい美容液", "毎日のケアに取り入れやすい"],
    useCase: "朝晩のスキンケア",
    angle: "女性目線で続けやすさを見る",
    problem: "乾燥しやすい季節のケアに迷う",
    solution: "化粧品として毎日の保湿ケアに取り入れる",
    seasonalHook: "乾燥",
    proofLine: "12,800円・レビュー248件・★4.6",
    imageComment: "化粧品｜乾燥対策に使いやすい美容液",
    purchaseCta: "詳細は楽天ROOMで確認",
    hashtags: ["#化粧品"],
  };
  const slides = buildCarouselSlides(item, { brief });
  const story = slides.map((slide) => `${slide.headline} ${slide.body}`).join("\n");
  assert.ok(story.indexOf("乾燥") < story.indexOf("化粧品"));
  assert.ok(story.indexOf("化粧品") < story.indexOf("12,800円"));
  assert.ok(story.indexOf("12,800円") < story.indexOf("楽天ROOM"));
  assert.match(story, /化粧品｜乾燥対策に使いやすい美容液/);
  assert.match(slides[4]!.body, /ROOM/);
});
test("writeCarouselSlides writes five svg files with stable public urls", () => {
  const dir = fs.mkdtempSync(path.join(process.cwd(), "tmp-carousel-"));
  try {
    const slides = buildCarouselSlides(item);
    const assets = writeCarouselSlides(item, slides, {
      outputDir: dir,
      publicBaseUrl: "https://cdn.example.com/ig",
      now: new Date("2026-07-30T00:00:00Z"),
    });
    assert.equal(assets.length, 5);
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
    assert.equal(assets.length, 5);
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

test("AI office backgrounds appear behind the exact Office product photo and source text", async () => {
  const officeItem: RakutenItem = {
    ...item,
    itemName: "マイクロソフト Office Home 2024",
    itemCaption: "2台の Windows PC または Mac で使用可能。2024 デスクトップ版 Word、Excel、PowerPoint、OneNote を永続利用。",
    imageUrl: "https://example.com/office-home-2024.jpg",
  };
  const dir = fs.mkdtempSync(path.join(process.cwd(), "tmp-office-backgrounds-"));
  try {
    const backgroundPaths = [1, 2, 3, 4, 5].map((index) => {
      const backgroundPath = path.join(dir, `background-${index}.jpg`);
      fs.writeFileSync(backgroundPath, `generated-office-background-${index}`);
      return backgroundPath;
    });
    const rendered: string[] = [];
    await writeCarouselImages(officeItem, buildCarouselSlides(officeItem), {
      outputDir: dir,
      publicBaseUrl: "https://cdn.example.com/ig",
      backgroundImagePaths: backgroundPaths,
      renderer: async (svg) => { rendered.push(svg); },
    });

    assert.equal(rendered.length, 5);
    assert.match(rendered[0]!, /Z2VuZXJhdGVkLW9mZmljZS1iYWNrZ3JvdW5kLTE=/);
    assert.match(rendered[0]!, /https:\/\/example\.com\/office-home-2024\.jpg/);
    const visibleSecondSlideText = rendered[1]!.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ");
    const visibleThirdSlideText = rendered[2]!.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ");
    assert.match(visibleSecondSlideText, /2台の Windows PC または Mac で使用可能/);
    assert.match(visibleThirdSlideText, /2024 デスクトップ版 Word/);
    assert.match(visibleThirdSlideText, /Excel/);
    assert.match(visibleThirdSlideText, /PowerPoint/);
    assert.match(visibleThirdSlideText, /OneNote/);
    assert.match(visibleThirdSlideText, /永続利用/);
    assert.match(rendered[1]!, /Z2VuZXJhdGVkLW9mZmljZS1iYWNrZ3JvdW5kLTI=/);  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

