import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { browserBundleFixture } from "./helpers/browser-bundle-fixture";
import { reserveTransaction, beginTransaction, finishTransaction, parseConnectorSnapshot, verifyTransactionReadback, gitBlobSha, ROOM_REPOSITORY, type ConnectorSnapshot, type TransactionPlan } from "../src/browser-post-transaction";
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const profile = "https://room.rakuten.co.jp/room_test/items";
function snapshot(): ConnectorSnapshot {
  const raw = {
    "room_post_intent.json": { version: 1, requestId: "old-intent", createdAt: "2026-11-01T00:00:00Z", items: [{ itemCode: "old:unknown" }] },
    "posted_items.json": { postedItemCodes: ["old:posted"], uncertainItemCodes: ["old:uncertain"], postTypeIndex: 2 },
    "browser_room_post_state.json": { version: 1, active: null, records: [] },
  };
  return { version: 1, source: "GitHub connector", repository: ROOM_REPOSITORY, branch: "main", head: "a".repeat(40), tree: "b".repeat(40), sourceRef: "a".repeat(40), parents: ["9".repeat(40)], fetchedAt: new Date().toISOString(),
    files: Object.fromEntries(Object.entries(raw).map(([p,v]) => { const content=JSON.stringify(v); return [p,{content,sha:gitBlobSha(content)}]; })) as ConnectorSnapshot["files"] };
}
function apply(s: ConnectorSnapshot, p: TransactionPlan): ConnectorSnapshot {
  const next = structuredClone(s); next.parents = [p.expectedHead]; next.head = sha(p.expectedHead + p.operation).slice(0,40); next.sourceRef = next.head; next.tree = sha(next.head).slice(0,40); next.fetchedAt = new Date().toISOString();
  for (const entry of p.treeElements) next.files[entry.path as keyof ConnectorSnapshot["files"]] = {content:entry.content, sha:gitBlobSha(entry.content)};
  return next;
}
function modify(s: ConnectorSnapshot, p: keyof ConnectorSnapshot["files"], edit: (v:any)=>void) {
  const data = JSON.parse(s.files[p].content); edit(data); const content = JSON.stringify(data); s.files[p]={content,sha:gitBlobSha(content)};
}
function evidence(a:any) {
  return { source: "Mac CUA observed", observedAt:new Date().toISOString(), requestId:a.requestId,attemptId:a.attemptId,manifestHash:a.manifestHash,
    ownProfileUrl:profile,roomPostUrl:"https://room.rakuten.co.jp/room_test/17000000000001",productUrl:a.itemUrl,collectUrl:a.collectUrl,captionSha256:a.captionSha256,
    uploadedImageUrl:"https://room.r10s.jp/d/test.jpg",publishedImageUrl:"https://room.r10s.jp/d/test.jpg?resize=600",imageDecoded:true,visualProductMatch:true,captionVerified:true,samePostScopeVerified:true,uploadMappingVerified:true };
}
test("CAS protocol preserves legacy uncertainty and atomically records completion", t => {
  const f=browserBundleFixture(t), original=snapshot(), reserve=reserveTransaction(f.manifestPath,original,profile), reserved=apply(original,reserve);
  assert.equal(reserve.browserActionPermitted,false); assert.equal(reserve.treeElements.length,1);
  assert.equal(verifyTransactionReadback(reserve,reserved,f.manifestPath).browserActionPermitted,false);
  const begin=beginTransaction(f.manifestPath,reserved,reserve.requestId), begun=apply(reserved,begin);
  assert.equal(verifyTransactionReadback(begin,begun,f.manifestPath).browserActionPermitted,false);
  const active=JSON.parse(begun.files["browser_room_post_state.json"].content).active;
  assert.equal(active.status,"unknown");
  const finish=finishTransaction(f.manifestPath,begun,evidence(active)), finished=apply(begun,finish);
  assert.equal(finish.treeElements.length,2); assert.equal(finished.files["room_post_intent.json"].content,original.files["room_post_intent.json"].content);
  assert.equal(verifyTransactionReadback(finish,finished,f.manifestPath).stage,"finish");
  const posted=JSON.parse(finished.files["posted_items.json"].content); assert.deepEqual(posted.uncertainItemCodes,["old:uncertain"]); assert.equal(posted.postTypeIndex,2); assert.ok(posted.postedItemCodes.includes(f.item.itemCode));
  assert.throws(()=>reserveTransaction(f.manifestPath,finished,profile),/ALREADY_POSTED/);
});
for(const mode of ["stale","future","branch","ref","sha","missing","malformed-intent"]){test("reject remote snapshot: "+mode,()=>{
  const s:any=snapshot(); if(mode==="stale")s.fetchedAt=new Date(Date.now()-121000).toISOString(); if(mode==="future")s.fetchedAt=new Date(Date.now()+1000).toISOString(); if(mode==="branch")s.branch="test"; if(mode==="ref")s.sourceRef="main"; if(mode==="sha")s.files["posted_items.json"].sha="0".repeat(40); if(mode==="missing")delete s.files["room_post_intent.json"]; if(mode==="malformed-intent")modify(s,"room_post_intent.json",v=>delete v.items);
  assert.throws(()=>parseConnectorSnapshot(s));
});}
for(const key of ["legacy","posted","uncertain"]){test("exclude product from "+key,t=>{
  const f=browserBundleFixture(t),s=snapshot(); if(key==="legacy")modify(s,"room_post_intent.json",v=>v.items.push({itemCode:f.item.itemCode})); else modify(s,"posted_items.json",v=>v[key==="posted"?"postedItemCodes":"uncertainItemCodes"].push(f.item.itemCode));
  assert.throws(()=>reserveTransaction(f.manifestPath,s,profile),/ALREADY_POSTED_OR_UNCERTAIN/);
});}
test("unknown is never reusable and changed exclusions prevent begin",t=>{
  const f=browserBundleFixture(t),s=snapshot(),r=reserveTransaction(f.manifestPath,s,profile),reserved=apply(s,r);
  assert.throws(()=>reserveTransaction(f.manifestPath,reserved,profile),/ACTIVE_POST/);
  assert.throws(()=>beginTransaction(f.manifestPath,reserved,"other"),/MISMATCH/);
  const begin=beginTransaction(f.manifestPath,reserved,r.requestId),begun=apply(reserved,begin);
  assert.throws(()=>beginTransaction(f.manifestPath,begun,r.requestId),/ALREADY_STARTED/);
  assert.throws(()=>reserveTransaction(f.manifestPath,begun,profile),/ACTIVE_POST/);
  modify(reserved,"posted_items.json",v=>v.uncertainItemCodes.push(f.item.itemCode));
  assert.throws(()=>beginTransaction(f.manifestPath,reserved,r.requestId),/BECAME_EXCLUDED/);
});
for(const mode of ["wrong-parent","wrong-content","legacy-changed","posted-changed"]){test("reject unverified CAS readback: "+mode,t=>{
  const f=browserBundleFixture(t),s=snapshot(),r=reserveTransaction(f.manifestPath,s,profile),next=apply(s,r);
  if(mode==="wrong-parent")next.parents=["f".repeat(40)]; if(mode==="wrong-content")modify(next,"browser_room_post_state.json",v=>v.active.requestId="other"); if(mode==="legacy-changed")modify(next,"room_post_intent.json",v=>v.items=[]); if(mode==="posted-changed")modify(next,"posted_items.json",v=>v.uncertainItemCodes=[]);
  assert.throws(()=>verifyTransactionReadback(r,next,f.manifestPath));
});}
for(const mode of ["profile","product","image","caption","attempt","scope","upload","permalink","stale"]){test("reject unbound finish evidence: "+mode,t=>{
  const f=browserBundleFixture(t),s=snapshot(),r=reserveTransaction(f.manifestPath,s,profile),reserved=apply(s,r),b=beginTransaction(f.manifestPath,reserved,r.requestId),begun=apply(reserved,b),e=evidence(JSON.parse(begun.files["browser_room_post_state.json"].content).active);
  if(mode==="profile")e.ownProfileUrl=profile.replace("room_test","room_other"); if(mode==="product")e.productUrl="https://item.rakuten.co.jp/shop/other/"; if(mode==="image")e.publishedImageUrl="https://room.r10s.jp/other.jpg"; if(mode==="caption")e.captionSha256="f".repeat(64); if(mode==="attempt")e.attemptId="other"; if(mode==="scope")e.samePostScopeVerified=false; if(mode==="upload")e.uploadMappingVerified=false; if(mode==="permalink")e.roomPostUrl=profile; if(mode==="stale")e.observedAt=new Date(Date.now()-121000).toISOString();
  assert.throws(()=>finishTransaction(f.manifestPath,begun,e));
});}
test("duplicate manifest/image blocks even if old product code differs",t=>{
  const f=browserBundleFixture(t),s=snapshot(),r=reserveTransaction(f.manifestPath,s,profile),entry=JSON.parse(r.treeElements[0].content).active;
  modify(s,"browser_room_post_state.json",v=>v.records=[{...entry,status:"published",itemCode:"different:product"}]);
  assert.throws(()=>reserveTransaction(f.manifestPath,s,profile),/BUNDLE_ALREADY_CONSUMED/);
});
