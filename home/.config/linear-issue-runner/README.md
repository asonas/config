# Linear Issue Runner

Run one Linear issue in a dedicated Git worktree using local Codex. Requires macOS or Linux, Python 3.11+, Git, and a Codex CLI authenticated with Linear MCP.

## Layout

- `~/bin/linear-issue-runner`: executable entry point.
- `~/.config/linear-issue-runner/runner.py`: implementation.
- `prompt.md`: worker instructions, alongside the implementation.
- `config.example.toml`: portable configuration example.
- `config.local.toml`: private machine configuration; not tracked by mise.
- `state_dir`: private logs and locks; not tracked by mise.

Live files are the source. mise tracks the entry point, implementation, prompt, example, README, and tests as exact file entries. Do not track the entire directory: it contains private configuration and may contain Python caches.

## Usage

Copy the example to `config.local.toml` and configure the workspace, state directory, and project UUID to repository mappings. Use absolute repository paths or paths beginning with `~/`. Add a `[[projects]]` entry for each repository. The launcher uses `python3` from PATH; ensure Python 3.11+ is available when scheduling it.

```sh
linear-issue-runner --check 'https://linear.app/example/issue/EX-1/example'
linear-issue-runner 'https://linear.app/example/issue/EX-1/example'
```

An explicit `--config /path/config.toml` overrides the launcher's default. `--check` performs a read-only Codex preflight and validates repository routing and OS labels without creating a worktree. It uses model quota. The first configured repository provides the preflight working directory; the returned project UUID selects the worker repository.

Eligible issues have `ready-for-agent`, are not started/completed/canceled/archived, and have successfully completed blockers. Preflight extraction depends on the model; the worker rechecks the issue before work.

OS labels are `os:macos`, `os:linux`, and `os:windows`. No label allows any supported host; multiple labels mean OR. Split all-platform verification into separate issues. The worker also checks environment requirements in the issue body. Running this script on Windows is not supported.

## Execution boundary

The first run creates `.worktrees/agent/<issue>-<run>` from local `main`. Later runs automatically reuse the latest recorded worktree and Codex session for the same workspace/issue. `--resume-run <directory-name>` selects an earlier run explicitly. The runner validates the repository and branch before continuing and preserves uncommitted work. A missing or changed worktree is an error, not a reason to silently start over. Without an available session ID it starts a fresh session in the existing worktree and points it to the previous report.

It does not fetch or update main. The worker uses `--approve-for-me`, so approval review can block required operations. It follows the shared prompt, selecting investigation or implement as appropriate. Use `--note 'additional context'` to supply follow-up instructions.

The implementation worker does not publish. A separate Codex delivery session reviews the existing diff and evidence, creates signed commits, pushes the issue branch without force, and creates or updates its PR. Partial/blocked work uses a draft PR without closing keywords. No-change results skip PR creation. Every delivery creates or updates a Linear progress comment identified by a stable branch marker, including results, verification, gaps, and a PR link. PR/comment lookup and readback are required before reporting delivery success. The runner additionally verifies local signatures, a clean worktree, and matching PR branch, head commit, state, and draft requirement.

Main integration, deployment, production data changes, closing issues, and status/label changes remain prohibited. These are instruction boundaries, not technical restrictions on external API credentials. Worktrees remain available for review. Local locks do not prevent another machine or person from publishing concurrently.

If publishing fails, the result and worktree remain intact. Retry only delivery with:

```sh
linear-issue-runner --publish-only 'https://linear.app/example/issue/EX-1/example'
```

Delivery retries search for the existing branch PR and marked Linear comment. They stop on a closed/merged PR rather than create a replacement. If a retry is interrupted, inspect the external resources before retrying again. `--publish-only` does not implement changes; it can commit and publish existing verified changes.

## Locks and results

All invocations on a machine must share `state_dir`. A workspace/issue-specific flock prevents concurrent execution of the same issue; different issues may run in parallel. Lock files remain after exit; do not remove them. There is no coordination with other machines or manually launched agents.

Normal interruption terminates the child process group before releasing the lock. After forced termination or a machine failure, check remaining processes and worktrees before retrying.

Each run saves `run.json`, `issue.json`, and `preflight.jsonl`. Worker runs also save `prompt.md`, `events.jsonl`, structured `result.json`, and rendered `result.md`. Delivery saves `delivery.jsonl` and a `delivery.json` receipt with the PR URL and Linear comment ID. Keep logs private. The Codex session ID appears in the JSONL `thread.started` event and is copied into `run.json` for resume.

After successful delivery, worker results distinguish `completed` (exit 0), `partial` (exit 2), and `blocked` (exit 3). A successful check also exits 0. Execution, malformed-result, or delivery failures exit 1. The terminal prints a Japanese outcome and summary; `run.json` records `outcome` and `summary` separately from process phases `agent-exited`, `publishing`, and `delivered`. A failure preserves the worker outcome if available. These are the agent's reported conclusions, not an independent verification of acceptance criteria. Read the evidence in `result.md`. Older runs retain their original records and are not reclassified. There is no automatic retry, scheduler, webhook, or distributed queue.

Workers may use documented local builds, fictional fixtures, temporary stores, and test servers even when production deployment is prohibited. They must distinguish fixture verification from real-data acceptance and report missing authorization or data without inventing substitutes for the required evidence.

## Verification

```sh
python3 -m unittest discover -s "$HOME/.config/linear-issue-runner" -v
```

Tests use real Git repositories and replace Codex, Git signature verification, and GitHub at external process boundaries. They cover routing rejection, worktree isolation, per-issue locks, resume, delivery retry, and failure recovery. Real signed delivery must also be checked with an actual issue before relying on the automation.
