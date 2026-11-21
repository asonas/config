#!/usr/bin/env bash
set -euo pipefail

normalize_command() {
  awk '
    {
      line = $0
      continued = sub(/\\$/, "", line)
      gsub(/["\047]/, "", line)
      if (NR > 1 && !previous_continued) { printf "\n" }
      printf "%s", line
      previous_continued = continued
    }
  '
}

deny_direct_apm() {
  cat <<'JSON'
{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"`apm update` と `apm install` は直接実行できません。配備は `mise run apm:apply`、依存の更新は `mise run apm:update` を使ってください。ヘルプの表示（`--help`）は許可されています。"}}
JSON
}

direct='(^|[^[:alnum:]_])([^;&|()<>[:space:]]*/)?apm[[:space:]]+(update|install)([;&|()<>`[:space:]]|$)'

input=$(cat)
cmd=$(printf '%s' "$input" | jq -r '.tool_input.command // empty')
normalized=$(printf '%s' "$cmd" | normalize_command)
if ! printf '%s' "$normalized" | grep -Eq "$direct"; then
  exit 0
fi

# Allow help-only invocations such as `apm install --help`: pass only when
# every command segment that runs install/update carries --help or -h.
segments=$(printf '%s\n' "$normalized" | tr ';&|' '\n\n\n' | grep -E "$direct" || true)
if ! printf '%s\n' "$segments" | grep -Evq '(^|[[:space:]])(--help|-h)([[:space:]]|$)'; then
  exit 0
fi

deny_direct_apm
