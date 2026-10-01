# VPS shared account broker

This is an independent, locally tested service implementation. It is **not deployed** by repository builds or discovery. The desktop now offers an explicit administrator setup preview and confirmation; merely opening accounts does not install it. No real VPS was changed during this implementation. It does not import existing credentials or restart the old broker. Its Codex native-owner gateway requires separate native H acceptance before the desktop can execute a model task.

`broker.py` is a Linux Unix-domain-socket server. Launch it only as a dedicated non-root credential owner with an explicit root-owned configuration file. The peer's real UID comes from `SO_PEERCRED`; renderer roles and request-supplied usernames cannot authorize a caller. Only root may initiate account authorization. Root sees the complete public catalog but has no workspace default selection. Members see and select only the accounts explicitly assigned to their enabled workspace by the independent control service.

Configuration fields:

- `authorityId`, `generation`: stable non-secret identifiers for this account authority and deployment generation.
- `ownerUid`: the dedicated non-root Unix credential owner; it cannot be a member UID.
- `root`: a new absolute, private service-owned directory, pre-provisioned together with its private `profiles` subdirectory. The service uses `catalog.json` for public metadata and `profiles/<opaque account id>` for separate native credential profiles. Existing profiles are never imported.
- `codexExecutable`: optional approved absolute, root-owned native Codex executable. This implementation verifies version 0.155.1 before device authorization. A Claude-only service may leave it empty; Codex login then reports `RUNTIME_NOT_INSTALLED`.
- `claudeExecutable`: optional approved root-owned Claude Code executable, pinned to 2.1.281 for public authentication status. Claude Windows tool execution is not implemented by this service.
- `socketAccess`: `group` (default, socket mode 0660) or explicitly provisioned `peer-policy` (0666). The latter permits new member UIDs to connect without a static group update; kernel UID and fresh workspace policy still authorize every request before input is read.
- `workspacePolicyFile`: an explicitly configured absolute path to the control service's root-owned policy file. The recommended deployment path is `/var/lib/agent-workbench-control-policy/workspaces.json`; the broker does not guess this path when the field is missing. The containing directory can be root-owned mode `0755`, and the public-metadata-only file root-owned mode `0644`, so the non-root credential owner can read it without gaining permission to change it.
- `members`: optional legacy entries containing `uid`, `workspaceId`, `authorityId`, and `generation`. Existing entries are still validated, but they no longer grant account access. The trusted policy is the dynamic UID authority; new control-service workspaces do not require broker configuration edits or a restart.

The policy contract is:

```json
{
  "schemaVersion": 1,
  "authorityId": "deployment-authority",
  "generation": "deployment-generation",
  "revision": 1,
  "workspaces": [
    {
      "workspaceId": "workspace-one",
      "uid": 1001,
      "enabled": true,
      "allowedAccountIds": ["account-example"],
      "runtimes": ["codex", "claude"]
    }
  ]
}
```

The authority and generation must exactly match the account broker. Every workspace ID and UID must be unique; root and the credential owner's UID cannot be workspace members. Each request reads a fresh policy snapshot and uses the actual peer UID to find its workspace. A request cannot supply another workspace ID. Empty account lists grant no account visibility. A disabled workspace is denied, and an unknown UID is unauthorized.

Missing configuration, missing or unreadable files, invalid schemas, duplicate JSON fields, stale authority/generation, symbolic links, unsafe ownership or writable ancestors fail closed for members. No cached or legacy all-account grant is used as a fallback. Root can still inspect the catalog and authorize an account while repairing the policy. This is an intentional compatibility boundary: deployments without `workspacePolicyFile` remain administrator-only until an administrator explicitly configures and publishes the policy.

The socket is fixed at `/run/agent-workbench-accounts/broker.sock`. Deployment must arrange a service-owned runtime directory and either an appropriate Unix group or the explicit peer-policy socket mode. The directory must not be group- or other-writable: members may connect but cannot replace the socket or lock. Only one service instance can hold its runtime lock. The included `agent-workbench-accounts.service` uses `KillMode=control-group`, a private umask, bounded shutdown, crash supervision and no workbench task-count ceiling. It is an installable unit, not an installer: no unit or OS account is automatically installed. Live boot/cgroup acceptance remains a deployment task.

