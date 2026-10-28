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

Each run creates `.worktrees/agent/<issue>-<run>` from local `main`. It does not fetch or update main. The worker uses `--approve-for-me`, so approval review can block required operations. It follows the shared prompt, selecting investigation or implement as appropriate.

The prompt prohibits push, PR creation, main integration, deployment, and Linear writes. This is an instruction boundary, not a technical restriction on external API credentials. Worktrees remain available for review.

## Locks and results

All invocations on a machine must share `state_dir`. A workspace/issue-specific flock prevents concurrent execution of the same issue; different issues may run in parallel. Lock files remain after exit; do not remove them. There is no coordination with other machines or manually launched agents.

Normal interruption terminates the child process group before releasing the lock. After forced termination or a machine failure, check remaining processes and worktrees before retrying.

Each run saves `run.json`, `issue.json`, and `preflight.jsonl`. Worker runs also save `prompt.md`, `events.jsonl`, structured `result.json`, and rendered `result.md`. Keep logs private. The Codex session ID appears in the JSONL `thread.started` event.

Worker results distinguish `completed` (exit 0), `partial` (exit 2), and `blocked` (exit 3). A successful check also exits 0. Execution or malformed-result failures exit 1. The terminal prints a Japanese outcome and summary; `run.json` records `outcome` and `summary` separately from process phase `agent-exited`. These are the agent's reported conclusions, not an independent verification of acceptance criteria. Read the evidence in `result.md`. Older runs retain their original records and are not reclassified. There is no automatic retry, scheduler, webhook, or distributed queue.

Workers may use documented local builds, fictional fixtures, temporary stores, and test servers even when production deployment is prohibited. They must distinguish fixture verification from real-data acceptance and report missing authorization or data without inventing substitutes for the required evidence.

## Verification

```sh
python3 -m unittest discover -s "$HOME/.config/linear-issue-runner" -v
```

Tests use real Git repositories and replace Codex only at the external process boundary. They cover routing rejection, worktree isolation, per-issue locks, and failure recovery.
