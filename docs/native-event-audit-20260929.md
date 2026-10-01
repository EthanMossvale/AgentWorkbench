# Native event reception and compatibility audit

> Dated implementation and evidence record. See [status](16-implementation-status.md) and [navigation](README.md).

Date: 2026-09-29 UTC / 2026-09-30 JST. Scope: local source, native protocol reception and presentation. No remote deployment or real account task is implied.

## Interface review before implementation

The affected paths are Codex RPC and Claude stream-json reception, session observation, bounded public activities, native interaction responses, plugin activation and runtime notice rendering. No new runtime, model, permission, theme or language option is introduced.

- Invoke: `api.nativeEvents.catalog(runtime?)` and `inspect(runtime, value)` expose the audited discriminator inventory and the same production classification used by observation. Existing `state/get` returns the session's additive `nativeEventAudit` metadata ledger.
- Register: `api.nativeEvents.register({id, runtime, keys, present})` installs an exact-key host presentation adapter in the production registry. The approved plugin namespace owns the ID and cleanup. `onReceipt` observes safe metadata.
- Replace: last registered matching presentation takes precedence, with previous/core presentation restored on release, disable or failed registration. Core protocol replies, native identity, turn completion, permission decisions and hidden content are outside this presentation interface.
- UI: `native-event-notice` is a named multi-instance surface; existing surface lifecycle handles existing/later instances, asynchronous mount completion and restoration.
- Compatibility: additive session/activity fields and additive PluginApi member; no old configuration rewrite. Presenters are synchronous; promises are rejected as invalid without consuming late results. Original protocol handlers stay authoritative.

## Baselines and evidence boundaries

The installed commands were rechecked: Codex 0.155.1 and Claude Code 2.1.284. A fresh experimental Codex JSON schema was generated in an isolated native home: 82 server notifications, 11 server requests and 19 ThreadItem variants. The public Claude TypeScript reference and separately fetched publisher package declarations (Agent SDK 0.3.285) are a documented superset, not proof that every SDK event is emitted by the installed CLI or the current launch mode. No SDK implementation or authentication path is added. Only discriminator facts are used; vendor source is not copied into this repository.

The complete executable inventory is `packages/native-events/catalog.ts`; the independent versioned discriminator fixture and schema comparison gate prevent a newly audited type from disappearing silently. Coverage, verification results and remaining boundaries follow.
## Coverage classification

This audit does not establish complete feature parity with either vendor. Every discriminator in the inspected baseline has an explicit classification and reception path. Recognition and a safe diagnostic receipt are distinct from implementing the event's complete native semantics.

| Disposition | Production behavior | Capability claim |
| --- | --- | --- |
| handled | Dedicated native message, activity, metrics, interaction or lifecycle route | The named route exists; schemas, runtime modes and identity checks still constrain it |
| observed | Metadata ledger and a collapsed diagnostic projection; a presenter may extract verified public fields | No inferred authorization, history rewrite, authentication state or completion |
| private | Count and discriminator metadata only; no compatibility payload or hidden text is persisted | Deliberate exclusion of reasoning/signatures, verification and memory bodies |
| unsupported | Visible receipt; control requests use existing explicit rejection or gated stop behavior | No invented support for unlaunched modes, credential ownership or legacy APIs |
| unknown / malformed | Visible compatibility notice and bounded diagnostics | Never interpreted as permission, successful outcome, execution or automatic retry |

### Complete inspected discriminator inventory

The checked baseline contains 82 Codex notifications, 11 requests and 19 items; 12 Claude conversation envelopes and 37 system subtypes from the installed 2.1.284 native schema. The SDK 0.3.285 exported SDKMessage subset remains separately checked (11 envelopes, 28 systems); it omitted command_lifecycle and nine native system subtypes. Control envelopes and legacy additions are listed explicitly below. No vendor implementation is copied.

#### Codex