Startup validates every ancestor before constructing the registry. Configuration and its ancestors must be root-owned and not group- or other-writable. Private storage and runtime ancestors may be root- or credential-owner-owned; storage and `profiles` must have private modes. These paths reject symlinks. The executable and every ancestor/target must be root-owned and not group- or other-writable; root-owned executable symlinks are followed component by component. Members cannot supply an executable or replace a trusted ancestor. An existing catalog file must also be private and service-owned. On every member request, the policy path and all ancestors must be root-owned, non-symlink and not group- or other-writable; the opened descriptor is checked again and reads are limited to one MiB. Atomic policy replacement does not create a stale ACL cache.

Protocol: one bounded JSON line `{ "protocol": 1, "method": "...", "params": {...} }` per connection. Responses are `{ "ok": true, "value": ... }` or a fixed public error code. Methods are `catalog/list`, `selection/set`, `login/start`, `login/status`, and `login/cancel`. All mutations and login polling bind `authorityId` and `generation`; selection additionally compares the member's own `selectionRevision` and current account ACL. Both member catalog and selection responses filter out unassigned account metadata. An old default that has been revoked is omitted from the member response without silently selecting another account or rewriting account identity. Selection changes only the registry default, not a running session or its fixed account reference. Policy failures use `POLICY_UNAVAILABLE`, `WORKSPACE_DISABLED`, `ACCOUNT_FORBIDDEN`, or `ADMIN_LOGIN_REQUIRED`; there is no credential-read/export endpoint.

Native authorization starts only after `login/start`. It runs under the credential owner's UID in a fresh private native profile, with provider keys, inherited proxies and arbitrary environment variables excluded. It executes official device authorization, then `account/read` with `refreshToken: false`; it does not parse authentication files. Only the official verification URL, short device code, public account metadata and fixed status messages are returned. Raw native output is neither returned nor persisted. A 30-second polling lease, a 15-minute maximum and explicit cancellation supervise native process groups. Status polling renews the lease. Process start time, group and session are recorded from Linux `/proc`; non-reaping `waitid` keeps the leader as an identity anchor until final signals are sent. Cleanup refuses reused identities or an unanchored live numeric group and remains unconfirmed for service-level cgroup recovery. Cancelled profiles are retained privately rather than silently deleting potentially completed native credentials; they are not added to the public account catalog.

If the SSH response to `login/start` is lost, the desktop cannot claim whether the remote job started or finished cleanup. The unattended job attempts to stop when its polling lease expires. A subsequent `login/start` is blocked while an earlier job is active or cleanup is unconfirmed; retrying is not evidence of confirmed cleanup.

The catalog contains observations, not a promise that a token is currently valid. A successful administrator authorization registers the account once. Its metadata becomes visible to a workspace only after the administrator explicitly grants its account ID in the control policy. Codex and Claude defaults have independent compare-and-swap revisions. Catalog permission never exposes a token or native profile. Claude profile creation is idempotent; its login command runs the official CLI as the credential owner, and the user completes that login in their own administrator terminal.

## Native account-owner gateway

`runtime/open` upgrades a verified member connection to a bounded JSONL stream. It launches the pinned official Codex app-server as the credential owner using the account's private profile. Each workspace session has its own process and native thread. Members receive public session receipts and relay access to the bound local executor; they never receive an authentication token or a readable profile. CLI binaries are shared, not copied into each workspace.

Session receipts bind account generation, kernel UID/workspace, workbench session, device environment, cwd and root native thread. Every new turn, including continuation of an old conversation, checks the live grant and runtime policy. Foreign history, approval IDs, account mutation and unmanaged configuration are rejected. Native child lineage, models, permission modes and native retry policy remain intact. There is no workbench child count or nesting override.

An active turn becomes uncertain after disconnect/restart. Recovery reads the original native thread/turn and never resubmits the prompt. A missing local startup receipt can be recovered from the owner service. Completed earlier turns cannot settle a later unknown submission. A lost empty thread/start receipt is distinct from a submitted model turn and does not permanently lock an empty session. A structured gateway rejection before the native turn write is returned as explicitly not submitted; transport loss and upstream errors cannot claim that receipt.

Only final structured native usage-limit or authentication errors persist account-generation blocks. Ordinary connection failures, transient rate failures, native retries and model/tool text do not create an account-wide block. Members can explicitly inspect status; verified authentication/quota recovery clears the matching block without requiring an administrator to unlock a healthy account. Billing-review restrictions are not cleared by an unrelated successful status read. Healthy running sessions are not killed by another session's error.

