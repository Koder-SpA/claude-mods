---
description: Detect or pin the Claude plan that task-router routes for
---

Set up task-router for this machine.

1. Read `oauthAccount.organizationRateLimitTier` (falling back to `userRateLimitTier`)
   from `~/.claude.json`, or from `$CLAUDE_CONFIG_DIR/.claude.json` when that variable
   is set. Report the raw value and which preset it maps to:
   - contains `max`, `team` or `enterprise` -> `max`
   - contains `pro` -> `pro`
   - anything else -> `api`

2. If the user passed an argument (`max`, `pro` or `api`), use that instead and say you
   are overriding detection.

3. Show the resulting routing table from the `routing` skill and ask the user to confirm
   it looks right for how they work. Detection reads an internal field that Anthropic
   does not document, so a wrong answer here is plausible and worth a glance.

4. On confirmation, write `~/.claude/task-router.json` (respecting `CLAUDE_CONFIG_DIR`),
   merging into the existing file if there is one:

   ```json
   { "plan": "max" }
   ```

   The config always wins over detection, so this also fixes the case where the field
   changes or disappears.

5. Tell the user the table takes effect in the next session, or now with
   `/reload-plugins`.

Do not change any other setting, and do not touch the statusline.
