/**
 * metrics-agent.ts - 計測エージェント
 *
 * 自分の楽天ROOMプロフィールをPlaywrightで開き、直近投稿のいいね数を収集して
 * post_history.json の該当レコードに反映する。学習ループの実績データ源。
 */
import { createAuthenticatedContext, validateSession } from "../session";
import { loadHistory, saveHistory, report } from "./store";

const ROOM_PROFILE_URL = () => process.env.ROOM_PROFILE_URL ?? "";

interface ScrapedPost {
  title: string;
  likes: number;
}

/**
 * プロフィールページから投稿カード（商品名といいね数）を抽出する。
 * ROOMのDOMは変わりやすいため、複数の手がかり（aria-label・いいねアイコン近傍の数字）で
 * ベストエフォート抽出し、0件なら失敗として報告する（司令官が検知）。
 */
async function scrapeOwnPosts(headless: boolean): Promise<ScrapedPost[]> {
  const { browser, context } = await createAuthenticatedContext(headless);
  try {
    if (!(await validateSession(context))) {
      throw new Error("Cookie期限切れ: セッションが無効です");
    }
    const page = await context.newPage();
    await page.goto(ROOM_PROFILE_URL(), { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(3000);

    // 無限スクロールを数回進めて直近投稿を読み込む
    for (let i = 0; i < 3; i++) {
      await page.evaluate(() => window.scrollBy(0, window.innerHeight * 2));
      await page.waitForTimeout(1500);
    }

    const posts = await page.evaluate(() => {
      const results: Array<{ title: string; likes: number }> = [];
      // 投稿カード候補: コレクト詳細へのリンクを持つ要素
      const cards = document.querySelectorAll<HTMLElement>('a[href*="/items/"], [class*="collect"], article, li');
      const seen = new Set<string>();
      cards.forEach((card) => {
        const text = card.innerText ?? "";
        if (text.length < 10 || text.length > 1000) return;
        // いいね数: ハートアイコン系要素 or 「いいね」近傍の数字
        let likes = -1;
        const likeEl = card.querySelector<HTMLElement>(
          '[class*="like"] , [aria-label*="いいね"], [class*="heart"]'
        );
        if (likeEl) {
          const m = (likeEl.innerText ?? likeEl.getAttribute("aria-label") ?? "").match(/(\d+)/);
          if (m) likes = parseInt(m[1]!, 10);
        }
        if (likes < 0) {
          const m = text.match(/いいね\s*(\d+)|(\d+)\s*いいね/);
          if (m) likes = parseInt(m[1] ?? m[2] ?? "0", 10);
        }
        if (likes < 0) return;
        // タイトル: カード内の最長行を商品名とみなす
        const title = text
          .split("\n")
          .map((l) => l.trim())
          .filter((l) => l.length >= 8)
          .sort((a, b) => b.length - a.length)[0];
        if (!title || seen.has(title)) return;
        seen.add(title);
        results.push({ title, likes });
      });
      return results;
    });

    return posts;
  } finally {
    await browser.close();
  }
}

/** 商品名の部分一致（先頭20文字ベース）で履歴レコードと突合 */
function matchRecord(scrapedTitle: string, itemName: string): boolean {
  const a = scrapedTitle.replace(/\s/g, "").slice(0, 20);
  const b = itemName.replace(/\s/g, "").slice(0, 20);
  return a.includes(b.slice(0, 12)) || b.includes(a.slice(0, 12));
}

export async function runMetricsAgent(headless = true): Promise<number> {
  if (!ROOM_PROFILE_URL()) {
    report("metrics", false, "ROOM_PROFILE_URL未設定のため計測不可");
    return 0;
  }
  try {
    const scraped = await scrapeOwnPosts(headless);
    if (scraped.length === 0) {
      report("metrics", false, "投稿カードを1件も抽出できず（ROOMのDOM変更の可能性）");
      return 0;
    }

    const history = loadHistory();
    let updated = 0;
    const now = new Date().toISOString();
    for (const rec of history) {
      const hit = scraped.find((s) => matchRecord(s.title, rec.itemName));
      if (hit && hit.likes !== rec.likes) {
        rec.likes = hit.likes;
        rec.likesUpdatedAt = now;
        updated++;
      }
    }
    saveHistory(history);
    report("metrics", true, `${scraped.length}件抽出、履歴${updated}件のいいね数を更新`);
    return updated;
  } catch (err) {
    report("metrics", false, `計測失敗: ${String(err).slice(0, 150)}`);
    return 0;
  }
}
