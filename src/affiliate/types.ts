/**
 * types.ts - X高単価アフィリエイト送客システムの型定義
 *
 * 「指揮官（Commander）」が全フローを監視し、各「エージェント（Agent）」が
 * 10個のプロンプトフローを実行する。成果物は案件ごとにGoogleスプレッドシートの
 * 新しいタブへ書き込む。
 */

// ──────────────────────────────────────────────
// 案件（アフィリエイト商材）定義 — 融通がきくよう全て任意項目
// ──────────────────────────────────────────────
export interface Offer {
  /** スラッグ。タブ名・ファイル名に使用 */
  id: string;
  /** 案件名（例: "AI学習スクール"） */
  name: string;
  /** ジャンル。未指定ならプロファイラ/フロー1が補完 */
  genre?: string;
  /** 商品価格（例: "14,800円"） */
  price?: string;
  /** 成果報酬（自由記述。例: "新規無料セミナー予約2257円 / 新規入会7519円"） */
  reward?: string;
  /** 無料面談の内容 */
  consultContent?: string;
  /** 無料面談で得られること */
  consultBenefits?: string;
  /** ターゲットのヒント（任意） */
  targetHint?: string;
  /** 現在のフォロワー数（フロー10で使用） */
  followers?: number;
  /** 目標送客数（フロー10） */
  goalLeads?: number;
  /** 目標報酬（フロー10。例: "30万円"） */
  goalRevenue?: string;
  /** その他メモ・注意事項 */
  notes?: string;
}

/**
 * 案件名だけ与えられた場合に、LLMが「調べて」補完する案件プロファイル。
 * ◯◯ プレースホルダを案件に応じて変動させるための中核データ。
 */
export interface OfferProfile {
  genre: string;
  priceBand: string;
  rewardModel: string;
  consultContent: string;
  consultBenefits: string;
  targetSummary: string;
  /** 信憑性に関する注意（誇大表現・薬機/景表法リスク等） */
  cautions: string[];
}

// ──────────────────────────────────────────────
// 各フローの出力アイテム
// ──────────────────────────────────────────────

/** フロー1: 売れるジャンル候補 */
export interface GenreCandidate {
  genre: string;
  target: string;
  pain: string;
  consultReason: string;
  xTheme: string;
  appeal: string;
  caution: string;
  /** セレクタが付与する適合スコア(0-100) */
  fitScore?: number;
}

/** フロー2: ターゲット候補 */
export interface TargetCandidate {
  name: string;
  ageRange: string;
  pain: string;
  idealFuture: string;
  whyNow: string;
  hitWords: string;
  missWords: string;
  consultHook: string;
  fitScore?: number;
}

/** フロー3: アカウントコンセプト候補 */
export interface ConceptCandidate {
  concept: string;
  profileText: string;
  theme: string;
  audience: string;
  pinnedDirection: string;
  consultFunnel: string;
  differentiation: string;
  fitScore?: number;
}

/** フロー4: 見込み客を集めるX投稿 */
export interface CollectPost {
  type: string;
  text: string;
  psychology: string;
  consultLink: string;
  imagePrompt?: string;
}

/** フロー5: 無料面談へ誘導する固定ポスト */
export interface PinnedPost {
  text: string;
  openingAim: string;
  audience: string;
  consultReason: string;
  improvement: string;
  imagePrompt?: string;
}

/** フロー6: DM誘導テンプレート */
export interface DmTemplate {
  stage: string; // 初回 / 興味あり / 迷い / 日程調整 / 追撃
  text: string;
}

/** フロー7: 教育投稿 */
export interface EducationPost {
  type: string;
  text: string;
  aim: string;
  emotion: string;
  consultBridge: string;
  imagePrompt?: string;
}

