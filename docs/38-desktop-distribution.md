# 38 · Desktop installation and push-triggered updates

## Distribution contract

The public source repository is `EthanMossvale/AgentWorkbench`. Development normally creates local commits only. Publishing requires explicit user authorization; a local commit never uploads code. The initial publication may use a separately audited, parentless snapshot while retaining local development history. Never force-push a development history over the public release lineage.

GitHub Releases contains the stable `installer` bootstrap download only. Application updates do not use the Releases API or release assets. A push to `main` starts `.github/workflows/desktop-updates.yml`: documentation, plugin contract and recovery UI validation, a Windows x64 build, package/manifest consistency checks, then an atomic GitHub Pages deployment. Failed builds do not replace the deployed site. The separate plugin recovery workflow is advisory and cannot gate deployment by itself; the publication workflow runs its critical checks directly. Clients check the generic HTTPS feed on startup and every five minutes. Push notification is therefore not instantaneous: build time, deployment, caching and the client check interval apply.

New bootstraps download `updates/bootstrap-v2.json`, validate the filename/size, download the exact installer, verify SHA-512, and start the interactive per-user installer with a program-directory picker. Both newly built NSIS packages and online bootstraps use `<version>.exe`; the bootstrap build reads its version from `package.json`. Their separate output directories are `build/distribution` and `build/bootstrap`. The feed retains `bootstrap.json` and a checksum-identical old-name package alias for previously distributed bootstraps. Existing release attachments retain their names until a separately authorized publication. The bootstrap download can remain unchanged across application versions; transport, minimum OS or bootstrap protocol changes require a new bootstrap. It does not compile source on the user's machine or require Git, Node.js or npm. GitHub Actions performs compilation.

The package installs for the current Windows user with desktop and Start menu shortcuts. Windows controls search indexing and pinning; users may pin the entry manually. Native runtime credentials, SSH keys, chats, plugins, local memory, worktrees and UI preferences remain outside the program directory. Uninstall keeps application data. Packaging selects `dist` and production dependencies, never the repository's ignored QA/profile folders.

## Update interaction and extension boundary

Background downloading displays progress in the lower-left corner. A ready update displays a persistent install/restart action while the process remains open. Downloaded files are cached by electron-updater and revalidated on the next successful update check after restart. Offline restoration of a ready indicator is not yet guaranteed. Normal exit does not install an update. Clicking install is blocked while tasks are running or uncertain. Development and synthetic-profile launches do not poll the public feed.

The typed `DesktopUpdatesApi` is registered as `desktop.updates`; the host commands are `desktop-updates/status`, `desktop-updates/check`, and `desktop-updates/install`. Approved host plugins may register a namespaced backend with a cleanup function or override service members. The actual automatic timer and install action consume that service. The named renderer surface is `desktop-update`. Details, errors and lifecycle are in [document 36](36-workbench-plugin-api.md).

## Operational limits and trust

GitHub Pages currently documents a 1 GB site limit and 100 GB/month soft bandwidth limit. The generated site rejects payloads above 950 MiB; individual packages above 800 MiB are rejected. At larger scale, migrate the feed and binary hosting to an appropriate CDN/object store and ship a compatible client update before retiring the old endpoint. These limits do not imply an unlimited free software distribution service.

HTTPS plus manifest SHA-512 checks detect incomplete/corrupt downloads. They do not provide independent publisher authentication if the repository or Pages deployment is compromised. Windows Authenticode signing is not configured: locally built binaries are unsigned and Windows may display reputation warnings. Do not claim that a builder log mentioning signtool proves a valid signature.

Build versions use `0.1.<workflow-run-number>`. Retain the workflow identity and increasing version series; a workflow reset, migration or rollback requires a deliberately higher version. This first implementation targets Windows x64 only. GitHub Pages must be enabled for Actions deployment before the initial public push.

## Validation entry points

- `tests/desktop-updates.test.ts`: development isolation, task gate, explicit installation, registration, obsolete events, real approved ZIP activation/disable/reenable and failed activation cleanup.
- `npm run package:windows`: production build and interactive NSIS packaging.
- `scripts/build-bootstrap.ps1`: standalone Windows bootstrap compilation.
- `scripts/prepare-update-site.mjs`: package/manifest consistency and site capacity gate.
- Plugin contracts, public documentation, UI preference inventory and TypeScript remain mandatory. Packaged installation, process restart and actual hosted download evidence must be recorded separately from source tests before claiming release acceptance.

## Program drive and managed data

Fresh per-user Windows installations default to `%LOCALAPPDATA%\AgentWorkbenchApp` for program binaries and `%LOCALAPPDATA%\AgentWorkbench` for the current user profile. Existing registered program paths and explicit directory choices remain authoritative. Settings exposes the actual profile root and an explicit move/restart action. Managed workspaces, attachments, preferences and registered worktrees move; external projects keep their paths. Updates preserve the saved location. The installer itself and existing native clients are outside a data move. Codex new program installs can select a separate drive while retaining original native login/configuration; existing Codex and Claude Code profiles are not migrated. A small locator in the OS user application-data directory is required to find the selected root. Interrupted or unsupported migrations stop with preserved evidence; successful completion removes the old managed root and verified legacy aliases.
