---
description: Codex CLI execution environment. Compiled into ~/.codex/AGENTS.md only.
---

# Codex CLIでの実行環境

- `bash -lc` や `zsh -lc` のようなネストしたログインシェルを使わず、`exec_command` からコマンドを直接実行する。ネストした非対話シェルではmacOSの`/usr/bin`がPATHの先頭に入り、mise管理のランタイムが隠れることがある
- ランタイムを使うテストやスクリプトの実行前に、`command -v <runtime>` と `<runtime> --version` で解決先とバージョンを確認する
# probe
