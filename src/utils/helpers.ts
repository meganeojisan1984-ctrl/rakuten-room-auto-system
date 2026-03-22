/**
 * helpers.ts - 時間制御・共通ユーティリティ関数
 */

/**
 * ランダムなスリープ (BAN対策・人間らしい動作)
 * @param minMs 最小待機ミリ秒
 * @param maxMs 最大待機ミリ秒
 */
export function randomSleep(minMs: number, maxMs: number): Promise<void> {
  const ms = minMs + Math.random() * (maxMs - minMs);
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 固定スリープ
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 現在の日時を日本時間の文字列で返す
 */
export function nowJST(): string {
  return new Date().toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" });
}

/**
 * 配列をランダムシャッフル (Fisher-Yates)
 */
export function shuffle<T>(arr: T[]): T[] {
  const result = [...arr];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j]!, result[i]!];
  }
  return result;
}

/**
 * リトライ付き実行
 * @param fn 実行する非同期関数
 * @param maxRetries 最大リトライ回数
 * @param baseDelayMs 初回待機ミリ秒 (指数バックオフ)
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  baseDelayMs: number = 3000
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt < maxRetries) {
        const delay = baseDelayMs * Math.pow(2, attempt);
        console.warn(`[retry] ${attempt + 1}/${maxRetries} 失敗、${delay}ms後に再試行...`);
        await sleep(delay);
      }
    }
  }
  throw lastError;
}
