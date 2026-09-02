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
}

function itemText(item: RakutenItem): string {
  return `${item.itemName} ${item.itemCaption}`;
}

function matches(item: RakutenItem, pattern: RegExp): boolean {
  return pattern.test(itemText(item));
}

export function buildProductStoryProfile(item: RakutenItem): ProductStoryProfile {
  if (matches(item, /食品|米|水|コーヒー|お茶|菓子|チョコ|ケーキ|スイーツ|うなぎ|肉|魚|プロテイン|グルメ|お取り寄せ|冷凍/)) {
    return {
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
  }
  if (matches(item, /収納|片付け|ハンガー|ラック|チェスト|ケース|ボックス|衣類|整理/)) {
    return {
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
  }
  if (matches(item, /服|キッズ|子供服|バッグ|靴|ワンピ|シャツ|パンツ|ニット|ファッション|アクセサリー/)) {
    return {
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
  }
  if (matches(item, /美容|コスメ|スキンケア|ヘアケア|メイク|化粧|リップ|美容液|香水/)) {
    return {
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
  }
  if (matches(item, /家電|ガジェット|スマホ|充電|イヤホン|加湿器|ライト|掃除機|時短/)) {
    return {
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
  }
  return {
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
}
