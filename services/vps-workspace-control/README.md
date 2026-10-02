# VPS workspace control service

This directory contains independent workspace management and quota accounting components. The quota sidecar has **not been deployed to the real VPS**. Repository builds and local tests do not change existing applications, brokers, credentials, SSH configuration or running tasks. Native execution eligibility remains separately verified per connection. All VPS source, comments, fixed errors and logs are English/ASCII; desktop labels are localized on the desktop.

The service runs as root, but the management socket is fixed at `/run/agent-workbench-control/control.sock`, mode `0600`, inside a root-owned private directory. Every management request independently checks the actual Linux `SO_PEERCRED` UID and accepts only UID `0`. Renderer roles, host IDs and JSON fields cannot grant administrative authority. The separate enrollment HTTP handler has no management endpoints; it accepts only a previously issued invitation token and a device public key.

## Deployment configuration

The service requires a root-owned, non-group/other-writable configuration and trusted ancestors. Example public configuration:

```json
{
  "authorityId": "your-account-authority",
  "generation": "your-deployment-generation",
  "root": "/var/lib/agent-workbench-control",
  "workspacePolicyFile": "/var/lib/agent-workbench-control-policy/workspaces.json",
  "connection": {
    "hostname": "your-approved-server.example",
    "port": 22,
    "hostPublicKeys": ["ssh-ed25519 APPROVED_HOST_PUBLIC_KEY_BASE64"]
  },
  "enrollmentUrl": "https://your-approved-server.example/v1/enroll",
  "enrollmentPort": 8788
}
```

The placeholder host key above must be replaced with an explicitly verified **public** host key. No private key, password, provider token or authentication file belongs in this configuration. Authority and generation must match the separately configured shared account broker. The service never imports an old application's account database or guesses a mapping from usernames.

Pre-provision the private state directory and runtime directory as root-owned `0700`. Provision the distinct policy directory as root-owned `0755`; the published metadata-only policy is root-owned `0644`, with no writable-by-members ancestor. `state.json` is private `0600` and contains the registry, operation journal and invitation hashes. Only public account identifiers, not account credentials, are published in the policy. A service unit must use trusted root-owned source files, an isolated Python import path, a private umask, one instance, a bounded stop timeout and `KillMode=control-group`. No service unit is installed automatically.

The HTTP server binds **only** to `127.0.0.1:<enrollmentPort>`. A separately reviewed TLS reverse proxy must expose exactly `/v1/enroll`; direct public HTTP is unsupported. The advertised URL must be HTTPS and must not contain user information, query parameters or fragments. Desktop clients must require HTTPS, reject redirects or destination changes, and validate the returned authority, workspace generation, SSH endpoint and host public keys against the imported invitation. The current work does not install TLS, change a firewall or publish a network endpoint.

## Management protocol

One bounded JSON line per Unix connection:

```json
{"protocol":1,"method":"workspace/list","params":{}}
```

Responses are `{ "ok": true, "value": ... }` or `{ "ok": false, "error": "FIXED_CODE" }`. Raw exceptions and arbitrary command output are never reflected. Management requests are limited to 64 KiB, enrollment requests to 8 KiB, and private persisted metadata to 4 MiB. Root management and HTTP enrollment have separate concurrency bounds.

Methods:

- `workspace/list`, parameters `{}`: returns `{authorityId,generation,revision,workspaces,connection,enrollmentUrl,sshOnlyMembers}`. Reserved SSH-only identities are public metadata, never workspace candidates.
- `workspace/plan`, parameters `{authorityId,generation,expectedRevision,operation,workspaceId?,values?}`: returns `{planId,planHash,operation,workspaceId,expectedRevision,expiresAt,effects,deletion?}`. Deletion binds the standard home, UID/GID, root and home inode/device; its public preview includes allocated storage bytes. New/adopted spaces receive their new workspace ID at planning time.
- `workspace/apply`, parameters `{authorityId,generation,planId,planHash}`: returns `{operationId,state,revision,workspace?,invite?,effects,error?}`. `operationId` is exactly `planId`; state is `applied`, `failed` or `uncertain`.
- `workspace/operation`, parameters `{authorityId,generation,operationId}`: returns the journaled outcome. It never repeats execution or returns an invitation secret.

