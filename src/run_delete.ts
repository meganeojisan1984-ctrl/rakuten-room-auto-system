/**
 * run_delete.ts - GitHub Actions用 自動削除単独実行スクリプト
 */
import * as dotenv from "dotenv";
dotenv.config();

import * as fs from "fs";
import * as path from "path";
import { runAutoDelete } from "./actions/auto_delete";

const dataDir = path.join(process.cwd(), "data");
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const MAX_DELETES = parseInt(process.env.MAX_DELETES ?? "10", 10);

console.log("=== 楽天ROOM 自動削除 開始 ===");
runAutoDelete(MAX_DELETES, true)
  .then(() => {
    console.log("=== 自動削除 完了 ===");
    process.exit(0);
  })
  .catch((err) => {
    console.error("エラー:", err);
    process.exit(1);
  });
