#!/bin/sh
# SessionStart hook: put the codex-platform shim first on PATH for the Bash
# commands Claude runs, so `codex exec` from agent skills uses API credits.
# Interactive terminals and herdr panes keep their own PATH.

[ -n "${CLAUDE_ENV_FILE:-}" ] || exit 0

dir="$HOME/.claude/scripts/codex-platform"
[ -x "$dir/codex" ] || exit 0

grep -qF "$dir" "$CLAUDE_ENV_FILE" 2>/dev/null && exit 0
printf 'export PATH="%s:$PATH"\n' "$dir" >> "$CLAUDE_ENV_FILE"
