/** Pure plans for the supported GitHub-connector + existing-Mac-CUA protocol.
 * No network, browser launch, credentials, upload, or publish action occurs here.
 * Snapshot/evidence provenance is asserted by the operator, not proved by JSON.
 */
import { createHash, randomUUID } from "node:crypto";
import { validateBrowserPostBundle, canonicalRoomCollectUrl, type ValidatedBrowserPostBundle } from "./browser-post-bundle";
import { legacyExcludedItemCodes, parseBrowserPostState, type BrowserPostState, type BrowserReservation } from "./browser-post-state";
import { canonicalRoomProfileUrl } from "./room-account";

export const ROOM_REPOSITORY = "meganeojisan1984-ctrl/rakuten-room-auto-system";
export const STATE_PATHS = ["room_post_intent.json", "posted_items.json", "browser_room_post_state.json"] as const;
export type RemoteFile = { sha: string; content: string };
export type ConnectorSnapshot = {
  version: 1; source: "GitHub connector"; repository: string; branch: "main";
  head: string; tree: string; sourceRef: string; parents: string[]; fetchedAt: string;
  files: Record<typeof STATE_PATHS[number], RemoteFile>;
};
export type TransactionPlan = {
  version: 1; operation: "reserve" | "begin" | "finish";
  repository: string; branch: "main"; expectedHead: string; baseTree: string;
  requestId: string; attemptId?: string; manifestHash: string; createdAt: string;
  legacySha: string; postedBeforeSha: string;
  treeElements: { path: string; mode: "100644"; type: "blob"; content: string }[];
  browserActionPermitted: false;
};
type BoundReservation = BrowserReservation & { profileUrl: string; collectUrl: string; attemptId?: string };
const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
export const gitBlobSha = (s: string) => createHash("sha1").update("blob " + Buffer.byteLength(s) + "\0").update(s).digest("hex");
const json = (s: unknown) => JSON.stringify(s, null, 2) + "\n";
function object(v: unknown): Record<string, any> {
  if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error("TRANSACTION_OBJECT_INVALID");
  return v as Record<string, any>;
}
function sha(v: unknown): v is string { return typeof v === "string" && /^[0-9a-f]{40}$/.test(v); }
function fresh(value: unknown, now: number): void {
  const date = typeof value === "string" ? Date.parse(value) : NaN;
  if (!Number.isFinite(date) || date > now || now - date > 120000) throw new Error("TRANSACTION_SNAPSHOT_STALE");
}
export function parseConnectorSnapshot(raw: unknown, now = Date.now()): ConnectorSnapshot {
  const v = object(raw);
  if (v.version !== 1 || v.source !== "GitHub connector" || v.repository !== ROOM_REPOSITORY || v.branch !== "main" ||
      !sha(v.head) || !sha(v.tree) || v.sourceRef !== v.head || !Array.isArray(v.parents) || !v.parents.every(sha)) throw new Error("TRANSACTION_REMOTE_IDENTITY_INVALID");
  fresh(v.fetchedAt, now);
  const files = object(v.files);
  for (const p of STATE_PATHS) {
    const f = object(files[p]);
    if (!sha(f.sha) || typeof f.content !== "string" || Buffer.byteLength(f.content) > 256 * 1024 || gitBlobSha(f.content) !== f.sha) throw new Error("TRANSACTION_REMOTE_FILE_INVALID:" + p);
    object(JSON.parse(f.content));
  }
  // Missing/malformed legacy data never means an empty exclusion list.
  legacyExcludedItemCodes(JSON.parse(files[STATE_PATHS[0]].content), JSON.parse(files[STATE_PATHS[1]].content));
  parseBrowserPostState(JSON.parse(files[STATE_PATHS[2]].content));
  return v as ConnectorSnapshot;
}
function parts(snapshot: ConnectorSnapshot) {
  return {
    state: parseBrowserPostState(JSON.parse(snapshot.files[STATE_PATHS[2]].content)),
    posted: object(JSON.parse(snapshot.files[STATE_PATHS[1]].content)),
    excluded: legacyExcludedItemCodes(JSON.parse(snapshot.files[STATE_PATHS[0]].content), JSON.parse(snapshot.files[STATE_PATHS[1]].content)),
  };
}
function bind(active: BrowserReservation | null, bundle: ValidatedBrowserPostBundle, requestId: string): BoundReservation {
  const a = active as BoundReservation | null;
  if (!a || a.requestId !== requestId || a.manifestHash !== bundle.manifestHash || a.manifestId !== bundle.manifestId ||
      a.itemCode !== bundle.item.itemCode || a.itemUrl !== bundle.item.itemUrl || a.imageSha256 !== bundle.image.sha256 ||
      a.captionSha256 !== sha256(bundle.caption) || a.collectUrl !== bundle.collectUrl || !a.profileUrl || canonicalRoomProfileUrl(a.profileUrl) !== a.profileUrl) throw new Error("TRANSACTION_RESERVATION_MISMATCH");
  return a;
}
function plan(snapshot: ConnectorSnapshot, operation: TransactionPlan["operation"], active: BoundReservation, state: BrowserPostState, posted?: Record<string, any>): TransactionPlan {
  const treeElements: TransactionPlan["treeElements"] = [{ path: STATE_PATHS[2], mode: "100644", type: "blob", content: json(state) }];
  if (posted) treeElements.push({ path: STATE_PATHS[1], mode: "100644", type: "blob", content: json(posted) });
  return { version: 1, operation, repository: snapshot.repository, branch: "main", expectedHead: snapshot.head, baseTree: snapshot.tree,
    requestId: active.requestId, ...(active.attemptId ? { attemptId: active.attemptId } : {}), manifestHash: active.manifestHash,
    createdAt: new Date().toISOString(), legacySha: snapshot.files[STATE_PATHS[0]].sha, postedBeforeSha: snapshot.files[STATE_PATHS[1]].sha,
    treeElements, browserActionPermitted: false };
}
export function reserveTransaction(manifest: string, rawSnapshot: unknown, profileUrl: string): TransactionPlan {
  const snapshot = parseConnectorSnapshot(rawSnapshot), bundle = validateBrowserPostBundle(manifest), p = parts(snapshot);
  if (p.state.active) throw new Error("BROWSER_ACTIVE_POST_UNRESOLVED");
  if (p.excluded.includes(bundle.item.itemCode)) throw new Error("BROWSER_PRODUCT_ALREADY_POSTED_OR_UNCERTAIN");
  if (p.state.records.some(r => r.itemCode === bundle.item.itemCode || r.manifestId === bundle.manifestId || r.manifestHash === bundle.manifestHash || r.imageSha256 === bundle.image.sha256)) throw new Error("BROWSER_BUNDLE_ALREADY_CONSUMED");
  const active: BoundReservation = { requestId: randomUUID(), manifestId: bundle.manifestId, manifestHash: bundle.manifestHash,
    itemCode: bundle.item.itemCode, itemUrl: bundle.item.itemUrl, imageSha256: bundle.image.sha256, captionSha256: sha256(bundle.caption),
    createdAt: new Date().toISOString(), status: "reserved", profileUrl: canonicalRoomProfileUrl(profileUrl), collectUrl: bundle.collectUrl };
  return plan(snapshot, "reserve", active, { ...p.state, active });
}
export function beginTransaction(manifest: string, rawSnapshot: unknown, requestId: string): TransactionPlan {
  const snapshot = parseConnectorSnapshot(rawSnapshot), bundle = validateBrowserPostBundle(manifest), p = parts(snapshot), a = bind(p.state.active, bundle, requestId);
  if (a.status !== "reserved" || a.attemptId) throw new Error("TRANSACTION_ATTEMPT_ALREADY_STARTED");
  if (p.excluded.includes(bundle.item.itemCode)) throw new Error("BROWSER_PRODUCT_BECAME_EXCLUDED");
  // Persist uncertainty BEFORE first external mutation. A new/resumed worker must
  // not replay an unknown attempt, even if it never reached the browser.
  const active: BoundReservation = { ...a, status: "unknown", attemptId: randomUUID() };
  return plan(snapshot, "begin", active, { ...p.state, active });
}
function productUrl(value: unknown): string {
  if (typeof value !== "string") throw new Error("TRANSACTION_PRODUCT_URL_INVALID");
  const u = new URL(value);
  if (u.origin !== "https://item.rakuten.co.jp" || u.username || u.password || !/^\/[^/]+\/[^/]+\/?$/.test(u.pathname)) throw new Error("TRANSACTION_PRODUCT_URL_INVALID");
  return u.origin + u.pathname.replace(/\/$/, "");
}
function photoUrl(value: unknown): string {
  if (typeof value !== "string") throw new Error("TRANSACTION_PHOTO_URL_INVALID");
  const u = new URL(value);
  if (u.origin !== "https://room.r10s.jp" || u.username || u.password || u.pathname.length < 2) throw new Error("TRANSACTION_PHOTO_URL_INVALID");
  return u.origin + u.pathname;
}
export function finishTransaction(manifest: string, rawSnapshot: unknown, rawEvidence: unknown): TransactionPlan {
  const snapshot = parseConnectorSnapshot(rawSnapshot), bundle = validateBrowserPostBundle(manifest), p = parts(snapshot), e = object(rawEvidence);
  const a = bind(p.state.active, bundle, e.requestId);
  if (a.status !== "unknown" || !a.attemptId || e.attemptId !== a.attemptId || e.manifestHash !== bundle.manifestHash ||
      e.source !== "Mac CUA observed" || e.imageDecoded !== true || e.visualProductMatch !== true || e.captionVerified !== true || e.samePostScopeVerified !== true || e.uploadMappingVerified !== true) throw new Error("TRANSACTION_CONFIRMATION_MISSING");
  fresh(e.observedAt, Date.now());
  if (canonicalRoomProfileUrl(e.ownProfileUrl) !== a.profileUrl || canonicalRoomCollectUrl(e.collectUrl) !== a.collectUrl ||
      productUrl(e.productUrl) !== productUrl(a.itemUrl) || e.captionSha256 !== a.captionSha256 || photoUrl(e.uploadedImageUrl) !== photoUrl(e.publishedImageUrl)) throw new Error("TRANSACTION_CONFIRMATION_MISMATCH");
  const permalink = new URL(e.roomPostUrl);
  if (permalink.username || permalink.password || permalink.search || permalink.hash || !/^\/room_[A-Za-z0-9_-]+\/170\d+\/?$/.test(permalink.pathname) ||
      canonicalRoomProfileUrl(permalink.origin + "/" + permalink.pathname.split("/")[1]) !== a.profileUrl) throw new Error("TRANSACTION_PERMALINK_INVALID");
  if (p.state.records.some(r => r.roomPostUrl === permalink.href)) throw new Error("TRANSACTION_PERMALINK_ALREADY_RECORDED");
  const published = { ...a, status: "published" as const, roomPostUrl: permalink.href };
  const posted = { ...p.posted, postedItemCodes: [...new Set([...p.posted.postedItemCodes, a.itemCode])], uncertainItemCodes: p.posted.uncertainItemCodes ?? [] };
  // Same commit updates the durable history and legacy posted list. Legacy intent
  // is absent from the write set; no partial-success state can clear the slot.
  return plan(snapshot, "finish", published, { version: 1, active: null, records: [...p.state.records, published] }, posted);
}
export function verifyTransactionReadback(rawPlan: unknown, rawSnapshot: unknown, manifest: string): { verified: true; stage: TransactionPlan["operation"]; requestId: string; attemptId?: string; browserActionPermitted: false } {
  const p = object(rawPlan) as TransactionPlan, s = parseConnectorSnapshot(rawSnapshot), bundle = validateBrowserPostBundle(manifest);
  if (p.version !== 1 || !["reserve", "begin", "finish"].includes(p.operation) || p.repository !== s.repository || p.branch !== "main" || p.manifestHash !== bundle.manifestHash || !sha(p.expectedHead) ||
      s.head === p.expectedHead || s.parents.length !== 1 || s.parents[0] !== p.expectedHead || !Array.isArray(p.treeElements) || p.treeElements.length !== (p.operation === "finish" ? 2 : 1)) throw new Error("TRANSACTION_READBACK_COMMIT_MISMATCH");
  if (s.files[STATE_PATHS[0]].sha !== p.legacySha || (p.operation !== "finish" && s.files[STATE_PATHS[1]].sha !== p.postedBeforeSha)) throw new Error("TRANSACTION_LEGACY_CHANGED");
  const expectedPaths = p.operation === "finish" ? [STATE_PATHS[2], STATE_PATHS[1]] : [STATE_PATHS[2]];
  for (const [i, entry] of p.treeElements.entries()) {
    if (entry.path !== expectedPaths[i] || entry.mode !== "100644" || entry.type !== "blob" || s.files[entry.path as typeof STATE_PATHS[number]].content !== entry.content) throw new Error("TRANSACTION_READBACK_CONTENT_MISMATCH");
  }
  const state = parts(s).state;
  if (p.operation === "finish") {
    const record = state.records.find(r => r.requestId === p.requestId);
    if (state.active || !record || record.status !== "published" || record.manifestHash !== bundle.manifestHash || !parts(s).posted.postedItemCodes.includes(bundle.item.itemCode)) throw new Error("TRANSACTION_FINAL_READBACK_INVALID");
  } else {
    const a = bind(state.active, bundle, p.requestId);
    if (a.status !== (p.operation === "begin" ? "unknown" : "reserved") || a.attemptId !== p.attemptId || parts(s).excluded.includes(bundle.item.itemCode)) throw new Error("TRANSACTION_BEGIN_READBACK_INVALID");
  }
  // The worker must also retain continuity and have no previous attempted upload
  // or submit. JSON verification cannot authorize or prove tool execution itself.
  return { verified: true, stage: p.operation, requestId: p.requestId, ...(p.attemptId ? { attemptId: p.attemptId } : {}), browserActionPermitted: false };
}
