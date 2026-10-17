# Task Router

Delegates each sub-task to the right model and effort for your Claude plan.

A session has one scarce resource: the main context window. Every tool result read
inline stays in the conversation, and every later turn re-sends that whole conversation.
A worker agent reads in its own window and hands back a short report, so the bytes it
read never enter yours. A cheaper model is a side benefit; the context saving is what
compounds.

This mod is a routing skill, four worker agents and one session-start hook. **There are
no enforcement hooks**: nothing counts your tool calls, nothing blocks a Read, nothing
denies an agent. The policy is injected, and you or the model can ignore it whenever
ignoring it is right.

## Install

```
/plugin marketplace add Koder-SpA/claude-mods
/plugin install task-router@koderspa
/reload-plugins
```

The reload is needed once: hooks, agents and skills load when a session starts.

## Plan detection

Routing tables differ by plan, because the thing you are spending differs. On a
subscription you spend against 5h and weekly limits, so the useful knob is **effort**.
On the API every token is an invoice line, so the useful knob is a **cheaper model**.

At session start the mod reads `oauthAccount.organizationRateLimitTier` from your account
file and picks a preset:

| Plan | scout | extractor | mechanic | builder |
|---|---|---|---|---|
| Max | sonnet / low | sonnet / medium | sonnet / high | **opus / high** |
| Pro | haiku / low | haiku / medium | sonnet / high | sonnet / high |
| API | haiku / low | haiku / medium | sonnet / medium | sonnet / high |

`model` and `effort` are passed per spawn and override each agent's frontmatter, so one
set of agent files serves every plan.

That field is internal and undocumented, so detection can be wrong or stop working. Pin
it by hand whenever you like:

```
/task-router:router-setup max
```

or write `~/.claude/task-router.json`:

```json
{ "plan": "max" }
```

The config always wins over detection.

## The agents

| Agent | For |
|---|---|
| `scout` | locate, find usages, map structure, grep logs |
| `extractor` | extract fields, classify, summarise one source |
| `mechanic` | mechanical edits from a complete spec |
| `builder` | implement one scoped task from an approved plan |

Each ends its report with a fixed footer (`RESULT` / `CHECKS-RUN` / `UNCERTAINTIES` /
`ESCALATE`) so escalation is decided on observable failure rather than on a cheap model's
opinion of its own work.

## The test

Before delegating, one question:

> Will I need this tool output again, or only the conclusion?

Only the conclusion means delegate. Bulk reading, searching and summarising go to a
worker. Edits to files already in context, and judgement calls, stay inline.

## Measuring it

The policy is advisory, so the honest question is whether it changes anything. Install
[`cost-dashboard`](../cost-dashboard) from the same marketplace: the per-model split and
the weekly bar in the statusline tell you whether delegation is actually happening. If
you are at 94% on one model, it is not.

## What it does not do

- No proxy, no gateway, no third-party providers, no API keys. Your auth is untouched.
- No network calls. Detection reads one local file.
- No enforcement. No tool call is ever blocked or counted.

## Licence

MIT. See [LICENSE](./LICENSE).