Every plan expires after five minutes. Its hash covers authority, generation, operation, normalized values, expected global revision, target, expiry and observed system identity/path metadata. Apply rechecks all fences. The consumed plan and an `uncertain` operation record are durably saved **before** any external side effect. Reusing apply returns `PLAN_ALREADY_USED`; after a disconnect, query the operation instead of resending apply. Missing state does not imply that a system user is absent or safe to recreate.

Public workspace fields:

```text
id, generation, revision, name, uid, username, root,
environment: {runtimes: ("codex" | "claude")[], defaultDirectory, env},
allowedAccountIds: string[],
accountQuotas: {[accountId]: {weeklyPercent:number|null, fiveHourPercent:number|null, allowOverage:boolean}},
budget?: legacy metadata only,
nativeQuota: "unknown",
status: "active" | "suspended" | "deleted",
controlState: "ready" | "recovery-required",
devices: [{id,label,fingerprint,publicKey,createdAt,status:"active"|"revoked"}],
invites: [{id,label,expiresAt,status:"active"|"redeemed"|"revoked"|"expired"}],
createdAt, updatedAt
```

`controlState` identifies a management operation with unconfirmed side effects. A persistent policy fence keeps that workspace disabled in subsequent policy publication, including service restart, until a fresh explicit management plan resolves it. If the initial restrictive policy write fails, no system action begins and the operation reports failure; the previously published policy is not falsely described as revoked. The service does not silently accept/replay uncertain operations.

Operation values are exact; additional fields are rejected:

| Operation | Values |
| --- | --- |
| `workspace/adopt` | `{name,username,uid,root,environment,allowedAccountIds,accountQuotas?}` |
| `workspace/create` | `{name,username,root,environment,allowedAccountIds,accountQuotas?}` |
| `workspace/update` | Nonempty subset of `{name,environment,allowedAccountIds,accountQuotas}` |
| `workspace/suspend` | `{}` means suspend; `{suspended:true}` suspends; `{suspended:false}` resumes |
| `workspace/delete` | `{}` |
| `device/revoke` | `{deviceId}` |
| `invite/create` | `{label,ttlSeconds}`; integer 60-604800 seconds; desktop offers 1h (default), 6h, 12h, 1day and 7day, timed by this server |
| `invite/revoke` | `{inviteId}` |

Names/labels are bounded public text. Usernames use a restricted Linux username grammar. The environment allows only `LANG`, `LC_ALL`, `TZ`, `TERM` and `COLORTERM`; it does not accept `PATH`, `HOME`, loader injection or provider credentials. Runtime choices and default directory are **policy metadata**, not an assertion that a CLI has been installed or that a native process has adopted the values. Account quotas use independent weekly and supported five-hour percentages, from 0 to 100 with at most two decimals. Null means unallocated; zero is a zero allocation. Missing allowOverage defaults to true. Non-deleted reservations cannot total more than 100 per account/window; suspension retains reservations. Old budget objects remain accepted as historical metadata but are neither displayed nor converted into percentages. Unknown native data remains unknown.

## Controlled Linux effects

`provisioner.py` defines the independently reviewable adapter (`observe`, `create`, `adopt`, `add_key`, `revoke_key`, `deletion_plan`, `destroy`). Tests inject a fixture adapter. The production adapter uses Python filesystem operations and fixed argument arrays for root-controlled system tools; it never uses a shell, `sudo`, client-supplied commands, a package manager or a runtime installer. Explicit deletion delegates to `destruction.py` and is intentionally destructive.

