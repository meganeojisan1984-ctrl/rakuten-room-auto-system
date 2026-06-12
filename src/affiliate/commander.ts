/**
 * commander.ts - 指揮官（Commander）
 *
 * 全フローを監視し、各エージェントの出力の「信憑性」と「完成度」を判定する。
 * 不十分なら revise 判定＋具体的フィードバックを返し、オーケストレータが再生成する。
 * さらにフロー1〜3の候補から案件に最適なものを選定し、総合所見を生成する。
 */
import type {
  CommanderReview,
  ConceptCandidate,
  GenreCandidate,
  Offer,
  OfferProfile,
  TargetCandidate,
  Verdict,
} from "./types";
import { generateItems, generateText, isLlmConfigured } from "./llm";

interface RawReview {
  credibility?: number;
  completeness?: number;
  valueConcreteness?: number;
  verdict?: string;
  issues?: string[];
  feedback?: string;
}

function clampScore(n: unknown, fallback: number): number {
  const v = typeof n === "number" ? n : Number(n);
  if (Number.isNaN(v)) return fallback;
  return Math.max(0, Math.min(100, Math.round(v)));
}

/**
 * フロー出力をレビューする。
 * @param flow         フロー名
 * @param expectedMin  期待される最小件数（完成度の自動判定に使用）
 * @param sample       出力サンプル（先頭数件をJSON化したもの）
 */
export async function reviewFlow(
  flow: string,
  items: unknown[],
  expectedMin: number,
  profile: OfferProfile,
  sampleText: string,
  /** 投稿/記事など「価値の具体性」を重視するフローか */
  valueFocused = false
): Promise<CommanderReview> {
  // 件数による機械的な完成度の下限
  const countRatio = expectedMin > 0 ? Math.min(1, items.length / expectedMin) : 1;

  if (!isLlmConfigured() || items.length === 0) {
    const completeness = clampScore(countRatio * 100, 0);
    return {
      flow,
      credibility: items.length === 0 ? 0 : 70,
      completeness,
      valueConcreteness: items.length === 0 ? 0 : completeness,
      verdict: items.length >= expectedMin ? "approve" : "revise",
      issues: items.length === 0 ? ["出力が空です"] : items.length < expectedMin ? ["件数が不足しています"] : [],
      feedback: items.length < expectedMin ? `${expectedMin}件以上を厳守してください。` : "",
    };
  }

  const valueNote = valueFocused
    ? `\n- valueConcreteness(価値の具体性 0-100): 【最重要】抽象論・共感だけで終わらず、固有名詞・具体的な数字・手順・序列・before→afterがあり、読者がその場で行動でき「保存したくなる」価値があるか。バズ投稿基準で厳しく。70未満は revise。`
    : `\n- valueConcreteness(価値の具体性 0-100): 内容が具体的で実用的か。`;

  const prompt = `あなたは高単価アフィリエイト案件の品質管理を行う「指揮官」です。
以下はフロー「${flow}」の生成結果（${items.length}件）のサンプルです。バズ投稿の基準で厳しく評価してください。

【案件のコンプラ注意点】
${profile.cautions.map((c) => `- ${c}`).join("\n")}

【生成結果サンプル】
${sampleText.slice(0, 3500)}

評価観点：
- credibility(信憑性 0-100): 誇大・虚偽・断定的な収入/効果保証・薬機法/景表法違反・怪しさが無いか。高いほど健全。
- completeness(完成度 0-100): 指定フォーマットの網羅・実用性・ターゲット適合。期待件数は約${expectedMin}件。${valueNote}
- verdict: "approve"（合格）または "revise"（要再生成）
- issues: 問題点の配列
- feedback: 再生成する場合にエージェントへ渡す、具体的で短い改善指示（特に「具体性が足りない」なら何を足すか明記）

次のオブジェクトを1件だけ items に入れて返す:
{credibility, completeness, valueConcreteness, verdict, issues, feedback}`;

  try {
    const arr = await generateItems<RawReview>(prompt, { temperature: 0.3, maxTokens: 900 });
    const r = arr[0] ?? {};
    const credibility = clampScore(r.credibility, 70);
    const completeness = clampScore(r.completeness ?? countRatio * 100, Math.round(countRatio * 100));
    const valueConcreteness = clampScore(r.valueConcreteness ?? completeness, completeness);
    // 90点以上を目標に、未達なら再生成（オーケストレータが回数を制御）
    let verdict: Verdict = "approve";
    if (credibility < 85 || completeness < 85 || items.length === 0 || items.length < expectedMin * 0.85) {
      verdict = "revise";
    }
    if (valueFocused && valueConcreteness < 82) verdict = "revise";
    return {
      flow,
      credibility,
      completeness,
      valueConcreteness,
      verdict,
      issues: Array.isArray(r.issues) ? r.issues : [],
      feedback: r.feedback || "",
    };
  } catch (err) {
    console.warn(`[commander] レビュー失敗(${flow}):`, String(err).slice(0, 120));
    const completeness = clampScore(countRatio * 100, 70);
    return {
      flow,
      credibility: 70,
      completeness,
      valueConcreteness: completeness,
      verdict: items.length >= expectedMin ? "approve" : "revise",
      issues: [],
      feedback: "",
    };
  }
}

