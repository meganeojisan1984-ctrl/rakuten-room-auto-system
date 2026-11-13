import { test } from "node:test";
import assert from "node:assert/strict";
import { createGithubBrowserStateStore, legacyExcludedItemCodes, parseBrowserPostState } from "../src/browser-post-state";
test("legacy uncertain codes are preserved as exclusions without clearing the legacy intent", () => {
  assert.deepEqual(legacyExcludedItemCodes({ version: 1, requestId: "old", createdAt: "", items: [{ itemCode: "old:uncertain" }] }, { postedItemCodes: ["posted:item"], uncertainItemCodes: ["other:uncertain"] }), ["old:uncertain", "posted:item", "other:uncertain"]);
  assert.throws(() => legacyExcludedItemCodes({ version: 1, items: [] }, { postedItemCodes: [] }));
  assert.throws(() => parseBrowserPostState({ version: 1, records: [] }));
});
test("GitHub state uses main CAS/readback, never writes legacy intent, preserves uncertain/history", async () => {
  const old = { version: 1, requestId: "old", createdAt: "", items: [{ itemCode: "old:item" }] };
  const files: Record<string, any> = { "room_post_intent.json": old, "posted_items.json": { postedItemCodes: ["posted:item"], uncertainItemCodes: ["old:item"], postTypeIndex: 2 } };
  const writes: string[] = [], urls: string[] = [];
  const fakeFetch = async (input: any, init: any = {}) => {
    const url = new URL(String(input)), name = url.pathname.split("/").pop()!; urls.push(url.href);
    if (init.method === "PUT") {
      const body = JSON.parse(init.body); assert.equal(body.branch, "main");
      if (files[name]) assert.equal(body.sha, "sha-" + name);
      writes.push(name); files[name] = JSON.parse(Buffer.from(body.content, "base64").toString("utf8"));
      return new Response("{}", { status: 200 });
    }
    if (!files[name]) return new Response("", { status: 404 });
    return new Response(JSON.stringify({ sha: "sha-" + name, content: Buffer.from(JSON.stringify(files[name])).toString("base64") }));
  };
  const store = createGithubBrowserStateStore({ token: "test", repository: "owner/repo", fetch: fakeFetch as any });
  const first = await store.read(); assert.deepEqual(first.excludedItemCodes, ["old:item", "posted:item"]);
  await store.save(first.state, first.revision);
  await store.persistPosted("new:item");
  assert.deepEqual(writes, ["browser_room_post_state.json", "posted_items.json"]);
  assert.deepEqual(files["room_post_intent.json"], old);
  assert.deepEqual(files["posted_items.json"], { postedItemCodes: ["posted:item", "new:item"], uncertainItemCodes: ["old:item"], postTypeIndex: 2 });
  assert.ok(urls.filter(url => url.includes("?")).every(url => url.endsWith("?ref=main")));
});
test("missing authoritative posted state and write conflicts are fatal", async () => {
  assert.throws(() => createGithubBrowserStateStore({ token: "", repository: "owner/repo" }));
  const unavailable = createGithubBrowserStateStore({ token: "x", repository: "owner/repo", fetch: (async () => new Response("", { status: 404 })) as any });
  await assert.rejects(unavailable.read(), /READ_FAILED_404/);
  const conflict = createGithubBrowserStateStore({ token: "x", repository: "owner/repo", fetch: (async () => new Response("", { status: 409 })) as any });
  await assert.rejects(conflict.save({ version: 1, active: null, records: [] }), /WRITE_FAILED_409/);
});
