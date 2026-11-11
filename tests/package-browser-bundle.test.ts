import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { browserBundleFixture } from "./helpers/browser-bundle-fixture";
import { validateBrowserPostBundle } from "../src/browser-post-bundle";
for(const mode of ["valid","unreviewed","existing"]){test("package existing artifacts: "+mode,t=>{
  const f=browserBundleFixture(t);const m=JSON.parse(fs.readFileSync(f.manifestPath,"utf8"));
  for(const [from,to] of [["product","product.json"],["prompt","prompt.txt"],["caption","caption.txt"]])fs.copyFileSync(path.join(f.dir,from),path.join(f.dir,to));
  if(mode!=="existing")fs.unlinkSync(f.manifestPath);
  const metadata=path.join(f.dir,"metadata.json");fs.writeFileSync(metadata,JSON.stringify({id:m.id,imageFile:"image",mimeType:"image/png",provenance:m.provenance,review:{...m.review,visualFidelity:mode!=="unreviewed"}}));
  const result=spawnSync(process.execPath,["--import","tsx","tools/package-browser-post-bundle.ts",f.dir,metadata],{encoding:"utf8"});
  if(mode==="valid") {assert.equal(result.status,0,result.stderr);assert.equal(validateBrowserPostBundle(f.manifestPath).item.itemCode,f.item.itemCode);assert.equal(JSON.parse(result.stdout).postingAuthorized,false);}
  else {assert.equal(result.status,1);if(mode==="unreviewed")assert.equal(fs.existsSync(f.manifestPath),false);else assert.deepEqual(JSON.parse(fs.readFileSync(f.manifestPath,"utf8")),m);}
});}
test("production route cannot launch Cookie Playwright even with a valid bundle",t=>{
 const f=browserBundleFixture(t);const r=spawnSync(process.execPath,["--import","tsx","src/main.ts"],{encoding:"utf8",env:{...process.env,ROOM_BROWSER_BUNDLE:f.manifestPath,POST_COUNT:"1",SKIP_ROOM:"0",ROOM_COOKIE:"must-not-read",GITHUB_TOKEN:"must-not-read"}});
 assert.equal(r.status,1);assert.match(r.stderr,/CUA_WORKER_REQUIRED/);assert.doesNotMatch(r.stderr,/browserType|api.github|must-not-read/);
});
