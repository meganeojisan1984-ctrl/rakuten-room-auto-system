export interface WorkflowLike {
  name: string;
  conclusion: string;
  updatedAt: string;
}

export interface HealthLike {
  agent: string;
  runs: number;
  failures: number;
  failStreak: number;
  lastOk: boolean;
  lastError: string;
  lastTs: string;
}

export type SreAction =
  | { type: "run-workflow"; workflowKey: "post" | "learn" | "refresh"; reason: string; priority: number }
  | { type: "scrape-sales"; reason: string; priority: number }
  | { type: "request-owner"; reason: string; priority: number };

export interface SrePlan {
  ok: boolean;
  actions: SreAction[];
  notes: string[];
}

export interface SreExecutionResult {
  action: string;
  ok: boolean;
  error?: string;
}

function isFailure(conclusion: string): boolean {
  return !["success", "in_progress", "queued", "waiting", "skipped"].includes(conclusion);
}

function includesAny(text: string, words: string[]): boolean {
  return words.some((w) => text.includes(w));
}

export function planSreRepairs(input: { workflows: WorkflowLike[]; health: HealthLike[] }): SrePlan {
  const actions: SreAction[] = [];
  const notes: string[] = [];

  for (const workflow of input.workflows) {
    if (!isFailure(workflow.conclusion)) continue;
    const name = workflow.name;
    if (includesAny(name, ["自動投稿", "auto-post", "ROOM"])) {
      actions.push({ type: "run-workflow", workflowKey: "post", reason: `${name} failed`, priority: 1 });
    } else if (includesAny(name, ["売上", "sales", "アフィリエイト"])) {
      actions.push({ type: "scrape-sales", reason: `${name} failed`, priority: 2 });
    } else if (includesAny(name, ["学習", "learn"])) {
      actions.push({ type: "run-workflow", workflowKey: "learn", reason: `${name} failed`, priority: 3 });
    } else if (includesAny(name, ["refresh", "トークン"])) {
      actions.push({ type: "run-workflow", workflowKey: "refresh", reason: `${name} failed`, priority: 4 });
    } else {
      notes.push(`${name}: no automatic repair rule`);
    }
  }

  for (const h of input.health) {
    if (h.failStreak < 2) continue;
    if (includesAny(h.lastError, ["Cookie", "cookie", "401", "403"])) {
      actions.push({ type: "request-owner", reason: `${h.agent}: Cookie update required`, priority: 0 });
    } else if (h.agent === "metrics") {
      actions.push({ type: "run-workflow", workflowKey: "learn", reason: "metrics failed repeatedly", priority: 5 });
    } else if (h.agent === "poster") {
      actions.push({ type: "run-workflow", workflowKey: "post", reason: "poster failed repeatedly", priority: 1 });
    }
  }

  const unique = new Map<string, SreAction>();
  for (const action of actions.sort((a, b) => a.priority - b.priority)) {
    const key = `${action.type}:${"workflowKey" in action ? action.workflowKey : action.reason}`;
    if (!unique.has(key)) unique.set(key, action);
  }

  return { ok: unique.size === 0, actions: [...unique.values()], notes };
}

export function summarizeSreRepair(results: SreExecutionResult[]): string {
  if (results.length === 0) return "No automatic repair was needed.";
  return results
    .map((r) => `${r.ok ? "OK" : "NG"} ${r.action}${r.error ? ` (${r.error})` : ""}`)
    .join(" / ");
}
