# Native runtime reading and background work audit

> 功能与验证专题；事实仅适用于正文注明的版本、日期与验证层级。当前综合状态见 [文档 16](16-implementation-status.md)。 [文档导航](README.md)

Date: 2026-09-27 UTC (2026-09-28 JST). Scope: the local workbench source. This is not a VPS deployment or a paid-upstream acceptance report.

## Primary sources and observed versions

- OpenAI app-server documentation: https://developers.openai.com/codex/app-server
- Locally generated Codex 0.155.1 JSON schemas: `build/qa/native-provider/schema/codex_app_server_protocol.v2.schemas.json`. The schema, not names guessed from desktop screenshots, defines the supported event fields.
- Anthropic public stream/message types: https://platform.claude.com/docs/en/agent-sdk/typescript
- Anthropic foreground/background semantics: https://code.claude.com/docs/en/sub-agents

These official pages were fetched directly over HTTPS into the ignored `build/qa/runtime-reading` folder. No reference-project implementation code or dependency was copied. Public SDK message descriptions were cross-checked with installed CLI stdio; the workbench did not introduce SDK authentication.

The explicit executable paths used for this task resolve to Codex **0.155.1** and Claude Code **2.1.283**. A separately installed Codex version mentioned in the interaction audit is not the desktop-bundled executable used here. Public documentation may describe newer events; protocol fixtures and actual CLI evidence remain separate.

## Event coverage

| Public runtime information | Integration and boundary |
| --- | --- |
| Codex userMessage, agentMessage, plan | Existing native message/plan paths; authoritative completed text replaces deltas. Completed user turns now have a collapsible reading group. |
| Codex commandExecution, fileChange | Existing bounded inputs, output deltas, exit code, elapsed time, file changes and turn association; native read/search/list commandActions get a read label. |
| Codex mcpToolCall, dynamicToolCall, functionCallOutput | Existing tools plus standalone public outputs; MCP progress and terminalInteraction attach to the existing tool row. Image/opaque output payloads are not serialized into text. |
| Codex webSearch, imageView, imageGeneration | Dedicated search/view/generation labels. Public path, revised prompt and failure fields are available in details; base64 image data is not stored as a log string. This does not add upstream support for hosted tools on incompatible protocols. |
| Codex reasoning | Lifecycle indicator only. Reasoning content, summaries and signatures do not enter message text or translation. |
| Codex contextCompaction and legacy thread/compacted | Compression progress/completion. Thresholds and compaction execution remain native runtime responsibilities. |
| Codex sleep, enteredReviewMode, exitedReviewMode | Wait/review lifecycle and public review text. |
| Codex hookPrompt, hook/started, hook/completed | Public hook context and status, bounded details and elapsed time. Hooks are not newly authorized or executed by the UI. |
| Codex error with willRetry, model/rerouted, model/safetyBuffering/updated | Native reconnect, reroute and transient wait notices. No outer retry, account change or invented retry counter. |
| Codex collabAgentToolCall, subAgentActivity, child turn/completed | Clickable start/completion pills, public child reader and known-child completion tracking. Correlated spawn rows are not duplicated as large tool cards. Unknown thread IDs cannot complete a known child. |
| Claude tool_use, tool_result | Existing command/file/tool rows and public outputs; Read/Glob/Grep and WebSearch/WebFetch are distinguished. |
| Claude tool_progress | Updates elapsed time on the same running tool; a heartbeat is not a completed result. |
| Claude status/compacting and compact_boundary | Compacting state and confirmed boundary, with public trigger/token metadata. |
| Claude api_retry | Actual attempt/max-retries and native delay/error metadata; distinct turns have distinct retry records. The framework adds no retry loop. |
| Claude hook_started, hook_progress, hook_response | Hook lifecycle and public stdout/stderr/output. |
| Claude informational, tool_use_summary, rate_limit_event | Bounded public notices, tool summaries and reported usage warning/rejection. No automatic credit purchase, reset-card use or account switching. |
| Claude stream thinking blocks | Start/end indicator only; thinking deltas, signatures and redacted content remain excluded. |
| Claude result | Existing terminal outcome plus reported duration, API duration, turns and token/cache counts. No inferred price or universal quota claim. |
| Claude task_started, task_progress, task_notification, task_updated | Native identity, task state, public usage and last tool; stop/failure remain explicit. Notification summaries do not claim to be complete child transcripts. |
| Native approvals, questions, plans, context usage | Existing interaction and context modules remain authoritative; see `native-interactions-20260927.md`. This change preserves same-request answers and child approvals. |

