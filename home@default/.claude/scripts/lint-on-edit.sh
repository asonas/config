#!/bin/bash
# PostToolUse hook: format and lint only the file that was just edited.
# Runs synchronously so the file is settled before Claude's next edit, and
# never rewrites other files in the project.

INPUT=$(cat)
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty')

if [ -z "$FILE_PATH" ] || [ ! -f "$FILE_PATH" ]; then
  exit 0
fi

PROJECT_DIR=$(echo "$INPUT" | jq -r '.cwd // empty')
if [ -z "$PROJECT_DIR" ]; then
  exit 0
fi

cd "$PROJECT_DIR" || exit 0

case "$FILE_PATH" in
  *.ts|*.tsx|*.js|*.jsx)
    if [ -x node_modules/.bin/prettier ]; then
      node_modules/.bin/prettier --write "$FILE_PATH" >/dev/null 2>&1
    fi
    if [ -x node_modules/.bin/eslint ]; then
      node_modules/.bin/eslint --fix "$FILE_PATH" >/dev/null 2>&1
    fi
    ;;
  *.rb)
    if [ -f Gemfile ] && grep -q "rubocop" Gemfile; then
      bundle exec rubocop -a "$FILE_PATH" >/dev/null 2>&1
    fi
    ;;
  *.rs)
    if [ -f Cargo.toml ] && command -v cargo >/dev/null 2>&1; then
      cargo fmt -- "$FILE_PATH" >/dev/null 2>&1
    fi
    ;;
  *.css|*.json)
    if [ -x node_modules/.bin/prettier ]; then
      node_modules/.bin/prettier --write "$FILE_PATH" >/dev/null 2>&1
    fi
    ;;
esac

exit 0
