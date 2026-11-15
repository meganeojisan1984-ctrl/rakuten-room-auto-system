import type { RakutenItem } from "../fetcher";
import { classifyProductCategory } from "../fetcher";
import { cleanProductDisplayName, extractProductFacts } from "./product-copy";
import type { ProductContentBrief } from "../content-brief";
import type { SalesStrategyBrief } from "../sales-strategy";
import type { CreativeCopy } from "./creative-copy";

export type Slide2Type = "size_visual" | "beauty_use" | "camp_use" | "food_scene" | "storage_use" | "feature_visual";
export type CreativeTheme = "dark_luxury" | "soft_pastel" | "warm_rose";
export type ImageSlideRole = "hook" | "product_understanding" | "use_case" | "proof" | "room_bridge";

export interface ProductAnalysis {
  displayName: string;
  category: string;
  facts: string[];
  usageEvidence: string[];
  sizeFacts: string[];
  hasRelevantSize: boolean;
  slide2Type: Slide2Type;
  forbiddenClaims: string[];
}

export interface OverlayCopy {
  headline: string;
  body: string;
  label?: string;
}

export interface ImageCreativeSlide {
  index: number;
  role: ImageSlideRole;
  purpose: string;
  overlayCopy: OverlayCopy;
  /** 見出し・補足・ラベル以外に描画する短い文字（チップ、カード、チェックリスト） */
  extraTexts: string[];
  /** 添付参考デザインに沿ったページ構成 */
  layout: string;
  subject: string;
  composition: string;
  palette: string;
  decorations: string[];
  textPlacement: string;
  productPlacement: string;
  forbidden: string[];
  prompt: string;
}

export interface ImageCreativePlan {
  analysis: ProductAnalysis;
  theme: CreativeTheme;
  themeStyle: string;
  slides: ImageCreativeSlide[];
  prompt: string;
}

function compact(value: string, max = 120): string {
  return value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

function itemText(item: RakutenItem): string {
  return `${item.itemName} ${item.itemCaption}`.replace(/<[^>]+>/g, " ");
}

function extractSizeFacts(text: string): string[] {
  const facts = new Set<string>();
  const patterns = [
    /(?:幅|横幅)\s*\d+(?:\.\d+)?\s*(?:cm|センチ|mm|m)/giu,
    /高さ\s*\d+(?:\.\d+)?\s*(?:cm|センチ|mm|m)/giu,
    /(?:奥行き|奥行)\s*\d+(?:\.\d+)?\s*(?:cm|センチ|mm|m)/giu,
    /容量\s*\d+(?:\.\d+)?\s*(?:ml|mL|L|リットル|g|kg)/giu,
    /重量\s*\d+(?:\.\d+)?\s*(?:g|kg|グラム|キロ)/giu,
    /\d+(?:\.\d+)?\s*[×x✕]\s*\d+(?:\.\d+)?(?:\s*[×x✕]\s*\d+(?:\.\d+)?)?\s*(?:cm|mm|m)/giu,
  ];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) facts.add(match[0].replace(/\s+/g, " "));
  }
  return [...facts].slice(0, 5);
}

function extractUsageEvidence(text: string): string[] {
  const pieces = text
    // Rakuten descriptions commonly separate facts with <br> and bullet marks;
    // split those before punctuation so the first evidence is not the whole title.
    .replace(/<br\s*\/?>(?=\S)/giu, "\n")
    .split(/[。！？\n・]/u)
    .map((part) => compact(part, 100))
    .filter((part) => part.length >= 8)
    .filter((part) => /使|用途|収納|持ち運|キャンプ|車中泊|洗面|朝晩|夜|食後|保存|充電|設置|乾か|ケア|調理|防災/i.test(part));
  return [...new Set(pieces)].slice(0, 4);
}

