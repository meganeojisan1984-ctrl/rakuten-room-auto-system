import * as fs from "fs";
import * as path from "path";

export interface RoomPostIntentItem {
  itemCode: string;
  itemName: string;
  itemUrl: string;
}

export interface RoomPostIntent {
  version: 1;
  requestId: string;
  createdAt: string;
  items: RoomPostIntentItem[];
}

const INTENT_FILE = path.join(process.cwd(), "room_post_intent.json");

function emptyIntent(): RoomPostIntent {
  return { version: 1, requestId: "", createdAt: "", items: [] };
}

export function readRoomPostIntent(): RoomPostIntent {
  try {
    const value = JSON.parse(fs.readFileSync(INTENT_FILE, "utf-8")) as Partial<RoomPostIntent>;
    if (!Array.isArray(value.items)) {
      throw new Error("itemsが配列ではありません");
    }
    return {
      version: 1,
      requestId: String(value.requestId ?? ""),
      createdAt: String(value.createdAt ?? ""),
      items: value.items.map((item) => ({
        itemCode: String(item.itemCode),
        itemName: String(item.itemName),
        itemUrl: String(item.itemUrl),
      })),
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return emptyIntent();
    throw new Error(`ROOM投稿intentを安全に読み込めません: ${String(error)}`);
  }
}

export function createRoomPostIntent(items: RoomPostIntentItem[], requestId = `room-${Date.now()}-${Math.random().toString(16).slice(2)}`): RoomPostIntent {
  return { version: 1, requestId, createdAt: new Date().toISOString(), items };
}

export function hasUnresolvedRoomPostIntent(intent: RoomPostIntent): boolean {
  return intent.items.length > 0;
}

function writeLocal(intent: RoomPostIntent): void {
  const temp = `${INTENT_FILE}.tmp-${process.pid}`;
  fs.writeFileSync(temp, JSON.stringify(intent, null, 2) + "\n", { mode: 0o600 });
  fs.renameSync(temp, INTENT_FILE);
}

async function writeRemote(intent: RoomPostIntent): Promise<void> {
  const token = process.env.GITHUB_TOKEN;
  const repository = process.env.GITHUB_REPOSITORY;
  if (!token || !repository) {
    if (process.env.CI === "true") {
      throw new Error("CIでのROOM投稿intent永続化に必要な既存GitHub環境がありません");
    }
    return;
  }

  const api = `https://api.github.com/repos/${repository}/contents/room_post_intent.json`;
  const headers = {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "X-GitHub-Api-Version": "2022-11-28",
    "Content-Type": "application/json",
  };
  const current = await fetch(api, { headers });
  let sha: string | undefined;
  if (current.ok) {
    const body = await current.json() as { sha?: string };
    sha = body.sha;
  } else if (current.status !== 404) {
    throw new Error(`ROOM投稿intentの既存状態確認に失敗しました: HTTP ${current.status}`);
  }

  const response = await fetch(api, {
    method: "PUT",
    headers,
    body: JSON.stringify({
      message: intent.items.length > 0
        ? `chore: persist ROOM post intent ${intent.requestId} [skip ci]`
        : `chore: clear ROOM post intent ${intent.requestId} [skip ci]`,
      content: Buffer.from(JSON.stringify(intent, null, 2) + "\n").toString("base64"),
      branch: process.env.GITHUB_REF_NAME || "main",
      ...(sha ? { sha } : {}),
    }),
  });
  if (!response.ok) {
    throw new Error(`ROOM投稿intentの永続化に失敗しました: HTTP ${response.status}`);
  }
}

export async function persistRoomPostIntent(intent: RoomPostIntent): Promise<void> {
  writeLocal(intent);
  await writeRemote(intent);
}

export async function clearRoomPostIntent(requestId: string): Promise<void> {
  const cleared = { version: 1 as const, requestId, createdAt: new Date().toISOString(), items: [] };
  await writeRemote(cleared);
  writeLocal(cleared);
}
