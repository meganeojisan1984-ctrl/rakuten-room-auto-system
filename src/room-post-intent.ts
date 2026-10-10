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

export interface RemoteRoomPostIntent {
  intent: RoomPostIntent;
  sha?: string;
  available: boolean;
}

const INTENT_FILE = path.join(process.cwd(), "room_post_intent.json");

function emptyIntent(): RoomPostIntent {
  return { version: 1, requestId: "", createdAt: "", items: [] };
}

function parseIntent(raw: unknown): RoomPostIntent {
  if (!raw || typeof raw !== "object") throw new Error("intentがオブジェクトではありません");
  const value = raw as Partial<RoomPostIntent>;
  if (!Array.isArray(value.items)) throw new Error("itemsが配列ではありません");
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
}

export function readRoomPostIntent(): RoomPostIntent {
  try {
    return parseIntent(JSON.parse(fs.readFileSync(INTENT_FILE, "utf-8")));
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

function authContext(): { token: string; repository: string; api: string; headers: Record<string, string> } | null {
  const token = process.env.GITHUB_TOKEN;
  const repository = process.env.GITHUB_REPOSITORY;
  if (!token || !repository) {
    if (process.env.CI === "true") {
      throw new Error("CIでのROOM投稿intent永続化に必要な既存GitHub環境がありません");
    }
    return null;
  }
  return {
    token,
    repository,
    api: `https://api.github.com/repos/${repository}/contents/room_post_intent.json`,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
    },
  };
}

export async function readRemoteRoomPostIntent(): Promise<RemoteRoomPostIntent> {
  const context = authContext();
  if (!context) return { intent: emptyIntent(), available: false };
  const readApi = `${context.api}?ref=${encodeURIComponent(process.env.GITHUB_REF_NAME || "main")}`;
  const response = await fetch(readApi, { headers: context.headers });
  if (response.status === 404) return { intent: emptyIntent(), available: true };
  if (!response.ok) throw new Error(`ROOM投稿intentのremote確認に失敗しました: HTTP ${response.status}`);
  const body = await response.json() as { sha?: string; content?: string };
  if (!body.content) throw new Error("ROOM投稿intentのremote内容がありません");
  let intent: RoomPostIntent;
  try {
    intent = parseIntent(JSON.parse(Buffer.from(body.content.replace(/\s/g, ""), "base64").toString("utf-8")));
  } catch (error) {
    throw new Error(`ROOM投稿intentのremote内容を安全に読めません: ${String(error)}`);
  }
  return { intent, sha: body.sha, available: true };
}

async function writeRemote(intent: RoomPostIntent, sha?: string): Promise<void> {
  const context = authContext();
  if (!context) return;
  const response = await fetch(context.api, {
    method: "PUT",
    headers: context.headers,
    body: JSON.stringify({
      message: intent.items.length > 0
        ? `chore: persist ROOM post intent ${intent.requestId} [skip ci]`
        : `chore: clear ROOM post intent ${intent.requestId} [skip ci]`,
      content: Buffer.from(JSON.stringify(intent, null, 2) + "\n").toString("base64"),
      branch: process.env.GITHUB_REF_NAME || "main",
      ...(sha ? { sha } : {}),
    }),
  });
  if (!response.ok) throw new Error(`ROOM投稿intentの永続化に失敗しました: HTTP ${response.status}`);
}

export async function persistRoomPostIntent(intent: RoomPostIntent): Promise<void> {
  const remote = await readRemoteRoomPostIntent();
  if (hasUnresolvedRoomPostIntent(remote.intent)) {
    if (remote.intent.requestId !== intent.requestId) {
      throw new Error(`既存の未解決ROOM投稿intentがあります（requestId=${remote.intent.requestId}）。再送しません`);
    }
    writeLocal(intent);
    return;
  }
  writeLocal(intent);
  await writeRemote(intent, remote.sha);
}





export async function syncPostedItemsFromRemote(): Promise<void> {
  const context = authContext();
  if (!context) return;
  const postedApi = `https://api.github.com/repos/${context.repository}/contents/posted_items.json`;
  const readApi = `${postedApi}?ref=${encodeURIComponent(process.env.GITHUB_REF_NAME || "main")}`;
  const response = await fetch(readApi, { headers: context.headers });
  if (response.status === 404) return;
  if (!response.ok) throw new Error(`posted_items.jsonのactive branch取得に失敗しました: HTTP ${response.status}`);
  const body = await response.json() as { content?: string };
  if (!body.content) throw new Error("posted_items.jsonのactive branch内容がありません");
  let remoteState: { postedItemCodes?: string[]; uncertainItemCodes?: string[]; postTypeIndex?: number };
  try {
    remoteState = JSON.parse(Buffer.from(body.content.replace(/\s/g, ""), "base64").toString("utf-8"));
  } catch (error) {
    throw new Error(`posted_items.jsonのactive branch内容を安全に読めません: ${String(error)}`);
  }
  const localPath = path.join(process.cwd(), "posted_items.json");
  const localState = JSON.parse(fs.readFileSync(localPath, "utf-8")) as {
    postedItemCodes?: string[];
    uncertainItemCodes?: string[];
    postTypeIndex?: number;
  };
  const merged = {
    postedItemCodes: [...new Set([...(localState.postedItemCodes ?? []), ...(remoteState.postedItemCodes ?? [])])],
    uncertainItemCodes: [...new Set([...(localState.uncertainItemCodes ?? []), ...(remoteState.uncertainItemCodes ?? [])])],
    postTypeIndex: remoteState.postTypeIndex ?? localState.postTypeIndex ?? 0,
  };
  fs.writeFileSync(localPath, JSON.stringify(merged, null, 2) + "\n");
}

export async function persistPostedItemsAndVerify(requiredCodes: string[]): Promise<void> {
  if (requiredCodes.length === 0) return;
  const context = authContext();
  if (!context) return;

  const postedApi = `https://api.github.com/repos/${context.repository}/contents/posted_items.json`;
  const readApi = `${postedApi}?ref=${encodeURIComponent(process.env.GITHUB_REF_NAME || "main")}`;
  const headers = context.headers;
  const current = await fetch(readApi, { headers });
  let remoteSha: string | undefined;
  let remoteState: { postedItemCodes?: string[]; uncertainItemCodes?: string[]; postTypeIndex?: number } = {};
  if (current.ok) {
    const body = await current.json() as { sha?: string; content?: string };
    remoteSha = body.sha;
    if (body.content) {
      try {
        remoteState = JSON.parse(Buffer.from(body.content.replace(/\s/g, ""), "base64").toString("utf-8"));
      } catch (error) {
        throw new Error(`posted_items.jsonのremote内容を安全に読めません: ${String(error)}`);
      }
    }
  } else if (current.status !== 404) {
    throw new Error(`posted_items.jsonのremote確認に失敗しました: HTTP ${current.status}`);
  }

  const localPath = path.join(process.cwd(), "posted_items.json");
  const localState = JSON.parse(fs.readFileSync(localPath, "utf-8")) as {
    postedItemCodes?: string[];
    uncertainItemCodes?: string[];
    postTypeIndex?: number;
  };
  const merged = {
    postedItemCodes: [...new Set([...(remoteState.postedItemCodes ?? []), ...(localState.postedItemCodes ?? [])])],
    uncertainItemCodes: [...new Set([...(remoteState.uncertainItemCodes ?? []), ...(localState.uncertainItemCodes ?? [])])],
    postTypeIndex: localState.postTypeIndex ?? remoteState.postTypeIndex ?? 0,
  };
  const response = await fetch(postedApi, {
    method: "PUT",
    headers,
    body: JSON.stringify({
      message: "chore: persist ROOM posted state before clearing intent [skip ci]",
      content: Buffer.from(JSON.stringify(merged, null, 2) + "\n").toString("base64"),
      branch: process.env.GITHUB_REF_NAME || "main",
      ...(remoteSha ? { sha: remoteSha } : {}),
    }),
  });
  if (!response.ok) throw new Error(`posted_items.jsonのremote保存に失敗しました: HTTP ${response.status}`);

  const verify = await fetch(readApi, { headers });
  if (!verify.ok) throw new Error(`posted_items.jsonのremote読み戻しに失敗しました: HTTP ${verify.status}`);
  const verifyBody = await verify.json() as { content?: string };
  if (!verifyBody.content) throw new Error("posted_items.jsonのremote読み戻し内容がありません");
  const verified = JSON.parse(Buffer.from(verifyBody.content.replace(/\s/g, ""), "base64").toString("utf-8")) as { postedItemCodes?: string[] };
  if (!requiredCodes.every((code) => (verified.postedItemCodes ?? []).includes(code))) {
    throw new Error("posted_items.jsonのremote読み戻しに成功コードがありません");
  }
  // safe-pushの再適用でもremote側の並行writer履歴を失わないよう、検証済みマージ結果をcheckoutへ戻す。
  fs.writeFileSync(localPath, JSON.stringify(merged, null, 2) + "\n");
}

export async function clearRoomPostIntent(requestId: string): Promise<void> {
  const remote = await readRemoteRoomPostIntent();
  if (!hasUnresolvedRoomPostIntent(remote.intent)) {
    writeLocal(emptyIntent());
    return;
  }
  if (remote.intent.requestId !== requestId) {
    throw new Error(`別requestIdのROOM投稿intentを消去しません（requestId=${remote.intent.requestId}）`);
  }
  const cleared = { version: 1 as const, requestId, createdAt: new Date().toISOString(), items: [] };
  await writeRemote(cleared, remote.sha);
  writeLocal(cleared);
}