function chooseSlide2Type(item: RakutenItem, analysis: Omit<ProductAnalysis, "slide2Type">): Slide2Type {
  const text = itemText(item);
  if (analysis.hasRelevantSize && /(?:幅|高さ|奥行|容量|重量|サイズ|寸法|設置|収納)/iu.test(text)) return "size_visual";
  if (/美容機器|美容家電|化粧品|美容液|スキンケア|ドライヤー|ヘアアイロン|美顔器/iu.test(text)) return "beauty_use";
  if (/キャンプ|アウトドア|登山|車中泊|テント|タープ|ランタン|チェア/iu.test(text)) return "camp_use";
  if (/食品|スイーツ|お菓子|飲料|コーヒー|お茶|冷凍|保存|お取り寄せ/iu.test(text)) return "food_scene";
  if (/収納|ラック|ボックス|ケース|整理|洗面台|キッチン|すき間/iu.test(text)) return "storage_use";
  return "feature_visual";
}

function categoryLabel(item: RakutenItem, brief?: ProductContentBrief | SalesStrategyBrief): string {
  return compact(classifyProductCategory(item) || brief?.category || "商品", 30);
}

function buildAnalysis(item: RakutenItem, brief?: ProductContentBrief | SalesStrategyBrief): ProductAnalysis {
  const text = itemText(item);
  const facts = [...new Set([
    ...extractProductFacts(item.itemCaption, 4).map((fact) => compact(fact, 110)),
    ...extractUsageEvidence(text),
  ])].slice(0, 5);
  const usageEvidence = extractUsageEvidence(text);
  const sizeFacts = extractSizeFacts(text);
  const base = {
    displayName: compact(cleanProductDisplayName(item.itemName) || item.itemName, 70),
    category: categoryLabel(item, brief),
    facts: facts.length > 0 ? facts : [compact(cleanProductDisplayName(item.itemName), 70)],
    usageEvidence,
    sizeFacts,
    hasRelevantSize: sizeFacts.length > 0,
    forbiddenClaims: ["商品説明にない効果", "未確認の使用体験", "推測した寸法", "未確認の割引・ランキング"],
  };
  return { ...base, slide2Type: chooseSlide2Type(item, base) };
}

function typeCopy(type: Slide2Type, analysis: ProductAnalysis): OverlayCopy {
  const fact = analysis.facts[0] ?? analysis.displayName;
  switch (type) {
    case "size_visual": return { headline: "置く前に、サイズを確認", body: analysis.sizeFacts.join("・"), label: "寸法チェック" };
    case "beauty_use": return { headline: /乾か|ドライヤー|風量/iu.test(fact) ? "乾かす時間を見直したい日に" : "いつものケアに取り入れやすい", body: analysis.usageEvidence[0] ?? fact, label: "使う場面" };
    case "camp_use": return { headline: "持ち出す場面までイメージ", body: analysis.usageEvidence[0] ?? fact, label: "アウトドアで" };
    case "food_scene": return { headline: "食べる場面まで想像できる", body: analysis.usageEvidence[0] ?? fact, label: "楽しみ方" };
    case "storage_use": return { headline: "置き場所が決まると、片付けやすい", body: analysis.usageEvidence[0] ?? fact, label: "使う場所" };
    default: return { headline: "選ぶ前に、特徴をチェック", body: fact, label: "商品ポイント" };
  }
}

const THEME_STYLES: Record<CreativeTheme, string> = {
  dark_luxury:
    "高級感のあるダークトーン。黒〜深いブラウンの落ち着いた室内を背景に、暖色の間接照明と木の天板。見出しはシャンパンゴールドの明朝体、本文は白〜淡いゴールド。細いゴールドの枠線と罫線、ゴールド線画の丸アイコン、半透明の黒いカード。",
  soft_pastel:
    "やさしいパステルトーン。白〜淡い水色とクリーム色の背景に自然光。見出しはネイビーと珊瑚色の丸ゴシック体、手書き風の吹き出し・点線・リボン帯、白い角丸カード、小さな線画アイコン。",
  warm_rose:
    "上品でナチュラルなトーン。ベージュ〜くすみピンクの背景にやわらかい光とボケ。見出しはこげ茶の明朝体にローズピンクの強調、ローズ色のリボン帯、白い角丸カード、細い手書き風ラインと小さなきらめき。",
};

