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
    # `cargo fmt -- <file>` formats the whole crate as well as the file, so
    # call rustfmt on the file alone. rustfmt cannot learn the edition from a
    # single file, so read it from the nearest Cargo.toml above the file.
    if command -v rustfmt >/dev/null 2>&1; then
      dir=$(dirname "$FILE_PATH")
      while [ "$dir" != "/" ] && [ ! -f "$dir/Cargo.toml" ]; do
        dir=$(dirname "$dir")
      done
      if [ -f "$dir/Cargo.toml" ]; then
        edition=$(sed -n 's/^edition *= *"\([0-9]*\)".*/\1/p' "$dir/Cargo.toml" | head -n 1)
        rustfmt --edition "${edition:-2021}" "$FILE_PATH" >/dev/null 2>&1
      fi
    fi
    ;;
  *.css|*.json)
    if [ -x node_modules/.bin/prettier ]; then
      node_modules/.bin/prettier --write "$FILE_PATH" >/dev/null 2>&1
    fi
    ;;
esac

exit 0
