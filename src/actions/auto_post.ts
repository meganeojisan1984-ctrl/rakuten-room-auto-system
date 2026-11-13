/** Scheduled ROOM posting consumes the same reviewed browser bundle as main. */
import { runBrowserPostFromEnvironment } from "../browser-post-runner";
import { addLog } from "../api/server";

export async function runAutoPost(postCount = 1, headless = true): Promise<void> {
  if (postCount !== 1) throw new Error("BROWSER_ROUTE_REQUIRES_ONE_BOUND_PRODUCT");
  addLog("auto_post", "info", "ブラウザ生成bundleの確認と画像付きROOM投稿を開始");
  try {
    const result = await runBrowserPostFromEnvironment(headless);
    addLog("auto_post", "info", "ROOM投稿確認: " + result.roomPostUrl);
  } catch (error) {
    addLog("auto_post", "error", error instanceof Error ? error.message : "投稿停止");
    throw error;
  }
}
