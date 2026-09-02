import axios from "axios";
import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import type { RakutenItem } from "../fetcher";
import { buildProductStoryProfile } from "./product-story";

export type CarouselSlideKind =
  | "hook"
  | "problem"
  | "discovery"
  | "use_case"
  | "proof"
  | "room_bridge"
  | "cta";

export interface CarouselSlide {
  index: number;
  kind: CarouselSlideKind;
  headline: string;
  body: string;
  badge: string;
}

export interface CarouselAsset {
  filePath: string;
  publicUrl: string;
  page: number;
}

export interface CarouselWriteOptions {
  outputDir?: string;
  publicBaseUrl?: string;
  now?: Date;
  renderer?: (svg: string, filePath: string) => Promise<void>;
  characterImagePath?: string;
  backgroundImagePath?: string;
}

interface HttpClient {
  post<T>(url: string, body: unknown, options: { params: Record<string, unknown>; timeout?: number }): Promise<{ data: T }>;
  get<T>(url: string, options: { params: Record<string, unknown>; timeout?: number }): Promise<{ data: T }>;
}

interface GitHubClient {
  get<T>(url: string, options?: { headers?: Record<string, string>; timeout?: number }): Promise<{ data: T }>;
  put<T>(url: string, body: Record<string, unknown>, options?: { headers?: Record<string, string>; timeout?: number }): Promise<{ data: T }>;
}

export interface PublishCarouselArgs {
  graphApiBase: string;
  igUserId: string;
  accessToken: string;
  caption: string;
  assets: CarouselAsset[];
  client?: HttpClient;
  waitMs?: (ms: number) => Promise<void>;
}

export interface GitHubAssetPublishOptions {
  repository: string;
  branch: string;
  token: string;
  client?: GitHubClient;
  waitMs?: (ms: number) => Promise<void>;
}

const DEFAULT_OUTPUT_DIR = path.join(process.cwd(), "public", "generated", "instagram");
const DEFAULT_CHARACTER_IMAGE = path.join(process.cwd(), "public", "brand", "meganeojisan-icon.png");
const DEFAULT_BACKGROUND_IMAGE = path.join(process.cwd(), "public", "brand", "lifestyle-room-bg.png");

function truncate(text: string, max: number): string {
  const compact = text.replace(/\s+/g, " ").trim();
  return compact.length > max ? `${compact.slice(0, Math.max(0, max - 1))}…` : compact;
}

function formatPrice(price: number): string {
  return `¥${price.toLocaleString("ja-JP")}`;
}