- **notification / handled (34)**: `error`, `thread/started`, `thread/name/updated`, `thread/tokenUsage/updated`, `turn/started`, `turn/completed`, `turn/plan/updated`, `hook/started`, `hook/completed`, `item/started`, `item/completed`, `item/agentMessage/delta`, `item/plan/delta`, `item/commandExecution/outputDelta`, `item/commandExecution/terminalInteraction`, `item/fileChange/outputDelta`, `item/fileChange/patchUpdated`, `serverRequest/resolved`, `item/mcpToolCall/progress`, `thread/compacted`, `model/rerouted`, `model/safetyBuffering/updated`, `account/rateLimits/updated`, `warning`, `guardianWarning`, `deprecationNotice`, `configWarning`, `mcpServer/startupStatus/updated`, `item/autoApprovalReview/started`, `item/autoApprovalReview/completed`, `autoApprovalReview/strictReviewRequired`, `remoteControl/status/changed`, `item/updated`, `workbench/bridgeReady`.

- **notification / observed (26)**: `thread/status/changed`, `thread/archived`, `thread/deleted`, `thread/unarchived`, `thread/closed`, `thread/reverted`, `skills/changed`, `thread/attachment/updated`, `thread/goal/updated`, `thread/goal/cleared`, `thread/queue/changed`, `project/changed`, `thread/project/updated`, `thread/environment/connected`, `thread/environment/disconnected`, `thread/settings/updated`, `turn/diff/updated`, `mcpServer/oauthLogin/completed`, `mcpServer/event/stream/notification`, `account/updated`, `app/list/updated`, `modelProvider/authRecoveryStarted`, `modelProvider/authRecoveryCompleted`, `windows/worldWritableWarning`, `windowsSandbox/setupCompleted`, `account/login/completed`.

- **notification / private (5)**: `item/reasoning/summaryTextDelta`, `item/reasoning/summaryPartAdded`, `item/reasoning/textDelta`, `model/verification`, `turn/moderationMetadata`.

- **notification / unsupported (19)**: `command/exec/outputDelta`, `process/outputDelta`, `process/exited`, `externalAgentConfig/import/progress`, `externalAgentConfig/import/completed`, `fs/changed`, `fuzzyFileSearch/sessionUpdated`, `fuzzyFileSearch/sessionCompleted`, `thread/realtime/started`, `thread/realtime/itemAdded`, `thread/realtime/item/started`, `thread/realtime/item/transcript/delta`, `thread/realtime/item/completed`, `thread/realtime/transcript/delta`, `thread/realtime/transcript/done`, `thread/realtime/outputAudio/delta`, `thread/realtime/sdp`, `thread/realtime/error`, `thread/realtime/closed`.

- **request / handled (7)**: `item/commandExecution/requestApproval`, `item/fileChange/requestApproval`, `item/tool/requestUserInput`, `mcpServer/elicitation/request`, `item/permissions/requestApproval`, `item/tool/call`, `currentTime/read`.

- **request / unsupported (4)**: `account/chatgptAuthTokens/refresh`, `attestation/generate`, `applyPatchApproval`, `execCommandApproval`.

- **item / handled (19)**: `userMessage`, `hookPrompt`, `agentMessage`, `functionCallOutput`, `plan`, `reasoning`, `commandExecution`, `fileChange`, `mcpToolCall`, `dynamicToolCall`, `collabAgentToolCall`, `subAgentActivity`, `webSearch`, `imageView`, `sleep`, `imageGeneration`, `enteredReviewMode`, `exitedReviewMode`, `contextCompaction`.

- **content / handled (4)**: `text`, `inputText`, `skill`, `mention`.

- **content / observed (8)**: `image`, `localImage`, `inputImage`, `audio`, `localAudio`, `inputAudio`, `resource`, `resource_link`.

- **rpc / handled (2)**: `result`, `error`.

#### Claude Code

- **message / handled (14)**: `assistant`, `user`, `result`, `stream_event`, `system`, `tool_progress`, `tool_use_summary`, `rate_limit_event`, `control_response`, `control_cancel_request`, `control_request`, `keep_alive`, `command_lifecycle`, `conversation_reset`.

- **message / observed (3)**: `auth_status`, `prompt_suggestion`, `active_goal`.

