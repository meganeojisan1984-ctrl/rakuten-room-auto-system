/**
 * orchestrator.ts - キャンペーン生成の統括
 *
 * 案件 → プロファイル → フロー1〜10 を順に実行し、コンテキストを引き継ぐ。
 * 各フローは指揮官がレビューし、不合格なら1度だけ再生成する。
 * 投稿系は既出テキストと重複しないよう除去し、画像プロンプトを付与する。
 */
import type {
  CampaignContext,
  CampaignResult,
  CommanderReview,
  FlowOutput,
  Offer,
} from "./types";
import { profileOffer } from "./offers";
import {
  runCollectPosts,
  runConcept,
  runDiagnosisRubric,
  runDmTemplates,
  runEducationPosts,
  runArticles,
  runGenreSelection,
  runOfferCopy,
  runPinnedPosts,
  runRoadmap,
  runTargetDesign,
} from "./agents";
import { pickConcept, pickGenre, pickTarget, reviewFlow, summarize } from "./commander";
import { generateImagePrompts } from "./imagePrompts";
import { pace } from "./llm";

export interface RunOptions {
  /** 重複回避のための既出投稿テキスト（過去のタブ等から取得） */
  existingPosts?: string[];
  /** 進捗コールバック（UI/ログ用） */
  onProgress?: (step: string, detail?: string) => void;
}

function normalize(text: string): string {
  return text.replace(/\s+/g, "").replace(/[、。！？!?.,]/g, "").toLowerCase();
}

/** 既出・自己重複を除去（正規化後の完全一致＆高類似プレフィックスで判定） */
function dedupeBy<T>(items: T[], getText: (t: T) => string, existing: string[]): T[] {
  const seen = new Set(existing.map(normalize));
  const out: T[] = [];
  for (const it of items) {
    const key = normalize(getText(it));
    if (!key) continue;
    // 先頭40文字一致も重複とみなす
    const prefix = key.slice(0, 40);
    const dup = seen.has(key) || [...seen].some((s) => s.startsWith(prefix) && prefix.length >= 20);
    if (dup) continue;
    seen.add(key);
    out.push(it);
  }
  return out;
}

/**
 * フローを実行し、指揮官のレビューを受ける。revise なら1度だけ再生成。
 */
async function runFlow<T>(
  flow: string,
  expectedMin: number,
  ctx: { profile: CampaignContext["profile"] },
  produce: () => Promise<T[]>,
  sampleOf: (items: T[]) => string,
  onProgress?: RunOptions["onProgress"],
  valueFocused = false
): Promise<FlowOutput<T>> {
  onProgress?.(flow, "生成中");
  let items = await produce();
  let review = await reviewFlow(flow, items, expectedMin, ctx.profile, sampleOf(items), valueFocused);
  let revised = false;

  if (review.verdict === "revise") {
    onProgress?.(flow, `再生成（指揮官指摘: ${review.feedback || review.issues.join("; ") || "品質不足"}）`);
    await pace();
    const retry = await produce();
    const retryReview = await reviewFlow(flow, retry, expectedMin, ctx.profile, sampleOf(retry), valueFocused);
    // スコアが改善した方を採用
    const score = (r: CommanderReview) => r.credibility + r.completeness + r.valueConcreteness;
    if (score(retryReview) >= score(review)) {
      items = retry;
      review = retryReview;
    }
    revised = true;
  }

  onProgress?.(flow, `完了 (信憑性${review.credibility}/完成度${review.completeness}/具体性${review.valueConcreteness})`);
  return { items, review, revised };
}