function timestamp(now: Date): string {
  return now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function proofLine(item: RakutenItem): string {
  const bits = [formatPrice(item.itemPrice)];
  if (item.reviewAverage && item.reviewCount) bits.push(`★${item.reviewAverage} / ${item.reviewCount}件`);
  if (item.hasPointBonus && item.pointRate > 1) bits.push(`ポイント${item.pointRate}倍`);
  if (item.hasCoupon) bits.push("クーポンあり");
  return bits.join(" ・ ");
}

function accentColor(kind: CarouselSlideKind): string {
  switch (kind) {
    case "hook":
      return "#0f766e";
    case "problem":
      return "#be123c";
    case "discovery":
      return "#2563eb";
    case "use_case":
      return "#7c3aed";
    case "proof":
      return "#b45309";
    case "room_bridge":
      return "#15803d";
    case "cta":
      return "#111827";
  }
}

function actionLabel(kind: CarouselSlideKind): string {
  switch (kind) {
    case "hook":
      return "最後にリンクあり";
    case "problem":
      return "あるあるなら次へ";
    case "discovery":
      return "買う理由を見る";
    case "use_case":
      return "使い方を見る";
    case "proof":
      return "価格とレビュー";
    case "room_bridge":
      return "ROOMで探す";
    case "cta":
      return "保存して見返す";
  }
}

export function buildCarouselSlides(item: RakutenItem): CarouselSlide[] {
  const name = truncate(item.itemName, 18);
  const story = buildProductStoryProfile(item);
  return [
    {
      index: 1,
      kind: "hook",
      badge: "01",
      headline: truncate(story.coverHeadline, 34),
      body: truncate(`✨ ${name}。${story.coverKicker}、ちょっと見てほしい注目アイテムです。`, 82),
    },
    {
      index: 2,
      kind: "problem",
      badge: "02",
      headline: truncate(story.problemHeadline, 34),
      body: truncate(`😳 ${story.painPoints[0]}。${story.painPoints[1]}。今ラクにしておくと、選ぶ時間まで軽くなります。`, 82),
    },
    {
      index: 3,
      kind: "use_case",
      badge: "03",
      headline: truncate(story.solutionHeadline, 34),
      body: truncate(story.useCaseBody, 82),
    },
    {
      index: 4,
      kind: "proof",
      badge: "04",
      headline: truncate("買う前に見たい数字", 34),
      body: truncate(`👀 迷ったら価格・レビュー・ポイントを確認。${proofLine(item)}なら候補に入れる価値ありです。`, 82),
    },
    {
      index: 5,
      kind: "cta",
      badge: "05",
      headline: truncate("あとで見返せるように保存", 34),
      body: truncate("📌 似た悩みがある人は保存して、買いまわり前にチェック。必要な時に見返せると買い逃しを防げます。", 82),
    },
  ];
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function lines(text: string, maxChars: number): string[] {
  const chars = [...text];
  const out: string[] = [];
  for (let i = 0; i < chars.length; i += maxChars) {
    out.push(chars.slice(i, i + maxChars).join(""));
  }
  if (out.length > 3) {
    const third = out[2]!;
    out[2] = `${third.slice(0, Math.max(0, third.length - 1))}…`;
  }
  return out.slice(0, 3);
}

function twoLineText(text: string, maxChars: number): string[] {
  const split = lines(text, maxChars).slice(0, 2);
  if (split.length < 2) return split;
  const consumed = [...split[0]!, ...split[1]!].length;
  if (consumed >= [...text].length) return split;
  const secondLine = split[1]!;
  return [split[0]!, `${secondLine.slice(0, Math.max(0, secondLine.length - 1))}…`];
}

function tspanText(x: number, y: number, className: string, textLines: string[], lineHeight: number): string {
  const spans = textLines
    .map((line, i) => `<tspan x="${x}" dy="${i === 0 ? 0 : lineHeight}">${escapeXml(line)}</tspan>`)
    .join("");
  return `<text x="${x}" y="${y}" class="${className}">${spans}</text>`;
}

function imageDataUri(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  const mime = ext === ".jpg" || ext === ".jpeg" ? "image/jpeg" : "image/png";
  return `data:${mime};base64,${fs.readFileSync(filePath).toString("base64")}`;
}

function characterHref(options: CarouselWriteOptions): string {
  const configured = options.characterImagePath ?? process.env.IG_CAROUSEL_CHARACTER_IMAGE_PATH;
  const filePath = configured || DEFAULT_CHARACTER_IMAGE;
  return fs.existsSync(filePath) ? imageDataUri(filePath) : "";
}

function backgroundHref(options: CarouselWriteOptions): string {
  const configured = options.backgroundImagePath ?? process.env.IG_CAROUSEL_BACKGROUND_IMAGE_PATH;
  const filePath = configured || DEFAULT_BACKGROUND_IMAGE;
  return fs.existsSync(filePath) ? imageDataUri(filePath) : "";
}

export function renderSlideSvg(slide: CarouselSlide, item: RakutenItem, options: CarouselWriteOptions = {}): string {
  const accent = accentColor(slide.kind);
  const headlineLines = lines(slide.headline, 15);
  const bodyLines = lines(slide.body, 22);
  const productNameLines = twoLineText(item.itemName, 16);
  const productTitleSvg = tspanText(88, 884, "productTitle", productNameLines, 34);
  const guideImage = characterHref(options);
  const roomImage = backgroundHref(options);
  const backgroundSvg = roomImage
    ? `<image href="${escapeXml(roomImage)}" x="0" y="0" width="1080" height="1080" preserveAspectRatio="xMidYMid slice"/>`
    : `<rect width="1080" height="1080" fill="#d8dccf"/>`;
  const panelHeadlineSvg = headlineLines
    .map((line, i) => `<text x="96" y="${366 + i * 58}" class="panelHeadline">${escapeXml(line)}</text>`)
    .join("\n");
  const bodySvg = bodyLines
    .map((line, i) => `<text x="96" y="${474 + i * 42}" class="panelBody">${escapeXml(line)}</text>`)
    .join("\n");
  const characterSvg = guideImage
    ? `<ellipse cx="848" cy="940" rx="118" ry="24" fill="#111827" opacity="0.16"/>
  <image href="${escapeXml(guideImage)}" x="686" y="608" width="322" height="382" preserveAspectRatio="xMidYMax meet"/>`
    : "";

  if (slide.index === 1) {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1080" viewBox="0 0 1080 1080">
  <style>
    .coverKicker { font: 700 46px Arial, sans-serif; fill: #ffffff; letter-spacing: 0; }
    .coverTitle { font: 800 84px Arial, sans-serif; fill: #ffffff; letter-spacing: 0; }
    .swipe { font: 500 28px Arial, sans-serif; fill: #ffffff; letter-spacing: 4px; }
  </style>
  ${backgroundSvg}
  <rect width="1080" height="1080" fill="#111827" opacity="0.18"/>
  <text x="540" y="393" text-anchor="middle" class="coverKicker">＼ 暮らしがグッと充実する ／</text>
  <text x="540" y="538" text-anchor="middle" class="coverTitle">おすすめの</text>
  <text x="540" y="658" text-anchor="middle" class="coverTitle">アイテム</text>
  <text x="960" y="1000" text-anchor="end" class="swipe">SWIPE</text>
</svg>`;
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1080" viewBox="0 0 1080 1080">
  <style>
    .pageNum { font: 500 46px Arial, sans-serif; fill: #17233f; }
    .panelHeadline { font: 800 52px Arial, sans-serif; fill: #ffffff; letter-spacing: 0; }
    .panelBody { font: 800 36px Arial, sans-serif; fill: #ffffff; letter-spacing: 0; }
    .productTitle { font: 800 28px Arial, sans-serif; fill: #263445; letter-spacing: 0; }
    .productMeta { font: 800 30px Arial, sans-serif; fill: #334155; letter-spacing: 0; }
    .footer { font: 700 29px Arial, sans-serif; fill: #334155; letter-spacing: 0; }
    .label { font: 800 24px Arial, sans-serif; fill: #ffffff; letter-spacing: 0; }
    .messagePanel { fill: #263445; opacity: 0.90; }
    .productCard { fill: #ffffff; filter: url(#cardShadow); }
  </style>
  <defs>
    <filter id="cardShadow" x="-20%" y="-20%" width="140%" height="150%">
      <feDropShadow dx="0" dy="16" stdDeviation="18" flood-color="#0f172a" flood-opacity="0.18"/>
    </filter>
  </defs>
  ${backgroundSvg}
  <rect width="1080" height="1080" fill="#e6eadf" opacity="0.58"/>
  <rect width="1080" height="1080" fill="#111827" opacity="0.10"/>
  <path d="M34 86 A52 52 0 1 1 34 190 L150 138 Z" fill="#17233f"/>
  <circle cx="82" cy="138" r="42" fill="#e8ebdf"/>
  <text x="82" y="155" text-anchor="middle" class="pageNum">${escapeXml(slide.badge)}</text>
  <rect x="34" y="278" width="1012" height="300" rx="54" class="messagePanel"/>
  ${panelHeadlineSvg}
  ${bodySvg}
  <rect x="34" y="624" width="638" height="348" rx="0" class="productCard"/>
  <rect x="88" y="666" width="536" height="202" rx="18" fill="#f1f8f6"/>
  <image href="${escapeXml(item.imageUrl)}" x="118" y="686" width="476" height="158" preserveAspectRatio="xMidYMid meet"/>
  ${productTitleSvg}
  <text x="88" y="966" class="productMeta">${escapeXml(`${formatPrice(item.itemPrice)} / ${item.reviewAverage && item.reviewCount ? `★${item.reviewAverage} ${item.reviewCount}件` : truncate(item.shopName, 18)}`)}</text>
  ${characterSvg}
  <rect x="704" y="954" width="326" height="70" rx="35" fill="${accent}"/>
  <text x="867" y="998" text-anchor="middle" class="label">${escapeXml(actionLabel(slide.kind))}</text>
  <text x="88" y="1030" class="footer">プロフィールの楽天ROOMからチェック 🛒</text>
</svg>`;
}

export function mapAssetToPublicUrl(fileName: string, publicBaseUrl: string): string {
  if (!publicBaseUrl.trim()) throw new Error("IG_CAROUSEL_PUBLIC_BASE_URL is required for carousel posting");
  const base = publicBaseUrl.replace(/\/+$/, "");
  return `${base}/${encodeURIComponent(fileName).replace(/%2F/g, "/")}`;
}

export function writeCarouselSlides(
  item: RakutenItem,
  slides: CarouselSlide[],
  options: CarouselWriteOptions = {},
): CarouselAsset[] {
  const outputDir = options.outputDir ?? process.env.IG_CAROUSEL_OUTPUT_DIR ?? DEFAULT_OUTPUT_DIR;
  const publicBaseUrl = options.publicBaseUrl ?? process.env.IG_CAROUSEL_PUBLIC_BASE_URL ?? "";
  const now = options.now ?? new Date();
  const day = now.toISOString().slice(0, 10);
  const stamp = timestamp(now);
  const hash = crypto.createHash("sha1").update(`${item.itemCode}|${item.itemName}`).digest("hex").slice(0, 10);
  fs.mkdirSync(outputDir, { recursive: true });

  return slides.map((slide) => {
    const fileName = `${day}-${stamp}-${hash}-${String(slide.index).padStart(2, "0")}.svg`;
    const filePath = path.join(outputDir, fileName);
    fs.writeFileSync(filePath, renderSlideSvg(slide, item, options), "utf-8");
    return {
      filePath,
      publicUrl: mapAssetToPublicUrl(fileName, publicBaseUrl),
      page: slide.index,
    };
  });
}

async function renderJpegFromSvg(svg: string, filePath: string): Promise<void> {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1080, height: 1080 }, deviceScaleFactor: 1 });
    await page.setContent(
      `<!doctype html><html><body style="margin:0;width:1080px;height:1080px;overflow:hidden">${svg}</body></html>`,
      { waitUntil: "load" },
    );
    await page.screenshot({ path: filePath, type: "jpeg", quality: 92, clip: { x: 0, y: 0, width: 1080, height: 1080 } });
  } finally {
    await browser.close();
  }
}

export async function writeCarouselImages(
  item: RakutenItem,
  slides: CarouselSlide[],
  options: CarouselWriteOptions = {},
): Promise<CarouselAsset[]> {
  const outputDir = options.outputDir ?? process.env.IG_CAROUSEL_OUTPUT_DIR ?? DEFAULT_OUTPUT_DIR;
  const publicBaseUrl = options.publicBaseUrl ?? process.env.IG_CAROUSEL_PUBLIC_BASE_URL ?? "";
  const now = options.now ?? new Date();
  const day = now.toISOString().slice(0, 10);
  const stamp = timestamp(now);
  const hash = crypto.createHash("sha1").update(`${item.itemCode}|${item.itemName}`).digest("hex").slice(0, 10);
  const renderer = options.renderer ?? renderJpegFromSvg;
  fs.mkdirSync(outputDir, { recursive: true });

  const assets: CarouselAsset[] = [];
  for (const slide of slides) {
    const fileName = `${day}-${stamp}-${hash}-${String(slide.index).padStart(2, "0")}.jpg`;
    const filePath = path.join(outputDir, fileName);
    await renderer(renderSlideSvg(slide, item, options), filePath);
    assets.push({
      filePath,
      publicUrl: mapAssetToPublicUrl(fileName, publicBaseUrl),
      page: slide.index,
    });
  }
  return assets;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const axiosClient: HttpClient = {
  post: async <T>(url: string, body: unknown, options: { params: Record<string, unknown>; timeout?: number }) => {
    return axios.post<T>(url, body, options);
  },
  get: async <T>(url: string, options: { params: Record<string, unknown>; timeout?: number }) => {
    return axios.get<T>(url, options);
  },
};

const githubClient: GitHubClient = {
  get: async <T>(url: string, options?: { headers?: Record<string, string>; timeout?: number }) => {
    return axios.get<T>(url, options);
  },
  put: async <T>(url: string, body: Record<string, unknown>, options?: { headers?: Record<string, string>; timeout?: number }) => {
    return axios.put<T>(url, body, options);
  },
};

function repoRelativePath(filePath: string): string {
  return path.relative(process.cwd(), filePath).replace(/\\/g, "/");
}

function rawGithubUrl(repository: string, branch: string, repoPath: string): string {
  return `https://raw.githubusercontent.com/${repository}/${encodeURIComponent(branch)}/${repoPath
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/")}`;
}

export async function publishCarouselAssetsToGitHub(
  assets: CarouselAsset[],
  options: GitHubAssetPublishOptions,
): Promise<CarouselAsset[]> {
  if (!options.repository || !options.branch || !options.token) {
    throw new Error("GitHub repository, branch, and token are required to publish carousel assets");
  }
  const client = options.client ?? githubClient;
  const waitMs = options.waitMs ?? sleep;
  const headers = {
    Authorization: `Bearer ${options.token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  const uploaded: CarouselAsset[] = [];

  for (const asset of assets) {
    const repoPath = repoRelativePath(asset.filePath);
    const encodedPath = repoPath.split("/").map((part) => encodeURIComponent(part)).join("/");
    const url = `https://api.github.com/repos/${options.repository}/contents/${encodedPath}`;
    let sha: string | undefined;
    try {
      const existing = await client.get<{ sha?: string }>(`${url}?ref=${encodeURIComponent(options.branch)}`, {
        headers,
        timeout: 15000,
      });
      sha = existing.data.sha;
    } catch (err) {
      const status = (err as { response?: { status?: number } }).response?.status;
      if (status !== 404) throw err;
    }

    const body: Record<string, unknown> = {
      message: `chore: publish instagram carousel asset ${path.basename(asset.filePath)} [skip ci]`,
      content: fs.readFileSync(asset.filePath).toString("base64"),
      branch: options.branch,
    };
    if (sha) body.sha = sha;
    await client.put(url, body, { headers, timeout: 30000 });
    uploaded.push({ ...asset, publicUrl: rawGithubUrl(options.repository, options.branch, repoPath) });
  }

  await waitMs(3000);
  return uploaded;
}

export async function publishInstagramCarousel(args: PublishCarouselArgs): Promise<string> {
  if (args.assets.length < 2) throw new Error("Instagram carousel requires at least two assets");
  const client = args.client ?? axiosClient;
  const waitMs = args.waitMs ?? sleep;
  const childIds: string[] = [];

  for (const asset of args.assets) {
    const res = await client.post<{ id: string }>(`${args.graphApiBase}/${args.igUserId}/media`, null, {
      params: {
        image_url: asset.publicUrl,
        is_carousel_item: true,
        access_token: args.accessToken,
      },
      timeout: 30000,
    });
    childIds.push(res.data.id);
  }

  const parent = await client.post<{ id: string }>(`${args.graphApiBase}/${args.igUserId}/media`, null, {
    params: {
      media_type: "CAROUSEL",
      children: childIds.join(","),
      caption: args.caption,
      access_token: args.accessToken,
    },
    timeout: 30000,
  });

  for (let i = 0; i < 12; i++) {
    const status = await client.get<{ status_code: string }>(`${args.graphApiBase}/${parent.data.id}`, {
      params: { fields: "status_code", access_token: args.accessToken },
      timeout: 15000,
    });
    if (status.data.status_code === "FINISHED") break;
    if (status.data.status_code === "ERROR") throw new Error("Instagram carousel media processing error");
    await waitMs(5000);
  }

  const published = await client.post<{ id: string }>(`${args.graphApiBase}/${args.igUserId}/media_publish`, null, {
    params: { creation_id: parent.data.id, access_token: args.accessToken },
    timeout: 30000,
  });
  return published.data.id;
}

export function isCarouselEnabled(env: NodeJS.ProcessEnv): boolean {
  return env.IG_CAROUSEL_ENABLED === "1" && !!env.IG_CAROUSEL_PUBLIC_BASE_URL;
}

export function getCarouselWriteOptions(env: NodeJS.ProcessEnv): CarouselWriteOptions {
  return {
    outputDir: env.IG_CAROUSEL_OUTPUT_DIR || DEFAULT_OUTPUT_DIR,
    publicBaseUrl: env.IG_CAROUSEL_PUBLIC_BASE_URL || "",
  };
}