/** フロー8: オファー文（改善版） */
export interface OfferCopy {
  consultName: string;
  catchCopy: string;
  applyMerit: string;
  notApplyDemerit: string;
  targetWho: string;
  notTargetWho: string;
  applyFunnelText: string;
  pinnedShort: string;
  dmShort: string;
  profileShort: string;
}

/** フロー9: 見込み客診断ルブリック（運用時に使うテンプレート） */
export interface DiagnosisRubric {
  grade: string; // S/A/B/C の定義
  criteria: string;
  hitAppeal: string;
  avoidWords: string;
  dmText: string;
  timing: string;
  closeProbability: string;
  nextAction: string;
}

/**
 * フロー11: 長文記事（note / X長文記事 / ブログ）
 * バズ事例の「方法公開型 / 比較型 / ロードマップ型」を再現し、
 * 記事だけで悩みが解決する“具体的な価値”を提供してから無料面談へ橋渡しする。
 */
export interface Article {
  /** 想定媒体: note / X長文記事 / ブログ */
  format: string;
  /** 構成パターン: 方法公開型 / 比較・ティアリスト型 / ロードマップ型 */
  pattern: string;
  /** 思わずクリックしたくなるタイトル */
  title: string;
  /** 冒頭フック（1〜3行） */
  lead: string;
  /** Markdown本文（見出し・箇条書き・具体的手順/数字つき） */
  body: string;
  /** 無料面談への自然な誘導CTA */
  cta: string;
  /** カバー画像のChatGPTプロンプト */
  coverImagePrompt?: string;
  /** 概算文字数 */
  charCount?: number;
}

/** フロー10: 30日ロードマップ（1日分） */
export interface RoadmapDay {
  day: number;
  todo: string;
  postTheme: string;
  postExample: string;
  replyStrategy: string;
  dmTask: string;
  consultFunnel: string;
  metricToWatch: string;
  improvement: string;
}

// ──────────────────────────────────────────────
// 指揮官（Commander）レビュー
// ──────────────────────────────────────────────
export type Verdict = "approve" | "revise";

export interface CommanderReview {
  flow: string;
  /** 信憑性 0-100（誇大・虚偽・コンプラ違反がないか） */
  credibility: number;
  /** 完成度 0-100（フォーマット網羅・実用性） */
  completeness: number;
  /** 価値の具体性 0-100（数字/固有名詞/手順があり保存・行動に値するか） */
  valueConcreteness: number;
  verdict: Verdict;
  issues: string[];
  /** 再生成時にエージェントへ渡す具体的フィードバック */
  feedback: string;
}

// ──────────────────────────────────────────────
// キャンペーン全体のコンテキスト & 結果
// ──────────────────────────────────────────────
export interface CampaignContext {
  offer: Offer;
  profile: OfferProfile;
  chosenGenre: GenreCandidate;
  chosenTarget: TargetCandidate;
  chosenConcept: ConceptCandidate;
  consultContent: string;
  consultBenefits: string;
}

export interface FlowOutput<T> {
  items: T[];
  review: CommanderReview;
  /** 再生成（リトライ）が行われたか */
  revised: boolean;
}

export interface CampaignResult {
  offer: Offer;
  profile: OfferProfile;
  generatedAt: string;
  genres: FlowOutput<GenreCandidate>;
  targets: FlowOutput<TargetCandidate>;
  concepts: FlowOutput<ConceptCandidate>;
  collectPosts: FlowOutput<CollectPost>;
  pinnedPosts: FlowOutput<PinnedPost>;
  dms: FlowOutput<DmTemplate>;
  educationPosts: FlowOutput<EducationPost>;
  offerCopy: FlowOutput<OfferCopy>;
  diagnosis: FlowOutput<DiagnosisRubric>;
  roadmap: FlowOutput<RoadmapDay>;
  articles: FlowOutput<Article>;
  /** 指揮官による総合所見 */
  commanderSummary: string;
  /** 全フローの平均スコア */
  overallCredibility: number;
  overallCompleteness: number;
}
