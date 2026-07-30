import axios from "axios";
import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import type { RakutenItem } from "../fetcher";

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
      return "最後にリンク導線あり";
    case "problem":
      return "あるあるなら次へ";
    case "discovery":
      return "選ぶ理由を確認";
    case "use_case":
      return "使う場面を想像";
    case "proof":
      return "数字でチェック";
    case "room_bridge":
      return "ROOMで確認";
    case "cta":
      return "保存してあとで見る";
  }
}

export function buildCarouselSlides(item: RakutenItem): CarouselSlide[] {
  const name = truncate(item.itemName, 28);
  const caption = truncate(item.itemCaption || "毎日の小さなストレスを減らしてくれる便利アイテムです。", 46);
  return [
    {
      index: 1,
      kind: "hook",
      badge: "01",
      headline: truncate("これ、地味に生活変わる", 34),
      body: truncate(`✨ ${name}、ただの商品画像だけだと良さが伝わらないんです…！`, 82),
    },
    {
      index: 2,
      kind: "problem",
      badge: "02",
      headline: truncate("その小さな不便、放置しがち", 34),
      body: truncate("😳 毎日使う場所ほど、少しの面倒が積み重なってストレスになります。", 82),
    },
    {
      index: 3,
      kind: "discovery",
      badge: "03",
      headline: truncate("選ぶ理由はここ", 34),
      body: truncate(`💡 ${caption}`, 82),
    },
    {
      index: 4,
      kind: "use_case",
      badge: "04",
      headline: truncate("使う場面が想像しやすい", 34),
      body: truncate("🙌 キッチン、洗面台、玄関まわり。散らかりやすい場所に置くと効果が見えます。", 82),
    },
    {
      index: 5,
      kind: "proof",
      badge: "05",
      headline: truncate("買う前に見たい数字", 34),
      body: truncate(`👀 ${proofLine(item)}`, 82),
    },
    {
      index: 6,
      kind: "room_bridge",
      badge: "06",
      headline: truncate("楽天ROOMにまとめています", 34),
      body: truncate("🛒 気になったらプロフィールのROOMから、商品名で探せるようにしておきます。", 82),
    },
    {
      index: 7,
      kind: "cta",
      badge: "07",
      headline: truncate("あとで見返せるように保存", 34),
      body: truncate("📌 似た悩みがある人は保存して、買いまわり前にチェックしてみてください。", 82),
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
  return out.slice(0, 3);
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

export function renderSlideSvg(slide: CarouselSlide, item: RakutenItem, options: CarouselWriteOptions = {}): string {
  const accent = accentColor(slide.kind);
  const headlineLines = lines(slide.headline, 13);
  const bodyLines = lines(slide.body, 18);
  const productName = truncate(item.itemName, 34);
  const guideImage = characterHref(options);
  const headlineSvg = headlineLines
    .map((line, i) => `<text x="78" y="${174 + i * 70}" class="headline">${escapeXml(line)}</text>`)
    .join("\n");
  const bodySvg = bodyLines
    .map((line, i) => `<text x="118" y="${362 + i * 43}" class="body">${escapeXml(line)}</text>`)
    .join("\n");
  const characterSvg = guideImage
    ? `<image href="${escapeXml(guideImage)}" x="642" y="520" width="390" height="438" preserveAspectRatio="xMidYMax meet"/>`
    : "";

  return `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1080" viewBox="0 0 1080 1080">
  <style>
    .badge { font: 700 34px Arial, sans-serif; fill: #ffffff; }
    .eyebrow { font: 700 28px Arial, sans-serif; fill: ${accent}; }
    .headline { font: 800 58px Arial, sans-serif; fill: #111827; }
    .body { font: 700 32px Arial, sans-serif; fill: #263445; }
    .small { font: 600 25px Arial, sans-serif; fill: #475569; }
    .proof { font: 800 34px Arial, sans-serif; fill: #111827; }
    .label { font: 700 22px Arial, sans-serif; fill: #ffffff; }
  </style>
  <rect width="1080" height="1080" fill="#f4f7fb"/>
  <rect x="36" y="36" width="1008" height="1008" rx="30" fill="#ffffff"/>
  <rect x="36" y="36" width="1008" height="14" fill="${accent}"/>
  <circle cx="936" cy="150" r="104" fill="${accent}" opacity="0.10"/>
  <circle cx="1000" cy="86" r="62" fill="${accent}" opacity="0.14"/>
  <rect x="72" y="72" width="116" height="62" rx="31" fill="${accent}"/>
  <text x="102" y="114" class="badge">${escapeXml(slide.badge)}</text>
  <text x="216" y="113" class="eyebrow">買ってよかった候補</text>
  ${headlineSvg}
  <rect x="78" y="292" width="622" height="210" rx="30" fill="#ffffff" stroke="${accent}" stroke-width="4"/>
  <path d="M680 448 L738 486 L690 416 Z" fill="#ffffff" stroke="${accent}" stroke-width="4"/>
  ${bodySvg}
  <rect x="72" y="548" width="520" height="384" rx="30" fill="#e5edf3"/>
  <rect x="94" y="570" width="476" height="340" rx="24" fill="#ffffff"/>
  <image href="${escapeXml(item.imageUrl)}" x="114" y="590" width="436" height="260" preserveAspectRatio="xMidYMid meet"/>
  <text x="116" y="878" class="small">${escapeXml(productName)}</text>
  <rect x="600" y="820" width="406" height="116" rx="28" fill="#f8fafc" stroke="#dbe4ee" stroke-width="2"/>
  <text x="630" y="864" class="proof">${escapeXml(formatPrice(item.itemPrice))}</text>
  <text x="630" y="908" class="small">${escapeXml(item.reviewAverage && item.reviewCount ? `★${item.reviewAverage} / ${item.reviewCount}件` : truncate(item.shopName, 18))}</text>
  <rect x="684" y="950" width="292" height="66" rx="33" fill="${accent}"/>
  <text x="830" y="993" text-anchor="middle" class="label">${escapeXml(actionLabel(slide.kind))}</text>
  ${characterSvg}
  <text x="76" y="1008" class="small">プロフィールの楽天ROOMからチェック 🛒</text>
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
