---
description: Local Linux container workflows on macOS using Apple Container and container-compose.
---

# Local Containers on macOS

Apply these instructions when running Linux containers locally on macOS.

- Use Apple Container (`container`) and `container-compose` for local container workflows.
- Check `command -v container`, `command -v container-compose`, and `container system status` before starting work. If the tools are missing, report the missing prerequisites before proceeding.
- Use `container system start` to start the runtime and `container-compose` to operate Compose projects. Check the installed command's `--help` for supported options; Compose compatibility is partial.
- On Apple Silicon, specify `platform: linux/arm64` in Compose services to avoid fetching images for every architecture.
- Use named Linux volumes for PostgreSQL data. Set `PGDATA` to a subdirectory of the mounted volume so initialization does not conflict with `lost+found`. macOS bind mounts may reject PostgreSQL's ownership changes.
- Verify database connections from the host and data persistence after a container restart before switching environments.
- Follow the target environment's container tooling for NAS, remote hosts, CI, and Linux. These local macOS instructions do not change their Docker workflows.
