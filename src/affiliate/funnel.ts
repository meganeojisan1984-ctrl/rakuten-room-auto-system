/**
 * funnel.ts - 誘導先（CTA）設定の読み込みとCTA指示の生成
 *
 * 投稿/DM/記事の最終CTAを「LINE登録 / ブログ記事 / 無料面談」で切り替える。
 * 設定はリポジトリ直下の affiliate.config.json（GitHubアプリで直接編集可）と
 * 環境変数の両方から読み込む（環境変数が優先）。
 */
import fs from "fs";
import path from "path";
import type { FunnelConfig, FunnelType } from "./types";

const CONFIG_PATH = path.join(process.cwd(), "affiliate.config.json");

const DEFAULT: FunnelConfig = {
  type: "line",
  lineUrl: "",
  blogUrl: "https://meganeojisanblog.com/ai-job/",
  leadMagnet: "AI副業 最初の30日ロードマップ＋プロンプト30選",
  brand: "M.O.Laboratory",
};

export function loadFunnel(): FunnelConfig {
  let cfg: FunnelConfig = { ...DEFAULT };
  if (fs.existsSync(CONFIG_PATH)) {
    try {
      cfg = { ...cfg, ...(JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8")) as Partial<FunnelConfig>) };
    } catch {
      /* 壊れていてもデフォルトで続行 */
    }
  }
  // 環境変数で上書き（GitHub Variables等から）
  const env = process.env;
  if (env.AFFILIATE_FUNNEL_TYPE) cfg.type = env.AFFILIATE_FUNNEL_TYPE as FunnelType;
  if (env.AFFILIATE_LINE_URL) cfg.lineUrl = env.AFFILIATE_LINE_URL;
  if (env.AFFILIATE_BLOG_URL) cfg.blogUrl = env.AFFILIATE_BLOG_URL;
  if (env.AFFILIATE_LEAD_MAGNET) cfg.leadMagnet = env.AFFILIATE_LEAD_MAGNET;
  if (env.AFFILIATE_BRAND) cfg.brand = env.AFFILIATE_BRAND;
  if (cfg.type !== "line" && cfg.type !== "blog" && cfg.type !== "consult") cfg.type = "line";
  return cfg;
}

export function saveFunnel(cfg: FunnelConfig): FunnelConfig {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2) + "\n", "utf-8");
  return cfg;
}

/**
 * funnel.type に応じたCTA指示文と誘導先ラベルを返す。
 * @param effectiveType 案件側で上書きされた誘導先（無ければ funnel.type）
 */
export function buildCtaGuide(
  funnel: FunnelConfig,
  consultContent: string,
  effectiveType?: FunnelType
): { guide: string; destLabel: string } {
  const type = effectiveType ?? funnel.type;

  if (type === "blog") {
    return {
      destLabel: "ブログ記事",
      guide: `【CTA = ブログ誘導（売り込み感ゼロ）】
価値を出し切った最後に「さらに詳しい手順は『${funnel.brand}』のブログにまとめてある」と自然に促す。
X投稿の本文には直リンクを貼らない（リンクは表示が伸びにくい）。「プロフィール/固定からどうぞ」等にする。
固定ポスト・DM・記事のCTAでは ${funnel.blogUrl} を案内してよい。`,
    };
  }
  if (type === "consult") {
    return {
      destLabel: "無料面談",
      guide: `【CTA = 無料面談へ誘導】
価値を出し切った最後に、無料面談（${consultContent}）で個別の最適解が分かる、と自然に促す。煽らない。`,
    };
  }
  // default: line
  return {
    destLabel: "プロフィールのLINE（無料特典）",
    guide: `【CTA = LINE登録へ誘導（2ステップ・売り込み感ゼロ）】
価値を出し切った最後に、無料特典「${funnel.leadMagnet}」をプロフィール固定のLINEから受け取れる、と自然に促す。
X投稿の本文には直リンクを貼らない（Xはリンクで表示が伸びにくい）。「受け取りはプロフ/固定のLINEから」等の言い回しにする。
固定ポスト・DM・記事のCTAでは公式LINE（${funnel.lineUrl || "プロフィールのリンク"}）への登録を案内する。
いきなり商品やスクールを売らず、まずLINE登録→無料特典→教育→の導線を意識する。`,
  };
}
