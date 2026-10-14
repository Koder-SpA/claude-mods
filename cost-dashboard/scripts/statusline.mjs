#!/usr/bin/env node
// Real-time token/cost dashboard for the Claude Code statusline.
// Reads session JSONL transcripts, aggregates usage per model, prices it.
// Config: ~/.claude/cost-dashboard.json (see README).
import fs from "fs";
import path from "path";
import os from "os";
import { execFileSync } from "child_process";

const HOME = os.homedir();
const CLAUDE_DIR = process.env.CLAUDE_CONFIG_DIR || path.join(HOME, ".claude");
const PROJECTS_DIR = path.join(CLAUDE_DIR, "projects");
const CACHE_FILE = path.join(CLAUDE_DIR, ".cost-dashboard-cache.json");
const CONFIG_FILE = path.join(CLAUDE_DIR, "cost-dashboard.json");

// USD per 1M tokens. Unknown models fall back to `_default`.
// Override or extend via the `pricing` key in the config file.
const DEFAULT_PRICING = {
  "claude-opus-5": { in: 15, out: 75, cw5: 18.75, cw1h: 30, cr: 1.5 },
  "claude-sonnet-5": { in: 3, out: 15, cw5: 3.75, cw1h: 6, cr: 0.3 },
  "claude-haiku-4-5-20251001": { in: 1, out: 5, cw5: 1.25, cw1h: 2, cr: 0.1 },
  "claude-fable-5-1": { in: 3, out: 15, cw5: 3.75, cw1h: 6, cr: 0.3 },
  _default: { in: 3, out: 15, cw5: 3.75, cw1h: 6, cr: 0.3 },
};

const DEFAULT_CONFIG = {
  locale: "en",
  sections: {
    clock: true,
    costs: true,
    context: true,
    limits: true,
    counters: true,
    git: true,
  },
  clock24h: false,
  barWidth: { context: 12, limits: 8 },
};

const LABELS = {
  en: { session: "S", today: "Today", all: "All", ctx: "Ctx", limit5h: "Session", limit7d: "Weekly", left: "left", noRepo: "no repo", skills: "Skills", plugins: "Plugins", days: ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] },
  es: { session: "S", today: "Hoy", all: "Total", ctx: "Ctx", limit5h: "Sesión", limit7d: "Semanal", left: "faltan", noRepo: "sin repo", skills: "Skills", plugins: "Plugins", days: ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"] },
};

function loadConfig() {
  let user = {};
  try {
    user = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8"));
  } catch {
    // no config: defaults
  }
  return {
    ...DEFAULT_CONFIG,
    ...user,
    sections: { ...DEFAULT_CONFIG.sections, ...(user.sections || {}) },
    barWidth: { ...DEFAULT_CONFIG.barWidth, ...(user.barWidth || {}) },
    pricing: { ...DEFAULT_PRICING, ...(user.pricing || {}) },
  };
}

const CONFIG = loadConfig();
const PRICING = CONFIG.pricing;
const T = LABELS[CONFIG.locale] || LABELS.en;

function emptyUsage() {
  return { input: 0, output: 0, cw5: 0, cw1h: 0, cr: 0 };
}

function addUsage(a, b) {
  a.input += b.input;
  a.output += b.output;
  a.cw5 += b.cw5;
  a.cw1h += b.cw1h;
  a.cr += b.cr;
}

function loadCache() {
  try {
    return JSON.parse(fs.readFileSync(CACHE_FILE, "utf8"));
  } catch {
    return { files: {} };
  }
}

function saveCache(cache) {
  try {
    fs.writeFileSync(CACHE_FILE, JSON.stringify(cache));
  } catch {
    // non-fatal
  }
}

function listJsonlFiles(dir) {
  const out = [];
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...listJsonlFiles(full));
    else if (e.isFile() && e.name.endsWith(".jsonl")) out.push(full);
  }
  return out;
}

