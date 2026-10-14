---
description: Install (or remove) the Cost Dashboard statusline in your Claude Code settings
---

# Cost Dashboard — setup

Wire the dashboard script into the user's `statusLine` setting.

## Steps

1. Read `~/.claude/settings.json` (create `{}` if missing).

2. Check the current `statusLine` value:
   - If it already points at `cost-dashboard/scripts/statusline.mjs`, report that it is already installed and stop.
   - If another statusline command is configured, show it to the user and ask whether to replace it before continuing. Never overwrite another statusline without explicit confirmation.

3. Set:

```json
"statusLine": {
  "type": "command",
  "command": "node \"${CLAUDE_PLUGIN_ROOT}/scripts/statusline.mjs\""
}
```

If `${CLAUDE_PLUGIN_ROOT}` is not expanded in the user's setup, substitute the absolute path of this plugin's directory instead.

4. Verify the script runs before reporting success:

```bash
echo '{"cwd":"'"$PWD"'","model":{"display_name":"test"}}' | node "<plugin root>/scripts/statusline.mjs"
```

5. Tell the user to open a new session (the statusline setting is read at startup).

## Uninstall

If the user asks to remove it, delete the `statusLine` key from `~/.claude/settings.json` — or restore the previous value if one was replaced during setup.

## Configuration

Optional config lives at `~/.claude/cost-dashboard.json`. Offer to create it when the user wants to change language, toggle sections, or override pricing:

```json
{
  "locale": "es",
  "clock24h": true,
  "sections": {
    "clock": true,
    "costs": true,
    "context": true,
    "limits": true,
    "counters": true,
    "git": true
  },
  "barWidth": { "context": 12, "limits": 8 }
}
```
