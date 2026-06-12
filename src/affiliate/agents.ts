/**
 * agents.ts - 10個のフローを実行するエージェント群
 *
 * 各エージェントはユーザー提示の元プロンプトを忠実に再現しつつ、
 * ◯◯ プレースホルダを案件コンテキスト（CampaignContext）で自動補完する。
 * 投稿系フローには「重複回避リスト」を渡し、既出と被らない内容を生成させる。
 */
import type {
  CampaignContext,
  Article,
  CollectPost,
  ConceptCandidate,
  DiagnosisRubric,
  DmTemplate,
  EducationPost,
  GenreCandidate,
  Offer,
  OfferCopy,
  OfferProfile,
  PinnedPost,
  RoadmapDay,
  TargetCandidate,
} from "./types";
import { generateItems, generateItemsBatched } from "./llm";

const POST_RULE = "Xの投稿は改行を活かして読みやすく。AI感・広告感を出さず自然な日本語で。通常投稿は140〜280字、ティアリスト/チェックリスト等の保存系は最大500字程度まで可（Xプレミアム想定）。";

/**
 * バズ投稿の鉄則。実在のバズ投稿（断定×数字のティアリスト型 / よく聞かれる質問型の
 * オファー誘導 / 結果・方法公開型）から抽出した型を各投稿エージェントへ注入する。
 * 「共感だけ」で終わらせず、その投稿だけで悩みが一歩解決する“具体的価値”を出させる。
 */
const VIRAL_CRAFT = `【バズる投稿の鉄則（必ず全て反映）】
1. 1行目フックで指を止める。次のいずれかを使う:
   - 断定×数字（例「副業で年収100万を超えるかは“選ぶ副業”で9割決まる」）
   - よく聞かれる質問（例「なぜ無料で公開してるの？とよく聞かれます」）
   - 結果/実績の公開（例「〇〇を△△で自動化したら□□になった」）
   - 常識破壊（例「実は“毎日頑張って投稿”は遠回りです」）
2. 本文は必ず“具体”で埋める。抽象論・精神論はNG。固有名詞・具体的な数字・手順(1.2.3.)・
   序列(🥇🥈🥉)・before→after・→での一言ジャッジ のうち複数を必ず使う。
3. その投稿“だけ”で読者の悩みが一歩解決する＝保存したくなる構成にする
   （使えるチェックリスト/判断基準/手順/具体例を必ず渡し切る）。
4. 価値を出し切った最後に「ここまでで足りない“あなた専用の最適解”は別途案内へ」と
   自然に橋渡し（具体的な誘導先は後述のCTA指示に従う。売り込み感ゼロ。煽らない）。
5. 「必ず稼げる」「年間〇〇万円稼げる」等、収入・効果を約束/断定する表現は書かない（景表法・特商法）。
   さらに「月収50万」「年収100万」等の具体的な収入額を“成果”として書かない。
   数字を使うなら「手順数・所要時間・件数・割合・期間」など検証可能なものに限る。
6. 必ず自然な日本語のみで書く。中国語・英語・他言語の単語や漢字（例: 獨学, 如果, 兴味）を混在させない。
7. 同じ言い回しの使い回しを避け、投稿ごとに切り口・語彙・例を変える。
8. 【具体性の必須要件・厳守】各投稿に必ず次を入れる:
   (a) 具体的な数字（所要時間/件数/割合/日数/個数 など。収入額は不可）を1つ以上
   (b) 「1. 2. 3.」の手順 または 「🥇🥈🥉」の序列 を1つ以上
   (c) 抽象的な締め（「検討してみましょう」「大切です」等）で終わらせない。具体的な次の一歩を書く

【お手本（このレベルの具体性・テンポ・自然さを目指す）】
例（チェックリスト型）:
「AI副業で“最初の1件”を最短で取る人がやってる準備、3つ。
🥇 使うツールを1つに絞る（ChatGPTかClaude、両方やらない）
🥈 1日30分だけカレンダーに固定（量より継続）
🥉 完成を待たず“応募”を5件出す
逆に、教材を10個買って満足→9割が動けないまま終わる。
順番さえ間違えなければ、1週間あれば最初の応募までいけます。
受け取りはプロフ/固定のLINEから。」`;

