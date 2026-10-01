# Remote CLI and browser management - 2026-09-27 UTC

> 功能与验证专题；事实仅适用于正文注明的版本、日期与验证层级。当前综合状态见 [文档 16](16-implementation-status.md)。 [文档导航](README.md)

## User boundary

**Tests must never use the user's real Claude browser login state, cookies,
profiles or live authorization flow. Never open an actual Claude login page
for testing.** Authorization tests use fake executables, temporary homes and
loopback callbacks. Real authorization is a separate, explicit user action.
Simulation does not establish an anti-abuse exemption or validate Claude H.

## Implemented behavior

- SSH administrators have remote CLI and browser-user tabs. Program status
  includes installed and currently resolved official versions. New installs
  and updates run a reviewed official native installer in an empty staging
  HOME, then retain program files in a protected shared version directory.
  The local CLI's version is not silently copied.
- Previews bind provider, complete SSH identity and installation state.
  Confirmation is single use. Release/state drift requires a new preview;
  unknown write replies are never retried automatically. Only receipt-verified
  managed programs can be uninstalled. External installations retain their
  original management channel. User configuration, memory and history remain.
- Independent provider locks protect native processes and maintenance. The
  desktop blocks maintenance during running, pending or uncertain tasks.
  Editing/removing a connection is blocked during its login/maintenance.
- Account removal runs official logout and removes the public registration
  and default selections. Native profile directories remain; no deleted row
  remains in the catalog. New accounts use the existing explicit native flow.
- Codex retains its remote device code, official URL, copy and open controls.
- Claude login starts on the VPS under the native account owner. Users must
  explicitly select a remote browser profile. Profiles support create, rename
  and confirmed deletion. An already-running Chrome cannot be taken over.
- A strict SSH loopback tunnel exposes the remote noVNC viewer. Native OAuth
  URLs are opened only in the VPS browser and are not sent to the renderer.
  The optional authorization-code field appears only after the native CLI
  asks. Codes go once to the native PTY, without persistence or translation.
- A zero exit code requires a native authenticated-status receipt. Completion,
  cancellation, EOF and timeout clean this attempt's CLI/browser processes,
  preserving profile data and pre-existing display/bridge processes. Confirmed
  success disables repeat login in that modal. Unknown cleanup blocks retries.
- Linux parent-death signaling kills the direct native-login leader if its
  orchestrator is killed. The lost receipt leaves its reservation blocked.
  This does not prove cleanup after arbitrary nested-process crashes, SIGKILL
  of every supervisor or broker restart. Such uncertainty requires deliberate
  administrator inspection, never automatic reauthorization.

## Browser provisioning and provenance

Adapts the user-owned `<private-reference>/remote-browser/remote_browser.py` and
`configure_browser_root.py`; their originals are unchanged. Original SHA256:

- `remote_browser.py`: `ccbc090540ec79b0a8a172a2262b41e354ce95ffa41b2c95a081b0d4d39a060e`
- `configure_browser_root.py`: `009c8ffd1d3df66ce9c915ed9e99824fac7e0ba840110fe5ee77e7428aabe3e6`

Automatic provisioning currently supports DNF Linux x86_64. The complete
dependency dry run and licenses appear before confirmation. Upgrade, removal
and replacement transactions are rejected. Critical system package families
are excluded; apply rechecks the reviewed inventory and cached transaction.
It does not install a full desktop environment.

The official Google Chrome RPM is signature/identity checked and extracted
without running RPM scripts. Its sandbox runs under a dedicated unprivileged
browser account. Download, signature, version and dependency failures stay in
staging before final browser/data paths are created. Later failures can leave
a partial installation requiring inspection; unknown data/users are not
overwritten or silently recreated.

Pinned archives remain separate programs, not extension-host code. Installation
preserves their license files:

| Component | License reviewed | Archive SHA256 |
| --- | --- | --- |
| noVNC v1.6.0 | MPL-2.0 and included component licenses | `5066103959ef4e9b10f37e5a148627360dd8414e4cf8a7db92bdbd022e728aaa` |
| websockify v0.13.0 | LGPL-3.0 | `b6413e364efd04f3c92ec8c17747e3c4adc20157c2ef1c5d019a26d944a46df8` |

No binaries/downloaded third-party archives are committed. User-owned profile
tests were adapted to temporary synthetic data only.

## Verification and limits

Frozen source: `de51e94` plus this task's overlay under ignored
`build/qa/remote-management/source`. Production `dist` and the active user
client were not touched.

| Evidence | Result | Scope |
| --- | --- | --- |
| TypeScript and isolated production-parameter build | Passed | Renderer/main/preload and bundled Python |
| Full unit/protocol suite | 634/634, zero skips | Synthetic transports and isolated native metadata |
| Simulated Claude authorization | 8/8 | Auto callback, code, cancel, disconnect, timeout, failure, false success, direct-parent death |
| Browser profiles/supervision | 19/19 | Fake profiles, preservation, partial-start cleanup and PID reuse |
| CLI/account/browser lifecycle | 10/10 | Fake installers/logout/packages, program-only removal, locks and staging |
| Account-service setup regression | 10/10 | Temporary files and fake OS commands |
| Hidden isolated Electron UI | 13/13, no renderer errors | Mocked IPC, HTTP/HTTPS blocked, viewer opens recorded only |

Light/dark, simulated-login and narrow-layout screenshots were inspected.
Initial UI fixture failures (a wrong close selector and omitted read-only
IPC mocks) were corrected and the complete UI test rerun. An earlier local
Codex metadata fixture failure was rerun with the available executable and
temporary configuration; final full regression passed. Failed runs are not
counted as acceptance.

Evidence: `source-manifest.json`, `build-final.txt`, `full-tests-final.txt`,
`simulated-auth.txt`, `browser-profiles.txt`, `cli-lifecycle.txt`,
`account-setup.json`, `ui/report.json` and `ui/*.png` in that QA folder. The
fake browser only parses the official-looking fixture URL and invokes its
allowed loopback callback; it never requests the real OAuth URL.

Prior bounded read-only VPS inspection found no CLI programs in checked
locations, matching CLI processes or account-service unit/socket. Nothing
needed uninstalling (`build/qa/remote-cli/live-before.json`). This is a
historical observation, not a filesystem-wide or refreshed claim.

No real Claude authorization, real browser-profile/cookie access, model task,
official-installer execution, browser/package installation or VPS deployment
was performed. CLI install/auth status is separate from execution acceptance:
the existing Codex execution-version gate is unchanged and Claude H remains
unverified/closed. No push or release occurred.
