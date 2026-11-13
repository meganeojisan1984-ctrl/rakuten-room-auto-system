import { createHash } from "node:crypto";

export type BrowserReservation = {
  requestId: string; manifestId: string; manifestHash: string; itemCode: string; itemUrl: string;
  imageSha256: string; captionSha256: string; createdAt: string;
  status: "reserved" | "unknown" | "published";
  roomPostUrl?: string;
};
export type BrowserPostState = { version: 1; active: BrowserReservation | null; records: BrowserReservation[] };
export type StateSnapshot = { state: BrowserPostState; revision?: string; excludedItemCodes: string[] };
export interface BrowserPostStateStore {
  read(): Promise<StateSnapshot>;
  save(state: BrowserPostState, revision?: string): Promise<StateSnapshot>;
  persistPosted(itemCode: string): Promise<void>;
}
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
function object(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("BROWSER_STATE_INVALID");
  return raw as Record<string, unknown>;
}
function strings(raw: unknown): string[] {
  if (!Array.isArray(raw) || raw.some(x => typeof x !== "string" || !x.trim())) throw new Error("BROWSER_POSTED_STATE_INVALID");
  return raw;
}
function reservation(raw: unknown): BrowserReservation {
  const value = object(raw);
  for (const key of ["requestId", "manifestId", "itemCode", "itemUrl", "createdAt"]) {
    if (typeof value[key] !== "string" || !value[key] || (value[key] as string).length > 3000) throw new Error("BROWSER_RESERVATION_INVALID");
  }
  for (const key of ["manifestHash", "imageSha256", "captionSha256"]) {
    if (typeof value[key] !== "string" || !/^[a-f0-9]{64}$/.test(value[key] as string)) throw new Error("BROWSER_RESERVATION_INVALID");
  }
  if (!["reserved", "unknown", "published"].includes(value.status as string)) throw new Error("BROWSER_RESERVATION_INVALID");
  if (!Number.isFinite(Date.parse(value.createdAt as string))) throw new Error("BROWSER_RESERVATION_INVALID");
  if (value.roomPostUrl !== undefined && typeof value.roomPostUrl !== "string") throw new Error("BROWSER_RESERVATION_INVALID");
  return value as BrowserReservation;
}
export function parseBrowserPostState(raw: unknown): BrowserPostState {
  const value = object(raw);
  if (value.version !== 1 || !Array.isArray(value.records) || !Object.hasOwn(value, "active")) throw new Error("BROWSER_STATE_INVALID");
  return { version: 1, active: value.active === null ? null : reservation(value.active), records: value.records.map(reservation) };
}
export function legacyExcludedItemCodes(intentRaw: unknown, postedRaw: unknown): string[] {
  const intent = object(intentRaw), posted = object(postedRaw);
  if (intent.version !== 1 || !Array.isArray(intent.items) || typeof intent.requestId !== "string" || typeof intent.createdAt !== "string") throw new Error("BROWSER_LEGACY_INTENT_INVALID");
  const legacyCodes = intent.items.map(item => {
    const value = object(item);
    if (typeof value.itemCode !== "string" || !value.itemCode.trim()) throw new Error("BROWSER_LEGACY_INTENT_INVALID");
    return value.itemCode;
  });
  const postedCodes = strings(posted.postedItemCodes);
  const uncertainCodes = posted.uncertainItemCodes === undefined ? [] : strings(posted.uncertainItemCodes);
  return [...new Set([...legacyCodes, ...postedCodes, ...uncertainCodes])];
}

export function createGithubBrowserStateStore(options: {
  token: string; repository: string; branch?: string; fetch?: typeof fetch;
}): BrowserPostStateStore {
  if (!options.token || !/^[\w.-]+\/[\w.-]+$/.test(options.repository)) throw new Error("BROWSER_REMOTE_STATE_AUTH_REQUIRED");
  const branch = options.branch ?? "main";
  if (!branch || /[\r\n]/.test(branch)) throw new Error("BROWSER_STATE_BRANCH_INVALID");
  const request = options.fetch ?? fetch;
  const headers = { Accept: "application/vnd.github+json", Authorization: "Bearer " + options.token, "X-GitHub-Api-Version": "2022-11-28", "Content-Type": "application/json" };
  const base = "https://api.github.com/repos/" + options.repository + "/contents/";
  async function readFile(name: string, optional = false): Promise<{ data: unknown; sha?: string }> {
    const response = await request(base + name + "?ref=" + encodeURIComponent(branch), { headers });
    if (response.status === 404 && optional) return { data: { version: 1, active: null, records: [] } };
    if (!response.ok) throw new Error("BROWSER_STATE_READ_FAILED_" + response.status);
    const body = await response.json() as { content?: string; sha?: string };
    if (typeof body.content !== "string" || typeof body.sha !== "string" || body.content.length > 512 * 1024) throw new Error("BROWSER_STATE_RESPONSE_INVALID");
    return { data: JSON.parse(Buffer.from(body.content.replace(/\s/g, ""), "base64").toString("utf8")), sha: body.sha };
  }
  async function writeFile(name: string, data: unknown, sha: string | undefined): Promise<{ data: unknown; sha?: string }> {
    const json = JSON.stringify(data, null, 2) + "\n";
    if (Buffer.byteLength(json) > 256 * 1024) throw new Error("BROWSER_STATE_TOO_LARGE");
    const response = await request(base + name, { method: "PUT", headers, body: JSON.stringify({
      message: "chore: persist browser ROOM posting state [skip ci]",
      content: Buffer.from(json).toString("base64"), branch, ...(sha ? { sha } : {}),
    }) });
    if (!response.ok) throw new Error("BROWSER_STATE_WRITE_FAILED_" + response.status);
    const verified = await readFile(name);
    if (hash(verified.data) !== hash(data)) throw new Error("BROWSER_STATE_READBACK_MISMATCH");
    return verified;
  }
  async function excluded(): Promise<string[]> {
    // The legacy unresolved intent is read-only and never cleared by this route.
    const legacy = await readFile("room_post_intent.json");
    const posted = await readFile("posted_items.json");
    return legacyExcludedItemCodes(legacy.data, posted.data);
  }
  return {
    async read() {
      const own = await readFile("browser_room_post_state.json", true);
      return { state: parseBrowserPostState(own.data), revision: own.sha, excludedItemCodes: await excluded() };
    },
    async save(state, revision) {
      const validated = parseBrowserPostState(state);
      const written = await writeFile("browser_room_post_state.json", validated, revision);
      return { state: parseBrowserPostState(written.data), revision: written.sha, excludedItemCodes: await excluded() };
    },
    async persistPosted(itemCode) {
      const current = await readFile("posted_items.json");
      const data = object(current.data);
      const codes = strings(data.postedItemCodes);
      const uncertain = data.uncertainItemCodes === undefined ? [] : strings(data.uncertainItemCodes);
      // Preserve all historic fields and uncertain codes. Never delete the legacy intent.
      const next = { ...data, postedItemCodes: [...new Set([...codes, itemCode])], uncertainItemCodes: uncertain };
      const verified = await writeFile("posted_items.json", next, current.sha);
      if (!strings(object(verified.data).postedItemCodes).includes(itemCode)) throw new Error("BROWSER_POSTED_VERIFY_FAILED");
    },
  };
}
