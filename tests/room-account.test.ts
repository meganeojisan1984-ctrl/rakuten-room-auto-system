import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { assertRoomAccount, canonicalRoomProfileUrl, configuredRoomProfileUrl, roomAccountFailureCode, ROOM_MY_LINK_NAME } from "../src/room-account";
import { validateSession } from "../src/core/browser";

const expected = "https://room.rakuten.co.jp/room_test/items";
function fixture(options: { href?: string; url?: string; label?: string | null; accessibleName?: string; count?: number; visible?: boolean; status?: number; missing?: boolean; navigationError?: boolean; readError?: boolean } = {}) {
  let closed = false, visited = "";
  const context = { newPage: async () => ({
    goto: async (url: string) => { visited = url; if (options.navigationError) throw new Error("network"); return { ok: () => (options.status ?? 200) < 400 }; },
    url: () => options.url ?? expected,
    getByRole: (role: string, config: {name: RegExp}) => {
      assert.deepEqual([role, config], ["link", { name: ROOM_MY_LINK_NAME }]);
      return {
        waitFor: async () => { if (options.missing || !config.name.test(options.accessibleName ?? "my ROOM")) throw new Error("timeout"); },
        count: async () => options.count ?? 1,
        isVisible: async () => options.visible ?? true,
        textContent: async () => options.label === undefined ? "my ROOM" : options.label,
        getAttribute: async (name: string) => { assert.equal(name, "href"); if (options.readError) throw new Error("detached"); return options.href ?? "/room_test/items"; },
      };
    },
    close: async () => { closed = true; },
  }) } as unknown as Parameters<typeof assertRoomAccount>[0];
  return { context, closed: () => closed, visited: () => visited };
}

test("profile identity accepts only the exact ROOM origin and profile path", () => {
  for (const value of ["https://room.rakuten.co.jp/room_test", expected, expected + "/"]) assert.equal(canonicalRoomProfileUrl(value), expected);
  for (const value of ["https://room.rakuten.co.jp/my", "https://room.rakuten.co.jp/room_test/items/items", expected + "?x=1", expected + "#x", "http://room.rakuten.co.jp/room_test", "https://room.rakuten.co.jp.evil.test/room_test", "https://u:p@room.rakuten.co.jp/room_test", "https://room.rakuten.co.jp/room_test/170123", "not-url"]) assert.throws(() => canonicalRoomProfileUrl(value));
});

test("configured expected account preserves explicit profile and refuses malformed configuration", () => {
  assert.equal(configuredRoomProfileUrl({ ROOM_PROFILE_URL: expected }), expected);
  assert.equal(configuredRoomProfileUrl({ OWN_ROOM_ID: "room_test" }), expected);
  assert.equal(configuredRoomProfileUrl({}), "https://room.rakuten.co.jp/room_sho_qoltime/items");
  assert.throws(() => configuredRoomProfileUrl({ ROOM_PROFILE_URL: "https://room.rakuten.co.jp/my" }));
  assert.throws(() => configuredRoomProfileUrl({ OWN_ROOM_ID: "../my" }));
});

test("a unique visible my ROOM identifies the exact signed-in account", async () => {
  for (const href of ["/room_test/items", expected, "/room_test"]) {
    const f = fixture({ href });
    await assertRoomAccount(f.context, expected);
    assert.equal(f.visited(), expected);
    assert.equal(f.closed(), true);
  }
});

test("live ROOM header CSS icon is accepted without relaxing the visible label or account", async () => {
  for (const accessibleName of ["my ROOM", "\uE96A my ROOM"]) {
    await assertRoomAccount(fixture({ accessibleName }).context, expected);
  }
  for (const accessibleName of ["not my ROOM", "my ROOM login", "\uE96B my ROOM", "my ROOM\nother"]) {
    await assert.rejects(assertRoomAccount(fixture({ accessibleName }).context, expected), /account_header_visibility$/);
  }
  for (const label of [null, "", "not my ROOM", "my ROOM login"]) {
    await assert.rejects(assertRoomAccount(fixture({ label }).context, expected), /account_header_label$/);
  }
  await assert.rejects(assertRoomAccount(fixture({ accessibleName: "\uE96A my ROOM", href: "/room_other/items" }).context, expected), /account_header_identity$/);
});

for (const [name, options] of Object.entries({
  "public profile without authenticated header": { missing: true },
  "public /my page": { url: "https://room.rakuten.co.jp/my" },
  "login redirect": { url: "https://grp01.id.rakuten.co.jp/login" },
  "another signed-in account": { href: "/room_other/items" },
  "external link": { href: "https://evil.test/room_test/items" },
  "empty link": { href: "" },
  "hidden account link": { visible: false },
  "ambiguous account links": { count: 2 },
  "missing account link": { count: 0 },
  "failed page response": { status: 500 },
  "navigation failure": { navigationError: true },
  "detached account link": { readError: true },
})) test("identity guard fails closed: " + name, async () => {
  const f = fixture(options);
  await assert.rejects(assertRoomAccount(f.context, expected), /ROOM_ACCOUNT_NOT_VERIFIED/);
  assert.equal(f.closed(), true);
});

test("engagement session validation uses the exact account guard", async () => {
  const previous = process.env.ROOM_PROFILE_URL;
  process.env.ROOM_PROFILE_URL = expected;
  try {
    assert.equal(await validateSession(fixture().context as any), true);
    assert.equal(await validateSession(fixture({ missing: true }).context as any), false);
    assert.equal(await validateSession(fixture({ href: "/room_other/items" }).context as any), false);
  } finally {
    if (previous === undefined) delete process.env.ROOM_PROFILE_URL;
    else process.env.ROOM_PROFILE_URL = previous;
  }
});

test("both session entrypoints share positive identity checks and never visit /my", () => {
  for (const file of ["src/core/browser.ts", "src/session.ts"]) {
    const code = fs.readFileSync(file, "utf8");
    assert.match(code, /await assertRoomAccount\(context, configuredRoomProfileUrl\(\)\)/);
    assert.doesNotMatch(code, /goto\([^\n]*\/my/);
  }
});

test("diagnostic codes distinguish safe stages without exposing page errors", async () => {
  await assert.rejects(assertRoomAccount(fixture({ navigationError: true }).context, expected), /ROOM_ACCOUNT_NOT_VERIFIED:profile_navigation$/);
  await assert.rejects(assertRoomAccount(fixture({ missing: true }).context, expected), /ROOM_ACCOUNT_NOT_VERIFIED:account_header_visibility$/);
  await assert.rejects(assertRoomAccount(fixture({ href: "/room_other/items" }).context, expected), /ROOM_ACCOUNT_NOT_VERIFIED:account_header_identity$/);
  assert.equal(roomAccountFailureCode(new Error("ROOM_ACCOUNT_NOT_VERIFIED:profile_location")), "ROOM_ACCOUNT_NOT_VERIFIED:profile_location");
  for (const value of [new Error("secret page content"), new Error("ROOM_ACCOUNT_NOT_VERIFIED:https://secret.test"), null]) {
    assert.equal(roomAccountFailureCode(value), "ROOM_ACCOUNT_NOT_VERIFIED:configuration_or_context");
  }
});
