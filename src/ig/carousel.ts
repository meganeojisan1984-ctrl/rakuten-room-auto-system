import axios from "axios";
import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import type { RakutenItem } from "../fetcher";
import { cleanProductDisplayName, extractProductFacts, isSoftwareProduct } from "./product-copy";
import type { ProductContentBrief } from "../content-brief";

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
  backgroundImagePaths?: string[];
}

export interface CarouselBuildOptions {
  now?: Date;
  brief?: ProductContentBrief;
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
      return "悩みを整理";
    case "problem":
      return "商品説明を確認";
    case "discovery":
    case "use_case":
      return "選ぶヒント";
    case "proof":
      return "価格とレビュー";
    case "room_bridge":
    case "cta":
      return "ROOM・いいね・フォロー";
  }
}
export function buildCarouselSlides(item: RakutenItem, options: CarouselBuildOptions = {}): CarouselSlide[] {
  const name = cleanProductDisplayName(item.itemName) || "商品名は商品ページで確認";
  const facts = options.brief?.facts ?? extractProductFacts(item.itemCaption, 2);
  const imageComment = options.brief?.imageComment ?? "商品説明と価格・レビューを確認";
  return [
    {
      index: 1,
      kind: "hook",
      badge: "01",
      headline: options.brief ? "こんな悩みありませんか？" : "商品選びで迷っていませんか？",
      body: options.brief ? truncate(options.brief.problem, 82) : "商品名だけでは違いがわかりにくいことも。説明と条件を見て、自分に合うか確かめましょう。",
    },
    {
      index: 2,
      kind: "problem",
      badge: "02",
      headline: options.brief ? `${options.brief.category}で解決のヒント` : "購入前に確認したい特徴",
      body: options.brief ? truncate(options.brief.solution, 82) : truncate(facts[0] ?? "気になる仕様を商品ページで確認しましょう。", 82),
    },
    {
      index: 3,
      kind: "use_case",
      badge: "03",
      headline: options.brief ? "商品情報で確かめること" : "説明を見て選ぶヒント",
      body: truncate(facts[1] ?? `${name}の仕様を希望条件と比べて確認しましょう。`, 82),
    },
    {
      index: 4,
      kind: "proof",
      badge: "04",
      headline: truncate("価格とレビューを確認", 34),
      body: truncate(options.brief?.proofLine ?? proofLine(item), 82),
    },
    {
      index: 5,
      kind: "cta",
      badge: "05",
      headline: truncate("プロフィールから楽天ROOMへ", 34),
      body: options.brief
        ? truncate(`${options.brief.purchaseCta}。保存・いいね・フォローもお願いします。`, 82)
        : truncate("商品一覧はプロフィールの楽天ROOMへ。気になったら保存・いいね・フォローもお願いします。", 82),
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
  let offset = 0;
  while (offset < chars.length) {
    let end = Math.min(offset + maxChars, chars.length);
    if (end < chars.length) {
      const chunk = chars.slice(offset, end).join("");
      const lastSpace = chunk.lastIndexOf(" ");
      const breaksWord = /[A-Za-z0-9]$/u.test(chars[end - 1]!) && /^[A-Za-z0-9]/u.test(chars[end]!);
      if (breaksWord && lastSpace >= Math.ceil(maxChars * 0.4)) end = offset + lastSpace;
    }
    out.push(chars.slice(offset, end).join(""));
    offset = end;
    while (chars[offset] === " ") offset++;
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
  const filePath = options.backgroundImagePath !== undefined
    ? options.backgroundImagePath
    : process.env.IG_CAROUSEL_BACKGROUND_IMAGE_PATH || DEFAULT_BACKGROUND_IMAGE;
  return fs.existsSync(filePath) ? imageDataUri(filePath) : "";
}

export function renderSlideSvg(slide: CarouselSlide, item: RakutenItem, options: CarouselWriteOptions = {}): string {
  const accent = accentColor(slide.kind);
  const headlineLines = lines(slide.headline, 15);
  const bodyLines = lines(slide.body, 22);
  const productName = cleanProductDisplayName(item.itemName) || "商品名は商品ページで確認";
  const productNameLines = twoLineText(productName, 16);
  const productTitleSvg = tspanText(88, 884, "productTitle", productNameLines, 34);
  const softwareProduct = isSoftwareProduct(item.itemName);
  const guideImage = softwareProduct ? "" : characterHref(options);
  const roomImage = softwareProduct && !options.backgroundImagePath ? "" : backgroundHref(options);
  const backgroundSvg = roomImage
    ? `<image href="${escapeXml(roomImage)}" x="0" y="0" width="1080" height="1080" preserveAspectRatio="xMidYMid slice"/>`
    : `<rect width="1080" height="1080" fill="${softwareProduct ? "#e8eef4" : "#d8dccf"}"/>`;
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
    const coverTitleLines = lines(slide.headline, 10);
    const coverBodyLines = lines(slide.body, 11);
    const coverProductLines = twoLineText(productName, 15);
    const coverTitleSvg = coverTitleLines
      .map((line, i) => `<text x="104" y="${382 + i * 70}" class="coverTitle">${escapeXml(line)}</text>`)
      .join("\n");
    const coverProductSvg = coverProductLines
      .map((line, i) => `<text x="770" y="${727 + i * 38}" text-anchor="middle" class="coverProduct">${escapeXml(line)}</text>`)
      .join("\n");
    const coverBodySvg = coverBodyLines
      .map((line, i) => `<text x="104" y="${520 + i * 46}" class="coverBody">${escapeXml(line)}</text>`)
      .join("\n");
    return `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1080" viewBox="0 0 1080 1080">
  <style>
    .coverTitle { font: 800 58px 'Noto Sans CJK JP', sans-serif; fill: #17233f; letter-spacing: 0; }
    .coverBody { font: 600 31px 'Noto Sans CJK JP', sans-serif; fill: #334155; letter-spacing: 0; }
    .coverProduct { font: 700 28px 'Noto Sans CJK JP', sans-serif; fill: #263445; letter-spacing: 0; }
    .swipe { font: 600 25px 'Noto Sans CJK JP', sans-serif; fill: #334155; letter-spacing: 2px; }
  </style>
  ${backgroundSvg}
  <rect x="54" y="160" width="972" height="760" rx="42" fill="#ffffff"/>
  <rect x="552" y="244" width="436" height="446" rx="26" fill="#f1f5f9"/>
  <image href="${escapeXml(item.imageUrl)}" x="584" y="276" width="372" height="350" preserveAspectRatio="xMidYMid meet"/>
  ${coverTitleSvg}
  ${coverBodySvg}
  ${coverProductSvg}
  <text x="104" y="838" class="swipe">商品ページで詳細を確認</text>
  <text x="970" y="872" text-anchor="end" class="swipe">SWIPE →</text>
</svg>`;
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1080" viewBox="0 0 1080 1080">
  <style>
    .pageNum { font: 500 46px 'Noto Sans CJK JP', sans-serif; fill: #17233f; }
    .panelHeadline { font: 800 52px 'Noto Sans CJK JP', sans-serif; fill: #ffffff; letter-spacing: 0; }
    .panelBody { font: 800 36px 'Noto Sans CJK JP', sans-serif; fill: #ffffff; letter-spacing: 0; }
    .productTitle { font: 800 28px 'Noto Sans CJK JP', sans-serif; fill: #263445; letter-spacing: 0; }
    .productMeta { font: 800 30px 'Noto Sans CJK JP', sans-serif; fill: #334155; letter-spacing: 0; }
    .footer { font: 700 29px 'Noto Sans CJK JP', sans-serif; fill: #334155; letter-spacing: 0; }
    .label { font: 800 24px 'Noto Sans CJK JP', sans-serif; fill: #ffffff; letter-spacing: 0; }
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

async function loadProductImageDataUri(url: string): Promise<string> {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:") throw new Error("商品画像URLはHTTPSが必要です");
  const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`商品画像を取得できません (${response.status})`);
  const mimeType = (response.headers.get("content-type") ?? "").split(";")[0]!.toLowerCase();
  if (!new Set(["image/jpeg", "image/png", "image/webp"]).has(mimeType)) {
    throw new Error(`商品画像の形式に対応していません: ${mimeType || "unknown"}`);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength === 0 || bytes.byteLength > 20 * 1024 * 1024) {
    throw new Error("商品画像のサイズが不正です");
  }
  return `data:${mimeType};base64,${Buffer.from(bytes).toString("base64")}`;
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
  const renderItem = options.renderer ? item : { ...item, imageUrl: await loadProductImageDataUri(item.imageUrl) };
  fs.mkdirSync(outputDir, { recursive: true });

  const assets: CarouselAsset[] = [];
  for (const slide of slides) {
    const fileName = `${day}-${stamp}-${hash}-${String(slide.index).padStart(2, "0")}.jpg`;
    const filePath = path.join(outputDir, fileName);
    const slideBackground = options.backgroundImagePaths?.[slide.index - 1];
    const slideOptions = slideBackground ? { ...options, backgroundImagePath: slideBackground } : options;
    await renderer(renderSlideSvg(slide, renderItem, slideOptions), filePath);
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