function avoidBlock(avoid: string[]): string {
  if (avoid.length === 0) return "";
  const list = avoid.slice(0, 40).map((t, i) => `${i + 1}. ${t.slice(0, 60)}`).join("\n");
  return `\n\n【既出（重複厳禁・必ず別の切り口にすること）】\n${list}`;
}

// ──────────────────────────────────────────────
// フロー1: 売れるジャンル選定
// ──────────────────────────────────────────────
export async function runGenreSelection(offer: Offer, profile: OfferProfile): Promise<GenreCandidate[]> {
  const prompt = `あなたはX集客と高単価アフィリエイトに強いマーケターです。
私はXで集客し、人の高単価スクールの無料面談に送客してアフィリエイト報酬を得たいです。
販売したい案件は「${offer.name}」（ジャンル目安: ${profile.genre} / ${profile.rewardModel}）です。

この案件に関連して、売れやすいジャンルを20個出してください。

条件：
・1件あたりの報酬単価が高くなりやすい
・無料面談に誘導しやすい
・悩みが深い
・今すぐ解決したい欲求がある
・Xで発信しやすい
・初心者でも集客しやすい
・怪しくなりすぎない
・継続的に需要がある

各要素を持つオブジェクトを20件:
- genre: ジャンル名
- target: ターゲット
- pain: 抱えている悩み
- consultReason: 無料面談に行きたくなる理由
- xTheme: Xで伸びる発信テーマ
- appeal: 売れやすい訴求
- caution: 注意点`;
  return generateItems<GenreCandidate>(prompt, { temperature: 0.85, maxTokens: 6000 });
}

// ──────────────────────────────────────────────
// フロー2: 売れるターゲット設計
// ──────────────────────────────────────────────
export async function runTargetDesign(offer: Offer, profile: OfferProfile): Promise<TargetCandidate[]> {
  const prompt = `あなたは高単価商品の販売導線を作るプロです。
以下の商品を、Xで集客して無料面談に送客したいです。

商品ジャンル：${profile.genre}
商品名：${offer.name}
商品価格：${offer.price || profile.priceBand}
成果報酬：${offer.reward || profile.rewardModel}
想定読者像（必ず踏襲）：${offer.targetHint || profile.targetSummary}

この商品に最も反応しやすいターゲットを10パターン作ってください。

【最重要・ターゲットの前提】
・この価格帯（${offer.price || profile.priceBand}）を“個人が自己投資”で払い、無料面談に申し込む現実的な層に限定する
・案件が明確に法人向けでない限り、経営者・法人・企業担当など価格や面談の性質と合わない層は含めない
・上記「想定読者像」から大きく外れないこと（例: 初心者向け案件なら専門家・上級者を主役にしない）

条件：
・悩みが深い
・お金を払ってでも解決したい
・無料面談に申し込みやすい
・X上に存在している
・発信で教育しやすい
・将来的に高単価商品を買う可能性が高い

各要素を持つオブジェクトを10件:
- name: ターゲット名
- ageRange: 年齢層
- pain: 現在の悩み
- idealFuture: 理想の未来
- whyNow: なぜ今すぐ変わりたいのか
- hitWords: 刺さる言葉
- missWords: 刺さらない言葉
- consultHook: 無料面談に誘導する切り口`;
  return generateItems<TargetCandidate>(prompt, { temperature: 0.85, maxTokens: 4000 });
}

// ──────────────────────────────────────────────
// フロー3: Xアカウントコンセプト
// ──────────────────────────────────────────────
export async function runConcept(ctx: CampaignContext): Promise<ConceptCandidate[]> {
  const prompt = `あなたはXで見込み客を集めるアカウント設計の専門家です。
私はXで集客し、高単価スクールの無料面談に送客するアフィリエイトを行います。

商品ジャンル：${ctx.chosenGenre.genre}
ターゲット：${ctx.chosenTarget.name}（${ctx.chosenTarget.ageRange}・${ctx.chosenTarget.pain}）

この商品を売るためのXアカウントコンセプトを10個作ってください。

条件：
・フォローする理由が明確
・無料面談に誘導しやすい
・専門家感が出る
・怪しすぎない
・毎日発信しやすい
・競合と差別化できる
・初心者でも運用しやすい

各要素を持つオブジェクトを10件:
- concept: アカウントコンセプト
- profileText: プロフィール文
- theme: 発信テーマ
- audience: 刺さるターゲット
- pinnedDirection: 固定ポストの方向性
- consultFunnel: ${ctx.destLabel}への導線
- differentiation: 競合との差別化ポイント`;
  return generateItems<ConceptCandidate>(prompt, { temperature: 0.85, maxTokens: 4000 });
}