This covers the task-reading route for all 19 ThreadItem variants in the inspected Codex schema through either existing message paths, native child paths or activity rows. It does not claim every app-server RPC is a message event or that every Anthropic SDK-only/opt-in event is emitted by CLI launches. Authentication, initialization/catalog discovery, realtime audio, external attestation, experimental account verification and suggested-input generation are separate capabilities. Unknown envelopes are not dumped into the UI or treated as authorization. Advanced interactions still have the explicitly recorded unsupported states from the interaction audit.

## Reading design

Main and child messages share original text, one thin divider, translation, then actions. Completed translations have no redundant icon/heading row. The same 14px serif reading style and 6px separator spacing are used on both sides. User messages retain the actual submitted text above the preserved original draft when different; nothing rewrites the submitted history to change visual language order.

Child activity is a single-line pill with the name and lifecycle status. Runtime/model provenance is available on hover and inside the reader. Start and completion are separate chronological entries when the native evidence has separate timestamps. An identical first child input is not repeated beneath the task assignment. Child content still requires explicit per-message translation.

Known completed turns collapse their process by default while preserving stacked user inputs and final answers. Running, failed or uncertain work remains discoverable and opens the process group. Expansion is presentation-only; stored messages, tool logs and native chronology remain unchanged. Clicking a translated passage can reopen its collapsed original. The proprietary Codex desktop's exact grouping algorithm is not a public protocol contract; this is the workbench's compact reading design, also applied to Claude.

## Parent turns versus background lifetime

Previously the local provider runner held the parent session in `running` until every observed child ended. It now finalizes the root turn independently. When children remain, the next **explicit** user submission reuses the same native process, RPC/stdio channel, gateway and native thread. Per-turn input, approvals, memory-handoff completion and final-message association are refreshed; no old user input is replayed.

The process remains busy for maintenance, connection edits and model-source replacement while it owns children. The UI offers an explicit background-stop action while keeping the message composer available. Stop/disconnect preserves uncertain child history. A completed child only releases the owned process when no parent turn remains active. Codex child completion is accepted from its own bound turn/completed notification, not only from a subsequent parent wait call.

This removes an extra workbench admission block. It does **not** force foreground native agents into the background: Claude documents that foreground agents block their parent, while background agents run concurrently; Codex can explicitly wait for children. Native scheduling and native follow-up behavior remain native. The SSH Codex path already releases parent admission on root completion and uses a retained connection; this change does not deploy or certify a remote Claude H path.

## Verification and limits

- TypeScript passed. Full repository suite: **690/690**, zero skipped, in `build/qa/runtime-reading/full-tests.txt`.
- Installed-CLI provider smoke: **7/7** (thread resume, actual native tools, Claude native child scheduling/public replies and approved/declined fixture edits).
- New installed-CLI background check: **4/4**. For each runtime, a loopback upstream deliberately holds the child response; the parent sends and receives a second explicit task on the same process/thread before release. Child completion is then observed. A separate explicit-stop case closes the owned background process and retains uncertain history. Maintenance/source-close exclusion remains enforced while children run.
- Native interaction regression: **4/4** actual-CLI same-request submit/decline checks. Hidden interaction UI checks verify original question identities, optional translation, cancellation and no extra model turns.
- Hidden child/translation reading UI: **12/12**, zero renderer errors. Includes compact DOM/typography checks, pills below 30px high, light/dark narrow screenshots, completed-process folding, paired navigation, files occupying the reader, per-message translations and restart persistence.

All native tests use disposable homes and synthetic loopback responses. The background Claude fixture uses its explicitly selected full-access test-process mode so native auto-mode safety-classifier inference is not confused with child scheduling; its fixed upstream emits only the predetermined native Agent request and harmless text. This does not change user settings or production permission policy. Early fixture attempts failed because they misidentified auxiliary classifier calls/tool schemas; an actual Codex completion-observation gap was fixed before the passing rerun. The failures were not counted as successful acceptance.

No real paid model endpoint, credentials, private keys, user chat database, production `dist`, VPS or active user client was touched. Complete long-context compression, every future event version, real SSH inference and proprietary desktop equivalence remain unverified. Screenshots and logs in ignored QA directories are evidence, not committed user data.