function parseFile(filePath) {
  // byDay: { "YYYY-MM-DD": { modelId: usage } }
  const byDay = {};
  let raw;
  try {
    raw = fs.readFileSync(filePath, "utf8");
  } catch {
    return byDay;
  }
  const lines = raw.split("\n");
  for (const line of lines) {
    if (!line) continue;
    let rec;
    try {
      rec = JSON.parse(line);
    } catch {
      continue;
    }
    const msg = rec.message;
    if (!msg || msg.role !== "assistant" || !msg.usage) continue;
    const u = msg.usage;
    const day = (rec.timestamp || "").slice(0, 10) || "unknown";
    const model = msg.model || "unknown";
    if (!byDay[day]) byDay[day] = {};
    if (!byDay[day][model]) byDay[day][model] = emptyUsage();
    const slot = byDay[day][model];
    slot.input += u.input_tokens || 0;
    slot.output += u.output_tokens || 0;
    const cc = u.cache_creation || {};
    slot.cw5 += cc.ephemeral_5m_input_tokens || 0;
    slot.cw1h += cc.ephemeral_1h_input_tokens || 0;
    slot.cr += u.cache_read_input_tokens || 0;
  }
  return byDay;
}

function costOf(model, u) {
  const p = PRICING[model] || PRICING._default;
  return (
    (u.input * p.in +
      u.output * p.out +
      u.cw5 * p.cw5 +
      u.cw1h * p.cw1h +
      u.cr * p.cr) /
    1_000_000
  );
}

function totalTokens(u) {
  return u.input + u.output + u.cw5 + u.cw1h + u.cr;
}

function fmtNum(n) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "k";
  return String(Math.round(n));
}

function fmtCost(c) {
  return "$" + c.toFixed(2);
}

const GREEN = "\x1b[32m";
const GRAY = "\x1b[90m";
const RESET = "\x1b[0m";

function pctBar(pct, width) {
  const p = Math.max(0, Math.min(100, pct ?? 0));
  const filled = Math.round((p / 100) * width);
  const empty = width - filled;
  return `${GREEN}${"█".repeat(filled)}${RESET}${GRAY}${"░".repeat(empty)}${RESET}`;
}

function contextBar(ctx) {
  if (!ctx) return "";
  const pct = Math.round(Math.max(0, Math.min(100, ctx.used_percentage ?? 0)));
  const bar = pctBar(pct, CONFIG.barWidth.context);
  const used = fmtNum((ctx.total_input_tokens || 0) + (ctx.total_output_tokens || 0));
  const size = fmtNum(ctx.context_window_size || 0);
  return `${T.ctx} [${bar}] ${pct}% (${used}/${size})`;
}

