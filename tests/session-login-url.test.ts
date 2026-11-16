import { test } from "node:test";
import assert from "node:assert/strict";
import { isRakutenLoginUrl } from "../src/session";

test("楽天会員ログイン画面のURLを検知する", () => {
  assert.equal(isRakutenLoginUrl("https://login.account.rakuten.com/sso/authorize?client_id=room"), true);
  assert.equal(isRakutenLoginUrl("https://grp01.id.rakuten.co.jp/rms/nid/login"), true);
  assert.equal(isRakutenLoginUrl("https://room.rakuten.co.jp/mix/collect?itemcode=123"), false);
  assert.equal(isRakutenLoginUrl("https://room.rakuten.co.jp/room_sho_qoltime/items"), false);
});