Adopt requires an existing non-system UID, matching username and an existing directory owned by that UID. It creates only registry/policy records. It preserves the user, UID, HOME, files, original runtime profiles and existing SSH authorizations. An already managed UID/username is not duplicated. Explicit create permits `/home/<username>` or `/home/<username>/workspaces`; HOME stays `/home/<username>`, and the optional `workspaces` directory is created through directory descriptors with no symlink traversal and assigned to the new UID/GID. Existing users or preexisting HOME paths require explicit adoption instead. A partial create is uncertain and is never automatically retried, renamed, removed or recreated.

Device enrollment appends one independently generated `ssh-ed25519` public key. Its exact managed line contains workspace ID, workspace generation and device ID. Revoke removes only that exact line. Existing comments, other keys, options and other device lines are retained. The code verifies directory descriptors, rejects symlinks/nonregular/hardlinked key files, bounds reads, detects file replacement before an atomic update, and never follows a member-provided private-key path. Existing `.ssh` must already be private; the service refuses unsafe paths instead of normalizing unrelated permissions. Concurrent external edits of the same `authorized_keys` are unsupported; detectable conflicts fail rather than merge silently.

Suspension revokes this service's active device lines and unused invitations and disables shared-account authorization; it preserves the OS user, files and established SSH sessions. Resume does not restore old device grants or invitations.

**Deletion now removes the OS user and the entire verified `/home/<username>`, including all SSH authorizations in that home.** The workspace root must be that home or its `workspaces` child. Plans reject system users, mismatched identities, symlink homes, unsafe parents, mounts including same-device bind mounts, and reserved SSH-only names. Apply first persists a one-use operation fence and restrictive account policy, expires/locks the account, terminates its user sessions and exact-UID processes using pidfds, revalidates the target, moves the home into a root-only holding directory, invokes `userdel` for identity bookkeeping, then removes the staged tree with symlink-safe `rmtree`. Other homes, shared CLI/authentication stores and files outside the home are not recursively removed. Any unconfirmed side effect stays fenced and requires inspection; it is never reported as successful or automatically replayed. Apply transport permits fifteen minutes for larger homes while ordinary reads remain bounded.

The desktop requires an exact username confirmation and rejects old record-only delete plans. Only a `deletion: {kind: "purged", home, storageBytes}` receipt completes deletion. Recreating a purged workspace uses create, empty files/grants and new device keys; local history and user-selected private-key files remain. Discovered but unmanaged users can be destroyed through the same observed plan without temporarily granting access. The service does not claim hostile-tenant isolation or removal of arbitrary data outside a user's home.

The one-time legacy exception is a root-owned metadata registry at `/var/lib/agent-workbench-policy/ssh-only-members.json`. Its names cannot be created, adopted or destroyed by the workspace service. On the user's explicitly authorized VPS, the three legacy homes were removed after moving exact public authorization bytes to `/etc/ssh/authorized_keys.d/<username>`. A narrowly matched include at the end of `sshd_config` selects these absolute paths; root's effective settings are unchanged. Existing usernames/UIDs and client keys remain for sing-box. This is an operator-approved migration, not an automatic SSH configuration side effect of workspace management. Root and PC1 original-key logins and PC1 TCP forwarding were verified; the other device logins were not available locally. Shared provider installation/authentication was not deployed or modified by this cleanup.

Account policy output is:

```json
{"schemaVersion":1,"authorityId":"...","generation":"...","revision":0,"workspaces":[{"workspaceId":"...","uid":1000,"enabled":true,"allowedAccountIds":["account-id"]}]}
```

Management first publishes a restrictive policy for the affected workspace, commits the requested registry state, and only then publishes the final policy. Partial completion preserves a durable restriction fence. The account broker independently validates this root-owned policy and uses actual peer UID mapping; it does not trust a renderer's requested workspace. These permissions do not supply runtime tokens or implement authenticated model execution.

## Invitation import and recovery

Successful `invite/create` apply returns the secret exactly once, in this descriptor:

```text
{schema:"agent-workbench-invite",version:1,inviteId,token,expiresAt,
 authorityId,generation,workspaceId,workspaceGeneration,workspaceName,
 username,root,connection:{hostname,port,hostPublicKeys},enrollmentUrl}
```

