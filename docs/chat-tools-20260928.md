# Workbench chat discovery and peer provenance

Date: 2026-09-28 JST (2026-09-27 UTC). This document covers local source and isolated verification, not a deployment or paid model acceptance.

## Public native facts and workbench scope

- The OpenAI app-server documentation exposes client-facing `thread/list`, `thread/read`, and thread lifecycle operations. These RPCs do not by themselves register chat-directory tools with a model. The workbench supplies its own bound dynamic tools; it does not scan the Codex desktop's private chat database.
- Anthropic documents native `ListAgents` / `SendMessage` for cross-session messaging, and separate SDK `listSessions` / `getSessionMessages` utilities for stored sessions. Native Claude discovery, SDK storage APIs, and a cross-runtime workbench directory are different facilities. This implementation keeps CLI inference and native child scheduling; it adds no SDK authentication or private inbox-file writes.
- Existing workbench tools already offered peer list/send/read/wait. The old list exposed only IDs/runtime/status, and read meant the peer inbox, not chat history. The new catalog preserves user-authored titles and adds an explicitly read-only public-history tool. Codex and Claude share these tools through their existing native transports, including configured third-party providers. An SSH path receives the same definitions where its authenticated native bootstrap is available; this is not new remote deployment evidence.

Official sources fetched for this change:

- https://developers.openai.com/codex/app-server
- https://platform.claude.com/docs/en/agent-sdk/sessions
- https://code.claude.com/docs/en/cross-session-messaging
- https://code.claude.com/docs/en/agent-teams

These references describe public capabilities, not permission to read private client state. No reference implementation or dependency was copied.

## Model-facing tools

All descriptions, schemas, generated status fields and errors are English. User-authored titles, message bodies and paths keep their original content. The source identity is supplied by trusted native attachment, never by model arguments.

| Tool | Arguments | Result and semantics |
| --- | --- | --- |
| `workbench_list_sessions` | Optional `query` (1–200 characters), `includeArchived` / `includeCurrent` (default false), `limit` (1–100, default 20), `cursor` | `{sessions, nextCursor, note}`. Same-owner chats only. Exact title, runtime, execution location, requested/effective model when known, project, status, pinned/archive state and message count. Pinned first, then latest stored public-message time. Cursor is the last returned chat ID; keep filters unchanged. A missing cursor fails explicitly and requires a fresh list. |
| `workbench_read_session` | Required `sessionId`; optional `beforeMessageId`, `limit` (1–50, default 20), `maxTextCharacters` (1–16000, default 4000) | `{session, messages, nextBeforeMessageId, note, scope}`. Latest public messages in chronological order; use `nextBeforeMessageId` as the next request's `beforeMessageId` for older pages. Each field is capped and `truncated` is explicit; total message text per page is at most 48000 characters. User `text` is the submitted text when present; differing `originalUserText` is retained separately. Delivery state is included. |
| `workbench_send_message` | Existing `targetSessionId`, `text`, `operationId` | Requires user-authorized communication in its tool instructions. Durable, idempotent peer inbox acceptance; host-stamped source. It does not automatically start or resume the recipient. Receiving peer context does not authorize sending a reply. |
| `workbench_read_messages` | Empty object | Existing source-bound peer inbox and revision, distinct from public chat history. |
| `workbench_wait_messages` | Existing `afterRevision`, optional `timeoutMs` (0–1800000), optional `sessionIds` (1–20 same-owner sessions) and `waitFor` (`any` default, or `all`) | Waits without polling for the first of an inbox update, the watched sessions finishing their running turn, or the timeout, with cancellation. Returns `reason` (`message`, `sessions` or `timeout`) and, when watching, each session's status. A finished turn is not proof of success; timeout is not a reply or authorization. (Extended 2026-10-04, D048.) |