// ──────────────────────────────────────────────
// フロー4: 見込み客を集めるX投稿 30個（バッチ生成 + 重複回避）
// ──────────────────────────────────────────────
const COLLECT_TYPES = [
  "常識破壊型", "失敗談型", "チェックリスト型", "比較型",
  "知らないと損する型", "放置リスク型", "成功者の共通点型", "初心者向けロードマップ型",
];

export async function runCollectPosts(ctx: CampaignContext, total = 30, avoid: string[] = []): Promise<CollectPost[]> {
  const build = (n: number, produced: CollectPost[]): string =>
    `あなたはXで見込み客を集める投稿作成のプロです。
以下の商品ジャンルの見込み客を集め、${ctx.destLabel}へ送客するためのX投稿を${n}個作ってください。

商品ジャンル：${ctx.chosenGenre.genre}
ターゲット：${ctx.chosenTarget.name}（${ctx.chosenTarget.pain}）
登録/相談で得られること：${ctx.consultBenefits}

${VIRAL_CRAFT}

${ctx.ctaGuide}

条件：
・売り込み感を出さない
・読者に「自分のことだ」と思わせた上で、具体的な解決のヒントまで渡し切る
・${ctx.destLabel}に興味を持たせる
・固有名詞/数字/手順/チェックリストを入れ、保存・スクショされる価値にする
・${POST_RULE}

投稿の型（type にいずれかを設定し、全体でバランスよく使う）：
${COLLECT_TYPES.join(" / ")}

各要素を持つオブジェクトを${n}件:
- type: 投稿の型
- text: 投稿文（鉄則を反映。具体的な数字/手順/序列を含める）
- psychology: 狙っている心理
- consultLink: ${ctx.destLabel}につながる理由${avoidBlock([...avoid, ...produced.map((p) => p.text)])}`;
  return generateItemsBatched<CollectPost>(build, total, 10, { temperature: 0.92, maxTokens: 5000 });
}

// ──────────────────────────────────────────────
// フロー5: 無料面談へ誘導する固定ポスト 10個
// ──────────────────────────────────────────────
export async function runPinnedPosts(ctx: CampaignContext, avoid: string[] = []): Promise<PinnedPost[]> {
  const prompt = `あなたはXから${ctx.destLabel}へ送客する導線設計のプロです。
以下の商品に興味がある見込み客を、自然に${ctx.destLabel}へ誘導する固定ポストを10個作ってください。

商品ジャンル：${ctx.chosenGenre.genre}
ターゲット：${ctx.chosenTarget.name}（${ctx.chosenTarget.pain}）
相談/特典の中身：${ctx.consultContent}

${VIRAL_CRAFT}

${ctx.ctaGuide}

条件：
・「なぜ無料で公開/配布しているのか」をリフレーム（相手の遠回りを指摘）して語る型を必ず含める
・悩みから入り、理想の未来と“受け取れる具体的中身”を見せる
・怪しく見えない／今すぐ行動したくなる
・${POST_RULE}

各要素を持つオブジェクトを10件:
- text: 固定ポスト本文（鉄則を反映。冒頭フック必須。末尾は${ctx.destLabel}への誘導）
- openingAim: 冒頭の狙い
- audience: 刺さるターゲット
- consultReason: ${ctx.destLabel}に誘導できる理由
- improvement: 改善ポイント${avoidBlock(avoid)}`;
  return generateItems<PinnedPost>(prompt, { temperature: 0.9, maxTokens: 4000 });
}

