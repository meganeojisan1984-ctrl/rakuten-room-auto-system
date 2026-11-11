/** Browser-authored product bundle only. No AI API or random-product fallback. */
import * as dotenv from "dotenv";
import { runBrowserPostFromEnvironment } from "./browser-post-runner";
dotenv.config();

runBrowserPostFromEnvironment().then(result => {
  console.log("[main] ROOM画像付き投稿を確認:", result.roomPostUrl);
}).catch(error => {
  console.error("[main] 投稿停止:", error instanceof Error ? error.message : "不明なエラー");
  process.exitCode = 1;
});
