---
name: herdr-agent-launch
description: Launch an already-authorized agent in the current Herdr workspace, using the current tab's pane count.
---

# Herdr Agent Launch

Use this skill only to place and launch an agent whose startup is already authorized by the user or an explicitly invoked skill. This skill grants no authorization to start additional agents.

- If `HERDR_ENV` is not `1`, use the ordinary current terminal.
- Under Herdr, identify the current workspace and tab, and count that tab's panes before creating anything. Use the current workspace; never create a new workspace.
- With exactly one pane, run `herdr pane split --current --direction right --no-focus` and use the returned new pane ID.
- With two or more panes, run `herdr tab create --workspace <current-workspace-id>` and use the returned root pane ID in the new tab.
- After obtaining the pane ID from the operation result, run `herdr pane run <pane-id> "<authorized-agent-command>"`.
- Confirm the target pane and startup result before reporting success. Do not repeat startup when its result is uncertain.

Stop if authorization, the current workspace or tab, pane count, or returned pane ID is missing or uncertain, or if creation or startup fails. Zero panes is undefined: stop. Do not compensate by creating a workspace, switching to another workspace, or launching a duplicate agent.