// ──────────────────────────────────────────────
// フロー6: DM誘導テンプレート（5パターン）
// ──────────────────────────────────────────────
export async function runDmTemplates(ctx: CampaignContext): Promise<DmTemplate[]> {
  const prompt = `あなたはXのDMで${ctx.destLabel}へ誘導するセールスライターです。
以下の見込み客に対して、自然に${ctx.destLabel}を案内するDM文を作ってください。

商品ジャンル：${ctx.chosenGenre.genre}
相手の悩み：${ctx.chosenTarget.pain}
相手の状況：${ctx.chosenTarget.name}（${ctx.chosenTarget.ageRange}）
案内する中身：${ctx.consultContent}

${ctx.ctaGuide}

条件：
・いきなり売り込まない
・相手の悩みに寄り添う
・押し売り感を出さない
・返信しやすい／短文で自然
・${ctx.destLabel}に進みたくなる
・怪しい表現を避ける

次の5パターンを、stage と text を持つオブジェクトとして5件:
- stage="初回DM"
- stage="興味を示した時の返信"
- stage="迷っている人への返信"
- stage="${ctx.destLabel}へ案内する文章"
- stage="既読スルー後の追撃DM"
各 text にDM本文を入れる。`;
  return generateItems<DmTemplate>(prompt, { temperature: 0.85, maxTokens: 2500 });
}

// ──────────────────────────────────────────────
// フロー7: 教育投稿 20個（バッチ生成 + 重複回避）
// ──────────────────────────────────────────────
const EDU_TYPES = [
  "独学の落とし穴", "失敗する人の共通点", "成功する人の考え方", "自己流の危険性",
  "環境投資の重要性", "時間を無駄にするリスク", "無料相談を使うべき理由",
];

export async function runEducationPosts(ctx: CampaignContext, total = 20, avoid: string[] = []): Promise<EducationPost[]> {
  const build = (n: number, produced: EducationPost[]): string =>
    `あなたは高単価商品の教育導線を作るプロです。
以下の商品を直接売らずに、X投稿で必要性を感じさせる教育投稿を${n}個作ってください。

商品ジャンル：${ctx.chosenGenre.genre}
ターゲット：${ctx.chosenTarget.name}（${ctx.chosenTarget.pain}）
商品で解決できる悩み：${ctx.chosenGenre.pain}

${VIRAL_CRAFT}

${ctx.ctaGuide}

条件：
・商品名を出さない
・「独学の落とし穴」等を“具体例・数字・チェックリスト”で示し、読者がその場で気づける
・放置リスクとプロ/環境に頼る価値を、具体的なbefore→afterで伝える
・不安を煽りすぎない／初心者にもわかりやすい
・${POST_RULE}

投稿の型（type にいずれかを設定）：
${EDU_TYPES.join(" / ")}

各要素を持つオブジェクトを${n}件:
- type: 投稿の型
- text: 投稿文（鉄則を反映。具体例・序列・手順を含める）
- aim: 投稿の狙い
- emotion: 読者に起こしたい感情
- consultBridge: ${ctx.destLabel}へのつなげ方${avoidBlock([...avoid, ...produced.map((p) => p.text)])}`;
  return generateItemsBatched<EducationPost>(build, total, 10, { temperature: 0.9, maxTokens: 5000 });
}

// ──────────────────────────────────────────────
// フロー8: オファー文改善
// ──────────────────────────────────────────────
export async function runOfferCopy(ctx: CampaignContext): Promise<OfferCopy[]> {
  const current =
    ctx.funnel.type === "line"
      ? `無料特典「${ctx.funnel.leadMagnet}」をLINE登録で配布`
      : ctx.funnel.type === "blog"
        ? `ブログ「${ctx.funnel.brand}」で詳しい手順を公開`
        : ctx.offer.consultContent || ctx.consultContent;
  const prompt = `あなたは${ctx.destLabel}の申込/登録率を高めるオファー設計のプロです。
以下のオファーを、より魅力的に見える形に改善してください。

現在のオファー：${current}
ターゲット：${ctx.chosenTarget.name}（${ctx.chosenTarget.pain}）
提供できる価値：${ctx.consultBenefits}

${ctx.ctaGuide}

条件：
・無料なのに価値が高く見える
・怪しく見えない／誰に向けたものか明確
・今すぐ申し込む（登録する）理由がある
・押し売り感がない
・Xの固定ポストやDM・プロフィールで使える

次の要素を持つオブジェクトを1件:
- consultName: オファー（${ctx.destLabel}）の名前
- catchCopy: 一言キャッチコピー
- applyMerit: 申し込む/登録するメリット
- notApplyDemerit: 申し込まない/登録しないデメリット
- targetWho: 対象者
- notTargetWho: 対象外の人
- applyFunnelText: ${ctx.destLabel}への導線の文章
- pinnedShort: X固定ポスト用の短文
- dmShort: DM用の短文
- profileShort: プロフィール用の短文`;
  return generateItems<OfferCopy>(prompt, { temperature: 0.8, maxTokens: 2500 });
}

