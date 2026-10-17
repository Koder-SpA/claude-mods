#!/usr/bin/env node
// Prints the routing table for the detected plan at session start.
// Fails open: on any error it prints the plan-agnostic policy and exits 0.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const HOME = os.homedir();
const CLAUDE_DIR = process.env.CLAUDE_CONFIG_DIR || path.join(HOME, ".claude");
const CONFIG_FILE = path.join(CLAUDE_DIR, "task-router.json");

// `~/.claude.json` sits next to the config dir, not inside it.
const ACCOUNT_FILES = [
  path.join(CLAUDE_DIR, ".claude.json"),
  path.join(HOME, ".claude.json"),
];

const PRESETS = {
  max: {
    label: "Max",
    rows: [
      ["scout", "sonnet", "low", "locate, grep, map structure, find usages"],
      ["extractor", "sonnet", "medium", "extract, classify, summarise one source"],
      ["mechanic", "sonnet", "high", "mechanical edits from a complete spec"],
      ["builder", "opus", "high", "implement one scoped task from a plan"],
    ],
    note: "You pay a subscription, not per token, so the knob that matters is effort, not a cheaper model. Spend against your 5h and weekly limits deliberately.",
  },
  pro: {
    label: "Pro",
    rows: [
      ["scout", "haiku", "low", "locate, grep, map structure, find usages"],
      ["extractor", "haiku", "medium", "extract, classify, summarise one source"],
      ["mechanic", "sonnet", "high", "mechanical edits from a complete spec"],
      ["builder", "sonnet", "high", "implement one scoped task from a plan"],
    ],
    note: "Limits are tighter here. Keep Opus for work the main loop judges genuinely hard, and say so explicitly when you reach for it.",
  },
  api: {
    label: "API / pay-as-you-go",
    rows: [
      ["scout", "haiku", "low", "locate, grep, map structure, find usages"],
      ["extractor", "haiku", "medium", "extract, classify, summarise one source"],
      ["mechanic", "sonnet", "medium", "mechanical edits from a complete spec"],
      ["builder", "sonnet", "high", "implement one scoped task from a plan"],
    ],
    note: "Every token is a literal invoice line. Start at the cheapest tier that can succeed and escalate only on observable failure.",
  },
};

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function detectPlan() {
  const override = readJson(CONFIG_FILE);
  if (override && PRESETS[override.plan]) {
    return { plan: override.plan, source: "config" };
  }
  for (const file of ACCOUNT_FILES) {
    const account = readJson(file);
    const tier =
      account?.oauthAccount?.organizationRateLimitTier ||
      account?.oauthAccount?.userRateLimitTier ||
      "";
    if (!tier) continue;
    const t = String(tier).toLowerCase();
    if (t.includes("max")) return { plan: "max", source: tier };
    if (t.includes("team") || t.includes("enterprise")) return { plan: "max", source: tier };
    if (t.includes("pro")) return { plan: "pro", source: tier };
    return { plan: "api", source: tier };
  }
  return { plan: null, source: null };
}

function render({ plan, source }) {
  const preset = PRESETS[plan] || PRESETS.max;
  const lines = [];

  lines.push("TASK ROUTER ACTIVE - delegation policy for this session.");
  lines.push("");
  if (plan) {
    const how = source === "config" ? "set in task-router.json" : `detected from ${source}`;
    lines.push(`Plan: ${preset.label} (${how}).`);
  } else {
    lines.push(
      "Plan: not detected, assuming Max. Run /task-router:router-setup to pin it."
    );
  }
  lines.push("");

  lines.push("## The test, before every delegation");
  lines.push("");
  lines.push(
    "Ask: will I need this tool output again, or only the conclusion? Only the"
  );
  lines.push(
    "conclusion means delegate. The worker reads in its own context window and"
  );
  lines.push(
    "hands back a short report, so the bytes it read never enter this conversation."
  );
  lines.push(
    "That saving compounds: every later turn re-sends this whole conversation."
  );
  lines.push("");
  lines.push("Delegate when the work is bulk reading, searching or summarising.");
  lines.push("Keep inline: edits to files already in context, and judgement calls.");
  lines.push("");

  lines.push("## Routing table");
  lines.push("");
  for (const [agent, model, effort, use] of preset.rows) {
    lines.push(`- ${agent} (${model}, effort ${effort}): ${use}`);
  }
  lines.push("- main loop: design, debugging, ambiguity, risk, final judgement");
  lines.push("");
  lines.push(
    "Pass `model` and `effort` on the Agent call to match the row; they override"
  );
  lines.push("the agent's own defaults.");
  lines.push("");
  lines.push(`Note: ${preset.note}`);
  lines.push("");

  lines.push("## Rules");
  lines.push("");
  lines.push(
    "1. Tool first. If one deterministic command answers it (grep, jq, git, a test"
  );
  lines.push("   runner), run it. No model call at all.");
  lines.push(
    "2. Never prefetch for a worker that gathers its own context, and never feed it"
  );
  lines.push(
    "   material you already read. Independent perspectives must stay independent."
  );
  lines.push(
    "3. Escalate only on observable failure: a failed check, a wrong result. A"
  );
  lines.push(
    "   worker saying it is unsure is input, never the trigger on its own."
  );
  lines.push("4. Escalate by re-running the same agent one step up, once.");
  lines.push("5. This is a policy, not a gate. Nothing here blocks a tool call.");

  return lines.join("\n");
}

try {
  process.stdout.write(render(detectPlan()));
} catch {
  process.stdout.write(
    "TASK ROUTER ACTIVE - delegate bulk reading and searching to workers; keep edits and judgement inline."
  );
}