export function chooseCreativeTheme(item: RakutenItem, brief?: ProductContentBrief | SalesStrategyBrief): CreativeTheme {
  // 選定カテゴリ（brief）を優先し、無い場合だけ商品名・説明から判断する。
  const text = itemText(item);
  const category = brief?.category ?? "";
  if (/ベビー|赤ちゃん|新生児|キッズ|子供|子ども|こども|離乳食|出産祝い|おもちゃ|知育|ロンパース|抱っこ紐|ベビーカー/iu.test(text)) return "soft_pastel";
  if (/PCガジェット|家電製品|アウトドア/u.test(category)) return "dark_luxury";
  if (/美容|化粧|ダイエット/u.test(category)) return "warm_rose";
  if (/美容|コスメ|化粧|スキンケア|ヘアケア|ドライヤー|ヘアアイロン|美顔|ダイエット|リラックス|アイマスク/iu.test(text)) return "warm_rose";
  if (/家電|スマート|リモコン|ガジェット|パソコン|ノートPC|モニター|キーボード|マウス|イヤホン|ヘッドホン|スピーカー|充電器|モバイルバッテリー|カメラ|ソフトウェア|Office|キャンプ|アウトドア/iu.test(text)) return "dark_luxury";
  if (brief?.audience === "husband") return "dark_luxury";
  return "warm_rose";
}

function quoteAll(values: string[]): string {
  return values.map((value) => `「${value}」`).join("");
}

function rolePrompt(slide: ImageCreativeSlide, analysis: ProductAnalysis): string {
  const textLines = [
    `見出し「${slide.overlayCopy.headline}」`,
    `補足文「${slide.overlayCopy.body}」`,
    ...(slide.overlayCopy.label ? [`ラベル「${slide.overlayCopy.label}」`] : []),
    ...slide.extraTexts,
  ];
  return [
    `【スライド${slide.index}】役割: ${slide.purpose}。商品カテゴリ: ${analysis.category}。`,
    `【ページ構成】${slide.layout}`,
    `【被写体と構図】${slide.subject}。${slide.composition}。配色: ${slide.palette}。`,
    `【商品の配置】${slide.productPlacement}。`,
    `【文字の配置】${slide.textPlacement}。装飾: ${slide.decorations.join("、")}。`,
    `【画像内に描画する確定テキスト】${textLines.join("／")}。`,
    "上記の確定テキストだけを、それぞれ1回ずつ、読みやすい正確な日本語として描画する。文字を省略・改変・翻訳・創作せず、数字と記号も一字一句そのまま使い、商品と重ならない指定ゾーンへ配置する。",
    `【禁止事項】${slide.forbidden.concat(analysis.forbiddenClaims).join("、")}。ロゴや別商品の代用、読めない文字、誇大表現を入れない。`,
  ].join("\n");
}