The token contains a random 256-bit secret. Only its SHA-256 hash is persisted server-side. The exported file contains public connection information plus the one-time invitation capability, **never an administrator private key, member private key or provider token**. Treat the invitation file as sensitive until redeemed or revoked.

The target desktop generates and retains its own Ed25519 key locally, then posts `{token,publicKey,deviceLabel}` over HTTPS. Success is a raw descriptor, not the Unix protocol envelope:

```text
{schema:"agent-workbench-device",version:1,authorityId,generation,workspaceId,
 workspaceGeneration,workspaceName,username,root,deviceId,fingerprint,
 connection:{hostname,port,hostPublicKeys}}
```

Errors are `{error:"FIXED_CODE"}`. The service does not accept a supplied UID, role, endpoint, private key or account policy in enrollment. A redeemed token can return its original public receipt for the **same** public key and active device/workspace; it cannot enroll a second device or substitute another key. This allows the desktop to recover a lost HTTP response by retaining its original local key. Revoked devices, suspended/deleted workspaces and old workspace generations remain denied. Expiry stops first-time redemption, not recovery of an already active matching grant.

Before appending a key, the service durably consumes the token and records a pending device. Failure attempts to remove only that exact new line. Startup recovery repeats this exact-key cleanup for interrupted enrollments; it does not silently reuse the invitation or substitute another key. Unconfirmed failures may require an administrator to issue a new invitation. No private key is generated on the VPS or returned by this service.

## Deployment and rollback review

1. Review the new service, root-controlled installation paths, separate private state/public policy directories, verified public SSH host keys and HTTPS proxy. Take a public configuration/state baseline without reading authentication files. Do not modify existing SSH/CLI/broker installations as an implicit part of installing this service.
2. Configure matching authority/generation in this control service and the separately installed account broker; explicitly point the broker at the new policy file. Start only this new service. Validate root-only access, private directory/socket modes, fixed command paths and single-instance locking before exposing enrollment through the reviewed TLS endpoint.
3. Read-only discover and explicitly adopt existing spaces first. Validate plan/apply recovery, member denial, per-device grant/revoke, legacy-key preservation, policy failures, suspension/resume, token expiry, same-key response recovery and generation fences with disposable fixtures before any real account changes. Real Linux/SSH/TLS integration and live acceptance are still pending.
4. To roll back, stop/disable only the new service and TLS route, retain its state/journal for inspection, and revoke only its documented newly added device lines if separately authorized. Stopping a service alone does **not** remove registered SSH keys. Keep a tested original administrator login path. Do not delete OS users, HOME directories, old SSH authorizations, native credentials or unrelated services.
5. Native Codex quota/reset metadata and the estimated ledger below are implemented separately. All-client hard enforcement, termination of existing tasks on revoke, and automatic CLI installation remain absent. A runtime checkbox does not install/copy a CLI or establish authenticated execution eligibility; new members are not automatically added to the old broker. Claude account sharing is not implemented. No fixture result substitutes for real provider or deployment acceptance.

Local checks are run with `npx tsx --test tests/workspace-control.test.ts`. They use temporary synthetic metadata/key files, a fixture provisioner and an ephemeral loopback HTTP server. They do not invoke a real system user mutation, connect to a VPS, consume a provider quota or inspect an image.


## Shared quota ledger over member SSH

The on-demand SSH authority publishes accountQuotas in its root-owned public policy. Confirming an allocation plan installs this workbench's private numeric-ledger component; the preview declares this effect. Once configured, an administrator refresh can revive it after a VPS restart. An uninitialized read creates no service/state.

- Runtime: `/var/lib/agent-workbench-ssh-control/quota-runtime/`, root-owned and private.
- Configuration: `/var/lib/agent-workbench-ssh-control/quota-service.json`, root-owned and private.
- State: quotaLedger in the existing private state.json; the sidecar and SSH management share control.lock.
- Socket: `/var/lib/agent-workbench-policy/quota.sock`, root-owned 0666 within a root-owned non-writable-by-members directory. Every request is bound to kernel SO_PEERCRED. Socket access alone is not authorization.
- No new TCP listener, network port, system package, broker replacement, SSH change or automatic systemd installation.

