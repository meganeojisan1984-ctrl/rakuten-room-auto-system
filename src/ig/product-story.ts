import type { RakutenItem } from "../fetcher";

export interface ProductStoryProfile {
  coverHeadline: string;
  coverKicker: string;
  problemHeadline: string;
  painPoints: [string, string];
  solutionHeadline: string;
  benefits: [string, string, string];
  useCaseBody: string;
  coverSceneTone: string;
  paletteHint: string;
  visualTemplate: string;
  hookAngle: string;
  layoutMood: string;
  timeMood: string;
}

export interface ProductStoryOptions {
  now?: Date;
}

function itemText(item: RakutenItem): string {
  return `${item.itemName} ${item.itemCaption}`;
}

function matches(item: RakutenItem, pattern: RegExp): boolean {
  return pattern.test(itemText(item));
}

function jstParts(now: Date): { weekday: number; hour: number; dayKey: string } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    hour: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const value = (type: string): string => parts.find((part) => part.type === type)?.value ?? "";
  const weekdayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    weekday: weekdayMap[value("weekday")] ?? 0,
    hour: Number(value("hour")) || 0,
    dayKey: `${value("year")}-${value("month")}-${value("day")}`,
  };
}

function hashNumber(text: string): number {
  let hash = 0;
  for (const char of text) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }
  return hash;
}

function pickRotator(item: RakutenItem, now: Date): {
  visualTemplate: string;
  hookAngle: string;
  layoutMood: string;
  timeMood: string;
  headlinePrefix: string;
} {
  const { weekday, hour, dayKey } = jstParts(now);
  const morning = hour >= 5 && hour < 11;
  const lunch = hour >= 11 && hour < 17;
  const night = hour >= 17 || hour < 5;
  const weekend = weekday === 0 || weekday === 5 || weekday === 6;
  const seed = hashNumber(`${item.itemCode}|${item.itemName}|${dayKey}|${Math.floor(hour / 6)}`);
  const templates = [
    "magazine cover layout with oversized handwritten Japanese headline, sticker badges, and one strong product hero photo",
    "bold sale-alert layout with diagonal banners, thick outline text, price or coupon badge space, and energetic contrast",
    "before-after comparison layout with split scene, arrow marks, circled details, and a clear swipe reason",
    "catalog collage layout with multiple product cutouts, small label chips, and a browsing-makes-you-curious feeling",
    "real-life snapshot layout with full-bleed lifestyle photo, speech bubble, and one punchy question headline",
  ];
  const hookAngles = [
    "unexpected discovery hook",
    "save-before-shopping hook",
    "problem-solution hook",
    "limited deal and comparison hook",
    "ranking/catalog browsing hook",
  ];
  const timeMood = morning
    ? "morning time-saving mood: quick prep, clean light, start-the-day usefulness"
    : lunch
      ? "daytime comparison mood: easy to understand, save-worthy, shopping-checklist energy"
      : "night reward mood: relaxed scrolling, treat-yourself, sale-check before bed";
  return {
    visualTemplate: templates[seed % templates.length]!,
    hookAngle: weekend || night ? hookAngles[(seed + 3) % hookAngles.length]! : hookAngles[seed % hookAngles.length]!,
    layoutMood: weekend
      ? "weekend shopping excitement with stronger headline impact"
      : "weekday useful-find mood with clean readable structure",
    timeMood,
    headlinePrefix: morning ? "朝から" : night ? "夜に見つけた" : "今チェックしたい",
  };
}

function withRotation(
  base: Omit<ProductStoryProfile, "visualTemplate" | "hookAngle" | "layoutMood" | "timeMood">,
  item: RakutenItem,
  now: Date,
): ProductStoryProfile {
  const rotated = pickRotator(item, now);
  return {
    ...base,
    coverHeadline:
      rotated.timeMood.includes("night")
        ? base.coverHeadline.replace(/^週末の/, "夜の").replace(/^片付いた/, "今夜、片付いた").replace(/^使うたび/, "夜に見ても").replace(/^朝の/, "夜のケアで")
        : rotated.timeMood.includes("morning")
          ? base.coverHeadline.replace(/^週末の/, "朝の").replace(/^片付いた/, "朝から片付いた").replace(/^これ、/, "朝から")
          : base.coverHeadline,
    visualTemplate: rotated.visualTemplate,
    hookAngle: rotated.hookAngle,
    layoutMood: rotated.layoutMood,
    timeMood: rotated.timeMood,
  };
}