export function buildImageCreativePlan(
  item: RakutenItem,
  brief?: ProductContentBrief | SalesStrategyBrief,
  copy?: CreativeCopy,
): ImageCreativePlan {
  const analysis = buildAnalysis(item, brief);
  const theme = chooseCreativeTheme(item, brief);
  const fact = analysis.facts[0] ?? analysis.displayName;
  // The listing is the source of truth. Persona copy can guide tone, but must not
  // replace a concrete usage fact with a mismatched generic scenario.
  const scene = analysis.usageEvidence[0]
    || (brief as Partial<SalesStrategyBrief> | undefined)?.imageScene
    || brief?.useCase
    || "商品を使う日常の場面";
  const slide2 = typeCopy(analysis.slide2Type, analysis);
  const shortName = compact(analysis.displayName, 24);
  const hasReview = Boolean(item.reviewAverage && item.reviewCount);
  const rawSlides: Omit<ImageCreativeSlide, "prompt">[] = [
    {
      index: 1, role: "hook", purpose: "悩みと商品の出番を一瞬で伝える表紙",
      overlayCopy: copy
        ? { headline: copy.hookQuestion, body: copy.hookHeadline, label: shortName }
        : { headline: brief?.problem?.slice(0, 42) || `${analysis.category}選びで迷ったら`, body: compact(scene, 70), label: "こんな人に" },
      extraTexts: copy ? [`アイコン付きチップ4個${quoteAll(copy.chips)}`, `締めの一文「${copy.tagline}」`] : [],
      layout: "雑誌広告のような表紙。最上部に問いかけの見出し、その下に大きく補足文を置いて主役のコピーにする。商品を画面の左〜中央に大きく配置し、右側の枠付きラベルに商品名。チップがある場合は下部に線画アイコン付きで横一列に並べ、最下部に締めの一文。",
      subject: "商品写真と、商品が役立つ日常の背景", composition: "商品を大きく主役にし、コピーは上部と右側の余白へ。背景は生活空間をぼかして奥行きを出す", palette: "テーマ配色に商品カラーを1色だけアクセントとして加える", decorations: ["細い罫線の帯", "枠付きラベル", "小さなきらめき"], textPlacement: "上部に問いかけと大きなコピー、右側に商品名ラベル、下部にチップ", productPlacement: "左〜中央に、添付の楽天商品画像と同じ外観の商品を大きく置く", forbidden: ["商品説明にない悩みを断定"]
    },
    {
      index: 2, role: "product_understanding", purpose: "商品に合った購入判断ポイントを一覧で見せる", overlayCopy: slide2,
      extraTexts: copy
        ? [...copy.features.map((feature, index) => `機能カード${index + 1}: タイトル「${feature.title}」説明「${feature.detail}」`), `小見出し「こんな方におすすめ」とチェックリスト3行${quoteAll(copy.recommendFor)}`]
        : [],
      layout: "機能まとめページ。上部にリボン帯と見出し。左に商品、右に機能カードを縦に並べ、各カードには線画アイコン・タイトル・短い説明。下部に『こんな方におすすめ』のチェックリスト欄。カード指定がない場合は見出しと補足文だけで余白を広く取る。",
      subject: analysis.slide2Type === "size_visual" ? "商品と自然な基準物、寸法線" : `${analysis.category}の具体的な使用準備・使用場面`, composition: "左に商品、文字とカードは右側と下部の余白に分け、視線を商品へ戻す", palette: "テーマ配色に商品カテゴリのアクセント色", decorations: analysis.slide2Type === "size_visual" ? ["細い寸法線", "矢印", "寸法ラベル"] : ["手書き風の囲み", "マーカー線", "小さなカテゴリラベル"], textPlacement: "上部に主見出し、右側にカード、下部にチェックリスト", productPlacement: "左側に、添付の楽天商品画像と同じ外観の商品", forbidden: analysis.slide2Type === "size_visual" ? ["商品説明にない寸法や比較対象"] : ["使用手順や効果の創作"]
    },
    {
      index: 3, role: "use_case", purpose: "商品を使う場面を具体的に想像させる", overlayCopy: { headline: "使う場面が浮かぶと、選びやすい", body: compact(analysis.usageEvidence[1] || fact, 78), label: "使用イメージ" },
      extraTexts: copy ? [`小見出し「こんなシーンで活躍」と写真カード3枚のキャプション${quoteAll(copy.scenes)}`] : [],
      layout: "利用シーン紹介ページ。上部に見出しと補足文。中央に商品。下部に横並びの写真カードを置き、各カードは生活シーンの写真と短いキャプション。カード指定がない場合は1つの生活シーンを大きく見せる。",
      subject: `商品説明に明記された用途に沿う${scene}`, composition: "生活感を残した自然なシーン、商品を主役にして背景は整理", palette: "テーマ配色と自然な室内光", decorations: ["写真風の小見出しカード", "手書きの丸囲み", "短い矢印"], textPlacement: "上部に見出しと補足、下部カードにキャプション", productPlacement: "中央に、添付の楽天商品画像と同じ外観の商品", forbidden: ["実際に使った体験談の創作", "商品にない機能の追加", "人物の顔のアップ"]
    },
    {
      index: 4, role: "proof", purpose: "購入前に確認すべき根拠を整理する", overlayCopy: { headline: "購入前にここを確認", body: [item.itemPrice ? `${item.itemPrice.toLocaleString()}円` : "価格は商品ページで確認", hasReview ? `★${item.reviewAverage}・レビュー${item.reviewCount}件` : "レビューは商品ページで確認"].join("　"), label: "チェックポイント" },
      extraTexts: ["注記「最新の価格とレビューは商品ページで確認」"],
      layout: hasReview
        ? "評価と価格のまとめページ。上部に見出し。月桂樹のバッジ風カードに補足文のレビュー表記を大きく、隣の独立したカードに価格表記。下部に注記。お客様の声の吹き出しは置かず、数値カードと商品だけで構成する。"
        : "価格のまとめページ。上部に見出し。独立したカードに補足文を大きく置き、下部に注記。評価バッジや星は描かない。",
      subject: "商品写真、価格・レビューを載せる正確な情報カード", composition: "商品を片側に、情報カードは読みやすい余白を持たせる", palette: "テーマ配色に、数値が読みやすい高コントラストのカード", decorations: ["チェックマーク風アイコン", "カードの角丸", "細いマーカー線"], textPlacement: "中央上部に見出し、カード内に根拠", productPlacement: "左または右に、添付の楽天商品画像と同じ外観の商品", forbidden: ["レビュー本文・体験談・年代性別ラベルの創作", "未確認の最安値や割引", "指定と異なる数値"]
    },
    {
      index: 5, role: "room_bridge", purpose: "プロフィールから楽天ROOMへ進む行動を促す", overlayCopy: { headline: "気になったら楽天ROOMへ", body: "プロフィールのリンクから商品詳細をチェック", label: "ROOMで確認" },
      extraTexts: [`アイコン付きの3項目${quoteAll(["商品の詳細を見る", "レビューを確認", "お気に入りに保存"])}`],
      layout: "行動を促す最終ページ。上部に見出し。中央に補足文を載せたリンク風の横長カードと右向きの矢印。その先にスマートフォンの簡略イラスト（画面内は商品サムネイルの格子だけで、文字・アカウント名・数字は入れない）。下部にアイコン付きの3項目と、タップを示す指のアイコン。",
      subject: "リンク風の横長カード、スマートフォンの簡略イラスト、小さな商品", composition: "中央にリンク風カード、矢印でプロフィール導線へ視線を誘導", palette: "テーマ配色に、行動ボタンだけ濃いアクセント色", decorations: ["手書き風の矢印", "リンクアイコン", "タップを示す指のアイコン"], textPlacement: "上部に短い見出し、中央カードに補足、下部に3項目", productPlacement: "カードの端に、添付の楽天商品画像と同じ外観の商品を小さく置く", forbidden: ["実在しないURLの描画", "アカウント名やフォロワー数の創作", "外部サイトへの直接投稿を促す表現"]
    },
  ];
  const slides = rawSlides.map((slide) => ({ ...slide, prompt: rolePrompt(slide as ImageCreativeSlide, analysis) }));
  return { analysis, theme, themeStyle: THEME_STYLES[theme], slides, prompt: slides.map((slide) => slide.prompt).join("\n\n") };
}
