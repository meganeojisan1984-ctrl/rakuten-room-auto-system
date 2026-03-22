/**
 * run_follow.ts - GitHub Actions用 自動フォロー単独実行スクリプト
 */
import * as dotenv from "dotenv";
dotenv.config();

import * as fs from "fs";
import * as path from "path";
import { runAutoFollow } from "./actions/auto_follow";

const dataDir = path.join(process.cwd(), "data");
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const MAX_FOLLOWS = parseInt(process.env.MAX_FOLLOWS ?? "10", 10);
const INFLUENCER_IDS = (process.env.INFLUENCER_IDS ?? "room_official")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

console.log("=== 楽天ROOM 自動フォロー 開始 ===");
runAutoFollow(MAX_FOLLOWS, INFLUENCER_IDS, true)
  .then(() => {
    console.log("=== 自動フォロー 完了 ===");
    process.exit(0);
  })
  .catch((err) => {
    console.error("エラー:", err);
    process.exit(1);
  });