Members need only their own SSH key. The socket accepts quota/context, quota/read, quota/check and bounded numeric quota/observe. It binds the UID to an active workspace, checks account permission and namespaces cumulative scopes. It rejects management methods and workspace impersonation. User-provided names/native data remain original data, not fixed messages.

Member quota percentages/reset clocks are discarded. On refresh:true, the trusted quota_native.py helper drops to the member UID and uses the existing native account-usage reader, checking account/generation and current selection. Credentials remain remote; only numeric windows/public metadata return. Without refresh, supplied windows are discarded. Root administrative reads can submit their verified usage result directly.

Desktop preflight runs before turn/start. Numeric root-thread notifications are accumulated, with completion/stop/disconnect settlement. Denial or cancellation during preflight never submits a model turn. Finish records are saved before transmission. Restart retries preserve the same cumulative scope and omit stale snapshots. Duplicate/rewound counters do not charge twice. Missing shared-account binding fails closed. Legacy unconfigured spaces remain usable; configured spaces do not silently become unlimited if the socket is down.

## Allocation, loans and estimates

Each account generation/window has a separate ledger. Joining midway distributes only the observed remainder; prior consumption stays unassigned. Percentage edits apply on the next proven refresh of an observed window; overage changes immediately. Known concurrent producers settle together by observed token proportions. Expired leases or missing coverage create unassigned consumption.

Use own balance, then borrow from active spaces in descending remaining-balance order (stable ID tie order), then use unallocated reserve. Every debt retains the original lender. The next proven refresh repays that lender from the borrower's new share; unpaid debt carries forward. Accounts, generations and windows never net against each other. Removed rights or deleted identities do not erase debt history. Disabling overage never invents an authorized loan; observed excess remains an overrun and later turns check balances.

After at least two percentage points of aligned samples, estimated full-window tokens equal sample tokens times 100 divided by quota increase. This is not an official fixed exchange rate. Model mix, delayed reports, unobserved clients and independently reported child usage affect the estimate. Coverage is workbench-observed. This is next-turn gating, not atomic provider-side reservation or bypass-proof all-client billing; an in-flight turn can overshoot.

## Lifecycle and validation

A responsive existing quota socket is reused. Automatic source hot-upgrade and supervised reboot startup are not implemented; upgrade requires a reviewed restart of this component. An existing formal management socket stays authoritative. That deployment must integrate a matching member quota endpoint; the fallback never installs a second registry beside it.

On 2026-09-26, the production build, 365 full-suite unit/protocol tests, 16 isolated Electron administration checks and five actual local Linux Unix-socket checks passed. Linux tests use two kernel peer UIDs and a synthetic native reader: authorization, impersonation rejection, replacement of client figures, shared deduplication and original-creditor repayment. They add no users and access no real credentials/models/VPS. Evidence: build/qa/quota-full-tests.log, quota-allocation-20260926/report.json, quota-socket-report.json. Current UI acceptance is scripts/test-administration-ui.mjs; older studio UI scripts target the retired layout and are not passing evidence for this version.

History recovery revision (2026-10-02): quota/observe accepts bounded history entries with scope, tokens, baselineTokens and resetsAt. The member socket namespaces history scopes identically to live scopes using the authenticated workspace UID. History is never added to live pending token weights. Current-week pre-baseline tokens use later aligned sample calibration only as an estimate, capped by baseline provider use; no samples means unknown percentage. Entitlements no longer shrink pro rata for unknown account use; admission independently rejects an exhausted provider window. Existing proportional baseline credits migrate once, while irrecoverable later unknown deductions retain their historical evidence. Updating source does not hot-reload an already-running quota service; deployment/restart must use authorized maintenance.