`runtime/status`, `runtime/review`, `runtime/usage`, `runtime/claude-create` and `runtime/login-command` return allowlisted metadata. Reset-card redemption is root-only, explicit and idempotent. Claude execution returns `CLAUDE_LOCAL_EXECUTOR_UNVERIFIED`; status/login management does not pretend to provide Windows native tools, quota or reset-card APIs.

The desktop freezes `accountRuntime` for every new managed session. The old credential-injection bridge and quota reader have been removed. Absent-source bindings now describe historical origin only; they cannot execute until an explicit migration receipt is verified. All chat, model controls, quota and reset-card requests use this native owner. An unavailable native service never falls back to a token broker. An account refresh separately discovers the old public catalog as read-only migration metadata, even when this service is unavailable. These entries never become selectable native accounts or an authentication authority. Grants and defaults are managed by the native catalog and workspace policy.

A native-owner H receipt cannot borrow the old path's acceptance. Historical receipts may remain in the version-2 file for audit, but never enable retired execution. Persisted child-thread ownership survives reconnects, including children imported from verified native history.

## Explicit legacy migration

This is implemented and locally tested, not deployed. Do not run these steps on a real host without the separately scoped deployment and account owner's authorization. The tool never logs in automatically or submits a model turn.

1. In the old conversation, copy the migration manifest from the desktop. It contains only the member username, original account reference, workbench session, native thread/turn, uncertainty, device environment and cwd. Transfer this JSON to an administrator-controlled file on the same VPS. Never put messages, credentials or private keys in it.
2. Enroll the original account's public identity once, explicitly confirming the account and email. Its account ID and generation are preserved for existing allocations, debts and deduplication. Example commands below use a placeholder manifest, not a real account:

   ```sh
   python3 /opt/agent-workbench/account-runtime/migrate_legacy.py enroll \
     --manifest /root/legacy-session.json --email account@example.invalid \
     --confirm-same-account
   ```

   Run the returned official `codex login` command in your administrator terminal under the dedicated native owner. The workbench never copies the old token or reads its authentication file. Repeating enrollment returns the same profile; it does not require another login for every workspace. This pinned `account/read` schema exposes email but not a stable ChatGPT account ID matching the old fingerprints. Operator confirmation of the exact account/organization is therefore required; equal email is not claimed as cryptographic identity proof.
3. Use the existing workspace management policy to grant the preserved account ID to the original member UID and enable Codex. Keep the existing weekly/five-hour allocations and account generations. Do not create a second grant or quota registry. Stop the retired workbench writers for this source session before import; do not kill unrelated clients or alter SSH access.
4. Import only the exact session's original native `sessions` and `archived_sessions` rollout files:

   ```sh
   python3 /opt/agent-workbench/account-runtime/migrate_legacy.py import \
     --manifest /root/legacy-session.json --confirm-same-account \
     --legacy-writers-stopped
   ```

   The command checks for source-profile writers, stages allowlisted regular files, verifies unchanged source bytes and asks the owner to commit. It never reads/copies `auth.json`, configuration, SQLite databases or shell snapshots. Source history remains intact. Root/child identity and paginated `history_base` dependencies are checked. A missing dependency fails without inventing replacement context. If native revert created multiple physical rollouts for one thread, `MIGRATION_ROOT_ROLLOUT_REQUIRED` requires the exact active relative path from native thread metadata via `--root-rollout sessions/.../rollout-...jsonl`; timestamps are not used to guess. Linked files, duplicate physical IDs, cycles, wrong accounts and other sessions are rejected. Interrupted or lost receipts can retry the same import; committed history is not overwritten after native continuation.
5. In the same desktop conversation, verify and adopt the member receipt. Only the original kernel UID with a current grant can resolve it. The desktop checks every saved binding, retains messages and draft, switches to the native owner and preserves uncertain turns. It does not create a new thread, replay a prompt or reuse an old H receipt. Complete the independently scoped native-owner H acceptance before actual model execution.

The new owner resumes the exact imported root path using the pinned `thread/resume` API. Its `path` parameter is unstable and version-specific; arbitrary client paths/history remain blocked. Parent/child rollouts, archived prefixes and earlier versions are copied byte-for-byte. This is not a vendor-guaranteed general cross-version export/import format.

Quota account IDs/generations and migrated numeric producer scopes remain unchanged. An already submitted, uncertain reset-card request can recover through the new owner only after `migration/account-resolve` verifies the old/new account mapping, using its original native idempotency key. No reset is performed by migration itself. New default selections do not rebind old conversations.

