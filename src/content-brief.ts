import type { RakutenItem, ProductCategory } from "./fetcher";
import type { PersonaSlot } from "./persona/persona";

export type ContentAudience = "wife" | "husband";

export interface ProductContentBrief {
  itemName: string;
  displayName: string;
  audience: ContentAudience;
  category: string;
  facts: string[];
  useCase: string;
  angle: string;
  seasonalHook: string;
  proofLine: string;
  imageComment: string;
  hashtags: string[];
}

function cleanDisplayName(name: string): string {
  return name.replace(/【[^】]*】/g, "").replace(/\s+/g, " ").trim().slice(0, 80) || name.slice(0, 80);
}

function extractFacts(item: RakutenItem): string[] {
  const source = item.itemCaption.replace(/<[^>]+>/g, " ");
  const facts = source.split(/[。！？\n]/)
    .map((part) => part.replace(/^[\s・●◆]+/, "").trim())
    .filter((part) => part.length >= 4).slice(0, 2);
  return facts.length > 0 ? facts : [cleanDisplayName(item.itemName)];
}

function findSeasonalHook(item: RakutenItem, category: ProductCategory): string {
  const text = `${item.itemName} ${item.itemCaption}`.toLowerCase();
  return category.seasonalKeywords.find((keyword) => text.includes(keyword.toLowerCase())) ?? "";
}

export function buildProductContentBrief(
  item: RakutenItem,
  persona: PersonaSlot,
  category: ProductCategory,
  _now: Date = new Date(),
): ProductContentBrief {
  const facts = extractFacts(item);
  const displayName = cleanDisplayName(item.itemName);
  const audience = category.audience;
  const seasonalHook = findSeasonalHook(item, category);
  const proofLine = [
    `${item.itemPrice.toLocaleString()}円`,
    item.reviewCount ? `レビュー${item.reviewCount}件` : "",
    item.reviewAverage ? `★${item.reviewAverage}` : "",
  ].filter(Boolean).join("・");
  const useCase = audience === "wife"
    ? `${category.name}を毎日の生活に無理なく取り入れる場面`
    : `${category.name}を仕事・趣味の環境で機能的に使う場面`;
  const angle = audience === "wife"
    ? `女性目線で、${category.name}の続けやすさと生活への取り入れやすさを見る`
    : `男性目線で、${category.name}の機能・耐久性・使い勝手を見る`;
  const imageComment = `${category.name}｜${facts[0]}`.slice(0, 55);
  return {
    itemName: item.itemName, displayName, audience, category: category.name, facts,
    useCase, angle, seasonalHook, proofLine, imageComment,
    hashtags: [...new Set([...(Array.isArray(persona.hashtags) ? persona.hashtags : []), `#${category.name}`])].slice(0, 7),
  };
}