// ──────────────────────────────────────────────
// フロー9: 見込み客診断ルブリック（運用時テンプレート）
// ──────────────────────────────────────────────
export async function runDiagnosisRubric(ctx: CampaignContext): Promise<DiagnosisRubric[]> {
  const prompt = `あなたは高単価アフィリエイトの成約率を上げるプロです。
Xで集客した見込み客を、${ctx.destLabel}へ送客すべきか判断するための「診断ルブリック（運用マニュアル）」を作ってください。
特定個人ではなく、運用者が毎回当てはめて使える汎用ルールとして記述してください。

商品ジャンル：${ctx.chosenGenre.genre}
無料面談の内容：${ctx.consultContent}
ターゲット：${ctx.chosenTarget.name}

次の要素を持つオブジェクトを1件:
- grade: 見込み度S/A/B/Cそれぞれの判定基準
- criteria: 今すぐ面談に誘導すべきか/まだ教育が必要かの見極め基準
- hitAppeal: 刺さりそうな訴求
- avoidWords: 避けるべき言葉
- dmText: 各見込み度で送るべきDM文の方針
- timing: 面談に進める最適なタイミング
- closeProbability: 成約につながる可能性の目安
- nextAction: 次に取るべきアクション`;
  return generateItems<DiagnosisRubric>(prompt, { temperature: 0.7, maxTokens: 2500 });
}

// ──────────────────────────────────────────────
// フロー10: 30日ロードマップ（10日ずつバッチ生成）
// ──────────────────────────────────────────────
export async function runRoadmap(ctx: CampaignContext): Promise<RoadmapDay[]> {
  const followers = ctx.offer.followers ?? 0;
  const goalLeads = ctx.offer.goalLeads ?? 10;
  const goalRevenue = ctx.offer.goalRevenue ?? "未設定";
  const days: RoadmapDay[] = [];
  for (let start = 1; start <= 30; start += 10) {
    const end = Math.min(start + 9, 30);
    const prompt = `あなたはX集客と高単価アフィリエイトの専門家です。
以下の商品の見込み客を${ctx.destLabel}へ送客してアフィリエイト報酬を得るための30日間ロードマップのうち、${start}日目〜${end}日目を作ってください。

商品ジャンル：${ctx.chosenGenre.genre}
ターゲット：${ctx.chosenTarget.name}（${ctx.chosenTarget.pain}）
現在のフォロワー数：${followers}人
目標送客数：${goalLeads}人
目標報酬：${goalRevenue}

条件：
・初心者でも実行できる
・毎日何をすればいいかわかる
・投稿内容（postExample）は実際にコピペできる完成文にする
・各日に具体的な数値目標（例: 投稿2本・リプ10件・いいね30・DM3件 など）を入れる
・プロフィール改善も固定ポスト改善もDM導線も含める
・${ctx.destLabel}への送客導線を作る

各日について次の要素を持つオブジェクトを${end - start + 1}件（day は ${start}〜${end}）:
- day: 日数（数値）
- todo: 今日やること
- postTheme: 投稿テーマ
- postExample: 投稿文の例
- replyStrategy: リプ周りのやり方
- dmTask: DMでやること
- consultFunnel: ${ctx.destLabel}への導線
- metricToWatch: 改善すべき数字
- improvement: 翌日に向けた改善点`;
    const batch = await generateItems<RoadmapDay>(prompt, { temperature: 0.8, maxTokens: 6000 });
    days.push(...batch);
  }
  return days.sort((a, b) => (a.day ?? 0) - (b.day ?? 0)).slice(0, 30);
}

