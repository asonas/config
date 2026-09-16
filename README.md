# asonas/config

Personal configuration managed as live files with mise.

This repository is replacing the symlink-based `asonas/dotfiles` setup through
an incremental migration. The existing dotfiles repository remains the
authority only for paths and bootstrap behavior that have not yet been migrated
and verified here.

## Goals

- Edit the files used by applications directly in their normal locations.
- Let mise save revisions automatically and synchronize them between machines.
- Track only an explicit allowlist of human-authored configuration.
- Rebuild generated agent configuration from APM sources instead of copying
  generated files between machines.
- Bootstrap a new machine from declarations and source files without recreating
  the old symlink layout.

## Architecture

There are three kinds of state:

| Kind | Examples | Owner |
| --- | --- | --- |
| Authored configuration | `~/.zshrc`, `~/.gitconfig`, `~/.apm/apm.yml`, APM instruction sources | mise history |
| Derived configuration | installed APM skills, compiled agent instructions, dependency checkouts | APM |
| Runtime state | databases, sessions, logs, caches, credentials | the local application |

The remote Git repository is a transport and history store for mise. Normal
editing happens at the live path under the home or mise configuration directory,
not in a cloned source tree.

### Allowlist policy

Track exact files by default. Track a directory only when it is exclusively
human-authored configuration and applications do not write runtime state into
it. A tracked directory also includes files added beneath it later.

Do not track broad mixed-state directories such as:

- `~/.config`
- `~/.claude`
- `~/.codex`
- `~/.apm`

Select safe files or narrowly scoped subdirectories within them instead. This
keeps databases, sessions, logs, caches, generated dependencies, and credentials
out of history.

The repository may be public only while every tracked path and every saved
revision is safe to publish. Removing a value from the current file does not
remove it from earlier history. Configure encryption before the first save of a
file that requires secrecy.

## mise-owned sources

The global mise configuration declares tools, bootstrap resources, the history
watcher, and every tracked path. Its target location is:

```text
~/.config/mise/config.toml
```

The initial configuration should enumerate individual files. For example:

```toml
[dotfiles]
"~/.zshrc" = { mode = "track" }
"~/.gitconfig" = { mode = "track" }
"~/.apm/apm.yml" = { mode = "track" }
"~/.apm/instructions/base.instructions.md" = { mode = "track" }

[bootstrap.services.mise-history]
builtin = "history-watch"
```

This is an illustrative subset, not the migration manifest. Add a path only
after inspecting the live target and the complete candidate set that the entry
would capture.

## APM ownership

APM sources are authored configuration and belong in mise history:

- `~/.apm/apm.yml`
- explicitly listed files under `~/.apm/instructions/`
- any hand-authored local APM package selected during migration

APM outputs are derived and must be regenerated rather than tracked:

- `~/.apm/apm_modules/`
- `~/.agents/skills/`
- APM-managed entries under `~/.claude/` and `~/.codex/`
- compiled `AGENTS.md` and `CLAUDE.md` files
- generated agents, rules, commands, hooks, and skills

`apm.lock.yaml` is initially treated as machine-generated state, matching the
current setup. Revisit that decision separately if reproducible dependency pins
become more important than automatic updates and cross-machine conflict
avoidance.

Apply the global APM configuration through the wrapper:

```sh
mise run apm:apply
```

The wrapper installs user-scope dependencies for Claude, Cursor, and Codex. It
compiles the handwritten instruction sources in an isolated temporary project,
then atomically replaces the generated user instruction files.

The bootstrap services separate dependency deployment from instruction
compilation. `apm-watch` watches `~/.apm/apm.yml`, performs the full install at
when the manifest changes.
`apm-instructions-watch` watches `~/.apm/instructions/` and runs compilation
only. Both watchers start with `--postpone`, so restarting bootstrap services
does not redeploy skills. Run `mise run apm:apply` explicitly after restoring
the tracked APM sources and before applying the watcher services. Both paths
share `~/.apm/.auto-apply.lock`.

This split prevents ordinary instruction edits from redeploying
`~/.agents/skills/`. APM replaces a retained skill directory by removing and
copying it, so unnecessary installs can otherwise race with an agent reading
`SKILL.md`.

The process-boundary fixture verifies that instruction-only events compile the
expected global outputs without installing dependencies. Preserve post-install
normalization as an explicit bootstrap step; do not copy generated output as a
shortcut.

## Daily operation

Edit a tracked file at its live path. The history watcher records the change.

```sh
$EDITOR ~/.zshrc
mise bootstrap dotfiles status
mise bootstrap dotfiles history --path ~/.zshrc
```

Preview recovery before changing a live file:

```sh
mise bootstrap dotfiles rollback ~/.zshrc --dry-run
mise bootstrap dotfiles rollback ~/.zshrc
mise bootstrap dotfiles undo
```

For a newly considered path:

1. Inspect the file or full directory tree, including hidden files.
2. Confirm that every candidate is authored configuration and safe for the
   repository's visibility.
3. Show the exact tracking candidate set before mutation.
4. Track the smallest stable path.
5. Confirm `mise bootstrap dotfiles status` and the saved revision.
6. Use manual synchronization until the remote candidate has been reviewed.

Exclusions are a backstop, not the primary boundary. Prefer a narrow tracking
entry over tracking a broad directory with a growing denylist.

## Herdr plugins

Herdr's `~/.config/herdr/.plugins.lock` is a process lock, and `plugins.json`
is generated runtime state containing machine-local paths. Do not track either
file. Declare the desired plugin and its resolved Git commit in
`~/bin/herdr-plugins-apply` instead.

The `bootstrap` task runs `herdr:plugins` after mise has installed tools. It
installs or updates `shibayu36/herdr-equalize-panes` only when the installed
commit differs, and enables an already pinned plugin if needed. The task skips
the `headless` profile. Run it directly after changing the pinned commit:

```sh
mise run herdr:plugins
```

## Bootstrap operation

Linux desktop machines and headless Linux hosts use different mise profiles.
Run desktop machines with the `desktop` profile so GUI configuration such as
Chromium, Ghostty, Herdr, Hyprland, and WezTerm is tracked and restored. Run
headless machines with the `headless` profile; those entries have no matching
variant during normal history and bootstrap operations and are skipped.
macOS-only configuration continues to use `os = "macos"` variants.

For a headless host such as the NAS, preview adoption with:

```sh
mise -E headless bootstrap --adopt git@github.com:asonas/config.git --dry-run
```

The initial adoption restores the setup history before profile selectors take
effect. Back up existing paths first, then remove any GUI files restored by the
initial adoption from a headless host. Subsequent capture and synchronization
use the selected profile.

Keep the profile on the history watcher in the machine-local, untracked
`~/.config/mise/config.local.toml`:

```toml
[bootstrap.services.mise-history]
scope = "user"
builtin = "history-watch"
environment = { MISE_ENV = "headless" }
```

Reapply the service after changing this local setting:

```sh
mise -E headless bootstrap services apply
```

For an Omarchy desktop, use `mise -E desktop` for bootstrap and dotfile history
commands so Linux GUI entries remain selected.

The intended new-machine flow is:

1. Install a mise version that supports tracked dotfiles and history services.
2. Adopt the repository with `mise bootstrap --adopt <repository-url>`.
3. Review the complete bootstrap dry run.
4. Apply declared tools, packages, services, and tracked files.
5. Install and compile APM from the restored source configuration.
6. Verify the generated Claude, Codex, and shared skill locations.

The exact commands and ordering will be finalized and tested during migration.
Do not treat this design document as proof that bootstrap is already implemented.

## Migration from asonas/dotfiles

Migrate incrementally. For each path:

1. Resolve the existing symlink and preserve its current content and metadata.
2. Account for uncommitted changes in the old repository.
3. Display the exact symlink removals and regular-file replacements as a dry run.
4. Replace the symlink with an equivalent regular file.
5. Track the live file with mise and verify its initial revision.
6. Confirm that the application still reads the expected configuration.
7. Remove the old installer responsibility only after the new path is verified.

Keep the old repository available as historical evidence until every managed
path, bootstrap helper, APM workaround, and platform-specific behavior has been
accounted for. Archive it only after a second-machine restore succeeds.

## Current status

- Repository design documented.
- mise 2026.9.5 installed.
- 24 legacy dotfile entries migrated from symlinks to regular live paths.
- Eight APM source files migrated to regular live paths.
- 32 explicit entries covering 62 files tracked in mise history.
- Neovim history and Karabiner automatic backups excluded from future captures.
- The `mise-history` user service is running and automatic capture is active.
- The public `asonas/config` repository is connected as the setup origin in
  manual sync mode, and the initial history has been published.
- Global APM install and compile were previewed but not applied. The install
  preview would remove two skills installed by the separate Gist workflow, so
  that workflow must be migrated before APM bootstrap can replace the old
  installer.
- GUI dotfiles use the `desktop` profile on Linux and are skipped by the
  `headless` profile used on the NAS. macOS-only files use OS variants.
- The headless profile was adopted and verified on the NAS: tracked files were
  restored as regular files, automatic history sync and APM watch are running,
  and GUI-only paths are absent after initial-adoption cleanup.