export function buildProductStoryProfile(item: RakutenItem, options: ProductStoryOptions = {}): ProductStoryProfile {
  const now = options.now ?? new Date();
  let base: Omit<ProductStoryProfile, "visualTemplate" | "hookAngle" | "layoutMood" | "timeMood">;
  if (matches(item, /美容|コスメ|スキンケア|ヘアケア|メイク|化粧|リップ|美容液|香水/)) {
    base = {
      coverHeadline: "朝の気分が変わるやつ",
      coverKicker: "鏡を見る時間が楽しみに",
      problemHeadline: "ケア、後回しにしがち",
      painPoints: ["時短で整えたい", "気分を上げたい"],
      solutionHeadline: "いつものケアに足せる",
      benefits: ["毎日のケアに足せる", "見た目の印象アップ", "気分が上がる"],
      useCaseBody: "🙌 洗面台やポーチに置いておくと、忙しい朝でも自分を整えるきっかけになります。",
      coverSceneTone: "soft morning vanity scene, cosmetic texture, self-care excitement",
      paletteHint: "clear white, coral pink, soft gold, and ink black accents",
    };
    return withRotation(base, item, now);
  }
  if (matches(item, /収納|片付け|ハンガー|ラック|チェスト|ケース|ボックス|衣類|整理/)) {
    base = {
      coverHeadline: "片付いた瞬間が気持ちいい",
      coverKicker: "暮らしが整って見える",
      problemHeadline: "ごちゃつき、放置しがち",
      painPoints: ["置き場所に困る", "生活感が出る"],
      solutionHeadline: "すっきり整うのがうれしい",
      benefits: ["片付けがラク", "生活感を抑える", "毎日使いやすい"],
      useCaseBody: "🙌 キッチン、洗面台、玄関まわりに。場所がハマると片付けや準備の手間が減ります。",
      coverSceneTone: "tidy home corner, satisfying before-after feeling, everyday storage joy",
      paletteHint: "sage green, cream, black, and warm yellow accents",
    };
    return withRotation(base, item, now);
  }
  if (matches(item, /服|キッズ|子供服|バッグ|靴|ワンピ|シャツ|パンツ|ニット|ファッション|アクセサリー/)) {
    base = {
      coverHeadline: "今日の服に合わせたい",
      coverKicker: "写真でも気分が上がる",
      problemHeadline: "コーデ、迷いがち",
      painPoints: ["合わせ方に悩む", "安っぽく見せたくない"],
      solutionHeadline: "毎日に使いやすい",
      benefits: ["着回しやすい", "毎日使いやすい", "写真でも映える"],
      useCaseBody: "🙌 いつもの服に足すだけで、外出前の迷いが減って写真にも残したくなります。",
      coverSceneTone: "bright outfit flat-lay or mirror-check moment, stylish but everyday",
      paletteHint: "soft white, charcoal, muted rose, and fresh green accents",
    };
    return withRotation(base, item, now);
  }
  if (matches(item, /家電|ガジェット|スマホ|充電|イヤホン|加湿器|ライト|掃除機|時短/)) {
    base = {
      coverHeadline: "使うたびラクを実感",
      coverKicker: "暮らしの手間をひとつ減らす",
      problemHeadline: "小さな手間、積もりがち",
      painPoints: ["準備が面倒", "置き場所に悩む"],
      solutionHeadline: "時短になるのがうれしい",
      benefits: ["時短になる", "置き場所に困りにくい", "使うたびラク"],
      useCaseBody: "🙌 朝の支度や家事の合間に使いやすいと、毎日の小さなストレスが減ります。",
      coverSceneTone: "clean modern room, device in use, satisfying time-saving moment",
      paletteHint: "fresh blue, white, graphite, and warm yellow accents",
    };
    return withRotation(base, item, now);
  }
  if (matches(item, /牛めし|牛丼|どんぶりの具|ごはんの具|レトルト|惣菜|おかず|時短ごはん|時短ご飯|冷凍食品|冷凍ごはん|冷凍ご飯|常備食|非常食|お取り寄せグルメ|うなぎ|お肉|鮮魚|干物/)) {
    base = {
      coverHeadline: "常備しておくと安心",
      coverKicker: "「今日ごはんどうしよう」が減る",
      problemHeadline: "夕方の「どうしよう」に困りがち",
      painPoints: ["献立を考えるのが面倒", "疲れた日は外食に頼りがち"],
      solutionHeadline: "レンチンですぐ完成",
      benefits: ["調理がスピーディー", "コスパよく満足感あり", "ストックしやすい"],
      useCaseBody: "🙌 冷凍庫や棚にストックできると、疲れた日や忙しい日の「今日どうしよう」がすぐ解決します。",
      coverSceneTone: "practical kitchen stock scene, freezer or pantry shelf, everyday convenience mood",
      paletteHint: "warm beige, deep brown, cream, and soft orange accents",
    };
    return withRotation(base, item, now);
  }
  if (matches(item, /食品|お米|お水|ミネラルウォーター|コーヒー|お茶|菓子|チョコ|ケーキ|スイーツ|プロテイン|グルメ/)) {
    base = {
      coverHeadline: "週末のご褒美にしたい",
      coverKicker: "おうちカフェ気分が上がる",
      problemHeadline: "甘いもの、切らしがち",
      painPoints: ["おやつがマンネリ", "来客時に慌てる"],
      solutionHeadline: "家でちょっと贅沢",
      benefits: ["手軽に楽しめる", "家でちょっと贅沢", "ストックしやすい"],
      useCaseBody: "🙌 冷凍庫や棚にストックできると、週末のおやつ・来客・夜のご褒美にすぐ出せます。",
      coverSceneTone: "warm dessert-table excitement, weekend treat, cozy home cafe mood",
      paletteHint: "berry red, cream, chocolate brown, and warm yellow accents",
    };
    return withRotation(base, item, now);
  }
  base = {
    coverHeadline: "これ、毎日ちょっと嬉しい",
    coverKicker: "暮らしに小さな楽しみが増える",
    problemHeadline: "選ぶの、後回しにしがち",
    painPoints: ["違いがわかりにくい", "買う決め手がほしい"],
    solutionHeadline: "使う場面が想像しやすい",
    benefits: ["毎日使いやすい", "気分が上がる", "試しやすい"],
    useCaseBody: "🙌 いつもの生活にすっと足せると、ちょっとした不便や迷いが軽くなります。",
    coverSceneTone: "pleasant everyday lifestyle scene, product feels useful and inviting",
    paletteHint: "fresh green, cream, charcoal, and warm yellow accents",
  };
  return withRotation(base, item, now);
}
