---
name: routing
description: >
  The delegation policy: when to hand work to a worker agent instead of doing it inline,
  and which model and effort each worker should run at for your Claude plan. Use when
  deciding whether to delegate, when picking an agent, or when reviewing why a session
  burned more context or limit than expected.
---

# Routing

A session has one scarce resource: the main context window. Every tool result you read
inline stays in the conversation, and every later turn re-sends the whole conversation.
A worker reads in its own window and hands back a report, so the bytes it read never
enter yours.

That is the whole point. A cheaper model is a side benefit; the context saving is what
compounds.

## The test

Before delegating, ask one question:

> Will I need this tool output again, or only the conclusion?

Only the conclusion means delegate.

| Work | Need the output again? | Verdict |
|---|---|---|
| Find where a symbol is defined | No, just the location | delegate to `scout` |
| Read 12 files to understand a module | No, just the summary | delegate to `extractor` |
| Grep logs for an error pattern | No, just the matches | delegate to `scout` |
| Rename a symbol across the repo | No, just the result | delegate to `mechanic` |
| Edit a file already in your context | Yes, you are working in it | inline |
| Decide between two designs | Yes, it is judgement | inline |
| Read one config to answer one question | Yes, it is one read | inline |

The bright line: by the third search or read on the same question, you are exploring
inline. Hand the whole question to a worker, including what you already learned.

## Tool first

If one deterministic command answers the question, run it. `grep`, `jq`, `git`, a test
runner, a compiler, a schema validator. No model call at all. Reasoning models are for
reasoning.

This outranks delegation. The cheapest worker is still more expensive than `rg`.

## Delegation is not free

A worker pays a fixed startup cost before it does any work: its system prompt and the
schemas for every tool it can use. Measured on this mod's own smoke test, a `scout` run
that made two tool calls and returned four lines of output burned about 30k tokens in
the worker's window.

So the question is not "is this a search?" but:

> Will the material the worker reads for me cost more than starting the worker?

Delegating a grep you already know how to write loses. Delegating a sweep across a
directory you have not seen wins, and wins more the larger the sweep. Between those,
prefer inline: you can always delegate the follow-up once you know the work is big.

This is the honest version of the policy. A router that claims every delegation saves
money is selling something.

## The table

The session-start hook injects the table for your detected plan. The presets:

**Max** - you pay a subscription, not per token, so the knob is effort, not a cheaper
model. Workers run on Sonnet at varying effort; the builder gets Opus.

| Agent | Model | Effort |
|---|---|---|
| `scout` | sonnet | low |
| `extractor` | sonnet | medium |
| `mechanic` | sonnet | high |
| `builder` | opus | high |

**Pro** - tighter limits. Reading work drops to Haiku; Opus is a deliberate manual choice.

| Agent | Model | Effort |
|---|---|---|
| `scout` | haiku | low |
| `extractor` | haiku | medium |
| `mechanic` | sonnet | high |
| `builder` | sonnet | high |

**API / pay-as-you-go** - every token is an invoice line. Start at the cheapest tier
that can succeed.

| Agent | Model | Effort |
|---|---|---|
| `scout` | haiku | low |
| `extractor` | haiku | medium |
| `mechanic` | sonnet | medium |
| `builder` | sonnet | high |

Pass `model` and `effort` on the Agent call to match the row. They override the agent's
own frontmatter, so one set of agent files serves every plan.

Detection reads `oauthAccount.organizationRateLimitTier` from your account file. To pin
it by hand, run `/task-router:router-setup` or write `~/.claude/task-router.json`:

```json
{ "plan": "max" }
```

## Independence

A worker that gathers its own context must not be prefetched for. Do not read its inputs
first, do not inject material you already gathered, do not "help" it with a scout pass.

This matters most with several reviewers over the same change. Each is deliberately shown
a different partial view, and collapsing them into one shared context destroys the only
thing that made them worth running separately - and does it silently, because the output
still looks like four independent reports.

Isolation outranks saving. This is a correctness rule, not a preference.

## Escalation

Workers do not promote themselves. Every worker ends with:

```
RESULT: <one line>
CHECKS-RUN: <commands run and outcomes, or "none">
UNCERTAINTIES: <or "none">
ESCALATE: yes|no - <reason>
```

Then:

1. If a deterministic check exists, run it. Pass means done. Fail means escalate.
2. With no check available, spot-read the result. You receive it anyway, so judging it
   is nearly free.
3. `ESCALATE: yes` is advisory input, never the sole trigger. A cheap model's confidence
   in itself is poorly calibrated; an observable failure is not.
4. Escalate by re-running the same agent one step up - same capability, more effort or a
   stronger model - once. Then the main loop takes it.

## What this is not

This policy does not block anything. There is no counter, no budget, no denied tool call.
If reading five files inline is the right move, read five files inline.

The cost of ignoring this is visible rather than enforced: run `/usage`, or watch the
weekly bar and the per-model split in the statusline. If you are at 94% on one model,
delegation is not happening.
