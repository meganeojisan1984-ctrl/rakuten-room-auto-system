import axios from "axios";
import * as fs from "fs";
import * as path from "path";

/**
 * Instagramカルーセルの公開処理（画像の配置URL・GitHubへのアップロード・Graph APIでの投稿）。
 * 画像そのものは ai-image.ts が生成する。
 */
export interface CarouselAsset {
  filePath: string;
  publicUrl: string;
  page: number;
}

export interface CarouselWriteOptions {
  outputDir?: string;
  publicBaseUrl?: string;
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

export function mapAssetToPublicUrl(fileName: string, publicBaseUrl: string): string {
  if (!publicBaseUrl.trim()) throw new Error("IG_CAROUSEL_PUBLIC_BASE_URL is required for carousel posting");
  const base = publicBaseUrl.replace(/\/+$/, "");
  return `${base}/${encodeURIComponent(fileName).replace(/%2F/g, "/")}`;
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
