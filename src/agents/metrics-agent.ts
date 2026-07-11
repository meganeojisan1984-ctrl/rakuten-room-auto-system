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
    // ROOMはSPAで直後にクライアント側遷移が走り "Execution context was destroyed" になるため、
    // ネットワーク静止を待ってから安定するまで追加待機する
    await page.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(4000);

    // 無限スクロールを数回進めて直近投稿を読み込む（遷移中のevaluate失敗はリトライ）
    for (let i = 0; i < 3; i++) {
      try {
        await page.evaluate(() => window.scrollBy(0, window.innerHeight * 2));
      } catch {
        await page.waitForTimeout(2000); // 遷移中なら待って次のループへ
      }
      await page.waitForTimeout(1500);
    }

    // 抽出本体も遷移直後に失敗しうるため1回リトライ
    let posts: ScrapedPost[];
    try {
      posts = await extractPosts(page);
    } catch {
      await page.waitForTimeout(3000);
      posts = await extractPosts(page);
    }
    return posts;
  } finally {
    await browser.close();
  }
}

/**
 * 投稿カード抽出。ROOMのmyROOMカード構造（2026-07時点）:
 *   div[class*="collect--"] の innerText が
 *   「キャプション\n￥価格\n…\nいいね数\n…\nコメント数」の並びになっている。
 * → 価格行(￥…)の後に最初に現れる数字のみの行 = いいね数
 */
async function extractPosts(page: import("playwright").Page): Promise<ScrapedPost[]> {
  return page.evaluate(() => {
    const results: Array<{ title: string; likes: number }> = [];
    const seen = new Set<string>();
    document.querySelectorAll<HTMLElement>('div[class*="collect--"]').forEach((card) => {
      const text = card.innerText ?? "";
      if (text.length < 20) return;
      const lines = text.split("\n").map((l) => l.trim()).filter((l) => l.length > 0);
      const priceIdx = lines.findIndex((l) => /^[￥¥][\d,]+/.test(l));
      if (priceIdx < 0) return;
      let likes = -1;
      for (let i = priceIdx + 1; i < Math.min(priceIdx + 4, lines.length); i++) {
        if (/^[\d,]+$/.test(lines[i]!)) {
          likes = parseInt(lines[i]!.replace(/,/g, ""), 10);
          break;
        }
      }
      if (likes < 0) return;
      // キャプション全文（価格行より前）を突合キーにする
      const caption = lines.slice(0, priceIdx).join(" ").slice(0, 300);
      if (!caption || seen.has(caption.slice(0, 40))) return;
      seen.add(caption.slice(0, 40));
      results.push({ title: caption, likes });
    });
    return results;
  });
}

const normalize = (s: string) => s.replace(/\s+/g, "");

/**
 * 履歴レコードとの突合:
 * 1. captionHead(投稿文の冒頭25文字)がスクレイプしたキャプションに含まれるか
 * 2. フォールバック: 商品名の8文字スライド窓がキャプションに含まれるか
 */
function matchRecord(scrapedCaption: string, rec: { itemName: string; captionHead?: string }): boolean {
  const cap = normalize(scrapedCaption);
  if (rec.captionHead) {
    const head = normalize(rec.captionHead).slice(0, 15);
    if (head.length >= 8 && cap.includes(head)) return true;
  }
  const name = normalize(rec.itemName.replace(/【[^】]*】/g, ""));
  for (let i = 0; i + 8 <= Math.min(name.length, 48); i += 4) {
    if (cap.includes(name.slice(i, i + 8))) return true;
  }
  return false;
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
      const hit = scraped.find((s) => matchRecord(s.title, rec));
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