After deployment, verify that all workbench chat/model/quota clients use the new socket. Retire the workbench's access to the old token service only within the approved deployment scope, accounting for other clients that may still use it. Removing repository code does not stop an already running old desktop or VPS process. Rollback retains original files and stops new execution; it must not silently reactivate credential mediation or merge divergent post-migration histories.

## Reviewable deployment and rollback plan

The desktop can now prepare missing protected CLIs in the same confirmed setup. `native_install.py` reads only known executable locations during preview, including root-local and NVM locations. It distinguishes absent, private, untrusted and unsupported-version installations. It never weakens permissions on existing binaries or reads their authentication configuration. Apply downloads fixed official Codex 0.155.1 / Claude 2.1.281 release assets for a supported Linux architecture, checks the pinned SHA256 and exact size, extracts only the expected regular binary, and runs `--version` with isolated configuration locations before publishing root-owned executable files under `/opt/agent-workbench/native/`. A source receipt is retained; foreign files and symlinks are not overwritten. No shell installer or system package transaction is used. A network/checksum failure stops setup and requires a fresh preview; existing CLI installations and logins stay untouched. This is initial setup, not an automatic upgrade of an already running deployment.

`setup.py` implements a read-only preflight and explicit apply for this plan. The current work tests it locally with synthetic OS commands and performs none of these real-host changes. The desktop binds a five-minute preview to the complete SSH identity; apply repeats preflight and checks a deployment/bundle fingerprint. It installs only absent or byte-identical workbench files, creates or reuses the dedicated non-root owner, preserves private profiles, and never overwrites another deployment or systemd override. A ready service is reused. An existing unavailable service is reported for review instead of creating another registry. Unknown apply receipts require a fresh inspection before retry.

Setup reuses protected shared binaries when possible and adds reviewed installation actions for missing or unsuitable providers. It never replaces existing CLIs. The existing public workspace policy supplies the authority and generation. With only the on-demand SSH control path, the public SSH host key supplies the same deterministic authority as that control path. Setup creates no member grant or replacement policy. Users complete official login once per account from the administrator entry; workspaces receive only usage permission.

`runtime/legacy-enroll` binds that existing enrollment operation to the native authority/generation and root peer UID. The desktop rechecks the selected old account's public identity immediately before enrollment, preserving its ID/generation and requiring explicit confirmation. Both providers offer a native login command for their existing central profile. History migration remains the separate reviewed operation above.

1. Provision only the new non-root `agent-workbench-accounts` owner, private `/var/lib/agent-workbench-accounts` and its `profiles` directory (owner-only 0700), plus the chosen socket access. Install this package under root-owned `/opt/agent-workbench/account-runtime`; install the included unit with mode 0644. Keep `/etc/agent-workbench/accounts.json` and its ancestors root-controlled, with the real owner's UID, matching policy authority/generation and the approved binary paths. The unit creates its runtime directory. Do not replace existing native installations.
2. Configure the matching authority/generation and explicit `workspacePolicyFile`. Publish the current workspace UIDs and exact account grants through the independent control service. Grant socket traversal and connection only to the intended members. Preflight ancestor ownership/modes, executable trust, private modes, single-instance locking and `KillMode=control-group` before starting this service.
3. Validate administrator-only native authorization with an explicitly chosen account, ACL-filtered metadata from each UID, dynamic workspace creation, suspend/revoke denial, malformed/missing-policy denial, independent selection/CAS, cancellation, lease expiry, cleanup, restart recovery and unauthorized-peer rejection. Do not interpret catalog selection as authenticated model execution. Keep H blocked.
4. Roll back by stopping and disabling only the new service, confirming its cgroup is empty and removing only its new runtime socket/lock. Retain its private account profiles and configuration for explicit subsequent review or cleanup; do not silently delete credentials. Remove the newly introduced socket group access only when safe for these new service objects.
5. Preserve existing CLI installations, SSH configuration, credentials, member profiles, and unrelated Codex/Claude clients. Retire only the workbench's old token-service access after its explicit migrations and native acceptance pass, within the separately approved deployment scope. Account for other clients before changing any shared old broker. Rollback must not silently re-enable the retired workbench credential path.

The separate quota sidecar remains a distinct lifecycle: its existing on-demand launcher does not hot-upgrade a live older worker or install reboot supervision. This native-owner unit does not solve that sidecar's deployment lifecycle. Do not mix a second quota registry with an installed formal control service.