// ──────────────────────────────────────────────
// フロー11: 長文記事（note / X長文記事 / ブログ）
// バズ事例（方法公開型/比較型/ロードマップ型）を再現し、記事だけで悩みが
// 解決する具体的価値を提供してから無料面談へ橋渡しする。
// ──────────────────────────────────────────────
const ARTICLE_PATTERNS: { pattern: string; format: string; brief: string }[] = [
  {
    pattern: "方法公開型",
    format: "note / X長文記事",
    brief:
      "「〇〇する方法を公開します」という実践手順の全公開。具体的なステップ、使うツール名、" +
      "数字（時間・件数・費用など）、つまずきポイントと回避法を出し切る。読者がその記事だけで" +
      "実際に着手・前進できるレベルの具体性にする。",
  },
  {
    pattern: "比較・ティアリスト型",
    format: "note / X長文記事",
    brief:
      "選択肢を🥇🥈🥉や◎○△×で序列化し、それぞれを具体例つきで一刀両断。読者が" +
      "「どれを選べばいいか」をその場で判断できる基準を渡す。NG例→推奨例の順で。",
  },
  {
    pattern: "ロードマップ型",
    format: "ブログ / note",
    brief:
      "ゼロ→ゴールまでの全体像を段階（フェーズ/週次など）に分け、各段階の到達点と具体的アクション、" +
      "目安数字を示す。初心者が迷わず辿れる地図にする。",
  },
];

export async function runArticles(ctx: CampaignContext, count = 3): Promise<Article[]> {
  const picks = ARTICLE_PATTERNS.slice(0, Math.max(1, Math.min(count, ARTICLE_PATTERNS.length)));
  const articles: Article[] = [];
  for (const p of picks) {
    const prompt = `あなたはX/noteで何度もバズを生んでいる、価値提供型の長文ライターです。
以下の案件の見込み客を${ctx.destLabel}へ送客するため、「${p.pattern}」の長文記事を1本作成してください。

商品ジャンル：${ctx.chosenGenre.genre}
ターゲット：${ctx.chosenTarget.name}（${ctx.chosenTarget.pain}）
読者が解決したい悩み：${ctx.chosenGenre.pain}
登録/相談で得られること：${ctx.consultBenefits}

【この記事の型】${p.pattern}
${p.brief}

${VIRAL_CRAFT}

${ctx.ctaGuide}

【記事の必須要件】
- タイトルは思わずクリックしたくなるもの（数字・結果・ベネフィットを入れる）
- 記事だけで悩みが大きく前進する“具体的な価値”を出し切る（抽象論NG）
- 本文は1800〜3000字程度。Markdownで見出し(##)・箇条書き・番号付き手順を使い、スマホで読みやすく
- 【抽象論を禁止】各見出しの下に必ず「具体的な数字・手順・実例・ツール名」を入れる。精神論で埋めない
- 商品名は押し出さず、最後に「個別最適化・続きは${ctx.destLabel}で」と自然に誘導
- 誇大表現・収入/効果の保証はしない。**タイトルや本文に「年間〇〇万円」等の収入額の約束/断定を使わない**
  （数字は手順・時間・件数・割合など検証可能なものに限り、成果には個人差がある前提で書く）

【X用スレッド（連投）版も必ず作る】
- 同じ内容を、Xプレミアム無しでも投稿できるよう複数ツイートに分割する（=投稿を分ける方式）
- thread は 5〜9個の文字列配列。各ツイートは本文のみ（番号は付けない）で、1ツイート最大120字程度
- 1本目は単体で伸びる強いフック（断定×数字 / 結果公開 / 常識破壊 のいずれか）
- 2本目以降で具体的な手順・序列・数字・before→after を小分けに提示し、各ツイート単体でも価値が分かる
- 最後のツイートは${ctx.destLabel}への自然なCTA（売り込み感ゼロ。本文に直リンクは貼らずプロフ/固定へ誘導）

次の要素を持つオブジェクトを1件だけ items に入れて返す:
- format: "${p.format}"
- pattern: "${p.pattern}"
- title: 記事タイトル
- lead: 冒頭フック（1〜3行）
- body: Markdown本文（1800〜3000字、note/ブログ用）
- thread: X用スレッドの配列（5〜9ツイート、各最大120字程度）
- cta: ${ctx.destLabel}への誘導文`;
    try {
      const items = await generateItems<Article>(prompt, { temperature: 0.85, maxTokens: 5500 });
      const a = items[0];
      if (a && (a.body || (Array.isArray(a.thread) && a.thread.length))) {
        a.format = a.format || p.format;
        a.pattern = a.pattern || p.pattern;
        a.thread = Array.isArray(a.thread) ? a.thread.filter(Boolean) : [];
        a.charCount = (a.body || "").replace(/\s/g, "").length;
        articles.push(a);
      }
    } catch (err) {
      console.warn(`[agents] 記事生成失敗(${p.pattern}):`, String(err).slice(0, 120));
    }
  }
  return articles;
}