function fmtDuration(resetsAtSec) {
  if (!resetsAtSec) return "";
  const diffMs = resetsAtSec * 1000 - Date.now();
  if (diffMs <= 0) return "0m";
  const totalMin = Math.round(diffMs / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function fmtWeekday(resetsAtSec) {
  if (!resetsAtSec) return "";
  const d = new Date(resetsAtSec * 1000);
  const days = T.days;
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${days[d.getDay()]} ${hh}:${mm}`;
}

function fmtCountdownDH(resetsAtSec) {
  if (!resetsAtSec) return "";
  const diffMs = resetsAtSec * 1000 - Date.now();
  if (diffMs <= 0) return "00-00";
  const totalHours = Math.floor(diffMs / 3_600_000);
  const d = Math.floor(totalHours / 24);
  const h = totalHours % 24;
  return `${String(d).padStart(2, "0")}-${String(h).padStart(2, "0")}`;
}

function readJsonSafe(p) {
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}

function listSkillMds(dir) {
  let count = 0;
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const e of entries) {
    if (e.isDirectory()) {
      if (fs.existsSync(path.join(dir, e.name, "SKILL.md"))) count++;
      else count += listSkillMds(path.join(dir, e.name));
    }
  }
  return count;
}

function enabledPluginKeys(cwd) {
  const keys = new Set();
  const global = readJsonSafe(path.join(CLAUDE_DIR, "settings.json"));
  if (global && global.enabledPlugins) {
    for (const [k, v] of Object.entries(global.enabledPlugins)) if (v) keys.add(k);
  }
  const projCandidates = [
    path.join(cwd || "", ".claude", "settings.json"),
    path.join(cwd || "", ".claude", "settings.local.json"),
  ];
  for (const p of projCandidates) {
    const proj = readJsonSafe(p);
    if (proj && proj.enabledPlugins) {
      for (const [k, v] of Object.entries(proj.enabledPlugins)) {
        if (v) keys.add(k);
        else keys.delete(k);
      }
    }
  }
  return keys;
}

function countPluginSkills(pluginKeys) {
  const cacheRoot = path.join(CLAUDE_DIR, "plugins", "cache");
  let total = 0;
  for (const key of pluginKeys) {
    const [pluginName, marketplace] = key.split("@");
    if (!marketplace) continue;
    const pluginDir = path.join(cacheRoot, marketplace, pluginName);
    let versions;
    try {
      versions = fs.readdirSync(pluginDir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const v of versions) {
      if (!v.isDirectory()) continue;
      const skillsDir = path.join(pluginDir, v.name, "skills");
      total += listSkillMds(skillsDir);
    }
  }
  return total;
}

function countMcpServers(cwd) {
  const names = new Set();
  const global = readJsonSafe(path.join(CLAUDE_DIR, "settings.json"));
  if (global && global.mcpServers) for (const k of Object.keys(global.mcpServers)) names.add(k);
  const projMcp = readJsonSafe(path.join(cwd || "", ".mcp.json"));
  if (projMcp && projMcp.mcpServers) for (const k of Object.keys(projMcp.mcpServers)) names.add(k);
  const projSettings = readJsonSafe(path.join(cwd || "", ".claude", "settings.json"));
  if (projSettings && projSettings.mcpServers) for (const k of Object.keys(projSettings.mcpServers)) names.add(k);
  return names.size;
}

function gitInfo(cwd) {
  const NO_REPO = ` · ${GRAY}⎇ ${T.noRepo}${RESET}`;
  if (!cwd) return NO_REPO;
  const run = (cmd) => {
    try {
      return execFileSync("git", cmd, {
        cwd,
        encoding: "utf8",
        timeout: 1500,
        stdio: ["ignore", "pipe", "ignore"],
      }).trim();
    } catch {
      return null;
    }
  };
  const branch = run(["branch", "--show-current"]);
  if (!branch) return NO_REPO;
  const dirty = run(["status", "--porcelain"]) ? "*" : "";
  let sync = "";
  const counts = run(["rev-list", "--left-right", "--count", "@{upstream}...HEAD"]);
  if (counts) {
    const [behind, ahead] = counts.split(/\s+/).map(Number);
    if (behind || ahead) sync = ` ${behind}↓${ahead}↑`;
  }
  return ` · ⎇ ${branch}${dirty}${sync}`;
}

function countersLine(hookData) {
  const cwd = hookData.cwd || hookData.workspace?.project_dir;
  const pluginKeys = enabledPluginKeys(cwd);
  const pluginsCount = pluginKeys.size;
  const skillsCount =
    listSkillMds(path.join(CLAUDE_DIR, "skills")) +
    listSkillMds(path.join(cwd || "", ".claude", "skills")) +
    countPluginSkills(pluginKeys);
  const mcpCount = countMcpServers(cwd);
  const cwdDisplay = (cwd || "").replace(HOME, "~");

  const modelPart = hookData.model?.display_name ? ` · 🤖 ${hookData.model.display_name}` : "";
  const effortPart = hookData.effort?.level ? ` · 🎚️ ${hookData.effort.level}` : "";
  const fastPart = hookData.fast_mode ? " · ⚡" : "";
  const thinkPart = hookData.thinking?.enabled ? " · 🧠" : "";
  const ratio = hookData.prompt_cache?.hit_ratio;
  const cachePart = typeof ratio === "number" ? ` · Cache ${Math.round(ratio * 100)}%` : "";

  return (
    `${T.skills} ${skillsCount} · MCP ${mcpCount} · ${T.plugins} ${pluginsCount} · 📁 ${cwdDisplay}` +
    `${modelPart}${effortPart}${fastPart}${thinkPart}${cachePart}${CONFIG.sections.git ? gitInfo(cwd) : ""}`
  );
}

const BOLD = "\x1b[1m";
const BRIGHT = "\x1b[93m";

function fmtClock() {
  const now = new Date();
  const mm = String(now.getMinutes()).padStart(2, "0");
  if (CONFIG.clock24h) {
    const hh = String(now.getHours()).padStart(2, "0");
    return `${BOLD}${BRIGHT}🕐 ${hh}:${mm}${RESET}`;
  }
  let h = now.getHours();
  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12;
  if (h === 0) h = 12;
  return `${BOLD}${BRIGHT}🕐 ${String(h).padStart(2, "0")}:${mm} ${ampm}${RESET}`;
}

function limitsLine(rateLimits) {
  if (!rateLimits) return "";
  const parts = [];
  if (rateLimits.five_hour) {
    const pct = Math.round(rateLimits.five_hour.used_percentage ?? 0);
    parts.push(
      `${T.limit5h} [${pctBar(pct, CONFIG.barWidth.limits)}] ${pct}% (↻${fmtDuration(rateLimits.five_hour.resets_at)})`
    );
  }
  if (rateLimits.seven_day) {
    const pct = Math.round(rateLimits.seven_day.used_percentage ?? 0);
    parts.push(
      `${T.limit7d} [${pctBar(pct, CONFIG.barWidth.limits)}] ${pct}% (↻${fmtWeekday(rateLimits.seven_day.resets_at)} · ${T.left} ${fmtCountdownDH(rateLimits.seven_day.resets_at)})`
    );
  }
  return parts.join(" ");
}

function main() {
  let input = "";
  try {
    input = fs.readFileSync(0, "utf8");
  } catch {
    // no stdin
  }
  let hookData = {};
  try {
    hookData = JSON.parse(input);
  } catch {
    // ignore
  }
  const transcriptPath = hookData.transcript_path;

  const cache = loadCache();
  const files = listJsonlFiles(PROJECTS_DIR);
  const today = new Date().toISOString().slice(0, 10);

  const allTotals = {}; // model -> usage, all-time
  const todayTotals = {};
  let sessionTotals = {};

  for (const file of files) {
    let size = 0;
    try {
      size = fs.statSync(file).size;
    } catch {
      continue;
    }
    const cached = cache.files[file];
    let byDay;
    if (cached && cached.size === size) {
      byDay = cached.byDay;
    } else {
      byDay = parseFile(file);
      cache.files[file] = { size, byDay };
    }

    for (const [day, models] of Object.entries(byDay)) {
      for (const [model, u] of Object.entries(models)) {
        if (!allTotals[model]) allTotals[model] = emptyUsage();
        addUsage(allTotals[model], u);
        if (day === today) {
          if (!todayTotals[model]) todayTotals[model] = emptyUsage();
          addUsage(todayTotals[model], u);
        }
      }
    }

    if (transcriptPath && path.resolve(file) === path.resolve(transcriptPath)) {
      sessionTotals = {};
      for (const models of Object.values(byDay)) {
        for (const [model, u] of Object.entries(models)) {
          if (!sessionTotals[model]) sessionTotals[model] = emptyUsage();
          addUsage(sessionTotals[model], u);
        }
      }
    }
  }

  saveCache(cache);

  function sumAll(totalsByModel) {
    let tokens = 0;
    let cost = 0;
    for (const [model, u] of Object.entries(totalsByModel)) {
      tokens += totalTokens(u);
      cost += costOf(model, u);
    }
    return { tokens, cost };
  }

  const sess = sumAll(sessionTotals);
  const day = sumAll(todayTotals);
  const all = sumAll(allTotals);

  const sec = CONFIG.sections;
  const parts = [];
  if (sec.clock) parts.push(fmtClock());
  if (sec.costs) {
    parts.push(
      `${T.session} ${fmtCost(sess.cost)} (${fmtNum(sess.tokens)})`,
      `${T.today} ${fmtCost(day.cost)} (${fmtNum(day.tokens)})`,
      `${T.all} ${fmtCost(all.cost)} (${fmtNum(all.tokens)})`
    );
  }

  const ctxLine = sec.context ? contextBar(hookData.context_window) : "";
  const limLine = sec.limits ? limitsLine(hookData.rate_limits) : "";
  const cntLine = sec.counters ? countersLine(hookData) : "";

  if (ctxLine) parts.push(ctxLine);

  const lines = [];
  if (parts.length) lines.push(parts.join(" · "));
  if (limLine) lines.push(limLine);
  if (cntLine) lines.push(cntLine);

  process.stdout.write(lines.join("\n"));
}

main();