- **system / handled (33)**: `init`, `status`, `compact_boundary`, `api_retry`, `hook_started`, `hook_progress`, `hook_response`, `informational`, `task_started`, `task_progress`, `task_notification`, `task_updated`, `notification`, `permission_denied`, `local_command_output`, `plugin_install`, `control_request_progress`, `model_refusal_fallback`, `model_refusal_no_fallback`, `worker_shutting_down`, `background_tasks_changed`, `session_state_changed`, `commands_changed`, `files_persisted`, `elicitation_complete`, `mirror_error`, `code_change_published`, `vcs_state_changed`, `feedback_draft_queued`, `dev_intent`, `turn_preempted`, `peer_message_hold`, `per_turn_effort_changed`.

- **system / observed (1)**: `thinking_tokens`.

- **system / unsupported (2)**: `cloud_session_delta`, `turn_handoff_available`.

- **system / private (1)**: `memory_recall`.

- **stream / handled (8)**: `message_start`, `message_delta`, `message_stop`, `content_block_start`, `content_block_delta`, `content_block_stop`, `ping`, `error`.

- **content / handled (3)**: `text`, `tool_use`, `tool_result`.

- **content / private (2)**: `thinking`, `redacted_thinking`.

- **content / observed (11)**: `image`, `document`, `search_result`, `server_tool_use`, `web_search_tool_result`, `web_fetch_tool_result`, `code_execution_tool_result`, `bash_code_execution_tool_result`, `text_editor_code_execution_tool_result`, `tool_search_tool_result`, `container_upload`.

- **delta / handled (2)**: `text_delta`, `input_json_delta`.

- **delta / private (2)**: `thinking_delta`, `signature_delta`.

- **delta / observed (1)**: `citations_delta`.

- **result / handled (5)**: `success`, `error_during_execution`, `error_max_turns`, `error_max_budget_usd`, `error_max_structured_output_retries`.

- **system-status / handled (2)**: `compacting`, `requesting`.

- **control / handled (2)**: `can_use_tool`, `elicitation`.

- **control / unsupported (3)**: `hook_callback`, `mcp_message`, `request_user_dialog`.

### Reception and processing routes

1. The transport decodes bounded JSON frames and freezes the received value. Invalid JSON/non-object frames use the existing transport fault and uncertain-session path; they cannot be classified as a native event or successful result.
2. Codex RPC correlates responses, separates known child threads and emits normalized events. Claude local provider reception validates root/child identity, emits the event and processes typed text, control and terminal forms. The separate Claude SSH research adapter keeps its unverified host-control gate.
3. WorkbenchController.observeNativeSession supplies PluginRegistry.nativeEvents to attachNativeObservation. The monitor inspects root and explicit child events before the public-message filter; Codex raw RPC responses are counted without copying values. A foreign identity does not become a parent activity. Completed foreign image-generation events retain the existing image sink's explicit ownership rejection before any write or acknowledgement.
4. Public core handlers keep their existing interpretation. RuntimeActivity.protocol carries compatibility notices to RuntimeTimeline and the named native-event-notice surface. Session.nativeEventAudit survives activity pruning and restart.
5. The registry's typed host API is the same production instance used by this route. Approved plugins can register exact-key display adapters and receipt subscribers; core approvals, outcome and identity decisions are not replaced through a display adapter.

### Gaps repaired in this change

- Unknown nonpublic notifications and child events previously disappeared from the visible activity path. They now produce compatibility receipts without promoting the original payload to chat text.
- Added public processing for Codex fileChange/patchUpdated, warning/config/deprecation/guardian notifications, MCP startup state and approval-review progress; Claude notification, denial, slash-command output, plugin-install progress, control progress, refusal notices and known background-task updates.
- A terminal result closes orphaned progress as uncertain when no matching completion exists. Claude status/compacting and compact_boundary, and Codex contextCompaction items/thread/compacted, remain distinct start/end signals; a missing start or end is not fabricated.
- Unknown Claude result subtypes or missing boolean is_error no longer appear successful. Codex unknown turn/item outcomes and unfamiliar hook/MCP/plugin/review status values remain errors or uncertain. New nested discriminator values also get compatibility receipts.
- Unbound Codex requests receive a typed error. Both local provider routers explicitly reject unknown control requests without approval, tool execution, extra prompt or retry. The gated Claude SSH adapter records the request then stops without approval.

