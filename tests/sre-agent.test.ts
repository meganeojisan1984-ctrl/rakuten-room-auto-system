import { test } from "node:test";
import assert from "node:assert/strict";
import { planSreRepairs, summarizeSreRepair } from "../src/agents/sre-agent";

test("planSreRepairs reruns failed auto-post workflow first", () => {
  const plan = planSreRepairs({
    workflows: [
      { name: "楽天ROOM 自動投稿", conclusion: "failure", updatedAt: "2026-08-01T00:00:00Z" },
      { name: "楽天ROOM 自動いいね", conclusion: "success", updatedAt: "2026-08-01T00:00:00Z" },
    ],
    health: [],
  });

  assert.equal(plan.actions[0].type, "run-workflow");
  assert.equal(plan.actions[0].workflowKey, "post");
  assert.equal(plan.actions[0].priority, 1);
});

test("planSreRepairs asks for cookie update instead of unsafe self-fix", () => {
  const plan = planSreRepairs({
    workflows: [],
    health: [
      {
        agent: "poster",
        runs: 3,
        failures: 3,
        failStreak: 3,
        lastOk: false,
        lastError: "Cookie expired",
        lastTs: "2026-08-01T00:00:00Z",
      },
    ],
  });

  assert.equal(plan.actions[0].type, "request-owner");
  assert.match(plan.actions[0].reason, /Cookie/);
});

test("planSreRepairs triggers sales scrape for failed sales workflow", () => {
  const plan = planSreRepairs({
    workflows: [
      { name: "楽天アフィリエイト 売上取り込み", conclusion: "failure", updatedAt: "2026-08-01T00:00:00Z" },
    ],
    health: [],
  });

  assert.equal(plan.actions[0].type, "scrape-sales");
});

test("planSreRepairs reruns failed auto-like workflow", () => {
  const plan = planSreRepairs({
    workflows: [
      { name: "楽天ROOM 自動いいね", conclusion: "failure", updatedAt: "2026-08-01T00:00:00Z" },
    ],
    health: [],
  });

  assert.equal(plan.actions[0].type, "run-workflow");
  assert.equal(plan.actions[0].workflowKey, "like");
});

test("planSreRepairs reruns failed auto-follow workflow", () => {
  const plan = planSreRepairs({
    workflows: [
      { name: "楽天ROOM 自動フォロー", conclusion: "failure", updatedAt: "2026-08-01T00:00:00Z" },
    ],
    health: [],
  });

  assert.equal(plan.actions[0].type, "run-workflow");
  assert.equal(plan.actions[0].workflowKey, "follow");
});

test("summarizeSreRepair includes executed and skipped actions", () => {
  const summary = summarizeSreRepair([
    { action: "auto-post.yml を再実行", ok: true },
    { action: "Cookie 更新依頼", ok: false, error: "owner action required" },
  ]);

  assert.match(summary, /auto-post/);
  assert.match(summary, /Cookie/);
});
