import type { RakutenItem } from "../fetcher";
import { classifyProductCategory } from "../fetcher";
import { cleanProductDisplayName, extractProductFacts } from "./product-copy";
import type { ProductContentBrief } from "../content-brief";
import type { SalesStrategyBrief } from "../sales-strategy";

export type Slide2Type = "size_visual" | "beauty_use" | "camp_use" | "food_scene" | "storage_use" | "feature_visual";
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

function rolePrompt(slide: ImageCreativeSlide, analysis: ProductAnalysis): string {
  return [
    "正方形1080×1080の日本語Instagramカルーセル画像を作るためのアートディレクション。",
    `スライド${slide.index}の役割: ${slide.purpose}。商品カテゴリ: ${analysis.category}。`,
    `被写体: ${slide.subject}。構図: ${slide.composition}。配色: ${slide.palette}。`,
    `画像内に表示する確定テキスト: 見出し「${slide.overlayCopy.headline}」／補足文「${slide.overlayCopy.body}」${slide.overlayCopy.label ? `／ラベル「${slide.overlayCopy.label}」` : ""}。これらの文字列を一字一句そのまま表示する。`,
    `文字配置: ${slide.textPlacement}。装飾: ${slide.decorations.join("、")}。商品画像: ${slide.productPlacement}。`,
    "上記の確定テキストを画像内に1回だけ、読みやすい正確な日本語として描画する。文字を省略・改変・翻訳・創作せず、商品画像と重ならない指定ゾーンへ配置する。",
    `禁止事項: ${slide.forbidden.concat(analysis.forbiddenClaims).join("、")}。ロゴや別商品の代用、読めない文字、誇大表現を入れない。`,
  ].join(" ");
}

export function buildImageCreativePlan(item: RakutenItem, brief?: ProductContentBrief | SalesStrategyBrief): ImageCreativePlan {
  const analysis = buildAnalysis(item, brief);
  const fact = analysis.facts[0] ?? analysis.displayName;
  // The listing is the source of truth. Persona copy can guide tone, but must not
  // replace a concrete usage fact with a mismatched generic scenario.
  const scene = analysis.usageEvidence[0]
    || (brief as Partial<SalesStrategyBrief> | undefined)?.imageScene
    || brief?.useCase
    || "商品を使う日常の場面";
  const slide2 = typeCopy(analysis.slide2Type, analysis);
  const rawSlides: Omit<ImageCreativeSlide, "prompt">[] = [
    {
      index: 1, role: "hook", purpose: "悩みと商品の出番を一瞬で伝える", overlayCopy: { headline: brief?.problem?.slice(0, 42) || `${analysis.category}選びで迷ったら`, body: compact(scene, 70), label: "こんな人に" },
      subject: "商品写真と、商品が役立つ日常の背景", composition: "商品写真を右寄せ、左側に大きな文字のための明るい余白", palette: "商品カラーに合わせた淡色と濃い文字のコントラスト", decorations: ["手書き風の下線", "小さな丸ラベル", "SWIPEを示す細い矢印"], textPlacement: "左上から中央、商品写真と重ならない", productPlacement: "右側のカード内に正確な楽天商品画像", forbidden: ["商品説明にない悩みを断定"]
    },
    {
      index: 2, role: "product_understanding", purpose: "商品に合った購入判断ポイントを視覚化する", overlayCopy: slide2,
      subject: analysis.slide2Type === "size_visual" ? "商品と自然な基準物、寸法線" : `${analysis.category}の具体的な使用準備・使用場面`, composition: "中央に商品、文字とラベルは上下左右の余白に分け、視線を商品へ戻す", palette: "清潔感のあるクリーム系に商品カテゴリのアクセント色", decorations: analysis.slide2Type === "size_visual" ? ["細い寸法線", "矢印", "寸法ラベル"] : ["手書き風の囲み", "マーカー線", "小さなカテゴリラベル"], textPlacement: "上部に主見出し、下部または側面に補足", productPlacement: "中央または右下に商品画像", forbidden: analysis.slide2Type === "size_visual" ? ["商品説明にない寸法や比較対象"] : ["使用手順や効果の創作"]
    },
    {
      index: 3, role: "use_case", purpose: "商品を使う場面を具体的に想像させる", overlayCopy: { headline: "使う場面が浮かぶと、選びやすい", body: compact(analysis.usageEvidence[1] || fact, 78), label: "使用イメージ" },
      subject: `商品説明に明記された用途に沿う${scene}`, composition: "生活感を残した自然なシーン、商品写真を主役にして背景は整理", palette: "自然光と落ち着いたニュートラルカラー", decorations: ["写真風の小見出しカード", "手書きの丸囲み", "短い矢印"], textPlacement: "左下の半透明カードに主見出しと補足", productPlacement: "使用場面の中心に正確な商品画像", forbidden: ["実際に使った体験談の創作", "商品にない機能の追加"]
    },
    {
      index: 4, role: "proof", purpose: "購入前に確認すべき根拠を整理する", overlayCopy: { headline: "購入前にここを確認", body: [item.itemPrice ? `${item.itemPrice.toLocaleString()}円` : "価格は商品ページで確認", item.reviewAverage && item.reviewCount ? `★${item.reviewAverage}・レビュー${item.reviewCount}件` : "レビューは商品ページで確認"].join("　"), label: "チェックポイント" },
      subject: "商品写真、価格・レビューを載せる正確な情報カード", composition: "商品写真を大きく、情報カードは読みやすい余白を持たせる", palette: "白いカード、淡い背景、購入判断のアクセント色", decorations: ["チェックマーク風アイコン", "カードの角丸", "細いマーカー線"], textPlacement: "中央上部に見出し、カード内に根拠", productPlacement: "左または右の白いカード内", forbidden: ["レビュー内容の創作", "未確認の最安値や割引"]
    },
    {
      index: 5, role: "room_bridge", purpose: "プロフィールから楽天ROOMへ進む行動を促す", overlayCopy: { headline: "気になったら楽天ROOMへ", body: "プロフィールのリンクから商品詳細をチェック", label: "ROOMで確認" },
      subject: "プロフィールカード、リンク風の横長カード、商品カテゴリの小さな装飾", composition: "中央にリンク風カード、矢印でプロフィール導線へ視線を誘導", palette: "クリーム、淡いピンクまたは商品に合う淡色、濃い文字", decorations: ["手書き風の矢印", "リンクアイコン", "小さなハートまたは丸印", "プロフィール風カード"], textPlacement: "上部に短い見出し、中央カードの周囲に補足", productPlacement: "小さな商品写真をカードの端に配置", forbidden: ["実在しないURLの描画", "外部サイトへの直接投稿を促す表現"]
    },
  ];
  const slides = rawSlides.map((slide) => ({ ...slide, prompt: rolePrompt(slide as ImageCreativeSlide, analysis) }));
  return { analysis, slides, prompt: slides.map((slide) => slide.prompt).join("\n\n") };
}
