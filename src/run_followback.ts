/**
 * run_followback.ts - GitHub Actions用 自動フォロー返し単独実行スクリプト
 */
import * as dotenv from "dotenv";
dotenv.config();

import * as fs from "fs";
import * as path from "path";
import { runAutoFollowback } from "./actions/auto_followback";

const dataDir = path.join(process.cwd(), "data");
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const MAX_FOLLOWBACKS = parseInt(process.env.MAX_FOLLOWBACKS ?? "30", 10);

console.log("=== 楽天ROOM フォロー返し 開始 ===");
runAutoFollowback(MAX_FOLLOWBACKS, true)
  .then(() => {
    console.log("=== フォロー返し 完了 ===");
    process.exit(0);
  })
  .catch((err) => {
    console.error("エラー:", err);
    process.exit(1);
  });
