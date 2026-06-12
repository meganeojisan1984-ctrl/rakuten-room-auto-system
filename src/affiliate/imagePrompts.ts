/**
 * imagePrompts.ts - 投稿用のChatGPT画像生成プロンプトを作成
 *
 * 画像はユーザーがChatGPTで手動作成するため、ここでは「プロンプトのみ」を生成し
 * スプレッドシートの各投稿行に貼り付ける。投稿文の内容に応じてプロンプトを変動させる。
 */
import type { CampaignContext } from "./types";
import { generateItems } from "./llm";

/**
 * 投稿文の配列に対応する画像生成プロンプトを一括生成する。
 * 件数が多い場合に備え、入力と同数の prompt を index 付きで返させる。
 */
export async function generateImagePrompts(
  ctx: CampaignContext,
  posts: string[]
): Promise<string[]> {
  if (posts.length === 0) return [];

  const result: string[] = new Array(posts.length).fill("");
  const BATCH = 15;
  for (let start = 0; start < posts.length; start += BATCH) {
    const chunk = posts.slice(start, start + BATCH);
    const listText = chunk.map((p, i) => `${i}. ${p.slice(0, 120)}`).join("\n");
    const prompt = `あなたはSNS運用者向けの画像ディレクターです。
以下のX投稿それぞれに添える画像を、ChatGPT（画像生成）で作るための日本語プロンプトを作成してください。

ジャンル：${ctx.chosenGenre.genre}
ターゲット：${ctx.chosenTarget.name}

【投稿一覧（index. 投稿文）】
${listText}

各 index について次のオブジェクトを items 配列で返す:
- index: 数値（投稿のindex）
- prompt: ChatGPTにそのまま貼って画像生成できる日本語プロンプト。
  Xで目を引くサムネ的な1枚。文字入れする場合はキャッチコピー案も含める。
  構図・雰囲気・色味・被写体・テイスト（実写/イラスト/フラットデザイン等）を具体的に指定し、
  16:9 または 4:5 など縦横比も明記。誇大・不適切表現は避ける。`;
    try {
      const items = await generateItems<{ index: number; prompt: string }>(prompt, {
        temperature: 0.8,
        maxTokens: 4000,
      });
      for (const it of items) {
        const globalIdx = start + (typeof it.index === "number" ? it.index : -1);
        if (globalIdx >= start && globalIdx < start + chunk.length && it.prompt) {
          result[globalIdx] = it.prompt.trim();
        }
      }
    } catch (err) {
      console.warn("[imagePrompts] 生成失敗:", String(err).slice(0, 120));
    }
  }
  return result;
}