// ──────────────────────────────────────────────
// 候補選定（フロー1〜3） — 案件への適合度でベストを選ぶ
// ──────────────────────────────────────────────
async function scoreAndPick<T extends { fitScore?: number }>(
  flow: string,
  offer: Offer,
  profile: OfferProfile,
  candidates: T[],
  describe: (c: T) => string
): Promise<{ best: T; scored: T[] }> {
  if (candidates.length === 0) throw new Error(`${flow}: 候補が0件です`);
  if (!isLlmConfigured() || candidates.length === 1) {
    const best = candidates[0]!;
    return { best, scored: candidates };
  }

  const listText = candidates
    .map((c, i) => `${i}. ${describe(c)}`)
    .join("\n")
    .slice(0, 3500);

  const prompt = `あなたは高単価アフィリエイトの指揮官です。案件「${offer.name}」（ジャンル: ${profile.genre} / 価格: ${offer.price || profile.priceBand} / ${profile.rewardModel}）を
Xで集客し無料面談に送客する前提で、最も成果が出そうな候補を選びます。

【適合度の評価軸（重要）】
- 案件の価格帯（${offer.price || profile.priceBand}）を個人が自己投資で払い、無料面談に申し込む現実性
- 案件の想定ターゲット像「${profile.targetSummary}」との一致度
- 価格や面談の性質と合わない層（例: 安価な個人向け案件に対する法人/経営者）は低スコアにする

【候補一覧（index. 概要）】
${listText}

各候補に index(数値) と fitScore(0-100, 適合度) を付け、items 配列で全件返してください。
上記の評価軸に最も合うものほど高スコアにすること。`;

  try {
    const scoredRaw = await generateItems<{ index: number; fitScore: number }>(prompt, {
      temperature: 0.3,
      maxTokens: 1200,
    });
    const scoreMap = new Map<number, number>();
    for (const s of scoredRaw) {
      if (typeof s.index === "number") scoreMap.set(s.index, clampScore(s.fitScore, 50));
    }
    const scored = candidates.map((c, i) => ({ ...c, fitScore: scoreMap.get(i) ?? 50 }));
    const best = [...scored].sort((a, b) => (b.fitScore ?? 0) - (a.fitScore ?? 0))[0]!;
    return { best, scored };
  } catch (err) {
    console.warn(`[commander] 選定失敗(${flow}):`, String(err).slice(0, 120));
    return { best: candidates[0]!, scored: candidates };
  }
}

export function pickGenre(offer: Offer, profile: OfferProfile, candidates: GenreCandidate[]) {
  return scoreAndPick<GenreCandidate>(
    "ジャンル選定",
    offer,
    profile,
    candidates,
    (c) => `${c.genre} | 悩み: ${c.pain} | 訴求: ${c.appeal}`
  );
}

export function pickTarget(offer: Offer, profile: OfferProfile, candidates: TargetCandidate[]) {
  return scoreAndPick<TargetCandidate>(
    "ターゲット設計",
    offer,
    profile,
    candidates,
    (c) => `${c.name}(${c.ageRange}) | 悩み: ${c.pain} | 切り口: ${c.consultHook}`
  );
}

export function pickConcept(offer: Offer, profile: OfferProfile, candidates: ConceptCandidate[]) {
  return scoreAndPick<ConceptCandidate>(
    "アカウントコンセプト",
    offer,
    profile,
    candidates,
    (c) => `${c.concept} | テーマ: ${c.theme} | 差別化: ${c.differentiation}`
  );
}

// ──────────────────────────────────────────────
// 総合所見
// ──────────────────────────────────────────────
export async function summarize(
  offer: Offer,
  reviews: CommanderReview[]
): Promise<string> {
  const avgCred = Math.round(reviews.reduce((s, r) => s + r.credibility, 0) / Math.max(1, reviews.length));
  const avgComp = Math.round(reviews.reduce((s, r) => s + r.completeness, 0) / Math.max(1, reviews.length));
  const lowFlows = reviews.filter((r) => r.verdict === "revise" || r.credibility < 70).map((r) => r.flow);

  if (!isLlmConfigured()) {
    return `案件「${offer.name}」: 平均信憑性 ${avgCred} / 平均完成度 ${avgComp}。` +
      (lowFlows.length ? ` 要注意フロー: ${lowFlows.join("、")}。` : " 全フロー良好。");
  }

  const detail = reviews
    .map((r) => `${r.flow}: 信憑性${r.credibility}/完成度${r.completeness}/具体性${r.valueConcreteness}/${r.verdict}${r.issues.length ? ` (${r.issues.join("; ")})` : ""}`)
    .join("\n");
  const prompt = `あなたは高単価アフィリエイト案件の指揮官です。案件「${offer.name}」のキャンペーン素材一式の品質レビュー結果を踏まえ、
運用者向けに「総合所見」を日本語で簡潔に（3〜6行）まとめてください。良い点・リスク・運用上の注意・最優先で直すべき点を含めること。

【各フローのレビュー】
${detail}

平均: 信憑性${avgCred} / 完成度${avgComp}

所見本文のみを出力（前置き不要）:`;
  try {
    return await generateText(prompt, { temperature: 0.5, maxTokens: 700 });
  } catch {
    return `案件「${offer.name}」: 平均信憑性 ${avgCred} / 平均完成度 ${avgComp}。`;
  }
}
