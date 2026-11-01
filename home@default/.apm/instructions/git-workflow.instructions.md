---
description: Git workflow rules (worktree-first development, safe path handling).
---

# Git Workflow

- Before creating or amending commits, rebasing (including continue), cherry-picking, or integrating a branch into main, read `/commit-style` and follow its signing and verification workflow.

- gitリポジトリで新しい作業（機能開発、バグ修正、実験）を始めるときは、標準の `git worktree` でworktreeを作成すること。mainブランチで直接コミットしない
- 新しいブランチとworktreeは `git worktree add -b <branch> .worktrees/<branch> <start-point>` で作成する
- 作業完了後は `git worktree remove .worktrees/<branch>` でworktreeを削除し、マージ済みを確認してから `git branch -d <branch>` と `git worktree prune` を実行する
- Never use `cd /path && git ...`. Use `git -C /path ...` instead to avoid bare repository attack warnings
- カレントディレクトリがworktree内であれば、絶対パスで `cd` せずそのままコマンドを実行すること。`cd /absolute/path/to/worktree && mise run test:backend` のような冗長なコマンドは禁止。単に `mise run test:backend` と実行すればよい