## Known-event and presentation corrections (2026-09-30)

- command_lifecycle records the matched prompt's queued/started/completed/cancelled/discarded/refused state. It does not stand in for a result and never causes a resend. requesting has its own progress lifecycle; compact_result success/failed settles compaction explicitly.
- background_tasks_changed replaces the complete task level; ambient tasks do not count as work. Empty snapshots may arrive before terminal edges: process cleanup waits for native idle or explicit terminal child evidence. Foreground Agent results and typed TaskStop target receipts settle children; late progress/start cannot reopen their terminal identity. An absent background child can stop showing as active while its result remains unconfirmed. Shell/watchers are not fabricated as child agents.
- commands_changed replaces typed command metadata; session state and per-turn effort transport state are recorded independently from user preferences. conversation_reset clears active context/plan metadata, preserving the workbench history. Known files, elicitation, worker, forge/VCS, feedback, peer-hold and development-type notifications receive specific safe projections, with unsupported cloud capabilities explicitly distinguished.
- Routine startup, MCP, configuration and protocol diagnostics share a collapsed group. Unknown notifications stay discoverable by discriminator, count and copyable diagnostic metadata; they do not imply active background work. Already-known historical receipts are reclassified without replaying missing bodies or claiming historical success.
- Both root and child readers group adjacent successful tools/commands/edits using the same production registry. Text, approvals, failure/running/uncertain activity and runtime/child/turn boundaries remain separate. Every record is accessible on expansion. Diagnostic grouping retains its own chronology.
- A completed process is collapsed even when it contains reviewable diagnostics. Its timer remains in the same summary after background stop. Stopping an owned background process does not rewrite an already completed root result; known per-turn timing wins over later legacy global stop flags.
- The concrete native.event-semantics service supports invoke/intercept/override of the parsers actually used by observation and child tracking. Renderer api.activities supports invoke/register/subscribe, named activity-group replacement, multi-plugin fallback and disable restoration. Contracts and migration details are in document 36.

## Future events and bounded diagnostics

Unknown notifications continue alongside known processing. A new type, system subtype, content block, stream/delta kind or inspected status value is visible even when its envelope is already known. Additive unknown fields on a known schema are preserved only in the transient native frame; they are not recursively dumped or claimed to be semantically understood. A known-envelope shape change can still require a dedicated adapter update; the classifier is not a full JSON Schema validator.

Receipts group by runtime, child and discriminator, keeping count, first/last time, sequence, byte length and digest. No unknown body, raw wire, hidden thinking, auth payload or error stack is persisted by this ledger. At most 256 receipt groups are retained. Above that bound counters and an overflow notice remain visible; neither memory growth nor silent disappearance is allowed. Nested content inspection has a 256-block total budget and depth bound; inspection/truncated explicitly records an exceeded limit. State writes coalesce over 100 ms and drain on flush, disconnect and disposal.

An unknown terminal variant fails closed as uncertain and stops the affected native processing path; it never becomes successful completion. Control handling remains runtime-specific: unsupported requests receive the existing protocol error, or the unverified SSH adapter stops. Claude request_user_dialog is not advertised by this launcher; the native declaration says unsupported dialog kinds are not settled by an error response and retain their native deadline. The workbench never sends a synthetic cancel/approval or claims to have answered such a dialog.

Plugin registration is exact-key, namespaced, approved and revocable. Last matching registration wins on each event; invalid output, exceptions and asynchronous results fall back to the preceding adapter or core. Disable/uninstall clears custom text from current observation and restores the core notice. Reenable applies to subsequent frames; history is not replayed and raw frames are not retained for recomputation. Restart removes historical custom presentation while retaining receipt metadata. Private and already-handled events do not enter presentation adapters.

### Upgrade procedure

