/**
 * run_like.ts - GitHub Actions用 自動いいね単独実行スクリプト
 */
import * as dotenv from "dotenv";
dotenv.config();

import * as fs from "fs";
import * as path from "path";
import { runAutoLike } from "./actions/auto_like";

// data/ ディレクトリを確保 (SQLiteログ用)
const dataDir = path.join(process.cwd(), "data");
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const MAX_LIKES = parseInt(process.env.MAX_LIKES ?? "30", 10);

console.log("=== 楽天ROOM 自動いいね 開始 ===");
runAutoLike(MAX_LIKES, true)
  .then(() => {
    console.log("=== 自動いいね 完了 ===");
    process.exit(0);
  })
  .catch((err) => {
    console.error("エラー:", err);
    process.exit(1);
  });