Catalog/history recheck current same-owner identity on every call. Cross-owner and unavailable history targets use the same unavailable response. Archived target history is readable; an archived caller cannot acquire a new collaboration capability. No account references, native IDs, keys, raw native envelopes, hidden reasoning, translation errors, draft revision history or approval payloads enter the projection. Reading has no state mutation or model invocation. Titles and returned history are reference data, not new user or system instructions.

Rename, archive, delete, create and automatic continuation are not added as model tools by this change. Existing explicit host/UI operations retain their own validation. Native independent Claude sessions outside this workbench are not merged into this directory.

## Extension service interfaces

The same read-only projections are available through the existing trusted plugin `api.call` dispatcher:

```ts
api.call('session/catalog', {
  sourceSessionId: 'the-selected-workbench-session-id',
  options: { query: 'review', limit: 20 }
});
api.call('session/public-history', {
  sourceSessionId: 'the-selected-workbench-session-id',
  options: { sessionId: 'the-target-workbench-session-id', limit: 20 }
});
```

`options` has the same fields as the corresponding model tool, and the return objects are identical. In a trusted plugin this is an explicit UI selection; model tools cannot supply or override `sourceSessionId`. These routes do not register, replace or remove model tools. Tool registration remains the trusted native-bootstrap surface (`nativePeerTools` for Codex dynamic tools, `nativePeerMcpSession` for Claude MCP); these two read-only routes do not themselves register tools. Approved host plugins can extend the native bootstrap through the development-service interception API documented in [the plugin API](36-workbench-plugin-api.md). The service rejects calls after controller disposal. Plugins use existing `state` events for refresh and retain responsibility for cleaning up listeners. There is no polling-triggered or message-triggered model run.

## Provenance and presentation

The peer journal stores optional `fromTitle`, `toTitle`, and `fromModel` captured by the host at send time, alongside the existing immutable source/target IDs and runtime. Duplicate operation IDs return the original record, including its original title. The model cannot pass provenance fields as tool arguments. Legacy records remain readable and can use a currently resolvable title as a display fallback.

Incoming messages have a small source line, a compact serif text bubble, and an honest receipt label. A source title opens that exact workbench chat, rather than a native child reader. Long messages have an in-place expansion control. Removed sources retain their original title with the jump disabled; archived sources can still be opened when present. `delivered` means the native input receipt was confirmed, not proof the model read or completed the request. Native-child calls use their trusted workbench binding; this record does not invent a separate source chat for a native child that has no independent workbench session.

Incoming peer context remains visible outside completed-process folding, even before the recipient has any ordinary messages. It is not inserted as a forged user message and does not start a new task. Outbound records identify the recipient. Tool activity uses compact Chinese labels for list/read/send/inbox/wait; failed or uncertain calls do not display a success label.

## Verification

- Unit/protocol coverage: owner filtering, exact titles, pagination, archived/current selection, bounded history, truncation, source-field rejection, immutable provenance, MCP parity, plugin service parity and completed-turn presentation.
- Installed Codex 0.155.1 and Claude Code 2.1.283: each advertises and calls all five workbench tools against a synthetic loopback provider. Six assertions groups verify exact catalog/history results, one attributed send without a recipient turn, and inbox/activity round trips. Both transports run in disposable native homes with no real keys or paid endpoints.
- Hidden isolated Electron: eight checks cover provenance, exact source navigation, removed sources, long text, localized tool rows, an empty recipient, light/dark narrow layout and persistence. Screenshots inspected visually. No active user window or production build is replaced.
- TypeScript and the complete repository suite passed on an isolated snapshot of this change: **697/697**, zero skipped. Concurrent uncommitted plugin/documentation changes were excluded from that snapshot and this commit. The shared working-tree run encountered an in-progress documentation assertion from that separate task; its content was not reverted to make this change pass.

The concurrent documentation task had not yet added the requested `check:docs` package script at this verification point; running it reported a missing script. New links and added documentation were reviewed directly. That unavailable check is not reported as passed.

This is local implementation evidence. Actual paid upstream calls, private native-client histories and new SSH deployment are not part of this acceptance.