- Regenerate Codex experimental JSON schemas in an isolated native home and fetch the publisher's Claude declaration package without installing it into the product.
- Run node scripts/check-native-events.mjs with --codex-schema, --claude-types and --claude-inventory. A changed discriminator set fails with NATIVE_EVENT_BASELINE_REVIEW_REQUIRED; review changes before updating the factual fixture.
- For each new type, verify its native scope, payload, control response, terminal semantics and opt-in conditions. Add a dedicated handler or an explicit observed/private/unsupported route and tests. Do not turn a catalog entry into proof of complete feature support.
- Update the public plugin contract and evidence record, run plugin/docs/type gates and affected protocol/lifecycle/UI tests. The offline catalog gate also runs under check:plugins. Runtime unknown-event fallback operates independently of this development-time upgrade check.

## Remaining boundaries

- Advanced MCP elicitation schemas and permission grants with unimplemented entries/globs still use explicit unsupported behavior. Existing typed question/permission handlers do not establish arbitrary-schema coverage.
- External authentication-token refresh, attestation and legacy v1 approval requests are not owned by a workbench session. No credential payload is surfaced or automatically answered.
- Realtime audio/SDP, standalone exec/process streams, filesystem subscriptions, fuzzy-search streams and import modes are not started by the ordinary conversation launcher. Their catalog entries are receipts, not implementations of these modes.
- Claude auth status and prompt suggestions retain metadata-only behavior. Cloud session delta and cloud handoff capability are explicitly unsupported by this launcher. Known reset, command, background-task and session-state events now have dedicated handling. Forge/VCS announcements are unverified hints, never authorization to make credentialed requests.
- Hidden reasoning and native memory content remain excluded. A private event's occurrence can be counted without exposing its body.
- Claude SSH host-control / cross-OS execution H acceptance remains unverified. This change does not remove that gate. No VPS deployment, real-account model task, paid provider request or active-client operation was performed.
- Future events are safely observable within the documented bounds; their intended semantics still require a reviewed adapter. Neither vendor documentation nor a package superset guarantees which events a particular installed CLI emits.

## Verification

| Layer | Evidence and result |
| --- | --- |
| Current discriminator comparison | Fresh Codex 0.155.1 schema, Claude Agent SDK 0.3.285 exported declarations and installed Claude 2.1.284 native wire inventory match their separate versioned fixtures |
| Core and native route regressions | New catalog/monitor tests and synthetic ProcessSupervisor through NativeProviderRunner cover unknown root/child/control/content/status/result, identity rejection, metadata privacy, receipt bounds and presenter failures |
| Full isolated candidate suite | 1,353 tests passed, 0 failed, 0 skipped; candidate includes committed peer work but excludes their unstaged document reordering |
| Plugin lifecycle and renderer | 12 hidden isolated Electron checks passed through imported, explicitly approved synthetic ZIPs and the production controller/observer; no test packages installed into the real user profile |
| Installed native lifecycle | 4/4: both native binaries, temporary homes and a synthetic loopback upstream; parent followup while child runs, terminal drain and explicit background stop preserve root result/timer |
| Visual review | Light notice, dark 860 px notice and both grouped tool readers inspected; default collapsed process, stable timer and viewport bounds checked |
| Required gates | Typecheck, check:plugins and check:docs passed; catalog check integrated into plugin gate; additive declarations and named surface snapshot reviewed |

The full-suite native skill fixture required its existing AGENT_WORKBENCH_TEST_CODEX_EXECUTABLE override to point at the discovered installed binary because its old npm fallback path was absent. All native-home writes remained in temporary fixture directories. Initial regressions were corrected: malformed legacy Claude result fixtures now include native result fields, and foreign generated-image events retain explicit ownership failure. The plugin snapshot was deliberately refreshed after compatibility review, not used to conceal a behavior failure.

Tests: tests/native-event-semantics.test.ts, tests/native-events.test.ts, tests/native-event-routing.test.ts, tests/native-collaboration.test.ts, tests/generated-images.test.ts, tests/runtime-reading.test.ts, scripts/test-native-background.mjs and scripts/test-native-events-ui.mjs. Reports and synthetic screenshots are in ignored local QA output. Public documentation contains neither personal native paths nor user conversation/credential data. No push or deployment is implied.
