import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { runInNewContext } from "node:vm";
import { validateBrowserPostBundle } from "../src/browser-post-bundle";
import { attachRoomImage, ROOM_IMAGE_UI, readyRoomButton, confirmBrowserRoomPost, assertRoomAccount, assertBrowserPostForm } from "../src/browser-room-upload";
import { exactReviewedRoomCaption } from "../src/poster";
import { browserBundleFixture } from "./helpers/browser-bundle-fixture";
function fake(failure = "") {
  const events: string[] = [], uploads: any[] = [];
  const source = "https://room.r10s.jp/d/confirmed.jpg";
  const page = {
    locator: (selector: string) => ({
      count: async () => failure === "duplicate:" + selector ? 2 : 1,
      isEnabled: async () => failure !== "disabled:" + selector,
      getAttribute: async (attr: string) => attr === "class" && failure === "css:" + selector ? "disabled" : null,
      waitFor: async () => undefined,
      click: async () => { events.push("click:" + selector); if (failure === "click:" + selector) throw new Error("uncertain"); },
      setInputFiles: async (payload: any) => { events.push("upload"); uploads.push(payload); if (failure === "upload") throw new Error("upload unknown"); },
      evaluateAll: async () => ["old-image"],
    }),
    waitForFunction: async (_fn: any, args: any) => {
      events.push("preview:" + args.selector);
      if (failure === "preview:" + args.selector) throw new Error("not confirmed");
      return { jsonValue: async () => args.kind === "crop" ? "data:image/png;base64,preview" : source, dispose: async () => undefined };
    },
  };
  return { page, events, uploads, source };
}
test("image adapter uploads verified bytes and never publishes", async t => {
  const f = browserBundleFixture(t), bundle = validateBrowserPostBundle(f.manifestPath), mock = fake();
  fs.writeFileSync(bundle.image.path, "changed after validation");
  assert.equal(await attachRoomImage(mock.page as any, bundle.image, bundle.item.itemCode), mock.source);
  assert.deepEqual(mock.uploads[0].buffer, f.png);
  assert.equal(mock.uploads[0].mimeType, "image/png");
  assert.ok(!mock.events.some(event => event.includes("collect()")));
  assert.deepEqual(mock.events.filter(event => event.startsWith("click:")), [ROOM_IMAGE_UI.edit, ROOM_IMAGE_UI.add, ROOM_IMAGE_UI.cropSave, ROOM_IMAGE_UI.apply].map(selector => "click:" + selector + ":visible"));
});
for (const failure of ["upload", "preview:" + ROOM_IMAGE_UI.cropPreview, "preview:" + ROOM_IMAGE_UI.managementPreview, "preview:" + ROOM_IMAGE_UI.mainPreview, "css:" + ROOM_IMAGE_UI.cropSave + ":visible", "disabled:" + ROOM_IMAGE_UI.apply + ":visible", "click:" + ROOM_IMAGE_UI.cropSave + ":visible"]) test("adapter stops after uncertainty: " + failure, async t => {
  const f = browserBundleFixture(t), bundle = validateBrowserPostBundle(f.manifestPath), mock = fake(failure);
  await assert.rejects(attachRoomImage(mock.page as any, bundle.image, bundle.item.itemCode));
  for (const event of mock.events.filter(event => event.startsWith("click:") || event === "upload")) assert.equal(mock.events.filter(x => x === event).length, 1);
});
test("publish control must be unique and enabled", async () => {
  await assert.rejects(readyRoomButton(fake("duplicate:" + ROOM_IMAGE_UI.publish + ":visible").page as any, ROOM_IMAGE_UI.publish));
  await assert.rejects(readyRoomButton(fake("css:" + ROOM_IMAGE_UI.publish + ":visible").page as any, ROOM_IMAGE_UI.publish));
});
test("detail confirmation binds the visible post product and its active photo", async () => {
  const image = "https://room.r10s.jp/d/confirmed.jpg", product = "https://item.rakuten.co.jp/shop/test/", profile = "https://room.rakuten.co.jp/room_test";
  for (const change of ["none", "wrong-profile", "wrong-product", "wrong-image", "hidden-image", "profile-index", "missing-post"]) {
    const location = { href: change === "wrong-profile" ? "https://room.rakuten.co.jp/room_other/1700000001" : change === "profile-index" ? profile + "/items" : profile + "/1700000001" };
    class MockImage { complete = true; naturalWidth = 1000; src = change === "wrong-image" ? "https://room.r10s.jp/d/other.jpg" : image + "?resize=600:*"; getBoundingClientRect() { return { width: change === "hidden-image" ? 0 : 100, height: 100 }; } }
    const post = { querySelectorAll: () => [new MockImage()] };
    const link = { href: "https://hb.afl.rakuten.co.jp/hgc/test/?pc=" + encodeURIComponent(change === "wrong-product" ? "https://item.rakuten.co.jp/shop/other/" : product + "?scid=room"), getBoundingClientRect: () => ({ width: 20, height: 20 }), querySelector: () => ({}), closest: () => change === "missing-post" ? null : post };
    const document = { querySelectorAll: () => [link] };
    const page = { waitForFunction: async (fn: any, args: any) => {
      const result = runInNewContext("(" + fn.toString() + ")(args)", { location, document, URL, args, HTMLImageElement: MockImage, getComputedStyle: () => ({ display: "block", visibility: "visible" }) });
      if (!result) throw new Error("not confirmed");
      return { jsonValue: async () => result, dispose: async () => undefined };
    } };
    if (change === "none") assert.equal(await confirmBrowserRoomPost(page as any, product, image, profile), location.href);
    else await assert.rejects(confirmBrowserRoomPost(page as any, product, image, profile));
  }
});
test("logged-in my ROOM link, not /my public profile, verifies the account", async () => {
  for (const href of ["/room_test/items", "/room_other/items", ""]) {
    let closed = false;
    const context = { newPage: async () => ({ goto: async (url: string) => { assert.equal(url, "https://room.rakuten.co.jp/room_test/items"); }, getByRole: (role: string, options: any) => { assert.equal(role, "link"); assert.equal(options.name.test("my ROOM"), true); assert.equal(options.name.test("other my ROOM"), false); return { waitFor: async () => undefined, count: async () => 1, isVisible: async () => true, textContent: async () => "my ROOM", getAttribute: async () => href }; }, url: () => "https://room.rakuten.co.jp/room_test/items", close: async () => { closed = true; } }) };
    if (href.includes("room_test")) await assertRoomAccount(context as any, "https://room.rakuten.co.jp/room_test");
    else await assert.rejects(assertRoomAccount(context as any, "https://room.rakuten.co.jp/room_test"), /NOT_VERIFIED/);
    assert.equal(closed, true);
  }
});
test("image verification and exact account/publish checks precede the only submit", () => {
  const source = fs.readFileSync("src/poster.ts", "utf8");
  assert.ok(source.indexOf("await assertRoomAccount(context") < source.indexOf("await attachRoomImage(postPage"));
  assert.ok(source.indexOf("await assertRoomImageAttached(postPage") < source.indexOf("submitAttempted = true"));
  assert.equal(source.split("await postBtnLocator.click(").length - 1, 1);
});
test("reviewed caption preserves a terminal newline and spaces", () => {
  assert.equal(exactReviewedRoomCaption(" 商品紹介\n"), " 商品紹介\n");
  assert.throws(() => exactReviewedRoomCaption("x".repeat(501)));
});
test("collect form checks exact caption and bound numeric destination before actions", async () => {
  const expected = "https://room.rakuten.co.jp/mix/collect?itemcode=12345";
  for (const changed of ["none", "caption", "item", "wrong-host", "duplicate"]) {
    const page = { url: () => changed === "item" ? expected.replace("12345", "67890") : changed === "wrong-host" ? expected.replace("room.rakuten.co.jp", "evil.test") : expected + "&scid=tracking",
      locator: () => ({ count: async () => changed === "duplicate" ? 2 : 1, inputValue: async () => changed === "caption" ? "changed" : "caption\n" }) };
    if (changed === "none") await assertBrowserPostForm(page as any, "caption\n", expected);
    else await assert.rejects(assertBrowserPostForm(page as any, "caption\n", expected));
  }
});
