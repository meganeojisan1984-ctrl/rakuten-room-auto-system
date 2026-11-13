import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";

test("legacy follow records survive but require live re-verification", async () => {
  const previousCwd = process.cwd();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "room-follow-db-"));
  fs.mkdirSync(path.join(dir, "data"));
  const legacy = new Database(path.join(dir, "data", "database.sqlite"));
  legacy.exec("CREATE TABLE followed_users (user_id TEXT PRIMARY KEY, followed_at INTEGER NOT NULL)");
  legacy.prepare("INSERT INTO followed_users VALUES (?, ?)").run("/room_legacy", 123);
  legacy.close();
  process.chdir(dir);
  let db: Database.Database | undefined;
  try {
    const store = await import("../src/api/server");
    db = store.initDatabase();
    assert.equal(store.isFollowedUser("/room_legacy"), false);
    assert.equal(store.getFollowedCount(), 0);
    assert.deepEqual(db.prepare("SELECT * FROM followed_users").get(), {
      user_id: "/room_legacy", followed_at: 123, verified: 0,
    });
    store.recordFollowedUser("/room_legacy");
    store.recordFollowedUser("/room_new");
    store.recordFollowedUser("/room_new");
    assert.equal(store.isFollowedUser("/room_legacy"), true);
    assert.equal(store.getFollowedCount(), 2);
    assert.equal((db.prepare("SELECT followed_at FROM followed_users WHERE user_id = ?").get("/room_legacy") as { followed_at: number }).followed_at, 123);
    db.close();
    db = store.initDatabase();
    assert.equal(store.getFollowedCount(), 2);
  } finally {
    db?.close();
    process.chdir(previousCwd);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