export async function runCampaign(offer: Offer, opts: RunOptions = {}): Promise<CampaignResult> {
  const { existingPosts = [], onProgress } = opts;
  onProgress?.("プロファイル", `案件「${offer.name}」を分析中`);
  const profile = await profileOffer(offer);
  await pace();

  // ── フロー1: ジャンル選定 → ベスト選定 ──
  const genres = await runFlow(
    "①ジャンル選定",
    20,
    { profile },
    () => runGenreSelection(offer, profile),
    (items) => items.slice(0, 6).map((g) => `${g.genre}: ${g.pain} / ${g.appeal}`).join("\n"),
    onProgress
  );
  const { best: chosenGenre, scored: genreScored } = await pickGenre(offer, profile, genres.items);
  genres.items = genreScored;
  await pace();

  // ── フロー2: ターゲット設計 → ベスト選定 ──
  const targets = await runFlow(
    "②ターゲット設計",
    10,
    { profile },
    () => runTargetDesign(offer, profile),
    (items) => items.slice(0, 6).map((t) => `${t.name}: ${t.pain}`).join("\n"),
    onProgress
  );
  const { best: chosenTarget, scored: targetScored } = await pickTarget(offer, profile, targets.items);
  targets.items = targetScored;
  await pace();

  // コンテキスト確定
  const ctx: CampaignContext = {
    offer,
    profile,
    chosenGenre,
    chosenTarget,
    chosenConcept: {} as CampaignContext["chosenConcept"],
    consultContent: offer.consultContent || profile.consultContent,
    consultBenefits: offer.consultBenefits || profile.consultBenefits,
  };

  // ── フロー3: アカウントコンセプト → ベスト選定 ──
  const concepts = await runFlow(
    "③アカウントコンセプト",
    10,
    { profile },
    () => runConcept(ctx),
    (items) => items.slice(0, 6).map((c) => `${c.concept}: ${c.theme}`).join("\n"),
    onProgress
  );
  const { best: chosenConcept, scored: conceptScored } = await pickConcept(offer, profile, concepts.items);
  concepts.items = conceptScored;
  ctx.chosenConcept = chosenConcept;
  await pace();

  // ── フロー4: 見込み客を集めるX投稿 30 ──
  const collectPosts = await runFlow(
    "④見込み客X投稿",
    30,
    { profile },
    async () => dedupeBy(await runCollectPosts(ctx, 30, existingPosts), (p) => p.text, existingPosts),
    (items) => items.slice(0, 5).map((p) => p.text).join("\n---\n"),
    onProgress,
    true
  );
  await pace();

  // ── フロー5: 固定ポスト 10 ──
  const pinnedPosts = await runFlow(
    "⑤固定ポスト",
    10,
    { profile },
    async () => dedupeBy(await runPinnedPosts(ctx, existingPosts), (p) => p.text, existingPosts),
    (items) => items.slice(0, 4).map((p) => p.text).join("\n---\n"),
    onProgress,
    true
  );
  await pace();

  // ── フロー6: DMテンプレ ──
  const dms = await runFlow(
    "⑥DM誘導",
    5,
    { profile },
    () => runDmTemplates(ctx),
    (items) => items.map((d) => `[${d.stage}] ${d.text}`).join("\n"),
    onProgress
  );
  await pace();

  // ── フロー7: 教育投稿 20 ──
  const educationPosts = await runFlow(
    "⑦教育投稿",
    20,
    { profile },
    async () => dedupeBy(await runEducationPosts(ctx, 20, existingPosts), (p) => p.text, existingPosts),
    (items) => items.slice(0, 5).map((p) => p.text).join("\n---\n"),
    onProgress,
    true
  );
  await pace();

  // ── フロー8: オファー文 ──
  const offerCopy = await runFlow(
    "⑧オファー文",
    1,
    { profile },
    () => runOfferCopy(ctx),
    (items) => items.map((o) => `${o.consultName} / ${o.catchCopy}`).join("\n"),
    onProgress
  );
  await pace();

  // ── フロー9: 診断ルブリック ──
  const diagnosis = await runFlow(
    "⑨見込み客診断",
    1,
    { profile },
    () => runDiagnosisRubric(ctx),
    (items) => items.map((d) => d.criteria).join("\n"),
    onProgress
  );
  await pace();

  // ── フロー10: 30日ロードマップ ──
  const roadmap = await runFlow(
    "⑩30日ロードマップ",
    30,
    { profile },
    () => runRoadmap(ctx),
    (items) => items.slice(0, 4).map((d) => `Day${d.day}: ${d.todo}`).join("\n"),
    onProgress
  );
  await pace();

  // ── フロー11: 長文記事（方法公開/比較/ロードマップ型） ──
  const articles = await runFlow(
    "⑪長文記事",
    1,
    { profile },
    () => runArticles(ctx, 3),
    (items) => items.map((a) => `[${a.pattern}] ${a.title}\n${((a.body || a.thread?.join("\n")) ?? "").slice(0, 600)}`).join("\n---\n"),
    onProgress,
    true
  );

  // ── 画像プロンプト付与（投稿系のみ） ──
  onProgress?.("画像プロンプト", "ChatGPT用プロンプトを生成中");
  const collectImgs = await generateImagePrompts(ctx, collectPosts.items.map((p) => p.text));
  collectPosts.items.forEach((p, i) => (p.imagePrompt = collectImgs[i] ?? ""));
  await pace();
  const pinnedImgs = await generateImagePrompts(ctx, pinnedPosts.items.map((p) => p.text));
  pinnedPosts.items.forEach((p, i) => (p.imagePrompt = pinnedImgs[i] ?? ""));
  await pace();
  const eduImgs = await generateImagePrompts(ctx, educationPosts.items.map((p) => p.text));
  educationPosts.items.forEach((p, i) => (p.imagePrompt = eduImgs[i] ?? ""));
  await pace();
  // 記事カバー画像プロンプト（タイトル＋リードを元に生成）
  const articleImgs = await generateImagePrompts(
    ctx,
    articles.items.map((a) => `${a.title} / ${a.lead ?? ""}`)
  );
  articles.items.forEach((a, i) => (a.coverImagePrompt = articleImgs[i] ?? ""));

  // ── 総合所見 ──
  const allReviews = [
    genres.review, targets.review, concepts.review, collectPosts.review,
    pinnedPosts.review, dms.review, educationPosts.review, offerCopy.review,
    diagnosis.review, roadmap.review, articles.review,
  ];
  onProgress?.("指揮官総括", "総合所見を作成中");
  const commanderSummary = await summarize(offer, allReviews);
  const overallCredibility = Math.round(allReviews.reduce((s, r) => s + r.credibility, 0) / allReviews.length);
  const overallCompleteness = Math.round(allReviews.reduce((s, r) => s + r.completeness, 0) / allReviews.length);

  return {
    offer,
    profile,
    generatedAt: new Date().toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" }),
    genres,
    targets,
    concepts,
    collectPosts,
    pinnedPosts,
    dms,
    educationPosts,
    offerCopy,
    diagnosis,
    roadmap,
    articles,
    commanderSummary,
    overallCredibility,
    overallCompleteness,
  };
}
