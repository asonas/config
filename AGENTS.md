# Repository Instructions

Respond to the user in Japanese. Write repository documentation and configuration
comments in English unless the user requests another language.

Read `README.md` before changing mise tracking, bootstrap behavior, APM sources,
or migration state. It defines the architecture, ownership boundaries, and
migration sequence.

## Source boundaries

- Treat live, human-authored configuration as source.
- Treat APM dependencies and deployed agent files as derived output.
- Change APM instructions at their source and regenerate outputs with APM.
- Keep databases, sessions, logs, caches, credentials, and application state
  local.
- Track exact files by default. A directory entry requires evidence that every
  current and future child belongs in shared history.
- Keep `~/.config`, `~/.claude`, `~/.codex`, and `~/.apm` as mixed-state roots;
  select explicit files or narrow source-only subdirectories beneath them.

## Change workflow

1. Inspect repository status and the affected live paths before proposing a
   mutation. Preserve unrelated and uncommitted work.
2. Show the exact candidate set before adding tracking, removing symlinks, or
   applying bootstrap changes. Re-run the preview if the inputs change.
3. Make only the smallest migration or configuration change requested.
4. Verify observable results at the owning boundary: mise status/history for
   tracked files, and APM dry-run/install/compile output for agent configuration.
5. Update `README.md` when an architectural decision or migration status changes.

Do not report a path as migrated merely because documentation or a manifest was
edited. Migration requires a regular live file, a verified mise revision, and a
successful application readback. Do not report bootstrap as working until it has
been restored and verified on a separate fixture or machine.

Use mise-managed runtimes through `mise exec --`. Before running Ruby or Node.js
commands, check the resolved executable and version. Do not run environment-wide
installation as an ordinary test.
