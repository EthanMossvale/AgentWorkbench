# 36 · 工作台插件开发接口

## Local image path restrictions removed (2026-10-03)

This revision supersedes earlier directory allowlists and denylist claims for attachment import and viewed images. Interface inventory: `attachments/import`, `attachments/views`, `attachments/activity-images`, `actions.attachments.import/importViewedImages/views`, `images.viewed.read`, and `RuntimeImageLog`. Directory names, workbench data roots and workspace membership no longer decide whether readable local image pixels can be previewed. Uploaded source attachments also resolve without directory-name denial. The `workspaceRoot` argument remains accepted for compatibility but no longer authorizes or restricts a path. No metadata allowlist exception is needed for clipboard paths.

| Capability | Call / register / replace | Production evidence |
| --- | --- | --- |
| Local image snapshots | `api.call('attachments/activity-images',{sessionId,activityId})` returns `Promise<AttachmentView[]>`; approved host plugins register interception/replacement through `actions.attachments.importViewedImages` or `images.viewed.read` | Actual ActivityImageReader and AttachmentStore for Claude/Codex; approved plugin activation, disable and reenable in `tests/device-feedback.test.ts` restore unrestricted directory behavior |

Public signatures, events, named surfaces and serialized metadata are unchanged; no contract snapshot migration is necessary. There is no new option catalog to register. A new snapshot may have a new ID when directly importing a previously stored path; the activity reader continues caching and coalescing reads. OS permissions and local/remote provenance remain enforced. Existing regular-file, byte limits, stable-read and snapshot hash checks, stale publication prevention, storage ownership, save overwrite protection and duplicate-send controls remain. Non-image sources still fail with `ACTIVITY_IMAGE_SOURCE_UNAVAILABLE`; missing/unreadable files expose ordinary I/O errors. Core image reads no longer emit `ACTIVITY_IMAGE_PROTECTED`. Plugin errors remain plugin-owned. No model dispatch or permission escalation is introduced.

Validation: `tests/activity-images.test.ts`, `tests/device-feedback.test.ts`, `tests/attachment-storage.test.ts`, `tests/drag-attachments.test.ts`; synthetic clipboard under the configured data root, uploads, other directories, symlinks, missing workspace, restart from persisted snapshots, invalid/changed bytes, remote provenance and approved plugin cleanup. No UI structure, preference or default changes; loading/error/retry remain transient, so persistence inventory is unchanged. This does not certify live native SSH or the installed user desktop.

## Disjoint input and cache display (2026-10-03)

Interface review: `session/metrics`, `models/usage` (API, official-account and translation scopes), `models/pricing/save`, `models.accounts.call`, and the named `session-metrics` / `model-usage` surfaces retain their signatures, permissions, events and lifecycle. Raw `TokenCounts.inputTokens` remains inclusive for protocol compatibility, context capacity, cache-hit denominators and existing price calculations. The renderer uses exported pure `uncachedInput(counts)` to display input minus cache reads and writes; it returns `{value:number|null,upperBound:boolean}`. Complete totals with missing cache partitions produce an upper bound, incomplete input totals produce unknown, and zero remaining input is exact. Historical ledgers are not rewritten. Total tokens still include all input and output exactly once; neither cache categories nor reasoning output are added twice.

| Capability | Call / register / replace | Production consumption and validation |
| --- | --- | --- |
| Usage and prices | Existing `api.call('models/usage',{scope,period})`, `session/metrics` and price command; approved host layers intercept/override `models.accounts.call` | Shared account/API/translation summary and session footer; `tests/model-cost-estimation.test.ts` exercises approved activation, interception, disable/reenable and cleanup |
| Input/cache presentation | Typed `TokenCounts` projection `uncachedInput`; renderer `api.ui.surfaces.observe` on named `model-usage` and `session-metrics` for registered replacement and disposal | `ModelUsageSummary`, `SessionMetrics`; `tests/uncached-input.test.ts`, `scripts/test-session-metrics-ui.mjs`, `scripts/test-model-management-ui.mjs` |

No new option directory or adjustable control exists, so option registration is inapplicable. Existing named surface registration supports replacing current and later instances; existing host service interception remains the narrow way to replace account usage behavior. Snapshot review found no change to public commands, surface names or serialized declarations; the presentation helper is an additive export. Consumers calculating costs must continue using raw inclusive counters and must not subtract caches twice. Missing cache categories remain visibly unknown; the input upper bound is not an exact billed amount. Cache hit percentage is cache reads divided by inclusive input over comparable receipts, not divided by the new disjoint input label.

Cache audit evidence: `scripts/probe-native-input-cost.mjs` sends two greetings through each installed native CLI to a synthetic upstream with empty isolated profiles. It compares system text, tool declarations and prior message prefixes in memory and saves sizes/booleans only. This distinguishes request stability from provider cache policy; it does not predict actual cache hits, retention or billing. No user transcript, token, credential or live inference is captured. Two-turn Codex prefixes remained identical; Claude preserved tools/history but changed a late system suffix. A seven-day mixed-request rate is not comparable to a single nearly unchanged long-context request. UI persistence review is in document 37.

## Device feedback recovery and reading (2026-10-03)

Pre-implementation interface inventory: session recovery commands and runtime admission; `actions.attachments.importViewedImages/import/views`, `images.viewed.read`; file recognition and `files.navigation`; `translation/layout`, `translation/seamless`, `draft/prepare/submit`; `AppState.translationLayout`, translation module/quick-toggle/auto-submit settings and state events. No new credential, network or runtime permission is introduced. Native `message_stop` is not a terminal task receipt. Explicit recovery never establishes completion or triggers a replay.

| Capability | Call and result | Register, replace and cleanup | Production consumer / evidence |
| --- | --- | --- | --- |
| End unknown wait | `session/end-wait({sessionId,confirm:true})`; typed `SessionRecoveryApi.endWait(string,boolean):Promise<unknown>` returns the updated state | Approved host plugins intercept/override `sessions.recovery.endWait`; renderer plugins use named `session-recovery`. A recovery option catalog is inapplicable: this is one explicit acknowledgement action, not a completion detector. | Controller admission and Workspace use the same service. `tests/device-feedback.test.ts`, `scripts/test-device-feedback-ui.mjs` |
| Managed image preview | Existing `attachments/activity-images({sessionId,activityId})` returns `AttachmentView[]`; `attachments/views({ids})` verifies saved attachments | `actions.attachments.importViewedImages` and `images.viewed.read` remain replaceable services. No new image provider kind or path-name registration is added; local readable files are accepted subject to OS permissions and snapshot integrity. | Both native runtime paths, clipboard temporary paths and uploaded files; metadata/hash-verified snapshots; local/remote provenance and OS permissions remain enforced. Activity/storage tests and approved fixture |
| Code-span file recognition | Renderer `api.fileReferences.code(value:string):FileReference\|undefined` | `register({id:'plugin:<owner>/<name>',recognize:(value)=>boolean\|undefined}):()=>void`; later registered rules win, undefined falls through; lexical path safety remains. `subscribe(listener)` and `revision()` update existing and later Markdown instances. Plugin ownership and automatic disposal apply. | `MarkdownContent` and `linkedText`; explicit Markdown links retain existing resolver behavior. Named file navigation surfaces and `files.navigation.registerSource` remain unchanged. |
| Reading layout | `translation/layout({layout:string})`; `state/get.translationLayouts` supplies `TranslationLayoutOption[]` | Typed `translation.layouts` implements `TranslationLayoutsApi.list/register/resolve/subscribe`; plugin IDs use `plugin:<owner>/<name>`, labels and mode are validated, registration returns a release function owned via `api.onDispose`. Interception/override replaces list/resolve behavior; named `translation-layout` replaces controls. | Registration/disposal emits a catalog change through subscribe to the live controller state event. Settings and Workspace consume the same published catalog; modes are panel, inline or translated-only. Missing selected IDs retain preference with panel fallback. |
| Seamless preset and failure exit | `translation/seamless()` / typed `translation.workflow.seamless():Promise<unknown>` atomically enables translation, clears temporary pause, selects translated-only and enables auto-submit | Host workflow interception/override; existing translation-settings and new translation-layout surfaces. Presets do not introduce a second boolean owner. | Serialized state update invalidates pending previews. Failed translation retains draft; explicit `draft/prepare({...,bypass:true,confirmOriginal:true})` creates a reviewed raw preview; `draft/submit({automatic:true})` rejects it. |

Recovery errors: `SESSION_RECOVERY_CONFIRM_REQUIRED`, `SESSION_RECOVERY_BUSY`, `SESSION_RECOVERY_CHANGED`; active operations/transports cannot be acknowledged away. The legacy `session/api-acknowledge` remains a local-model-only alias. Previous messages, unknown delivery receipts and uncertain timing remain unchanged. Existing native owner admission may still require its own verified reconciliation; acknowledgement does not grant permission to clear remote owner state. Both runtime paths have local synthetic coverage, not live SSH acceptance.

Reading errors: `TRANSLATION_LAYOUT_INVALID`, `TRANSLATION_LAYOUT_DUPLICATE`, `FILE_REFERENCE_RULE_INVALID`, `FILE_REFERENCE_RULE_DUPLICATE`, `FILE_REFERENCE_RULE_OWNER`. Example: `api.onDispose(api.services.get('translation.layouts').register({id:'plugin:'+api.id+'/reading',label:'Reading',mode:'translated-only'}))`. To override recovery, intercept `sessions.recovery.endWait` and retain its confirmation/admission rules. Renderer example: `api.fileReferences.register({id:'plugin:'+api.id+'/known-code',recognize:value=>value==='known.md'?true:undefined})`; disable/failure/uninstall releases the rule, observers and named surface mounts. No example is installed into a real profile.

Compatibility: old panel/inline selections and shipped defaults remain. The new layout is additive; unknown string IDs survive restart and unavailable extensions. Invalid non-string layout data rejects without overwriting the original file. Code-span bare filenames now remain text; explicit Markdown file links and paths containing separators retain navigation. Existing `api.markdown.link` and file resolution signatures are unchanged. The old recovery test locator remains; the new named surface is additive. Public interfaces, named surfaces and host command snapshot are deliberately reviewed together. Attachment byte/count limits remain unchanged; oversize diagnostics now describe the full-path alternative for native local analysis rather than automatically attaching or sending it.

Tests: `tests/device-feedback.test.ts`, `tests/activity-images.test.ts`, `tests/attachment-storage.test.ts`, `tests/file-links.test.ts`, `tests/file-navigation.test.ts`, `tests/child-translation.test.ts`, translation flow/module suites, `scripts/test-device-feedback-ui.mjs` and `scripts/test-translation-redesign-ui.mjs`. Approved synthetic plugins exercise registration, actual service consumption, disable/reenable and mounted/later renderer instances; test profiles and artifacts remain excluded from packages. See documents 16 and 37 for validation and persistence boundaries.

## Bounded memory reception and input cost audit (2026-10-03)

This revision supersedes the temporary removal of automatic admission in the earlier correction on this date. An accepted non-steering native foreground submission admits at most six pending foreign archives to its own bound runtime, model, effort, location and permissions. It does not resolve or start the other runtime's default. Capture timers never start inference. Explicit `native-memory/process({runtime?:'codex'|'claude'})` still resolves saved recipient defaults and can drain their frozen backlogs, serially. Both paths require the existing enabled handoff and native-memory controls.

| Capability | Call | Register / replace / cleanup | Production evidence |
| --- | --- | --- | --- |
| Bounded native reception | `api.services.get('native.memory-background').start(target,submissionId,{retry?,maxEntries?})`; optional integer `maxEntries` is 1-1500 | Existing `registerExecutor` accepts a typed receiving executor and returns cleanup; service interception/replacement applies to the same live host instance | Approved ZIP in `tests/memory-consolidation.test.ts` reaches foreground dispatch and explicit processing, disable/reenable restores execution |
| Explicit backlog processing | `api.call('native-memory/process',{runtime:'codex'})` or omit runtime for both saved defaults | Existing command/service interception and executor registration | Same suite plus both synthetic SSH routes in `tests/memory-ssh.test.ts` |
| Native request and accounting audit | Existing `runtime.native-request.map`, `runtime.native-provider.openGateway`, session metrics and model usage selectors | Existing request/gateway service replacements; no new model option or selector | `scripts/probe-native-input-cost.mjs` runs installed local CLIs with isolated empty profiles and synthetic upstream replies; persists character counts only |

Each consolidation execution receives at most six archives in a fresh session, rather than accumulating all source text and tool history in one native context. The prompt includes the complete batch manifest and up to 4000 characters per initial archive page (24000 in total), with explicit continuation offsets. Fully included short archives need no read call; remaining pages retain the existing read authorization/hash checks. Writes and host verification remain mandatory. Only complete verified progress permits the next batch; failures, cancellation, uncertain cleanup and missing sources stop the dispatch. The task journal retains total progress across batches and optional `lastBatchWorkKeys` (at most six hashes), preventing a partial failure from becoming a new automatic attempt merely because earlier successes reduced the pending set. Old journals remain readable; no receipt or preference migration is performed. Invalid `maxEntries` returns `MEMORY_CONSOLIDATION_ARGUMENT_INVALID`; existing admission errors/events and permission gates remain unchanged. Extensions must not assume one executor invocation per backlog and must use the supplied session manifest. Executor removal still cancels owned work.

Interface and persistence review: no command signature, registration catalog, selector, UI surface or user preference was added. Existing settings keys, native ownership, first-import state, reset/restore behavior and default-off handoff remain unchanged; only explanatory labels reflect bounded automatic reception. `lastBatchWorkKeys` is journal metadata, not a UI choice. The public declaration snapshot is updated only for the additive optional journal field; no new service, surface or command entry is needed. Relevant checks cover batch progress, failure deduplication, approved plugin dispatch and cleanup, and synthetic Codex/Claude SSH. Installed-CLI input probing confirms one exchange per greeting and one accounting receipt per exchange; sizes are characters, not tokenizer or billing estimates. It does not reproduce private profiles or prove an exact historical greeting token count. No live model, remote deployment or user desktop acceptance is claimed.

## Model connection retention and provider compatibility (2026-10-03)

Interface review covered model-api/list/save/discover/refresh/reasoning/start, model.connections.call/key, runtime.native-request.map, runtime.native-completion.prepare, runtime.native-provider.openGateway, model-targets/list, existing state notifications and settings replacement. The affected values are ModelConnection.baseUrl/protocol/credentialRef and ApiModel manual fields. No option catalog, resource, surface, permission, event shape or persisted format is added.

| Capability | Call | Register / replace / cleanup | Production consumer and evidence |
| --- | --- | --- | --- |
| Connection edits and retained manual values/key | api.call('model-api/save',{id,revision,connection}); discover accepts the same edited connection | Approved packages intercept or override model.connections.call, with owned cleanup; renderer extensions use api.settings.register with replaces:models | Controller and ModelApiSettings use the live instance; tests/model-connection-plugin.test.ts approves a ZIP, edits a source, consumes both runtime selectors and checks disable/reenable |
| Native request mapping | api.services.get('runtime.native-request').map(body,from,to,model,effort) | Existing typed services.intercept/override for map; disable releases layers | Existing/later gateways read the shared instance; tests/native-request-plugin.test.ts covers layering, failure, in-flight calls, removal and cleanup |
| Completion without forced tool selection | api.services.get('runtime.native-completion').prepare(request,protocol) | Existing typed service registration/replacement and boundary disposal | scripts/test-native-termination.mjs verifies installed Codex/Claude tools and receipts plus approved activation, disable/reenable/removal |

Example: `await api.call('model-api/save',{id:source.id,revision:source.revision,connection:{...source,protocol:'anthropic-messages',baseUrl:'https://gateway.example/anthropic'}})`. Omitted key now retains this connection's encrypted key across explicit protocol/address edits, removing the prior re-entry error. Nonempty key replaces it; explicitly empty key clears it. Discovery uses the edited target without changing saved credentials. Save creates a scoped encrypted reference, commits metadata under CAS, then retires the old reference. Failure removes only the new reference. Busy-source admission, URL validation, rejected redirects, package approval and credential privacy remain enforced. Existing plugins should omit key to retain it.

Versionless model API bases stay versionless, including provider hostnames. Explicit versions stay intact; full resource URLs still normalize to a base. Stored URLs are not mass-migrated, and independent translation normalization defaults are unchanged. Source/model edits preserve manualEfforts/defaultEffort, manual contextWindow and legacy metadataSource:manual settings while invalidating old directory/probe evidence. Explicit legacy effortCandidates verification remains; ordinary manual saving never requires inference.

Cross-protocol Chat text uses strings, media stays typed, and Responses system/developer input becomes target system instructions. Same-protocol opaque input remains untouched. The completion codec retains explicit native tool_choice and defaults to auto; it no longer invents required/any. Unmarked text still fails the explicit completion check. No fallback model, effort downgrade, outer retry or host tool loop is introduced.

API-v1 declarations, return types, named surfaces and the contract snapshot are unchanged. This is a semantic correction to existing narrow services; no snapshot refresh or DOM migration is needed. No new extensible list is introduced; existing provider/runtime catalogs and settings replacements remain the registration path. Old and new gateways consume the same mapper; disposal and failed activation restore the remaining/core implementation. Saved user data outlives plugin disable or replacement. UI persistence is inventoried in document 37.

Tests: tests/model-api-settings.test.ts covers source edits, restart, explicit key clearing, stale revisions, failed rebinding and busy admission; tests/native-provider-compatibility.test.ts verifies both sources and three explicit URL prefixes against strict request validation. scripts/test-reasoning-ui.mjs covers actual controls, and scripts/test-model-connection-edits-ui.mjs covers the complete hidden app, encrypted storage, actual catalog GETs and full process restart. Plugin lifecycle tests are listed in the matrix. No real account credentials, private conversation database, active user desktop or remote deployment are used. Public provider facts are separated from synthetic evidence in documents 07 and 16.

## Native observation snapshot admission (2026-10-03)

Interface review: this host-only performance correction affects the existing Codex native event observer for local and SSH sessions. Threadless frames no longer request a full application snapshot solely to check thread ownership. Frames with params.threadId, or thread/started with params.thread.id, still read the current bound identity and reject unrelated threads before parent audit/activity handling. Claude admission is unchanged. No new command, resource, option catalog, selector, UI surface, permission, error, event shape or persistent field is introduced.

| Capability | Call | Register / replace / cleanup | Production consumer and evidence |
| --- | --- | --- | --- |
| Native event observation | Approved plugins use api.nativeEvents.catalog(runtime), inspect(runtime,value) and onReceipt(handler) | api.nativeEvents.register(presenter) adds a namespaced presenter; services.intercept/override('native.event-semantics', ...) replaces existing policy members; owned handles release on disable | The controller passes its production native-event registry to attachNativeObservation. Existing receipt and policy paths remain in use; tests/native-observation-performance.test.ts covers Codex local/SSH snapshot admission, foreign-thread rejection and disposal. Existing approved-plugin lifecycle suites cover activation and restoration. |

Example: const release = api.nativeEvents.onReceipt(receipt => { /* consume bounded metadata */ }); release(); Host extensions still require approval of the complete package. Snapshot reads and thread ownership are trusted host internals, not a separately registrable user option or a permission bypass. No extension can use this optimization to admit another native thread. Registry replacement order, failed activation cleanup, disable/reenable and later observer attachment retain their existing contracts. Existing synchronous/asynchronous queue handling and image rejection paths remain unchanged. Review of apiVersion 1 declarations and the contract snapshot found no signature or schema change, so no snapshot refresh or migration is needed. No adjustable UI state is added or changed; preference keys, defaults, storage, restore and reset behavior remain unchanged. Verification is synthetic source/protocol coverage, not a new real-model, installed-desktop or remote deployment claim.

## Preserve data locations during startup and updates (2026-10-03)

This correction supersedes earlier automatic bootstrap relocation behavior. Pre-implementation review covers the version-1 location file, initializeAppData, desktop/data-directory, desktop/data-directory/choose, desktop/data-directory/migrate, the desktop.data-directory service and data-directory-settings surface. Startup and program updates reuse the saved directory, including old generated defaults. With no locator, a recognized existing profile is reused in place; only a fresh installation creates a default. Explicit development overrides select a location without importing another profile. Startup no longer relocates legacy workspaces, Claude tool profiles, sibling attachments or clipboard caches, or removes their aliases. Coexisting directories, even conflicting nonempty ones, cannot themselves trigger a move.

| Capability | Call | Register / replace / cleanup | Production evidence |
| --- | --- | --- | --- |
| Inspect and explicitly relocate a profile | Existing desktop/data-directory commands and DataDirectoryApi retain their types and results | Approved plugins intercept or override desktop.data-directory; data-directory-settings supports current and later mounts with disposal. Filesystem paths are user choices, not a registrable option catalog. | tests/app-data-service.test.ts loads an approved ZIP through activation, replacement, disable and reenable; bootstrap tests exercise the real consumer and restart. |

An already persisted pending relocation still completes before stores open; ordinary startup never creates a pending relocation. Explicit migrate(target) retains idle admission, flush, validation, restart, journal recovery and error behavior. Startup is earlier than plugin activation, so a runtime plugin cannot intercept it before its own profile has been located; the named service remains the supported replacement point for user-requested moves. No new event, permission, resource, selector, surface, signature or persisted format is introduced; contract snapshot review requires no refresh. Missing selected directories and damaged location files still report errors rather than silently choosing an empty profile. No user data is copied into packages.

Example: an approved plugin obtains desktop.data-directory via api.services.get, calls get() to inspect the active directory and invokes migrate(target) only for an explicit relocation action; disabling the plugin removes overrides without moving any data. Coverage: tests/app-data.test.ts, tests/app-data-service.test.ts, tests/app-data-relocation.test.ts, scripts/test-data-bootstrap.mjs and scripts/test-data-relocation-bootstrap.mjs. Both Claude and Codex retain their existing profile paths. No native CLI or remote server configuration changes.

## SSH continuity and import diagnostics (2026-10-02)

Pre-implementation review: the version-1 bootstrap locator, owned SSH paths in `AppState.hosts`, `desktop.data-directory`, `accounts/list`, `accounts/usage`, `runtime/models`, `model-targets/list`, `studio/import-preview` and `studio/import`; named surfaces remain `data-directory-settings`, `workspace-import` and the existing model menu. No new resource directory, selector option, event, permission or adjustable UI state is introduced.

| Capability | Call and result | Register, replace and release | Production consumer and evidence |
| --- | --- | --- | --- |
| Relocate an existing profile | `desktop/data-directory/migrate({target})` retains its restart result | Existing typed `desktop.data-directory` interception/override and directory surface; no new directory-provider catalog | Bootstrap remaps `identityFile` and `knownHostsFile` only within owned roots/aliases; a protected staging root prevents inherited Windows ACLs from exposing copied files. `tests/app-data-relocation.test.ts`, `tests/ssh-private-files.test.ts` |
| Import an SSH invitation | `studio/import-preview` and `studio/import({previewId,deviceLabel})` retain existing preview/host results | Approved `actions.workspace-management` interception/override and `workspace-import` surface; third-party registration retains its activation cleanup handle | Production portable/enrollment services protect managed key directories/files; approved ZIP in `scripts/test-workspace-export-ui.mjs` calls the actual portable importer and verifies the renderer error |
| Read SSH native model metadata | `runtime/models({runtime,hostId,refresh:true})` returns `NativeModelOption[]` or a safe diagnostic | `actions.native-accounts.models` and `models.targets.list` interception/override; additional runtimes still use `api.runtimes.register` | Controller and model selector consume the same result; `tests/claude-remote-catalog.test.ts` separates SSH failure from malformed JSON, with no replay |

Permissions and compatibility: only application-owned staging roots, device keys and bootstrap keys receive owner-only ACLs; external user-selected identities are not modified. Windows uses a fixed system PowerShell executable, literal paths passed through the child environment, protected owner-only descriptors and readback; POSIX uses private modes. Paths with symlinks or file hard links are rejected. Failure to establish/read back permissions raises `SSH_PRIVATE_PERMISSIONS_FAILED`; path failures raise `SSH_PRIVATE_PATH_INVALID`. No key material or remote output is included in diagnostics. Old cleanup journals with SSH references still under the retiring root reject with `APP_DATA_SSH_REFERENCE_UNMAPPED` before deleting anything; new migrations wrap it in `APP_DATA_MIGRATION_FAILED`. Already-retired local metadata requires an evidence-backed repair, not guessed rebinding.

SSH command failures are checked before service JSON parsing. Fixed diagnostics include `SSH_HANDSHAKE_TIMEOUT`, `SSH_LOCAL_KEY`, `SSH_HOST_KEY`, `SSH_AUTH_REJECTED`, DNS/network/process failures and typed transport errors. Malformed successful service JSON remains a different failure. Import errors add `WORKSPACE_IMPORT_<PROBE|ENROLL|VERIFY>_<code>`; known pre-enrollment transport failures do not consume an invitation. A lost enrollment reply gets one read-only verification using the saved device key, never an automatic second enrollment. The same computer/file can resume; successfully consumed invitations remain invalid for another device. Shutdown/disposal, per-invitation exclusion, server-controlled expiry and account-generation validation remain authoritative.

Example: an approved plugin calls `api.call('runtime/models',{runtime:'claude',hostId,refresh:true})`; a replacement holds `api.services.intercept('actions.native-accounts','models',handler)` with `api.onDispose`. Import replacements use the equivalent `actions.workspace-management` methods. Disabling releases registrations without removing saved device keys or reversing a completed migration. No new stable SDK signature, surface or persisted format is added, so the contract snapshot is unchanged after semantic review. Tests cover old and fresh profiles, consecutive moves, protected key acceptance by real Windows OpenSSH, external-path preservation, failed cleanup, safe diagnostics, exact-key recovery and approved activation/disable/reenable. Member-computer network acceptance and remote deployment are separate from local synthetic validation.

## Shared startup profile and receipt migration integrity (2026-10-02)

Pre-implementation review covers the bootstrap locator, `desktop/data-directory`, `desktop/data-directory/choose`, `desktop/data-directory/migrate`, `desktop.data-directory`, `native-memory/get`, the memory exchange initializer, and the existing `data-directory-settings` and `memory` settings surfaces. Source launches on Windows now honor an existing saved installation locator; a fresh source-only launch keeps its original default. Explicit developer-home and isolated QA overrides bypass the installation locator. This avoids recreating an empty developer profile after an installed migration. No runtime/model execution, new selector, resource, permission, event or adjustable UI node is introduced.

| Capability | Call | Register | Replace and release |
| --- | --- | --- | --- |
| Selected profile and migration | `api.call('desktop/data-directory')`, `api.call('desktop/data-directory/migrate',{target})`; the existing typed `DataDirectoryApi` | Approved host plugins can register commands that call the production service; no new profile-provider catalog is introduced because this repair preserves one per-user locator | `api.services.intercept/override('desktop.data-directory', ...)` and the named `data-directory-settings` surface remain the fine-grained replacement paths; activation-scoped handles release on disable/failure/uninstall |
| Memory receipt ownership during relocation | The production migration validates rewritten receipt paths before publishing the target or deleting the source; `native-memory/get` retains its existing status contract | Existing memory executor/writer registration is unchanged; bootstrap path integrity cannot be overridden by an unapproved plugin before stores are open | Existing `native.memory` service replacement and `memory` settings registration remain available after initialization; no new recovery action grants permission to rewrite arbitrary records |

Return types and plugin SDK declarations are unchanged; the contract snapshot requires no refresh after semantic/lifecycle review. Migration now rejects unresolved or malformed receipt paths with `APP_DATA_MIGRATION_FAILED` whose cause is `APP_DATA_MEMORY_RECEIPT_UNMAPPED`. A new move preserves the source ledger and removes only its own incomplete target. Resuming an older cleanup journal also revalidates receipt ownership before deletion and reports `APP_DATA_MEMORY_RECEIPT_UNMAPPED` directly while retaining both trees and the journal. Pending receipts may be absent on disk; their paths must still be owned by the destination and match the delivery ID. Receipt tokens, archive contents, acknowledgements and native provenance are never inferred or reset. Existing invalid delivery validation remains strict. Already damaged local metadata requires an evidence-backed, backed-up repair; this patch does not silently accept arbitrary historical paths.

Compatibility and evidence: `tests/app-data.test.ts`, `tests/app-data-relocation.test.ts`, `tests/memory-migration.test.ts`, `scripts/test-data-relocation-bootstrap.mjs`, and `scripts/test-data-directory-ui.mjs`. Coverage includes consecutive moves, pending/acknowledged deliveries, retained archive bytes, corrupt locators, explicit overrides, source/installed singleton ownership, full process restart, and approved ZIP service/surface activation, disable and reenable. No old DOM locator or saved preference key changes. No development plugin is installed into a real user profile.

<!-- startup-appearance-20261001:start -->
## First-window appearance readiness (2026-10-01)

Pre-implementation review: affected paths are `state/get`, `theme/set`, `appearance/get/set`, state events, `api.themes.register/list/subscribe`, the production theme registry, `useAppearance`, `workbench-appearance`, existing `appearance-theme`/`titlebar` surfaces, renderer activation and `plugin-recovery/core-ready`/`renderer-ready`. There is no new user option, preference owner, resource or runtime-specific branch.

| Capability | Call existing behavior | Register new implementation/options | Replace and release |
| --- | --- | --- | --- |
| Persisted startup appearance | `api.call('theme/set',{theme:'dark'})`; `const a=await api.call('appearance/get'); await api.call('appearance/set',{revision:a.revision,patch:{darkPreset:'plugin:example/night'}})`; existing state notifications | `api.themes.register({id:'night',label:'Night',mode:'dark',base:'builtin.abyss'})` returns the typed `ThemePresetHandle`; the same production registry serves selector and initial palette | Existing appearance host method/middleware replacement and named `appearance-theme` / `titlebar` surfaces remain available; owned handles clean up on disable, failure or unload |
| First presentation | Existing core-ready and renderer-ready lifecycle notifications now gate automatic initial reveal together with document/window restoration | No extensible readiness option is introduced; all approved renderer entries are discovered from the actual package registry, including late discovery | Activation promises participate in readiness; third parties customize appearance through the fine-grained contracts above without replacing the application. Independent recovery remains the core escape path |

No signature, selector, permission or persisted-format change; apiVersion and contract snapshot stay unchanged after semantic/lifecycle review. Full package approval still precedes code loading. Existing appearance validation, revision conflicts, plugin activation timeout/failure cleanup and missing-ID fallback remain authoritative. User IDs survive disable and recover on reenable. The internal one-shot coordinator is not a new public plugin API. `WORKBENCH_PRESENTATION_FAILED` is an independent recovery incident if the renderer cannot prepare the first frame, not an appearance-save error. No new event is emitted; `workbench-appearance` and state subscriptions keep their existing payloads. The frame wait does not add a fixed startup sleep and does not replay later theme changes as window-show operations.

Evidence: `tests/first-presentation.test.ts`, `tests/appearance.test.ts`, `tests/appearance-themes.test.ts`, `tests/ui-preferences.test.ts`, `scripts/test-startup-appearance-ui.mjs`, and `scripts/test-appearance-ui.mjs`. Real approved synthetic ZIP activation exercises the production selector/consumer and first-show decision, with delayed discovery/activation, complete process restart, cleanup, retained choice and reenable. Existing appearance checks cover old settings, invalid registrations, coexisting plugins, mounted/later instances, replacement restoration and late results. No development plugin is installed in a real profile. No API declaration or named-surface mapping changed; unrelated concurrent snapshot changes are not part of this fix.
<!-- startup-appearance-20261001:end -->

<!-- memory-ssh-receivers-20261001:start -->
## SSH native memory receiver routing (2026-10-01)

Interface review: affected commands are `native-memory/process`, `native-memory/get`, `native-memory/tasks/list`, `native-memory/tasks/cancel`, `model-targets/list`, `runtime/select`, host removal and remote maintenance admission. Affected production services are `native.memory-default`, `native.memory-background`, `native.memory-reference-writer`, `actions.native-codex` and `actions.native-claude`. State remains the saved recipient defaults, background journal and existing `changed`/host state broadcasts. No UI mount point, resource, selector or adjustable control is introduced; existing model targets and saved choices now reach the missing SSH consumers. Existing memory settings localize the new identity/cleanup reasons; the registered settings-page replacement and task-state interfaces remain unchanged.

| Capability | Call | Register | Replace and release | Evidence |
| --- | --- | --- | --- | --- |
| Per-recipient SSH execution | `native-memory/process({runtime?:'codex'|'claude'})` resolves the saved native default and returns admission; task list/get supplies progress and reason | `native.memory-background.registerExecutor(MemoryTaskExecutor)` returns a release function; last supporting registration wins in the production admission path | Register an executor with `mode:'consolidation'`, `supports(target)` and `run(task)`; `api.onDispose(release)` cancels owned work and restores the previous matching implementation | `tests/memory-ssh.test.ts` approves and activates a temporary ZIP plugin, invokes public process, verifies native file storage, then disables/re-enables the plugin and exercises both restored native routes |
| SSH native transport | Existing `actions.native-codex` and `actions.native-claude` service handles supply real bridge instances | Approved typed service interception remains the registration path; no new provider/model enum | Intercept named service methods with lifecycle cleanup; background Codex delegates close for its session only, never global service disposal | Real Codex adapter/RPC and Claude authenticated loopback MCP gateway with synthetic SSH process |
| Memory read/store/verify | Existing `MemoryTaskExecution.read`, optional `store`, and `verify`, with frozen recipient scope | Existing reference writer and executor registrations | Writer/service interception uses the same production storage and receipt checks; an executor return alone cannot acknowledge content | Existing consolidation/receipt suites plus both SSH storage tests |
| Busy/unsupported state | `native.memory-background.busy(id?)` additionally matches SSH host IDs; journal/status remains public | Executor registration supplies support for an unavailable route | Releasing an executor cancels its active lease; later explicit use may resolve another executor | Background dedup/restart/recovery and SSH host-removal tests |

`NativeMemoryTaskExecutor` retains its existing constructor arguments and gains optional `NativeMemoryExecutorOptions.remote:MemoryRemoteExecution`: `host(id):SshHost`, optional `codex:NativeCodexService` / `claude:NativeClaudeService`, `assert(session):void`, `claudeModel(session):ApiModel`, `before(session,signal):Promise<void>`, and optional existing Codex quota hooks. These are host integration dependencies, not an alternative to the approved plugin registration above. Startup refreshes the account catalog and checks exact authenticated account identity. Each memory tool rechecks the frozen SSH identity and current permission/admission; display-name changes do not change identity. Native session identifiers are never inherited from a foreground chat. No collaboration catalog is attached to the private background state.

Errors/lifecycle: unsupported bindings remain `MEMORY_BACKGROUND_BINDING_UNSUPPORTED`; read-only/plan remains `MEMORY_BACKGROUND_READ_ONLY`; interactive requests return `MEMORY_BACKGROUND_INTERACTION_REQUIRED`; native uncertainty and unconfirmed owned cleanup remain uncertain (`MEMORY_BACKGROUND_NATIVE_UNCERTAIN`, `MEMORY_BACKGROUND_CLEANUP_UNCONFIRMED`). Identity changes reject tool access with `MEMORY_BACKGROUND_BINDING_CHANGED`. Cancellation, shutdown, plugin release and failure stop owned work without automatic approval or model replay. Remote maintenance/removal checks include the background host reservation. This does not grant other-owner, administrative or remote filesystem authority. The existing complete-package `host` approval is required for executor plugins.

Example inside an approved plugin's `activate(api)`: `api.onDispose(api.services.get('native.memory-background').registerExecutor({mode:'consolidation',supports:t=>t.binding.hostId===configuredHostId,run:receiveScopedBatch}));` The receiver consumes only `task.read/store/verify` and returns `{state:'completed'|'blocked'|'failed'|'uncertain',reason?}`. The host verifies receipts independently. Existing executor registrations without `mode` retain their legacy batch protocol; old local account/API bindings still use the provider runner. No public signature is removed. New host options are added to the declaration snapshot after this compatibility review.

Journal v1 remains readable: optional `workKey` is now also recorded for unsupported jobs, using a distinct `unsupported-v1` digest of binding/model/permission/frozen entries. Identical subsequent explicit triggers return `MEMORY_BACKGROUND_UNCHANGED`; installing a supporting executor permits the next explicit trigger. Existing consolidation digests are unchanged, old rows remain, and timers never replay work. No native memory format, UI preference default or file ownership migration occurs. Existing corruption/concurrency, executor release and multi-registration tests remain applicable; DOM instance/monitor checks are unchanged because this change adds no renderer state. Synthetic protocol evidence does not establish live SSH/model behavior or semantic quality of generated memories.
<!-- memory-ssh-receivers-20261001:end -->

## Translation call limits per chat (2026-10-01)

Interface audit and coverage: `translation/settings` retains `TranslationProfile.maxCalls`; `translation/usage({sessionId?: string})` adds optional `sessionCalls: number` while preserving legacy aggregate `calls`, receipt statistics and errors. `Session.translationCalls?: number` is a nonnegative safe integer in the version-1 state file, exposed by `state/get` and the existing `state` event. Missing legacy values start at zero; historical receipts cannot reconstruct attempts reliably. Invalid saved values reject loading without overwriting the file. Existing numeric preferences and the default 0 (unlimited) are preserved.

| Capability | Call | Register | Replace and release |
| --- | --- | --- | --- |
| Per-chat admission and counters | `translation/settings`, `translation/usage({sessionId})`; service `translation.translate(text,direction,operationId,priority,signal?,sessionId?)`, `segments(values,direction,operationId,signal?,sessionId?)`, `refine(original,instruction,operationId,signal?,sessionId?)` | `translation.targets.register(owner,provider)` executes through the production queue and admission path | Existing `api.services.intercept('translation',method,handler)` / service override and disposal; `translation-settings` surface supports mounted/later UI replacement |

Example: `await api.call('translation/usage',{sessionId:chat.id})` reads the persistent chat count; `await api.services.get('translation').translate('Public reply','output','unique-operation','final',undefined,chat.id)` consumes that chat's allowance. Full-package host approval is unchanged. No extra resources, network authority, event names, selector catalog, or UI mounts are introduced. Providers continue registering through the existing target catalog; a separate catalog of numeric limits is not applicable.

All core input, refinement, public progress/final, manual retry, question, plan, child-overlay and annotation translations pass their owning chat ID. Attempts share a count across model/profile switches, module pause/disable/reenable, turns and process restarts. New chats and forks start at zero; switching back does not reset the old chat. Admission is serialized and saved before dispatch; save failure prevents a request. An admitted failure/cancellation still consumes one attempt, including cancellation during the durable reservation. Each refinement can consume two attempts. A cap blocks only that chat; increasing it or saving 0 permits future explicit requests. Nothing automatically retries blocked translations.

Compatibility: appended optional service arguments preserve old callers. Omitted IDs retain a separate process-local legacy service scope; core chat paths never use it. Unknown explicit IDs fail with `TRANSLATION_SESSION_MISSING`; exhausted budgets report the chat-specific budget error. Internal annotation translation callbacks now receive the owning session ID as the second argument. No DOM/test-ID migration is required. Existing declaration snapshots do not include concrete service methods or Session fields; reviewed tracked declarations remain unchanged, and behavior tests cover the additive semantics rather than refreshing unrelated snapshots.

Evidence: `tests/translation-redesign.test.ts` covers independent chats, concurrent admission, restart, disable/reenable, legacy counters, corrupt data and an approved ZIP target through the actual controller/service lifecycle. Existing translation, question, child and annotation regressions cover consumers. UI preference inventory and evidence boundaries are in documents 37 and 16.

<!-- model-switch-continuity-20261001:start -->
## Responsive model selection and context continuity (2026-10-01)

Interface inventory: `session/model`, `session/model-target`, `runtime/models`, `model-targets/list`, `session/prepare-runtime`, `state/get` and existing state notifications; services `models.targets`, `runtime.native-provider`, `workbench.controller`, and new `models.context-state`; state `Session.nativeContextUsage` / saved model lanes and existing model preferences; named UI surface `composer-model`. No resource, permission, runtime enum or adjustable UI option is added. Claude and Codex, including both SSH adapters, consume the same context state service and selection UI.

| Capability | Call | Register / replace | Actual consumer and cleanup |
| --- | --- | --- | --- |
| Context continuity | `models.context-state: NativeContextStateService` from `packages/model-api/context-state.ts` | Register a namespaced service with `services.register`; override/intercept the typed members of `models.context-state` | Controller selection, target handoff and public projection plus local/SSH native receipt adapters use the registered production object. Disable/uninstall releases layers; persisted receipts remain. |
| Model selection | Existing `session/model({sessionId,selection})` and `session/model-target({sessionId,targetId,selection?})` | Existing runtime/model registries and `models.targets` remain the production catalog; replace `composer-model` through named multi-instance surface observers | Choices paint optimistically, serialize saves and coalesce pending input to the latest choice. Failed saves roll back visibly; late writes never change a newly selected chat. Model metadata stays mounted for same-source switches. Sending stays gated during saving. |
| Catalog and preparation | Existing `runtime/models`, `model-targets/list({refresh})`, `session/prepare-runtime` | Existing typed catalog/native runtime service replacement | Automatic UI reads use caches; explicit refresh still probes. Account observation timestamps do not trigger rediscovery. Same-source selection preserves the native thread and does not synchronously terminate a prepared transport. Idle prewarming waits 250 ms after the latest selection; explicit send revalidates the launch identity and closes obsolete preparation before sending. |

`recover(session: Session): NativeContextUsage | undefined` returns a receipt or a conservative display estimate without mutating the input; `select(session, selection: NativeModelSelection, capacity?: number): void` preserves used tokens and remembers capacities by model; `observe(session, usage: NativeContextUsage): void` records a new native receipt; `capacity(session, capacity: number): void` fills a confirmed native window; `handoff(previous, restored: NativeContextUsage | undefined, capacity?: number): NativeContextUsage | undefined` restores a lane or carries an explicitly estimated usage into a new source. These synchronous service methods operate on caller-owned state; persistent writes use the existing serialized state owner. Host plugin approval is required. Invalid optional capacity cache values are ignored; existing idle/availability/ownership errors still reject selection, and saving errors are visible. No network action, model inference or automatic retry is added to the context service.

Example: `api.services.register('example.context', { select: policy }, {version:1}); const release = api.services.intercept('models.context-state', 'select', (next, session, selection, capacity) => next(session, selection, capacity));`. Registration cleanup is owned by activation. A complete replacement can override the five typed members with a registered implementation. Renderer extensions observe/replace the existing `composer-model` surface, including mounted and later instances; no private DOM migration is required.

Compatibility: API v1 is additive. `NativeContextUsage.estimated?` and `modelWindows?: Record<string,number>` are optional and stored by the existing session/lane owner. Missing caches are valid; capacities are never inferred from model names. Switching model keeps the last used amount but labels it as awaiting a current-model receipt; differing tokenizers/history reconstruction can change that estimate. A known capacity is restored on return to its model, including 1M. Fresh unknown capacities stay unknown. Old SSH Claude state can recover the latest same-thread request evidence, excluding final aggregate totals and any receipt invalidated by reset/compaction. Native Codex billing deltas are not used to invent missing historical context. Current native receipts, including genuine zero, replace estimates. A next-turn Codex selection does not relabel an in-flight old-model capacity. Source/approval boundaries and native compression remain intact.

Verification: `tests/context-usage.test.ts`, `tests/claude-ssh-controller.test.ts`, `tests/native-bridge-controller.test.ts`, `tests/native-preparation.test.ts`, and `scripts/test-model-switching-ui.mjs`. The approved synthetic plugin exercises call/register/override/intercept on the production consumer and disable/reenable cleanup; shared lifecycle tests cover layered failure/uninstall. Hidden full-app Electron tests hold real selection IPC, check immediate feedback and coalescing, rollback, both SSH model roundtrips, avoided discovery, restart and narrow layout. No development plugin is installed in a real profile. The snapshot includes the new typed service; existing commands and surfaces remain unchanged. Persistence inventory is in document 37; no source test claims live VPS timing or foreground deployment.
<!-- model-switch-continuity-20261001:end -->

<!-- runtime-context-mcp-repair-20261001:start -->
## Runtime selection, native context and SSH tool parity repair (2026-10-01)

Interface review before implementation: affected public calls are `runtime/choice`, `runtime/select`, `runtime/models`, `session/model-target`, `session/model`, `model-targets/list`, `draft/prepare`, `draft/submit` and `state/get` / state broadcasts. Production services are `models.targets`, `workbench.controller.nativePeerTools`, `runtime.native-provider`, `actions.native-claude` and `translation`; named surfaces remain `composer-model`, `composer-runtime` and `composer-draft-recovery`. No runtime enum, theme, permission or account list is added. The complete model-facing tool inventory was compared across API, local Codex/Claude and SSH Codex/Claude; the missing path was SSH Claude's MCP composition.

| Capability | Call existing behavior | Register additional implementation/options | Replace and release | Production evidence |
| --- | --- | --- | --- | --- |
| Destination runtime/model | `runtime/choice({runtime,sessionId? ,hostId?})` returns `{target:ModelTarget,selection?:NativeModelSelection}`; follow with `session/model-target` or use it for a new draft | Existing typed runtime registry and `models.targets.list` feed both resolution and execution; IDs remain namespace-stable | Approved host interception of the named call / `models.targets`, cleanup restores core | `tests/session-send-recovery.test.ts`, hidden recovery UI |
| Native context capacity | `state/get` exposes `Session.nativeContextUsage`; `runtime/models` exposes model metadata | Existing native adapters and model directories supply numeric capacity, existing runtime event registration remains valid | `runtime.native-provider` / named model surface replacement with cleanup | `tests/context-usage.test.ts`, `tests/model-account-execution.test.ts`, hidden recovery UI |
| SSH workbench tools | Authenticated MCP `tools/list` / `tools/call`; exact names below | `workbench.controller.nativePeerTools(sessionId)` returns typed definitions/call; an approved service interceptor can add tools to this production instance | `NativeClaudeOptions.workbenchTools?:()=>ReturnType<typeof createPeerTools>` is optional for old adapters; `actions.native-claude.createTransport` consumes it on every discovery/call, so disable removes tools from active and later instances | `tests/claude-ssh-controller.test.ts` approves a ZIP plugin and invokes the real local HTTP MCP gateway |
| Bounded local discovery | `LocalContext` returns existing catalog plus `warnings:string[]` | `actions.native-claude.openContext` registration via approved service lifecycle | Existing context adapter replacement / owned close handle | `tests/claude-local-context.test.ts`, existing approved context plugin test |
| English submission | `draft/prepare` then `draft/submit`; translation errors retain the draft | Existing `translation` and translation backend contracts | Approved translation replacement and existing named recovery surface | `tests/translation.test.ts`, `tests/controller.test.ts`, hidden recovery UI |

`runtime/choice` reads the destination session lane first, then versioned per-runtime preference, then an available destination default. It never requires the outgoing model/mapping to exist on that runtime, or copies outgoing reasoning/Fast settings. Owner checks occur before resolving, and target/model/permission checks remain in the production switch. Missing/unready destinations fail with `RUNTIME_MODEL_UNAVAILABLE` without mutating session state. Current host is preferred; explicitly remembered same-owner sources can be restored. Caller-supplied labels cannot grant authority. `runtime/select` updates existing last-selection fields and `AppState.runtimeModelPreferences={version:1,entries:{[runtime]:{targetId?,hostId?,selection?}}}`. Old state seeds only the one known last choice; it does not invent choices for the other runtime. Corrupt/unknown preference versions fail visibly without rewriting the original profile. Writes use the existing serialized state owner. Runtime/account unavailability alone does not erase saved entries. Example: call `runtime/choice({runtime:'codex',sessionId})`, then `session/model-target({sessionId,targetId:choice.target.id,selection:choice.selection})`.

The 10 workbench model tools are `workbench_list_sessions`, `workbench_read_session`, `workbench_send_message`, `workbench_read_messages`, `workbench_wait_messages`, `workbench_list_model_targets`, `workbench_spawn_agent`, `workbench_read_agent`, `workbench_list_projects`, `workbench_create_session`. SSH Claude receives them through the same bound local MCP server as its file/context/task tools. Native Agent/SendMessage/ListAgents remain native tools and are not renamed or replaced. Workbench sidebar chat creation requires the direct user's request, same owner/location, existing target, inherited permissions and a stable operation ID. A stored submitted translation may supply an exact authorization quote only if the original user request independently authorizes creation; generated tasks and peer messages remain insufficient. Read-only local permission modes allow discovery/read tools, not creation or messaging. Arbitrary DesktopCommand/admin/credential endpoints are not model tools. No generic unrestricted host-call tool is added.

MCP registration, authentication, cancellation, authority reread, name collision failure, session shutdown and local-tool cleanup retain their existing lifecycle. Dynamic workbench definitions are reread for each request: disabling a plugin immediately removes its tool from an existing gateway, reenabling restores it, and later gateways use the same current provider. The optional callback is an additive NativeClaudeOptions contract change; old providers without it retain local-only behavior, while replacement SSH transports must consume it to claim parity. The contract snapshot is reviewed for that addition, runtime preference declarations and the new public route.

Root Claude `result.modelUsage` capacity now updates official/local-account and SSH `nativeContextUsage.capacity`, not just the internal runtime budget. Exact root model wins; a unique resolved-alias row is accepted; ambiguous multiple model rows, child results and invalid capacities are ignored. Custom gateway capacities remain owned by their declared mapping. Later usage deltas preserve the same lane's capacity. A numeric 1,000,000 receipt adds a 1M label to the selected model and its picker row without changing the model ID or fabricating variants. Before a capacity receipt/explicit directory capacity exists, unknown remains honest; no size is guessed from marketing names.

LocalContext depth/entry budgets now return discovered instructions, memory and skills with explicit partial-discovery warnings, rather than aborting the whole catalog. Warnings identify the incomplete root; absence in a partial catalog is not evidence of absence on disk. Cycles remain deduplicated, traversal stays bounded, malformed settings and actual read errors still fail. This does not relax skill invocation or command permissions.

Translation-on semantics now reject Chinese raw bypass and unfinished Chinese prose from translation output before restoring protected literal spans. The original-only fallback button is removed; migrate UI integrations from `prepare-original` to normal `prepare-draft`. Translation-off explicit sends remain available. Recovery invalidates old previews and retranslates on the next explicit send; no automatic retry/model replay occurs. Paths/code and existing native resource contents retain their literal ownership. The tool correction does not deploy SSH code, modify native clients, or submit real model tasks.
<!-- runtime-context-mcp-repair-20261001:end -->


<!-- context-annotations-20261001:start -->
## Selected context annotations (2026-10-01 JST)

Pre-implementation review: selection actions, composer drafts, bilingual input preparation, history/edit/resend, follow-up queues, user-message forks, plugin renderer lifecycle and local persistence are affected. Original and translated message Markdown may be selected; the floating toolbar adds an explicit excerpt, without submitting a model task. Multiple excerpts remain in a count capsule above the composer. History and queue details retain read-only capsules; editing a sent message restores the excerpts. Each annotation contains the selected text followed by a horizontal divider and its reading translation; translations never increment the annotation count. English excerpts receive a separate Chinese reading translation after addition or saved edits while translation is enabled. Selected Chinese text remains verbatim locally and enters input translation at preparation; the preview shows the actual English submission. Chinese annotations require explicit preview confirmation even when auto-submit is preferred; this temporary exception does not change that preference. Translation applies to both the task body and named annotation segments, preserving source attribution and the actual submitted translation. Translation pause/disable sends the original excerpts. Generated reference framing is English; quoted excerpts remain user content, not application instructions.

| Function coverage | Call existing capability | Register new implementation | Replace / production connection |
| --- | --- | --- | --- |
| Read and edit active draft | Renderer `api.annotations.get/add/update/remove/clear/translate/subscribe` | `registerAction({id,label,run})` adds a `plugin:<owner>/<id>` selection action | `overrideAction('core.add',{label,run})`; `SelectionAnnotations` reads the same live controller as the facade |
| Persist scoped draft | `annotations/get({sessionId}) -> AnnotationDraft`; `annotations/update({sessionId,revision,items}) -> Promise<AnnotationDraft>` | Host service interceptors on `composer.annotations.read/update` | `services.override('composer.annotations', ...)` affects controller IPC and input preparation, with existing owned disposers |
| Reading translation | `annotations/translate({sessionId,revision}) -> Promise<AnnotationDraft>`; active composer `api.annotations.translate()` | Existing `translation.targets` backend registration; `composer.annotations.translate` interception | Core selection and edit effects call the same host service; service invokes production `translation.segments` with output direction and checks policy and draft revision before storage |
| Local UI and history | Named `annotation-selection`, `composer-annotations`, `message-annotations` surfaces | `observeSurfaces(name,'before'|'after',render)` handles every current/later instance | `observeSurfaces(name,'replace',render)` hides only the named core surface; disable restores it |
| Disclosure and editor geometry | `uiPreferences.get/set/reset('composer.annotations-open', ..., scope)`; existing `editor.height` | Typed preference registration and independent plugin scopes | `uiPreferences.override` changes the actual capsule consumer without overwriting the saved choice |
| Translation and submission | `draft/prepare` accepts optional `annotationRevision`; returned `DraftPreview.annotations` includes `translatedText?` | Existing `translation.targets` and runtime registrations handle the same prepared payload | Existing translation service and `submission.gate`; the selected backend receives a segment map and every runtime records `Message.annotations` |

Types are exported from `packages/context-annotations/index.ts` and `apps/desktop/renderer/annotation-controller.ts`. `ContextAnnotation = {id,text,translatedText?,displayTranslation?,source?:{sessionId,messageId?,side?:'source'|'translation'}}`; source is attribution, not a capability to fetch other sessions. `AnnotationDraft = {version:1,revision,items}`. Mutations accept up to 20 unique IDs, 16,000 characters per excerpt and 64,000 total source characters; whitespace is preserved. Stored draft writes strip caller-supplied translations; unchanged text retains its host-owned `displayTranslation`, while edits discard that derived value. `translatedText` is the prepared model-facing text; `displayTranslation` is user-facing Chinese and is excluded from `annotationPrompt`. Reading translation updates derived data without advancing the source revision. It never adds an item or substitutes a whole source message for a partial selection. `AnnotationAction.run(selection,signal)` returns a string or `Promise<string>`; the current controller appends it only if the target, action registration and active lifecycle remain valid. All registrations return `{id,dispose}`; subscriptions return a disposer. Non-LIFO override cleanup restores the latest remaining registration. Failed registration adds nothing. Disabled asynchronous actions cannot append late output.

Permissions: renderer code requires full-package `host` approval, exactly as other renderer extensions. Core IPC requires an existing local session and revision match. No new model tool, network access, remote deployment, source-file access or task initiation is implied. Events use existing state broadcasts plus the typed renderer annotation subscription. Reading translation failures retain the excerpt and expose a manual retry in the composer. Pending/error indicators are transient. Missing input-translation segments abort preparation without falling back to Chinese; bypass/demo and automatic dispatch are rejected for Chinese annotations while translation is active. Disabling/pausing translation restores the explicit original-text workflow. Errors include `ANNOTATION_TRANSLATION_INVALID`, `ANNOTATION_TRANSLATION_UNAVAILABLE`, `ANNOTATION_INVALID`, `ANNOTATION_LIMIT`, `ANNOTATION_DRAFT_INVALID`, `ANNOTATION_CONFLICT`, `ANNOTATION_SESSION_MISSING`, `ANNOTATION_UNAVAILABLE`, `ANNOTATION_BUSY`, `ANNOTATION_MISSING`, `ANNOTATION_TARGET_CHANGED`, and `ANNOTATION_ACTION_{INVALID,CONFLICT,MISSING,CANCELLED}`. Disk errors leave the previous state/revision intact and appear visibly; stale submissions are rejected before dispatch. An accepted send clears only the matching revision; a newer concurrent choice is retained with a visible message.

Compatibility: additive API v1 fields and methods; old `draft/prepare` callers omit `annotationRevision` and keep their existing behavior. No new selectable runtime/provider enum or package resource is needed. Existing plugins remain valid and old state without `annotationDraft` reads as empty revision 0. Unknown/corrupt draft records fail validation without overwriting the source state file. History is immutable, and annotation contents are not stored in UI preferences. New annotations do not use arbitrary DOM selectors as a plugin contract. The three named surfaces are additive; existing composer/message surfaces remain. Public declaration and surface snapshots are reviewed with the behavior tests. The optional `displayTranslation` field is additive; old drafts/messages need no migration. Service overrides patch named members, so old read/update overrides retain the new core translate method. Existing `.annotation-sent` now uses a horizontal separator; plugins should use the named surfaces instead of internal class/child selectors. No new selectable catalog or adjustable geometry is introduced.

```js
export function activate(api) {
  api.annotations.registerAction({
    id: 'excerpt', label: '添加摘录',
    run: (selection, signal) => {
      signal.throwIfAborted();
      return selection.text;
    }
  });
  // Optional explicit refresh after adding via a custom action:
  // await api.annotations.translate();
  api.observeSurfaces('message-annotations', 'after', ({root}) => {
    root.textContent = 'Reference excerpts';
  });
}
```

Persistence inventory: document 37. Behavior evidence: `tests/context-annotations.test.ts`, `scripts/test-context-annotations-ui.mjs`, and existing translation, runtime dispatch, fork and UI preference regressions. The UI test builds and launches an independent hidden Electron app with synthetic sessions and an explicitly approved ZIP; it does not install a development example into a real user profile. Evidence levels and remaining limits are recorded in document 16.
<!-- context-annotations-20261001:end -->

<!-- native-tool-image-token-audit-20261001:start -->
## Native tool-image request conversion and large-paste handling (2026-10-01 JST)

Pre-implementation review: the affected boundary is the native Responses/Messages request mapper consumed by the session gateway, plus the existing attachment import path and composer paste policy used by the renderer. Tool declarations, call identities, rich tool outputs, protocol selection, attachment metadata, upstream usage receipts and the explicit text-paste threshold are in scope. The bounded renderer media policy is a named additive plugin surface; no new selectable catalog, user-adjustable setting, persisted preference, account identity, resource installation or retry policy is introduced. The original mapper serialized Responses image output arrays as JSON text and discarded images in Claude tool-result arrays. These defects could inflate repeated prompt input or deprive the model of visual evidence.

| Capability | Call existing behavior | Register or replace implementation | Release and production consumer |
| --- | --- | --- | --- |
| Typed native request mapping | `api.services.get<NativeRequestCodec>('runtime.native-request').map(body, from, to, model, effort?)` | Approved host plugins register `services.intercept(..., 'map', handler)` or replace the narrow `map` method with `services.override` | The shared production instance is consumed by `openNativeGateway`; disposer/disable restores core mapping for existing and later gateways |
| Per-gateway mapping | `runtime.native-provider.openGateway(options)` | Optional `NativeGatewayOptions.request: NativeRequestCodec` selects a custom mapper | Existing `close()` owns gateway requests; a plugin that pins its own codec must close its owned gateway during cleanup |
| Protocol/model selection | Existing connection settings and native runtime selectors | Existing provider/runtime registries; this repair introduces no new selectable option | Both native runtimes pass their actual requests through the named mapping boundary |
| Large plain-text paste | Existing composer paste handler and `attachments/import`; `textPastePolicies.decide(text)` and `MAX_INLINE_TEXT_BYTES = 100000` UTF-8 bytes | Approved renderer plugins call `api.media.decideTextPaste(text)` or register a bounded `api.media.registerTextPastePolicy({id,thresholdBytes})`; the returned handle is disposable | `useAttachments` reads the shared production policy for current and later composers; disable/unload removes the plugin policy and restores the core threshold; `AttachmentStore.payloads` verifies size/hash before `attachmentPrompt` emits a metadata reference |
| Attachment content policy | `attachments/import`, `attachments/views`, `attachments/image`, `attachments/pick` and `attachmentPrompt` | Existing attachment service replacement/interception remains the extension point; no extension may bypass size, hash or storage-integrity checks; path-name classification is not part of image preview | Text over 100,000 bytes, ZIP and other binary files remain metadata/path references; images and supported API PDF/document fields remain typed content |
| Usage and current context | Existing `session/metrics`, `UsageSample` and native context indicators | Existing trusted usage events and metrics service replacement | No historical counters change; cache remains a subset of input and cumulative usage remains separate from current context |

`NativeRequestCodec.map(body: Record<string, any>, from: 'responses' | 'anthropic-messages', to: Protocol, model: ApiModel, effort?: string): Record<string, any>` is synchronous and owns no networking, persistence, tool execution or retries. The controller registers the production singleton from `packages/model-api/native-request.ts` as `runtime.native-request`. Replacements must preserve authorized contents, call identities and the selected upstream model. Auxiliary count/compact requests retain their existing same-protocol handling outside this mapper.

Responses function/custom-tool output arrays now retain structured text and images. Chat tool messages are text-only, so the mapper emits the complete tool-result batch before an attributed user image message. Base64 remains solely in `image_url`, never text. Anthropic keeps images inside the matching `tool_result.content`; Claude results converted to Responses preserve `input_image`. Cross-protocol text fields accept strings only: arbitrary objects are rejected with `NATIVE_PROVIDER_CONTENT_UNSUPPORTED` and return a local 422 response before upstream dispatch. This preserves legitimate JSON/code strings byte-for-byte and avoids guessing whether a string happens to contain Base64. Same-protocol opaque requests remain unchanged. This repair does not establish vision support for every third-party model; text encoding is never a fallback for unsupported vision.

The composer paste rule is deliberately byte-based: the core `textPastePolicies` decision promotes values whose UTF-8 encoding is greater than 100,000 bytes. A registered plugin may lower that threshold for its own approved policy, never raise the core ceiling; its handle is released on disable or unload. The resulting regular attachment is subject to the existing 20 MiB per-file, 50 MiB total and 10-file limits. `attachmentPrompt` includes text only for verified UTF-8 text attachments at or below 100,000 bytes; larger TXT/JSON/INI/source files, ZIP and other binary files contribute metadata and a verified local path. The attachment layer does not promise model-side chunking or single-read behavior. No preference or event is added, so UI persistence migration is not applicable.

Permissions/lifecycle: exact-package approved `host` access is required for service replacement, and approved renderer access is required for the media paste policy. `decideTextPaste` is read-only; `registerTextPastePolicy` returns a cleanup handle and is owned by the plugin lifecycle. There is no new renderer command, device permission or background request. A request already mapped keeps its payload after disable; later requests use the restored mapper. Attachment imports retain existing hash/path validation, failure cleanup and disable/reenable behavior. Mapping and paste promotion add no event: existing extension lifecycle and state/usage notifications remain authoritative.

Compatibility: API v1 adds two additive `media` methods and no new public command or persisted field. Existing plugins/configuration need no migration. Plugins that call `attachments/import` receive the same Attachment contract and limits; plugins must not assume a source file is copied, because native desktop mode may retain a verified original path. Public declarations, the contract snapshot and disable/reenable cleanup were reviewed deliberately.

```js
export async function activate(api) {
  // The composer reads this same named policy surface for a large paste.
  const decision = api.media.decideTextPaste(text);
  const policy = api.media.registerTextPastePolicy({ id: 'project-text', thresholdBytes: 80_000 });
  try {
    // Use the existing attachment import contract when the decision is true.
    if (decision.attachment) await api.call('attachments/import', {
      files: [{ name: 'pasted-text.txt', bytes: new TextEncoder().encode(text) }],
    });
  } finally { policy.dispose(); }
}

Tests: `tests/native-tool-images.test.ts` covers large image payloads, all cross-protocol directions, same-protocol transparency, parallel tool-result order, URL/image-only outputs, strict opaque-content rejection and preservation of long JSON/code strings. `tests/drag-attachments.test.ts` covers multi-megabyte JSON, INI, TypeScript and ZIP metadata references plus the UTF-8 paste threshold and bounded policy cleanup. `scripts/test-drag-attachments-ui.mjs` covers the real hidden Electron clipboard path; `scripts/test-media-integration.mjs` covers an approved renderer plugin registering a policy, actual composer consumption and disable cleanup. `tests/native-request-plugin.test.ts` uses the real registry and `runtime.native-provider.openGateway`. `tests/token-audit-regression.test.ts` covers a long session with repeated native/stream snapshots, attachment construction and delta handoff. Related metrics/provider/streaming suites remain in scope. Validation evidence and limitations are recorded in document 16.
<!-- native-tool-image-token-audit-20261001:end -->

<!-- translation-footer-20260930:start -->
## Translation controls in the composer footer (2026-09-30 JST)

Pre-implementation review: this change removes only the sidebar Mark instance, shortens the quick control's active label to “关闭翻译”, and moves the existing intermediate-message switch after auto-send in the composer footer for both inline and panel layouts. Native window/tray branding, the waiting-state Mark, translation execution, selection catalogs and preference defaults are unchanged.

| Affected capability | Call | Register | Replace / cleanup |
| --- | --- | --- | --- |
| Quick pause, auto-send and intermediate translation | Existing `translation/quick-toggle({show?,paused?})`, `translation/auto-submit({enabled:boolean})`, `translation/intermediate({enabled:boolean})`; Promise returns the current AppState | Existing approved host request registration/middleware and renderer surface registration; no new option catalog | Existing `translation-toggle` and `translation-intermediate` named surfaces reach the relocated live controls; disable restores the core input and retained values |
| Intermediate control layout and later sessions | `state/get` and the existing state event | `observeSurfaces('translation-intermediate', placement, render)` covers current and later matching instances | `replace` replaces only that control; returned cleanup removes extension nodes, restores the core control, and remains owned by plugin disable |
| Sidebar identity | Existing named `sidebar` surface | Existing renderer surface registration | Workbench wordmark and `.sidebar-identity` remain; no sidebar `brand-mark` is rendered. Shared branding registration still owns native icons and other actual Mark instances |

No public signature, method name, event, permission, ID, configuration format or contract snapshot changes. Invalid boolean inputs retain existing validation errors; unavailable quick pause retains its existing refusal. Full-package host/renderer approval is still required; relocation grants no new network or model permission. Existing serialization, observer cleanup and failure handling remain the production owners. This is not a new translation mode or a new runtime/theme catalog, so option registration is not applicable.

Migration: plugins must use the existing named `translation-intermediate` surface independently of its parent. The old `.workspace-header-actions .intermediate-toggle` placement no longer exists; the target is now under `.composer-translation-controls`. Its data attribute, test ID, switch role and `intermediate-toggle` class remain. A scoped hidden-state rule ensures replacement actually hides the core flex label and disable restores it. The visible control order is quick pause, auto-send, intermediate; intermediate now uses the same switch-before-label order and dimensions as its neighbors. Pausing hides the latter two; disabling the translation module hides all three. Child-session exclusions remain unchanged. Narrow views wrap controls without clipping and may put the separate usage display on a subsequent line.

Persistence uses existing global `AppState.translationQuickToggle.{show,paused}`, `autoSubmitTranslated`, `translateIntermediate` and `translationLayout` in the per-user StateStore; no new keys, defaults or migration. “关闭翻译” is a shorter label for the same resumable pause, not the plugin master switch. Reset and startup normalization are unchanged. Pending saves are transient. Tests: `scripts/test-translation-footer-ui.mjs` (hidden production layouts, global behavior, exact approved plugin current/later surface replacement, disable/reenable and restart); existing translation/module/preferences tests and `scripts/test-branding-ui.mjs`. Source/hidden desktop results do not imply current user-window or release-package updates.
<!-- translation-footer-20260930:end -->

<!-- translation-selector-label-20260930:start -->
## 2026-09-30 translation selector label compatibility review

Pre-implementation scope: `translation/targets`, `translation.targets` / `translation.workbench-targets`, `TranslationTarget.name/description`, the managed-model selector, `translation/settings`, saved `TranslationProfile.source`, state/extension notifications, and the named `translation-model` surface. This is a presentation correction; no catalog entry, executor, permission, asset, preference default, or persistent format changes.

| Capability | Call existing behavior | Register additions | Replace and release |
| --- | --- | --- | --- |
| Managed translation model labels | `translation/targets(): Promise<TranslationTarget[]>` supplies the actual selector | `translation.targets.register(owner, provider): () => void` adds namespaced targets to the production catalog and executor; plugin `name` and `description` use the same label formatting | Existing service interception/override or `observeSurfaces('translation-model', ...)` replaces the local presentation; lifecycle cleanup covers mounted and later instances |
| Selection and restoration | `translation/settings({profile})` with the existing revision stores `source.kind/targetId/effort`; `state/get` reads it | No new selectable category or preference is introduced; existing registered target IDs remain selectable | Existing translation service replacement and provider disposer remain authoritative; unavailable/disabled sources retain the saved ID and never select an alternative |

The core selector trims the display fields and omits the appended name only when the description equals that name or ends with the exact ` · <name>` suffix. Example: `{description:'Provider · model-id',name:'model-id'}` renders `Provider · model-id`; a distinct `name:'My alias'` still renders `Provider · model-id · My alias`. Case and partial matches do not collapse. Account context, separate equal-named targets, option values, and the unavailable suffix/disabled state remain intact. Raw catalog fields and execution model IDs are unchanged.

No new errors or permissions: existing catalog/target validation, approved host-package access, settings revision conflicts, and renderer surface cleanup still apply. State and extension lifecycle notifications continue to refresh the selector. No public declaration, `apiVersion`, surface name/selector, or saved schema changed; the contract snapshot was reviewed and does not need regeneration. Old plugins keep their catalog data and lifecycle semantics; automation must match stable option values rather than the former duplicated visible text. No DOM migration is required.

Preference inventory is recorded in document 37. Regression locations: `tests/translation-target-label.test.ts` covers duplicate suffixes, aliases, account context and exact matching; `scripts/test-translation-redesign-ui.mjs` covers real core catalog options, equal models from separate sources, approved ZIP provider activation/execution, unavailable labels, mounted/later surfaces, disable/reenable, process restart and narrow/dark rendering. Existing translation redesign, registry and UI preference tests retain concurrency, invalid/old configuration, late results, multiple providers and cleanup coverage. Verification results and limits are recorded in document 16.
<!-- translation-selector-label-20260930:end -->

<!-- connected-w-branding:start -->
## Connected-W application identity (2026-09-30 JST)

Pre-implementation review: the affected consumers are the renderer `Mark`, sidebar identity, native BrowserWindow icon, tray image and their startup/quit lifecycle. The selected product artwork is the connected W: deep brown `#30201A`, coral `#FF9676`, apricot `#FFDAAB`. `packages/branding/connected-w.svg` is the source; `scripts/generate-branding.mjs` renders bounded PNG representations and the Windows ICO in an independent hidden process. The source hash is checked against `generated.json`. The static source assets contain no profile, account, chat or acceptance data. No runtime/theme/font/provider selector is added.

### Feature coverage matrix

| Capability | Call existing behavior | Register an implementation | Replace and release |
| --- | --- | --- | --- |
| Application, native window and tray identity | Host `api.branding.get/list`; renderer `branding/get` and `branding/list` | Host `api.branding.register(definition)` enters the production PluginRegistry branding owner before its native and renderer consumers | Last active registration replaces all three consumers; returned `dispose()` or plugin cleanup restores the next layer or shipped W |
| Already mounted and later renderer marks | `branding/get` plus `workbench.branding` / `changed` plugin events | The same registration feeds each real `Mark`; no test-only catalog or private component import is needed by a plugin | Revision guards reject an older initial read after a newer event; unmount removes the listener |
| Local mark layout and content | Named `brand-mark` surface, `[data-workbench-brand-mark]` | Renderer `observeSurfaces('brand-mark', placement, render)` uses existing multiple-instance/later-instance mounting | `replace` affects only each mark; asynchronous cleanup and disable restore its original core node |
| Persistent owner and product default | Existing exact-package approval/enable state in `plugins.json`; no new user setting | Enabled host plugins reconstruct code contributions on restart | Disable/uninstall removes live contributions, not user profile values; reenable restores registered branding. No logo-selection UI or preference key exists |

### Contract, errors and permissions

`packages/branding/types.ts` defines `BrandingApi`, `BrandingDefinition`, `BrandingSnapshot`, and `BrandingHandle`, included in the public contract snapshot. The host `PluginApi.branding` is an additive API-v1 entry:

- `get() -> BrandingSnapshot`: detached `{id,label,app,tray?,revision}`. Core ID is `workbench.connected-w`; effective revision is monotonic within the process.
- `list() -> BrandingDefinition[]`: detached shipped identity and active registrations in precedence order. It is a replacement-layer inventory, not a user selection menu.
- `register({id,label,app,tray?}) -> {id,dispose}`: local ID matches `[a-z][a-z0-9.-]{0,79}` and is returned as `plugin:<owner>/<id>`. Label is nonempty and at most 120 characters. `app` is a square, non-interlaced 8-bit RGBA PNG data URL, 16 through 512 pixels, at most 1 MiB encoded. Optional `tray` maps up to twelve decimal pixel sizes to PNG data URLs of the same dimensions; missing sizes derive from `app`. Native consumers use a 16-pixel logical tray image and its supplied scale representations. Registration validates signatures, IHDR, chunk CRCs, decompression bounds and row filters before mutating live state.
- `subscribe(listener: (snapshot: BrandingSnapshot) => void) -> () => void`: change notification without an initial callback. Listener registration and branding handles are automatically owned by the approved plugin lifecycle. Read with `get()` for the initial state. A failing observer cannot prevent other consumers from receiving the change.
- `branding/get({}) -> Promise<BrandingSnapshot>` and `branding/list({}) -> Promise<BrandingDefinition[]>`: read-only host routes. Effective changes emit `{type:'plugin',id:'workbench.branding',topic:'changed',payload:BrandingSnapshot}` through the existing host event bridge. There is no renderer write route that bypasses package approval.

Errors: `BRANDING_DEFINITION_INVALID`, `BRANDING_DUPLICATE_ID`, `BRANDING_IMAGE_INVALID`, `BRANDING_LISTENER_INVALID`; the native image adapter rejects an empty decoded image with `BRANDING_IMAGE_UNAVAILABLE`. Invalid and duplicate registrations leave the previous identity intact. Retained scoped APIs reject after their plugin is disabled. Registration is synchronous; late asynchronous plugin work still passes the lifecycle guard before it can register. A failed activation releases any identity registered before the failure. Multiple owners and non-LIFO removal are supported.

Executable branding plugins declare `host` access and need approval of the complete exact package. Image URLs are embedded PNGs, never remote URLs, SVG scripts, user profile paths or an added network permission. This does not grant OS administrator, other-user or remote-device access. Existing native window/tray action service contracts and close-to-tray behavior are unchanged. Direct renderer surface replacement remains a separate, explicitly approved UI extension.

```js
export function activate(api) {
  if (!api.branding) throw new Error('BRANDING_API_UNAVAILABLE');
  // pngDataUrl is a reviewed PNG bundled in this approved package.
  const identity = api.branding.register({
    id: 'studio', label: 'Studio identity', app: pngDataUrl
  });
  api.registerCommand('identity', () => api.branding.get());
  // Explicit identity.dispose() is optional; disable owns it automatically.
}
```

### Compatibility, persistence and verification scope

Old plugins retain API v1 and all existing methods; use feature detection on older hosts. `Mark({small?})` and `.brand-mark` / `.brand-mark.small` remain. Its artwork child changes from an inline `svg` to `img`; plugins that relied on `.brand-mark svg` must migrate to the named surface or the typed shared branding registration. The added surface does not change existing named selectors. The sidebar now groups the icon and existing wordmark inside `.sidebar-identity`; direct-child `.sidebar-top > .app-wordmark` styling should use `.sidebar-identity .app-wordmark` instead. The snapshot adds the branding declarations, host member, two read routes and named surface only; this is an explicit additive review, not an approval of unrelated declarations.

The product default intentionally changes for existing and fresh installations to the user-selected B artwork. It is not sampled from a developer profile. There is no new adjustable node: current theme, zoom, sidebar geometry, ordering and window state retain their existing preference owners, restoration and reset semantics in document 37. Compact-sidebar hiding remains derived geometry; it does not overwrite a preference. Branding registrations and subscriptions are runtime code contributions, reconstructed from existing approval/enable state. No preference migration or image selection persistence is required. Installer signing, executable resource replacement and OS-pinned shortcut caches are outside this source change; the source ICO is available for a future reviewed packaging task.

Tests: `tests/branding.test.ts` checks source/PNG/ICO consistency, invalid input, namespacing, immutable reads, multiple registrations, real approved ZIP activation, stale APIs and failed activation cleanup. `scripts/test-branding-ui.mjs` uses the production application, approved temporary plugins, actual native icon calls/decoded pixels, current/later `Mark` instances, named surfaces, delayed reads, disable/reenable, package removal, actual process restarts and preserved UI preferences. Existing tray lifecycle and plugin-surface checks cover unchanged hide/show/quit and generic asynchronous surface restoration. Hidden desktop, source/protocol and native image evidence do not claim a foreground OS taskbar or installed release-package acceptance. No development plugin is installed in a real user profile.
<!-- connected-w-branding:end -->

<!-- inline-visualizations-20260930:start -->
## 回复内交互可视化（2026-09-30；U120）

先行审查和完整边界见 [交互展示记录](inline-visualizations-20260930.md)。原来的 HTML 文件侧栏保留；新的完整独立行 `visualize{"path":"<absolute-local-path>/view.html","title":"可选标题","mode":"wide"}` 经共享 Markdown tokenizer 进入真实 `MessageText`，主回复、译文和原生子会话使用同一组件。普通 HTML、代码围栏、行内示例、未完成标记均保持文本；原消息不改写，翻译完整保护标记。

### 功能覆盖矩阵与生产接线

| 功能 | 调用现有能力 | 注册新增实现/选项 | 替换、实际消费者与清理 |
| --- | --- | --- | --- |
| 引用、读取和渲染 | renderer `api.visualizations.parse/read/render/listRenderers/instructions/subscribe` | `registerRenderer({id,label,render,replaces?})` 返回具名句柄 | 单一生产目录同时驱动实际选择器和 iframe；`replaces:'core.html'` 按注册顺序叠层，支持非后进先出释放 |
| 页面服务 | `visualizations/read`、`visualizations/render`、`visualizations/release` | 上述目录提供自定义 renderer；没有新的文件来源/设备目录 | host `files.html-preview.readVisualization/createVisualization/releaseVisualization` 是上述命令实际调用的实例，可 intercept/override |
| 原生/API 能力说明 | `visualizations/instructions({runtime?})`、renderer `api.visualizations.instructions(runtime?)` | 新运行时使用同一文本协议，无固定展示运行时枚举 | `visualizations.presentation.instructions(runtime?)` 是本机 Codex/Claude、API 与 Codex SSH 桥实际调用的服务；API 使用精简说明以保留小上下文预算；不写原生配置 |
| 局部界面 | `visualization` 和 `visualization-toolbar` 具名 surface | `observeSurfaces` 覆盖全部当前/后来实例 | 继承 signal、异步清理及停用恢复；不用私有 React 组件或任意 DOM 选择器作为唯一契约 |
| 用户选择及状态 | `uiPreferences.get/set/reset/subscribe`，`visualization.source/renderer/state` | renderer ID 使用 `plugin:<owner>/<id>`；偏好支持具名注册 | `uiPreferences.override` 作用于实际消费者；扩展缺失时显示回退提示并保留选择，重启用恢复 |

### 类型、参数、结果、事件与错误

- `VisualizationReference={path:string,title?:string,mode?:'wide',renderer?:string}`；只接受本机 HTML 文件引用，path ≤4096 字符，title ≤160。`parse(raw)` 返回 reference 或 undefined。`read(reference,sessionId?)` / `visualizations/read({path,sessionId?})` 返回 `{path,html,digest}`；规范路径、有界 UTF-8 正文和 SHA-256 标识均只来自实际本机读取。digest 不证明内容安全或语义质量。没有远端自动下载或同名本机映射。
- `VisualizationRenderer={id,label,replaces?:'core.html',render({document,reference,signal}):string|Promise<string>}`；注册生成 namespaced ID，返回 `{id,dispose()}`，禁止重复 ID。`render(document,reference,renderer,signal)` 返回 `{html,renderer,fallback}`，异步超时 10 秒、失败、过大结果或失效注册回退核心；abort 不产生新页面。多插件可并存，只有显式 `replaces` 影响核心渲染器。原选择不会被回退覆写。
- `visualizations/render({html,channel,state,dark}) → {url}`：1 MiB 上限、channel 有界、state 验证；返回临时 `awb-preview` 页面。`visualizations/release({url}) → void` 幂等释放，仅能释放 inline 页面。128 个同时活跃 inline 页面上限，超出显式报错；卸载、切换 renderer、迟到创建回执均回收页面。普通侧栏页面的 24 项上限独立。
- `visualizations/instructions({runtime?}) → string`：英文说明，省略 runtime 使用完整说明；API 使用紧凑协议说明；替换服务只改变下一次任务启动读取，不热改原生已运行进程。
- iframe 只有 `allow-scripts`，opaque origin；CSP 禁止网络、CDN、外部脚本/资源、嵌套 frame、worker、form、object；没有 Node、preload、主页面 DOM、跨页面 storage 或系统权限。宿主继续阻止导航、弹窗、权限和 webview。不把批准插件的完整代码权限和模型 HTML 的沙箱混为一谈。
- 页面可使用 `window.openai.widgetState` / `setWidgetState({modelContent,privateContent}) → Promise<void>`；同一对象也以 `window.workbenchVisualization` 暴露。最多 16 KiB JSON；缺失字段归 null；禁止原型键、不有限数字等无效值。`openai:set_globals` 的 `detail.globals.widgetState` 推送回读状态；保存仅在用户明确交互时调用，不在加载或该事件内重复写入。仅接受当前 iframe WindowProxy 和随机 channel 的消息。`modelContent` 在本实现同样只本机保存，不自动注入模型、不发送后续消息或开始回合。
- 页面高度按内容测量且限制 160–900px，超过区域内部滚动；窄面板/主题变化不写用户偏好。源码模式保留原 HTML；刷新重新读取原文件。模型自己写入的 CSS 决定具体图表和轮播样式，不承诺复刻全部 Codex utility classes 或 CDN 行为。
- 错误族：`VISUALIZATION_PATH_INVALID/FILE_UNAVAILABLE/HTML_INVALID/CHANNEL_INVALID/PAGE_LIMIT/STATE_INVALID/STATE_LIMIT/STATE_SAVE_FAILED/STATE_TIMEOUT/RENDERER_INVALID/RENDERER_DUPLICATE/RENDERER_TIMEOUT/RENDERER_RELEASED/ABORTED/SESSION_UNAVAILABLE`，以及既有 `UI_PREFERENCE_*` 和文件路径检查错误。UI 给出读取/脚本/状态失败及回退提示；不静默重发任务。异步插件调用在停用后拒绝，清理句柄自动归属批准包。

### 示例与兼容迁移

```js
export function activate(api) {
  const handle = api.visualizations.registerRenderer({
    id: 'comparison', label: '对比展示',
    render: ({ document, signal }) => {
      signal.throwIfAborted();
      return document.html;
    }
  });
  api.observeSurfaces('visualization-toolbar', 'after', ({ root }) => {
    root.textContent = '可通过渲染器菜单选择对比展示';
  });
  return () => handle.dispose();
}
```

旧插件 API v1 入口保持；只新增目录、服务、4 个命令和 2 个具名 surface。没有替换普通 Markdown HTML 安全策略、原生循环或用户输入。旧配置缺失新键时预览/核心 HTML/空状态为产品默认；损坏或未来格式由既有偏好存储保护，旧不兼容值不删除；扩展停用/移除仍保留其选择与控件状态。状态作用域为 `[sessionId,canonicalPath]`，同会话同文件的原文/译文共享，独立会话分开。相同路径文件更新保留状态，由页面处理自家状态版本；删文件展示可恢复错误。没有强行记忆任意页面的私有 JavaScript 变量。

契约快照仅增加本次声明和入口；接口语义、异步释放、目录消费及持久化均审阅。测试：`tests/visualizations.test.ts`、`scripts/test-visualizations-ui.mjs`、`scripts/test-visualizations-native.mjs`，以及 Markdown、翻译、HTML preview、UI preferences、原生/API 启动和小上下文摘要回归。真实批准 ZIP 经生产宿主和 renderer 加载，检查调用、目录选择、多实例、替换、多插件、激活失败、迟到结果、停用/重启用/包删除。详细结果和未验证边界见文档 16。
<!-- inline-visualizations-20260930:end -->


<!-- ui-persistence:start -->
## UI preference memory and clean release defaults (2026-09-30 JST)

Pre-implementation interface review: affected commands are the new preference read/update/quit-flush routes and existing desktop actions, state/theme/appearance, file readers, settings tabs and plugin lifecycle. The new `ui.preferences` and `desktop.window-state` production service instances are registered before plugin activation. Renderer components consume one `UiPreferenceClient` and its actual registry, initialized before mounting the application. User preference data is separate from plugin code and the executable. Existing theme/font/runtime/provider catalogs remain authoritative; no new hard-coded catalog replaces them. See [the full node inventory](37-ui-state-persistence.md) for scopes, existing persistent owners and concrete transient exclusions.

### Feature coverage matrix

| Capability | Call existing behavior | Register an additional implementation/option | Replace existing behavior and release |
| --- | --- | --- | --- |
| Core layout/read/settings preferences | Renderer `api.uiPreferences.get/set/reset`; host `ui-preferences/get/update` | `api.uiPreferences.register(definition)` creates a typed `plugin:<owner>/<id>` key, consumed by the same get/set/subscribe path in a plugin's actual named surface/settings page | `api.uiPreferences.override(id, resolve)` layers an effective value over saved values; cleanup restores remaining layers/core without rewriting user data |
| Window size, state and zoom | The same four `window.*` preferences reach the actual native window; existing `desktop/action` remains valid | Host service registry supports a registered window restoration/capture implementation on the production `desktop.window-state` instance; no selector catalog is introduced | `api.services.intercept/override('desktop.window-state', ...)` affects actual restore/capture/flush; `ui.preferences.get/update` is the actual host store; retain explicit cleanup |
| Mounted/later UI instances | All migrated hooks share the client subscription and scoped keys | New named preference registration can be bound to any registered settings page or existing multi-instance surface | Existing `observeSurfaces` contracts remain; live changes and layer disposal notify all consumers. No private React import or arbitrary selector is required |
| Read/write failure display | `ui-preferences-status` surface: `[data-workbench-ui-preferences-status]` | Standard multi-instance surface registration | Replace only the status surface; disabling restores core status; error display never grants overwrite permission |
| Durable data and upgrades | `UiPreferenceSnapshot` schema version 1, independent file in the device profile | Namespaced plugin keys retain values while their definitions are absent | Per-key revisions reject stale writes; disable/uninstall removes contribution code and subscriptions, not user values. Reenable restores compatible values; incompatible values remain raw with default fallback |

### Types, parameters and return values

Public definitions are in `packages/ui-preferences/index.ts` and `window.ts` and included in the contract snapshot. `UiValue` is bounded JSON (finite numbers, no prototype keys); `UiPreferenceDefinition` contains `id`, `type`, `defaultValue`, optional numeric bounds, string choices and `nullable`. `UiPreferenceRead` returns `{value,revision,saved}`. A scope is an optional stable string, at most 4096 characters; omit it for global device preferences. IDs are not display labels and cannot change between renders.

- `ui-preferences/get({}) -> Promise<UiPreferenceSnapshot>` returns `{schemaVersion:1,revision,entries,error?}`. Each entry is `{revision,value?}` indexed by the encoded ID/scope pair. A reset leaves a revision tombstone.
- `ui-preferences/update({id,scope?,revision,value?,reset?}) -> Promise<UiPreferenceSnapshot>` validates and writes atomically. `revision` is the last observed revision for that exact key, not the document revision. `reset:true` removes its user value; otherwise `value` is required. Core keys are validated against their definitions; namespaced plugin values must satisfy bounded JSON and renderer definitions.
- `ui-preferences/flush-ready({token:string}) -> Promise<null>` acknowledges a host-issued graceful shutdown token after the renderer write queue drains. It is lifecycle plumbing, not an instruction to quit or a guarantee against forced process termination.
- `api.uiPreferences.list() -> UiPreferenceDefinition[]`, `get(id,scope?) -> UiPreferenceRead`, `set(id,value,revision,scope?) -> Promise<UiPreferenceRead>`, `reset(id,revision,scope?) -> Promise<UiPreferenceRead>`, `subscribe(listener) -> release` are the production renderer paths.
- `register(definition) -> {id,dispose}` accepts a local plugin key; the host-owned plugin ID determines its namespace. `override(id,resolve(value,scope?)) -> {id,dispose}` is synchronous, ordered, effective-only replacement. Invalid/throwing results fall back to the preceding value. Promises are invalid as preference values. Non-LIFO removal is supported.

Host services: `ui.preferences.snapshot/get/update/set/subscribe/flush` operate on the production store; `get` returns the effective host definition value, `set(id,value,scope?)` is for serialized host policies, and plugins should use revision-bearing `update` for user writes. `desktop.window-state.bounds/restore/capture/zoomChanged/flush` operate on the actual BrowserWindow with available display work areas. `dispose` is owned by application shutdown and must not be invoked by an extension. Methods are version-1 service contracts, not unrestricted compatibility promises for private fields. Renderer-only effective overrides apply to renderer consumers; native window policies use the host service replacement path or persisted `window.*` updates.

Events: a `PluginHostEvent` with `{type:'plugin',id:'workbench.ui-preferences',topic:'changed',payload:UiPreferenceSnapshot}` follows writes/conflicts, while `topic:'flush'` carries a shutdown token. `api.uiPreferences.subscribe` also fires for registry changes. Listeners must be read-only/idempotent unless handling an explicit user action; notifications are not a model-task trigger.

Permissions and errors: ordinary device-local UI preference access needs no new OS/network/account permission; plugin code still requires the existing complete-package approval and activation lifecycle. Keys do not authorize access to files, accounts, workspaces or another device. Errors include `UI_PREFERENCE_KEY_INVALID`, `UI_PREFERENCE_VALUE_INVALID`, `UI_PREFERENCE_DEFINITION_INVALID`, `UI_PREFERENCE_DUPLICATE`, `UI_PREFERENCE_UNREGISTERED`, `UI_PREFERENCE_REVISION_INVALID`, `UI_PREFERENCE_CONFLICT`, `UI_PREFERENCE_LIMIT`, `UI_PREFERENCE_READ_FAILED`, `UI_PREFERENCE_WRITE_FAILED`, and `UI_PREFERENCE_STORAGE_UNAVAILABLE`. API calls after plugin disposal reject through the existing lifecycle guard. The original invalid file is not overwritten.

```js
export function activate(api) {
  const density = api.uiPreferences.register({
    id: 'reader-density', type: 'number', defaultValue: 2, min: 1, max: 4
  });
  api.observeSurfaces('file-reader', 'after', ({root}) => {
    const input = document.createElement('input');
    input.type = 'range'; input.min = '1'; input.max = '4';
    const render = () => { input.value = String(api.uiPreferences.get(density.id).value); };
    input.onchange = async () => {
      const current = api.uiPreferences.get(density.id);
      await api.uiPreferences.set(density.id, Number(input.value), current.revision);
    };
    root.append(input); render();
    return api.uiPreferences.subscribe(render);
  });
  const policy = api.uiPreferences.override('reader.wrap', () => true);
  api.onDispose(() => { policy.dispose(); density.dispose(); });
}
```

Compatibility/migration: existing state.json and native settings owners are unchanged. Sidebar and address-mask localStorage values migrate only if no central entry/tombstone exists. Missing definitions/pages/views retain saved IDs; responsive clamps and display fitting never persist temporary fallback sizes. Default values remain explicit product constants and are not sampled from a developer machine. Old plugins need no new methods; additive declarations, the optional `AccountCardProps.preferenceScope` (local/host/generation separation), and one named status surface are reviewed in the snapshot. Child disclosure scopes include their actual session/child identity. The existing `active-turn-progress` / `file-change-capsule` surfaces remain stable; symmetric minimum side columns keep the capsule centered when a remembered wide reader narrows the conversation. This is derived layout, not a new saved choice or selector catalog. Original `details`, `textarea`, classes, aria roles and existing surfaces stay in place; the new wrappers add stable `data-ui-memory` identities. Persisted disclosure behavior supersedes older historical statements that it was mount-only. Live process visibility and credential/import/export defaults retain their safety semantics.

Validation locations: `tests/ui-preferences.test.ts`, `scripts/test-ui-preferences-ui.mjs`, `scripts/check-ui-preferences.mjs`, and affected desktop/sidebar/reading regressions. A genuinely approved/activated synthetic ZIP must exercise get/set, a registered control, native consumption, multiple instances/plugins, late completion, registration failure, disable, reenable and package removal. Testing uses isolated profiles only. No release installer, public update feed or remote deployment is created by this change; final evidence and limits are recorded in document 16.
<!-- ui-persistence:end -->


<!-- memory-receiver:start -->
## 接收方各自归纳的职责修正（2026-09-30 JST）

本节取代此前“一个后台会话处理双向积压”的设计与验收解释。统一调度不能代替接收方职责：Codex 原生会话仅接收 Claude 来源，Claude Code 原生会话仅接收 Codex 来源；各自检查自己的既有记忆与规则，完成英文归纳和语义去重。文件格式、哈希和索引可达性检查不能证明另一个运行时的规则得到遵循。运行时按绑定身份区分，不按模型名字或供应商推断。

### 先行接口审查与功能覆盖矩阵

| 能力 | 调用现有能力 | 注册新实现或选项 | 替换及生产消费路径 |
| --- | --- | --- | --- |
| 接收方默认模型 | `native.memory-default.resolve(context?, recipient?)` | 复用生产模型目标目录及 `runtime/select`；不新增硬编码模型、账户或提供方目录 | `services.intercept/override` 替换真实 resolver；明确提交及手动 process 都传接收运行时，返回绑定不匹配时拒绝 |
| 按方向启动及串行调度 | `native-memory/process({runtime?})`；`native.memory-background.startReceivers(targets, submissionId, {retry?})` | 既有具名宿主命令注册可组合调度；`registerExecutor` 注册真正被准入消费的执行实现 | 替换 background 服务方法或注册执行器；一次冻结两份清单并保留租约，两个独立原生会话顺序执行 |
| 读取、归纳、落盘与验证 | `task.read/store/verify`；`native.memory-reference-writer.store` | `registerExecutor({mode:'consolidation',supports,run}) → dispose` | 原生执行器读取接收方指南；宿主按已发放 ID 和接收身份拒绝跨方向读取/写入，writer 继续可替换并须返回通过回读核验的证据 |
| 状态、事件和界面 | `native-memory/get`、`tasks/list/cancel`；background `changed`、`admission/admissions/busy` | 既有 `memory` 设置页及具名设置页注册接口 | 替换/挂载 memory 设置页；核心消费者显示各方向待收和缺失默认模型，串行租约期间禁用重复提交；无新增 UI surface 或网络资源 |

### 类型、参数和返回值

- `MemoryDefaultChoice={targetId:string,selection?:NativeModelSelection}`；`AppState.nativeMemoryDefaults?:Partial<Record<'codex'|'claude',MemoryDefaultChoice>>`。选择变更前后在现有串行 `StateStore.update` 中保留两家的明确选择；当前新任务选择优先，另一家使用其最后明确选择。目标须仍存在、ready 且 runtime 匹配，不猜测另一账号、映射或供应商。
- `resolve(context?:Pick<Session,'projectId'|'projectPath'|'permissionMode'>, recipient?:'codex'|'claude') → Promise<MemoryTaskBinding>`。省略 recipient 保留旧的“当前默认”调用；核心接收调度总是传入。权限取对应运行时的既有偏好，触发任务的 read-only/plan 只会进一步收紧；不继承触发聊天的模型。
- `native-memory/process({runtime?:'codex'|'claude'}) → Promise<{started:boolean,taskId?:string,reason?:string}>`。旧 `{}` 可用，尝试两家已明确配置的接收方；可单独指定一个方向。`started:true` 表示调度被接纳，不表示两个模型都已运行或记忆已接收。
- `startReceivers(targets:MemoryTaskBinding[], submissionId:string, options?:{retry?:boolean})` 返回上述准入结果。接受一至两个运行时不重复的绑定；按传入顺序执行。既有 `start` 保留且只处理其绑定接收方；不声明 mode 的旧执行器继续使用旧的分批协议。
- `NativeMemoryStatus` 新增 `backgroundRunning?:boolean` 和 `backgroundAdmissions?:Partial<Record<'codex'|'claude',MemoryBackgroundAdmission>>`；admission 新增可选 `runtime`。新 consolidation 任务记 `recipientRuntime===runtime`。`changed` 仍通知任务生命周期；`get` 读取准入和租约状态，不新增后台模型请求或前台消息。
- consolidation manifest 新增 `recipientRuntime`、`receiverGuide`，`nativeMemories` 仅列接收方，`entries` 仅包含已冻结的对方档案。`read({nativePath})` 不开放另一方原生库；`read({archiveId})` 与 `store({entries})` 在任何写入前拒绝未发放 ID。`prepareConsolidation` 必须只传一个接收方。

### 权限、生命周期与兼容

服务替换和执行器注册仍需完整批准的宿主插件；示例仅用于隔离测试。`registerExecutor` 返回幂等释放函数；串行调度冻结选定实现，释放其中任一被占用实现会取消其活动任务及剩余调度，不在同一调度中静默换用核心执行器。后续明确任务可重新解析已恢复的核心实现。插件注册失败无副作用；多个注册继续后者优先。

设备内只有一个后台租约，冻结两方的目标和档案后才启动。第一方已启动但失败、审批阻塞、取消或结果未知时，停止后续派发；没有启动的空清单、关闭状态或未变化工作可跳过，让独立接收方接受准入检查。`cancelAll` 在档案收集尚未结束时也须取消随后形成的调度；关停、停用和迟到 read/store 均不再写入。相同失败工作不因新聊天自动重投；明确 process 可重试。普通原生工具往返不是“一次 HTTP 请求”，本接口不提供账号风控保证。

新增错误：`MEMORY_BACKGROUND_RECIPIENT_MISMATCH`（绑定/交接身份不一致）、`MEMORY_CONSOLIDATION_RECIPIENT_REQUIRED`（不是单一接收方）。保留 DEFAULT_UNAVAILABLE、ARCHIVE_NOT_ISSUED、NATIVE_NOT_FOUND、BACKGROUND_CANCELLED/EXECUTOR_REMOVED、READ_ONLY 等已有错误及逐条回执反馈。源文件并发修改、原生开关和原始权限继续在真实写入前核实；已核验成功的独立条目保留，未核验条目仍待收。

旧状态没有按运行时保存的默认值，只能可靠恢复其中当前明确选择的一方；另一方须通过现有新任务选择器选择一次。目标暂时缺失/禁用不会删除保存选择，恢复 ready 后可重新使用。持久状态仍归现有版本 1 StateStore 原子文件所有，无新的 UI 偏好副本或个人默认值。此次没有新可调 UI 控件；状态提示和运行禁用均为派生值，不持久化。首次来源单选和管理弹窗沿用原有范围，本次未调整。

旧任务日志及过去回执保留，不自动重开或重写。新 workKey 加入 receiver-v1，旧双向任务不会错误抑制修正后的单方向任务。历史没有 recipientRuntime 的行仍可读；不能将其解释为当时已由正确接收方归纳。契约快照审阅新增类型/可选字段和 resolve 的可选参数；旧插件忽略 recipient 并返回另一运行时，核心会明确拒绝，不按旧语义继续。具名设置页、选择器和 host 方法名不变，无 DOM 迁移。

```js
export function activate(api) {
  api.registerCommand('receive-in-codex', () =>
    api.call('native-memory/process', { runtime: 'codex' }));
  api.onDispose(api.services.intercept('native.memory-default', 'resolve',
    (next, context, recipient) => next(context, recipient)));
}
```

测试：`tests/memory-consolidation.test.ts` 验证两方独立会话、136 份串行积压、默认选择持久化、缺失/停用恢复、跨方向访问拒绝、冻结清单、失败停止、收集期间取消、执行器释放及旧协议恢复；完整批准/激活的临时 ZIP 插件经公开 process → 生产默认解析 → 注册执行器 → writer 分别接收两方数据，停用/重启用不产生前台聊天。`scripts/test-memory-consolidation-native.mjs` 验证安装的两家 CLI、隔离 home、模拟推理、仅本方落盘及新项目的原生文件发现；`scripts/test-memory-consolidation-ui.mjs` 验证方向说明、缺失默认提示、租约间隙禁用和明/暗窄界面。发布边界及完整检查结果见文档 16；这些测试不证明真实模型语义无损，也不表示已处理实际用户积压。
<!-- memory-receiver:end -->


<!-- activity-batches:start -->
## 2026-09-30 · 默认折叠的实时事件批次（U108）

### 先行接口审查与功能覆盖矩阵

| 能力 | 调用现有能力 | 注册新实现／选项 | 替换现有实现与生产路径 |
| --- | --- | --- | --- |
| 实时事件分组与摘要 | renderer `api.activities.group(entries)` | `api.activities.register({id,classify})` 返回具名 `{id,dispose}` | 同一个 `ActivityGroupingRegistry` 被主会话 `ConversationReading` 和原生子会话 `NativeChildConversation` 消费；后注册分类优先，订阅通知重算 |
| 批次 UI、展开与回合结束 | `api.activities.subscribe(listener)`、`state/get` / `state/onState` | `observeSurfaces('activity-group', placement, render)` 支持新实例 | `activity-group`、`turn-process` 具名多实例 surface 可局部替换；停用恢复原节点，异步迟到挂载释放 |
| 原生事件、状态、资源 | 继续读取 `Session.activities`、现有原生事件服务 | 原生事件 presenter 与既有语义服务接口不变 | 没有新宿主命令、运行时枚举、模型请求、网络资源或持久配置；本次仅调整读取呈现，相关新增注册目录不适用 |

### 契约、生命周期与迁移

沿用 `ActivityGroupingEntry={id,activity?}`、`group<T>(readonly T[]) → ActivityGroup<T>[]`，返回 `{id,items,label,diagnostic,attention}`。**本节替代前文“只分组已完成活动，运行中／失败形成边界”的呈现约定。** 普通批次从第一条记录起默认折叠，以首条记录 ID 定位；同 runtime、child、turn 的连续命令、读取、搜索、编辑和普通工具合成一批，状态及输出更新不改变核心分组 key。正文、审批、协作消息、独立运行时提示、看图及生图产物保留边界；诊断仍独立汇集，不拆散普通批次。

`label` 在运行时显示最后加入且尚未结束的动作与公开标题；该动作结束后，仍有更早并行活动时回显那个动作。全部结束后显示计数与组合摘要，例如“运行了 2 个命令并编辑了文件”。失败编辑不声称已改文件，`attention` 包括失败、取消和结果未确认；UI 明确显示各状态计数，不因折叠隐藏异常结果。摘要单行省略长标题，可聚焦或展开读取详情；不改变原生输入／输出或历史顺序。

`register({id,classify})` 同步返回 `{key,label}|undefined`，命名、参数限制、后注册优先、异常／无效／Promise 回退、失效 API 拒绝与 `dispose` 语义不变。分类现在会接收普通活动的所有生命周期状态；旧规则可继续使用。希望批次稳定的规则应按工具语义而非 `status` 构造 key，返回的插件标题保留，运行时追加当前动作；插件主动改变分组键可能重建批次。`subscribe(listener) → release` 通知已有视图重算。用户展开状态只保留于当前挂载实例；插件改变结构或重新进入聊天时重新应用默认值，不写原生历史或偏好。

`activity-group` 原 selector、`data-group-id`、`data-group-kind=tools|diagnostic` 不变，增加只读 `data-group-status=running|attention|settled`，单条活动现在也有批次容器；不要依赖私有内部层级。`turn-process` 在实时与已结束状态均为同一 `details`，实时外层保持展开而内层批次默认折叠；结束时保留容器、批次及手动展开，不再整体骤然收起。重新加载历史回合仍默认折叠。原计时器和错误 surface 保留；没有更改计时事实或后台停止语义。

错误仍为 `ACTIVITY_GROUP_RULE_INVALID`、`ACTIVITY_GROUP_RULE_DUPLICATE` 与已有失效 API 错误。权限沿用完整 ZIP 包批准和 renderer 激活流程，不增加系统、模型、原生安装或跨设备权限。公开 TypeScript 声明和具名 selector 未变，契约快照无需刷新；上述语义、DOM 容器和生命周期迁移须结合行为测试审阅。

```js
export function activate(api) {
  const rule = api.activities.register({
    id: 'shell-and-edits',
    classify: activity => ['command', 'file-edit'].includes(activity.kind)
      ? {key: 'work', label: '项目检查与修改'} : undefined,
  });
  const unsubscribe = api.activities.subscribe(() => {
    // Re-read api.activities.group(entries) for a custom reader.
  });
  api.onDispose(() => { unsubscribe(); rule.dispose(); });
}
```

测试位置：`tests/activity-batches.test.ts`、`tests/native-event-semantics.test.ts`；真实导入／批准／激活的合成插件和生产 observer／renderer 路径在 `scripts/test-native-events-ui.mjs`，计时回归在 `scripts/test-turn-timing-ui.mjs`。覆盖状态更新、混合摘要、异常、正文／审批／媒体边界、旧分类、并行活动、多插件、注册失败、迟到挂载、停用重启用及包删除。仅在隔离隐藏 Electron 和临时资料目录验收；不安装开发插件到实际用户环境。最终证据与未验证边界见文档 16 的同名记录。
<!-- activity-batches:end -->

<!-- runtime-effort:start -->
## 切换原生运行时保留 API 模型思考档位（2026-09-30 JST）

接口先审：受影响范围为 `model-targets/list`、`runtime/select`、`session/model-target`、`session/model`、`state/get`，既有 `lastSelectedRuntime/lastModelTargetId/lastModelSelection/lastModelHostId`、会话 `modelSelection/modelLanes`、状态广播，以及输入框运行时与模型选择器。问题在于只切换运行时却取了目录默认 selection，且会话切换此前只处理官方账号传入的 selection。没有新增模型/档位目录、资源、公开方法、界面结构或持久字段。

### 功能覆盖矩阵

| 功能 | 调用现有能力 | 注册新实现或选项 | 替换与生产连接 |
| --- | --- | --- | --- |
| 草稿保留模型参数 | `runtime/select({runtime,targetId,selection}) → Promise<AppState>` | 沿用模型来源接口与 `api.runtimes.register`；本次不增加运行时或档位选项，档位来自模型目录 | 输入框查找同一 API 来源/映射的目标运行时，传递当前 selection；宿主写入原偏好字段，`state/get` 与新会话、重启读取同一值 |
| 已有会话切换 | `session/model-target({sessionId:string,targetId:string,selection?:NativeModelSelection}) → Promise<Session>` | `api.useHost(handler) → dispose` 可注册此路由的选择策略；现有运行时注册目录和执行适配器不变 | 完整包批准后生产 dispatcher → controller 校验 → 同一会话/模型 lane → 状态广播 → 实际模型控件；显式参数同时更新最后选择 |
| 调用与策略叠加 | 宿主 `api.call` 调用核心，`api.invoke` 经其他插件的宿主中间件 | 具名插件方法可委托上述已有路由 | `api.useHost` 通过 `next({...request,payload})` 替换参数；释放/停用恢复剩余策略和核心行为，不能直接改用户原生模型配置 |
| 选择器及状态 | 既有 `composer` surface，renderer `api.onState` | 既有多实例 surface 注册/替换接口 | 参数策略通过上述具体宿主路由替换；本次不改控件结构或样式，旧定位无需迁移，不把私有 CSS 选择器作为稳定接口 |

`NativeModelSelection = {model:string,effort?:string,serviceTier?:string}` 沿用现有类型。本次将可选 selection 的校验范围从官方账号扩展到 API 映射：model 必须等于映射模型，effort 必须在当前目录支持范围，API 不接受 serviceTier。无效值在绑定/lane/偏好更新前拒绝，沿用“模型或思考档位已变化，请重新选择。”错误；官方账号错误规则不变。禁用来源、维护、运行中或结果未知、跨所有者切换继续走现有准入门禁，没有增加网络、账号或管理员权限。

只切换同一 API 来源和模型映射的 Codex/Claude Code 运行时时，UI 显式传入当前模型参数；显式参数优先于该会话目标 lane 中的旧档位。用户主动切换不同模型而不传 selection 时仍优先恢复目标 lane，其次模型默认值，不把上一模型档位复制给不同模型。旧插件省略 selection 的行为保持兼容；显式仅传 model 不凭空补写 effort。官方账号与 SSH 跨厂商不能由同名模型推断为同一来源。

~~~js
// Both IDs must refer to the same API source and model mapping.
const state = await api.call('state/get');
const current = state.sessions.find(item => item.id === sessionId);
await api.invoke('session/model-target', {
  sessionId, targetId: otherRuntimeTargetId, selection: current.modelSelection
});
~~~

生命周期与兼容审查：无持久格式变更，旧偏好和旧会话无需迁移；已被旧版本覆盖的档位不能猜测恢复，用户重新选择后沿用既有保存链。未新增异步插件注册或后台任务；模型目录旧结果围栏与 runtime 插件迟到回执继续由既有测试覆盖。停用、激活失败、包缺失/卸载不清除已保存模型参数；重新启用只恢复策略，不自动执行模型。局部 UI 多实例和异步挂载未改动，本次不重宣其视觉验收。契约声明、具名 surface 与方法名快照无变化，已审查 selection 的新增 API 语义而非刷新快照绕过检查。

测试位置：`tests/runtime-effort.test.ts` 验证双向切换、显式覆盖旧 lane、非法值不写入、原调用兼容、落盘回读及真实批准 ZIP 的调用/策略叠加、已有/后来会话、停用/重新启用和激活失败清理；`scripts/test-runtime-effort-ui.mjs` 使用生产 renderer/host 的独立隐藏 Electron 验证空草稿、已有会话、往返切换、新会话和实际进程重启。邻接回归覆盖官方账号、运行时偏好、插件运行时与输入框异步目录；完成结果和未验证边界见文档 16。
<!-- runtime-effort:end -->

<!-- memory-consolidation:start -->
## 默认模型单会话记忆整理（2026-09-30 JST）

先审范围：默认新任务选择 `lastModelTargetId/lastSelectedRuntime/lastModelSelection`、`model-targets/list`、明确发送任务的后台入口、`native-memory/get`、任务列表/取消、原生工具、存储与回执、记忆设置页。此次明确需求取代旧“复用触发聊天模型、按接收方分批启动会话”的默认策略；保留档案、原始来源、设备与权限边界。模型负责英文归纳和语义去重，程序负责路径、来源标记、哈希、并发核验及回执。

### 功能覆盖矩阵

| 功能 | 调用 | 注册新的实现或选项 | 替换与实际消费方 |
| --- | --- | --- | --- |
| 默认模型选择 | `native.memory-default.resolve(context?) → Promise<MemoryTaskBinding>` | 复用生产模型目标注册目录；本次没有新增模型名单或提供方选项 | `api.services.intercept/override('native.memory-default', ...)` 修改实际 resolver；控制器的自动入口与手动命令都调用此实例 |
| 明确启动与状态 | `native-memory/process({}) → Promise<{started:boolean,taskId?:string,reason?:string}>`；既有 get、tasks/list、tasks/cancel | `api.useHost` 注册具名代理命令与准入策略 | `native.memory-background.start(target,submissionId,{retry?})`、`admission()`、`decline(reason)`；默认选项缺失拒绝启动，不偷偷改用当前聊天 |
| 整理执行 | `MemoryTaskExecutor.run(task)` | `native.memory-background.registerExecutor(executor) → dispose`，`mode?:'consolidation'`，`supports(target):boolean` | 后注册且 supports 命中的实现优先；真实调度按 mode 选择单会话或旧批次协议，释放时取消该执行器所属活动任务 |
| 原生引用存储 | `native.memory-reference-writer.store(homes,archive,entry,assertActive) → Promise<MemoryConsolidationEvidence>` | `api.services.intercept/override` 注册具体 writer 策略，返回释放句柄 | `NativeMemoryService.referenceWriter → MemoryExchange.storeConsolidation → writer.store`；插件返回的证据仍经过真实文件/来源/可达性核验，不能直接盖章 |
| 记忆设置页与反馈 | 既有 `api.settings.open('memory')`，按钮调用公开 process 命令 | `api.settings.register({id,label,replaces:'memory',render})` 替换具名记忆页；无需修改核心源码 | 核心页消费相同任务/准入数据；显示默认模型不可用、避免重复请求、存储冲突，运行中禁用手动按钮。沿用设置页多实例与释放机制，没有新增私有 DOM 契约 |

`MemoryTaskBinding` 保留 binding、可选 modelSelection、permissionMode、projectPath。`MemoryDefaultService.resolve` 的 context 仅含 projectId、projectPath、permissionMode；沿用默认运行时对应权限偏好，触发聊天的 read-only/plan 只能收紧为只读。执行位置来自默认目标，不根据模型名、厂商或 URL 推断；核心原生执行器仍仅支持已接入的本机 Codex/Claude，远端不因插件或引用而获得权限。

`MemoryTaskExecution` 保留 `sessionId,target,prompt,signal,read,verify`，新增可选 `store(input)`。新模式 read 接受 `{}` 返回冻结目录，或 `{archiveId,offset?,limit?}` / `{nativePath,offset?,limit?}` 分页；nativePath 只允许发现的原生记忆路径，limit 为 1–24000 字符，默认 12000。store 的 `MemoryConsolidationInput={entries:MemoryConsolidationEntry[]}` 一次 1–24 条；entry 含已签发 archiveId、英文 title/content、可选稳定英文 topic slug。宿主决定接收方与路径；返回 `{verified,total,entries:[{archiveId,state:'verified'|'pending',code?}]}`。模型不得填写哈希、回执、目标文件或伪造来源标记。每份档案最多两次 store 尝试，显式 verify 最多两次；普通工具交互不等于另起后台会话。

新模式冻结最多 1500 份双向档案，设备内一次只有一个活动后台任务，最长 30 分钟。相同有效绑定、模型参数、权限和待收 IDs 形成 workKey；新聊天及重启不再次提交未变化的工作。process 命令是用户明确重试一次；模型或待收内容改变也允许新的明确任务触发。没有失败传输自动续投、换账号、另派子 Agent 或轮询模型。后台专用 CLI 进程临时停用自身自动记忆生成，避免记录整理过程；不改用户设置或前台进程。

原生引用放在 Codex `$CODEX_HOME/memories/received/` 或 Claude `$CLAUDE_CONFIG_DIR/memory/received/`，按原来源范围与 topic 分文件。有效 Codex 用户 `AGENTS.override.md`/`AGENTS.md`、Claude 用户 `CLAUDE.md` 仅加一条短引用，指向按需读取的 `received/INDEX.md`，再到主题正文。不改两家已有生成索引；Claude 200 行/25 KB 的自动 MEMORY.md 加载上限不成为接收总容量。原生入口保守上限 30000 字节、主题/目录各 2 MiB；超限拒绝而非截断。核验必须从入口到目录再到实际带范围的正文，目录自身不能充当正文证据。

这是工作台的原生可读文件适配，**不是官方跨厂商导入 API，也不证明官方自动归纳已运行或语义召回成功**。已有引用随用户指令文件可独立读取；关闭 Auto Memory 或工作台交接不会删除/禁用这条已有引用。原生设置控制新接收准入，未知/关闭时保守拒绝相应接收；当前所选执行运行时的原生记忆关闭也不启动核心整理器。原文管理可检查已有文件。写入保留无关文本、拒绝链接/硬链接、在替换前后回读检测并发修改；多文件写入不是事务，失败时可能留下未盖章的部分引用，后续明确重试核验。

错误与反馈：`MEMORY_BACKGROUND_DEFAULT_UNAVAILABLE`、`BUSY`、`UNCHANGED`、`EMPTY`、`READ_ONLY`、`DISABLED`、`BINDING_UNSUPPORTED`；参数/来源错误 `MEMORY_CONSOLIDATION_ARGUMENT_INVALID`、`MEMORY_HANDOFF_ARCHIVE_NOT_ISSUED`、`MEMORY_RECEIPT_SOURCE_CHANGED`；存储错误 `MEMORY_CONSOLIDATION_INDEX_BUDGET/NATIVE_CHANGED/STORAGE_FAILED`。receiptIssues 沿用已声明枚举；模型工具英文，UI 中文。后台 `changed` 事件发布任务状态；任务列表与 native-memory/get 返回相同真实实例的数据，准入反馈另存于内存中的 backgroundAdmission，不包含聊天或凭据。

~~~js
export function activate(api) {
  api.registerCommand('organize', () => api.call('native-memory/process'));
  api.onDispose(api.services.intercept('native.memory-reference-writer', 'store',
    async (next, homes, archive, entry, assertActive) => {
      await assertActive();
      return next(homes, archive, entry, assertActive);
    }));
  // An executor can opt into mode: 'consolidation' and use task.read/store/verify.
  // Register its disposer with api.onDispose; never acknowledge files itself.
}
~~~

兼容/生命周期：省略 mode 的旧插件继续使用每会话 12 条、每次最多 120 条的旧接收方协议，read/verify 不变。journal/ledger 保留版本号，新 mode/workKey/backgroundAdmission 均可选；旧任务启动后仍标为 uncertain，不补发。多插件按后注册优先，停用恢复前一执行器并 abort 活动任务，signal 在每次写入前检查；激活失败的注册由插件资源生命周期释放。卸载不删除记忆/档案。原有 UI testid 保留，新增 memory-process 仅是测试定位，不声明为插件 surface；通过公开命令或具名 memory 页接入。未改通用设置页挂载引擎，其异步、多实例行为不在本次重新宣称验收。

测试：`tests/memory-consolidation.test.ts` 覆盖 136 条双向单会话、默认身份/档位、重启/重复抑制、租约/取消迟到写入、并发保护、长主题目录、断链拒绝、真实批准 ZIP 插件通过 production controller/default/writer/执行器完成写入、停用/重新启用与旧执行器恢复。`scripts/test-memory-consolidation-native.mjs` 使用安装的两家 CLI、隔离目录与回环模拟推理，验证原生工具、同会话双向盖章、新目录启动入口与原生文件读取；`scripts/test-memory-consolidation-ui.mjs` 验证隐藏 Electron 明/暗窄界面、一次手动请求、运行禁用与准确失败提示。旧 memory-background/handoff/receipts 测试保留。契约快照新增公开类型和 process 方法；完成数量与边界见文档 16。
<!-- memory-consolidation:end -->

<!-- fork-routing:start -->
## 按 Git 状态选择分支入口（2026-09-30 JST）

接口先审：本次覆盖回复分支按钮、侧栏分支动作、位置选择器、session/fork-options、session/fork 与生产 actions.worktrees.inspect。沿用现有会话身份、历史边界、创建锁、Session.branch/worktree 和 state 通知；没有新增运行时、持久配置、资源或 location 类型目录。第三方可调用已有能力、注册局部视图或检查策略，并替换实际检查/界面消费方；没有仅供核心调用的新分支。

| 功能覆盖 | 调用现有能力 | 注册与替换、生产连接 |
| --- | --- | --- |
| 检查及默认交互 | api.call('session/fork-options',{sessionId:string,messageId?:string}) → Promise<{busy?:boolean,workspace:WorktreeInspection,worktree:WorktreeInspection}> | actions.worktrees.inspect(directory:string):Promise<WorktreeInspection> 经 api.services.intercept/override 注册；真实 controller、App 分支预检、侧栏与弹窗共用检查结果，释放句柄或停用恢复核心服务 |
| 创建分支 | api.call('session/fork',{sessionId,messageId?,location?:'workspace'\|'worktree'}) → Promise<Session> | api.useHost(handler) 可包装相同生产路由；沿用批准包与运行时/工作树验证，不以 UI 检查替代宿主创建门禁 |
| 回复与侧栏入口 | api.observeSurfaces('session-fork-action',placement,render) → dispose | [data-workbench-fork-action] 覆盖每条已完成回复及后来打开的侧栏入口；稳定 data-session-id 与可选 data-message-id 提供准确参数；可注册 before/after 内容或 replace 局部实现 |
| Git 位置选择器 | api.observeSurfaces('session-fork-picker',placement,render) → dispose | [data-workbench-fork-picker] 同时覆盖弹窗选择区及侧栏子菜单；相同会话/消息元数据；普通目录不创建此 surface，扩展应同时支持直接动作入口 |
| 创建后状态与生命周期 | api.call('state/get')、api.onState(listener) → dispose | 原会话保留，新会话按既有 state 事件公开；界面多实例释放、异步 signal、激活失败恢复与多插件叠加沿用生产 surface 管理器 |

默认语义：按会话已绑定目录调用 Git 检查，非 Git/无目录且 workspace.available=true 时单击直接以 workspace 创建；Git 工作区才提供二选一。已识别 repositoryRoot 但没有提交、存在冲突或受支持限制时，仍保留 Git 选择及禁用原因。Git 子目录与已管理工作树按 Git 实际结果识别，不靠 .git 目录猜测，也不随项目重命名/移动重新绑定会话。检查失败或源会话不可分支时显示错误，不自动创建；预检期间连续点击只派发一次，切换会话后丢弃迟到结果。侧栏悬停只检查/展示，从不创建。

WorktreeInspection 仍为既有类型，available 控制能否创建工作树，repositoryRoot 是已识别仓库的证据，不代表可创建；此次在后续检查失败时也保留已识别 repositoryRoot。旧插件仅返回 available 时仍兼容：available=true 继续显示选择；available=false 且无 repositoryRoot 走普通聊天。希望保留 Git 禁用解释的检查器应同时返回 repositoryRoot 与 reason。未知或错误不得伪装成工作树可用；缺少服务/路径的原有原因保留。显式 location 调用、旧会话持久格式与创建后的通知不变，没有增加模型执行、Git 初始化、网络或管理员权限。

~~~js
api.services.intercept('actions.worktrees', 'inspect', async (next, directory) => {
  const result = await next(directory);
  return result; // Preserve repositoryRoot when a recognized repository is unavailable.
});
api.observeSurfaces('session-fork-action', 'after', ({ root, target, signal }) => {
  const button = document.createElement('button');
  button.textContent = 'Create chat branch';
  button.addEventListener('click', async () => {
    const payload = {sessionId: target.dataset.sessionId, messageId: target.dataset.messageId};
    const options = await api.call('session/fork-options', payload);
    if (!options.busy && options.workspace.available) await api.call('session/fork', {...payload, location:'workspace'});
  }, {signal});
  root.append(button);
});
~~~

注册类型沿用 SurfaceRenderer({root,target,signal})，可返回同步/异步清理函数；完整包批准、无效注册、服务缺失及宿主错误规则沿用 v1。停用/激活失败释放所有视图与服务层，恢复剩余插件或核心入口；重新启用重建视图，不删除已创建会话与工作树。无新增卸载入口或偏好，因此卸载的数据迁移不适用，已有包移除行为不变。现有两个 location 的业务语义固定，本次不新增可扩充选项目录；扩展检查策略和局部交互不需要修改核心。

兼容与快照审查：保留 fork-message-*、session-fork-submenu、session-fork-menu、fork-location-picker 等旧 test ID；普通目录不再挂载选择器，旧扩展应迁移到上述具名 action，不能假设每次点击都有 picker。契约快照仅增两个具名 surface；公开方法、签名和持久格式无变化，repositoryRoot 的失败返回语义已明确审查。

验证位置：tests/worktree-forks.test.ts、tests/session-fork.test.ts、tests/turn-actions.test.ts；scripts/test-session-fork-ui.mjs 与 scripts/fork-routing-ui-checks.mjs 使用独立隐藏 Electron、合成资料和真实批准 ZIP，覆盖普通项目/无目录/Git、键盘、重复点击、迟到检查、检查失败、宿主替换、已有与后来界面实例、多插件、异步清理、激活失败及停用/重启用。本轮隔离候选定向回归 40/40、隐藏 Electron 24/24、类型/插件契约/公开文档检查通过；详细证据与边界见文档 16，未用真实模型或远端任务替代插件证据。
<!-- fork-routing:end -->


<!-- configurable-shortcuts:start -->
## 可编辑键盘快捷键（2026-09-30 JST）

接口先审：原快捷键页只有固定说明；全局、侧栏、输入框和 Electron 菜单各自处理按键，没有可保存绑定的公开目录。本次将 25 个工作台动作接入同一个生产注册表，覆盖搜索、录制、添加别名、编辑、删除到未分配、单项及全部恢复、冲突显示、配置修订、菜单与提示同步。原有后退/前进、缩放和菜单说明拆成独立动作；剪贴板编辑、Tab/Esc 导航、输入法和核心插件恢复按键保留原生行为，不作为普通可替换绑定。只处理当前工作台窗口内的按键，不注册系统全局热键。

### 功能覆盖矩阵

| 功能 | 调用现有能力 | 注册新实现或选项 | 替换与实际消费方 |
| --- | --- | --- | --- |
| 动作、多个绑定与执行 | renderer `api.shortcuts.list/getSettings/setBindings/reset/invoke` | `api.shortcuts.register(definition)` 返回稳定 `plugin:<owner>/<id>` 和释放句柄；设置页与键盘分发读取同一注册表 | `api.shortcuts.override(id,run)` 分层替换；实际按键及原生菜单点击经过同一调用链 |
| 持久化和并发保存 | `shortcuts/get`、`shortcuts/set`；状态字段 `AppState.shortcuts` | 新插件动作无需修改核心枚举；绑定按命名空间 ID 保存 | 既有 `api.useHost` 可拦截两个具体路由；正常消费经 controller → StateStore → onState → renderer 注册表 |
| 原生缩放、全屏、菜单和窗口动作 | `desktop/action({id}) → void` | 由已注册动作委托该路由；不新增系统菜单类型目录 | 快捷键动作覆盖或宿主路由拦截；菜单显示绑定来自同一持久配置，取消原生重复加速器 |
| 设置及录制界面 | `api.settings.open('shortcuts')` | `api.settings.register` 可新增设置页，通用多实例 surface 可挂载新内容 | 具名 `shortcuts`、`shortcut-recorder`；`observeSurfaces(name,'replace',render)` 局部替换，`settings.register({replaces:'shortcuts',…})` 可整页替换 |
| 变更通知、失败及释放 | `api.shortcuts.subscribe(listener) → dispose`；既有 `api.onState` 与宿主 state 事件 | 每个新注册动作/覆盖自动进入通知及清理链 | 停用/激活失败/包缺失释放注册与所有挂载，恢复剩余覆盖层或核心实现 |

### 类型、参数和错误

公开类型位于 `packages/shortcuts/index.ts`、`apps/desktop/renderer/shortcuts.ts`。`ShortcutSettings = {version:1,revision:number,overrides:Record<string,string[]>}`；缺少动作字段继承默认，空数组表示明确删除，二者不可互换。每项最多 8 个组合键；没有用户改动时不写入默认配置。持久文件使用既有工作台 `state.json`，不写原生运行时配置。

- `shortcuts/get({}) → ShortcutSettings`；`shortcuts/set({revision,id?,bindings?,reset?:boolean}) → ShortcutSettings`。普通保存必须提供动作 ID 与数组；`reset:true` 重置指定动作，省略 ID 重置全部（含停用或缺失插件）。所有写入比较整数 revision，在 StateStore 串行写入内再次核验，成功加一并广播状态。读取不修改文件。
- renderer `list() → readonly ShortcutEntry[]` 返回 `id,label,description,scope,defaultBindings,bindings,customized,conflicts,owner?`；`getSettings()` 返回配置副本。`setBindings(id,bindings,revision)` 与 `reset(id|undefined,revision)` 返回 `Promise<void>`，先按当前真实注册目录验证，再调用上述持久接口。`subscribe` 在注册、释放和配置改变时通知，返回幂等释放函数。
- `register({id,label,description?,defaultBindings?,run}) → {id,dispose}`：局部 ID 与 owner 使用小写字母开头的字母、数字、点和连字符，最长 80；标签最长 120，描述最长 500。返回命名空间 ID，默认绑定可为空，新插件动作使用 global scope。`override(id,run) → {id,dispose}` 保留目标的元数据、绑定与作用域，仅替换执行实现；后注册者优先，任意顺序释放均恢复剩余层。
- `run(context) → void | Promise<void>`；context 为 `{signal:AbortSignal,invokeDefault():Promise<void>}`。覆盖可以委托下一层；新增动作没有默认实现。`invoke(id) → Promise<void>` 调用生产动作，输入框换行与侧栏菜单需要当前真实组件/焦点可用；核心弹窗打开时不执行工作台级动作。作用域为 `global | composer | sidebar`，插件不能通过登记 global 动作伪造输入框/项目上下文。
- 按键串使用 `Mod`（当前平台 Ctrl/Command）、`Ctrl`、`Meta`、`Alt`、`Shift`、字母、数字、标点、功能键及具名方向键等，如 `Mod+Alt+N`、`Alt+ArrowLeft`、`Mod+Plus`。普通键必须带主修饰键；`Shift+Enter` 只允许聊天换行。`+` 的 Shift 自动规范化，裸 Enter/Esc/Tab、剪贴板编辑、重载和核心恢复键不能覆盖。输入法组合、AltGr 和重复 keydown 不分发。Ctrl/Mod（macOS 为 Meta/Mod）别名按同一实际按键检查冲突。
- 常见错误：`SHORTCUT_INVALID_BINDING/BINDINGS/PATCH/ACTION`、`SHORTCUT_NEEDS_MODIFIER`、`SHORTCUT_RESERVED`、`SHORTCUT_DUPLICATE_BINDING/ACTION`、`SHORTCUT_UNKNOWN_ACTION`、`SHORTCUT_CONFLICT`、`SHORTCUT_REVISION_CONFLICT`、`SHORTCUT_UNAVAILABLE`、`SHORTCUT_DISPOSED`、`SHORTCUT_NO_DEFAULT`。失败不写入、不自动重试；设置页保留当前录制并显示中文错误。插件执行失败沿既有 renderer 故障处理停用和清理。
- `desktop/action` 接受 `zoom-in | zoom-out | zoom-reset | fullscreen | menu-file | menu-edit | menu-view | menu-help | close-window | quit-app`；其他值拒绝。仅操作当前工作台窗口/进程，不获得其他应用、设备、账号或管理员权限。插件仍须按完整工作台代码包批准；不将原生 Codex/Claude 插件载入此接口。

```js
export function activate(api) {
  const handle = api.shortcuts.register({
    id: 'open-tools', label: '打开扩展工具', description: '进入扩展设置',
    defaultBindings: ['Mod+Alt+T'], run: () => api.settings.open('plugins'),
  });
  api.shortcuts.override('search', async ({signal, invokeDefault}) => {
    if (!signal.aborted) await invokeDefault();
  });
  // User settings stay separate from the approved code package.
  const save = async () => {
    const current = api.shortcuts.getSettings();
    await api.shortcuts.setBindings(handle.id, ['Mod+Alt+J'], current.revision);
  };
  api.observeSurfaces('shortcuts', 'after', ({root,signal}) => {
    const button=document.createElement('button');button.textContent='设置工具快捷键';
    button.addEventListener('click',()=>{void save();},{signal});root.append(button);
  });
}
```

### 生命周期、兼容和验证边界

API v1 增量增加 renderer `shortcuts` 命名空间、两个 surface、三个宿主路由与 `DesktopCommand` 联合成员。旧插件不必使用新 API；旧工作台状态继承原有按键，新加入的会话归档/删除/置顶/未读/聚焦输入框默认未分配。公开声明、持久格式及具名 surface 已纳入契约快照，原有设置页 ID、旧宿主路由和 `onCommand` 签名保留。历史 `.shortcuts-list` 展示结构迁移到具名 `shortcuts` surface；行内私有类名和按钮结构不是扩展契约。

用户显式配置优先于动作默认值；停用、包缺失和升级保留绑定，重新注册相同命名空间 ID 后恢复。新加载插件的默认值若与已有动作冲突，设置页明确提示，核心动作优先；多个插件按注册顺序决定先到的绑定，不会一次触发两个动作。恢复默认若与其他活动动作冲突则拒绝覆盖。插件不在活动目录时不能经 renderer 修改其绑定；显式全重置可清除这些遗留记录。已接收的持久写入可能在停用后完成，停用不回滚用户配置；停用后旧 API 和迟到的默认委托被拒绝。异步 surface 渲染完成后仍执行清理，配置数据不进入代码 ZIP 导出。

测试位置：`tests/shortcuts.test.ts`（解析、默认迁移、作用域、冲突、并发、持久化、注册/覆盖与释放）；`scripts/test-shortcuts-ui.mjs`（真实导入/批准/激活合成 ZIP、设置选择器、实际按键、菜单、重启、未批准拒绝、多插件共存、多实例及后来挂载、注册失败、停用/重启用、迟到清理和包缺失）。包缺失通过隔离目录移走合成插件验证，不宣称本次新增了插件卸载界面。未操作活动客户端、真实模型、用户原生数据或远端设备；Windows 隐藏 Electron 证据不等同于 macOS/Linux 实机验收。未添加核心专用动作分发分支：第三方新增动作直接进入同一目录和执行链；固定分支仅对应确有固定语义的既有核心/窗口操作。
独立候选验收：TypeScript、插件契约门禁、公开文档检查通过；相关单元/协议回归 73/73、隐藏 Electron 专项 16/16，零 renderer errors。仅覆盖本轮候选，未将其他窗口未提交工作计入通过范围。
<!-- configurable-shortcuts:end -->

<!-- subagent-terminology:start -->
## Subagent 界面术语与局部扩展（2026-09-30 JST；U108）

先审接口：此次只把界面固定术语“子 Agent”改为 Subagent；覆盖详情标题、回复角色、缺省名称、参数说明、工具/审批标记、后台状态及设置提示。原生任务名称、正文、历史、运行时 ID 和消息字段不重写。无新增模型命令、服务方法、事件、状态、配置、选择目录或资源；不创建翻译/术语选项，因此“注册新的选项”不适用。插件仍可注册局部视图实现并替换实际消费方。

| 功能覆盖 | 调用已有能力 | 注册与替换、生产连接 |
| --- | --- | --- |
| 只读 Subagent 详情 | api.call('state/get') → Promise<AppState>；api.onState(listener) → 清理函数；读取 Session.nativeChildren 或 agentParent 关联的公开历史 | api.observeSurfaces('subagent-reader',placement,render) 对应真实 NativeChildConversation 的 [data-testid="child-reader"]；动态打开、嵌套与跨来源会话复用该节点 |
| 固定角色名称 | renderer 文本 Subagent；不作为会话或任务标识 | api.observeSurfaces('subagent-label',placement,render) 对应 [data-subagent-label]；每个详情标题和助手回复角色独立挂载，替换不修改消息正文 |
| 参数与来源说明 | NativeChildSnapshot.settings 与既有 ChildSetting 字段，缺失仍显示未知 | api.observeSurfaces('subagent-model-settings',placement,render) 对应 [data-testid="child-model-settings"]；沿用生产 ChildModelSettings，不影响实际模型设置 |

上述注册类型为 observeSurfaces(surface:string,placement:'before'|'after'|'replace',render:SurfaceRenderer):()=>void；render 接收 {root,target,signal}，可返回同步/异步清理句柄。完整代码包批准、Invalid plugin surface 校验和激活失败隔离沿用既有契约，无新增权限或错误码。目标移除、停用与失败释放所有实例、取消 signal、处理异步迟到清理并恢复核心可见性；重新启用重新挂载，不改变历史。没有新增卸载入口；现有多插件层叠与失败恢复机制不变。

~~~js
api.observeSurfaces('subagent-label', 'replace', ({ root }) => {
  root.textContent = 'Review agent';
});
~~~

兼容审查：API v1 的三个具名 surface 是增量；原有 child-reader、child-model-settings、child-agent-card 的 test ID、class 和导航行为保留。按中文可访问名称定位的扩展需由“子 Agent 会话/模型参数”迁移为“Subagent 会话/模型参数”，局部角色替换应迁移到具名 subagent-label。没有持久格式迁移或新增硬编码运行时分支；公开契约快照仅新增上述三项映射。

测试位置：scripts/subagent-terminology-ui-checks.mjs 经 scripts/test-child-reader-ui.mjs 执行，使用实际 ZIP 导入、批准与激活生命周期，检查两家运行时、多标签、后来打开的会话、无批准拒绝、异步迟到、停用/重新启用和历史不变；通用多插件/注册失败覆盖沿用 scripts/test-plugin-extensibility.mjs。运行命令：node --import tsx scripts/test-child-reader-ui.mjs。合成插件仅导入隔离验收资料，不安装到实际用户环境。
<!-- subagent-terminology:end -->

## 问答直接发送、待回答与忽略（2026-09-29 UTC；U107）

本节替代旧版异步问答 `onDraft(text)`／“填入回复”行为。所有问答均从卡片显式发送，不改写主编辑框、附件或技能。原生等待请求继续使用 `interaction/prepare`、`interaction/submit` 按原请求回应；消息附带异步问题使用下列受管输入接口，运行中仍受当前 turn/steer 能力约束，已结束后由用户明确发送新回合。没有自动续投。

### 功能覆盖矩阵

| 功能 | 开发接口、返回与验证 |
| --- | --- |
| 异步回答准备 | `draft/prepare({sessionId,questionReply:{messageId,answers},requestId?}) → Promise<DraftPreview>`；`answers:Record<string,string[]>`。宿主从存储的原问题校验并构造文本，拒绝同时提供 text、attachmentIds、skills、demo 或 bypass；仅中文自由回答进入独立翻译，题目和选项身份不变。`tests/question-inbox.test.ts` |
| 发送与取消 | `draft/submit({sessionId,id,sourceHash,automatic?})` 返回既有运行时结果；`draft/cancel({id}或{requestId}) → null`。绑定问题内容、会话状态、原生回合和模型目标，防止过期预览另开任务；成功标记该问题 answered。异步预览不支持 `draft/refine`，应返回问答卡片修改。`tests/question-inbox.test.ts`、`scripts/test-question-inbox-ui.mjs` |
| 稍后回应／恢复／忽略 | `interaction/presentation({sessionId,messageId?,receipt?,action}) → Promise<AppState>`；messageId 与 receipt 必须二选一，action 为 defer/show/dismiss。异步 dismiss 仅关闭本地问题；原生 dismiss 对现有请求发送 decline，沿用 Codex 空 answers／Claude deny 适配；原生 defer 不回答、不释放等待。`tests/question-inbox.test.ts`、`tests/native-interactions.test.ts` |
| 收件箱与生命周期 | `Message.questionPresentation?:QuestionPresentation`、`NativeInteraction.deferred?:boolean`；`packages/native-interactions/inbox.ts` 公开 `asyncQuestionState(session,message)`、`questionContext(session)`、`recordAsyncQuestions(session,message,questions)`。原生结束/撤销仍按请求 receipt 失效；异步问题在回合结束后默认收进待回答。`tests/interaction-flow.test.ts`、`scripts/test-question-inbox-ui.mjs` |
| 键盘与翻译预览 | 复用 `PreviewModal`／既有 `api.previews` 与输入翻译设置：模块关闭原文直发；开启后 autoSubmitTranslated=false 先确认，true 翻译直发。Enter 下一题或发送，Shift+Enter 换行，IME/重复键不触发。`scripts/test-question-keyboard-ui.mjs` |

`QuestionPresentation={state:'open'|'deferred'|'dismissed'|'answered',context:string}`；context 是宿主生成的展示上下文标识，扩展不应自行解释或伪造。数据为可选增量，无破坏性迁移；旧异步问题若已有后续用户消息，沿用旧版已处理语义，避免重新冒出。新捕获或显式收起的问题保留待回答状态，普通后续消息不会清空；已忽略问题不因重复原生消息帧重现。回答文本在当前已挂载问答卡片内保留，收起/恢复不会丢失；不承诺未发送答案在退出应用后持久保存。

权限及事件沿用会话准入、翻译外发同意、预算、单次输入 gate 和 `state`／`onState`；不新增账号权限或后台模型回合。原生请求收起后仍显示“运行时仍在等待”。翻译设置变化、关闭视图、收起、忽略和回合变化撤销准备及旧预览；提交已进入运行时后保持原有回执与未知状态处理。忽略异步问题不通知模型，忽略待处理原生问题才发送其真实拒绝结果。

错误包括 `QUESTION_PRESENTATION_INVALID`、`ASYNC_QUESTION_INVALID`、`ASYNC_QUESTION_STALE`、`NATIVE_QUESTION_STALE`、`ASYNC_QUESTION_EDIT_IN_CARD` 和既有运行时／输入 gate 错误；`ASYNC_SECRET_QUESTION_UNSUPPORTED` 明确拒绝把隐私答案转成普通用户消息，原生隐私回应仍走原请求通道。失败保留卡片草稿，不自动改发原文或重试。

插件可以通过既有 `api.call`／`useHost`、submission 服务及 conversation surface 调用或替换同一路径；展示预览可继续用 `api.previews`。停用界面替换恢复核心问答与待回答入口，停用翻译使旧预览失效并保留原稿；不会因停用清除收起/忽略状态。`apiVersion` 不变；依赖旧 AsyncQuestions 内部 onDraft 属性的源码扩展需迁移为受管调用。

~~~js
await api.call('interaction/presentation', {sessionId, messageId, action: 'show'});
const preview = await api.call('draft/prepare', {
  sessionId, questionReply: {messageId, answers: {[questionId]: ['My answer']}}, requestId
});
// Apply the user's current preview preference; confirmation is explicit here.
await api.call('draft/submit', {sessionId, id: preview.id, sourceHash: preview.sourceHash, automatic: false});
~~~


<!-- sidebar-session-order:start -->
## 会话手动顺序与一小时静置门限（2026-09-29 UTC）

`session/reorder({id:string,targetId:string,edge:'before'|'after',scope:string}) → Promise<AppState>` 通过既有 `api.call` / `window.workbench.call` 进入真实控制器。`scope` 由 `sidebarSessionScope(session)` 得到：`pinned`、`group:<原分组名>` 或 `project:<项目ID>`；无项目会话使用 `project:__recent__`。源和目标必须是当前同一区域内的未归档会话。参数不是整表快照；状态存储在串行队列内重新核对并只移动指定 ID，成功原子持久化后通过现有 `workbench:state` / `onState` 广播。丢失回执不新增自动重试；再次读取 `state/get` 核对即可。

返回的 `AppState.sidebarSessionOrder?:string[]` 是全局稳定顺序，界面按项目、置顶和分组过滤；`Session.sidebarActivityAt?:string` 是宿主 ISO 排序活动时间，包含原生内容/生命周期变化及手动整理保护。旧文件缺字段时，以既有优先级初始化一次并由创建、消息、工具和原生交互时间建立活动基线，下次写入保存；升级和重启不因恢复状态变化重新排序。顺序清理重复/已删除 ID，并保留新增会话，不修改原生数据。

内置策略常量 `SIDEBAR_IDLE_MS = 3600000`：只有距上次排序活动严格大于该值才在再次活动时放置该会话。一小时内的输出、审批、结束和未读变化不触发重新排序；仍在运行的无输出任务不因长时间等待跳位。单纯读取、标记已读、标题、翻译和主题变化不计活动。手动排序给同一区域所有行续期，避免马上被相邻旧会话更新覆盖。自动放置只移动重新活动的行；其余会话的相对顺序不变，手动形成的顺序无需满足全局优先级排序。新增会话在当前区域按优先级插入。

### 可替换服务、权限与生命周期

`api.services.get<SidebarOrderingService>('sidebar.order')`，契约版本 1；类型及默认实现位于 `packages/session-core/sidebar-sessions.ts`：

- `initialize(state:AppState):void`：载入时整理/迁移顺序；宿主启动时早于外部插件激活，插件运行后可显式通过受信任 `workbench.state.update` 应用自有迁移。
- `observe(previous:AppState,next:AppState,at:string):void`：每次真实存储事务写盘前调用；在 `next` 上保存自定义排序策略，不修改 `previous`，同步完成，不运行异步副作用。
- `reorder(state:AppState,request:SessionReorderRequest,at:string):void`：控制器命令直接调用；修改的是队列内候选状态，异常不保存。

批准的宿主插件可使用 `services.override/intercept` 替换上述路径，调用返回的释放函数后恢复内置实现；插件停用保留已保存顺序，不把列表恢复成每次刷新自动排序。界面替换沿用 `sidebar` surface 和多实例观察接口；无需修改核心源码。服务属于已批准完整代码包的本机开发权限，不授予原生执行、其他设备或管理员权限；这不是提供给模型的增权工具。

错误：`SIDEBAR_REORDER_EDGE_INVALID`（位置非法）、`SIDEBAR_SESSION_NOT_FOUND`、`SIDEBAR_SESSION_ARCHIVED`、`SIDEBAR_REORDER_SCOPE_CHANGED`（包含跨区或拖动期间区域变化）、`SIDEBAR_ACTIVITY_TIMESTAMP_INVALID`。控制器另沿用字符串/长度校验和持久化错误。界面将过期目标解释为中文提示，保留当前顺序。新增命令和可选状态字段不改变已有 `project/reorder` / `session/move-project` 参数或原生会话绑定；现有宿主 SDK 版本保持不变。

```ts
const scope = sidebarSessionScope(sourceSession);
await api.call('session/reorder', { id: sourceSession.id, targetId: targetSession.id, edge: 'before', scope });
const release = api.services.intercept('sidebar.order', 'observe', (next, ...args) => {
  return next(...args); // Wrap the actual serialized persistence path.
});
// Return release from the plugin's host activation cleanup.
```

### 功能覆盖矩阵

| 功能 | 开发入口和实际路径 | 验证位置 |
| --- | --- | --- |
| 手动前后移动、各区域边界、过滤保留 | `session/reorder` → `sidebar.order.reorder`；`orderedSidebarSessions` / `sidebarSessionScope` | `tests/sidebar-session-order.test.ts`、`scripts/test-sidebar-session-order-ui.mjs` |
| 一小时临界、持续活动和长任务 | `sidebar.order.observe` → `StateStore.update` → 状态广播 | 同上；严格门限与原生活动合成测试 |
| 并行请求、过期目标、持久化迁移 | 宿主串行相对目标写入、`state/get` / `onState` | 同上；控制器及真实 IPC / 重启 |
| 策略替换和停用恢复 | `sidebar.order` v1 → `services.override/intercept` | `tests/sidebar-session-order.test.ts` |
| 拖拽插入线、键盘、浅深色/窄栏 | `.session-row`、既有 `sidebar` surface | `scripts/test-sidebar-session-order-ui.mjs`；合成隐藏 Electron |

<!-- sidebar-session-order:end -->

<!-- local-model-management:start -->
## 本机官方账号与模型用量（2026-09-29 UTC；U115）

设置页 ID 保持 `models`，显示名改为“模型”。以下是可选增量，不迁移旧 API/SSH 连接，不修改 VPS。入口通过 `api.call(method,params)` 进入真实宿主，可由已批准插件通过 `registerMethod/useHost` 包装或替换。

### 功能覆盖矩阵

| 功能 | 开发入口和实际路径 | 验证位置 |
| --- | --- | --- |
| 多账号、启停与移除 | `models/accounts/list/create/set-enabled/remove` → `models.accounts.call` → 状态持久化 | `tests/model-management.test.ts` |
| 官方登录及目录 | `models/accounts/login-start/status/cancel/open`、`login-code`、`refresh` → `NativeAccountTransport` → 官方 CLI | `tests/model-accounts-native.test.ts` |
| 额度和显式兑换 | `refresh/reset-preview/reset-redeem/reset-status`、`models.accounts.observeQuota` | `tests/model-management.test.ts` |
| 总计、逐模型统计与单价 | `models/usage`、`models/pricing/save` → 数值账本 | 同上 |
| 模型合并、独立账号选择及记忆 | `model-targets/list`、`runtime/select`、`session/create/model/model-target`、`officialModelGroups` | `tests/model-account-selection.test.ts` |
| 执行绑定与分支 | `officialAccountBinding`、`freezeSessionBinding`、`officialAccountLaunch` → `runtime.native-provider` | `tests/model-account-selection.test.ts`、`tests/model-accounts-native.test.ts` |
| 响应式卡片、Codex/Claude 标签分区、折叠及厂商登录 | 既有 `ui.settings.register({replaces:'models',...})`、多实例 `ui.mount`；组件使用上述宿主接口 | `scripts/test-model-management-ui.mjs` |
| 服务包装及停用恢复 | `services.intercept/override('models.accounts',...)` | `tests/model-account-selection.test.ts` |
| 单账号三格式导出与主题卡片 | `models.account-export`、`models/accounts/export-formats/export-preview/export-copy/export-save`，四个具名局部 surface | `tests/account-export.test.ts`、`scripts/test-account-export-ui.mjs`；详见本页账号导出契约 |

### 类型、参数和返回

类型声明位于 `packages/model-management/types.ts`、`native.ts`、`packages/account-usage/types.ts`。`LocalModelAccount` 含 `{id,revision,provider:'codex'|'claude',name,enabled,status,models,email?,plan?,observedAt?,usage?,cycle?}`，状态为 `signed-out/authenticated/unknown`；不含凭据、原生配置正文或聊天记录。

| 方法 | 参数 | 返回 |
| --- | --- | --- |
| `models/accounts/list` | `{}` | `LocalModelAccount[]` |
| `models/accounts/create` | `{provider,name}`，名称 1–100 字符 | 新账号，尚未登录；最多 100 个入口 |
| `models/accounts/set-enabled` | `{id,revision,enabled:boolean}` | 新修订账号 |
| `models/accounts/remove` | `{id,revision,confirm:true}` | `{removed:id}`；保留原生目录及用量 |
| `models/accounts/refresh` | `{id}` | 回读的账号、模型和可用额度；不推理 |
| `models/accounts/login-start` | `{id,revision,method}` | `AccountLogin`；Codex `browser/device`，Claude `browser/sso/console` |
| `models/accounts/login-status` | `{id,jobId}` | `AccountLogin`；原生成功后回读身份和目录 |
| `models/accounts/login-cancel` | `{id,jobId}` | 取消后的 `AccountLogin` |
| `models/accounts/login-code` | `{id,jobId,code:string}`；Claude 原生请求后的临时授权码，最长 4096 字符，不含空白 | 更新的 `AccountLogin`；仅写入所属登录进程 stdin，不持久化、不转发模型 |
| `models/accounts/login-open` | `{id,jobId}` | `{opened:true}`；仅允许官方 HTTPS 主机 |
| `models/accounts/reset-preview` | `{id,cardKey}` | `ResetPlan{id,accountId,cardType,creditId?,remaining,title?,expiresAt}`；2 分钟有效 |
| `models/accounts/reset-redeem` | `{id,planId,confirm:true}` | `ResetReceipt{id,accountId,cardType,state,message}` |
| `models/accounts/reset-status` | `{id}` | 最近已提交的 `ResetReceipt` 或 `null` |
| `models/usage` | `{scope:{kind:'api'|'account',id},period:'1day'|'7day'|'cycle'|'month'}` | `ModelUsageSummary`：总计、逐模型组、未知字段、金额和周期可用性 |
| `models/pricing/save` | `{scope,model,revision?,price:{input,output,cacheRead?,cacheWrite?}}` | `SavedModelPrice`；USD / 百万 tokens，非负有限值，输入和输出必填 |

`AccountLogin` 含 `{id,accountId,method,status,expiresAt,url?,userCode?,codeRequested?,error?}`，状态为 `waiting/verifying/complete/cancelled/failed`。作业最长 10 分钟，仅在当前进程保留，终态清除授权地址和代码，过期终态会回收；重启可刷新原生账号。关闭弹窗取消所属登录；宿主关闭清理所属进程，不退出其他客户端。已认证账号不能覆盖登录另一个身份，须添加新入口。Console 身份不标作 Claude 订阅。Codex 使用管理式浏览器或设备码授权；Claude 订阅用 `claude auth login`，SSO 加 `--sso`，Console 加 `--console`。原生提示 `Paste code here` 时才开放临时授权码入口，每作业仅提交一次，结束清除提示；不提供令牌导入。

`ResetReceipt.state` 为 `redeemed/denied/uncertain`。兑换前持久化计划和幂等键，传递指定卡 ID。未知结果只能用相同计划核对，重启保留；不自动重试、新建兑换或购买额度。成功后重读额度，读取失败不推定 100%。Claude 暂无经核实的直接卡片读取/兑换接口，不用网页登录端点替代。

`models/usage` 输入计数包含缓存；成本按互斥类别计算，缓存不重复计入总 token。未知保持 `null`，部分汇总通过 `incomplete` 标明下界；必要单价或计数缺失不生成假金额。`priceSource` 为 `manual/reference`。精确模型 ID 的参考单价核对于 2026-09-29 UTC：OpenAI 短上下文标准档、Claude 全球标准档及 5 分钟缓存写入；不猜测别名。用户可逐来源逐模型改价，当前价重算所选时段，不是历史账单，不含订阅、工具费和税费。`modelUsageRevision(state,scope)` 提供指定来源的统计刷新签名，含相同时间戳的修订及价格变化，不依赖账本末行。删除聊天保留已收到的数值账本，计入工作台前台任务及原生记忆后台任务已观测到的用量，不宣称导入账号全部历史。后台只发送数值记录，不将临时会话或正文放入前台聊天。

`1day/7day` 是滚动 24 小时/7 天，`month` 为本机时区自然月。账号 `cycle` 优先周窗口、无周窗口时选 5h；仅观测到 100% 或核实窗口轮换后起算，未知/过期返回 `cycleUnavailable:true`。API 没有官方额度周期。不补造缺失的 5h 窗口，倒计时结束不把额度自动画满。

### 选择、记忆与执行隔离

公开目标为 `account/<uuid>/<encoded-model>`，含 `binding.localAccountId` 与 `egress:'runtime-managed'`。`officialModelGroups(targets,runtime)` 只合并同一运行时的官方同名模型，显示顺序 SSH、官方账号、API。`chooseOfficialModel` 仅响应明确模型选择，优先保留当前可用账号；账号选择器只提供该厂商、支持所选模型的启用账号。`session/model-target({sessionId,targetId,selection?})` 可选 `selection` 用于官方目标并核验模型和档位；2026-09-30 扩展至 API 映射（见本页运行时档位修复），省略参数的旧调用兼容。切换账号不复用另一个账号的原生线程。

`runtime/select` 沿用持久化目标、模型和思考档位；权限按项目/运行时保存。失效选择不在启动时偷偷替换，限流不触发换号。`officialAccountBinding`、冻结校验及执行准入同时核实厂商、运行时、账号、执行位置和出口；官方绑定混入 API 映射或 SSH 主机时拒绝。每账号独立 `CODEX_HOME/CLAUDE_CONFIG_DIR/ANTHROPIC_CONFIG_DIR`；最后一项隔离 Claude 无 API Key Console 配置，移除继承的厂商凭据和模型环境覆盖。模型请求由官方 CLI 直接发出；Claude 本机网关仅承载 MCP，模型路由返回 404，不调用 API 密钥回调，也不把账号凭据交给翻译器。这是工程隔离，不是风控豁免。

### 扩展、事件、权限和错误

服务 `models.accounts` 的明确成员为 `call(method,params)`、`targets()`、`selection(id,value)`、`execution(session)`、`observeQuota(id,usage)`、`refresh(id)`、`busy(id?)`、`dispose()`；分别返回上表结果、`ModelTarget[]`、`NativeModelSelection`、经验证的原生启动元数据、`Promise<void>`、账号、布尔值和 `Promise<void>`。其 `NativeAccountTransport` 构造注入契约提供 `inspect(account):Promise<AccountInspection>`、`login(account,method,changed):Promise<LoginHandle>`、`consume(account,idempotencyKey,creditId?):Promise<string>`、`dispose():Promise<void>`。`LoginHandle` 为 `{job,cancel():Promise<void>,submitCode?(code:string):Promise<void>}`，后者仅 Claude 原生提示后可调用。`ProcessSupervisor.writeLoginCode(code)` 只允许 opaque 进程写入一行，不做 JSON 序列化；非法值返回 `NATIVE_LOGIN_CODE_INVALID`。`NativeProviderRunner` 第六个可选参数 `(spec:ProcessSpec)=>ProcessSupervisor` 是原生协议测试/受信宿主替换入口，默认真实进程。`NativeMemoryTaskExecutor` 第五个可选参数 `{usage?:(entries:ModelUsageEntry[])=>Promise<void>,processFactory?}` 只把数值回执交给主账本，旧构造调用兼容；测试见 `tests/model-account-execution.test.ts`。注入用于明确宿主集成；未知返回不代表原生验收成功。其他运行时继续使用现有注册式运行时接口，不要求改核心枚举。

已批准插件可包装实际 `call/refresh/targets`，停用撤销包装后恢复原实例，不删除账号/价格数据。设置页可整体替换或多实例挂载，沿用卸载和异步清理协议。持久化变化发送现有 `state` 事件；额度来自所属原生事件，登录由显式轮询读取，不生成模型回合。权限限已批准的本机范围，不扩展到其他用户/设备或 VPS。

错误包括 `LOCAL_ACCOUNT_NOT_FOUND/INVALID/CHANGED/BUSY/UNAVAILABLE`、`LOCAL_ACCOUNT_RUNTIME_MISSING/RUNTIME_BUSY`、`LOCAL_ACCOUNT_LOGIN_METHOD_INVALID/LOGIN_FAILED/LOGIN_EXPIRED/LOGIN_NOT_FOUND/LOGIN_UNVERIFIED`、`LOCAL_ACCOUNT_STATUS_UNAVAILABLE/MODELS_UNAVAILABLE/IDENTITY_CHANGED`、`LOCAL_ACCOUNT_RESET_UNSUPPORTED/RESET_REFRESH_REQUIRED/RESET_PENDING/RESET_INVALID/RESET_EXPIRED`、`LOCAL_ACCOUNT_CODE_NOT_REQUESTED/CODE_INVALID`、`MODEL_USAGE_QUERY_INVALID`、`MODEL_PRICE_INVALID/PRICE_CHANGED`、`MODEL_SOURCE_NOT_FOUND`。修订冲突不能强写；运行中、待提交或结果未知时禁止开关、移除、重新登录或兑换。只读刷新不更换绑定，也不阻断已有会话工具。未知原生格式返回未知/失败，不调用私有网页接口兜底。

```ts
const accounts = await api.call('models/accounts/list', {});
const first = accounts.find(a => a.enabled);
if (first) await api.call('models/usage', {
  scope: { kind: 'account', id: first.id }, period: '7day'
});
// Approved plugin: release this wrapper on disable.
const restore = api.services.intercept('models.accounts', 'call',
  (next, method, params) => next(method, params));
```
<!-- local-model-management:end -->

<!-- plugin-recovery-audit:start -->
## 插件兼容、独立恢复与人工修复草稿（2026-09-29 UTC；U111）

### 功能覆盖矩阵

| 功能 | 开发入口 / 实际执行路径 | 验证位置 |
| --- | --- | --- |
| 前置兼容检查 | `PluginManifest.requires` → `PluginRegistry.list/refresh` → 激活准入；`extensions/list` 返回 `origin:'third-party'`、`requestedEnabled`、`compatibility` | `tests/plugin-recovery.test.ts` |
| 服务版本与迁移 | `api.services.register(id, service, contract?)`、`list()`、`get/override/intercept` 的已确认适配作用域；SDK v1 保留 | `tests/plugin-recovery.test.ts`、`tests/plugin-services.test.ts` |
| 批量一键适配 | `plugin-recovery/repair`、`api.services.get('extensions.recovery').repair()`；按插件 ID/包摘要去重并逐项重检和激活，单项失败继续，返回部分结果 | `tests/plugin-compatibility-batch.test.ts`、`scripts/test-plugin-recovery-ui.mjs` |
| 独立恢复 | `plugin-recovery/status/show`、普通 `extensions.recovery.status/show`、独立 guardian、菜单和 `--safe-mode`；自动故障通知在 guardian 生命周期内合并，显式 show 仍可重开 | `tests/plugin-recovery-process.test.ts`、`tests/plugin-recovery-presentation.test.ts`、`scripts/test-plugin-recovery-ui.mjs` |
| 安全模式 | `PluginRecoveryStore.safeMode(enabled)` 用于受信宿主集成；用户窗口 `recovery/safe` / `recovery/normal` 触发实际重启；ZIP 无官方来源自声明豁免 | `tests/plugin-recovery.test.ts`、`scripts/test-plugin-recovery-ui.mjs` |
| 修复草稿 | guardian 的 `recovery/copy-repair`、`plugin-recovery/repair-draft` 与 `/ack` → App 新草稿 → Workspace textarea；不调用模型 | `tests/plugin-repair-draft.test.ts`、`scripts/test-plugin-recovery-ui.mjs` |
| 草稿语言 | `plugin-recovery/ui-language({language})`；跟随实际 HTML `lang`，中文模板 / 其他语言英文模板 | `tests/plugin-repair-draft.test.ts`、`scripts/test-plugin-recovery-ui.mjs` |
| 界面失败清理 | `plugin-recovery/renderer-start/ready/failed`、包装订阅/事件回调、异步激活超时、核心 React 错误边界 | `scripts/test-plugin-extensibility.mjs`、`scripts/test-plugin-recovery-ui.mjs` |
| 升级门禁 | `npm run check:plugins` 比较公开类型声明和宿主路由名；有意更新基线前补文档及迁移行为测试 | `tests/plugin-contract-gate.test.ts`、`.github/workflows/plugin-contracts.yml` |

### 清单与服务契约

`requires?: {host?: {min:string; before?:string}; services?: {id:string; version:number; members:string[]}[]}` 是 API v1 的可选增量。host 使用三段数字版本，min 包含、before 不包含；服务最多 64 项，每项最多 100 个成员。缺字段的旧插件继续按原准入加载，兼容状态为 `unchecked`；声明完整且满足检查为 `compatible`，不满足为 `blocked`。检查的是声明要求，不验证整个插件的所有调用或语义。

`PluginServices.register(id:string, service:object, contract?:ServiceContract) → () => void` 的第三参为 `{version:number; adapters?:{version:number; members:Record<string,string>}[]}`；version 为正整数，不同旧版本不可重复。members 为旧名称到当前可调用成员的映射，必须具有相同参数、返回和行为语义；参数或语义改变不能用重命名冒充修复。`list()` 增加 `contractVersion?` 与 `compatibility?:{version;members:string[]}[]`，没有契约的服务保持可发现但不满足已声明版本要求。内置服务登记版本 1，这不是内部实现永远兼容的承诺。

修复仅在目标仍启用、代码包仍批准且摘要一致、全部兼容阻塞均有对应适配时可用；保存插件摘要和适配内容指纹，通过作用域代理翻译 `get/override/intercept`，不全局增加旧别名、不修改包内源码或用户配置。包或适配改变后旧确认失效。适配成功只清除同包的兼容故障，保留独立的加载/清理故障。停用释放覆盖层；正常重启保留已确认适配；安全模式不执行第三方代码或适配重试。服务依赖注册存在时序，不提供完整的第三方依赖求解器。

```ts
// Provider: keep old calling semantics and test them before declaring this adapter.
api.services.register('example.reader', { readCurrent: () => 42 }, {
  version: 2, adapters: [{ version: 1, members: { readLegacy: 'readCurrent' } }],
});
// Consumer manifest: requires.services =
// [{ id: 'example.reader', version: 1, members: ['readLegacy'] }]
// After explicit user repair, the old consumer can keep calling readLegacy().
const diagnosis = await api.call('plugin-recovery/status');
await api.call('plugin-recovery/show'); // Opens the independent core panel; no restart.
```

### 宿主恢复接口

| 方法与参数 | 返回 / 生命周期 |
| --- | --- |
| `plugin-recovery/status({})` | `RecoverySnapshot`；只读，含 schemaVersion=1、hostVersion、previousHostVersion?、safeMode、boot、pending、incidents、storageError? |
| `plugin-recovery/show({})` | `{shown:boolean}`；仅打开独立窗口，不改开关或重启 |
| `plugin-recovery/repair({})` | `PluginRepairBatchResult & {message:string}`；`repairs:{id:string;hash?:string;applied:boolean;status:'repaired'|'failed'|'unavailable'}[]`、`remaining:PluginIncident[]`、`complete:boolean`。对观察到的 ID/包摘要去重，每个可修复包只尝试一次；单项失败继续，未知问题标 unavailable。只有所有适配已应用且没有剩余记录才 complete=true，这也不代替功能验收。并发调用共用当前批次；活动任务时拒绝，不自动重发模型任务 |
| `plugin-recovery/pulse({})` | `null`；核心每秒发送界面心跳，不经过第三方中间件 |
| `plugin-recovery/core-ready({})` / `core-failed({})` | `null`；核心初始状态及导航完成后确认；同时观察尚未结束的宿主/界面激活，最后一个完成后更新 ready，避免异步加载把状态滞留在 starting；失败记录未知归因，不把一般异常归给插件 |
| `plugin-recovery/renderer-start({id,hash})` / `renderer-ready({id,hash})` / `renderer-failed({id,hash})` | `null`；校验当前有效 renderer 包，登记/结束激活；失败停用对应插件并清理 |
| `plugin-recovery/ui-language({language:string})` | `null`；有界语言标记，`zh` 或 `zh-*`/`zh_*` 使用中文，否则英文；独立窗口在主界面卡死时使用上次已保存的选择，尚无选择默认中文 |
| `plugin-recovery/repair-draft({})` | `PluginRepairDraft|null`；仅安全模式返回尚未确认的 `{schemaVersion:1,id,language:'zh'|'en',text}`；读取不创建会话、不消耗草稿 |
| `plugin-recovery/repair-draft/ack({id:string})` | `{acknowledged:true}`；仅安全模式、相同待处理 ID 可确认；旧确认不能覆盖更新草稿 |

`PluginIncident` 保存 id/name?/hash?/version?、key、code、phase、certainty、at、hostVersion、previousHostVersion?、repairable 和 `issues?:CompatibilityIssue[]`。phase 为 scan/compatibility/host/renderer/cleanup/startup；certainty 为 confirmed/suspected/unknown。兼容 issue 包括 code、service?、member?、expected?、actual?、repairable。持久记录最多 50 项、每项最多 20 个兼容 issue，日志读取上限 1 MiB。复制包含全部保留的最近 50 项、每项前 2 个 issue、`additionalIssueCount` 及最近 32 个待完成阶段；`diagnosticScope` 返回 `recordLimit:50`、`unobservedPlugins:'not_checked'`、`olderRecordsMayBeOmitted:boolean`（达到上限即提示可能省略旧记录）。只导出结构化元数据，省略显示名称、原始异常/堆栈、路径、聊天和凭据。一般旧接口异常没有声明证据时仍可能只能显示激活失败。

独立窗口的 `recovery/status/copy/copy-repair/safe/normal/continue/repair/quit` 只在 guardian 自有顶层页面可调用，不能由普通 app IPC 任意访问。分别返回状态、复制说明、草稿说明、重启确认、重启确认、空对象、修复结果、空对象。普通插件可调用上表接口或扩展 `extensions.recovery` 服务；安全恢复始终保留绑定的核心函数与独立入口，绕过插件中间件和服务覆盖。全信任 Node 仍不是恶意代码沙箱。

### 错误、事件、存储与恢复边界

兼容错误：`PLUGIN_API_VERSION_UNSUPPORTED`、`PLUGIN_REQUIREMENTS_INVALID`、`HOST_VERSION_UNSUPPORTED`、`SERVICE_UNAVAILABLE`、`SERVICE_CONTRACT_UNSUPPORTED`、`SERVICE_MEMBER_UNAVAILABLE`、`PLUGIN_SERVICE_CONTRACT_INVALID`、`PLUGIN_COMPATIBILITY_ADAPTER_UNAVAILABLE`、`PLUGIN_COMPATIBILITY_USE_OVERRIDE`。不能用升级声明版本消除真实兼容问题。

生命周期错误：`PLUGIN_HOST_ACTIVATION_FAILED`、`PLUGIN_RENDERER_ACTIVATION_FAILED`、`PLUGIN_ACTIVATION_TIMEOUT`、`PLUGIN_CLEANUP_FAILED`、`PLUGIN_STARTUP_INTERRUPTED`、`PLUGIN_PROCESS_UNRESPONSIVE`、`PLUGIN_RENDERER_UNRESPONSIVE`、`PLUGIN_PROCESS_EXITED`、`PLUGIN_RENDERER_CRASHED`、`WORKBENCH_STARTUP_INCOMPLETE`、`WORKBENCH_RENDER_FAILED`。宿主及界面异步激活上限 10 秒，单项宿主清理上限 1 秒；同步死循环由独立进程诊断。批量修复回执最长等待 10 分钟，等待时安全重启和退出入口仍可用；超时只表示结果未确认，不重复派发。正常阈值为 15 秒无响应、30 秒未完成核心启动；慢机仅显示观察结果，不自动杀进程或重试插件。

存储/恢复错误：`PLUGIN_PREFERENCES_INVALID/CONFLICT`、`PLUGIN_PACKAGE_INVALID`、`PLUGIN_DIRECTORY_UNAVAILABLE`、`PLUGIN_RECOVERY_STATE_INVALID`、`PLUGIN_RECOVERY_STORAGE_UNAVAILABLE`、`PLUGIN_SAFE_MODE_ACTIVE/REQUIRED`、`PLUGIN_REPAIR_UNAVAILABLE`、`PLUGIN_RECOVERY_SESSION_BUSY`、`PLUGIN_RECOVERY_REVISION_CHANGED`、`PLUGIN_GUARDIAN_UNAVAILABLE`；草稿错误为 `PLUGIN_UI_LANGUAGE_INVALID`、`PLUGIN_REPAIR_DRAFT_TOO_LARGE/INVALID/CHANGED`。独立操作失败统一 `PLUGIN_RECOVERY_ACTION_FAILED`，不暴露原始异常；重启身份或停止未确认时不启动第二份工作台。

`plugin-recovery.json` 与 `plugin-safe-mode.json` 分离，避免普通状态保存覆盖紧急安全开关；损坏记录/偏好保留原字节并阻止第三方加载。`plugin-repair-draft.json` 最大文本 96 KiB，单独确认文件只记录 ID；不包含模型、自动发送或执行参数。草稿遵循本次产品要求，中文 UI 的模板使用中文；其他模型工具/schema 的英文约定不变。

`PluginRecoveryStore.subscribe(listener:(snapshot:RecoverySnapshot)=>void):()=>void` 支持多个独立监听者，立即回调当前快照，返回函数仅取消自身；核心启动完成观察与 guardian 不互相覆盖。监听通知仅表示诊断状态变化，不启动任务；测试见 `tests/plugin-recovery.test.ts`。

guardian 通过 IPC 快照及心跳更新，界面每秒只读刷新；兼容修复沿用既有 `onExtensions` 通知。自动故障通知在一个 guardian 生命周期内合并为一次展示；窗口已展示、用户关闭后，后续快照和心跳不会再次 `show()` 或抢占前台。`plugin-recovery/show`、菜单“查看诊断”和恢复面板内的显式请求仍可主动打开窗口。没有新增模型事件或后台任务。App 仅在安全模式读取草稿，新 Workspace 挂载时赋给 textarea，实际插入后确认；用户编辑不会被轮询覆盖。切换模型沿用用户主动的模型选择流程；未点击发送不调用 `session/create`、`draft/prepare`、`draft/submit` 或翻译。已有普通“复制诊断信息”不会创建修复草稿。一个草稿汇总所有仍保留的未解决目标，要求逐项修复并报告已修复／未解决／未检查；不因首项修复成功而结束。卡死前未执行的插件仍未检查，记录上限之外的插件需核对完整清单，不宣称全量健康。

完整风险、开源发布前缺口与证据范围见 [预开源审计](plugin-preopen-audit-20260929.md)。Windows 桌面恢复已使用隔离故障注入；其他平台进程停止分支仅有源码，不能据此宣称已完成发行验收。
<!-- plugin-recovery-audit:end -->

<!-- cli-release-diagnostics:start -->
## 远端 CLI 发布诊断与紧凑管理（2026-09-29 UTC；U105）

| 功能覆盖 | 开发入口、参数与返回 | 验证位置 |
| --- | --- | --- |
| 官方发布检查 | `api.call('remote-cli/list', {id}) → RemoteCli[]`；新增可选 `errorCode?:string` 与 `releaseIssue?:RemoteCliReleaseIssue`，保留现有本地化 `error?:string` | `tests/remote-cli-browser.test.ts`、`scripts/test-cli-release.py` |
| 安装预览失败 | `remote-cli/plan({id,provider,operation}) → RemoteCliPlan`；失败沿用 IPC Error.message，带已验证阶段及 HTTP 状态的中文说明；不会执行 apply | `scripts/test-remote-cli-lifecycle.py`、`scripts/test-remote-management-ui.mjs` |
| 紧凑行与独立错误 | `api.observeSurfaces('[data-testid="remote-cli-codex"], [data-testid="remote-cli-claude"]','replace',render)`；沿用多实例生命周期，停用恢复核心行 | `scripts/test-remote-management-ui.mjs`、`scripts/test-remote-resources-ui.mjs` |
| 自动更新与确认 | `remote-cli/configure({id,provider,revision,changes:{autoUpdate}})`、`remote-cli/apply({id,provider,planId,confirm:true})`；参数、返回和权限不变 | `tests/remote-maintenance-controller.test.ts`、`scripts/test-remote-cli-lifecycle.py` |

`RemoteCliReleaseIssue` 定义于 packages/remote-account-catalog/cli.ts：`{stage:'release'|'manifest'|'asset'|'installer',source:string,httpStatus?:number}`。source 只接受现有四个官方来源主机名；httpStatus 仅 400–599 整数。宿主投影丢弃未声明字段、响应正文和异常原文；非法诊断丢弃，未知错误回退通用提示。errorCode 是已知固定英文代码，供扩展判断；中文说明不作为机器可读协议。

远端错误新增 `CLI_RELEASE_HTTP`、`CLI_RELEASE_TIMEOUT`、`CLI_RELEASE_TLS`、`CLI_RELEASE_NETWORK`、`CLI_RELEASE_INVALID`。它们分别表示已返回的 HTTP 拒绝、超时、TLS 校验错误、连接/DNS 错误及发布数据格式或必需校验信息缺失。旧 `CLI_RELEASE_UNAVAILABLE` 继续兼容，但不再未经证据归因于 VPS 出网。SSH 自身错误仍通过既有传输层返回，与官方发布请求分开。

VPS 内部 `native_install.release_request(url,method='GET') → urllib.request.Request` 为官方元数据 GET、大小 HEAD、安装脚本及发布包读取使用相同的 AgentWorkbench 客户端标识；此内部函数不是插件任意 URL 访问接口。仍执行 HTTPS、大小、摘要、安装身份和预览失效检查，无 TLS 绕过、镜像回退、固定旧版或自动重试。`InstallError.release_issue` 经 cli/list 行与 cli/plan 失败回执传回宿主；全部远端固定文本保持英文。

权限沿用已保存 root 管理 SSH 身份；查看和刷新只检查，安装/更新/卸载仍需绑定连接与运行时的短期预览及明确确认，同运行时互斥。两家分别保留错误和开关，失败不再在页面底部重复显示；刷新清理旧操作提示，已有安装、缺失安装与外部安装语义不变。窄内容区自动换行，不改变连接页其他标签。apiVersion 和方法签名不变，无新增推送事件；旧扩展可忽略可选字段，新扩展须兼容无诊断的旧回执。界面替换使用既有 observeSurfaces 注册/释放及停用恢复机制。

```ts
const rows = await api.call('remote-cli/list', { id: adminConnectionId });
for (const row of rows) {
  if (row.errorCode === 'CLI_RELEASE_HTTP' && row.releaseIssue) {
    showReleaseStatus(row.provider, row.releaseIssue.stage, row.releaseIssue.httpStatus);
  }
}
```

验证分层：本机真实官方 HTTP 只读探测、Linux 临时目录合成安装生命周期、类型/协议和隐藏 Electron 布局。它们不证明目标 VPS 出网、真实远端安装或活动窗口已加载新代码；本次不部署 VPS。
<!-- cli-release-diagnostics:end -->

<!-- remote-file-interactions:start -->
## 连接分栏与远端文件即时交互（2026-09-29 UTC）

远端 CLI 页仅保留自动更新开关和程序维护；自动清理、时限、归档状态与日志统一在“会话清理”。原有 reclaimIdle / idleHours 策略及 remote-cli/configure 契约保留，不更改已保存的开关值，也不触发清理。

| 功能覆盖 | 可验证入口 | 参数、返回与测试 |
| --- | --- | --- |
| 目录／详情／文件分栏 | renderer ConnectionLayout({navigation,children,files?,filesOpen})；公开 UI 扩展沿用 api.observeSurfaces('.connection-layout','replace',render) 或 api.settings.register({id,label,replaces:'connections',render}) | React 渲染入口与插件注册入口分开；组件状态仅当前设置页有效，不读取远端。connectionPaneSizes(width,filesOpen,preferred) → stacked/sideBySide/navigation/details/files；tests/remote-directory-cache.test.ts |
| 文件开关与可访问调整 | RemoteResourcePanel 的 filesOpen:boolean、onFiles():void；分隔线有 separator 角色、方向键、Home/End、指针捕获和双击重置 | 两个开关入口共用状态；文件区关闭后不再排队读取。实际拖动、窗口拉伸及停用恢复：scripts/test-remote-resources-ui.mjs、scripts/test-file-browser-lifecycle-ui.mjs |
| 目录读取与替换 | remote-files/browse({id,path}) → Promise<RemoteFileView>；宿主 actions.remote-resources.browse(host,path) 仍进入实际调用路径 | 不改变 IPC 参数／权限／返回值；调用者可直接取得新回执。宿主服务注册／覆盖与停用恢复沿用 HostServiceRegistry；tests/remote-maintenance-controller.test.ts |
| 缓存适配接口 | FileBrowserBackend 增加可选 peek(path)、subscribe(listener)、prefetch(path)、invalidate()；menu 的末参数增加 directory?:boolean | peek → FileView 或 undefined；subscribe 回调为 (path,view?,error?)，返回取消订阅函数；其余返回 void。旧适配器缺省仍按原 browse 读取；无数据迁移 |
| 有界目录缓存 | RemoteDirectoryCache(fetch,options?)；read/fresh → Promise<RemoteFileView>，peek/subscribe/prefetch/invalidate/setActive/dispose | 这是可注入 fetch 的 renderer 模块，不是新的免审批插件权限。每连接独立实例；tests/remote-directory-cache.test.ts 验证时效、去重、隔离、容量、取消和目录变文件 |
| 即时菜单／操作 | .remote-file-dock 支持多实例 surface 替换；菜单本机渲染，复制路径走 clipboard/write；选择操作才请求 remote-files/browse | 读取期间弹窗可关闭、确认不可用；错误可重试。mutate/upload/download 的版本检查、确认和失败语义不变；scripts/test-remote-resources-ui.mjs |

宽屏文件区打开时，目录栏和详情栏使用已选像素宽度，窗口增加的空间分配给文件区；关闭后恢复比例分栏和原设置页最大宽度。分栏依据实际可用宽度，而非仅看窗口宽度：不足 860px 时文件区移到下一行，不足 560px 时改为单栏。指针取消、失焦和窗口尺寸变化终止拖动；无全局鼠标锁。插件替换布局时尊重 hidden，注销后恢复真实核心分栏。

缓存默认最多 64 个目录、估算 UTF-16 大小 4 MiB，30 秒内直接复用，超过后先显示旧列表并后台更新；超过 5 分钟不再作为缓存命中。options 可注入 now，并指定 freshMs / maxAgeMs / maxEntries / maxBytes 正整数；freshMs 不得超过 maxAgeMs，非法值抛 REMOTE_DIRECTORY_CACHE_OPTIONS_INVALID。仅缓存目录信息，用户主动打开的预览仍走原文件标签机制，不把任意文件正文加入后台缓存。

每次显式读取目录最多预取六个直接子目录，不递归遍历；悬停／键盘聚焦可预取对应已知目录。排除 /proc、/sys、/dev、/run 的自动预取；总并发最多 2，后台并发最多 1，后台队列最多 12，总队列最多 32，前台读取优先。重复请求合并；满队列返回 REMOTE_DIRECTORY_CACHE_BUSY，不增加连接。关闭文件区／切换标签停止队列，切换连接身份或离开页面销毁实例。已经提交的只读 IPC 等原传输超时收尾，不冒称已取消底层 SSH；过期结果不恢复弹窗或污染新连接。

手动刷新和成功／失败的文件写入均使缓存失效；失败的写入不自动重试。REMOTE_DIRECTORY_CACHE_INVALIDATED 与 REMOTE_DIRECTORY_CACHE_DISPOSED 用于过期或已销毁请求；可见读取保留本机中文错误原因与手动重试，纯预取失败不弹窗。背景刷新通过 subscribe 发布新列表或错误，没有新增模型工具、模型回合或磁盘日志。远端 revision 仍是写入依据；确认删除前必须取得回执，外部并发修改保持 REMOTE_FILE_CHANGED 拒绝覆盖。修改期间的用户草稿保留。

插件需要经既有代码包批准及管理员／系统权限检查。可通过公开 IPC 包装文件行为、通过注册式 actions.remote-resources 替换宿主实现、通过 observeSurfaces 或 settings.register 替换界面；无需修改核心枚举，不将 DOM 点击或私有函数视作稳定插件 API。替换生命周期、返回清理函数、AbortSignal 与 onDispose 沿用本文通用契约。例：

~~~js
const stop = api.observeSurfaces('.remote-file-dock', 'before', ({ root }) => {
  root.textContent = 'Extension file controls';
});
api.onDispose(stop);
const current = await api.call('remote-files/browse', { id: adminConnectionId, path: '/srv/example/document.txt' });
await api.call('remote-files/mutate', {
  id: adminConnectionId, operation: 'move', path: current.path,
  revision: current.revision, destination: '/srv/example/renamed.txt',
});
~~~

兼容说明：新增适配器成员均可选，远端协议和配置格式不变；旧插件直接调用仍得到实时 SSH 回执，renderer 缓存不插入宿主权限或协议层。CLI 页撤下的中文开关标签不再作为自动化定位入口，清理调用仍通过原策略接口。隐藏 Electron 验证含浅／深色、窄窗、阻断 SSH 的即时菜单、目录重开、刷新／重试、版本冲突草稿与删除确认；本机文件引用和行号刷新单独回归。此为源码和合成验收，不等同真实 VPS 性能或部署证明。
<!-- remote-file-interactions:end -->

<!-- session-retention-console:start -->
## SSH 管理员会话清理详情与本机日志（2026-09-29 UTC）

管理员连接新增“会话清理”页签；Codex、Claude 独立设置。采用原有文学阅读字体、平整行、细分隔线和窄窗换行。没有将列表刷新接到删除入口。

| 入口／类型 | 参数与返回 | 权限、错误与生命周期 |
| --- | --- | --- |
| `remote-storage/inspect` | {id,provider:'codex'或'claude',after?:string,limit?:number} → RetentionInspection | root 管理员；limit 默认 50，1–100；after 为上一页 nextCursor，最多 256 字符；15 秒取消上限，只读元数据 |
| `remote-storage/logs` | {id,provider,before?:string,limit?:number} → RetentionLogPage | root 管理员；仅本机磁盘，无 SSH；limit 默认 50，1–100；过期游标要求刷新 |
| `remote-cli/configure` 扩展 | changes 增加 idleHours:number；1–8760 整数小时，默认 24；沿用 revision 比较及保存回读 | Codex／Claude 独立；非法值在本机和远端分别拒绝；冲突 CLI_POLICY_CHANGED，不覆盖其他窗口 |
| actions.session-storage | inspect(host,provider,{after?,limit?})、logs(host,provider,{before?,limit?})、recordPolicy(host,provider,policy) | 注册的宿主服务可包装／替换；实际 IPC 委派以上方法；既有 reclaim／restoreFor／cancel／dispose 保留 |
| UI 扩展 | .remote-retention、.retention-provider、.retention-sessions、.retention-logs | 使用既有多实例 observeSurfaces 注册／替换；停用后恢复核心界面，不预装开发示例 |

类型定义位于 packages/remote-account-catalog/retention-types.ts。RetentionInspection 包含 provider、policy、available、observedAt（远端秒）、receivedAt（本机接收秒）、sessions、total、nextCursor、loginBusy、running、lastCheck?、issue?。每个 RetentionSession 含会话／账号／代次／原生线程编号、lastModelActivity／idleSeconds／dueAt（未知为 null）、eligible、clockReason、active／interrupted／uncertain、remoteState、operation，以及可选本机归档状态和字节数。标题仅从匹配的本机工作台会话补充；不读取远端聊天正文或原生数据库。此列表覆盖工作台登记的原生会话，不冒称盘点所有独立 CLI 历史。

倒计时以服务器观测时间修正本机时差，每秒更新；列表每 15 秒只读刷新。清理开关关闭、未知时间、服务器时钟超前、已回收与恢复中分别显示。到期显示“待清理”，实际仍须下轮调度、停止残留写入、归档和校验。断线保留旧列表并暂停倒计时展示；本机日志独立可读。后台仍每分钟调度，打开页面不会发起清理、初始化或刷新模型活动时钟。

实际执行中，retention/candidates、retention/begin、最终 storage/mark 和 runtime_maintenance.reclaim_expired 共用所选 idleHours 转换的秒数；原生账号服务只接受 root 控制面传入的 1–8760 整数小时。增加只读 retention/inspect → storage/sessions；分页不建立活动基线、不停止进程、不扫描原生历史。修改小时数时取消本机同运行时在途归档，删除标记前再次读取当前策略并核验时限。原有配置 24 无需迁移；自定义时限必须通过 retentionVersion=2 和 idleSeconds 回读核验；旧远端常驻服务无法确认时返回 STORAGE_POLICY_UNSUPPORTED 并拒绝清理，不按旧 24 小时规则回退。服务更新仍需明确部署，源码修改不等于自动部署。

RetentionLogPage 返回 entries、nextBefore、issue?、location、maxEntries=2000、retentionDays=30。记录含 id、at／lastAt（本机毫秒）、provider、kind、message、sessionIds、repeat 及可选 accountId／archiveId／code／bytes；kind 为 checked、archiving、reclaimed、deferred、error、cancelled、restoring、restored、policy。日志写入本机应用数据目录的 remote-session-archives/logs，按 VPS 分文件；保存近期 30 天且最多 2,000 条／4 MiB，空检查按小时合并。只保存操作元数据、固定原因和错误码，不保存聊天、凭据或原始 SSH 输出，也不上传远端。

日志采用有界内存队列与原子替换；清理锁先释放，日志落盘等待最多额外 2 秒。日志写入失败在 issue 中说明原因并保留内存记录，不阻断会话清理；退出／进程崩溃前尚未落盘的记录可能丢失。已损坏历史日志保留原文件，不伪报写入成功。清理失败按具体原因记录：连接失败、磁盘余量不足、权限异常、校验失败、缺失原生依赖、策略变化、取消与未确认回执。查询不抛弃已保存的本机记录。

~~~ts
const page = await api.call('remote-storage/inspect', { id: adminHostId, provider: 'codex', limit: 50 });
await api.call('remote-cli/configure', {
  id: adminHostId, provider: 'codex', revision: page.policy.revision,
  changes: { reclaimIdle: true, idleHours: 48 },
});
const logs = await api.call('remote-storage/logs', { id: adminHostId, provider: 'codex', limit: 50 });
~~~

覆盖矩阵：策略范围／实际过期和只读分页 → scripts/test-session-retention-console.py、scripts/test-remote-resources.py；列表协议／日志持久化与故障隔离／权限和真实 IPC → tests/session-retention-console.test.ts；断线续传／取消／删除回执 → tests/session-storage-recovery.test.ts、tests/session-storage-budget.test.ts、scripts/test-session-retention-faults.py；浅深色／窄窗／离线日志／设置回读 → scripts/test-session-retention-console-ui.mjs。事件沿用 IPC 回执与定时只读刷新，不增加模型工具或自动模型回合。
<!-- session-retention-console:end -->

<!-- connections-compact:start -->
## 连接页紧凑展示（2026-09-28 JST）

本次仅精简连接页五个标签的标题、常驻说明和间距，不修改业务接口、权限或存储格式。原有调用参数、返回类型、错误及事件沿用下文契约；异步加载、操作互斥、确认、卸载和停用恢复流程不变。没有新增迁移步骤或自动远端操作。

| 功能覆盖 | 可替换界面入口 | 已有调用与验证 |
| --- | --- | --- |
| 工作空间 | .studio-panel、.workspace-quotas | studio/list、studio/plan、studio/apply；scripts/test-ssh-workspaces-ui.mjs |
| 共享账号 | .provider-accounts、.claude-management、.native-account-state、.account-usage、.model-account-login | accounts/list、native-accounts/*、accounts/usage；远端 Codex/Claude 登录通过弹窗启动，成功后回读目录；scripts/test-native-account-ui.mjs、scripts/test-remote-management-ui.mjs |
| 远端 CLI | .remote-cli、.remote-cli-policies | remote-cli/list、remote-cli/configure、remote-cli/plan、remote-cli/apply；scripts/test-remote-resources-ui.mjs |
| 浏览器用户 | .remote-browser、.browser-control-bar、.browser-profile-launch | remote-browser/*；scripts/test-remote-management-ui.mjs |
| 连接详情 | #connection-panel-details、.remote-resources | remote-resources/*、remote-files/*；scripts/test-remote-resources-ui.mjs |

界面扩展继续使用 api.observeSurfaces(selector, placement, render)，返回释放函数并由 api.onDispose 注销；placement 为 before、after 或 replace，render 接收既有 SurfaceContext。替换随标签挂载和移除，停用恢复原界面；无效选择器或渲染失败沿用现有错误处理。示例：

```js
const release = api.observeSurfaces('.browser-control-bar', 'after', ({root}) => {
  root.textContent = 'Extension controls';
});
api.onDispose(release);
```

data-testid 与调用名称保持不变；按钮和开关的可见中文不是固定接口。界面自动化应使用稳定标识或更新后的可访问名称，例如“确认关闭”和“闲置 24 小时后回收”。回收细则移至悬停提示，额度规则默认折叠；实际错误、归档状态、安装预览及破坏性确认仍显示。账号测试补齐既有导航、扩展外观与运行时列表的只读启动夹具，不放宽对未声明请求的检查。
<!-- connections-compact:end -->

<!-- browser-control:start -->
## 独立浏览器控制接口（2026-09-28 JST）

以下增量接口经 api.call → host dispatcher → actions.remote-browser.control 实际执行。既有 remote-browser/start 仍为 Claude CLI 登录，语义未改变。新方法为可选增量；旧服务替换未提供 control 时明确报告接口不可用，不模拟成功。apiVersion 保持既有版本。

| 功能 | 入口与参数 | 返回与测试 |
| --- | --- | --- |
| 指定用户启动并打开 | remote-browser/launch({id,profileKey}) | BrowserControlResult；tests/browser-control.test.ts、scripts/test-browser-control.py |
| 仅恢复已有浏览器操控 | remote-browser/reconnect({id}) | BrowserControlResult；浏览器未运行时不自动启动 |
| 显式关闭并保留资料 | remote-browser/stop({id,confirm:true}) | running:false、viewerReady:false、profilesPreserved:true；scripts/test-remote-browser-profiles.py |
| 可替换开发服务 | actions.remote-browser.control(host,action,options?) | action 为 launch/reconnect/stop；options={profileKey?,confirm?}；tests/controller-remote-management.test.ts 验证实际 IPC 替换与释放恢复 |
| 动态界面替换 | .browser-control-bar、.browser-profile-launch | observeSurfaces 的多实例替换和 onDispose 释放；scripts/test-remote-management-ui.mjs 验证桌面按钮及窄窗口 |

id 为已保存 root 管理员 SSH 连接，profileKey 为既有 32 位十六进制用户标识；不得用标签或路径替代。BrowserControlResult 类型在 packages/remote-account-catalog/browser.ts，字段为 running:boolean、viewerReady:boolean、profilesPreserved:true、profileKey?:string；launch 回传所选标识。返回值为操作完成时的核验回执，不承诺其后网络一直可用。不新增推送事件，错误通过现有 IPC Error.message 返回，界面可显式重试恢复连接。

权限沿用严格 SSH 身份、root 管理入口和远端专用浏览器 UID。用户须主动发起启动、恢复或确认关闭；模型内容不构成授权。启动、恢复、停止与原生登录共用互斥，运行中的 CLI 登录不被这些入口中断。单实例检查在远端 manager.lock 内完成，已有受管理 Chrome 时拒绝再次启动或切换用户；渲染子进程属于同一浏览器，不作为独立实例。

生命周期：日常浏览器独立于 SSH 命令寿命；网络中断或退出工作台保留远端浏览器。恢复连接不调用 Chrome 启动、不重启原显示服务，必要时只修复所属 noVNC bridge。工作台建立独占本机回环 SSH -N 通道，没有 15 分钟固定退出；确认 HTTP 与 RFB 握手后交给本机默认浏览器。失败只回收此次本机通道，远端不自动关停或重试启动。关闭先断开本机所属通道，再核验远端浏览器、bridge、desktop 均退出；仍有进程或回执丢失报告未确认。退出工作台关闭本机通道，并取消未完成的控制请求；既有临时 CLI 登录继续遵循其独立清理规则。

关闭只匹配指定服务 UID、程序路径、用户目录、显示与端口的所属进程，核对进程出生身份后结束其子树。用户配置、Cookie、登录资料不删除；不调用全局 killall，不清理系统缓存、其他软件或其他浏览器目录。内存自动回收与本接口分开，手动打开的浏览器仍排除在自动回收之外。

固定英文远端错误包括 BROWSER_ALREADY_RUNNING、BROWSER_NOT_RUNNING、BROWSER_DESKTOP_UNAVAILABLE、BROWSER_BUSY、BROWSER_START_FAILED、BROWSER_RECONNECT_FAILED、BROWSER_STOP_UNCONFIRMED；本机转换为中文。BROWSER_ALREADY_RUNNING 提示先关闭当前浏览器或恢复连接。关闭可在安装组件缺失时尝试，不把缺失依赖冒称没有运行进程。策略不改写本机外部脚本或远端安装；源码随本次显式 SSH 请求传输，运行中服务部署仍是独立动作。

```js
await api.call('remote-browser/launch', {id: adminConnectionId, profileKey});
await api.call('remote-browser/reconnect', {id: adminConnectionId});
await api.call('remote-browser/stop', {id: adminConnectionId, confirm: true});
const release = api.services.intercept('actions.remote-browser', 'control',
  async (next, ...args) => next(...args));
api.onDispose(release);
```

本机 tunnel/probe 开发实现位于 packages/remote-account-catalog/browser-viewer.ts；服务构造器第三参数可注入 BrowserViewerConnector，合约为 (host,AbortSignal) → Promise<{url,close():Promise<void>}>。替换仍须固定回环地址、取消和所属进程边界。此受信任注入不是模型任意打开网页入口。额外回归为 scripts/test-remote-browser-login.py，验证日常控制不改变 CLI 临时授权生命周期。
<!-- browser-control:end -->

<!-- planning-modes-20260928:start -->
## 原生计划模式与主动停止（2026-09-28 JST）

本节修订下方早期“plan 仅 Claude”及 Claude 本机原生连接不支持实时权限切换的说明。Codex 计划协作与权限独立；Claude 计划仍为原生权限模式。SSH Claude 的 H 门禁不变。

| 功能覆盖 | 入口、参数与返回 | 原生路径与测试 |
| --- | --- | --- |
| Codex 计划选择 | session/collaboration({sessionId:string,mode:'default'或'plan'}) → Promise<AppState>；session/create 的 Codex 输入可带 collaborationMode；Session、NewSessionDraft 增加同名可选字段 | turn/start.collaborationMode；tests/planning-modes.test.ts、tests/composer-runtime.test.ts |
| 两家计划入口 | composer/catalog 返回 action:'plan'，runtime 区分两家；Codex 加号或 /plan 切换独立胶囊，Claude /plan 为权限选择的快捷入口 | scripts/test-planning-ui.mjs、scripts/test-composer-runtime-ui.mjs |
| Claude 运行中权限 | session/permissions({sessionId,permissionMode}) → Promise<AppState>；runtime.native-provider.permissions(id,mode) → Promise<void> | 已绑定本机进程的 set_permission_mode 控制请求及关联回执；packages/runtime-claude/control.ts |
| Claude 计划批准与回读 | session/approval({sessionId,requestId,optionId,receipt})；既有返回形状不变 | ExitPlanMode 原生批准／拒绝，system.permissionMode 回读；scripts/test-native-planning.mjs |
| 完整计划与翻译 | session/plan({sessionId,reference:PlanReference}) → Promise<PlanDocument>；plan/translate({sessionId,reference,blockIndex?:number}) → Promise<void> | 原生全文、稳定分段和独立译文；省略索引翻译全部，可单段重译；tests/plan-review.test.ts、scripts/test-planning-ui.mjs |
| Codex 计划决策 | session/plan/respond({sessionId,reference,action:'implement'或'revise'}) → Promise<{action}> | 只接受最新完成回合的原生 plan 内容项；implement 明确新启 default 回合，revise 留在 plan 并等待用户输入 |
| 会话切换运行时 | session/model-target({sessionId,targetId}) 既有返回不变；ModelLane 新增可选 permissionMode、collaborationMode | 独立保存权限与协作模式，旧计划决策失效，工具目录和 UI 依绑定刷新；同会话双向实测 |
| 主动停止 | session/stop({sessionId})；本机原生成功返回 {stopped:true,scope:'owned-native-process'} | 清理所属进程组后设 idle/interrupted，清空待审批与错误；两家下一条明确消息可继续原生线程 |
| 只读 MCP 元数据 | PeerMcpSession.handle(tools/list) → 原 MCP JSON-RPC 结果 | 已知列表／读取工具增加 readOnlyHint 等注解；不自动批准首次 MCP 使用，不为消息发送或创建会话添加只读注解 |

### 模式、权限和生命周期

Codex 的 session/collaboration 仅接受已存在的 Codex 会话；运行中、归档、结果未知及重叠权限／身份操作拒绝。选择不启动模型、不改变 permissionMode；下次明确提交使用该值。旧存档省略 collaborationMode 按 default 处理；原生恢复后明确发送 default 可退出先前原生 plan。线程返回的模型用于缺省配置，计划模式缺少可核实模型时拒绝；不猜模型名。原生参数 settings 使用 model、reasoning_effort 和 developer_instructions:null，保留 CLI 自带模式指引，不以普通提示词模拟计划。

Claude 本机第三方 provider 连接在所属子进程追加原生 --settings：permissions.disableAutoMode="disable"、useAutoModeDuringPlan=false；使用人工审批，避免把任意第三方模型冒充原生安全分类器。原生 plan 仍阻止实现编辑；普通工具首次使用仍可请求批准。不会写入用户原生设置或停用原生子 Agent。启动参数 --allow-dangerously-skip-permissions 仅让原生支持后续明确选择完整访问，不在计划期间启用 bypassPermissions。ExitPlanMode 的 accept、plan-accept-edits、plan-full-access 分别以原生 updatedPermissions 的 session/setMode 切到 default、acceptEdits、bypassPermissions；始终沿用原始 updatedInput，拒绝新增 plan 执行选项。默认选择手动批准编辑，完整访问须显式点选。继续规划发送原生 deny。宿主只按实际 system.permissionMode 更新选择及 active settings，不按按钮点击猜测退出结果，不更改项目默认偏好。

运行中权限控制按 request_id 关联，只有成功回执且 mode 一致才确认；原生拒绝、15 秒超时、断线、模式不一致均不自动重试或重启。错误包括 CLAUDE_CONTROL_BUSY、CLAUDE_CONTROL_CLOSED、CLAUDE_CONTROL_REJECTED、CLAUDE_CONTROL_UNCONFIRMED、CLAUDE_PERMISSION_MODE_UNCONFIRMED；原生版本不支持某种动态切换时保留错误和原选择。完全访问仍须用户明确选择且由原生接受。Codex 参数错误为 COLLABORATION_MODE_INVALID、COLLABORATION_MODE_BUSY、COLLABORATION_MODEL_REQUIRED。既有 IPC 忙碌与会话校验仍生效。

主动停止先取消当前请求、清理仅属于该会话的原生进程树，并等待关闭；确认后过期待审批／提问，停止相关活动，不删除历史、不重发旧请求，不新增停止提示、空的停止计时行或“恢复发送”入口。真正断线或清理未确认仍保留 uncertain，并可抛出 NATIVE_STOP_UNCONFIRMED；不能用 UI 隐藏代替终止。正常停止无新模型轮次；下一条消息必须由用户明确发送。未修改其他桌面端、远端服务或全局 CLI 配置。

### 全文、翻译与决策契约

PlanReference = {kind:'approval'或'message',receipt:string}。Claude receipt 来自当前 nativeApprovals；Codex receipt 来自 Message.planReview，后者只在原生 item/completed 的 type=plan 时创建，不把进度清单或普通正文猜成待执行计划。PlanDocument 包含 reference、runtime、text、blocks:{source:string,translatable:boolean}[]、canRespond 和可选 translation、translationStatus、translationError、translationSource、planTranslationBlocks。planTranslationBlocks 与 blocks 同序，每项为 {translation?:string,translationStatus:'pending'或'complete'或'failed'或'off',translationError?:string,translationSource?:string}；原始 source 只在 blocks 中，不修改审批全文。批准／拒绝和完整原文彼此独立。新字段兼容旧存档；旧全文译文缺少分段时按原始计划重新分段翻译，旧普通消息不追补为可执行计划。

Claude 的原始 ExitPlanMode 请求会阻塞当前回合，session/approval 直接回应该请求。Codex 的 plan 是上下文里的内容项，不是 Claude 式工具批准；session/plan/respond 的 implement 先记录 accepted 并切换 collaborationMode=default，再发送一次明确的 Implement the plan. 用户操作回合，不改变 sandbox／approval 权限。revise 记录 revise、保持 plan、返回输入框，零自动派发。旧回执、重复操作、停止或切换后的计划、非 Codex 请求均拒绝。原生已完成但所属进程尚在收尾时，等待已有清理后再校验，不停止工作中的任务。清理或提交失败不自动重放；结果通过既有状态和错误回读。

翻译开启时 Claude 待批准计划自动进入既有 translation 模块；Codex 原生计划按完成消息翻译。plan/translate 可显式重试；blockIndex 为 session/plan 返回 blocks 的零基索引，仅重译所选段落，省略时批量翻译可译段落。列表、嵌套列表和表格保留完整 Markdown 容器，但其中说明文字照常翻译；既有保护器保留内联代码、命令、路径和受保护片段；按渲染所用 Markdown 解析器补齐列表／引用内部的围栏与缩进代码保护，无法定位完整代码或围栏未闭合时拒绝外发。保护标记格式和既有 translation 接口不变，测试含 tests/translation.test.ts。独立代码块不发往翻译服务，只显示一次原文，不显示重译操作。空白和分隔线也不发送。译文只用于显示／复制，不能修改原生 input、工具标识、审批或实际提交。

同一段重复请求合并；不同段可并发并逐项合并最新状态，全段与单段重叠请求以 PLAN_TRANSLATION_BUSY 拒绝。单段失败或重译等待时保留上一版及其他段结果，不自动重试；应用重启将中断段标为 failed，恢复可手动重试的图标，不自动派发。按会话、receipt、原文和翻译配置绑定结果；计划过期、替换、原文变化、停用、配置变化或释放后丢弃迟到译文。错误为 PLAN_REFERENCE_INVALID、PLAN_EXPIRED、PLAN_BLOCK_INVALID、PLAN_BLOCK_NOT_TRANSLATABLE、PLAN_TRANSLATION_BUSY、既有翻译模块错误及状态 failed；翻译失败保留全文和重试入口，不阻塞原文审批。该接口不获得额外文件、网络、跨账号或运行权限。

右侧阅读器通过现有 reader 互斥占位：文件、子会话和计划同时只占一个右侧位置；打开计划时对话临时使用 inline 上下原文／译文，translationLayout 偏好不改。关闭恢复先前显示和焦点，未提交草稿保留；Claude 批准／停止使请求失效并关闭面板，运行时或目标切换关闭旧计划面板。计划按每段原文紧跟本段译文排列，沿用正文的 InlineTranslation、细分隔线和紧凑排版，不增加重复语言标题或段落卡片。段末复用正文 TranslationAction 图标；scope='block' 只改悬停／无障碍文字为本段，默认 scope='message' 保持原行为。Markdown、链接、代码、复制均沿用既有阅读组件。新增多实例扩展 surface：plan-reader 和 plan-review，后者覆盖 Claude 批准卡与 Codex 决策区；可由既有 ui surface 注册／替换和全局样式扩展调用，异步插入及停用恢复遵循现有生命周期。

跨运行时切换不把 Claude plan 转成 Codex read-only。目标自己的已保存 lane 设置优先，其次同运行时当前设置或目标运行时偏好；Codex collaborationMode 仅在 Codex lane 使用。切换清除待审批、提问和旧计划可操作状态，但保留历史正文。原生工具来自下一轮目标运行时重新建立的会话；catalog 的 scope 校验拒绝旧菜单请求，不仅切换界面标签。运行中或待审批禁止切换。

示例：await api.call('session/plan', {sessionId:'session-id',reference:{kind:'approval',receipt:'current-receipt'}})；await api.call('plan/translate', {sessionId:'session-id',reference:{kind:'message',receipt:'proposal-receipt'},blockIndex:1})；await api.call('session/plan/respond', {sessionId:'session-id',reference:{kind:'message',receipt:'proposal-receipt'},action:'implement'})。参考 tests/plan-review.test.ts（分段保护、重译、并发、失败和过期）、tests/composer-runtime.test.ts 和 scripts/test-planning-ui.mjs（两家计划 UI、正文图标复用和单段派发）；原生权限实测见 scripts/test-native-planning.mjs。

### 开发与替换约定

上述宿主入口通过既有 api.call、useHost/registerMethod 和 workbench.controller 服务调用；权限／停止的实际执行器为 runtime.native-provider。完整批准的插件可沿用 services.intercept/override 接入同一路径，撤销恢复核心实现。渲染器保留原权限多实例 surface；计划胶囊标识 data-testid=composer-plan-mode，可经已有 composer surface／样式扩展替换，停用自动清理。选择字段保留在会话中，停用界面扩展不擅自切换运行时。状态通过既有 state/onState 发布，不增加轮询或自动继续事件。apiVersion 1 不变，旧权限枚举和审批 receipt 兼容；扩展不得把 collaborationMode 解释为文件授权或跨设备权限。

调用示例：await api.call('session/collaboration', {sessionId:'session-id',mode:'plan'})；await api.call('session/permissions', {sessionId:'session-id',permissionMode:'plan'}) 仅用于 Claude 计划权限；await api.call('session/stop', {sessionId:'session-id'})。

/goal 与目标胶囊尚未接入工作台，本节不声明其实现。安装版本的原生目标接口和模型是否实际执行计划分别核验，不能用菜单、合成返回或协议成功代替真实模型验收。
<!-- planning-modes-20260928:end -->

<!-- compact-popovers:start -->
## 紧凑用量与权限浮层（2026-09-28 JST 后续修订）

本节修订此前用量大卡片的尺寸与层次，权限继续保留逐项小字说明；计量和权限执行语义不变。过度压缩成行、隐藏未知缓存命中和将权限说明移到底部的试稿已被用户否决，不作为验收通过方案。

| 功能覆盖 | 入口、类型与返回 | 扩展与验证 |
| --- | --- | --- |
| 会话累计与当前选择分离 | session/metrics({sessionId:string}) → Promise<MetricsSnapshot>；sessionMetrics(session?:Session) → MetricsSnapshot，新增可选 selection?:{runtime:RuntimeKind,model:string} | 原有 host registerMethod/useHost、state/onState；tests/session-metrics.test.ts |
| 紧凑来源明细 | SessionMetrics({session?,snapshot?})；保留 [data-session-metrics][data-session-id] 与 [data-testid=session-metrics-details] | renderer.observeSurfaces 多实例 replace；scripts/test-session-metrics-ui.mjs、scripts/test-compact-popovers-ui.mjs |
| 紧凑权限选择 | PermissionSelector(props:PermissionSelectorProps) → React 元素；[data-permission-selector][data-runtime] | renderer.observeSurfaces 多实例 replace；原有 RuntimeCatalogEntry.permissions 可注册自定义值；scripts/test-compact-popovers-ui.mjs |

selection 是所选配置：modelSelection.model 优先，缺省才用 nativeEffectiveModel.model，否则为空；没有 Session 时省略。它不是已执行证明，也不改变 groups 的回执归属。相同模型名在不同 runtime 下保留不同组；切换不清空累计，同 runtime/model 的新回执继续累计原组。UI 仅按两个字段精确匹配“已选”，不合并别名或未知模型；尚无匹配组时另列“已选／暂无记录”，不制造零用量组。只给旧 snapshot 且无 selection 时仍正常显示，不从唯一历史组猜测当前选择。

默认用量浮层宽 280px：标题、适度强调的总量、两列指标、来源与短提示分层排列；输入／输出与速度／缓存命中使用相同两列基线，标签在上、数值在下。缓存命中始终可见，未知显示“—”，已报告的零值显示 0%；缓存读取／写入计数仅在报告后增加对应指标。速度仍为最近请求／最近回合的回执，悬停说明包含其口径，不能解读为刚选中模型的速度。单来源不重复总量；多来源每项模型名在上、运行时及已选标记在下、用量靠右，可逐项展开精确计数。来源列表最高 176px，超出内部滚动；长名字省略并保留完整悬停文本。部分记录保留下界和短提示，不新增轮询、模型调用或账单估算。

PermissionSelectorProps 导出于 apps/desktop/renderer/PermissionSelector.tsx：runtime:RuntimeKind、value:PermissionMode、extension?:{name:string,permissions:RuntimePermission[]}、disabled?:boolean、pending?:boolean、onChange:(value:PermissionMode)=>void。权限菜单宽 280px，每项保留名称、下方小字说明和右侧勾选；长说明正常换行，不移入公用页脚或只在悬停时提供。两处浮层沿用阅读区同类衬线字体、浅暖／深灰主题和克制的字重；权限每行只压缩内部边距。悬停不调用 onChange；仅确认不同值时调用一次，原生枚举与扩展权限值原样传出。组件不自行保存、不请求权限、不新增错误或宿主事件。

实际保存仍由既有 session/permissions({sessionId,permissionMode}) 或草稿 permissions/remember({projectId:string|null,runtime,permissionMode}) 返回 Promise<AppState> 并发布 state。忙碌、结果未知、模式无效、运行时拒绝及保存中的错误沿用宿主校验；布局不扩大原生沙箱、操作审批、设备或租户权限。菜单支持方向键、Home/End、Enter、Escape、Tab 和外部点击；运行时切换、pending/disabled、组件卸载或扩展替换会关闭旧菜单，停用扩展后恢复核心控件。定位和 ResizeObserver 随菜单关闭释放，不保留额外配置。

apiVersion:1 不变，selection 是可选增量，不迁移 Session.metrics/version:1 存档；旧插件继续可读。样式沿用主题变量；插件可用既有 CSS/多实例 surface 替换布局。示例：

```js
const usage = await api.call('session/metrics', { sessionId });
const selected = usage.selection;
const selectedGroup = selected?.model
  ? usage.groups.find(g => g.runtime === selected.runtime && g.model === selected.model)
  : undefined; // Missing receipt is not zero usage.
const release = api.observeSurfaces('[data-permission-selector]', 'replace', ({ root, target }) => {
  root.textContent = `Permission control: ${target.dataset.runtime}`;
  // A complete replacement submits the user's confirmed value through the existing host method.
});
api.onDispose(release);
```

两组隐藏 Electron 脚本只用合成状态，验证双主题、两列对齐、缓存命中未知/零值始终可见、逐项权限小字、逐来源展开、切换前后回执、多来源长名、窄屏、键盘、禁用及插件替换恢复。脚本通过不等于用户认可视觉方案；测试不操作在用窗口或证明真实模型计费、远端部署。
<!-- compact-popovers:end -->

<!-- remote-maintenance:start -->
## 远端资源、文件与原生副本管理（2026-09-28 JST）

增量 v1 契约：以下入口经现有 api.call、host middleware 和可替换服务进入真实控制器路径。id 为已保存 SSH 管理员连接，要求 root、既有主机身份校验和系统权限，模型内容不构成管理员授权。

### 功能覆盖矩阵

| 功能 | 入口、参数与返回 | 服务及验证 |
| --- | --- | --- |
| 内存及磁盘 | remote-resources/read({id}) → RemoteResources：Unix 秒 observedAt、字节制 memory/storage、policy、runtime | actions.remote-resources.read(host)；tests/remote-resources.test.ts、scripts/test-remote-resources.py |
| 自动／手动内存回收 | remote-resources/configure({id,revision,autoMemory}) → {revision,autoMemory}；remote-resources/reclaim({id}) → {result:{available,closed:string[],protected,pending}} | 同服务 configure/reclaim；CAS 保存并回读 |
| 文件浏览 | remote-files/browse({id,path}) → RemoteFileView：POSIX path/parent、kind、revision、entries/content、size/modified/mode/link | 同服务 browse(host,path)；只在明确调用时访问远端 |
| 文件与目录管理 | remote-files/mutate({id,operation,path,revision?,destination?,content?,confirm?})；operation=mkdir/write/move/copy/remove | 同服务 mutate(host,operation,input)；返回 {path,completed:true} 或写入 {path,revision,bytes} |
| 上传／下载 | remote-files/upload({id,path})；remote-files/download({id,path,revision}) | 同服务 upload/download；原生本机对话框，取消 {cancelled:true}；下载返回 {path,bytes}，上传返回写入回执 |
| 两家独立 CLI 策略 | remote-cli/configure({id,provider,revision,changes}) → RemoteCliPolicy；现有 remote-cli/list({id}) 回读 | actions.remote-cli-policies.configure(host,provider,revision,changes)、autoUpdate(host,provider)；scripts/test-remote-cli-lifecycle.py |
| 归档状态 | remote-storage/status({id}) → {archives,partial,damaged,bytes,providers} | actions.session-storage.status(host)；每 provider 最近 checkedAt/reclaimedBytes/error |
| 归档、恢复、取消 | actions.session-storage.reclaim(host,provider,RetentionOptions?) → {reclaimedBytes,deferred,transferredBytes} 或忙时 undefined；restoreFor(adminHost?,session,{signal?}) → void；cancel(host,provider) / dispose() → void | tests/session-storage-recovery.test.ts、scripts/test-session-retention-faults.py；AbortSignal 中止传输，dispose 停止后续所属请求 |
| 动态界面扩展 | .remote-resources、.remote-file-dock、[data-testid="remote-cli-codex"]、[data-testid="remote-cli-claude"] | observeSurfaces(selector,'replace',...) 覆盖所有动态实例，停用恢复核心 DOM；scripts/test-remote-resources-ui.mjs |
| 新建浏览器资料删除 | 既有浏览器 profile 删除接口 | 另一资料运行时，仅删除可证明从未打开的工作台新建资料，不改 Chrome 共享 Local State；scripts/test-remote-browser-profiles.py |

类型在 packages/remote-account-catalog/resources.ts、cli.ts、session-storage.ts。provider=codex/claude；changes 仅 autoUpdate/reclaimIdle。RemoteCliPolicy 含 revision、autoUpdate、reclaimIdle、固定 idleHours:24 及可选 lastUpdateAttempt/lastUpdateError。缺少 CLI 也能保存策略；自动更新不安装缺失程序、不接管外部渠道。仅受管理且无执行／登录／提交冲突的安装每天最多尝试一次，失败回执保留。两个运行时策略独立。

事件：策略和文件操作返回确认回执，不新增虚构 push 事件。资源界面每 15 秒回读，CLI 可经 list 回读。确认中断后的 Session 变化通过既有 state/onState 发布；中断回执匹配 sessionId/threadId/turnId，并核对读取期间未新增本机用户任务，防止旧回执解锁新回合。插件自建轮询须 onDispose 清理。

内存生命周期：远端服务每 15 秒采样，低内存连续三次且距离上次回收至少 120 秒才自动处理。阈值为 available < min(total*25%,max(256 MiB,total*15%))；只终止已登记、空闲的工作台原生运行时，保护实际运行、子任务、待处理 RPC 和审批。已判结果不明的所属运行时在下一次维护检查直接收尾，不继续保护。每 30 秒探测原生控制回路；探测后连续 120 秒无响应则中断所属进程树，不把单纯无文字输出当故障。清理失败隔离并重试同一身份守卫；重启遗留收据只在确认专用 systemd cgroup 无旧进程后释放。浏览器、其他后台软件、系统页缓存不参与清理。自动策略开启时暂缓低内存新任务；不能保证其他软件不会耗尽全机资源。

存储生命周期：开关默认关闭。桌面开启且管理员连接可达时执行；24 小时按可信模型／工具活动计算，UI、健康查询不续期。按会话及子会话／分支依赖分组，活跃同账号会话不挡住其他过期组，仍被其他组引用的历史只备份不删除。过期审批／不明进程先收尾，再归档原始字节。256 KiB 分块可续传，SHA-256、文件 fsync 和清单落盘核验后才允许远端标记和删除；重试绑定不可变清单哈希，部分删除／丢回执可续办。新连接／分支在原生 resume 前还原必需组；不以可见聊天代替原生上下文。关闭回收不阻止恢复既有归档。

单组上限 8 GiB／10,000 文件，扫描上限 50,000 文件；本机、远端另保留 min(2 GiB,10% 总容量) 余量。凭据、配置、SQLite、共享索引和其他用户文件不在自动删除清单，不保证整个 VPS 总储存恒定。本机长期归档保留；远端恢复残片 .awb-<archiveId> 可供同一归档续办；过期组重新核验本机完整归档后也可清理本归档的残片。损坏清单显示 damaged，相关原件不继续删除，其他有效组继续。未知原生元数据或缺失依赖拒绝删除；Claude 格式恢复测试不代表远端执行 H 通过。

文件安全及错误：仅 POSIX 绝对路径，拒绝 ..、系统伪文件及符号链接跟随，递归复制／删除不跨挂载点。复制上限 20,000 条／2 GiB，单文件传输 32 MiB、文本编辑 1 MiB。文件描述符固定父路径；编辑须 revision，已有目的地不覆盖，删除须 confirm:true。HTML 只显示源码，其他二进制可下载。递归失败可能部分完成，需刷新核对，不自动重试。固定英文服务错误包括 RESOURCE_POLICY_CHANGED、REMOTE_FILE_CHANGED/EXISTS/LINK/MOUNT/TOO_LARGE、STORAGE_BUSY/CHANGED/ARCHIVE_CHANGED/RESTORE_CONFLICT/DISK_PRESSURE；本机适配器转换为中文 Error.message，不将中文注入模型协议。

替换／迁移：api.services.intercept / api.services.override 可包装或替换上述三个 actions 服务，host middleware 可替换命名空间；替换仍须履行身份、CAS、归档核验及生命周期。释放注册恢复核心服务，不删资料。旧 VPS 未部署维护服务时 runtime.available=false，资源和文件管理仍可用；界面明确策略执行未就绪，不把保存开关冒充部署。不自动升级远端。旧配置缺省关闭，新增收据字段增量兼容，apiVersion 不变。

```js
const value = await api.call('remote-resources/read', { id: adminConnectionId });
await api.call('remote-resources/configure', {
  id: adminConnectionId, revision: value.policy.revision, autoMemory: true
});
const rows = await api.call('remote-cli/list', { id: adminConnectionId });
await api.call('remote-cli/configure', {
  id: adminConnectionId, provider: 'codex',
  revision: rows.find(row => row.provider === 'codex').policy.revision,
  changes: { reclaimIdle: true }
});
await api.call('remote-files/browse', { id: adminConnectionId, path: '/home' });
const release = api.observeSurfaces('.remote-resources', 'replace', ({ root }) => {
  root.textContent = '自定义 VPS 资源面板';
});
api.onDispose(release);
```

补充验证：tests/remote-maintenance-controller.test.ts、scripts/test-account-runtime-socket.py、scripts/test-native-session-retention.mjs。实际 CLI 使用合成原生目录与回环上游，不访问真实登录／聊天，不等于真实 SSH/VPS 联验。
<!-- remote-maintenance:end -->

<!-- session-feedback:start -->
## 会话用量、实时输出与回合计时（2026-09-28 JST 后续修订）

本节取代后文底栏“立即悬停／聚焦展开”的交互。计时是工作台观察到的执行准入至结束回执的墙钟时间，包含 CLI 准备、工具与等待；不是纯推理耗时，也不参与 tok/s 计算。

### 功能覆盖矩阵

| 功能 | 入口、类型与返回 | 事件／替换与验证 |
| --- | --- | --- |
| 紧凑用量详情 | 既有 session/metrics({sessionId}) → Promise<MetricsSnapshot>；SessionMetrics({session?,snapshot?}) | [data-session-metrics][data-session-id] 多实例替换；scripts/test-session-metrics-ui.mjs |
| 回合开始与结束记录 | state/get → AppState.sessions[].turnTimings?: TurnTiming[]；observeTurnTiming(previous:Session|undefined, session:Session, at:string):void 在 StateStore.update 的真实提交路径调用 | 既有 state / renderer.onState 发布；tests/turn-timing.test.ts |
| 活跃时钟与完成耗时 | turnElapsedMs(timing:TurnTiming, now?:number):number|null；formatTurnDuration(ms:number):string；readingTurns(...).timing / active | [data-turn-progress][data-turn-id] 逐实例替换；scripts/test-turn-timing-ui.mjs |
| 跨协议流转发 | nativeWireStream(protocol:'responses'|'anthropic-messages', request:Record<string,unknown>) → {start():Json[],text(cumulative:string):Json[],finish(turn:ApiTurn,counts?:TokenCounts):Json[]} | openNativeGateway 的真实 SSE 转换路径；既有 runtime.native-provider 服务替换；tests/native-streaming.test.ts |
| Claude 原生文本增量 | NativeChildConversationTracker.observe('claude','root',frame) 的公开 text_delta，经 NativeProviderRunner 写入同一 Message | 完整 assistant 回执将临时流标识换成原生 UUID，保留消息 ID 与分支回执；scripts/test-native-streaming.mjs |

TurnTiming 为 {id:string,startedAt:string,endedAt?:string,userMessageId?:string,nativeTurnId?:string,status:'running'|'completed'|'stopped'|'failed'|'uncertain'}。首次进入 running 建立记录，首条已接收用户消息或原生回合标识随后绑定；插入消息、流式增量、查看页面不重置时钟。结束记录持久化；重启将遗留 running 标为 uncertain，不把离线时间计入已完成用时，也不替旧历史补造起止时间。turnElapsedMs 使用毫秒，未知结束返回 null，时钟回拨的负差钳为 0。at 非有效时间时 observeTurnTiming 抛 TURN_TIMING_INVALID_TIMESTAMP，StateStore 的写入失败仍不发布新快照。这里没有新增计时网络请求或模型调用。

renderer 每秒只更新活跃回合的显示，切换或卸载清理 interval。等待首个 CLI 内容时显示“等待 CLI 输出”；已收到的工具／推理状态沿用真实原生事件。完成后“用时”行可展开已有过程；仅正文且没有过程记录时仍显示耗时。这个界面不是终端逐字镜像，隐藏思考与签名不进入公开正文；未收到状态时不伪造“正在思考”。

用量按钮悬停满 1000 ms 预览，提前移开取消；移入详情保持，移出 160 ms 后关闭。左键或 Enter/Space 立即展开并保持，再点按钮、关闭图标、外部点击／焦点或 Esc 关闭。切会话、卸载、失焦与插件隐藏触发器会清理浮层／定时器。详情采用大号总量与两列数值，多来源明细默认折叠，单来源不重复整套计数；未知使用 —，下界保持 ≥，缓存仅显示已上报项。组件 props 和数据选择器兼容，原 .session-metrics-tooltip 样式名保留，但可交互面板的辅助技术角色由 tooltip 改为非模态 dialog，触发器使用 aria-expanded / aria-controls；扩展应以稳定 data 选择器定位。

跨协议 SSE 在读取上游文本增量时即转成目标原生事件，不等完整回答再重放；同协议仍逐块原样转发，非流 JSON 仍按完成回执转换。nativeWireStream.text 接收累计文本，只发新增后缀；不是把已完成答案拆成打字动画。事件 ID、序号和完成快照保持一致。工具参数在完整且有效的上游完成回执后才交付 CLI，工具执行权仍在 CLI。改写既有前缀抛 NATIVE_STREAM_TEXT_CHANGED，完成后继续写入抛 NATIVE_STREAM_FINISHED；流中断发错误事件，不发成功回执，网关不自行重试；取消关闭所属上游。该增量接口兼容既有 nativeWireEvents 的前四参数，新增可选第五参数 id?:string 仅用于关联同一流。

权限不变：读取状态与用量不增加宿主写入权限；renderer 替换仍需已批准的代码包，停用恢复核心节点。计时字段为可选增量，无需迁移；插件应探测字段并保留未知，不推断旧任务耗时。低层转换函数属于原生 provider 服务的扩展实现接口，不授予新的模型、工具或跨设备权限。

~~~js
const state = await api.call('state/get');
const session = state.sessions.find(item => item.id === sessionId);
const timing = session?.turnTimings?.at(-1);
// Renderer example: every live timer can be replaced and restored on disposal.
const release = api.observeSurfaces('[data-turn-progress]', 'replace', ({ root, target }) => {
  root.textContent = '自定义计时：' + target.dataset.turnId;
});
api.onDispose(release);
~~~

验证入口：npx tsx --test tests/native-streaming.test.ts tests/turn-timing.test.ts；node scripts/test-session-metrics-ui.mjs；node scripts/test-turn-timing-ui.mjs；显式设置 AWB_QA_CODEX / AWB_QA_CLAUDE 后运行 node --import tsx scripts/test-native-streaming.mjs。最后一项在隔离原生目录和合成 loopback SSE 中锁住完成帧，确认实际安装的两家 CLI 已在此前发出首段公开文字，再放行完成并核验无重复文本、单请求与持久耗时。隐藏 Electron、真实 CLI 合成上游、真实商业模型与远端出网证据分别计量。
<!-- session-feedback:end -->

<!-- session-idle:start -->
## 模型闲置判定接口（2026-09-28 JST）

| 功能 | 入口与类型 | 实际调用与验收 |
| --- | --- | --- |
| 建立活动基线 | `session_idle.initialize_activity(receipt: dict, now?: number): bool` | 新建/恢复远端运行时收据；仅缺失、非法或超前时钟写入一次，优先可用旧 `lastActivity` |
| 记录原生活动 | `session_idle.record_model_activity(receipt: dict, message: dict, now?: number, provider='codex'): bool` | 所属会话 fence 核验后的原生输出；识别 Codex / Claude 各自事件，写入 `lastModelActivity`，调用方在改变后持久化 |
| 选择过期会话 | `session_idle.idle_status(receipt: dict, now?: number, idle_seconds=86400): dict` | 存储候选及过期进程收尾共用；返回 `eligible/lastModelActivity/idleSeconds/reason` |
| 原生恢复验收 | `scripts/test-native-session-retention.mjs` | 显式测试用 CLI 路径、合成临时目录和文件传输；验证恢复后实际原生续聊，不访问用户聊天库 |
| 故障恢复验收 | `tests/session-storage-recovery.test.ts`、`scripts/test-session-retention-faults.py` | 本机取消/断线/损坏/重启续传及 Linux 原生删除一半/丢回执/恢复残片；只操作合成隔离目录 |

时钟单位为 Unix 秒，`idleSeconds` 是已过去的模型无活动时长；`reason` 为 expired/recent_model_activity/activity_unknown/clock_ahead。非法调用返回固定英文 `SESSION_IDLE_RECEIPT_INVALID`、`SESSION_IDLE_CLOCK_INVALID` 或 `SESSION_IDLE_INTERVAL_INVALID`。不认识的事件和提供方不推进时间。重连、读取、账户状态、健康探测及 UI 操作不构成活动；真正的子会话和工具事件由所属会话的可信输出链更新同一时钟。模块不自行产生模型请求、停止进程或删除文件，不接受来自模型的增权指令。

`lastModelActivity` 是新增可选原生收据字段；旧 `lastActivity` 只作首次迁移基线，之后不被 UI 或维护操作刷新成新的模型活动。停止写入、备份成功回执、权限与文件归属复核继续由现有原生账号服务承担，关闭回收开关不改变原生会话内容。Python 开发入口只在受信任服务内使用；客户端回收、状态和取消接口由远端维护契约提供，不向模型暴露任意删除入口。测试位置为 `scripts/test-session-idle.py`、`tests/session-idle.test.ts`。

```python
from session_idle import initialize_activity, record_model_activity, idle_status
initialize_activity(receipt, now)
if record_model_activity(receipt, owned_native_message, now, provider):
    persist_receipt()
if idle_status(receipt, now)['eligible']:
    enqueue_verified_retention(receipt['sessionId'])
```

### 有界回收与恢复取消补充契约

NativeSessionStorage.reclaim(host:SshHost, provider:'codex'|'claude', options?:RetentionOptions) → Promise<{reclaimedBytes:number,deferred:boolean,transferredBytes:number}|undefined>。RetentionOptions 为 {signal?:AbortSignal,maxBytes?:number,maxDurationMs?:number,maxCandidates?:number}；默认 16 MiB／30,000 ms／8 个候选，允许范围分别为 256 KiB 至 8 GiB、1 至 300,000 ms、1 至 1,000，均须整数。非法参数抛 SESSION_RETENTION_BUDGET_INVALID，尚不获取锁或访问远端。deferred 表示达到本轮限额并留待下一轮，属于正常分段完成；忙时仍返回 undefined。实际传输字节与延后状态同时可从 remote-storage/status 的 providers 中读取。后台每分钟调度，轮转候选，不添加模型回合或无限继续。

新增 cancel(host,provider):void，只取消本服务实例对应后台回收；关闭 reclaimIdle 的真实控制器路径调用它。restoreFor(adminHost?,session,{signal?}):Promise<void> 新增可选取消参数；NativeCodexRunner 的 beforeConnect(session,host,signal):Promise<void> 将停止准备／退出信号传入恢复，返回后还会复核取消，之后才连接原生运行时。已有两参数调用兼容。恢复同一正在归档的会话会先暂停其后台搬运；关闭回收不禁止显式恢复。请求结束在 finally 释放本机锁；释放远端租约的清理请求上限 2 秒，失联租约由原有 180 秒期限兜底。dispose():void 取消所有所属请求，不删除归档。已完成归档损坏会显式失败，不能以历史 verified 标志代替当前校验；未完成坏分块可安全重新取回。

原生账号服务的内部 storage/reclaimed 沿用已有 provider/accountId/accountGeneration/archiveId/sessions 与 authority 绑定，要求管理员且持有已标记的删除租约，返回既有绑定／receipts／marked 回执。完成后写 storageReclaimed，正常恢复清除；storageRestorePending 标记恢复过程，过期候选以 restorePending 返回；旧已标记但未确认完成的收据以 reconcile 返回，触发本机重新核验后重入。候选最多返回 1,000 条并分页轮转。仅同一清单、同一归档编号的 .awb-<archiveId> 残片可以删除，文件描述符与归属检查不变。新增收据字段可选，不迁移登录／配置，不增授模型或跨设备权限；要求双方部署兼容服务，不自动部署。事件继续使用调用回执和现有状态通道，插件取消与卸载须调用取消／dispose，不能遗留后台传输。

~~~ts
async function archiveNext(storage: NativeSessionStorage, adminHost: SshHost, signal: AbortSignal) {
  return storage.reclaim(adminHost, 'codex', {
    signal, maxBytes: 16 * 1024 * 1024, maxDurationMs: 30_000, maxCandidates: 8,
  });
}
// The registered actions.session-storage service remains replaceable.
// Explicit foreground restore forwards its own cancellation signal.
await storage.restoreFor(adminHost, session, { signal });
~~~

覆盖矩阵增量：有界调度／公平轮转／残片重取 → tests/session-storage-budget.test.ts；真实停止与策略取消 → tests/session-retention-controller.test.ts；断线／坏清单／丢回执 → tests/session-storage-recovery.test.ts；远端部分删除、恢复残片及大队列 → scripts/test-session-retention-faults.py。以上是受信任宿主服务接口，不向模型提供任意远端删除工具。
<!-- session-idle:end -->

<!-- translation-tracking:start -->
## 双语追踪按实际面板布局启停（2026-09-28 JST）

本节修订 U24：只有原文与右侧译文同时显示时，文本块参与悬停、焦点、点击及 Enter/Space 追踪。消息下方、文件/子会话占用右侧、手动隐藏译文及窄窗口单面板模式均停用；恢复左右显示后自动恢复，不保留停用前的命中高亮。

### 功能覆盖矩阵与入口

| 功能 | 入口、类型与返回 | 扩展与验证 |
| --- | --- | --- |
| 显示位置 | translationPlacement(layout:'panel'\|'inline'\|undefined,occupied:boolean,child?:boolean):'panel'\|'inline' | packages/translation/display.ts 现有 selector；tests/translation-tracking.test.ts |
| 追踪开关 | translationTrackingEnabled(placement:'panel'\|'inline',panelVisible:boolean,compact?:boolean):boolean | 同模块新增纯函数，Workspace 的事件及样式使用同一结果；同上测试 |
| 实际界面状态 | [data-testid="bilingual-result"][data-translation-tracking="enabled"\|"disabled"] | 既有 renderer surface/observeSurfaces 可替换会话界面；DOM 属性随显示位置和尺寸更新；scripts/test-translation-tracking-ui.mjs |
| 用户布局配置 | translation/layout({layout:'panel'\|'inline'}) | 沿用已持久化配置、host middleware 与 state/onState；右侧临时占用不改用户偏好 |

生命周期：布局/占用/宽度变化立即移除 is-matched、成对事件和文本块 Tab 停靠，取消尚未执行的跨栏滚动；关闭阅读器或切回右侧布局后重新启用。data-sync-key、data-message-id 及既有定位、复制、选文、正文链接保留。非追踪状态下 tabIndex=-1 仍允许明确的程序化来源定位，不显示追踪焦点框；嵌套链接和按钮保持各自原生交互。

事件与权限：纯 selector 无 I/O、持久化、模型请求、错误或新增权限；compact 缺省 false。布局命令继续由宿主校验，非法 layout 沿用既有错误。配置变更通过既有 state/onState 发布；局部阅读器和 ResizeObserver 的变化只更新当前 Workspace DOM，插件可用 MutationObserver 观察该属性，不伪造宿主状态事件。插件停用后依既有 surface 恢复核心实现，按当前可见布局重新判定；不保存额外追踪开关、不迁移旧存档，apiVersion 不变。

```ts
const placement = translationPlacement(layout, readerOpen, isChild);
const tracking = translationTrackingEnabled(placement, panelVisible, compact);
// Attach paired handlers only when tracking is true; preserve ordinary links.
```

验证覆盖：布局/占用/子会话/可见性/窄窗口组合，浅深主题，停用后的悬停/焦点/Enter/Space/点击无命中或跨栏滚动，文本选择及文件链接，关闭阅读器恢复、手动隐藏及窗口缩放。测试只使用合成内容、隐藏 Electron 和本机临时文件。
<!-- translation-tracking:end -->

<!-- windows-file-links:start -->
## Windows 文件链接盘符前斜杠兼容（2026-09-28 JST）

| 功能 | 开发入口与实际路径 | 验证位置 |
| --- | --- | --- |
| 带盘符文件链接识别 | `api.markdown.link(href:string,label:string):LinkedText\|undefined`；与 `packages/navigation/file-links.ts` 的 `fileReference(value:string):FileReference\|undefined` 共用解析器 | `tests/file-links.test.ts`、`tests/message-markdown.test.ts` |
| 原文、译文与子会话导航 | `MarkdownContent.renderLink` → `MessageText` → `LinkActions.openFile({path,line?})`；右键沿用 files/info、clipboard/write 等原有入口 | `scripts/test-message-file-links-ui.mjs` |

增量兼容原生 Markdown 的 `/<drive>:/...` 目标：仅在单个前导斜杠之后紧接盘符、冒号和路径分隔符时，转换为 `<drive>:/...`。保留文件名、目录空格和行号；`<...>` 包裹、百分号编码及既有 file URI 继续经原有解析路径处理。文件夹目标同样适用。普通 POSIX 路径、相对路径、网页链接不改变，UNC/远端 file authority、脚本协议、控制字符和额外冒号仍拒绝。

返回值仍为 `{text,reference:{path,line?}}`、网页 `{text,url}` 或 `undefined`；无新增错误码或事件。解析是同步纯显示操作，不读取文件、不修改原消息、剪贴板或会话；导航只在用户点击/键盘激活后进入既有宿主路径核验，不新增执行或网络权限。无订阅需清理，插件停用/界面替换沿用现有生命周期。API v1、存档及模型传输无需迁移，旧消息重新渲染即可使用修复后的识别；代码块保持字面内容。

示例：`api.markdown.link('/' + drive + ':/Example Project/source.py:128', 'source.py')`，其中 `drive` 是应用已知的单个盘符。链接使用已有 `.message-link` 高亮、下划线、鼠标、键盘和右键交互；整条消息复制仍返回原始 Markdown。
<!-- windows-file-links:end -->

<!-- generated-images:start -->
## 原生生图自动接收与工作区产物（2026-09-28 JST）

### 功能覆盖矩阵

| 功能 | 开发入口、类型与返回 | 实际路径与测试 |
| --- | --- | --- |
| 原生图片接收 | 宿主服务 `images.generated.receive(input: GeneratedImageInput): Promise<Attachment>`；类型见 `packages/generated-images/types.ts` | `attachNativeObservation` 收到 Codex `item/completed` / `imageGeneration` 自动调用；`tests/generated-images.test.ts`、`scripts/test-native-image-delivery.mjs` |
| 图片状态与本地预览 | `state/get` / `state/onState` 的 `Session.activities[].imageDelivery?: GeneratedImageDelivery`；`attachments/views({ids})`、`attachments/image({id})` 沿用既有返回 | 根会话和原生子会话均显示产物；`scripts/test-generated-images-ui.mjs` |
| 查看、导出和定位 | 既有 `api.media.openImages(ids,initialId?)`、`attachments/save-as({id,png?})`、`attachments/reveal({id})` | 同一个附件存储与图片查看器，不把远端路径交给本机文件浏览器 |
| 接收实现替换 | `api.services.intercept('images.generated','receive',handler)` / `override('images.generated',{receive})` | 原生观察器调用同一个服务对象；专项测试验证替换实际生效、释放恢复 |
| 图片结果界面替换 | renderer 的 `api.observeSurfaces('.generated-image-result','replace',render)` | 根/子会话及动态插入实例；释放/停用恢复，沿用多实例 surface 生命周期 |
| 远端 PNG 清理回执 | 受信任 SSH RPC `workbench/generatedImage/acknowledge(GeneratedImageReceipt): Promise<{removed:boolean}>` | 仅所属连接；不是 renderer IPC 或模型工具；`scripts/test-generated-image-receipts.py`、`tests/generated-images.test.ts` |

`GeneratedImageInput` 包含 `sessionId/threadId/turnId/itemId/projectPath/result`，均为 string；result 是本版本原生完成事件的标准 Base64 PNG。目标固定为当前本机工作区的 `generated_images/image-<identity-hash>.png`，文件身份由上述四个 ID 派生。接口拒绝任意输出路径、URL、数据 URL、非 PNG、非规范 Base64 和超过 20 MiB 的图片。相同身份重放只复用字节一致的已有文件，不覆盖用户修改；创建和回读校验完成后返回附件。工作台托管默认工作区及登记工作树单独核实，不放开配置目录或原生凭据目录。

附件仍为 `storage:'source'`，增量字段 `generatedRoot?:string` 只允许已登记工作区下、与附件身份吻合的固定 PNG 文件名；它不是任意受保护目录的读取豁免。原图直接位于工作区，附件目录仅保存元数据。历史引用参与附件清理保护，清理/聊天删除不删除工作区原图；旧附件无需迁移。

`GeneratedImageDelivery` 的 `status` 为 receiving/saved/failed；成功时提供 attachment。`remoteCopy` 为 pending/removed/retained/not-applicable，分别表示回执待确认、PNG 已清理、清理未确认或非 SSH 路径。error 为固定英文代码：`GENERATED_IMAGE_SIZE_LIMIT`、`GENERATED_IMAGE_ENCODING_INVALID`、`GENERATED_IMAGE_FORMAT_INVALID`、`GENERATED_IMAGE_WORKSPACE_INVALID`、`GENERATED_IMAGE_DIRECTORY_CHANGED`、`GENERATED_IMAGE_FILE_CHANGED`、`GENERATED_IMAGE_SAVE_FAILED`、`GENERATED_IMAGE_DELIVERY_INTERRUPTED` 或 `GENERATED_IMAGE_REMOTE_CLEANUP_UNCONFIRMED`；身份/元数据验证失败使用同前缀的 IDENTITY/THREAD_NOT_OWNED/RECORD 类代码。界面本地化，完整原始 Base64 不进入公共活动文本、持久 UI 状态或翻译。

### 回执、权限和兼容边界

接收由可信原生事件驱动，不添加用户提示、不请求模型上传、不启动额外模型回合、不更换账号或生图后端。根线程与原生子线程保留身份关联；本地文件和活动状态保存成功后，才发送 `{threadId,turnId,itemId,sha256,size}` 回执。远端在现有账号授权和线程归属之内匹配本连接观察到的完成事件，只处理该账号原生 `generated_images` 下的确切文件。客户端不能提交远端路径；本连接最多保留 256 份小型回执记录，不保存图片字节。清理逐层使用不跟随链接的目录描述符，检查普通文件、所有者、单硬链接、大小和 SHA256。重复确认不删除后来同名的新文件；其他账号、线程、哈希、路径、链接和内容变化均拒绝。服务错误为 `IMAGE_RECEIPT_INVALID`、`IMAGE_RECEIPT_NOT_OWNED`、`IMAGE_CLEANUP_UNCONFIRMED`。

断线、关闭、磁盘错误、状态保存失败和旧远端不支持回执时不删除原图，也不重新生成。已收到的本地保存队列先收尾；重启只保留元数据并标记中断，不自动启动模型任务或重发清理。未确认回执可能留下远端 PNG，界面明确显示。原生到桌面的帧限额增为 48 MiB，以容纳本版本原生上限及错误呈现；请求入站原限额不变，单张本地接收仍为 20 MiB。超过接收限额不发送清理回执。

**当前桥接的原生 Codex 0.155.1 会先保存 PNG 再发送完成事件。因此实现是“本地确认后清理远端 PNG”，不是从未落盘；原生会话历史仍可包含图片数据。** 工作台不编辑原生聊天数据库或 rollout、不承诺 VPS 图片总占用为零。原生返回给模型的原始路径提示保持原样；清理后不能继续依赖该远端路径，后续图片编辑可使用原生会话图片历史或本地工作区产物。模型是否选择生图工具仍由实际账号能力、运行时和任务决定，接收机制只对已经完成的原生生成保证自动处理。

API v1 保持兼容，新字段可选；不具备回执方法的旧服务仍可展示并保存结果，但不得标记远端已清理。部署远端源码需要独立授权，现有 H 原生桥准入不被本功能绕过。原生二进制、登录与记忆策略不变。接口可被已批准的完整工作台插件扩展/替换，不能据此取得另一账号或设备的删除权限。

~~~js
// Approved host plugin: intercept the real artifact sink; release on disable.
const release = api.services.intercept('images.generated', 'receive', async (next, input) => {
  const attachment = await next(input);
  return attachment;
});
// Renderer plugin, from a user action on an existing generated activity:
const state = await api.call('state/get');
const delivery = state.sessions.find(s => s.id === selectedSessionId)
  ?.activities.find(a => a.id === selectedActivityId)?.imageDelivery;
if (delivery?.attachment) await api.media.openImages([delivery.attachment.id]);
~~~
<!-- generated-images:end -->


## U114 无推理档位识别接口修订（2026-09-28 JST）

本节及本日更新的下方契约取代旧版自动探测行为。普通编辑不启动作业，model-api/discover、refresh 与默认 save 只读取 GET 模型目录；读取可能有网络延迟，但不发生成 POST。无目录声明时保留未知和手动选择，不根据模型名或 API 地址推断档位。用户明确的 manualEfforts/defaultEffort 优先于自动结果，已声明档位无需实测即可通过 session/model 保存。

SSH 原生来源不进入本节推理验证。使用 runtime/models 的 NativeModelOption.efforts/defaultEffort/serviceTiers/defaultServiceTier，按当前原生目录本地校验选择，再在明确任务中原样提交；字段缺失保持未知。Codex 路径读取原生 model/list 与 config/read，不把它扩称为所有远端运行时都已提供全部字段。

| 功能 | 入口及返回 | 扩展与验证 |
| --- | --- | --- |
| 无推理档位读取/保存 | model-api/discover({id?,revision?,connection,key?}) → ApiModel[]；refresh({id,revision})、save({id?,revision?,connection,key?}) → ModelConnection | model.connections.call，可经 services.intercept/override 替换；tests/reasoning-passive.test.ts |
| 档位到实际发送 | model-targets/list → ModelTarget[]；session/model({sessionId,selection:{model,effort?}}) 保存选择；availableReasoningEfforts/defaultVerifiedEffort 是共用领域解析器 | 同一服务替换入口及 renderer 界面替换；tests/reasoning-passive.test.ts、scripts/test-reasoning-ui.mjs |
| 明确推理验证与停止 | reasoning/start 与 save 的 verifyReasoning/backgroundReasoning 另需 allowInference:true；status/cancel 不需推理授权 | model.connections.call、现有 middleware；tests/reasoning-probe.test.ts、tests/reasoning-background.test.ts |

未增加原生登录或设备权限；服务仍遵守批准包、所有者、凭据归属、忙碌和 CAS 边界。save/refresh 使用既有 state 事件更新 UI；纯目录返回不伪造请求接受证据。插件可更换目录实现提供自己的模型声明，停用恢复核心服务和选择器，已保存用户配置保留。本次没有新装示例或第三方运行时依赖。

迁移：默认 save 调用保持只读目录及保存语义。曾自动传 verifyReasoning/backgroundReasoning 或调用 start 的插件必须移除自动调用；只有用户单独授权推理测试后才传 allowInference:true。缺失标记返回 REASONING_INFERENCE_REQUIRES_EXPLICIT_CONSENT，发生在发送和持久化前。apiVersion 不变，不表示旧自动测试调用仍被允许。旧证据保留且可选择；新验证指纹版本为 3，不复用旧负对照判定。取消接管中的作业也会停止后续请求；已经完成的结果无法用 cancel 撤销。

无推理示例：const rows=await api.call('model-api/discover',{connection:draft}); const saved=await api.call('model-api/save',{connection:{...draft,models:rows.map(m=>({...m,enabled:true}))}})。它只读取目录并保存，不自动验证，不启动会话。用户显式选定模型/档位后通过已有 session/model 或创建工具参数提交，不能静默回落到来源默认值。

## 消息原文与译文分别复制（2026-09-28 JST）

### 功能覆盖矩阵

| 功能 | 开发入口、类型与返回 | 扩展、事件与测试 |
| --- | --- | --- |
| 用户消息正文与本地原稿 | state/get → AppState 的 Message；skillBody(text:string,skills?:readonly SkillInvocation[]) → string；clipboard/write({text:string}) → Promise<null> | conversation surface、.user-message-actions、宿主 useHost / registerMethod；scripts/test-composer-controls-ui.mjs |
| 模型原文与译文 | Message.original 经 visibleReply；Message.translation；clipboard/write({text:string}) → Promise<null> | .message-actions 或 [data-message-copy-region] 多实例替换；同上测试覆盖流式更新及重译 |
| 子会话任务、消息及译文 | NativeChildSnapshot.task/taskTranslation、NativeChildMessage.text/translation；clipboard/write({text:string}) → Promise<null> | .child-message-actions 或 [data-message-copy-region]；同上测试覆盖两家运行时阅读组件 |

本节为同日用户消息复制的补充修订：上下显示两块正文时，各自末尾有一个复制图标，只复制对应区域。上方位于分隔线前，下方与编辑重发、重新翻译、分支和时间同排。用户消息复制与编辑重发按钮间距为 4 px，上下复制图标中心位于同一列；随按钮增减或窗口变化按实际操作行宽度对齐。只有一种语言或没有译文正文时保留原文复制；等待或失败提示不作为译文复制。重译等待／失败但保留旧译文时，下方仍复制实际显示的旧版；新译文到达后取当前版本。右侧译文面板模式不额外创建上下复制按钮。

用户源区域取 skillBody(message.submitted ?? message.original,message.skills)，没有 submitted 时回退原文；普通用户消息下方“复制原稿”取 message.original，子任务下方“复制译文”取 message.translation。模型源区域继续取 visibleReply(message.original)，保持既有隐藏记忆标记和尾部空白处理，译文取 message.translation。子会话任务分别取 task 和 taskTranslation.translation，消息分别取 text 和 translation。保留各来源的 Markdown；用户正文、原稿及译文的换行和空白不额外裁剪。附件标签、技能标签、消息标题、翻译状态及未发送草稿不进入结果。skillBody 公开于 packages/composer-core/index.ts，visibleReply 公开于 packages/session-core/memory-citations.ts；SkillInvocation 和 MessageTranslation 类型分别位于 packages/native-skills/invocation.ts、packages/translation/display.ts。

clipboard/write 沿用既有入口，text 最大 1000000 个 JavaScript 字符，允许空字符串；非字符串、超限或含 NUL 拒绝并返回“复制内容格式不正确。”。成功返回 null，界面提示“已复制”；底层异常通过既有错误通道报告，不显示成功、不自动重试。复制不修改会话、草稿、预览或翻译状态，不发布新的 state 事件，不启动或停止模型；运行期间仍可用。仅写本机剪贴板，不读取其他应用剪贴板，不增加远端、设备或管理员权限。

受完整包批准的插件可经 api.call 调用相同入口；宿主 useHost 或同名 registerMethod 可替换实际请求。renderer 的 api.observeSurfaces('[data-message-copy-region]','replace',render) 支持全部动态实例，属性值为 source 或 translation。内容新增、移除、完成或重译时按实际区域挂载。既有 .user-message-actions、.message-actions、.child-message-actions 继续可用，但可能匹配同条消息的两行，插件须使用多实例接口。停用时沿既有清理函数恢复核心按钮；已复制到系统的文本不因停用撤回。API v1、原消息格式及编辑重发契约不变，无存储迁移。示例仅供插件开发，不预装到用户环境：

~~~ts
// Select the exact source, local draft, or translation described above.
// Run only for the region selected by the user's copy action.
if (displayedRegionText !== undefined) {
  await api.call('clipboard/write', { text: displayedRegionText });
}
~~~

渲染组合组件 BilingualMessageActions 位于 apps/desktop/renderer/TranslationDisplay.tsx，参数包含 sourceCopy:ReactNode、value?:MessageTranslation、actions:LinkActions、className:string、onCopy:(text:string)=>void，以及可选 label/copyLabel/copyTestId:string、iconSize:number、alignCopy:boolean、children/afterTranslation:ReactNode，返回 React 元素。value 缺省时仅呈现原文操作行；alignCopy 用于靠右操作行，测量末尾复制按钮并在尺寸变化时对齐上方按钮，卸载时释放 ResizeObserver。调用者负责选择原文、提供复制回调并处理 Promise 错误；组件本身不访问剪贴板或触发翻译，插件实际执行继续使用 clipboard/write。

验证使用真实 Workspace、NativeChildConversation 和隐藏 Electron、合成消息与剪贴板宿主桩：检查两区域位置、同列对齐与紧凑间距、独立载荷、用户原稿、模型译文、两家子会话、键盘操作、单语回退、Markdown/空白、技能前缀、运行中更新、译文缺失／等待／失败／重译、面板切换、草稿和历史不变及错误后显式重试。不写真实系统剪贴板；通用插件替换与停用恢复沿用既有 surface 契约。

## 会话操作图标、翻译联动与未知结果删除（2026-09-28 JST）

### 功能覆盖矩阵

| 功能 | 开发入口、类型与返回 | 扩展、事件与测试 |
| --- | --- | --- |
| 已发送消息编辑重发 | state/get → AppState 读取 message.original、attachments、skills；draft/prepare({sessionId,text,attachmentIds?,skills?,requestId?,bypass?}) → DraftPreview；draft/submit({sessionId,id,sourceHash,automatic?}) → 既有运行时提交结果 | conversation / composer surface 及 submission.gate、请求中间件；scripts/test-composer-controls-ui.mjs、tests/controller.test.ts |
| 模型 · 思考档位 | runtime/models → NativeModelOption[]；session/model({sessionId,selection:NativeModelSelection}) → AppState；模型来源仍用 model-targets/list、session/model-target | .model-controls surface；state/onState 通知；scripts/test-composer-controls-ui.mjs、tests/model-api.test.ts |
| 单一发送／停止图标 | draft/prepare、draft/submit；draft/cancel({id}或{requestId}) → null；session/stop({sessionId}) → {stopped:boolean,reason?:string,scope?:string} | composer surface、runtime 和 submission 服务保留替换入口；scripts/test-composer-controls-ui.mjs、tests/controller.test.ts、tests/runtime-extensions.test.ts |
| 翻译模块、临时开关与直接发送 | plugins/set-enabled({id:'translation',enabled:boolean})、translation/quick-toggle({show?:boolean,paused?:boolean})、translation/auto-submit({enabled:boolean}) → AppState | 总开关与临时状态独立持久化；沿用 state/onState、请求中间件及 translation 服务；tests/translation-quick-toggle.test.ts、scripts/test-translation-module-ui.mjs |
| 结果未知的本地删除 | session/delete({id:string,confirm:true,discardUncertain?:boolean}) → AppState | 既有 session/delete 注册／请求中间件；state/onState；tests/sidebar-actions.test.ts、scripts/test-session-delete-ui.mjs |

### 呈现与生命周期

编辑重发使用铅笔图标，保留“编辑并重发”的 aria-label 和提示；只恢复原稿、附件和技能，取消编辑恢复之前未发送的草稿。旧消息不覆盖，仍经既有预览和提交门禁。模型名称与有效思考档位用“ · ”连接，未知档位不猜测、不保留多余分隔符；输入框上的模型触发器不再显示下拉箭头，点击和键盘打开设置的行为保留，Fast 仍单独显示。

停止按钮使用 14 × 14 px 的实心方块，清除按钮默认内边距并校验水平／垂直居中。右下角只显示一个操作图标：运行中且没有非空正文、附件或技能时为停止；有新内容时为发送。正在准备翻译、提交或等待停止回执时显示停止／取消图标，防止重复提交。空白字符不构成新内容；不支持 steer 的运行时或没有 nativeTurnId 时，发送图标保留但禁用，不把 UI 变化解释为新增运行时能力。旧提交回执仍走各自确认生命周期；停止不承诺撤销已执行操作。

2026-09-29 UTC 修订：插件总开关与会话框临时翻译开关已解耦，契约见下文“翻译模块与全局临时开关”。插件设置继续调用 plugins/set-enabled；会话框改用 translation/quick-toggle，仅修改全局临时暂停状态。插件关闭时会话框下方不显示翻译控件；启用插件且详情中的显示选项开启，才显示临时开关。“翻译后直接发送”仍只影响预览，保留既有偏好。状态变化继续取消准备中的翻译、失效旧预览并保留原稿与历史译文。

结果未知的会话必须同时提供 confirm:true 与 discardUncertain:true 才能删除本地记录；UI 在原删除确认框说明未知结果、不可撤销及本地范围。旧客户端省略新字段仍保持拒绝未知结果的行为；非法非布尔字段拒绝。该字段不是强制中断开关：运行状态、各运行时 busy、分支／权限／模型切换、待提交预览、活跃翻译均继续阻止删除，异步关闭原生连接后再次检查。操作只删除工作台本地会话记录，不发送新任务、不声称原请求失败或撤销、不删除项目文件或原生历史。普通 idle / blocked 删除保持兼容。

### 权限、错误与调用示例

以上操作沿用当前 owner、工作空间、原生身份和动作审批，不新增 SSH、管理员或其他设备权限。模型／档位不匹配、运行时不可用、失效预览、翻译关闭时设置直接发送、缺少删除确认、未确认的未知结果或仍有活动操作均返回原有宿主错误；界面显示错误并保留原稿／记录，不自动重试或改用其他运行时。API v1 不变，新删除字段可选。

受批准的 renderer 插件使用 api.call / api.onState；宿主插件可通过同名 registerMethod / useHost 或既有 services.intercept / override 接入实际路径。局部替换使用 api.observeSurfaces('composer','replace',render) 或 conversation / .model-controls 选择器，支持全部实例、动态挂载与卸载；释放返回的清理函数或停用插件恢复核心控件，持久翻译偏好不回滚。通用替换／恢复验收沿用现有插件 surface 测试，本轮不以私有 React 处理器作为插件接口。

~~~js
// Run these from explicit user actions, not from activation or a model message.
await api.call('plugins/set-enabled', { id: 'translation', enabled: false });
const state = await api.call('state/get');
const session = state.sessions.find(item => item.id === selectedSessionId);
// The confirmation UI must explain the unknown result and local-only deletion.
if (userConfirmedDeletion) {
  await api.call('session/delete', {
    id: session.id, confirm: true,
    ...(session.status === 'uncertain' ? { discardUncertain: true } : {})
  });
}
~~~


## 回复分支、上下文回执与问答键盘（2026-09-28 JST）

本节修订 U95、U107：消息侧的分支入口仅挂在助手回复，用户消息保留编辑重发。侧栏完整聊天分支及既有显式 API 保持兼容；Claude 本机模型 API 连接在完成原生边界核验后开放，SSH Claude 仍受原准入限制。

### 功能覆盖矩阵

| 功能 | 开发入口与返回 | 扩展、事件与验证 |
| --- | --- | --- |
| 助手回复分支与可用性 | session/fork-options({sessionId,messageId?}) 返回既有 workspace/worktree 可用性；session/fork({sessionId,messageId?,location?}) 返回 Promise<Session> | 既有 registerMethod/useHost、sessions 服务及 conversation surface；tests/claude-fork-usage.test.ts、scripts/test-claude-fork.mjs、scripts/test-session-fork-ui.mjs |
| 原生线程与精确边界 | NativeForkSource、recordedNativeFork(session,messageId?)；nativeProviderLaunch 的可选 fork/forkId | 保留 runtime 服务替换与自定义 RuntimeAdapter.fork；同上测试覆盖本机 Claude 原生边界、重启、换目录、源记录不变及错误 |
| 当前上下文与切换恢复 | ModelLane.nativeContextUsage?:NativeContextUsage；currentProviderContext(session,model) 返回 NativeContextUsage 或 undefined | 既有 state/get、session/model-target 和 state/onState；上下文 surface 可替换；tests/claude-fork-usage.test.ts、scripts/test-session-metrics-ui.mjs |
| 缓存读写口径 | parseTokenCounts(value,protocol):TokenCounts、session/metrics({sessionId}):Promise<MetricsSnapshot>；nativeWireEvents 的可选 counts 参数 | 既有运行时 usage 事件、session-metrics surface 及宿主中间件；同上测试覆盖转换、未知和真实零值 |
| 问答 Enter 与分页 | interaction/prepare、interaction/submit；QuestionPager 的受控 page/onPage；AsyncQuestions 的 onDraft | 既有 interactions 服务和 conversation surface；scripts/test-question-keyboard-ui.mjs、scripts/test-native-interactions-ui.mjs |

### 原生分支契约与兼容

NativeForkSource 保留 sourceSessionId:string、threadId:string、lastTurnId?:string、beforeTurnId?:string，增量增加 runtime?:'codex'|'claude'、lastMessageId?:string。旧 Codex 存档可以不含 runtime。Claude 来源必须是本机 direct-api 连接、完整助手回复，lastMessageId 为宿主记录的原生消息 UUID；来源运行时及模型目标须与当前绑定吻合，不能按公开文本伪造检查点。跨模型目标时先显式切回相应绑定。没有原生回执的旧消息不补猜 UUID。

session/fork-options 是只读检查；session/fork 保存新 Session 和来源，不发模型请求。在用户后续明确发送时，nativeProviderLaunch 的 fork?:NativeForkSource、forkId?:string 仅为尚未拥有原生线程的 Claude 分支设置 --resume SOURCE --fork-session --resume-session-at MESSAGE --session-id CHILD；原有 resume 优先。CHILD 是新会话 UUID，回执须匹配，之后按新线程续聊。Codex 继续使用其原生回合边界。内部启动参数不是允许插件自行扩大宿主权限的入口；外部调用仍通过受管会话命令。

错误沿用 NATIVE_FORK_UNSUPPORTED、NATIVE_FORK_BOUNDARY_UNVERIFIED、NATIVE_THREAD_MISMATCH 与既有 busy、无效会话及位置校验。失败不静默回退到复制消息、不自动续投；未知结果保留原状态等待明确处置。创建成功和原生回执触发既有 state 事件。工作树文件权限、来源保护、停用恢复与会话生命周期沿用原契约，不增加远端或其他租户权限。UI 移除用户消息入口不删除旧版显式 before-turn API 或已保存分支草稿。

### 用量和键盘契约

currentProviderContext 是无副作用 selector：优先采用 Session.nativeContextUsage（包括压缩回执）；缺失时仅从当前运行时、模型目标、原生线程及模型名一致的最近请求恢复 inputTokens+outputTokens。不能用会话累计量、另一线程或另一模型代替。无完整输入/输出回执返回 undefined。切换通过 ModelLane 保存/恢复各自 NativeContextUsage；字段为可选增量，旧存档不迁移，读取不会发请求或读原生聊天库。

DeepSeek prompt_cache_hit_tokens 对应缓存读取；prompt_cache_miss_tokens 不等于缓存写入。cache_creation_input_tokens 仅在上游实报时作为写入。TokenCounts 的 inputTokens 包含缓存读写，协议转换到 Anthropic 时相应扣除未缓存 input_tokens 的重复部分，总量只计一次；没有计数保持 null，真实零值保留。UI 隐藏完全未报告的缓存项，部分已知仍按既有 incomplete 规则标注；插件仍可从 session/metrics 读取完整 null 字段，类型和 apiVersion 不变。非法用量沿用 SESSION_USAGE_INVALID，读取、停用或重启不会额外启动模型。

问答输入及选项焦点下，普通 Enter 到下一题，最后一题在全部答案有效时走现有发送流程；Shift+Enter 在多行框换行。组合输入、keyCode 229、长按重复及 Ctrl/Alt/Meta 组合不触发推进或发送。翻页移动焦点到可见题目；必填校验、busy、receipt 过期及重复发送锁不变。翻译预览开启时首次 Enter 仅生成预览，确认仍走原流程；取消、修改及停用模块使旧预览失效。异步问题最后一题调用 onDraft(text) 填入回复，保留其需要用户发送的语义。

interaction/prepare({sessionId,requestId,receipt,answers,clientRequest}) 返回 Promise<AnswerPreview>；answers 为 Record<string,string[]>。interaction/submit({sessionId,id,sourceHash,automatic}) 回传现有原生请求，返回其发送结果，成功经 state/onState 回读。预览过期、问题失效或答案不合法会拒绝，输入法确认不调用这两个入口。插件可通过既有 interactions 服务和受控 QuestionPager 替换行为；停用 surface 恢复核心键盘处理，不能绕过宿主校验或隐私回答规则。

~~~js
const options = await api.call('session/fork-options', { sessionId, messageId: assistantMessageId });
if (options.workspace.available) {
  const branch = await api.call('session/fork', { sessionId, messageId: assistantMessageId });
  // Creating the branch does not send a model request.
  console.log(branch.id, branch.branch.native?.runtime);
}
const usage = await api.call('session/metrics', { sessionId });
if (usage.cacheWriteTokens !== null) renderCacheWrites(usage.cacheWriteTokens);
~~~

## 记忆模块独立后台任务（2026-09-28 JST）

本节取代 U96 旧的前台交接注入约定。用户明确发送任务被接受后，记忆模块保存本次运行时、模型、思考档位、项目目录及权限的绑定快照，独立处理当前档案；不复制前台消息、附件、分支历史或会话协作目录。原生 CLI 自行提供的模型环境、工具及系统提示保持原样；工作台翻译模块只调用独立翻译接口。

### 功能覆盖与开发入口

| 功能 | 稳定入口 / 参数 / 返回 | 扩展方式与测试 |
| --- | --- | --- |
| 自动任务准入 | `MemoryBackgroundTasks.start(target:MemoryTaskBinding, submissionId:string):Promise<{started:boolean;taskId?:string;reason?:string}>`；`target` 包含 `binding:SessionBinding`、`modelSelection?:NativeModelSelection`、`permissionMode?:PermissionMode`、`projectPath?:string` | `native.memory-background` 服务真实承接 `draft/submit`；完整批准的宿主插件可 intercept/override，不能从模型输出或收到 peer 消息自行触发。`tests/memory-background.test.ts`、`scripts/test-composer-memory-ui.mjs` |
| 任务查看 | `api.call('native-memory/tasks/list',{}):MemoryBackgroundTask[]`；`native-memory/get` 新增 `backgroundTasks`，原有字段保留 | 同名 `registerMethod/useHost`；元数据包含 id、runtime、model、effort、permissionMode、state、processed/total、时间、reason 及可选 receiptIssues:MemoryReceiptCode[]，不包含聊天、认证或任务提示。记忆页只显示最近六条 |
| 取消 | `api.call('native-memory/tasks/cancel',{id:string}):Promise<{cancelled:boolean}>` | 核心取消对应任务的自有进程；已终止任务返回 false，不重试；未知 ID 抛 `MEMORY_BACKGROUND_TASK_NOT_FOUND` |
| 注册/替换执行器 | `services.get('native.memory-background').registerExecutor(executor:MemoryTaskExecutor):()=>void` | 后注册且 `supports(target):boolean` 匹配的执行器优先。`run({sessionId,target,prompt,signal,read,verify}):Promise<{state:'completed'|'blocked'|'failed'|'uncertain';reason?:string}>`；`read(query)` 限定本运行时、会话和已发放批次。撤销注册取消由该执行器承接的活动任务，后续恢复核心实现；单元测试验证真实注册路径和恢复 |
| 活动状态与生命周期 | `busy(connectionId?:string):boolean`、`list():MemoryBackgroundTask[]`、`cancel(id)`、`cancelAll(reason?)`、`dispose()`；`on('changed', listener)` 发送任务元数据快照 | 模型来源修改、CLI 维护和工作区维护复用 busy 门禁；插件用 `api.onDispose` 移除监听并撤销注册，关停等待所属进程退出 |
| 独立原生执行 | `NativeMemoryTaskExecutor` 使用现有 `NativeProviderRunner`，仅暴露本批次 `workbench_read_memory_handoff` 与 `workbench_verify_memory_handoff` 工作台工具 | 独立临时状态、原生线程、空白上下文；不写入 `AppState.sessions`、侧栏、前台 peer 目录或翻译队列。`scripts/test-memory-background.mjs` 验证两家实际 CLI 的读取、交互停止和前台隔离 |

类型定义位于 `packages/native-memory/background.ts`。此处的 `completed` 执行器结果仅表示原生回合结束；只有已有档案账本核验文件、原生索引、runtime/revision/scope/hash/provenance 后，任务才记作完成。未核验标为 `blocked / MEMORY_BACKGROUND_RECEIPT_UNVERIFIED`。进程结果未知为 `uncertain`，不得视作安全重投依据。

准入须同时满足：启用本机交接、两家 CLI 可用、目标原生记忆状态确认开启、精确模型绑定仍有效。核心目前接入本机 `direct-api` 的 Codex / Claude Code；只读权限标为 `MEMORY_BACKGROUND_READ_ONLY`，其他执行位置标为 `MEMORY_BACKGROUND_BINDING_UNSUPPORTED`，不回退到本机或改变账号。此开发接口不赋予远端权限，不自动授予审批。

每个接收运行时最多一个活动任务；相同 submissionId 去重。一次冻结最多 120 份档案，每批最多 12 份，只有完整核验当前批次后才处理下一批，不因扫描、打开页面、选择模型或重启自动启动。新增档案和失败档案留待后续明确任务。十分钟超时、取消、关闭交接、设置无法确认、执行器停用和退出均终止所属任务；重启后的运行中记录标记 `uncertain / MEMORY_BACKGROUND_INTERRUPTED`，不恢复模型任务。提问、审批或不支持的交互标记 `MEMORY_BACKGROUND_INTERACTION_REQUIRED` 并停止，不隐藏自动代答。每两秒重新检查接收条件；设置关闭不保证撤销此前已写入的原生文件。

任务元数据使用独立版本 1 日志，保留最近 100 条；旧交接档案及回执账本保持原格式和原核验规则。`session/memory-handoff/read` 对前台返回 `MEMORY_HANDOFF_BACKGROUND_ONLY`，前台不再注册记忆交接工具；旧 `native.resources.handoff`、控制器的 `nativeMemoryHandoff` 和原生提供方 `handoff` hook 撤销。底层 `NativeMemoryService.session` 保留给受信任的交接协议适配及历史测试，不再由前台生产路径调用。既有聊天中已经发送的上下文不会被改写或删除。

<!-- memory-receipt-feedback:start -->
### 回执反馈与 Windows 进程收尾（2026-09-29 UTC）

| 功能覆盖 | 入口、参数与返回 | 验证位置 |
| --- | --- | --- |
| 同任务回执核验 | 后台原生工具 `workbench_verify_memory_handoff({})`；受信任执行器 `task.verify():Promise<MemoryReceiptVerification>` | `tests/memory-receipts.test.ts`、`scripts/test-memory-background.mjs` |
| 宿主核验接口 | `services.get('native.memory').verifyHandoff(runtime:'codex'或'claude',sessionId:string,projectPath?:string):Promise<MemoryReceiptVerification>` | 活动运行时/会话绑定、关闭和结束拒绝测试 |
| 独立条目与历史诊断 | `MemoryExchange.receiptIssues(deliveryId:string):MemoryReceiptCode[]`；`native-memory/tasks/list`、`native-memory/get` 的任务新增可选 `receiptIssues` | 部分进度、重启、旧日志兼容与隐藏 UI 测试 |
| 所属进程清理 | `ProcessSupervisor.stop(reason?:string):Promise<ProcessExit>`，返回 `{code:number或null,signal:NodeJS.Signals或null,reason:string}` | `tests/memory-process-cleanup.test.ts`、`tests/native-runtime.test.ts`、两家原生 CLI 合成接收测试 |

`MemoryReceiptVerification` 位于 packages/native-memory/receipts.ts，形状为 `{deliveryId,complete,verified,total,entries}`；每项 `{archiveId,state:'verified'或'pending'或'superseded',code?:MemoryReceiptCode,message?:string}`。message 是固定英文诊断，不含原生正文、凭据或任意文件路径。后台任务只持久化去重后的错误代码；记忆页本地化显示具体原因，兼容旧任务无 receiptIssues 的情况。既有 `changed` 事件在核验反馈时同步发布已通过计数；收尾以本批累计通过数更新，不重复累加。

核验工具不能接受调用方提供的运行时、会话、回执路径或 token，只使用宿主绑定的当前批次；额外字段抛 `MEMORY_HANDOFF_ARGUMENT_INVALID`。关闭交接、接收状态未确认、会话或运行时不符、结束批次均拒绝为 `MEMORY_HANDOFF_INACTIVE`；取消后不再发起核验。每批最多两次工具核验，第二次只供本任务内修正文件/索引证据；超过限制为 `MEMORY_HANDOFF_VERIFY_LIMIT`。没有新增模型回合、后台自动重试、审批代答或远端权限。工具只保存工作台核验元数据，原生记忆仍由绑定运行时的已有授权文件工具写入。

先验证回执整体身份、条目归属与重复 ID，整体不合法时不接收任何条目。整体合法后逐项验证版本、范围、文件/索引摘要、可达性与来源标记；有效项独立盖章，错误或缺失项继续待接收。扫描先捕获来源新版本，再核验旧批次，避免旧回执错误确认新内容。已经盖章的历史不因后续原生修改撤销。共享索引全部修改完成后再计算最终摘要；只有整批核验通过，调度器才继续冻结队列的下一批。

主要代码：`MEMORY_RECEIPT_MISSING/INVALID/ENTRY_MISSING/ENTRY_INVALID/STORAGE_INVALID/FILE_INVALID/HASH_MISMATCH/ALREADY_PRESENT_MISMATCH/CONTENT_PROVENANCE/INDEX_INVALID/INDEX_UNREACHABLE/INDEX_PROVENANCE/NATIVE_CHANGED/SOURCE_CHANGED/VERIFICATION_FAILED`。`INDEX_PROVENANCE` 要求索引引用与正文都保留准确来源标记；`ALREADY_PRESENT_MISMATCH` 不能靠放宽文本比较解决，整理或译写后须使用 stored 并保存有来源标记的原生引用。重新发放同一档案时，manifest 条目的可选 `previousReceiptError` 提供前次批次错误；不把历史失败当作成功或自动续投依据。

执行器示例：`const result = await task.verify(); if (!result.complete) report(result.entries.filter(row => row.state === 'pending'));`。核验服务可沿用已批准插件的服务拦截/覆盖路径；撤销执行器仍取消所属任务并恢复核心实现。自定义 MemoryBackgroundPort 可选实现 verify 与 issues；旧 port 不实现 verify 时，显式核验抛 `MEMORY_HANDOFF_VERIFY_UNSUPPORTED`，既有 finish 数字返回值不变。apiVersion 和版本 1 任务日志不变，新增字段均兼容旧日志；不为旧任务伪造核验结果。

Windows 停止先对已持有的所属 PID 执行进程树终止，再关闭 stdin，防止 CLI 因 stdin 关闭提前退出而把工具子进程留在管道上。其他平台沿用进程组清理。该顺序不改变子 Agent 数量、模型、权限或正常运行行为，不按进程名清理其他客户端。测试用临时本机进程、独立原生 Home、合成 loopback 推理与隐藏 Electron；不代表真实模型整理质量或活动客户端已部署。
<!-- memory-receipt-feedback:end -->

其他主要结果/错误：`MEMORY_BACKGROUND_DUPLICATE/BUSY/EMPTY/DISABLED/MODEL_REQUIRED/UNAVAILABLE` 是未启动原因；`MEMORY_BACKGROUND_NATIVE_FAILED/NATIVE_UNCERTAIN/SOURCE_CHANGED/TIMEOUT/EXECUTOR_REMOVED` 为任务状态原因；日志损坏抛 `MEMORY_BACKGROUND_JOURNAL_INVALID`。宿主内部异常不把路径、原始模型错误或凭据写到任务 UI。

插件示例（完整包批准、同 owner 权限内；不会自动安装示例）：

```ts
const tasks = api.services.get('native.memory-background');
const unregister = tasks.registerExecutor({
  supports: target => myAdapter.supports(target),
  run: task => myAdapter.run(task), // obey task.signal and preserve target identity
});
api.onDispose(unregister);
const rows = await api.call('native-memory/tasks/list', {});
await api.call('native-memory/tasks/cancel', { id: rows[0].id });
```

事件、执行器结果均不是落盘证明。测试覆盖分批去重、冻结绑定、取消/关闭、只读/不支持边界、重启不重放、替换恢复和回执闸门；合成模型测试不能代替真实模型记忆质量验收，也不构成远端部署或真实账号验收。

## 翻译正文保护与原生提问发现核验（2026-09-28 JST）

| 功能 | 开发入口 / 参数与返回 | 扩展与验证 |
| --- | --- | --- |
| 完整正文翻译 | 服务 `translation.translate(text, direction, operationId, priority, signal?)` → `Promise<TranslationDelivery<TranslationResult>>`；direction 为 input/output，priority 为 input/progress/final | 既有 `services.intercept/override('translation', …)`；`tests/translation-prose.test.ts`、`tests/translation-module.test.ts` |
| 分段问题与回答翻译 | `translation.segments(values:Record<string,string>, direction, operationId, signal?)` → `{value:Record<string,string>, policy}` | 同一翻译服务；`tests/translation-prose.test.ts`、`tests/interaction-flow.test.ts` |
| 原生工具发现与回传 | `nativeWireRequest(body, from, to, model, effort?)` 和 `nativeWireEvents(turn, protocol, request)`；运行入口仍为 `runtime.native-provider` | 六条协议组合核对原生名称、说明、schema；`tests/native-provider.test.ts`、`scripts/test-native-interactions.mjs` |

翻译保护版本更新为 `protectionVersion:2`，结果类型兼容历史值 1。普通引文、英文缩写和所有格进入翻译模型，不再因引号变成不可翻译占位符；明确引用的路径、代码、命令、URL、JSON、diff 和标识符仍按已有字面量边界保护。包含空格的路径应使用引号或代码格式。已有消息不自动重译，`message/retranslate({sessionId,messageId})` 仍仅处理指定消息，不重启原生任务。修复不引入新事件；原生原文保持，完成/失败沿既有 state 通知发布。

权限、生命周期和错误沿用原接口：需要模块开启、独立翻译凭据和正文外发同意；配置代际、AbortSignal 与 operationId 去重继续有效。空结果、截断、缺失/重复/未知保护标记或错位字段仍拒绝，失败不自动重投、不切换提供方、不提交 Agent。停用与服务覆盖释放后恢复核心路径；仅更新翻译提示词，不修改原生 Agent 提示词或原生工具描述。

已批准宿主插件调用示例（不读取或传递密钥）：

```js
const translation = api.services.get('translation');
const delivery = await translation.translate(
  'The note says "Review first". Use `git status`.',
  'output', 'personal-review-once', 'final'
);
translation.assertCurrent(delivery.policy);
return delivery.value.text;
```

原生提问核验记录工具名称、说明和 schema 确实到达合成上游，并通过真实 CLI 回传答案；不会注入宿主问答提示。此证据不能证明真实第三方模型主动选择工具，也不能代替失败会话当次的请求证据。

## 记忆交接回执的目录迁移兼容（2026-09-28 JST）

| 功能 | 开发入口 | 扩展与验证 |
| --- | --- | --- |
| 已有交接回执随应用目录迁移 | `MemoryExchange.initialize():Promise<void>`，由 `NativeMemoryService.initialize()` 调用；`native.memory` 开发服务 | `tests/memory-migration.test.ts`、`tests/memory-handoff.test.ts`、`scripts/test-memory-migration-startup.mjs` |
| 迁移后状态与历史回读 | `native-memory/get({})`、`native-memory/catalog({})`、`native-memory/archive/read({id:string})` | 既有 `api.call` / `useHost` 与服务替换；返回形状、权限和 apiVersion 1 不变 |

初始化发生在宿主开放请求前，不接收模型或插件提供的迁移路径。交接日志版本仍为 1：当前回执地址直接保留；旧地址只有严格符合 `receipts/<delivery-id>.json`，且其 exchange 根目录经文件系统 `realpath` 证明与当前根目录相同，才规范为当前地址。兼容应用迁移建立的旧目录别名；尚未写入回执、连 receipts 目录都未创建的待接收批次也可恢复。不能用同名目录、相同内容的副本或指向其他位置的链接替代此证明。

全部设备、交接 ID、token、运行时、来源修订、条目与原生证据校验通过后，原子保存日志；只规范已证明等价的回执位置。无效交接仍抛出 `Memory exchange contains an invalid delivery.`，失败不清空、不跳过或改写已有日志。I/O 错误不伪装成功。原始记忆、原生目录、已完成时间、待接收状态与档案内容不因地址兼容而改变，后续回执仍须验证 token、文件及索引摘要。

本修订没有新增事件、权限或后台模型任务，不恢复重启前的活动任务。现有关闭设置保持关闭；正常启用后的捕获和回执验证沿用原生命周期。插件停用恢复核心服务，不撤销已保存的合法路径规范化；任意路径迁移不属于公开请求参数。调用示例：`const status=await api.call('native-memory/get',{}); const history=await api.call('native-memory/catalog',{});`。完整桌面验收只使用独立合成目录，不读取真实聊天库、登录资料或记忆内容。

## 未来内置协作插件

[文档 37：内置协作插件的愿景与初步设计](37-agent-team-collaboration-plugin.md) 记录项目持久团队、用户控制的团队会话、决策者管理下属会话、单聊委托、角色上下文隔离、双策划与验收交付闭环及可视化总控台方案。该插件尚未开发；拟议 `team/*` 契约不是现有 API。本次仅维护规划，未改变宿主方法目录或已有插件行为；正式实现时须在本页补齐实际契约和覆盖矩阵。

## 输入、附件与后台维护修订（2026-09-28 JST）

本节覆盖下方早期“保存时检测”界面和“服务默认滑块停靠点”的描述。原显式同步验证 API 保留兼容，内置设置使用非阻塞后台检测。以下均为增量契约，apiVersion 保持 1。

### 功能覆盖矩阵

| 功能 | 可调用开发入口 | 扩展/替换与验证 |
| --- | --- | --- |
| 输入框高度、全窗口图片 | renderer api.media；composer / .image-viewer 动态 surface | media.setComposerSizing + observeSurfaces + addStyle；scripts/test-media-ui.mjs、scripts/test-media-integration.mjs |
| 附件来源、读取、位置与导出 | attachments/import、attachments/views、attachments/image、attachments/reveal、attachments/save-as | actions.attachments 的 import/resolve/payloads/saveAs；tests/attachment-storage.test.ts |
| 缓存位置、遗留副本清理 | attachments/storage、attachments/open-storage、attachments/cleanup | actions.attachments 的 locations/cleanup；tests/attachment-storage.test.ts |
| 数据根目录迁移 | desktop/data-directory、choose、migrate；desktop.data-directory typed service；initializeAppData / prepareAppData；packaged default `%LOCALAPPDATA%\AgentWorkbench` with one-time legacy hash-root migration | data-directory-settings / codex-install-directory surfaces；approved service override；tests/app-data-service.test.ts、tests/app-data.test.ts、tests/app-data-relocation.test.ts、scripts/test-data-directory-ui.mjs、scripts/test-data-relocation-bootstrap.mjs |
| CLI 安装位置与更新渠道恢复 | local-cli/list、install、install-directory；native.cli | local-cli-row multi-instance surface；native.cli override/interception；tests/native-cli-methods.test.ts、scripts/test-data-directory-ui.mjs |
| 工作树保留与恢复 | worktrees/list、worktrees/configure、worktrees/cleanup、worktrees/restore、navigation/view | actions.worktrees + workbench.controller.maintainWorktrees；tests/worktree-retention.test.ts、scripts/test-media-integration.mjs |
| 无推理识别、显式验证与细线档位 | model-api/reasoning/start/status/cancel、model-api/save | model.connections.reasoning、call；tests/reasoning-background.test.ts、scripts/test-reasoning-ui.mjs |

### Renderer 媒体接口

MediaPluginApi 位于 apps/desktop/renderer/media-controller.ts，renderer api.media 提供 openImages(ids:string[],initialId?:string):Promise<void>、closeImages():void、setComposerSizing({maxHeight:number,viewportFraction:number}):()=>void。图片 ID 从 attachments/import 或历史取得；最多 10 个，同组可用左右键切换，初始 ID 必须属于图片列表。缺失/变化附件报错，不回退成低清缩略图冒充原图。Promise 表示读取并建立视图，不代表用户已导出。已有图片视图随后打开时替换前一视图；异步旧结果丢弃。

核心尺寸默认最小 62 px，最大 360 px；输入框加工具条最多占视口 55%，窄窗口重新测量，超限内部滚动。setComposerSizing 接受 maxHeight 62–600 和 viewportFraction 0.2–0.7，返回幂等恢复函数；叠层按最后注册者生效，停用恢复。没有修改文本、选择区或 IME 提交规则。图片视图通过 .image-viewer 匹配，可使用既有 observeSurfaces(selector,'replace',render) 或 addStyle 包装/替换；核心读写继续经宿主 API。插件停用会释放自己打开且尚未被替换的视图以及尺寸覆盖；未完成的导出不会因停用被撤回。IMAGE_VIEWER_SELECTION_INVALID / COMPOSER_SIZING_INVALID 表示非法参数，既有插件失效门禁仍生效。

示例：await api.media.openImages([attachment.id]); const undo=api.media.setComposerSizing({maxHeight:280,viewportFraction:0.5}); api.onDispose(undo)。示例只展示显式调用，不会自动安装/运行插件。

### 附件存储与清理

Attachment 新增可选 storage:'source'|'clipboard'|'managed' 和 createdAt:ISO。内置桌面启用 nativePaths：本机文件保留原路径；无路径图片写入系统临时目录的 agentworkbench-clipboard/<id>/；其它无路径数据写入应用数据根的 attachments/<id>/。元数据保存在托管目录。旧无 storage 的记录仍按原快照处理，兼容迁移留下的路径链接；不重写历史附件，也不将旧文件移入 Temp。源文件或临时文件变化/消失时明确失败，需要重新添加，不伪造历史字节。

attachments/save-as({id,png?:Uint8Array}):Promise<boolean> 打开原生保存框；取消返回 false，成功原子写入所选目标。省略 png 保存摘要验证后的原字节；提供 png 为标注 PNG 副本，最多 20 MiB，拒绝非法签名/原附件位置/控制目录/凭据目录/链接。标注由 canvas 生成实际 PNG，原件不改变；不称作原生 AI 编辑。attachments/reveal({id}) 返回 {revealed:true}，定位宿主核验的附件位置，不能传任意路径。

attachments/storage({}) 返回 {managed,clipboard,files:'original'}；attachments/open-storage({kind:'managed'|'clipboard'}) 返回 {opened:true}。attachments/cleanup({}) 返回 {removed,bytes}：由宿主收集全部会话/分叉引用，保留本进程打开的附件和 7 天内记录；只清理该存储拥有的遗留副本与元数据，绝不删除 source 原件，不访问两家原生缓存。此处 7 天是工作台清理策略，不是对原生客户端策略的承诺。目录缺失、I/O、摘要和权限错误不伪装成功。actions.attachments.cleanup(referencedIds:string[],now?:number) 是同一实现的开发服务入口；替换者必须保留引用保护。UI 显示操作回执；只读/导出不触发 state 更新，导入/发送仍沿用既有状态事件。

### 数据目录与工作树

Windows installed data relocation (2026-10-02): `desktop/data-directory`, `desktop/data-directory/choose` and `desktop/data-directory/migrate` consume the same `DataDirectoryService` instance registered as `desktop.data-directory`. Typed contract: `packages/app-data/service.ts` (`DataDirectoryApi`, `DataDirectoryState`, `DataDirectoryOptions`). `get()` returns current/default/preferred roots, `defaultWorktreeRoot`, `canMigrate` and `testOverride`. `choose(kind?:'codex')` returns a proposed dedicated child of the selected parent or null; no move or install occurs. `migrate(target:string)` returns `{restarting:true}` after validating the idle gate, flushing preferences, rechecking task admission and saving the pending location. Normal shutdown closes stores; the next process migrates before opening stores. IPC and native maintenance are fenced during migration admission. An explicit `AGENT_WORKBENCH_TEST_RELOCATION=1` QA launch enables the same control only for an isolated `AGENT_WORKBENCH_TEST_DATA` profile and supplies a test-only relocation callback; ordinary development profiles remain unavailable and packaged builds still require the installation locator. Packaged Windows builds use the short `%LOCALAPPDATA%\AgentWorkbench` default, independent of the executable folder and without an owner hash. A locator that still points to the former generated `AgentWorkbenchData/<hash>` default is migrated once with the same verified recovery rules; an explicit user-selected directory remains authoritative.

Approved host plugins call these commands, or intercept/override the three named service methods with lifecycle-owned cleanup. A directory is a user filesystem choice, not an enumerable provider/theme catalog, so registration of additional directory options does not apply. Named renderer surfaces `data-directory-settings` and `codex-install-directory` support narrow replacement for existing and later instances. Disabling releases replacements but never reverses a completed filesystem migration. Example: `const locations=api.services.get<DataDirectoryApi>('desktop.data-directory'); const target=await locations.choose(); if(target) await locations.migrate(target);`. Host approval is required; no extra machine, SSH or administrator authority is granted. No model or network request is used.

`APP_DATA_RELOCATION_UNAVAILABLE`, `APP_DATA_TASKS_ACTIVE`, `APP_DATA_PATH_INVALID`, `APP_DATA_PATH_LINK`, `APP_DATA_DESTINATION_CONFLICT`, `APP_DATA_LOCATION_INVALID`, `APP_DATA_COPY_INVALID`, `APP_DATA_MIGRATION_CLEANUP_REQUIRED`, `APP_DATA_MIGRATION_RECOVERY_REQUIRED`, and `APP_DATA_LEGACY_MIGRATION_FAILED` preserve data and stop the operation. Migration copies opaque payloads, rewrites only known managed path fields in state/worktree state/attachment metadata/background memory and receipt locations, verifies streaming hashes and repairs registered Git worktrees, including verified worktrees under a previously customized root. Their external main repositories remain in place; future worktrees use the new managed root. Profile-owned clipboard files are imported from the old OS temporary cache only after metadata/hash verification; unrelated cache entries remain. External project roots, message prose, credential bytes and arbitrary plugin data are not rewritten. Plugins storing absolute paths in their own opaque data must resolve against the current root or explicitly migrate their own format. Links/special files, a managed repository containing its own main Git checkout, and uncommitted interruption remain explicit unsupported/recovery cases rather than destructive guesses. A separate recovery inventory permits resumed partial cleanup only while every surviving source file and complete destination still match; locator files remain outside the moved tree. Successfully completed moves leave no previous data root or verified legacy aliases. The small per-user locator and transient OS singleton lock are required bootstrap metadata, not a second profile.

`local-cli/install-directory({directory:string})` returns `LocalCli[]` and persists a Windows Codex program location only before an installation exists. The official installer receives `CODEX_INSTALL_DIR` and a private installer package root in `CODEX_HOME`; runtime launch, login, memory, skills and plugins continue consuming the existing native environment. Selecting a directory does not install, copy native data or modify process-global environment. Workbench updates/removal resolve the selected installation or the original fallback independently. Existing CLI installations are retained. Claude Code has no verified equivalent custom program-directory contract in this delivery. `CLI_INSTALL_DIRECTORY_INVALID`, `CLI_INSTALL_STATE_CHANGED` and native path validation errors reject unsupported/racing requests. `native.cli.setCodexInstallDirectory` is callable and replaceable through approved service interception; this is a filesystem choice with no new extensible catalog. CLI preference version 1 gains optional `codexInstallDirectory`; absence keeps official defaults and a failed save restores the in-memory preference. No migration of existing native profiles is claimed.

CLI update-channel recovery (2026-10-02): `local-cli/list` / `native.cli.list()` now detect case-insensitive Windows PATH keys and nested, hoisted or legacy Codex npm platform payloads. Existing native/npm installations retain their channel. `LocalCli.canInstall` is also true for an unowned `source:"path"` binary when the official installer is available; `canUpdate` and `canUninstall` remain false. An explicit `local-cli/install({runtime,installMethod:"native",update:false})` may add a separate official installation; omitted method, automatic installation or update cannot convert that binary. The existing native installer, runtime admission, idle/error handling and post-install version discovery are reused. The original executable remains in place and the native launcher takes precedence. Installer PATH changes are disclosed before confirmation. A missing npm executable now has a specific UI explanation. No new event is added: callers receive `LocalCli[]`, the renderer refreshes and emits its existing `local-cli-changed` notification. Errors retain `CLI_INSTALL_STATE_CHANGED`, `CLI_INSTALL_PREREQUISITE`, `CLI_TASKS_ACTIVE` and bounded installer codes.

Call/register/replace review: approved plugins call the typed `native.cli` methods or existing IPC, register their lifecycle-owned interception/override on that production service and replace the named `local-cli-row` surface independently for both runtime rows, including later mounts. Installation channels are the existing verified native/npm operations, not a newly extensible catalog; registering a new runtime still uses the documented runtime adapter registration. Disable/reenable cleans service and surface overrides without removing installed programs or saved auto-update preferences. `scripts/test-data-directory-ui.mjs` activates a real approved ZIP, checks both confirmation/cancellation flows through the production consumer and restores core behavior; `tests/native-cli-methods.test.ts` verifies actual channel discovery and commands using synthetic files. No real native client is upgraded by these tests. No existing signature or selector is removed; the snapshot records the additive row surface and semantic compatibility is reviewed here.

Coverage: `tests/app-data-relocation.test.ts`, `tests/app-data.test.ts`, `tests/app-data-service.test.ts`, `tests/native-cli-methods.test.ts`, `scripts/test-data-relocation-bootstrap.mjs` and `scripts/test-data-directory-ui.mjs`. The approved ZIP test exercises the production service, persistence, disable and reenable; hidden Electron covers IPC and renderer surfaces. Original `desktop/data-directory` consumers retain `directory`, `defaultWorktreeRoot` and `testOverride`; `canMigrate` is additive. No old named selector is removed. The contract snapshot adds the typed directory API and CLI declarations; semantic review includes obsolete asynchronous operations, shutdown, existing installations and preservation of user preferences.


initializeAppData(host:AppDataHost,override?:string,installed?:{directory:string;locator:string;legacyDirectory?:string}):AppDataLocation|null 在任何 store 打开前运行。AppDataHost 注入 getPath(home/userData/temp)、setPath(userData,path)、requestSingleInstanceLock():boolean、releaseSingleInstanceLock():void；返回 null 表示已有实例，调用者必须退出。先探测旧版本的 profile 锁，再把实际持有的 Electron 单实例锁放入系统 Temp 的 agentworkbench-startup/<profile-hash>/，避免 Windows 持锁目录 rename EPERM。锁由进程生命周期释放，不存储附件或聊天；已有实例不迁移。`installed.directory` 是当前安装默认，`legacyDirectory` 仅标记旧的自动生成默认，用于一次性兼容迁移；定位文件保留 `defaultDirectory`，显式用户选择不因安装目录变化而移动。`installedDataDirectory` 在 Windows 正式版返回 `%LOCALAPPDATA%\AgentWorkbench`，不再把数据放在程序目录的哈希子目录。prepareAppData(home,legacyDirectory,override?):AppDataLocation 负责锁内的路径迁移；默认 ~/.agentworkbench，override 为绝对专用根目录（AGENT_WORKBENCH_HOME）。迁移旧应用数据及旧相邻 -worktrees / -attachments，保留兼容链接；不读取数据内容，冲突不合并，失败逆序回滚。APP_DATA_PATH_INVALID / APP_DATA_PATH_OVERLAP / APP_DATA_DESTINATION_CONFLICT / APP_DATA_LEGACY_LINK_CONFLICT / APP_DATA_MIGRATION_RECOVERY_REQUIRED 等必须让启动停止，不能打开空白库。desktop/data-directory({}) 回读实际 directory、defaultWorktreeRoot、testOverride 及可用迁移信息。迁移不是运行时插件停用可回滚的动作，测试目录绕过生产迁移。示例：const location=initializeAppData(app,process.env.AGENT_WORKBENCH_HOME); if(!location) app.quit()。scripts/test-data-bootstrap.mjs 使用真实 Electron 和独立合成目录验证迁移、单实例与重启，不读取用户数据。

worktrees/list({}) 增量返回 autoDelete:boolean、limit:number（默认关闭/15）；默认 root 为数据根/worktrees。configure({root?:string,autoDelete?:boolean,limit?:number}) 保存并回读，limit 1–100；root 留空恢复默认，只影响新工作树。cleanup({}) 返回 {archived:string[],failed:{id,code}[]}；后台每分钟尝试同一路径，任务/待提交/待确认或维护中返回 WORKTREE_BUSY，未启用则无动作。维护期间拒绝新任务，正常退出等待维护完成；数量输入和手动清理使用同一紧凑行，数字与输入框右对齐；隐藏浏览器步进箭头占位，保留原生数字输入和键盘递增/递减，宿主参数/范围不变。置顶、当前查看以及运行中的会话受保护。navigation/view({sessionId:string|null}) 记录当前查看和使用时间，不改变执行身份。

清理依最近使用时间保留 N 个 active checkout。必须先核实本工作台记录与 Git 注册身份、保存并回读压缩副本，再复核 HEAD/索引/全部文件摘要，最后删除 checkout。副本包含原始字节、未跟踪及忽略文件、空目录和暂存差异；专用 refs/workbench/archive/<id> 保留未推送 HEAD，不向源分支提交。256 MiB/30000 条目上限；嵌套 Git、子模块、链接、硬链接、特殊文件、无法完整复现的索引或变化中的文件拒绝清理。失败留下目录与恢复资料；不把忽略文件写入 Git 对象。

WorktreeRecord.status 增加 archived，含可选 archive/lastUsedAt/archiveError。worktrees/restore({id}) 返回恢复后的 WorktreeRecord，并通过 state 事件更新相关会话；仅在原目标不存在时恢复，已有目录绝不覆盖。恢复核对压缩包 SHA256、每个文件、HEAD 和索引；失败保留副本与部分目录供人工检查，不盲目重试/删除。WORKTREE_ARCHIVE_CHECKSUM / WORKTREE_RESTORE_TARGET_EXISTS / WORKTREE_ARCHIVE_LIMIT / WORKTREE_ARCHIVE_UNSUPPORTED_FILE 等错误可回读。原生 Git/source、权限、已有历史保持各自所有权。插件可包装上述服务/方法，停用恢复核心，已归档目录不会凭插件停用自动恢复。

示例：await api.call('worktrees/configure',{autoDelete:true,limit:15}); await api.call('worktrees/cleanup'); await api.call('worktrees/restore',{id:record.id})。

### 后台思考档位契约

model-api/reasoning/start({id?,connection,key?,force?:boolean,allowInference:true}) 立即返回 ReasoningJobView{id,state,models,error?}；status({jobId}) 回读，cancel({jobId}) 取消进行中作业，包括被保存接管的作业。state 为 queued/running/complete/cancelled/failed；models 按已完成模型逐项到达，包含原有 reasoningProbe 证据，没有原始密钥或上游原始错误。编辑界面不再自动调用此接口，普通识别和保存不启动推理作业。已完成且确定的作业内存复用遵循 24 小时证据期限；未完成/未知证据在下一次显式 start 时不复用，但保存可接管原作业结果，避免重复消费。并发上限一批、每批两个模型、队列最多四批；每批 96 个请求、180 秒，单请求 30 秒，不自动重试。

model-api/save({...原参数,backgroundReasoning:true,allowInference:true,jobId?:string}) 直接保存，不等待目录 GET 或探测；接管 fingerprint 匹配的作业，否则后台创建一批。派生证据仅在地址、协议、凭据、模型和选项仍匹配时发布；连接忙碌期间延后发布，不影响已启动任务。发布发送既有 state 事件，不改变用户配置 revision，避免编辑窗口被后台更新无故判冲突。队列暂满时连接仍保存成功，返回值额外提供 reasoningJobError:REASONING_DETECTION_UNAVAILABLE（不落盘）；UI 明示稍后重测。backgroundReasoning 与 verifyReasoning 不可同时开启，非法组合报 REASONING_MODE_INVALID。关闭宿主取消探测和延期回写，不启动会话/工具/新的模型任务。原 verifyReasoning:true 同步调用及严格 effortCandidates 保留；新增 manualEfforts 为明确的用户配置，允许未知状态保存，不伪造验证证据，见下节。

更名/新增模型可在连接使用中保存；改变地址、密钥、禁用或修改已启用映射仍受保护。检测失败/限流为未知，不推断支持或反复重试。错误含 REASONING_JOBS_BUSY / REASONING_JOB_NOT_FOUND / REASONING_DETECTION_FAILED / MODEL_KEY_REQUIRED_FOR_NEW_SOURCE，以及原 CAS 错误。检测可能产生 API 用量，只用该连接的独立 API 身份。

细线选择器呈现用户手动配置、已接受请求证据、上游校验错误枚举或模型目录声明的档位，并区分来源；仅均无档位时显示“默认”。重置优先使用有效模型默认，否则 medium 或首个实际档位，实际发送与显示一致；light 和 low 不混用。鼠标为 pointer，Fast 仍仅在原生目录明确支持时显示。


## 紧凑模型选择与思考档位检测（2026-09-28 JST）

### 功能覆盖矩阵

| 功能 | 接口与类型 | 扩展或替换 | 验证 |
| --- | --- | --- | --- |
| 显式授权检测、强制复测、结果缓存 | model-api/save；ApiModel.effortCandidates/reasoningProbe | model.connections 的 call；既有 registerMethod/useHost 中间件 | tests/reasoning-probe.test.ts、tests/reasoning-manual.test.ts |
| 手动档位、默认值、恢复自动、错误枚举识别 | model-api/save/list/reasoning/start/status；ApiModel.manualEfforts/defaultEffort | model.connections 的 call；既有 services.intercept/override | tests/reasoning-manual.test.ts、scripts/test-reasoning-ui.mjs |
| 当前模型、离散滑块、默认档位、条件 Fast | model-targets/list、runtime/models、session/model、session/model-target | 上述请求/服务可替换；renderer mountSurface('.model-controls') 或 replaceShell | scripts/test-reasoning-ui.mjs |

### 请求与返回

`model-api/save({id?,revision?,connection,key?,verifyReasoning?:boolean,forceReasoning?:boolean,allowInference?:boolean}):Promise<ModelConnection>` 沿用既有连接修订与凭据规则。桌面保存不传检测字段，只保存/读取目录。独立推理验证使用 reasoning/start，或显式 verifyReasoning/backgroundReasoning 与 allowInference:true；省略授权标记不会发送推理请求。forceReasoning=true 必须同时启用 verifyReasoning，表示同步探测跳过缓存；后台强制检测使用 start 的 force=true。

每个启用的 ApiModel 可传 effortCandidates?:string[]。省略/空数组按固定顺序检测 light、low、medium、high、xhigh、max、ultra；显式子集仅检测所列值，去重后按上述顺序排列，必须全部通过，否则整个保存失败。两个低档名称是独立原始参数，不互相替换。其他候选拒绝；显式候选必须随 verifyReasoning=true 保存。关闭的映射不检测。原生目录沿用运行时声明的档位，不对 SSH 原生账号执行这类 API 探测。

返回模型新增宿主持有的 `reasoningProbe?:{status:'verified'|'declared'|'unsupported'|'inconclusive',checkedAt:string,fingerprint:string,accepted:string[],rejected:string[],declared?:string[],httpStatus?:number,reason?:'ignored'|'unavailable'|'budget'|'format'|'unsupported'|'timeout'|'auth'|'rate-limit'|'server'|'network'|'http'}`。checkedAt 为 ISO 时间，fingerprint 为配置/密钥摘要，不包含原始密钥。调用方传入的 reasoningProbe 被丢弃；恢复旧证据前核验地址、协议、未替换凭据、模型与候选/思考模式。自动模式的 efforts 来源为实际接受值、declared 声明值或模型目录；declared 不填入 accepted，不等于实际生成已验证。部分完成可返回 verified 与 reason，accepted 之外仍未知。无证据且无手动配置才使用服务默认。诊断仅返回固定 reason 和 HTTP 状态码，不回传上游原始错误。

请求只含固定英文兼容性提示、当前模型及参数，没有用户聊天、工具、附件、原生登录资料。只有明确授权推理验证才发送请求，每个模型仅发送合法候选，不再先发送无效对照。对 HTTP 400/422 中明确绑定 effort 字段的错误解析 message/msg、param/loc、嵌套 detail/errors、允许值数组及文字枚举，仅取上述七种原始 token。得到枚举时返回 declared；没有枚举则继续逐项测试候选。显式 effortCandidates 仍逐项验证，不因枚举直接算通过。Responses 使用 reasoning.effort，Chat 使用 reasoning_effort，Messages 使用 output_config.effort；协议适配仍按原始 token 传递，不按 CLI 枚举降档。参数被接受不证明上游真实采用该思考强度，也不证明模型质量。

### 手动配置增量（2026-09-28 JST）

ApiModel.manualEfforts?:string[] 是明确的用户选择；仅接受 light/low/medium/high/xhigh/max/ultra，去重并按固定顺序保存。defaultEffort 可指定其中一项，省略时优先 medium 或首项。省略或空数组恢复自动；与 effortCandidates 同时非空报 MODEL_REASONING_MODES_CONFLICT，非法值报 MODEL_MANUAL_EFFORTS_INVALID。旧模型无需迁移，调用方仍不能伪造 reasoningProbe。新增 declared 状态是兼容增量；旧插件若穷举状态需补分支，不得将 declared 等同 verified。

save/list 返回 manualEfforts、有效 efforts/defaultEffort 和独立探测证据；state 事件沿用原契约。详情提供手动选择/恢复自动、七个复选项及默认档位；不得清空最后一档，可恢复自动。手动设置即使探测失败也能保存，并进入会话选择器和原生协议适配；实际请求原样传递 token，不保证上游采纳。后台发布、缓存复用和刷新目录均保留手动选项及默认值；更换连接地址/协议或在编辑器更换上游模型会清除旧选择与证据。修改忙碌映射的手动档位/默认值仍受现有忙碌保护；不会改变在途模型请求。

权限仍为 model.connections 的 call；无新增凭据、原生登录资料或系统权限。插件可通过已批准的 services.intercept/override 替换宿主路径，停用恢复核心实现，用户配置保留。错误/取消不会覆盖其它修订，也不触发自动重投。测试位置为 tests/reasoning-manual.test.ts（公开宿主保存/恢复、重启、并发结果、协议传递）及 scripts/test-reasoning-ui.mjs（未知状态手选、两种主题、后台覆盖保护）。

```js
const connection = (await api.call('model-api/list'))[0];
const model = connection.models[0];
const saved = await api.call('model-api/save', {
  id: connection.id, revision: connection.revision,
  connection: {...connection, models: connection.models.map(item => item.id === model.id
    ? {...item, effortCandidates: undefined, manualEfforts: ['medium', 'high'], defaultEffort: 'high'} : item)}
});
console.log(saved.models[0].manualEfforts, saved.models[0].reasoningProbe?.status);
// Omit manualEfforts (or send []) in the next revision to restore automatic selection.
```

### 生命周期、失败与权限

一次检测至多 96 个模型 POST、2 个并发、180 秒批次期限、单请求 30 秒、输出上限 64 tokens、单响应 64 KiB；不自动重试、不跟随跳转。请求 stream=false，同时支持兼容端点实际返回的有界 SSE 完成回执，不向 UI 输出探测文本。这些上限不含目录 GET。鉴权、额度/限流停止该连接后续探测；单模型 5xx 不阻断其它模型。未知响应不可推断“不支持”。旧 ignored 表示过去只测试过无效值，不能推断有效档位支持或连接状态；新验证不再产生该原因。

匹配探测版本/endpoint/protocol/key/model/adaptiveThinking/candidates 的完整结果缓存 24 小时；本次探测版本变化使旧指纹失效。配置改变、缓存过期、未完成或 forceReasoning=true 时，在下一次明确检测重新探测；编辑连接、聊天选择器、普通保存与目录刷新均不自行发起生成。刷新目录保留匹配证据；思考模式改变则清除旧证据。此为可选字段增量，不要求旧连接立即迁移。

错误包括无效候选/验证选项、自定义档位被上游明确拒绝、自定义档位未能验证、既有修订冲突与连接忙碌。自定义失败不覆盖原连接或旧密钥，新暂存凭据回滚；非严格候选验证的未知状态可保存连接，返回状态供用户决定后续操作。原始 HTTP body 和服务器错误文本不写入证据/提示。检测使用用户明确选择的独立 API 凭据与本机网络权限，可能产生上游费用；不提权、不读 Claude 登录资料、不修改原生配置或发起会话任务。

保存成功沿用既有 state 事件，返回持久化连接供回读，无新增后台事件。`model.connections.call(method,payload):Promise<unknown>` 可通过 services.intercept/override 包装或替换，替代实现须保持证据范围、CAS 与失败清理约定。停用插件恢复核心处理，既有连接证据保留；不可把 UI 私有函数当作绕过验证的稳定接口。

### 展示与调用示例

renderer 默认展示 224px 宽的两行标题与滑块：当前中文档位、可展开模型名、右上角恢复默认。来源、原始参数和检测状态置于 title 提示，不显示额外说明段。滑块使用 availableReasoningEfforts(model) 的有效列表，不额外添加服务默认档位；用户手动配置优先，其次 verified.accepted、declared.declared 或已有目录 efforts。原生 Fast 仅在当前 NativeModelOption.serviceTiers 明确包含 priority 时显示左上角闪电，role=switch/aria-label=Fast；开启发送 serviceTier=priority，关闭省略该字段。不通过模型名字猜测 Fast，API 未有明确能力时隐藏。

稳定选择器为 `[data-testid=model-selector]`、`[data-testid=current-model-choice]`、`[data-testid=native-effort]`、`[data-testid=model-picker-back]`；滑块 aria-valuetext 保留原始档位，键盘、指针释放或失焦提交单次选择。模型/参数选择只更改配置，不启动回合；绑定锁和原生下一回合生效边界不变。插件可用返回的模型数据绘制自己的界面，并调用既有 session/model；未发送的草稿由界面持有 NativeModelSelection 后传入创建请求。

```js
const connection = (await api.call('model-api/list'))[0];
const saved = await api.call('model-api/save', {
  id: connection.id, revision: connection.revision, connection,
  verifyReasoning: true, forceReasoning: true, allowInference: true
});
// Omit key to retain the current credential. Never inject a fabricated probe.
const model = saved.models.find(item => item.reasoningProbe?.status === 'verified');
console.log(model?.efforts, model?.reasoningProbe?.checkedAt);
```

2026-09-27。这里描述工作台自有 ZIP 插件，不是 Codex / Claude Code 原生插件格式。运行时插件仍由各家 CLI 安装、加载、授权与整组开关控制。

## 会话交互、阅读与模型容量（2026-09-28 JST）

### 功能覆盖矩阵

| 功能 | 调用与类型 | 扩展或替换 | 验证 |
| --- | --- | --- | --- |
| 原生审批 | session/approval；NativeApproval、ApprovalOption、ApprovalReply | 同名 registerMethod/useHost；runtime.native-provider 和 runtime.codex 的 approval；renderer [data-native-approvals] | tests/native-approvals.test.ts、scripts/test-native-approvals.mjs |
| 问题分页、历史 | interaction/prepare、interaction/submit、session/interaction；ConversationEntry 的 interaction 分支 | 既有 interactions 服务；renderer 问题容器/完整 conversation surface | tests/conversation-recovery.test.ts、scripts/test-conversation-ui.mjs |
| Markdown、数学公式、字符实体和代码复制 | Message.original、renderer api.markdown（tokens/blocks/code/link/text/math）；clipboard/write | observeSurfaces 覆盖全部动态消息或公式，replaceShell 可替换阅读界面；[data-message-markdown]、[data-math-status] | tests/message-markdown.test.ts、tests/message-math.test.ts、scripts/test-conversation-ui.mjs、scripts/test-message-math-ui.mjs |
| HTTP 错误与手动恢复 | NativeProviderDiagnostic；session/api-acknowledge、draft/prepare/submit | runtime.native-provider 服务、同名请求中间件 | tests/conversation-recovery.test.ts、scripts/test-native-approvals.mjs |
| 模型容量、90% 预算及原生窗口 | model-api/context-budget、model-api/save/refresh、ApiModel.contextWindow/contextWindowSource、NativeContextUsage.runtimeCapacity | model.connections 与 runtime.native-provider 服务；模型设置/阅读界面可替换 | tests/context-budget.test.ts、tests/conversation-recovery.test.ts、scripts/test-context-budget-ui.mjs、scripts/test-native-compaction.mjs、scripts/test-native-approvals.mjs |

### 宿主和 renderer 契约

session/approval 接受 {sessionId,requestId,optionId,receipt}，原生分支返回 Promise<void>；成功状态通过 state 事件回读。NativeApproval.options 为 {id,label,description,scope,rules?}[]；scope 为 once/session/saved/deny/cancel。receipt 由宿主接收每次请求时重新发放。批准时宿主对照当前原生请求解析 optionId，不能从 renderer 传入任意策略对象。已有 {sessionId,requestId,decision:'accept'|'acceptForSession'|'decline'|'cancel'} 继续支持，但仅在原生当前提供该决定时有效；历史基础调用不等价于新增结构化授权。原生方法或纯 API 分支未提供的选项拒绝。

错误包括 APPROVAL_REPLY_INVALID、APPROVAL_EXPIRED、APPROVAL_RECEIPT_EXPIRED、APPROVAL_OPTION_NOT_OFFERED。发出原生回复前消费请求；写入失败或回执未知不自动重放。规则由 CLI 存入原生目标，停用界面插件不会撤销已经明确批准的规则。处理成功会通过既有 state 事件更新审批列表；结束、取消和 resolved 清除对应项。NativeCodexRunner/NativeProviderRunner.approval(id,requestId,reply) 的第三参数增量支持 ApprovalReply，旧基础字符串兼容。经批准插件可使用 services.intercept('runtime.native-provider','approval',handler) 包装或 services.override 替换该公开方法；替换者须承担相同回执和授权范围校验。

审批使用 [data-native-approvals][data-session-id]，具体请求含 data-approval-receipt。问题分页导出 QuestionPager({items,page,onPage,disabled,answers})，page 从 0 开始，onPage 只改变显示，不提交；QuestionFields 保留全部问题草稿。当前问题使用 [data-testid="question-pager"]，已完成记录使用 [data-testid="native-interaction-history"]。conversationTimeline(session,peers?,children?) 返回的 ConversationEntry 新增 {type:'interaction',id,item,at}，旧插件对联合类型须增加该分支或安全忽略；pending 仍从 Session.nativeInteractions 读取，不能同时在历史重复渲染。回答仍用原有 prepare/submit 翻译与隐私协议，分页不改变传输。原生重连可能复用 requestId，同一线程的历史可有多个相同 ID；receipt 是每次交互的身份，状态与答案只更新捕获的 receipt，不能按原生 ID 覆盖旧记录。putInteraction 保留这些历史并维持最多 100 条的既有非 pending 淘汰策略；重复 pending ID 仍拒绝。旧存档无需迁移，历史界面保留旧记录的兼容身份。该重连回归另由 scripts/test-native-interactions-ui.mjs 验证。

renderer 可通过 mountSurface 精确 CSS 选择器替换某个节点，或替换 conversation surface 并订阅 state。通用选择器只挂载首个匹配项，多个消息应使用消息祖先和已知 ID 限定。停用后 mountSurface 恢复被隐藏的核心节点；清理不删除原始消息、答案或模型设置。

packages/message-markdown 公开 markdownTokens(source):TokensList、markdownBlocks(source):string[]、markdownCode(token):string、markdownLink(href,label):LinkedText|undefined、markdownText(value):string。TokensList 来自锁定的 Marked 18；不承诺未来 Marked 主版本 AST 不变。MarkdownContent 的 props 为 {text,renderLink,onCopy,onCopyError?}，链接沿用文件导航和 HTTP(S) 检查。代码复制使用 api.call('clipboard/write',{text})，返回原剪贴板入口结果；失败交给 onCopyError，不显示成功。整条回复仍以原始 Markdown 为复制来源。HTML 和不支持语法不会执行，外部图片不会自动加载。

### 数学公式与符号显示（2026-09-28）

经批准 renderer 插件可直接调用只读 `api.markdown`，无需私有模块路径或宿主 Node 权限。其 `tokens(source:string):TokensList`、`blocks(source:string):string[]`、`code(token:Token):string`、`link(href:string,label:string):LinkedText|undefined`、`text(value:string):string` 与上述公开函数同源；新增 `math(token:Pick<MarkdownMathToken,'raw'|'text'|'displayMode'|'complete'>):MarkdownMathResult` 对应 packages/message-markdown 导出的 markdownMath。均为同步纯显示操作，不读写消息或配置、不访问网络、不启动模型、不发事件；无进程/订阅需要清理。函数引用本身无权限，停用后保存的纯函数引用仍可计算，界面挂载和订阅仍按插件生命周期清理。

TokensList 增量增加 `{type:'math',raw:string,text:string,displayMode:boolean,complete:boolean}`。支持 `\(...\)`、`$...$`、`\[...\]`、`$$...$$`，以及 equation、align、alignat、gather 的独立环境（含星号版本）；矩阵、分段等环境置于公式内。raw 保留定界符，text 为传给公式引擎的正文；独立环境的 text 含 begin/end。流式未闭合公式 complete=false，保留原文；普通金额、转义定界符、行内代码、所有代码围栏仍为字面内容。不将任意无定界符的反斜杠命令强行解释成公式。旧消费方遍历 token 时须处理 math 或显示 raw，存档和模型传输无需迁移。

math 返回 `{status:'rendered',html:string}` 或 `{status:'pending'|'invalid'|'limit',raw:string,error:string}`。error 为 MATH_INCOMPLETE、MATH_INVALID_OR_UNSUPPORTED、MATH_UNTRUSTED_COMMAND、MATH_INPUT_LIMIT；这些是局部结果，不抛出至整个消息。KaTeX 0.18.9 输出本地 HTML+MathML，禁止受信任 HTML、图片和链接命令；宏每式独立，最多 1000 次展开、单式 16384 个 UTF-16 代码单元、用户尺寸最多 20em。不承诺完整 TeX 宏包兼容。不支持/非法公式以点线标记并提供中文原因，未闭合时保持原文。text 解码完整 HTML5 命名/数字实体一次，要求分号、区分大小写，未知实体不删除；结果仍为 React 文本，不解释为 HTML。

生产入口随包加载 `katex/dist/katex.min.css` 及本地字体；独立使用 MarkdownContent 的组件宿主也须加载该样式。rendered 的 html 仅可用于该引擎返回值，不可把用户原文直接赋给 innerHTML。选择器 `[data-math-status]` 的值为 rendered/pending/invalid/limit；已渲染节点携带 `data-math-source` 原文。插件可通过 `observeSurfaces('[data-math-status="rendered"]','replace',renderer)` 接管全部现有和后续公式，返回清理函数或交给插件生命周期管理；停用恢复原节点，不改消息。apiVersion=1 的增量能力，旧版本可检查 api.markdown 是否存在。测试覆盖实际解析与组件、动态多实例替换、停用恢复，位置见上表。

```js
export function activate(api) {
  const tokens = api.markdown.tokens('\\[\\boxed{21}\\]');
  const result = api.markdown.math(tokens[0]);
  // result.status === 'rendered'; result.html contains local HTML and MathML.
  const symbol = api.markdown.text('&alpha;'); // α
}
```

### 模型元数据、诊断与生命周期

新增稳定入口 `model-api/context-budget({contextWindow?:number}):Promise<{window:number|null,compactAt:number|null,percent:90,trigger:"native"}>`。输入可省略表示未知，或为 1..100000000 的整数；非法值报 MODEL_CONTEXT_WINDOW_INVALID，队列继续可用。该入口只计算，不读取凭据、不访问上游、不修改状态或发出 state 事件，也不启动压缩。调用权限沿用已批准工作台插件的 api.call；可经 model.connections.call 的 intercept/override 或 registerMethod 替换，须保留纯计算语义，停用恢复核心。renderer 详情页与原生启动共用同一计算函数；无需存档迁移。测试位于 tests/context-budget.test.ts、tests/conversation-recovery.test.ts 和 scripts/test-context-budget-ui.mjs。

~~~js
const budget = await api.call("model-api/context-budget", { contextWindow: 258400 });
// { window: 258400, compactAt: 232560, percent: 90, trigger: "native" }
// Save the original contextWindow through model-api/save, never compactAt.
~~~

ApiModel 可选 contextWindow 为 1..100000000 的整数，contextWindowSource 为 upstream/manual。通过现有 model-api/save({id?,revision?,connection,key?}) 提交并返回标准 ModelConnection；手工容量和其他目录元数据独立合并。刷新保留 manual 值，修改模型/来源必须重新声明。Session.nativeContextUsage 新增 runtimeCapacity?:number|null；capacity 表示模型容量，used 为原生报告，percent 按模型值计算；未知不回填原生兜底值。

nativeContextSettings(model) 返回 {window,compactAt}|undefined；compactAt=max(1,floor(window×90/100)) 是请求预算，完整容量不变。Codex 的 CLI 参数与临时目录使用该预算，0.155.1 原生仍将实际阈值限制为不超过容量的 90%。Claude 的 MAX_CONTEXT 使用该预算，AUTO_COMPACT_WINDOW 遵守参数边界；两家原生可能提前压缩，不保证恰好在 90% 触发；providerContextUsage(model,usage) 返回归一化 NativeContextUsage；displayedContext(model?,usage?,nativeWindow?) 返回 {capacity,runtimeCapacity,percent}。nativeProviderLaunch 原有参数后新增可选 catalogPath，返回 args/env/thread 及 Claude 可选 runtimeModel。prepareCodexModelCatalog(executable,model,sourceEnv,run?) 返回 Promise<{file,dispose}>；仅在临时 Home 调用安装程序的 debug models --bundled，文件只包含公开原生元数据与当前模型映射；dispose 幂等删除自建临时目录。NATIVE_MODEL_CATALOG_INVALID/UNAVAILABLE 表示安装版本元数据无法用于本次声明，启动失败须保持未提交状态，不能虚报预算。codexModelCatalog(model,bundled) 为纯目录转换；不会修改输入。

Claude 家族/[1m] 名称有容量时通过 claudeContextModel(model) 生成网关内部别名，nativeProviderLaunch 配置原生窗口/压缩变量，网关仍发出准确的 model.model。没有容量时返回原 ID。压缩依赖准确的容量和用量，保留用户的原生自动压缩开关/环境控制；停用环境变量不会由工作台偷偷覆盖。验收入口为 npx tsx scripts/test-native-compaction.mjs，必需 AWB_QA_CLAUDE 与 AWB_QA_CODEX 指向已安装程序，可选 AWB_COMPACTION_QA 指定报告目录；成功退出 0 并写 report.json，缺失程序、45 秒超时或回执断言失败退出非零。脚本使用并清理临时 Home，只访问合成 loopback 服务，不改生产配置；测试点不等于精确阈值。此次没有新增持久化预算字段；新只读预算接口为增量，旧客户端的容量可继续读取。2026-09-28 后续修订将默认请求预算由 95% 调整为 90%，percent 返回值同步为 90；插件应读取返回值，不硬编码旧比例。参数、错误、权限和事件契约不变，不新增持久化字段或迁移。Claude 进程预算使用派生值，Codex 保留原生安全限制；只影响后续启动，不重启现有进程。原生模型提示、工具执行及压缩仍由 CLI 提供，不修改用户原生配置；进程复用期间保持启动配置，下次进程才应用新容量。插件可覆盖 runtime.native-provider.submit(id,preview):Promise<{started,runtime}> 实现其他兼容策略，或包装该服务；不应在状态层只改分母而忽略实际原生预算。

openNativeGateway(options) 增加 diagnostic?(NativeProviderDiagnostic):void 回调。诊断含 status/category/summary 和可选 code/param，只读取至多 16KiB，原文、密钥、用户内容不保存。category 为 tool-sequence/context-limit/parameter/authentication/rate-limit/upstream；错误正文不可读仍保留已知 HTTP 状态。原生明确失败更新 nativeTurnStatus='failed'、status='idle' 和可读 nativeError；未知断线仍 uncertain。用户结束未知等待调用 session/api-acknowledge({sessionId,confirm:true})，要求本会话无活动处理；它不重放旧任务，下一次发送继续走 draft/prepare 和 draft/submit。

上述入口使用已批准插件现有本机权限，不扩展 OS、其他设备或租户权限；没有后台消息代用户启动模型回合。新增字段可选，旧持久化消息无需迁移，省略参数沿用原行为。测试及证据边界见 [会话 UI 专题](conversation-ui-20260928.md)。

示例（只展示调用方式，不自动批准请求）：

~~~js
const state = await api.call('state/get');
const approval = state.sessions.find(s => s.id === selectedSessionId)?.nativeApprovals?.[0];
// 在用户明确选择该项后调用，不能凭模型文字推定授权。
const chosen = approval.options.find(o => o.id === userSelectedOptionId);
await api.call('session/approval', {
  sessionId: selectedSessionId, requestId: approval.id,
  optionId: chosen.id, receipt: approval.receipt
});
~~~

## 接口概览

此前已有声明式配色、背景、模型上下文、宿主中间件和命令注册；缺少可直接调用现有宿主服务的入口、状态事件与正式界面入口。因此原先不能把“完整宿主代码权限”当作已经交付了完整 UI 扩展 SDK。

现已开放以下实际接口：

| 范围 | 宿主入口 | 界面入口 |
| --- | --- | --- |
| 现有工作台服务 | `api.call(method, payload)` | `api.call(method, payload)` |
| 项目、会话、翻译、文件操作、设置、原生资源等 | 使用现有 controller 方法及原有参数验证 | 使用现有 preload/IPC 通道及同样的服务验证 |
| 请求调整、包装、替换 | `api.useHost(handler)` | 经 IPC 调用宿主 |
| 状态更新 | `api.onEvent(({type, payload}) => …)`，支持 `state` 与自定义 `plugin` 事件 | `api.onState(listener)` |
| 导航、桌面菜单命令 | 通过原有宿主服务 | `api.onNavigate(listener)` / `api.onCommand(listener)` |
| 插件自有命令 | `api.registerCommand(name, handler)` | `api.command(name, payload)` |
| 模型上下文 | `api.onContext(handler)`，需声明 `context` | 通过宿主入口提供 |
| 界面及全局样式 | 由 renderer 入口实现 | `api.root` / `api.addStyle(css)` |
| 整个主界面替换 | 由 renderer 入口实现 | `api.replaceShell()` |
| 生命周期 | `api.onDispose(handler)` | `api.onDispose(handler)`、`api.signal`、activate 返回清理函数 |

`api.call` 直接开放当前已有服务分发器，不再维护插件专属的功能白名单。宿主调用直达核心实现，避免重新进入自身中间件。现有公共类型见 `packages/contracts`，服务方法/参数见 `apps/desktop/host/controller.ts` 与 `native-resources.ts`，插件类型见 `packages/plugins-core/index.ts` 与 `apps/desktop/renderer/plugin-renderer.ts`。尚未实现的工作台能力不会因为有调用入口而变成已实现；内部私有对象不是稳定插件协议。

所有请求现已进入统一可扩展分发链，包括插件自身管理、原生记忆/技能/插件和 CLI 维护；均可调用、包装和替换。`next` 仍至多调用一次。内部回调还可通过下方实际服务接口扩展。核心校验在调用原实现时执行，替换实现由插件负责相应语义；上下文文本不授予模型权限。

## 包格式与使用

设置 → 插件 → 工作台插件 → 导入 ZIP：先打开紧凑的虚线拖放弹窗，再拖入一个 ZIP 或点击选择文件。没有 Codex/Claude 目标选择；这里只安装工作台扩展。取消不安装，同名包不覆盖，成功后默认关闭。含代码的包仍须在启用时确认完整包权限。

`workbench.plugin.json` 保持 API v1 向后兼容，新增可选 `renderer`。导入包不再排除 `translation` 标识；包名本身不会自动接管内置功能，替换通过下面的请求或服务 API 明确注册：

```json
{
  "schemaVersion": 1,
  "apiVersion": 1,
  "id": "personal.workspace",
  "name": "我的工作台",
  "version": "1.0.0",
  "description": "自定义工作流程和完整界面",
  "capabilities": ["host"],
  "main": "main.mjs",
  "renderer": "renderer.mjs"
}
```

[文档导航](README.md) · [开发指南](18-development-and-dependencies.md)

两种代码入口都需要 `host` 能力声明与用户对**完整包当前哈希**的批准。仅导入不会执行；renderer-only 插件也不能绕过批准。文件修改会撤销旧包的启用资格。内置翻译的包标识不允许被同名 ZIP 冒用；其功能实现可通过服务/方法接口替换。

宿主 `main.mjs` 导出 `activate(api)`，可使用 Node 能力。界面 `renderer.mjs` 导出 `activate(api)`，应构建为不超过 2 MiB 的**单个、自包含 ESM bundle**：把依赖、图片和字体打包/内嵌；相对 module imports 不受此版本支持。采用 Blob 模块加载已批准的本地内容，未开启 `eval`、Node renderer 集成、远程脚本、iframe 或 webview。CSP 开放 Blob script 仅服务于此加载机制，不表示界面代码获得 Node 沙箱逃逸能力；完整宿主代码本来就是显式信任的本机代码。

renderer 可以在 `api.root` 中构建自己的面板，添加布局、字体、颜色等任意 CSS，或调用 `replaceShell()` 接管主界面。基础 React 界面保留挂载，只在替换入口成功后隐藏；不通过销毁原有 DOM 实现替换。多个完整界面提供者按启用加载顺序以最后一个可用者显示。主题/面板可通过 DOM 自行组合；不要假定多个完整替换界面可以同时展示。

通过 API 注册的样式、监听与界面根节点在停用、版本变化或激活失败时清理。异步入口接收 `AbortSignal`；入口失效后调用 API 会拒绝，延迟返回的清理函数仍会执行。任意自行创建的计时器、全局监听、React root 等由插件在 `onDispose` 中释放。宿主服务在入口激活前就绪；不要在 `activate` 中等待自身启停等生命周期操作。

完整可导入示例见 `examples/plugins/shell-workspace`，包含宿主统计命令、状态订阅、整个界面替换与返回按钮。将目录内容打包成 ZIP 后，从“工作台插件”导入并批准即可。它不执行模型任务，不包含凭据。已有 `reading-theme` 和 `host-extension` 示例继续兼容。

## 恢复与已知边界

- 原生“帮助 → 停用工作台插件并恢复界面”以及 **Ctrl + Alt + Shift + P** 直接由 Electron 主进程处理，停用所有工作台 ZIP 插件、保存状态并重载基础界面，不经过插件中间件。
- 启动失败的 renderer 会撤销已登记的样式、监听和界面替换，并停用该包以释放宿主扩展；同一失败版本不自动重复执行。重新启用或新批准版本可再试。
- 全信任宿主代码可以访问 Node/Electron，不能把上述清理/恢复机制宣传为抵御恶意代码的安全沙箱。恶意代码、主线程死循环或不合作的清理函数仍可能要求结束进程；恢复入口是正常插件生命周期的保障。
- 本机扩展权限不会授权自动修改 VPS、其他设备、原生账号或绕过模型任务的既有授权流程。原生运行时插件的代码不会载入这个扩展宿主。

接口回归在 `tests/plugin-api.test.ts`；真实隔离 Electron 验证在 `scripts/plugin-ui-checks.mjs`，由 `scripts/test-native-resources-ui.mjs` 执行。测试证明本地调用与界面生命周期，不代替真实模型、远端执行或第三方插件兼容性验收。

## 聊天目录、公开历史与来源标记（2026-09-28 JST）

| 功能 | 开发入口 | 参数与返回 | 覆盖与权限 |
| --- | --- | --- | --- |
| 聊天检索 | `api.call('session/catalog', {sourceSessionId, options})` | `options` 支持 `query`、`includeArchived`、`includeCurrent`、`limit`、`cursor`；返回 `{sessions, nextCursor, note}` | 同 owner、当前可解析的工作台身份；只读，不启动模型 |
| 公开历史 | `api.call('session/public-history', {sourceSessionId, options})` | `options` 必须含 `sessionId`，可含 `beforeMessageId`、`limit`、`maxTextCharacters`；返回 `{session, messages, nextBeforeMessageId, note, scope}` | 只返回公开用户/助手消息，正文截断明确；不读原生私有库、隐藏思考或草稿修订 |
| 来源阅读界面 | `api.onState(listener)` / `api.call('state/get')` 的 `collaboration.messages` | 新增可选 `fromTitle`、`toTitle`、`fromModel`；旧ID、runtime、投递状态不变 | 标记由宿主在发送时生成，旧记录兼容；改名/删除后保留快照。可通过 renderer 入口替换展示 |

模型通过 `workbench_list_sessions` / `workbench_read_session` 使用相同投影，来源ID由原生绑定提供，不能作为模型参数伪造。可信插件显式传入 `sourceSessionId` 代表其选中的工作台会话；服务仍逐次检查同owner。参数越界、失效游标、不可用会话和controller已关闭均拒绝；查询不改状态，不发事件或开启回合。插件监听既有 `state` 更新刷新界面，并在停用时清理监听。`delivered`仅指原生输入回执，不代表模型已读。

兼容性：列表扩充字段并增加分页；收件箱 `workbench_read_messages` 保持原语义，不改成读取聊天历史。快照字段均可选，无历史迁移写入。完整类型、默认值、英文模型契约、调用示例和传输边界见 [聊天工具说明](chat-tools-20260928.md)。验证入口：`tests/chat-tools.test.ts`、`scripts/test-native-chat-tools.mjs`、`scripts/test-chat-tools-ui.mjs`。该覆盖不包括扫描独立客户端聊天库或新的远端部署。

## 全功能扩展与服务替换（2026-09-27 UTC）

**工作台全部功能向经批准的宿主插件开放开发接口。** 插件可调用、包装或替换已有实现，也可注册新方法/服务、扩展原生工具引导、添加局部界面或替换整个界面。这里已经移除原生资源及 CLI 维护命名空间的中间件排除分支；不再因功能属于基座而禁止替换。

| 功能面 | 调用或新增 | 既有实现的扩展与替换 |
| --- | --- | --- |
| 全部宿主请求 | `call`、`invoke`、`registerMethod` | `useHost` 或同名 `registerMethod`，包括 `extensions`、`native-memory`、`native-skills`、`native-plugins`、`local-cli` |
| 状态、项目、会话、权限、提问、附件和文件 | 现有方法、`workbench.state`、`workbench.controller` | 请求替换或对应服务的 `override` / `intercept` |
| 翻译、提交、取消和恢复 | `translation`、`submission.*`、`interactions` | 实际实例的方法包装/替换，内部调用同样可接入 |
| 模型来源与运行实现 | `model.connections`、`runtime.api`、`runtime.native-provider`、`runtime.codex` | 实例方法包装/替换；新增实现可注册服务/请求并组合自有界面 |
| 原生工具与协作 | `collaboration`、控制器 `nativePeerTools` / `nativePeerMcpSession` | 包装绑定来源的工具集合、定义和调用处理器 |
| 记忆、技能、原生插件与本机 CLI | `native.*` 和原有全部资源方法 | 请求处理与实际服务实现均可替换 |
| SSH、空间、账号、额度、远端 CLI/浏览器 | 原有方法、`accounts.catalog`、`workbench.actions`、`actions.*` | 请求/服务包装、替换及新工作流 |
| 阅读、配色、设置、导航及整个界面 | renderer API、完整 preload 桥 | `addStyle`、`mountSurface`、`replaceShell` |
| 窗口、菜单、托盘、剪贴板、文件对话框和协议 | `desktop.*`、宿主 Node/Electron API | 服务包装、替换和原生事件 |
| 插件自身管理 | `extensions` 服务及 `extensions/*` | 普通管理调用同样可替换；原生菜单仍保留独立核心停用兜底 |

替换者需要维持调用方要求的参数、结果、取消和身份语义，或同时提供新的调用方/界面。通过 `api.runtimes.register` 注册的 `plugin:*` 运行时自动接入原有选择器、模型目录及会话执行路径；只注册普通服务不会被误当成运行时。目录、选择和提交入口仍允许插件组合替换。所有功能面有接线，不表示所有第三方插件组合、CLI 版本或远端部署均已验收。

### 宿主新增 API

类型源：[PluginApi 与注册表](../packages/plugins-core/index.ts)、[PluginServices](../packages/plugins-core/services.ts)。这些是 API v1 的增量扩展；兼容旧工作台的插件应探测 `api.services`、`api.registerMethod` 等成员。API v1 不自动保证内部服务参数跨版本永久不变。

| 入口 | 参数、返回与语义 |
| --- | --- |
| `call<T>(method, payload?)` | `Promise<T>`；保留原 v1 的直达核心语义，跳过请求中间件与 `registerMethod`。若底层实例已被服务覆盖，则调用该实例的当前方法 |
| `invoke<T>(method, payload?)` | `Promise<T>`；经过完整插件链，包含新增及替换的方法。不应在同名处理器内递归调用自身 |
| `registerMethod(method, handler)` | `handler(payload)` 返回值或 Promise；注册新路由或替换已有路由，返回取消函数。同插件重复名拒绝，多插件同名以最后激活者为准 |
| `services` | 服务发现、调用、注册、成员替换和方法包装，见下表 |
| `emit(topic, payload?)` | `void`；发出 `{type:'plugin', id, topic, payload}`，进入宿主和 renderer 事件订阅。载荷需可结构化克隆，主题为非空字符串且不超过 120 字符 |
| `onEvent(handler)` | 返回取消函数；现有 `state` 事件继续兼容，同时接收自定义插件事件，各观察者获得独立副本 |

方法名最多 100 字符，新方法使用小写字母、数字、`.`、`/`、`-`。请求顺序是激活顺序的中间件 → 最后注册的同名方法 → 核心分发；每层 `next` 至多调用一次。renderer 的 `call` 经 IPC 进入完整插件链，与宿主直达核心的同名方法语义有区别。

### 实际服务接口

| API | 参数与返回 | 行为 |
| --- | --- | --- |
| `services.list()` | `{id, members}[]` | 仅发现当前对象的成员名，不返回数据/凭据，不执行 getter |
| `services.get<T>(id)` | 实际对象引用 `T` | 不可用时抛错；按相应类型/源码调用成员 |
| `services.register(id, service)` | 唯一 ID 与对象 → 取消函数 | 新增实现供其他宿主插件发现调用；重复 ID 拒绝 |
| `services.override(id, members)` | 成员名到值/函数的对象 → 取消函数 | 替换或增加实际实例成员，既有引用也生效；多成员安装失败时撤销已安装部分 |
| `services.intercept(id, member, handler)` | `(next, ...args) => result` → 取消函数 | 包装实际方法，`next(...args)` 保留原调用的 `this`，支持同步和异步结果 |

覆盖层支持任意停用顺序，清理后重新组合剩余层，最后恢复原属性描述符或原型方法。注册表以外的独立修改不会被盲目覆盖。不可配置的原生属性、无效成员、非函数拦截及外部并发变更会报错；对象原型操作不是该 API 的用途。

服务由 [控制器](../apps/desktop/host/controller.ts) 的 `developmentServices()` 和 [主进程](../apps/desktop/host/main.ts) 装配：

- 状态与控制：`workbench.controller`、`workbench.state`、`workbench.store`、`workbench.secrets`、`workbench.actions`。常规状态读取用 `workbench.state.get()`，修改用 `update(mutator)`，复用保存与状态通知。
- 执行与工作流：`model.connections`、`runtime.api`、`runtime.native-provider`、`runtime.codex`、`translation`、`interactions`、`collaboration`、`submission.gate`、`submission.leases`、`submission.ledger`、`accounts.catalog`。
- 原生资源：`native.resources`、`native.memory`、`native.memory-controls`、`native.skills`、`native.plugins`、`native.cli`、`extensions`；兼容资料为 `legacy.memory`、`legacy.skills`。
- 平台：`desktop.app`、`desktop.window`、`desktop.menu`、`desktop.tray`、`desktop.clipboard`、`desktop.dialog`、`desktop.shell`、`desktop.theme`、`desktop.protocol`、`desktop.session`、`files.html-preview`。
- 宿主对象型依赖以 `actions.<kebab-case-name>` 自动登记，包括工作空间、SSH 接入、原生账号、额度、附件、文件和远端 CLI/浏览器；函数型动作在 `workbench.actions` 上操作。可选服务未装配时不出现在目录，不返回伪对象。

对象引用仅供已批准的宿主代码；renderer 通过 `extensions/services` 读取无数据的服务目录，通过自己的宿主命令执行实际操作。服务接口包括存储和凭据能力，插件必须遵守明确授权，不向界面、日志或模型泄露原值。核心验证在实际调用它时执行；插件替换核心实现后，应对自定义实现的校验负责。接口开放不会额外授予 OS 管理员、其他租户或其他设备权限。

```js
export function activate(api) {
  let calls = 0;
  api.services.intercept('native.cli', 'list', (next, ...args) => {
    calls++;
    return next(...args);
  });
  api.registerMethod('personal/statistics', () => ({ calls }));
  api.registerMethod('demo.sample/get', () => ({
    input: '插件提供的离线示例',
    translated: 'An offline sample supplied by a plugin.'
  }));
}
```

原生工具可包装 `workbench.controller.nativePeerTools(sessionId)`：保留 `sourceSessionId` 和原定义/处理器，追加 `definitions` 并处理自己的工具名。Codex 动态工具和 Claude `nativePeerMcpSession` 使用同一引导集合；完整示例见 [developer-api/main.mjs](../examples/plugins/developer-api/main.mjs)。已有连接的工具集合遵循原生生命周期，不自动开模型回合或强制热重载现有会话。

### 局部界面与完整桥接

类型源：[renderer API](../apps/desktop/renderer/plugin-renderer.ts)、[挂载实现](../apps/desktop/renderer/plugin-surfaces.ts)、[preload 契约](../packages/contracts/index.ts)。

| 新入口 | 参数与返回 |
| --- | --- |
| `workbench` | 带入口生命周期检查的完整 preload 桥，含附件和 ZIP/SSH 文件拖放、调用与订阅 |
| `surfaces` | 已命名界面位置到选择器的只读映射 |
| `mountSurface(target, placement?)` | 命名位置或 CSS 选择器；`before`、`after`（默认）、`replace`；返回 `{root, dispose}` |
| `onEvent(listener)` | 订阅宿主自定义事件，返回取消函数；按插件 `id` 与 `topic` 过滤 |

内置位置为 `shell`、`titlebar`、`sidebar`、`main`、`workspace`、`workspace-header`、`conversation`、`composer`、`settings`。其它界面位置可用 CSS 选择器，不按功能设白名单；自定义选择器需测试目标版本 DOM。

内容挂在目标的兄弟节点，不重建 React 的子树；目标延迟出现或重建后自动重定位。替换保留原节点及可见性，同位置最后挂载者显示，清理后恢复剩余提供者。原应用保留但隐藏的视图继续遵循其可见性。

```js
export function activate(api) {
  const panel = api.mountSurface('workspace-header', 'after');
  const button = document.createElement('button');
  button.textContent = '读取插件统计';
  button.onclick = async () => {
    const result = await api.call('personal/statistics');
    button.textContent = `已调用 ${result.calls} 次`;
  };
  panel.root.append(button);
  api.onDispose(() => { button.onclick = null; });
}
```

### 清理、兼容性与验证

方法、服务、覆盖层、监听和挂载都随正常停用、包变化或激活失败清理。renderer 激活失败还会停用整个包并释放宿主扩展。API 失效后拒绝新注册；插件自行保存的原对象引用、计时器、进程和外部资源仍由插件负责。已经完成的文件写入、网络请求、模型任务或数据迁移不会自动回滚。

核心停用兜底不经过可替换的普通请求链；这是合作式恢复，不是抵抗恶意 Node 代码的安全沙箱。接口类型/服务签名变更须在同一变更中更新本页、示例和验证，不能仅记录缺口而停止补齐接口。

可导入示例：[developer-api](../examples/plugins/developer-api/workbench.plugin.json)。覆盖实际原生服务包装、已有请求替换、新方法/服务、原生工具引导、局部界面和事件；不主动执行安装或模型任务。

验证入口：`tests/plugin-api.test.ts`、`tests/plugin-services.test.ts`、`tests/plugin-bootstrap.test.ts`；真实隔离 Electron 的 `scripts/test-native-resources-ui.mjs` 同时执行 `plugin-ui-checks.mjs` 与 `plugin-development-ui-checks.mjs`。验证范围与结果见文档 16，不以此替代真实模型、VPS 或任意第三方插件验收。

## 核心宿主方法目录

以下名称来自当前分发代码，整个目录可通过 `registerMethod` 替换。参数/返回以对应校验、类型和功能专题为准；这份目录用于维护而不是运行白名单。

- [控制器](../apps/desktop/host/controller.ts)：状态、项目、会话、翻译、交互、文件、SSH、账号和空间。
- [原生资源](../apps/desktop/host/native-resources.ts)：记忆、技能、原生插件、CLI 与工作台扩展。
- [模型连接](../apps/desktop/host/model-connections.ts)：模型来源、发现、修订与保存。
- [主进程](../apps/desktop/host/main.ts)：原生菜单、应用信息和 HTML 预览。

常用载荷：`state/get` 无参数返回 `AppState`；`theme/set` 接收 `{theme:'light'|'dark'|'system'}` 返回更新状态；`extensions/services` 无参数返回服务目录；`extensions/command` 接收 `{id,name,payload}` 返回命令结果；`native-memory/write` 接收 `{id,revision,content}` 并拒绝修订冲突；`local-cli/check` 接收 `{runtime:'codex'|'claude',installMethod?:'native'|'npm'}` 返回版本检查结果。旧兼容写入可能被核心默认拒绝，插件可提供自己的替换实现，不据目录存在宣称旧实现可用。

`npm run check:docs` 对照 TypeScript AST 检查目录遗漏和过期项。新增功能同时补充参数、返回、错误、事件、生命周期及示例。

<!-- host-methods:start -->

- `annotations/get`
- `annotations/translate`
- `annotations/update`

- `branding/get`
- `branding/list`

`files/resolve` — 定位短引用并返回完整路径或可选候选；契约、权限和生命周期见文件链接解析章节。

外观入口：`appearance/get`、`appearance/set`、`appearance/fonts`。

插件恢复入口：`plugin-recovery/status`、`plugin-recovery/show`、`plugin-recovery/repair`、`plugin-recovery/pulse`、`plugin-recovery/core-ready`、`plugin-recovery/core-failed`、`plugin-recovery/renderer-start`、`plugin-recovery/renderer-ready`、`plugin-recovery/renderer-failed`、`plugin-recovery/ui-language`、`plugin-recovery/repair-draft`、`plugin-recovery/repair-draft/ack`。

会话用量只读入口：`session/metrics`。

| 命名空间 | 当前宿主方法 |
| --- | --- |
| `accounts` | `accounts/rename`、`accounts/assign`、`accounts/enroll-legacy`、`accounts/list`、`accounts/reset-preview`、`accounts/reset-redeem`、`accounts/select`、`accounts/setup-apply`、`accounts/setup-plan`、`accounts/usage` |
| `attachments` | `attachments/image`、`attachments/import`、`attachments/pick`、`attachments/views`、`attachments/cleanup`、`attachments/open-storage`、`attachments/reveal`、`attachments/save-as`、`attachments/storage`、`attachments/copy-image`、`attachments/open`、`attachments/activity-images` |
| `capabilities` | `capabilities/get` |
| `child-message` | `child-message/translate` |
| `clipboard` | `clipboard/write` |
| `codex-auth` | `codex-auth/account`、`codex-auth/cancel`、`codex-auth/current`、`codex-auth/open`、`codex-auth/start`、`codex-auth/status` |
| `composer` | `composer/catalog`, `composer/execute` |
| `deep-link` | `deep-link/copy` |
| `demo.sample` | `demo.sample/get` |
| `desktop` | `desktop/info`、`desktop/menu`、`desktop/titlebar`、`desktop/data-directory`、`desktop/data-directory/choose`、`desktop/data-directory/migrate`、`desktop/action` |
| `draft` | `draft/cancel`、`draft/prepare`、`draft/refine`、`draft/submit`、`draft/recovery-dismiss` |
| `extensions` | `extensions/asset`、`extensions/appearance`、`extensions/command`、`extensions/disable-all`、`extensions/export`、`extensions/import`、`extensions/list`、`extensions/renderer-failed`、`extensions/renderers`、`extensions/services`、`extensions/storage/read`、`extensions/storage/write`、`extensions/toggle` |
| `follow-up` | `follow-up/cancel`、`follow-up/send` |
| `files` | `files/browse`、`files/copy-content`、`files/info`、`files/open`、`files/reveal`、`files/save-as` |
| `host` | `host/discover`、`host/remove`、`host/save` |
| `html` | `html/preview` |
| `visualizations` | `visualizations/instructions`、`visualizations/read`、`visualizations/render`、`visualizations/release` |
| `interaction` | `interaction/cancel`、`interaction/prepare`、`interaction/presentation`、`interaction/submit`、`interaction/translate` |
| `links` | `links/open` |
| `local-cli` | `local-cli/check`、`local-cli/configure`、`local-cli/install`、`local-cli/install-directory`、`local-cli/list`、`local-cli/uninstall` |
| `memory` | `memory/delete`、`memory/get`、`memory/list`、`memory/save`、`memory/settings` |
| `message` | `message/retranslate` |
| `model-api` | `model-api/context-budget`、`model-api/delete`、`model-api/discover`、`model-api/list`、`model-api/refresh`、`model-api/save`、`model-api/set-enabled`、`model-api/reasoning/cancel`、`model-api/reasoning/options`、`model-api/reasoning/start`、`model-api/reasoning/status` |
| `model-targets` | `model-targets/list` |
| `native-accounts` | `native-accounts/create-claude`、`native-accounts/login-command`、`native-accounts/remove`、`native-accounts/review`、`native-accounts/status` |
| `native-memory` | `native-memory/archive/read`、`native-memory/catalog`、`native-memory/configure`、`native-memory/delete`、`native-memory/process`、`native-memory/get`、`native-memory/list`、`native-memory/read`、`native-memory/settings/get`、`native-memory/settings/write`、`native-memory/sync`、`native-memory/tasks/cancel`、`native-memory/tasks/list`、`native-memory/write` |
| `native-plugins` | `native-plugins/change`、`native-plugins/list` |
| `native-skills` | `native-skills/export`、`native-skills/import`、`native-skills/links/apply`、`native-skills/links/plan`、`native-skills/list`、`native-skills/read`、`native-skills/toggle` |
| `navigation` | `navigation/get`、`navigation/view`、`navigation/open` |
| `path` | `path/open` |
| `permissions` | `permissions/remember` |
| `plan` | `plan/translate` |
| `plugins` | `plugins/list`、`plugins/set-enabled` |
| `project` | `project/archive-sessions`、`project/create`、`project/pick`、`project/pick-many`、`project/remove`、`project/reorder`、`project/undo`、`project/update` |
| `remote-browser` | `remote-browser/cancel`、`remote-browser/code`、`remote-browser/create`、`remote-browser/delete`、`remote-browser/open`、`remote-browser/profiles`、`remote-browser/rename`、`remote-browser/setup-apply`、`remote-browser/setup-plan`、`remote-browser/start`、`remote-browser/status`、`remote-browser/launch`、`remote-browser/reconnect`、`remote-browser/stop` |
| `remote-cli` | `remote-cli/apply`、`remote-cli/list`、`remote-cli/plan`、`remote-cli/configure` |
| `remote-resources` | `remote-resources/read`、`remote-resources/configure`、`remote-resources/reclaim` |
| `remote-files` | `remote-files/browse`、`remote-files/mutate`、`remote-files/upload`、`remote-files/download` |
| `remote-storage` | `remote-storage/status`、`remote-storage/inspect`、`remote-storage/logs` |
| `runtime` | `runtime/catalog`、`runtime/models`、`runtime/select`、`runtime/choice` |
| `session` | `session/api-budget`、`session/api-acknowledge`、`session/end-wait`、`session/approval`、`session/catalog`、`session/collaboration`、`session/context`、`session/copy`、`session/create`、`session/delete`、`session/fork`、`session/fork-options`、`session/interaction`、`session/interaction/open-url`、`session/memory-handoff/read`、`session/migrate-native`、`session/migration-manifest`、`session/model`、`session/model-target`、`session/move-project`、`session/native-title/refresh`、`session/open-workspace`、`session/permissions`、`session/preview`、`session/plan`、`session/plan/respond`、`session/public-history`、`session/reconcile`、`session/reorder`、`session/skills`、`session/skills/read`、`session/stop`、`session/update` |
| `sidebar` | `sidebar/collapse-all`、`sidebar/project-visibility` |
| `skills` | `skills/delete`、`skills/import`、`skills/list`、`skills/read` |
| `ssh` | `ssh/import-file`、`ssh/install-key`、`ssh/pick-file`、`ssh/scan-host-key`、`ssh/trust-host-key`、`ssh/verify` |
| `shortcuts` | `shortcuts/get`、`shortcuts/set` |
| `state` | `state/get` |
| `studio` | `studio/apply`、`studio/connect`、`studio/export-connection`、`studio/export-managed`、`studio/import`、`studio/import-preview`、`studio/invite-export`、`studio/list`、`studio/operation`、`studio/plan`、`studio/prepare` |
| `theme` | `theme/set` |
| `translation` | `translation/auto-submit`、`translation/candidates`、`translation/intermediate`、`translation/layout`、`translation/models`、`translation/quick-toggle`、`translation/seamless`、`translation/settings`、`translation/targets`、`translation/usage` |
| `workspace` | `workspace/select` |
| `worktrees` | `worktrees/configure`、`worktrees/list`、`worktrees/open`、`worktrees/cleanup`、`worktrees/restore` |

| `models` | `models/accounts/prepare`、`models/accounts/draft-discard`、`models/accounts/rename`、`models/accounts/login-methods`、`models/accounts/login-callback`、`models/accounts/import-formats`、`models/accounts/import`、`models/accounts/list`、`models/accounts/create`、`models/accounts/set-enabled`、`models/accounts/remove`、`models/accounts/refresh`、`models/accounts/login-start`、`models/accounts/login-status`、`models/accounts/login-cancel`、`models/accounts/login-open`、`models/accounts/login-code`、`models/accounts/reset-preview`、`models/accounts/reset-redeem`、`models/accounts/reset-status`、`models/usage`、`models/pricing/save` |


- `models/accounts/export-formats`
- `models/accounts/export-preview`
- `models/accounts/export-copy`
- `models/accounts/export-save`
- `ui-preferences/get`
- `ui-preferences/update`
- `ui-preferences/flush-ready`
- `remote-configuration/list`
- `remote-configuration/plan`
- `remote-configuration/apply`
- `remote-configuration/configure`
- `session/prepare-runtime`
- `native-accounts/prepare-claude`
- `native-accounts/discard-claude`
- `accounts/set-enabled`
- `desktop-updates/status`
- `desktop-updates/check`
- `desktop-updates/install`
<!-- host-methods:end -->


## 输入菜单、技能选择与记忆交接读取（2026-09-28 JST）

| 功能 | 入口和参数 | 返回与边界 |
| --- | --- | --- |
| 输入菜单目录 | api.call('composer/catalog', {sessionId})；新草稿使用 {runtime, projectPath?} | {runtime, scope, commands, skills, nativeDiscovery}。已有会话从宿主绑定读取运行时、目录和模型目标；可选 runtime/scope 用于检测过期请求，不可替代宿主身份。commands 为受支持 UI 动作描述；skills 为当前运行时、项目范围和可调用状态筛选后的元数据及可选安全图标；读取不启动模型，不向提示注入目录。 |
| 显式技能调用 | api.call('draft/prepare', {sessionId, text, skills:[{id,hash}], ...existingOptions}) | 原有 DraftPreview 增加可选 skills。Codex 最多 6 项，Claude 每次一个原生斜杠技能（再次选择替换当前项）；宿主解析并在提交前重新核验身份、版本、启用状态与范围。实际发送文字由已核验原生命令前缀和翻译后正文组成，只有正文进入翻译器。Codex 附带原生 skill 输入，Claude 使用原生斜杠调用，不复制技能正文或执行动态插值。 |
| 原生批次读取 | api.call('session/memory-handoff/read', {sessionId, query:{archiveId?,offset?,limit?}}) | 无 archiveId 返回当前活动批次及回执位置；有 ID 返回 content、sourceHash、offset、totalCharacters、nextOffset。limit 默认 12000，最大 24000 字符；仅本会话、本运行时本轮已发放的档案。原生模型使用宿主绑定身份的 workbench_read_memory_handoff 工具。 |
| 交接状态 | api.call('native-memory/get') | 向后兼容新增 activeCodex/activeClaude 当前已发放数量；不等于落盘成功。最近完成时间仍须文件及索引回执核验。 |

菜单类型和查询语义公开于 packages/composer-core/index.ts，技能调用类型位于 packages/native-skills/invocation.ts。可信宿主插件可通过 useHost 中间件替换 composer/catalog 返回的目录，renderer 插件可使用既有界面扩展入口替换呈现；不能通过新增 UI 标签绕过 draft/prepare/submit 的宿主复核。commands 的 action 支持 attachments、files、skills、settings、status、plan、model、permissions、native；plan 仅 Claude，settings 的 target 为受支持的设置页。native 动作通过 composer/execute 派发，核心只接受 compact；扩展命令须提供配套宿主处理器，不将未知动作作为普通模型输入发送。

生命周期：菜单打开时重读目录；运行时/项目变化立即丢弃旧目录与选中技能，保留输入中的斜杠查询并加载新目录。模型目标变化同样失效旧目录。预览沿用原有取消/提交门禁。编辑、停用翻译和修订仍使旧预览失效。用户原稿和 Message.skills 分开保存，编辑重发与分支恢复选择，旧记录无需迁移。后台仅采集记忆；当前明确任务发放有限批次，结束、停用或权限/接收设置变化后读取入口失效，不额外启动模型。档案文本为参考数据，不能覆盖用户任务或赋予更多权限。错误使用 SKILL_SELECTION_INVALID、SKILL_SELECTION_LIMIT、SKILL_SELECTION_STALE、MEMORY_HANDOFF_INACTIVE、MEMORY_HANDOFF_ARCHIVE_NOT_ISSUED、MEMORY_HANDOFF_ARCHIVE_CHANGED；失败不提交旧选择、不伪造交接成功。

示例：先用 composer/catalog 读取技能元数据，取返回项的 id/hash 传入 draft/prepare；展示返回的 original 和 translated，经用户现有确认流程调用 draft/submit。不要把完整目录拼进 text。记忆读取例：先调用 session/memory-handoff/read 查询活动批次，再以其中的 archiveId 分页读取；写入仍使用已获准的原生文件工具，宿主验证回执后才完成。

覆盖矩阵补充：输入菜单/技能标签（目录、原生派发、预览生命周期）、记忆交接（会话受限读取、状态、原生回执）均已有调用入口及可替换目录/界面。验证：tests/composer-memory.test.ts、tests/memory-handoff.test.ts、scripts/test-composer-memory-ui.mjs。界面和合成上游证据不能替代真实模型的英文整理质量和未来召回。

## 运行时命令与同会话目录刷新（2026-09-28 JST）

### 功能覆盖矩阵

| 功能 | 稳定入口 / 扩展点 | 验证位置 |
| --- | --- | --- |
| 运行时命令与技能目录 | composer/catalog、ComposerCommand、composerScopeKey；useHost 可扩展/替换返回值 | tests/composer-runtime.test.ts、tests/composer-memory.test.ts |
| 显式原生压缩 | composer/execute；runtime.native-provider.compact / assertCompactAllowed | scripts/test-native-commands.mjs、scripts/test-composer-runtime-ui.mjs |
| 同会话切换、迟到响应保护 | composer/catalog scope；data-testid=composer-menu、data-command；既有界面扩展点 | scripts/test-composer-runtime-ui.mjs、scripts/test-composer-races-ui.mjs |
| 插件扩展与停用恢复 | useHost 对 composer/catalog 和 composer/execute 的成对中间件 | tests/composer-runtime.test.ts |

**目录。** composer/catalog 接收 {sessionId?, runtime?, projectPath?, targetId?, scope?}。已有会话以宿主当前绑定为准；新草稿须给 runtime。返回 {runtime,scope,commands,skills,nativeDiscovery}。scope 是 composerScopeKey({sessionId?,runtime,directory?,targetId?}) 生成的不透明字符串，公开类型位于 packages/composer-core/commands.ts。它是过期检测标记，不是授权令牌；不含密钥。扫描结束再次核验当前会话，错配报 COMPOSER_SCOPE_CHANGED。未知运行时报 COMPOSER_RUNTIME_INVALID；注册式运行时使用当前注册表并保留 RUNTIME_* 错误，不把它们当成 Codex/Claude，也不扫描两家的技能。

ComposerCommand 保留 id/label/description/icon/action/target，增量字段 source（runtime/workbench）、runtime、aliases、disabledReason。运行时能力和工作台入口分组呈现，命令显示 /id，别名参与检索。当前原生接入包含 compact、model、permissions（Codex 别名 approvals）、context、skills，Claude 另有 plan。模型/权限打开真实已有控制，上下文读取当前容量与原生回执。此目录是当前工作台执行通道支持集，不宣称覆盖全部 CLI/TUI 命令。无手动压缩执行通道时保留不可用原因，不能把 /compact 当普通提示词发送。SSH 原有准入边界不放宽；当前远端桥未接入手动压缩。

**执行。** composer/execute({sessionId,scope,commandId:'compact'}) 返回 {started:true,runtime}，只表示已开始，完成以 state 事件中该会话 nativeTurnStatus/status 和原生过程记录为准。宿主重新检查 scope、当前绑定、CLI 维护、模型来源、归档、忙碌/未知状态、预览与会话操作锁。仅本机 Codex/Claude 的既有模型连接路径可用；必须已有原生会话且没有尚未交付的跨目标历史。错误含 COMPOSER_COMMAND_UNSUPPORTED、COMPOSER_COMMAND_UNAVAILABLE、NATIVE_COMPACT_HISTORY_NOT_READY、NATIVE_COMPACT_BUSY，以及既有模型来源/准入错误；失败不重试或自动开启替代任务。

Codex 使用 thread/compact/start，Claude 使用原生 stream-json 的单独 /compact 输入；不追加工作台上下文、技能前缀或交接指引，不调用外层总结循环。该显式操作可能产生上游模型用量，保留当前原生权限与模型。记录一个用户命令及原生压缩过程，允许 session/stop 沿用现有停止边界；传输后无法确认的结果仍标未知。Claude 在提供 post_tokens 回执时更新上下文使用量，不猜测缺失值。UI 清空的只有命令查询，其他草稿文字保留。

**事件和兼容。** 沿用 state、扩展变更、窗口 focus 和 local-cli-changed 通知；没有新增后台模型任务。仅菜单打开时订阅并合并目录刷新，关闭时释放监听与计时器。运行时/会话/目录/目标变化隔离目录，请求代次同时保护成功、失败和收尾；加载期间旧行不可执行。旧的 catalog 调用无需新增参数，旧命令对象仍可显示；新调用方应传 scope 并使用返回的 scope 执行。无需迁移既有会话历史或原生文件。

```js
const catalog = await api.call('composer/catalog', { sessionId });
const command = catalog.commands.find(item => item.id === 'compact');
// Run only after the user's explicit selection, never on catalog discovery.
if (command && !command.disabledReason) {
  await api.call('composer/execute', {
    sessionId, scope: catalog.scope, commandId: command.id
  });
}
```

**扩展与恢复。** 已按完整包批准的插件可用 useHost 中间件向 catalog 添加 namespaced id 和 action:'native'，并处理 composer/execute 的该 id；必须重新核验 scope、权限和自己的生命周期，未处理项目调用 next()。可通过既有方法替换和运行时服务包装替换核心实现，无需改核心源码。注册式运行时基础目录仅包含它声明的模型/权限控制；额外能力由插件实现。停用、失败或批准撤销释放中间件/界面，恢复核心目录与未知命令拒绝；不删除原生历史或自动重放命令。已验证新增目录、配套执行、过期拒绝及停用恢复，不把全信任插件视作其他设备或账号的授权。

## 预览确认与工作树聊天分叉（2026-09-28 JST）

### 功能覆盖矩阵

| 功能 | 开发入口 | 扩展与替换 | 测试 |
| --- | --- | --- | --- |
| 当前发送/回答预览 | renderer `api.previews.get/subscribe/confirm/edit` | `mountSurface('translation-preview', 'replace')`，通过相同 receipt 确认或返回修改 | `tests/preview-keyboard.test.ts`、`scripts/test-native-interactions-ui.mjs` |
| 两种聊天分叉 | `api.call('session/fork-options', …)`、`api.call('session/fork', …)` | `useHost` 或同名 `registerMethod`；原生历史和 Git 目录是不同对象 | `tests/session-fork.test.ts`、`tests/worktree-forks.test.ts`、`scripts/test-session-fork-ui.mjs` |
| 工作树设置与目录 | `worktrees/list`、`worktrees/configure`、`worktrees/open` | `actions.worktrees` 服务的 `inspect/create/list/configure/validate/abandon` 可通过服务接口包装或替换 | `tests/worktree-forks.test.ts`、`scripts/test-session-fork-ui.mjs` |
| 分叉来源与导航 | `Session.branch`、`Session.worktree`、既有导航接口 | renderer 状态订阅可绘制自己的来源线和父聊天跳转 | 同上 |

### 预览 renderer 契约

`api.previews.get(): PreviewView | null` 返回当前最上层预览的副本：`{id, kind:'draft'|'answer', title, content:string[], canConfirm:boolean, canEdit:boolean}`。`subscribe(listener)` 立即通知当前值，之后在打开、更新、忙碌和关闭时通知；返回清理函数，插件停用时自动移除监听。正文保留原稿及实际提交文本，不额外调用翻译；隐私回答仅提供遮罩标签，不暴露原值。

`confirm(id): void` 和 `edit(id): void` 使用当前精确 ID；失效或不存在时抛 `PREVIEW_STALE`，当前动作不可用时抛 `PREVIEW_BUSY`（不能确认的旧预览仍可按 `canEdit` 返回修改）。确认经原来的 draft/interaction 宿主门禁，不授予新的模型或设备权限；动作启动后同步锁定，防止连续确认。UI 初始焦点位于确认按钮；无修饰 Enter 确认，重复按键、IME 确认及带修饰键的 Enter 不发送，Escape/返回修改保留原稿并取消旧预览。翻译模块关闭时不登记翻译预览。

界面替换可注册到稳定的 `translation-preview` surface；替换者必须通过当前 ID 调用上述动作，并在预览更新时重新绘制。停用后 surface 恢复原界面；旧插件缺省不注册，保持原有行为。

```js
export function activate(api) {
  const panel = api.mountSurface('translation-preview', 'after');
  api.previews.subscribe(view => {
    panel.root.replaceChildren();
    if (!view) return;
    const button = document.createElement('button');
    button.textContent = '确认发送';
    button.disabled = !view.canConfirm;
    button.onclick = () => api.previews.confirm(view.id);
    panel.root.append(button);
  });
}
```

### 分叉与 Git 契约

- `session/fork-options({sessionId, messageId?})` 返回 `{busy,workspace,worktree}`；每项有 `available`、可选 `reason`。工作树项另含可解析时的 `repositoryRoot/cwd/head/branch/dirty/untrackedFiles`。仅检查本机指定会话目录，不创建 checkout 或启动模型。
- `session/fork({sessionId,messageId?,location?:'workspace'|'worktree'})` 返回新 `Session`。省略 location 兼容旧调用，仍共享原目录；worktree 显式创建独立 Git checkout，从当前 HEAD 复制已跟踪的暂存/未暂存修改及未忽略的普通文件。消息边界只决定聊天历史，不回滚文件到历史时刻。忽略文件不复制，也不运行仓库 hooks、fetch、提交或远端部署。
- 新 `branch` 可选字段：`location/titleBase/number/inheritedMessageCount`；编号在写入会话时分配，格式为原名 `(1)`、`(2)`。保留 `sourceSessionId/sourceMessageId/sourceTitle`；来源线放在继承历史之后。源聊天删除后仍保留分支和来源标题，但来源跳转不可用。历史字段缺省可读，不迁移改写旧标题。
- `Session.worktree?: WorktreeRecord` 含 `id/path/cwd/sourceDirectory/repositoryRoot/head/createdAt/status/copiedTrackedChanges/copiedUntrackedFiles`。原生运行时在后续明确发送时使用新 cwd；创建分支本身不启动模型。Codex 使用原生 thread/fork 精确回合边界和独立 thread ID，不以复制公开文本替代原生历史；Claude 本机模型 API 连接使用本页后续修订的原生消息边界分支，SSH Claude 未验收路径仍拒绝。
- `worktrees/list({})` 返回 `{root,defaultRoot,records}`。`worktrees/configure({root?:string})` 返回相同类型；空值恢复默认根目录，只影响未来创建。`worktrees/open({id})` 返回 `{opened:true}`，只打开已登记且仍存在的本机目录。
- 宿主服务 `actions.worktrees` 的签名为 `inspect(directory:string):Promise<WorktreeInspection>`、`create(sourceDirectory:string):Promise<WorktreeRecord>`、`list():Promise<{root,defaultRoot,records}>`、`configure(root?:string):Promise<{root,defaultRoot,records}>`、`validate(record:WorktreeRecord):Promise<void>`、`abandon(record:WorktreeRecord):Promise<void>`；类型定义见 `packages/worktrees/index.ts`。`inspect` 不可用时返回 `available:false` 与原因；其余失败抛错。`validate` 在分叉和发送前检查已登记目录；`abandon` 仅用于会话创建失败后的清理，不是删除任意用户目录的接口。可通过 `api.services.override('actions.worktrees', {create, inspect, list, configure, validate, abandon})` 替换同契约成员，或 `intercept` 包装；停用插件恢复原成员，已持久化的路径/来源记录须保持可读。
- 权限与事件：已批准插件使用既有本机宿主权限；不获得其他设备、租户或管理员权限。成功分叉触发既有 `state` 事件。设置/目录请求返回回读结果，不启动后台同步或新模型回合；插件需要刷新列表时显式再次调用。
- 错误与清理：非 Git、无提交、合并冲突、子模块、源文件并发变化、未跟踪链接或超出快照限制会拒绝。提交前再次校验托管 checkout，目录缺失时拒绝，不重建空目录。错误码包括 `WORKTREE_UNAVAILABLE/WORKTREE_BUSY/WORKTREE_SOURCE_CHANGED/WORKTREE_COPY_VERIFICATION_FAILED/FORK_LOCATION_INVALID/NATIVE_FORK_BOUNDARY_UNVERIFIED`；原生身份不匹配拒绝继续。创建失败不写入新会话；仅自动移除干净的失败 checkout，已复制或外部新增的修改保留为失败记录，不强制删除。关闭/归档/删除聊天不会删除工作树。
- 生命周期与范围：本地托管 checkout 初始为 detached HEAD，不占用来源分支；旧会话无 worktree 字段时维持原目录。未实现自动清理、快照恢复、Local/Worktree 交接或远端 Git 工作树，不以禁用开关冒充实现。

```js
const options = await api.call('session/fork-options', {sessionId: 'selected-chat'});
if (options.worktree.available) {
  const branch = await api.call('session/fork', {
    sessionId: 'selected-chat', messageId: 'completed-reply', location: 'worktree'
  });
  console.log(branch.title, branch.projectPath);
}
```

## 个人技能目录连接接口（2026-09-28 JST）

### 覆盖矩阵与扩展入口

| 功能 | 接口与类型 | 扩展或替换 | 验证 |
| --- | --- | --- | --- |
| 运行时连接状态、行内双 logo、过滤列表批量操作 | native-skills/list；NativeSkill.connections、SkillOrigin.entryPath | 既有 native-skills 请求中间件或同名 registerMethod；renderer 技能面板 | tests/native-skill-links.test.ts、scripts/test-skill-links-ui.mjs |
| 连接计划与确认执行 | native-skills/links/plan、native-skills/links/apply；SkillLinkRequest/Plan/Result | 同名 registerMethod/useHost 包装与替换；NativeSkillsService.planLinks/applyLinks | 同上，包含宿主参数验证、部分失败、重启与实际 CLI |

公开类型位于 packages/native-skills/links.ts；NativeSkill 与 SkillOrigin 位于 packages/native-skills/index.ts。新增字段为可选增量，旧调用和原生启用开关不变。connections 按 codex/claude 返回 status（connected/missing/conflict/broken/unavailable）、ownership（workbench/external/mixed）、canConnect、canDisconnect、managedCount、externalCount、entryPath、targetPath、reason、revision。只有核实存在且指向当前技能源的目录才是 connected；原生启用、项目覆盖和 CLI 可用性仍读取 control/runtimeAvailability，不由连接状态推断。entryPath 保留原生逻辑入口，directory 仍为解析后的源目录。

### 请求、结果和示例

- native-skills/links/plan：参数 {runtime:'codex'|'claude',action:'connect'|'disconnect',skills:Array<{id,hash}>}。只接受当前扫描中的身份和 SKILL.md 摘要；1–500 项，不接受重复 ID。目标由原生个人目录自动决定，不接受调用方指定源或目标路径。返回 SkillLinkPlan：id、runtime、action、expiresAt、items、counts。每项含 id/name/hash/operation/count/reason；operation 为 create/remove/reuse/skip。counts 为链接操作数，批量源文件或原生设置不会在计划阶段写入。
- native-skills/links/apply：参数 {planId}；返回 SkillLinkResult 与 scan。items 含 id、status（created/removed/reused/skipped/failed）、count 和可选 error。count 对 created/removed 表示已核验链接数；失败项可能已发生 count 次文件系统变更，但登记未完成，不能当作完整成功。失败后其余项以 skipped/count:0/error:SKILL_LINK_BATCH_STOPPED 返回，不自动重试或回滚已完成项。

例：先调用 api.call('native-skills/list')，从用户当前过滤列表选择 skills.map(({id,hash})=>({id,hash}))，调用 api.call('native-skills/links/plan',{runtime:'claude',action:'connect',skills:selection})。向用户展示 plan.counts 和跳过原因，确认后调用 api.call('native-skills/links/apply',{planId:plan.id})，渲染返回的 scan 与逐项结果。单行明确点击可直接计划并执行；批量界面先确认当前范围。不是用户明确选择的行不得悄悄加入批次。

### 错误、权限与生命周期

错误码包括 LOCAL_RUNTIME_REQUIRED、SKILL_LINK_REQUEST_INVALID、SKILL_LINK_SOURCE_CHANGED、SKILL_LINK_PLAN_EXPIRED、SKILL_LINK_PLAN_STALE、SKILL_LINK_ROOT_CHANGED、SKILL_LINK_TARGET_CHANGED、SKILL_LINK_VERIFY_FAILED、SKILL_LINK_LEDGER_INVALID、SKILL_LINK_LEDGER_CHANGED，以及文件系统权限/I/O 错误。目录根断链或不可读显示 unavailable，目标断链显示 broken，同名文件/目录/不同目标显示 conflict；这些条目不覆盖。reason 还可能为 scope、unreadable、overlap、external、missing、shared-entry。renderer 将状态和恢复提示本地化，宿主错误保持英文。

计划只存于进程内，最多保留 64 个、两分钟过期，一次执行即消费，包括失败。执行前重读整批技能摘要、源目录身份、目标条目、原生根和所有权；任一待执行项过期则在写入前拒绝。写入逐项再次核验，不承诺文件系统跨进程事务或抵御同一所有者恶意竞态。发生 I/O 失败停止后续写入，回读目录再生成新计划；不用旧计划盲重试。工作台自己的 native-skill-links.json 只保存创建链接的目标与身份，写入前检查并发变化；重启不会把外部链接认领为自己管理。登记失败留下的链接按外部条目保护。

权限仅为当前设备已配置的用户原生技能目录；需现有 OS 文件权限，不提权、不操作 SSH/其他设备。只连接独立的全局个人技能，不从项目作用域提升技能，不拆插件或官方技能。Windows 使用 junction，其他系统使用目录 symlink；源原有多层链接解析到最终目录后连接。相同目标复用；既有源、CC Switch 配置及外部条目不删除，撤销仅 unlink 身份吻合的受管链接。两家原生根若后来别名到同一个物理入口，拒绝单方撤销，以免同时影响另一运行时。关闭右侧原生开关不删除链接，断开链接也不改原生开关配置。新原生会话自行发现，现有会话不主动重载。

没有额外专属事件：请求返回 scan，列表在操作后、窗口 focus、local-cli-changed 和显式刷新时重读；不轮询全部文件、不自动执行待确认计划。停止/替换界面插件不删除已经建立的链接；失效计划应重新生成。描述使用原生 title 属性显示完整 shortDescription；视觉 ellipsis 不修改属性正文。renderer 标识为 data-testid=skill-connections-toolbar、skill-connections 和行按钮 data-runtime/data-state；可使用现有 mountSurface/replaceShell 扩展呈现。外部管理器自己的数据库开关可能不同步，不能冒充外部管理器设置。


## 动态运行时与任意界面开发（2026-09-28 JST）

这是 API v1 的增量扩展。类型源为 [运行时契约](../packages/runtime-extensions/types.ts)、[注册表](../packages/runtime-extensions/index.ts)、[宿主执行桥](../apps/desktop/host/plugin-runtime.ts) 和 [界面 API](../apps/desktop/renderer/plugin-renderer.ts)。旧插件不受影响；新插件先探测 `api.runtimes`、`api.assetUrl`、`api.listen`。`RuntimeKind` 新增 `plugin:*`；处理运行时的穷举逻辑应读取能力声明，不能把未知值当成 Codex、Claude 或离线示例。

### 覆盖矩阵

| 功能 | 开发接口 | 实际接入和清理 | 验证 |
| --- | --- | --- | --- |
| 新增第三运行时 | `api.runtimes.register(definition, adapter)`、`list()` | 普通运行时选择器、模型目录、权限、发送和历史；停用撤销注册，保留会话 | `tests/runtime-extensions.test.ts` |
| 会话和回合 | `create/run/stop/resume/steer/fork` | 既有预览与提交门、停止、明确恢复及分支；恢复不重放输入 | 同上及 `scripts/test-runtime-studio-ui.mjs` |
| 输出和交互 | `context.emit`、`approval/interaction/permissions` | 既有消息、审批和问题界面；回执消费一次、过期回调拒绝 | 同上 |
| 全局皮肤和背景 | `addStyle(css)`、`assetUrl(path)` | 任意 CSS 选择器、颜色、图片、字体、尺寸与布局；停用移除样式 | 隔离 Electron 渲染检查 |
| 局部与完整界面 | `mountSurface(selector, placement)`、`replaceShell()`、`listen(...)` | 替换控件并接通宿主方法；支持导航重挂载、叠层恢复及整个主界面替换 | 同上及 `scripts/plugin-development-ui-checks.mjs` |

### 注册契约

`api.runtimes.register(definition: RuntimeDefinition, adapter: RuntimeAdapter): () => Promise<void>` 同步注册，返回幂等异步撤销函数。宿主把注册绑定到当前已批准插件；失败激活、停用、包变化或恢复默认界面时自动撤销。运行时 ID 使用 `plugin:` 前缀，后接小写字母开头的字母、数字、点、斜杠或短横线，最多 120 字符；同 ID 冲突拒绝，不静默接管另一个插件。已有内置运行时仍可通过服务 `override/intercept` 或宿主方法接口替换实现。

`RuntimeDefinition` 包含 `apiVersion:1`、`id`、中文展示用 `name/description`、`permissions` 及可选 `models`。权限条目为 `{value,label,description}`，必须声明 `default`；值可以是现有权限或插件自定义的 `plugin:*`，含义和原生映射由适配器负责。运行时之间切换时不能把不支持的受限权限静默升级。模型使用 `NativeModelOption`，包含模型标识、名称、默认项、思考档位、服务档位及可选上下文容量。

- `discover?(): Promise<{ready:boolean,reason?:string,models?:NativeModelOption[]}>`：只探测，不启动任务或安装软件。失败报告不可用，不能回退到另一运行时。
- `create?(session, signal): Promise<JsonValue>`：明确创建会话时初始化非敏感检查点；不启动回合。
- `run(context, preview): Promise<void>`：必须实现。接收已确认的 `DraftPreview`，包括原文、提交文本及附件/技能引用；持续到当前回合完成才 resolve，不可 fire-and-forget。失败进入结果未知状态，没有自动重试或外层继续循环。
- `stop(context): Promise<void>`：必须实现。宿主先取消 `context.signal` 并封闭旧事件，resolve 表示适配器已确认停止；reject 保留结果未知。
- `resume?(context): Promise<void>`：用户明确核对结果时读取检查点、重连或收取既有回合结果，禁止重发上一条输入。不会因打开历史、注册或探测而调用。
- `steer?(context, preview)`：当前回合的原生插入操作；只有实现该方法才显示插入入口。
- `fork?(source, destination, signal): Promise<JsonValue>`：明确分支时为目标会话生成独立检查点；目标含选定历史前缀和实际工作目录。未实现时明确不支持，不能复制原生线程标识冒充独立分支。
- `approval?(context, requestId, reply)`、`interaction?(context, requestId, reply)`、`permissions?(context, mode)`：回应当前请求和更新运行中权限。审批回执与选项先核验并消费；回答沿用问题验证及翻译提交门。发送失败标为未知且不重新提供旧回执。
- `dispose?()`：释放适配器资源；须与 `signal` 配合结束外部进程或连接，不能因清理删除用户历史。

`context.session()` 返回最新克隆会话，`context.signal` 表示取消，`context.emit(event)` 返回持久化完成的 Promise，适配器应逐次 await。事件包括：

| 类型 | 载荷 | 行为 |
| --- | --- | --- |
| `message` | `id/text/phase?` | 同一回合相同 ID 更新内容；`phase` 为 `commentary/final`，进入现有会话视图，明确 final 按现有配置翻译 |
| `checkpoint` | `state: JsonValue` | 保存 `Session.pluginRuntime.state`，最大序列化长度 1,000,000；只存非敏感状态，不存令牌 |
| `context` | `usage: NativeContextUsage` | 保存公开上下文统计，未知容量为 null |
| `approval` | `id/kind/details/options` | 宿主生成 receipt；只接受已提供选项，不接受任意授权对象 |
| `interaction` | `item` | 公开 `NativeInteraction` 内容；receipt、接收时间、pending 状态、会话和回合来源由宿主填写 |

`Session.pluginRuntime` 保存 owner、契约 version、名称、权限、能力和适配器检查点；适配器应在自己的 state 中版本化其数据。插件暂缺时原历史和权限仍可读取，不能重新绑定到同 ID 的其他 owner。运行中停用标为未知并封闭迟到事件；重新启用后由用户明确恢复。注册状态来自当前宿主，不信任磁盘上缓存的 `AppState.runtimeExtensions`。`SessionBinding.egress='runtime-managed'` 表示出口由该适配器实现决定，不宣称已验证远端执行或网络出口。

### 宿主入口、错误与示例

`runtime/catalog({})` 返回当前插件运行时 `RuntimeCatalogEntry[]`，含 ready/reason、模型和从实际实现推导的能力；不包含执行对象。注册和撤销通过既有扩展变更通知刷新界面；会话写入继续发 `state` 事件。`runtime/select({runtime,selection?,targetId?})`、`session/create`、`runtime/models({runtime?或sessionId?,refresh?})`、`session/model`、`session/permissions`、`session/preview`、`draft/prepare/submit`、`session/stop/reconcile/approval/interaction` 沿用原入口。第三运行时也出现在 `model-targets/list`，模型 lane 保存独立插件检查点；这不构成跨厂商原生历史无损迁移承诺。注册本身不新增模型回合或登录授权。

常见错误包括 `RUNTIME_REGISTRATION_INVALID`、`RUNTIME_ALREADY_REGISTERED`、`RUNTIME_PLUGIN_UNAVAILABLE`、`RUNTIME_OWNER_MISMATCH`、`RUNTIME_DISCOVERY_FAILED`、`RUNTIME_PERMISSION_UNSUPPORTED`、`RUNTIME_MODEL_UNSUPPORTED`、`RUNTIME_EVENT_EXPIRED`、`RUNTIME_STATE_VERSION_UNSUPPORTED`、`RUNTIME_REPLY_UNCONFIRMED` 和 `APPROVAL_RECEIPT_EXPIRED`。具体方法还会报告状态忙、未提供 resume/steer/fork 或无效事件。停用不会替开发者迁移、删除或重置原生数据。

```js
export function activate(api) {
  api.runtimes.register({
    apiVersion: 1, id: 'plugin:my-runtime', name: '我的运行时',
    description: '独立运行时适配器',
    permissions: [{value: 'default', label: '默认', description: '由适配器执行原生权限映射。'}]
  }, {
    async run(ctx, preview) {
      // Replace this offline example with a real runtime transport.
      await ctx.emit({type: 'message', id: 'reply', text: preview.translated, phase: 'final'});
    },
    async stop() { /* Resolve after the runtime confirms cancellation. */ }
  });
}
```

### 皮肤、资源和功能重构

`addStyle(css)` 接受完整 CSS，不受 manifest 简单 theme 变量白名单限制，可修改任意页面的颜色、图片背景、字体、留白、布局和控件外观。`mountSurface` 可接命名位置或任意 CSS 选择器；在目标前后插入或以 sibling 节点替换目标，保留 React 原节点以便停用恢复。单次 selector 挂载匹配第一个目标；多个动态实例使用下文新增的 `observeSurfaces`。重写行为使用 `api.call`、完整 `api.workbench` 桥和状态/命令订阅。完全改版使用 `api.root` 与 `replaceShell()`；宿主原生恢复菜单仍能退出插件界面。

新增 `assetUrl(path:string):Promise<string>` 从当前批准包返回图片或字体 data URL。PNG/JPEG/WebP/GIF/AVIF/SVG/WOFF/WOFF2/TTF/OTF 可用，单文件最多 4 MiB；路径必须在包内，每次核对完整包 hash，不读用户任意文件。底层 `extensions/asset({id,hash,path})` 返回相同字符串，包失效或停用返回 `PLUGIN_ASSET_UNAVAILABLE/REVISION_CHANGED`，不支持的资源返回 `PLUGIN_ASSET_INVALID`。CSS 可直接写 `background-image:url(...)` 或 `@font-face`；停用后对应样式移除。

`listen(target:EventTarget,type:string,listener:EventListener,options?:AddEventListenerOptions):()=>void` 添加受生命周期管理的监听，撤销或停用时清理。`assetUrl` 的异步返回也检查插件是否仍激活。自建的定时器、连接等资源继续通过 `onDispose` 释放。直接修改 React 私有树的代码没有自动恢复保证，应使用正式挂载/样式接口。

完整参考包为 [runtime-studio](../examples/plugins/runtime-studio/README.md)：一个 ZIP 同时注册第三运行时，提供背景和配色，替换工具栏、修改阅读密度，并可切换成完整自定义主界面。**该包仅供开发文档与源码示例使用，不预装、不自动启用，不安装进实际用户工作台。** 自动验收只在独立临时数据目录导入，生产启动和构建不注册示例。

验收为离线协议及隔离桌面测试，不调用真实第三方模型。第三方 CLI 的认证、协议、原生记忆/技能、权限和其他能力需由对应适配器实现并分别验证，不能把回声示例称为某个厂商已接入。

## 再次扩展审计：多实例 UI、设置与插件数据（2026-09-28 JST）

此次沿实际入口检查了宿主分发、服务替换、注册式运行时、renderer、设置导航、包资源与插件生命周期。已有任意 CSS、整壳替换和实际服务覆盖；仍存在的三处开发接口缺口是首个元素挂载、固定设置分类和缺少统一配置存储。本节接口已接入实际运行路径，不要求插件修改核心源码，也不把直接操作 DOM 或磁盘当作正式契约。工程接口可继续演进，不宣称已经证明任意未来功能均有专用 API。

### 功能覆盖矩阵

| 功能 | 开发入口 | 实际运行路径与替换 | 验证 |
| --- | --- | --- | --- |
| 多个动态 UI 实例 | `api.observeSurfaces` | 任意 CSS 选择器或命名 surface；每个匹配元素独立挂载，支持前置、后置及替换 | `scripts/test-plugin-extensibility.mjs`：真实任务行、新增、属性变化、移除、重叠、异步清理 |
| 新设置页及内置设置替换 | `api.settings.register/open/list` | 设置侧栏、搜索、点击、导航历史与实际内容；所有内置页均可由 `replaces` 替换 | `tests/plugin-settings.test.ts`、隐藏 Electron |
| 插件独立配置与持久化 | host/renderer `api.storage.read/write`；`extensions/storage/read`、`extensions/storage/write` | 同一插件 host/renderer 共用独立数据文件；修订检查、事件、重启、停用及升级 | `tests/plugin-storage.test.ts`、隐藏 Electron |

### 多实例 UI 生命周期

```ts
observeSurfaces(
  surface: string,
  placement: 'before' | 'after' | 'replace',
  render: (context: {root: HTMLElement; target: HTMLElement; signal: AbortSignal}) =>
    void | (() => void | Promise<void>) | Promise<void | (() => void | Promise<void>)>
): () => void;
```

每个匹配的 HTMLElement 创建一个独立 sibling 根节点。`target` 是对应原节点，可读取公开 data 属性；`root` 由插件负责内容。监听真实 DOM 子节点和属性变化，新增实例自动调用 render，目标移除或不再匹配时先 abort 再清理。插件自己的挂载内容不再次匹配，避免递归；不遍历 shadow root 或 iframe 内部文档。已有 `mountSurface` 的首个匹配语义保持不变，两个接口共享实际注册顺序，最后注册的替换层可见，删除任意层不提前显示核心节点。恢复每个核心元素原先的 hidden 状态。

render 可以异步返回清理函数；即使它在导航或停用后才完成，返回的清理仍执行。插件异步工作应检查本实例 `signal.aborted`，监听器可传 `{signal}`，自行创建的订阅/计时器应在返回的清理函数内释放。属性变化不会对仍匹配的同一个元素重跑 render；事件处理可随时读取实时 target，持续内容更新可自行订阅状态。接口管理的根节点、替换可见性和清理可恢复，不保证还原插件在接口外自行修改的原生 DOM。

选择器/位置无效时在分配前抛错。render 拒绝视为所属 renderer 失败：停用该插件、释放其宿主贡献及界面资源，不自动重试；其他插件保持。过期 renderer API 抛 `Plugin renderer is no longer active.`。组件清理失败不会阻止其他资源释放。

### 动态设置契约

类型源：[设置注册表](../apps/desktop/renderer/plugin-settings.ts)、[页面挂载](../apps/desktop/renderer/PluginSettingsPage.tsx)。

`settings.register({id,label,keywords?,order?,replaces?,render})` 返回 `{id,open():void,dispose():void}`。本地 id 为最多 80 字符的字母开头小写标识，允许数字、点和连字符；label 为非空中文展示标签，最多 120 字符；keywords 最多 2000 字符；order 为可选有限数字。render 接收 `{root,signal,state():AppState}` 并按上述规则返回清理函数或 Promise。state 每次读取当前 AppState 的副本，导航不会启动模型回合。

新增页完整 id 为 `plugin:<owner>/<id>`，自动出现在设置的“扩展”分组，可搜索，order 升序、同序按完整 id 排序。`replaces` 可指定任一 `CoreSettingsTab`：general、appearance、shortcuts、plugins、translation、memory、skills、runtimes、models、connections、capabilities、privacy、archive、about、worktrees。替换保留核心导航位置，使用插件标签与内容；不在隐藏节点中继续挂载原设置实现。多个插件可叠加替换，最后注册生效，任何卸载顺序均恢复剩余层或核心页。核心原生停用菜单仍保留。

`settings.open(id)` 与句柄 open 打开已注册或内置页面，不隐式注册；`settings.list()` 返回 `{id,label,owner?}[]` 的当前目录，不暴露 render 函数或私有配置。重复本插件 id 抛 `PLUGIN_SETTINGS_DUPLICATE`，无效定义抛 `PLUGIN_SETTINGS_INVALID`，打开不存在页面抛 `PLUGIN_SETTINGS_UNAVAILABLE`。插件停用、失效、失败激活均注销页面；当前新增页消失时回到常规设置，当前内置替换页则恢复核心内容。页面切换和 React 重建各自 abort 实例；异步页面出错沿 renderer 失败路径清理，不留空的失效导航项。

### 独立非敏感数据

类型源：[数据类型](../packages/plugins-core/storage-types.ts)、[本机存储](../packages/plugins-core/storage.ts)。host 与 renderer 使用同一个接口：

```ts
type PluginDataSnapshot = {revision: string | null; values: Record<string, PluginJson>};
storage.read(): Promise<PluginDataSnapshot>;
storage.write(expectedRevision: string | null, values: Record<string, PluginJson>): Promise<PluginDataSnapshot>;
```

read 返回整个插件的最新 JSON 文档，尚未保存时为 `{revision:null,values:{}}`。write 用显式 expectedRevision 比较并整体替换；删键时从新 values 省略该键，清空使用 `{}`。版本由宿主生成，写入前立即复制输入，返回独立快照。同一宿主实例按插件 ID 串行，过期版本抛 `PLUGIN_STORAGE_CONFLICT`，失败不覆盖旧文档；调用者重新读取并明确合并，不自动重放写操作。文件原子替换前再次检查批准状态和修订。不是多个独立工作台进程之间的分布式事务，也不约束全信任代码绕过 API 直接改文件。

仅支持 JSON 对象；拒绝未定义、非有限数、循环引用和非 JSON 类型，最大 UTF-8 内容 1 MiB、嵌套 64 层。此接口用于设置和少量状态，大型数据库可由插件自己的宿主服务提供。损坏文件报错，不能静默清空。错误包括 `PLUGIN_STORAGE_INVALID_ID`、`PLUGIN_STORAGE_INVALID`、`PLUGIN_STORAGE_TOO_LARGE`、`PLUGIN_STORAGE_CONFLICT`、`PLUGIN_STORAGE_UNAVAILABLE`，以及文件 I/O 错误。

renderer 底层调用 `extensions/storage/read({id,hash})` 和 `extensions/storage/write({id,hash,revision,values})`，均返回上述快照；注册表重新核对完整包与启用批准状态。每次成功保存发出既有 `PluginHostEvent`：`{type:'plugin',id,topic:'storage.changed',payload:{revision}}`；事件不含配置值，监听者需要重新 read，事件失败不撤销已成功的保存。`storage.changed` 为内置通知主题，自定义插件事件不应冒用；这不是跨进程文件监控。

数据位于工作台数据目录的 `plugin-data/plugin-<id>.json`，与完整包 hash、ZIP 代码导出分开；停用、失败、包升级和重新启用保留数据，不自动执行迁移。插件可以在 values 保存自己的 schemaVersion，使用 CAS 明确迁移。不要保存密钥、令牌或原生凭据：此处不加密，代码导出不携带数据，但工作台整体本机数据备份可能包含它。凭据继续使用受授权的宿主凭据服务。ID 分区和批准检查是接口所有权与生命周期约定，不宣称隔离全信任 host/renderer 代码，也不增加设备或管理员权限。

### 使用示例与兼容性

```js
export function activate(api) {
  api.settings.register({
    id: 'custom', label: '自定义设置',
    async render({root, signal}) {
      const saved = await api.storage.read();
      if (signal.aborted) return;
      root.textContent = String(saved.values.mode ?? 'default');
    }
  });
  api.observeSurfaces('.sidebar .session-row', 'after', ({root,target,signal}) => {
    const button = document.createElement('button');
    button.textContent = '插件操作'; root.append(button);
    button.addEventListener('click', () => {
      void api.call('state/get').then(state => {
        const session = state.sessions.find(item => item.id === target.dataset.sessionId);
        if (!signal.aborted) button.textContent = session?.title ?? '任务已移除';
      }).catch(() => {});
    }, {signal});
  });
}
```

以上均为 API v1 增量；旧插件保持原行为，新插件应探测 `api.observeSurfaces`、`api.settings` 和 `api.storage`。宿主全部分发/服务替换、第三运行时注册和全局样式/整壳替换继续可用，应用这些新接口不需要安装示例。完整可运行参考见 [ui-workshop](../examples/plugins/ui-workshop/README.md)。该示例只用于开发文档和隔离临时测试；不预装、不自动启用、不安装进实际用户环境。

验证入口：`npx tsx --test tests/plugin-storage.test.ts tests/plugin-settings.test.ts tests/plugin-api.test.ts tests/plugin-services.test.ts`，以及 `node --import tsx scripts/test-plugin-extensibility.mjs`。后者创建独立应用与数据目录，覆盖真实侧栏实例、设置搜索/替换、host/renderer 共享保存、重启、停用、异步失败回收与既有服务替换，并生成截图和 `result.json`；无真实模型调用。
<!-- plugin-extensibility-audit:end -->


## 会话底栏与运行时/模型用量（2026-09-28 JST）

### 功能覆盖矩阵

| 功能 | 稳定入口与数据 | 扩展或替换 | 验证 |
| --- | --- | --- | --- |
| 轮数、步数、速度、总 token 与命中率 | session/metrics({sessionId}) → Promise<MetricsSnapshot>；packages/session-metrics 的 sessionMetrics(session?) | 同名 registerMethod/useHost；renderer 精确会话 surface | tests/session-metrics.test.ts、scripts/test-session-metrics-ui.mjs |
| 运行时 × 模型累计与缓存明细 | Session.metrics:SessionMetrics，version:1；MetricsSnapshot.groups | 订阅既有 state/onState 事件，用本会话快照绘制；切换来源不清空 | 同上，包含重启、重复回执、跨运行时分组与加权比例 |
| 自定义运行时计量 | RuntimeContext.emit({type:'usage',usage:UsageSample}) → Promise<void> | 已批准的 RuntimeAdapter.run/steer/resume 发出回执 | tests/session-metrics.test.ts、tests/runtime-extensions.test.ts |
| 原生及 API 采集 | observeNativeMetrics(session,frame)、ApiConversation.onUsage(turn,elapsedMs)、openNativeGateway 的 usage({counts,model,elapsedMs}) | 既有 runtime 服务替换；自定义运行时复用 usage 事件，无需修改核心枚举 | tests/session-metrics.test.ts、tests/native-provider.test.ts、tests/model-api.test.ts |
| 底栏与悬停浮层 | SessionMetrics({session?,snapshot?})；[data-session-metrics][data-session-id]；[data-testid=session-metrics-details] | renderer.observeSurfaces 逐实例 replace；停用时恢复核心节点 | scripts/test-session-metrics-ui.mjs；通用多实例/异步生命周期沿用既有 renderer 契约 |

### 类型、口径与来源

MetricsSnapshot 返回 version:1、rounds:number、steps:number|null、tokensPerSecond:number|null、rateBasis:'api'|'turn'|null、inputTokens/outputTokens/cacheReadTokens/cacheWriteTokens/totalTokens:number|null、cacheHitRate:number|null、incomplete:TokenField[]、partialHistory:boolean，以及 groups:MetricsGroup[]。每组额外具有 runtime、model、steps、cacheHitRate 和相同计数/缺失字段；model 为空表示无法归属的模型，UI 显示“模型未上报”。cacheHitRate 是 0–1 比例，以同条已知记录的缓存读取总和 / 输入总和加权计算；仅无有效正分母时为 null，部分记录缺字段不会隐藏其他已知记录的比例（2026-09-30 修订）。缓存写入不计命中。输入已包含缓存读写；总量不再另加缓存，推理输出也不重复累加。

轮数为本会话已发送的用户回合，原生 turnId 去重，插入当前回合不额外加轮；pending、not-sent 和 uncertain 的插入消息不计已发送轮数。步数是已记录模型调用：Codex 使用去重后的累计用量更新，Claude 使用消息 ID 并按 result.num_turns 补齐，API 记录实际请求（含有回执的压缩请求）。它不是工具数量；旧历史或运行时未报步数时未知。速率为最近 API 请求/原生回合的输出 token 除以 API 耗时；SSH 缺少 API 耗时时用原生回合观测耗时，含工具与等待，并在浮层说明。不是字符推算或纯解码速度，回合结束后不随空闲时间衰减。

所有模型和传输共用底栏，包括 SSH、两家本机原生运行时、三种 API 协议及注册运行时。API 网关在转换前被动读取真实上游计数；相同协议逐块转发不变，不另发计量请求；转换后的原生回执不重复加入总量。原生进程网关汇总该进程实际请求，包括其内部工作；SSH 使用绑定根流上报的用量，子流不会再次手工叠加。Claude modelUsage 的累计数值不重复加入 result.usage，多个模型的未分配残差归为未知模型。该显示器不扩大尚未验收的 SSH 执行入口权限。

Session.metrics 增量保存数值回执、来源、模型、请求/回合去重身份和计时，不保存原始流、工具正文或凭据。切换运行时、模型来源、停用插件和重启保留累计；新分支独立计费，既有上下文环形指示器不变。新字段可选，旧存档无需迁移；不读取用户原生聊天数据库补历史。未上报值为 null，部分已知累加量以 ≥ 标注；历史不足另有提示。失败/中断请求没有用量回执时不能估算，也不能据此当作账单或完整结算数据。

### 调用、事件、权限与生命周期

session/metrics 仅接收现有 sessionId，无 I/O、写入、模型启动或新权限；不存在的会话沿用宿主会话校验错误。状态更新通过既有 state 事件和 renderer.onState 发布。插件使用已批准的宿主调用权限；此入口不增加跨设备、其他租户或管理员能力。同名注册/中间件可替换只读结果。默认 renderer 使用 sessionMetrics 从同一 Session 快照计算，替换 renderer 的插件可读取 session/metrics 或自行使用公开 selector。

UsageSample 字段为 {id:string,model?:string,inputTokens:number|null,outputTokens:number|null,cacheReadTokens:number|null,cacheWriteTokens:number|null,totalTokens:number|null,steps?:number,elapsedMs?:number}。id 在一次 run 内标识同一请求，重复事件是累计快照替换；新请求用新 id，跨 run 自动加回合命名空间。缓存计数是 inputTokens 子集；未知明确传 null，不能填 0 代替。steps 默认 1；elapsedMs 若提供须大于 0，表示该请求 API 耗时。emit 必须 await；返回表示写入并发布状态完成。数值非法抛 SESSION_USAGE_INVALID，失效 run、已停用插件和换 owner 沿用 RUNTIME_EVENT_EXPIRED / RUNTIME_OWNER_MISMATCH，失败不会启动额外模型回合。运行时不发 usage 时 UI 保持未知，既有 apiVersion:1 插件兼容；本次只增量扩展 RuntimeEvent 联合类型。

```js
const metrics = await api.call('session/metrics', { sessionId });
for (const group of metrics.groups) console.log(group.runtime, group.model, group.totalTokens);
// Inside an explicitly started, approved RuntimeAdapter:
await context.emit({ type: 'usage', usage: {
  id: 'request-1', model: 'example-model', inputTokens: 1000,
  outputTokens: 200, cacheReadTokens: 800, cacheWriteTokens: null,
  totalTokens: 1200, elapsedMs: 2000
} });
// Renderer extension: one mount per matching instance, including later insertion.
const release = api.observeSurfaces('[data-session-metrics]', 'replace', ({ root, target }) => {
  const sessionId = target.dataset.sessionId;
  root.textContent = sessionId ? '自定义会话用量' : '尚未发送';
});
api.onDispose(release);
```

公开测试仅使用合成模型/SSH 帧与隔离网关；隐藏 Electron 检查真实组件、悬停/键盘、主题、窄屏、原有环形指示器和插件替换恢复。它们不证明真实付费模型计费或远端网络验收。


## 子 Agent 参数与独立会话工具（2026-09-28 JST；U108、U109 后续修订）

此修订补齐模型访问空项目、创建独立聊天及首条提交；原有 peer 消息仍只入箱，不因收信自动启动接收方。独立聊天与原生子 Agent 保持两种生命周期。

| 功能覆盖 | 入口、参数与返回 | 扩展与验证 |
| --- | --- | --- |
| 子 Agent 参数 | NativeChildEvent / NativeChildSnapshot.settings?:NativeChildSettings；model、effort 是 {value:string,source}，fast 是 {value:boolean,source}；source 为 requested/native/provider | state/get 与既有 state 事件；nativePeerTools/原生 observation 服务接入，renderer mountSurface 可替换 [data-testid="child-model-settings"]；tests/child-settings.test.ts |
| 空项目发现 | workbench_list_projects({query?,cursor?,limit?}) → {projects:[{id,name,paths}],nextCursor,note}；query 最多 200 字，limit 1–100，默认 20；cursor 为上一页最后一个项目 ID | 服务 sessions.agent-tools.listProjects(sourceSessionId,options)；只读，不访问原生私有聊天库，不启动任务 |
| 创建独立聊天并提交 | workbench_create_session({task,operationId,authorizationQuote,projectId?,projectPath?,targetId?,effort?,title?}) → {operationId,sessionId:string|null,state,status,title,reused,note} | sessions.agent-tools.create(sourceSessionId,input,signal?) 与 call(sourceSessionId,name,input,signal?)；Codex dynamic tools / Claude MCP 使用同一个实际服务；tests/chat-session-creation.test.ts、scripts/test-agent-session-ui.mjs |

输入定义见 packages/collaboration-core/session-tools.ts。task 最多 100000 字，operationId 与 effort 最多 256 字，authorizationQuote 最多 2000 字，title 最多 200 字，targetId 最多 2048 字，projectPath 最多 4096 字；空值、未知参数和身份覆盖拒绝。省略 projectId 使用来源项目，null 为无项目；指定目录须为项目已登记目录。用户明确指定模型时，从 workbench_list_model_targets 选择对应 targetId；指定思考档位时传 effort，以用户值覆盖来源或目标的默认值。省略 targetId 才沿用来源运行时和模型；同一目标省略 effort 沿用来源档位，换目标但省略 effort 则采用目标默认值。不可用的模型或档位在创建前报错，不静默回落；档位也纳入操作摘要，不能用同一 operationId 改档位重投。显式 target 仍须同所有者、同执行位置和同已绑定设备/工作空间。权限不从模型参数读取，不因创建聊天扩大原有权限。

调用来源由宿主绑定，模型不能传 sourceSessionId。首次创建必须处于活跃的明确用户任务中，authorizationQuote 必须逐字来自最新直接用户消息并表达新建聊天意图；无需出现“子 Agent”。仅收到 peer 消息、模型生成的首条任务、旧请求或否定请求均不能授权。该文字检查不是理解任意自然语言的保证，模型工具说明同时要求保留用户的实际任务范围。新聊天的 Session.agentCreated 保存 sourceSessionId/operationId/initialMessageId，agentParent 不设置；命名不被首条提交覆盖，用户之后仍可正常改名。

AppState.chatCreations 增量保存操作摘要与首条消息 ID。先持久化 pending 预约，再创建会话和提交；相同来源与 operationId 按完整参数摘要去重，参数改变抛 CHAT_OPERATION_CONFLICT。started 仅表示提交入口已接受，不证明模型收到了任务或完成了任务；真实状态通过 workbench_read_session 查询。创建失败为 failed，提交回执未知或重启遗留 pending 对调用者为 uncertain；均不重投。已创建的空会话保留供查看，取消前未提交时显示未启动。操作记录达到 10000 条拒绝新建，不静默丢弃去重证据。停用插件不删除聊天或回执，关停时服务拒绝后续调用，已归属的执行器沿原有生命周期停止。

其他错误：CHAT_TOOL_ARGUMENTS_INVALID、CHAT_CREATE_ARGUMENTS_INVALID、CHAT_PROJECT_QUERY_INVALID、CHAT_PROJECT_CURSOR_STALE、CHAT_PROJECT_UNAVAILABLE、CHAT_PROJECT_PATH_UNREGISTERED、CHAT_CREATION_NOT_AUTHORIZED、CHAT_REQUIRES_DIRECT_USER_TASK、CHAT_SOURCE_CHANGED、CHAT_MODEL_TARGET_UNAVAILABLE、CHAT_MODEL_SELECTION_REQUIRED、CHAT_MODEL_SELECTION_INVALID、CHAT_MODEL_SELECTION_UNAVAILABLE、CHAT_OWNER_MISMATCH、CHAT_TARGET_LOCATION_MISMATCH、CHAT_OPERATION_RESERVED、CHAT_OPERATION_CAPACITY、CHAT_SOURCE_UNAVAILABLE、CHAT_TOOLS_DISPOSED。不把原始提供方错误、凭据或协议信封返回模型。结果随既有 state 事件发布，无新自动触发事件。

子 Agent 参数按字段合并；Codex thread/started 中的模型和 effort 属于原生配置回传，collabAgentToolCall 中的 model/reasoningEffort 属于请求值。Claude 读取已绑定子通道的 assistant/message_start 模型字段，不从回复正文的身份自述提取模型。固定 API 映射按本次运行启动配置保存，区别于 Claude 家族/容量别名；配置不等于服务商证明，Fast 与 effort 独立，缺字段显示未知，不能从主会话后来改动的控件反推。旧 model 字段继续作为请求模型兼容，旧记录缺 settings 不自动补造历史证据。更强来源不被迟到请求覆盖，临时子 ID 合并为原生 ID 时保留元数据。

完整包批准的宿主插件可用 services.intercept/override('sessions.agent-tools', ...) 替换 listProjects/create/call，真实两家工具分发均经过同一实例；替换者须维持来源、取消、去重和权限边界。示例只在文档中，不自动安装：

```ts
const remove = api.services.intercept('sessions.agent-tools', 'create',
  (next, sourceSessionId, input, signal) => next(sourceSessionId, input, signal));
api.onDispose(remove);
const projects = await api.services.get('sessions.agent-tools').listProjects(selectedSessionId, {});
// An explicit user request is required before calling create; listing never starts work.
// Choose targetId from workbench_list_model_targets for the user's requested model.
const chat = await api.services.get('sessions.agent-tools').create(selectedSessionId, {
  task: 'Review the selected project.', operationId: 'user-requested-review',
  authorizationQuote: 'Open a new chat using the review model with high effort.',
  targetId: selectedModelTargetId, effort: 'high',
});
```

插件测试覆盖真实控制器、Codex 工具集合、Claude MCP、替换与撤销恢复。界面以只读紧凑参数行放在详情页右上角，长模型名省略并保留完整悬停说明；模型、思考和 Fast 分别说明来源。当前 API v1 为增量字段/工具/服务扩展，旧记录可读；原生模型选择、原生子 Agent 数量、层级、认证和独立运行环境未改。


## 回合末端操作、并行历史分支与停止控件（2026-09-28 JST）

本修订为 API v1 兼容行为调整，入口与存储结构不变。运行中的新回合不阻止用户从此前已完成回复发起分支；当前未完成回合、过程消息、缺失原生边界及结果未知仍不能成为分支起点。消息有明确未完成标记时不按会话空闲反推完成。无旧阶段元数据的历史仅使用每回合最后一条回复；同一原生回合中的追加输入不形成额外工具栏。

| 功能覆盖 | 可调用入口或界面扩展 | 返回、生命周期与验证 |
| --- | --- | --- |
| 分支资格与 Git 检查 | api.call('session/fork-options', {sessionId:string,messageId?:string}) | {busy,workspace:WorktreeInspection,worktree:WorktreeInspection}；历史起点可用时活动执行器不置 busy；重复创建、模型或权限切换仍互斥；tests/turn-actions.test.ts、tests/worktree-forks.test.ts |
| 历史聊天／工作树分支 | api.call('session/fork', {sessionId,messageId?,location?:'workspace'\|'worktree'}) | Promise<Session>；复制选定历史与独立绑定，原生 fork 在分支的后续明确任务中发生；不重连、停止或回滚活动源线程 |
| 每回合回复工具栏 | api.observeSurfaces('.native-message[data-turn-reply="complete"] .message-actions', 'replace', render) | 每个已完成回合仅最后回复有复制／分支；data-reply-id 为消息 ID，data-turn-reply 为 complete/process；过程与当前回合仅保留单条翻译入口；停用或卸载恢复所有核心实例 |
| 独立双语复制与翻译 | api.call('clipboard/write',{text:string})；api.call('message/retranslate',{sessionId,messageId})；child-message/translate 使用原有 childId/messageId | 返回 null，翻译结果通过原有 state 事件更新；已完成输出的原文与译文分别复制，翻译失败保留旧译文；过程不增加复制行，原生子会话同样遵循末端规则 |
| 停止与发送 | api.call('session/stop',{sessionId})；draft/cancel 沿用原参数；api.addStyle 或 observeSurfaces('.composer-actions .stop-button','replace',render) | 停止返回原运行时 {stopped,scope?,reason?}；双主题统一 32px 圆底、12px 居中方块，亮色深底浅方块、暗色浅底深方块，颜色变量见下文；草稿含正文、附件或技能时仍按原规则切为发送，缺失回执或不支持插入不放宽 |
| 记忆标注 | state/get、既有 state 订阅、Message.original/memoryReferences；observeSurfaces('[data-testid="reply-memory"]','replace',render) | 已有非空引用优先；空缓存回退解析完整原文引用。Codex 无显式引用不从 shell 字符串或模型自述推断，Claude 成功结构化 Read 仍标为“本轮读取”；tests/turn-actions.test.ts、tests/permissions.test.ts |

分支创建前冻结所选历史的原文、提交文本、原生标识和连接／模型／权限／工作区绑定；完成后重新核对该前缀。后续流式消息、后续回合结束和显示层重译不使历史快照失效；所选原文或身份漂移则拒绝。无 messageId 的整会话分支仍要求结束状态。没有已记录回执的活动 Codex 起点直接拒绝，不为查历史重新连接源运行时。插件运行时继续使用其注册的 fork 能力，停用后不绕过能力检查。

工作树错误说明区分目录不可读、非 Git 仓库、无首个提交、Git 缺失、合并冲突及子模块限制；WORKTREE_SOURCE_CHANGED、WORKTREE_COPY_VERIFICATION_FAILED 等既有复制校验仍有效。创建中源文件变化不强行覆盖；会话持久化失败只释放干净检出，有修改的检出保留用于恢复。复制的是创建时当前 Git 文件状态，聊天消息截止点不构成历史文件还原指令。

权限沿用批准包、宿主入口、绑定运行时与文件操作边界，不增加模型工具、审批或权限。宿主可调用或 intercept workbench.controller.call，Git 实现可通过 actions.worktrees 的 inspect/create/abandon 等既有服务替换；界面扩展使用多实例 observeSurfaces，不以私有 React 函数为插件契约。替换需保留同一边界，撤销注册恢复核心实现，保留已生成会话与工作树数据；未增加自动提交、模型调用、自动续投或重试事件。

```ts
const options = await api.call('session/fork-options', {sessionId, messageId});
if (options.worktree.available) {
  const branch = await api.call('session/fork', {sessionId, messageId, location:'worktree'});
  // Creating the branch does not submit a model task.
}
const dispose = api.observeSurfaces('.native-message[data-turn-reply="complete"] .message-actions', 'replace',
  ({root, target}) => { root.textContent = '自定义回复操作'; });
api.onDispose(dispose);
```

停止控件外观后续修订：两种主题的方块均为 12×12px、圆角 2px，外圆均为 32px。亮色主题恢复深色圆底（默认 `--text` 为 `#302e2b`），中间方块使用原暗色版圆底的暖浅色 `#ece8e2`；暗色主题保留 `#ece8e2` 圆底和 `#242424` 方块。本次修正此前误将两种主题统一为同色的行为。`--composer-stop-background` 与 `--composer-stop-foreground` 两个 CSS 颜色变量保持兼容：未设置时使用对应主题默认值，悬停颜色由背景与实际方块色混合计算。已批准的 renderer 插件通过 `api.addStyle(css:string):()=>void` 覆盖，返回函数撤销本次样式；停用时自动清理，恢复对应主题默认或其他仍有效的样式层。不新增 IPC、事件、错误或权限，停止／取消生命周期和失效插件错误沿用既有契约；API v1 和旧插件无需迁移。

```ts
const undoStopStyle = api.addStyle(`:root {
  --composer-stop-background: var(--text);
  --composer-stop-foreground: #ece8e2;
}
:root[data-theme=dark] {
  --composer-stop-foreground: #242424;
}`);
api.onDispose(undoStopStyle);
```

验证：tests/turn-actions.test.ts、tests/session-fork.test.ts、tests/worktree-forks.test.ts、tests/claude-fork-usage.test.ts、tests/runtime-reading.test.ts；scripts/test-composer-controls-ui.mjs 使用主入口相同的主题和布局样式，覆盖双主题、窄屏、运行中历史分支按钮、复制／重译与停止／发送；scripts/test-session-fork-ui.mjs 覆盖隐藏 Electron 的真实控制器、Git 创建、来源返回焦点及重启。外观后续修订复跑控件检查，并在同一隐藏夹具测量双主题尺寸、中心、颜色以及变量覆盖／撤销恢复；最近配色修正的证据位于忽略目录 build/qa/stop-light-20260928，此前同色版本证据保留于 build/qa/stop-unified-20260928。CLI／付费模型与远端任务需要各自验收，不能由这些夹具代替。


## 增量模型转发与宿主更新（2026-09-28 JST）

这是 API v1 的兼容扩展。新增的实际宿主入口 `services.get('runtime.native-provider').openGateway(options: NativeGatewayOptions)` 被真实 Codex/Claude 自定义 API 启动路径调用，可用 `services.intercept` 包装或 `services.override` 替换；不是仅供测试的私有旁路。类型位于 `packages/model-api/native-gateway.ts`。不新增 renderer IPC，也不将回环凭据公开给 renderer 或模型。

| 功能覆盖 | 开发入口／类型 | 返回、事件、验证 |
| --- | --- | --- |
| 原生协议网关与替换 | `runtime.native-provider.openGateway(options)` | `Promise<{baseUrl:string,token:string,flushUsage():Promise<void>,close():Promise<void>}>`；真实启动消费该句柄；`scripts/test-native-stream-tools.mjs` 验证注册表包装、真实启动调用及撤销恢复 |
| 流式解码 | `collectStream(response,protocol,onText?,options?:StreamReadOptions)` | 完整响应对象；可选旧 `onText` 仍为累计正文；新增 `onDelta` 为 `ModelStreamDelta`，包含 `{type:'text',delta}` 或 `{type:'tool',index,id,name,argumentsDelta}`；`signal?:AbortSignal` 取消阻塞读取；`tests/native-stream-transport.test.ts` |
| 原生事件转换 | `nativeWireStream(protocol,request)` | `start/text/delta/push/finish` 返回有序原生事件数组；旧累计 `text` 兼容，真实网关使用增量 `push`；普通／命名空间工具、custom 工具的 JSON 包装字符串、并行调用与 UTF-8 碎片均有测试 |
| 网络交付与用量 | `NativeGatewayOptions.usage(value)`、句柄 `flushUsage/close` | 用量保存不阻塞正文、工具完成或响应结束；清理等待已发出的用量回调结算；回调失败走 `failure`，不把已成功交付的响应改成失败或重新发送 |
| 原生宿主状态更新 | `runtime.native-provider` 现有执行入口及 `state` 事件 | 合并等待持久化期间的正文碎片与观察状态变更，保持顺序及完成／审批边界；无固定批处理定时器，不更改模型 token、工具参数或输出内容 |

`NativeGatewayOptions` 参数：`runtime:'codex'|'claude'`，`model:ApiModel`，可选 `effort:string`；`credentials():Promise<{connection:ModelConnection,key:string}>` 每个请求重新核验绑定与有效来源；可选 `fetcher:typeof fetch`、`mcp():{handle(request):Promise<unknown>,dispose():void}`、`failure(error):void`、`diagnostic(value:NativeProviderDiagnostic):void`；`usage({counts:TokenCounts,model:string,elapsedMs:number}):void|Promise<void>`。`elapsedMs` 继续表示完整上游请求耗时，不在本修订中伪装成去除首字等待的解码速度。

生命周期：每个原生进程持有自己的随机回环地址与令牌。流可在上游完成前发送正文和工具参数，但工具完成、消息完成、最终用量仍依赖有效完成回执。收到协议终止事件即可结束读取，不等待对端额外关闭 socket；同协议遵循原始终止事件并保持已收到的字节。两条转发路径都处理写入背压，客户端关闭、超时或宿主停止会取消所属读取；没有外层重试、续投或账号切换。`close()` 关闭所属请求、MCP 会话与监听器，并等待已启动的用量保存。插件撤销包装后，新网关恢复核心实现；已有句柄继续由原运行时负责关闭，不能把插件停用解释为任意终止其他任务的许可。

错误包括 `NATIVE_STREAM_FINISHED`、`NATIVE_STREAM_TEXT_CHANGED`、`NATIVE_STREAM_TOOL_CHANGED`、`NATIVE_STREAM_INVALID_TEXT`、`NATIVE_STREAM_INVALID_TOOL`、`NATIVE_STREAM_TOOL_ORDER`、`NATIVE_STREAM_BLOCK_REUSED`、`NATIVE_STREAM_TOOL_LIMIT`、`NATIVE_STREAM_CLOSED` 及既有请求大小／上游协议错误。HTTP 错误不回显原始正文或凭据；流中错误使用原生 `error` 事件，不再追加成功完成。中断前已经显示的部分正文可保留，但不作为成功工具回执。协议特有的不透明推理与签名没有通用跨协议语义，不转成公开正文；同协议不剥离原生字段。

权限：仅已按完整代码包批准的宿主插件可访问服务、凭据回调或替换传输。原有会话绑定、来源开关、原生工具审批、所有者／设备／OS 边界不变。示例不记录 key/token，不预安装插件，不触发模型调用。

```ts
const undo = api.services.intercept('runtime.native-provider', 'openGateway', async (next, options) => {
  const gateway = await next(options);
  return gateway;
});
api.onDispose(undo);
```

兼容：旧启动入口、API v1、`onText`、累计 `nativeWireStream.text` 与 usage 字段保持兼容；用量回调结算可晚于网络响应完成，要求持久化屏障的宿主应调用 `flushUsage()` 或 `close()`。不迁移原生会话或更改既有计速定义。验证位置：`tests/native-streaming.test.ts`、`tests/native-stream-transport.test.ts`、`tests/native-provider.test.ts`、`tests/session-metrics.test.ts`、`tests/native-collaboration.test.ts`、`scripts/test-native-streaming.mjs`、`scripts/test-native-stream-tools.mjs`。`scripts/benchmark-native-streaming.mjs` 接受 `AWB_STREAM_BASELINE_REF`，输出顺序交替的合成对照和内容一致性结果；不可将内部转换耗时当成模型推理速度提升。


<!-- translation-quick-toggle:start -->
## 翻译模块与全局临时开关（2026-09-29 UTC）

### 功能覆盖矩阵与开发契约

| 功能 | 入口、参数与返回 | 事件、验证位置 |
| --- | --- | --- |
| 插件总开关 | `plugins/set-enabled({id:'translation',enabled:boolean}) → AppState`；`plugins/list` 的 enabled 仅代表模块启用 | 既有 `state/onState`；tests/translation-module.test.ts、tests/translation-quick-toggle.test.ts |
| 全局临时控制 | `translation/quick-toggle({show?:boolean,paused?:boolean}) → AppState`，至少提供一个布尔字段；只合并提供的字段 | 同一状态通知；tests/translation-quick-toggle.test.ts、scripts/test-translation-module-ui.mjs |
| 持久化读取 | `state/get → AppState.translationQuickToggle?:{show:boolean,paused:boolean}`；不包含会话 ID、凭据或第三方配置 | 重启、多个会话及主开关往返测试同上 |
| 实际生效与可见性 | packages/translation/settings.ts 的 `translationModuleEnabled(state)`、`translationQuickToggleVisible(state|null)`、`translationEnabled(state) → boolean`；state 为 `Pick<AppState,'plugins'|'translationQuickToggle'>` | 宿主输入、输出、手动翻译与界面共用；八种组合及 tests/translation-flow.test.ts |
| 设置与会话界面 | 翻译模块默认折叠，展开后显示“显示临时翻译开关”；composer surface 内 `[data-testid="translation-quick-toggle"]` 仅在总开关和 show 均开启时挂载 | scripts/test-composer-controls-ui.mjs、scripts/test-translation-module-ui.mjs |

模块关闭始终禁止新翻译，隐藏会话框下方全部翻译控件，输入框底部留白仍保留至少 12px，仅略向下移动。会话统计不随模块关闭。模块启用时，show 默认 true；paused 默认 false。旧配置缺少整个字段时补齐上述默认，不改变旧插件总开关。临时暂停只在 show=true 时生效；隐藏该控件恢复模块正常翻译，但保留 paused，重新显示后恢复此前临时状态。该偏好属于本机全局状态，切换会话和重启均保留，主开关往返不重置。

### 权限、生命周期、错误与兼容

该入口沿用当前工作台 owner 和批准的完整代码插件权限，不授予 SSH、其他设备、管理员或模型自动改设置权限。宿主插件可使用同名 registerMethod/useHost 或已有 translation 服务拦截、替换；renderer 插件可调用 api.call/api.onState，并通过 `api.observeSurfaces('composer','replace',render)` 或 settings 注册替换设置页；使用既有多实例清理与停用恢复，不预装示例。

设置通过既有串行设置队列与 StateStore 保存，未提供字段不覆盖现值；读取最新状态后检查 paused 写入必须满足总开关与 show 已开启。缺少参数、非布尔值、入口不可用、损坏的持久化格式和存储失败均通过既有 IPC Error.message 返回；失败不把未确认值显示为已保存，不自动重试。总开关关闭时可以单独调整 show，但不能通过 paused 重新启用插件。

修改临时状态使用与模块开关相同的配置代次取消机制：撤销准备中请求及旧预览，保留草稿和已有译文，迟到响应不能提交或覆盖。暂停后的明确发送使用精确原文，不读翻译凭据、不请求翻译；恢复不自动发送、不重跑原生任务。插件仍启用而临时暂停时，详情页的显式模型目录读取与设置保存可用；模块完全关闭时目录读取仍拒绝。`translation.enabled()` 表示当前实际翻译能力，`translation.describe().enabled` 和 `plugins/list` 保持插件主状态，二者现在可能不同。

API v1 增加可选状态和新入口；`plugins/set-enabled` 的参数和总开关语义保持兼容。旧自动化定位 `translation-module-toggle` 不再存在，应使用公开方法或新的临时控件定位。`DraftPreview.moduleDisabled` 兼容保留字段名，表示当前准备绕过翻译（包括临时暂停）；不用于推断插件是否卸载或关闭。直接发送偏好和翻译服务配置保留。

~~~js
// Explicit user actions; each call merges only the provided preference.
await api.call('plugins/set-enabled', {id:'translation', enabled:true});
await api.call('translation/quick-toggle', {show:true});
await api.call('translation/quick-toggle', {paused:true});
const {plugins, translationQuickToggle} = await api.call('state/get');
// plugins.translation.enabled stays true; translationQuickToggle.paused is true.
await api.call('translation/quick-toggle', {paused:false});
~~~
<!-- translation-quick-toggle:end -->

<!-- appearance-settings:start -->
## 可配置外观与本机字体（2026-09-30 JST；U116）

独立模块 `packages/appearance/index.ts` 定义 `AppearanceSettings`、`AppearancePatch`、`FontChoice` 和 `FontCatalog`。本次是 API v1 的增量接口，不更改已有 `theme/set`；`AppState.appearance` 为可选字段，旧状态与旧调用端继续工作。缺少配置时按系统无衬线界面、Claude 桌面阅读正文、系统等宽代码以及 13 / 15 / 13 px 解析；不在读取时重写旧文件。历史非法字段逐项回退，未知版本保留源文件并使用默认展示。

| 入口 | 参数 | 返回与事件 |
| --- | --- | --- |
| `appearance/get` | 无 | 完整 `AppearanceSettings`，不写入 |
| `appearance/set` | `{revision:number, patch?:AppearancePatch, reset?:boolean}` | 成功返回新配置，修订号加一；沿用 `workbench:state` / `WorkbenchApi.onState` 与插件 `{type:'state',payload:AppState}` 通知 |
| `appearance/fonts` | 无 | `{status:'ready'|'unavailable',families:string[],reason?:'unsupported-platform'|'enumeration-failed'}`；无状态写入、无事件 |
| `theme/set`（既有） | `{theme:'light'|'dark'|'system'}` | 仍返回更新后的 `AppState`，原事件不变 |

配置字段：`version:1`、`revision:number`；`uiFont`、`contentFont`、`codeFont` 为 `system` / `claude` / `serif` / `mono` / `local:<family>`，仅正文另支持 `inherit`。`uiSize` 为 11–18、`contentSize` 为 12–24、`codeSize` 为 10–22 的整数像素；`palette` 为 `warm` / `neutral`，`accent` 为六位十六进制颜色或 `null`（随主题），`numericStyle` 为 `lining` / `font`，`reducedMotion` 为 `system` / `on` / `off`。名称按单个 CSS 家族处理、引号包裹并保留系统回退，不接受任意 CSS、URL 或字体文件路径。所选本机字体移除后保留选择，按回退组合显示。

`appearance/set` 在宿主状态写入队列内比较 `revision`；并行修改只有相符修订可成功，冲突返回 `APPEARANCE_REVISION_CONFLICT`，不得盲目重试覆盖。未知键、错误枚举或 `reset` 类型返回 `APPEARANCE_INVALID_PATCH`；字体、字号、颜色错误分别为 `APPEARANCE_INVALID_FONT`、`APPEARANCE_INVALID_SIZE`、`APPEARANCE_INVALID_COLOR`。磁盘失败沿用宿主错误，不发送成功通知或应用未保存选择。`reset:true` 恢复该模块字段但保留浅深色模式、窗口缩放、插件配置和原生 CLI 设置；仍要求当前修订号。

Windows 字体目录由 `host/appearance-fonts.ts::listInstalledFonts():Promise<FontCatalog>` 枚举系统已安装家族，8 秒超时、1 MiB 输出上限、名称去重与排序、最多 4,000 个条目。`HostActions.listFonts?():Promise<FontCatalog>` 是可注入目录入口。UI 打开外观页或明确刷新时读取；其他平台或失败显式返回 unavailable，仍可使用默认组合，不伪称已扫描成功。系统字体枚举只返回名称；可选 Claude 字体按下文只读引用。不下载或重分发字体、不访问账号、聊天、原生配置或网络，不要求额外系统权限。

插件通过已批准的 `host` 能力使用 `api.call` 调用核心入口，`api.invoke` 经过现有可替换分发，`registerMethod` / `useHost` 可替换三个 appearance 方法；外观页本身可用 `registerSettingsPage({replaces:'appearance',...})` 替换。包批准、错误隔离及停用清理沿用既有生命周期，完整包批准不会增加设备或管理员权限。停用方法覆盖恢复核心；通过核心 API 已明确保存的用户配置保留，不把停用当重置。

~~~js
const appearance = await api.call('appearance/get');
const catalog = await api.call('appearance/fonts');
await api.call('appearance/set', {
  revision: appearance.revision,
  patch: {uiFont:'system',contentFont:'claude',codeFont:'mono',contentSize:18}
});
api.onEvent(event => {
  if (event.type === 'state') console.log(event.payload.appearance?.revision);
});
// Temporary renderer override, removed by the returned disposer or plugin disable.
const restore = api.addStyle(':root[data-appearance]{--font-ui:Arial,sans-serif}');
~~~

Renderer 暴露 `--font-ui`、`--font-content`、`--font-mono`、`--font-numeric`、`--numeric-variant`、`--ui-font-size`、`--content-font-size`、`--code-font-size`；`--accent`、`--accent-contrast` 与既有配色变量继续有效。核心配置使用独立可撤销样式层，放在插件样式之前；同等或更高优先级的插件规则在用户修改配置后仍可覆盖，撤销显示最新保存的核心设置。`applyAppearance(settings,document?)` 返回清理函数，`useAppearance(settings)` 负责组件生命周期；更新触发 renderer 本地 `workbench-appearance` 无载荷事件，不是宿主业务事件。`CodePreview` 读取 `codeAppearance()` 的 `{fontFamily,fontSize,lineHeight}`，更新已挂载 Monaco 并重新测量；插件样式增删及根内联样式更新也重新测量。释放编辑器时移除事件和观察器，不重建文档或丢弃滚动位置。内置 CSS 字号改为相对根字号，非文字尺寸保持原值；KaTeX/Monaco 第三方字体资源不替换。

功能覆盖矩阵补充：

| 功能 | 调用/扩展点 | 核验 |
| --- | --- | --- |
| 模式、配色、字体、字号与数字 | `theme/set`、`appearance/get/set`、状态事件 | `tests/appearance.test.ts`；旧状态、持久化、并发冲突、失败、重置 |
| 本机字体目录与替代实现 | `appearance/fonts`、`HostActions.listFonts`、`registerMethod` | 同上，已批准包的调用、订阅、替换、停用恢复；隐藏 Windows 实际目录枚举 |
| 界面/主正文/译文/子会话/代码排版 | CSS 变量、`applyAppearance`、`codeAppearance` | `scripts/test-appearance-ui.mjs`；字号比例、Markdown、已挂载 Monaco、数字、重载 |
| Claude 本机阅读字体引用 | `appearance.reference-fonts`、固定 `awb-font` 协议、`--font-content` | `tests/appearance-reference-font.test.ts`；实际共享方法接管/停用恢复、路径限制、缺失回退；隐藏 UI 核验字形与生产 CSP |
| 外观 UI 与临时主题 | 设置页替换、`api.addStyle`、清理函数 | 同一隐藏 UI 夹具；搜索键盘路径、空结果、浅深色/系统、减少动态、窄窗及覆盖撤销 |
| 字体来源信息与精简展示 | `appearance/fonts` 保留 `claude` 元数据；`api.fonts.register/list/subscribe` 和外观设置页替换沿用原契约 | 本次只移除来源／回退说明段落；既有字体与批准插件验收继续覆盖选择、实际渲染和停用恢复 |

验收仅使用独立状态与隐藏 Electron，真实 Windows 字体目录只读取家族名称；无真实模型任务、现用客户端操作或远端部署。外观设置与排版代码由本项目编写；第三方字体保持其原作者权利。用户提供的其他产品截图仅作交互参考，不证明其字体包或内部实现。

用户后续明确指定 **Claude 桌面应用的阅读字体**，因此默认 `contentFont` 是 `claude`。已存在的显式 `serif`、`local:*` 或其他字体选择不被迁移覆盖；恢复默认才重置为 Claude 阅读。配置随既有状态存储原子写入 `<app-data>/state.json` 的 `appearance` 字段，包含字体、字号、配色、数字、动态效果及修订号，不修改 Codex/Claude 配置。这里的状态文件可能还包含工作台自身会话数据，插件应通过上述定向接口访问外观，不通过读取整个文件获取无关数据。

`claude` 使用本机安装资源中的 **Anthropic Serif**（实际字体家族 `Anthropic Serif Variable Text`），中文优先 `PingFang SC`、`Microsoft YaHei`、`Noto Sans CJK SC`；未发现字体时使用 Georgia 和系统中文回退。`appearance/fonts` 另返回可选 `claude:{available,italicAvailable,source:'installed-claude',family:'Anthropic Serif'}`。字体不是操作系统安装家族时也单独显示 Claude 阅读预设，不伪装成已安装的系统字体。没有发现字体再分发许可，不复制字体文件进仓库或构建产物，不安装到系统、不导出、不下载。

本机字体引用入口 `ClaudeReferenceFont.status(refresh?:boolean):Promise<ClaudeFontStatus>`、`read(style:'normal'|'italic'):Promise<Uint8Array>` 位于 `host/claude-reference-font.ts`，构造参数 `locate?:()=>Promise<string|undefined>` 用于隔离测试或受信任实现替换。`read` 缺失、损坏或已移除资源统一拒绝为 `APPEARANCE_REFERENCE_UNAVAILABLE`，不暴露安装路径。共享实际实例登记为版本 1 服务 `appearance.reference-fonts`，已批准宿主插件可用 `services.override/intercept` 覆盖其方法，停用恢复原方法；`appearance/fonts` 和下面的字体资源协议均通过这一实例。启动只注册协议，第一次使用时只读查找；刷新目录会重新发现安装版本。Windows 从已安装 Claude 应用的安装元数据定位静态资源；其他平台当前不扫描。结果不返回安装路径，失败为明确不可用，不扫描个人配置、会话或 Cookie。

`awb-font://claude/serif` 和 `awb-font://claude/serif-italic` 是两个固定 renderer 资源，`referenceFontResponse(url,service?)` 返回字体 Response 或无正文 404；不接受路径、查询参数、认证信息、端口或外网 URL。只接受该安装目录 CSS 中声明的对应 WOFF2 家族，核验 realpath 边界、签名和 5 MiB 上限；目录发现最多 1,000 个 CSS / 20 MiB，安装定位子进程 8 秒超时。字体字节仅在读取与浏览器渲染时驻留，不写入配置、缓存文件或发行包。加载失败时使用回退字体。刷新外观字体目录重新发现安装资源；已加载或已失败的浏览器字体会保留至当前窗口结束，安装、卸载或更新 Claude 后重启工作台重新加载。可选本机资源的发现与使用不构成再分发许可承诺。

额外验证：`tests/appearance-reference-font.test.ts` 覆盖缺失、固定路由、错误字体、目录边界、刷新与插件接管/停用恢复；隐藏 UI 的 Chromium 平台字体报告确认默认预览实际使用 Anthropic Serif 和微软雅黑字形，而不只检查 CSS 字符串。字体引用测试不复制商业字体，也不操作 Claude 窗口。字体文件不存在的测试环境报告回退，不能以此声称同款字形已渲染。

### 字体说明精简审查（2026-09-30 JST）

按用户要求移除字体选择区下方常驻的 Claude 来源／回退小字及其专用样式，不增加另一处说明。审查涉及 `appearance/get/set/fonts`、`appearance.reference-fonts`、`FontCatalog.claude`、三个字体选择器与固定 `awb-font` 资源；这些入口、返回值、状态通知、错误、权限和持久化均不变，缺失字体仍自动使用既有回退组合。

调用仍由 `api.call('appearance/fonts')` 读取状态、`appearance/get/set` 读取／保存选择；注册仍由 renderer `api.fonts.register({id:'reading',label:'Reading',family:'Example Serif',fallback:'serif'})` 返回 `{id,dispose}`，同一生产目录进入三个选择器和 `fontStack`；替换字体来源仍由已批准宿主插件 `api.services.override('appearance.reference-fonts',implementation)` 接入实际字体协议。外观页整体替换沿用 `api.registerSettingsPage({replaces:'appearance',...})`。没有新增选项、服务或可交互的局部能力，因此无需新增注册目录或说明文本挂载点；不是通过整页替换代替字体的细粒度接口。

兼容／迁移：移除的 `.appearance-font-source` 是内部说明段落，不是具名 surface；依赖这段说明读取可用状态的扩展应改用 `appearance/fonts`，不保留空节点。旧配置、字体 ID、声明快照和具名挂载点不变。停用、重启恢复、缺失选择保留、失败清理及迟到注册拒绝沿用现有字体生命周期；多插件隔离沿用命名空间及各自释放句柄。没有新异步操作、安装或卸载动作，资源权限没有扩大。

验证位置：`tests/appearance.test.ts`、`tests/appearance-reference-font.test.ts`、`tests/appearance-fonts.test.ts` 和 `scripts/test-appearance-ui.mjs`；使用隔离数据和经真实导入／批准／激活的合成插件，覆盖调用、服务替换、三个选择器与渲染消费、停用／重新启用和激活失败。删除提示的布局另以隐藏 Electron 截图核对；不操作在用客户端，不把共享工作区其他未提交改动算入本次验证。
<!-- appearance-settings:end -->

<!-- image-viewer-glass:start -->
## 图片预览毛玻璃层级（2026-09-30 JST；U112）

图片仍由 `MediaPluginApi.openImages(ids:string[],initialId?:string):Promise<void>` 和 `closeImages():void` 控制，签名、附件 ID 校验、同组翻页、异步过期丢弃及 apiVersion 1 不变。`openImages` 完成表示建立预览，不表示图片解码或导出完成。材质与层级调整不增加持久化设置或模型工具；本轮另增附件命令与菜单注册接口，见下文。附件读取/保存错误继续在预览内显示，缺图时保留关闭按钮，非法选中项仍为 `IMAGE_VIEWER_SELECTION_INVALID`。

全视口 `.image-viewer` 覆盖会话与应用工具栏，背景使用当前主题的半透底色和 backdrop blur，图片本身不模糊。系统窗口控制保留独立顶部区域，图片操作与圆形关闭按钮放在其下方；缩放移至底部居中胶囊，文件名、大小、尺寸和序号继续仅在底部小字显示。顶部拖动区不覆盖图片操作；Ctrl+滚轮、拖动、原尺寸、适应窗口、翻页、标注 PNG 副本及焦点归还沿用原行为。点击图片外空白区域也关闭预览；按下必须起于空白、位移不超过 4 CSS px 且未取消，排除图片本体、操作控件和错误提示，避免拖动或标注后松开误关。导出处理中禁止关闭；标注期间的空白点击与显式关闭一致，丢弃未导出的笔画；Esc 仍先退出标注，再关闭预览。

### 可扩展入口与覆盖矩阵

| 功能 | 实际入口、参数与返回 | 验证 |
| --- | --- | --- |
| 打开、替换、关闭图片组 | `api.media.openImages(ids,initialId?)` → 共享 `ImageViewerHost`；`api.media.closeImages()` | `scripts/test-image-viewer-ui.mjs`、`scripts/test-media-integration.mjs` |
| 毛玻璃主题与控件表面 | `api.addStyle(css:string):()=>void`，设置下表 CSS 变量；返回幂等释放函数 | `scripts/test-image-viewer-ui.mjs` 的实际插件加载/停用 |
| 动态挂载或完整替换 | `api.observeSurfaces('image-viewer',placement,render):()=>void`，沿用多实例上下文、AbortSignal、异步清理契约；工具组、缩放、附件列表和菜单有独立具名挂载点 | 同上；完整替换隐藏内置层，停用恢复当前预览 |
| 空白点击关闭与防误触 | 复用 `api.media.closeImages()` 对应的关闭路径；只改变显式指针手势，不增加事件或权限 | `scripts/test-image-viewer-ui.mjs`；图片点击、跨区拖动、标注及导出中保护 |
| 缩放、标注和导出 | 既有 `attachments/image/reveal/save-as`；原图不可变，标注另存 PNG | `scripts/test-media-ui.mjs`、`tests/attachment-storage.test.ts` |
| 浅深色、窄窗口、长名称与大字号 | `.image-viewer-tools`、`.image-viewer-actions`、`.image-viewer-close`、`.image-zoom`、`.image-viewer-caption` | `scripts/test-image-viewer-ui.mjs`；隐藏 Electron 真实组件与合成附件 |

变量在 `.image-viewer` 上定义，插件样式须使用同一或更具体的选择器；不修改全局主题变量即可替换图片预览材质：

| CSS 变量 | 类型 / 默认值 |
| --- | --- |
| `--image-viewer-backdrop` | CSS color；当前 `--bg` 的 42% 不透明度，透出柔化的背景轮廓 |
| `--image-viewer-blur` | 非负 CSS length；`20px`，保留高斯模糊 |
| `--image-viewer-chrome` | CSS color；当前 `--raised` 的 86% 不透明度 |
| `--image-viewer-border` | CSS color；当前 `--line` 的 80% 不透明度 |
| `--image-viewer-shadow` | CSS box-shadow；低对比内侧亮边和轻微双层阴影 |

```ts
// Explicitly invoked code in an approved renderer package.
api.addStyle('.image-viewer { --image-viewer-blur: 18px; }');
await api.media.openImages([attachment.id]);
// Styles, dynamic mounts and an owned preview are released on disable.
```

上述接口仅限已批准的工作台 renderer 包，沿用本机附件权限，不授予其他设备/账号/系统访问权，也不载入原生运行时插件。插件停用清理材质覆盖和动态挂载，并关闭自己打开且尚未被替换的预览；已经由用户或后续插件替换的视图不误关。完整替换通过原生 `hidden` 隐藏核心层，恢复时保留原选中图片；已开始的导出不回滚。

迁移说明：`.image-zoom` 从 `.image-viewer-tools` 移入 `.image-viewer-footer`，`.image-viewer-caption` 保留作为元数据区域；依赖旧父子结构的插件需调整选择器。关闭按钮可访问名称从“关闭窗口”改为“关闭图片预览”，避免与系统关闭混淆；既有宿主与媒体方法签名不变。没有 blur 支持时回退当前主题实心背景。示例不会自动安装到用户环境。

### 会话附件和全屏预览右键操作

图片的主入口为直接点击缩略图，右键在图片上打开菜单；没有额外“查看图片”按钮。图片、普通文件、历史消息、生成图像结果和草稿附件共用 `AttachmentMenu`，中文菜单跟随主题，自动约束在视口内。全屏图片菜单额外提供适应窗口和原尺寸。普通文件不显示复制图片；草稿移除不删除原件或历史。右键与 Shift+F10 均可打开；方向键/Home/End 导航，Esc/Tab 收起并归还焦点。菜单外点击只收起菜单，不顺带关闭图片。窗口大小变化、失焦或主动滚动外部内容会收起；会话流式输出导致的程序滚动不打断菜单。

| 新增入口 | 类型、参数、返回 |
| --- | --- |
| `api.call('attachments/copy-image',{id})` | `id:string`，已登记附件 ID；`Promise<{copied:true}>`，仅在剪贴板写入完成后返回 |
| `api.call('attachments/open',{id})` | `id:string`；`Promise<{opened:true}>`，验证原文件后显式交给本机默认应用 |
| `api.media.addToDraft(ids)` | `ids:string[]`，1–10 个；`Promise<{added:number,duplicates:number}>`，仅追加到当前活动且可编辑草稿，保留文字与已有附件 |
| `AttachmentStore.copyImage(id)` | 同宿主复制入口；构造选项 `copyImage?:(data:Uint8Array)=>void\|Promise<void>` 接收经校验的原图字节，供受信宿主集成和隔离测试 |

复制图片先走既有 `payloads` 元数据、大小和内容校验，不从缩略图或任意 URL 复制。本机适配器解码后写入 PNG 像素，保留透明通道；动画图片复制当前解码的静态图像，原格式另存为不转换。解码失败或超过 4,000 万像素拒绝。已有 `clipboard/write({text}):Promise<null>` 签名不变，现在等待原生异步写入；拒绝会传播给调用者，不先显示成功。另存为继续返回 boolean，取消为 false，不显示成功通知。

原图或路径操作沿用本机附件权限、保护目录、文件变更校验与用户显式操作边界；菜单不因会话处于运行中而禁用，不读取远端路径、不改变运行中的模型任务。`addToDraft` 通过活动 composer 注册入口进入既有去重、10 个/50 MB 限额与草稿预览失效逻辑；不调用 prepare/submit/steer。异步加载期间切换或锁定草稿会拒绝，不流入另一会话。目标不存在/已锁定、正在导入、目标发生变化和非法列表分别返回 `ATTACHMENT_DRAFT_UNAVAILABLE/BUSY/CHANGED/IDS_INVALID`。复制另有 `ATTACHMENT_IMAGE_INVALID/COPY_IMAGE_UNAVAILABLE`，其余继续传播存储、解码、系统应用或剪贴板错误；中文错误和完成反馈显示在当前界面。

新增 API 是 v1 增量，无数据迁移、无新持久化字段或宿主事件。已批准插件使用上述命令和 `api.media.addToDraft`；宿主可通过 `actions.attachments` 的服务包装/替换控制实际复制路径，原生适配器属于 `desktop.clipboard`。renderer 使用下述注册入口扩充或替换菜单命令，具名挂载点覆盖局部界面；停用移除插件样式/挂载并拒绝旧插件句柄。已经开始的复制、打开或草稿追加不因停用回滚；进行中的草稿追加仍受活动 composer 的修订检查约束，不会写入已切换或锁定的草稿。

### 菜单注册、替换与具名界面

`api.media.registerAttachmentAction(definition:AttachmentActionDefinition):AttachmentActionHandle` 进入生产 `attachmentActions` 注册实例，`AttachmentMenu` 用 `useSyncExternalStore` 订阅，历史、草稿、看图日志与查看器共同消费。返回 `{id:string,dispose():void}`；稳定 ID 为 `plugin:<owner>/<id>`，释放幂等。`definition` 为 `{id,label,surfaces?,kind?,replaces?,run(context)}`：id 为小写字母开头的 1–64 位字母/数字/短横线；label 为 1–80 字符；surfaces 为非空 `'history'|'draft'|'viewer'|'activity'` 数组，省略时全适用；kind 可限 `'image'|'file'`；run 返回 void 或 Promise。数据复制后保存，不受调用方随后修改数组影响。

`replaces` 可为 `view,open,add-to-draft,copy-image,copy-path,reveal,save-as,remove,fit,actual-size,close`。省略时追加命令；指定时只替换该场景确实存在的核心命令，并保留禁用条件。多个插件替换相同命令时最后注册者优先，非后进先出释放也恢复正确的剩余实现。context 为只读 `{attachment,surface,invokeDefault?}`；替换项可调用 `invokeDefault()` 委托核心实现，既有快捷键保持核心行为。停用后的动作或委托句柄拒绝新调用。运行中任务本身不禁用附件操作；正在处理当前附件操作时插件项与核心项一同禁用。

每插件最多 32 项。非法声明、重复 ID、超限或已失效动作分别报 `ATTACHMENT_ACTION_INVALID/DUPLICATE/LIMIT/UNAVAILABLE`；注册通知失败回收该项，异步操作失败显示当前附件错误。注册/释放在当前 renderer 内通知所有已打开菜单，不增加宿主事件或持久目录；失败、停用、升级后由既有插件生命周期统一释放，重新启用重新注册。接口仅开放给完整包已批准的工作台插件，注册本身不访问磁盘、不复制内容、不发送任务。

`api.surfaces` 新增以下名称，`MediaSurfaceName` 声明纳入契约快照：

| 名称 | 实际核心目标与替换范围 |
| --- | --- |
| `image-viewer` | `.image-viewer`，整层图片预览 |
| `image-viewer-actions` | `.image-viewer-actions`，图片操作组；核心关闭按钮独立保留 |
| `image-viewer-zoom` | `.image-zoom`，底部缩放控件 |
| `attachment-list` | `.attachment-list`，所有已存在和后来插入的附件列表 |
| `attachment-menu` | `.attachment-context-actions`，菜单内容，保留外层定位和关闭处理；目标 `data-attachment-id` / `data-attachment-surface` 标识当前附件和场景 |
| `runtime-image-log` | `.runtime-image-log`，模型看图的折叠过程日志，含根会话和原生子会话 |

扩展菜单项应优先使用注册 API，完整局部 UI 替换使用 `observeSurfaces(name,'replace',render)`；任意 DOM 私有层级不作为稳定接口。旧 class 选择器继续兼容；新插件使用名称以减少结构耦合。替换层使用 `hidden`，停用后恢复核心；多实例、异步 mount 清理继承现有 surface 契约。材质仅有现有主题变量覆盖，没有新增主题选项或持久配置，因此不另建材质选择目录。

```ts
const action = api.media.registerAttachmentAction({
  id:'review-image', label:'在外部工具中检查', kind:'image',
  surfaces:['history','viewer'],
  run:({attachment}) => api.call('attachments/open',{id:attachment.id}),
});
// Disposal and plugin disable remove the item from open and future menus.
action.dispose();
```

```ts
await api.call('attachments/copy-image', { id: attachment.id });
const result = await api.media.addToDraft([attachment.id]);
// result.added === 0 can mean the same attachment is already in the draft.
// No model task is sent by either call.
```

| 功能覆盖 | 真实路径与测试 |
| --- | --- |
| 图片/文件/历史/草稿右键菜单 | `AttachmentList` → `AttachmentMenu`；`scripts/test-image-viewer-ui.mjs`、`scripts/test-media-integration.mjs` |
| 原图复制、文件打开和错误传播 | `WorkbenchController` → `actions.attachments.copyImage/payloads` → 原生适配器；`tests/attachment-actions.test.ts`、上述实际 IPC 集成 |
| 活动草稿追加、去重和所有权变更 | `api.media.addToDraft` → `attachmentDraft` → `useAttachments.collect`；同上，含插件旧句柄拒绝 |
| 插件调用、注册和替换 | `registerAttachmentAction` → 生产注册目录 → 四类实际菜单；具名 surface → 动态多实例；`tests/attachment-actions.test.ts` 验证冲突/失败/迟到句柄，`scripts/test-media-integration.mjs` 经真实批准与启停验证 |
| 键盘与关闭防误触 | 全屏内 `+/-` 缩放、`0` 适应、`1` 原尺寸、Ctrl+C 原图、Ctrl+S 保存、标注时 Ctrl+Z 撤销；`scripts/test-image-viewer-ui.mjs`、`scripts/test-media-ui.mjs` |

验收使用合成附件与隐藏 Electron；系统剪贴板写入器和默认应用打开器在测试中替换为观测适配器，核对真实 ClipboardItem 转换后的原尺寸像素和准确本机路径，不读取或覆盖用户剪贴板、不启动外部应用。它不代表第三方应用粘贴兼容性已经实测。

### 原生看图日志与生图结果分流

CLI 原生数据决定操作语义与来源，工作台决定视觉呈现；不把所有图像一律改成展示结果。Codex `imageView` 转为 `category:'image'`，`imageGeneration` 仍沿用既有 `imageDelivery` 保存/展示流程。Claude `Read` 仅在原生工具结果明确包含 image 块时转为看图日志，不按扩展名推测成功，也不保存其 base64 结果到公开活动。普通文本和用户附件入口保持原来的语义。

`RuntimeActivity` 增加可选 `imagePaths:string[]`（经原生事件提取）与 `viewedAttachments:Attachment[]`（预览读取后登记的元数据，不含图片数据）。看图日志默认折叠，折叠时不读取文件；用户展开后仅显示约 78 px 缩略图，不显示文件名、大小、路径或额外打开按钮。根会话与原生子会话相同；点击图片沿用共享查看器，右键的插件 context.surface 为 `activity`。日志更新不自动展开；已展开日志随原生来源或完成状态更新重新读取，并忽略前一次加载的迟到结果。原生状态与内容不由 UI 重新生成。

`api.call('attachments/activity-images',{sessionId:string,activityId:string}):Promise<AttachmentView[]>` → 宿主 `images.viewed.read(input:ActivityImageRequest)` → 本次绑定的原生看图记录 → 已有受保护的附件导入/校验。类型为 `packages/attachments/activity-images.ts::ActivityImagesService`；不接受调用者提供路径或图片字节。相同记录的并发加载合并；登记后复用附件 ID 并校验文件变更，保留历史引用供安全清理。元数据通过原有 `state/onState` 发布，没有新增事件。

仅本机原生路径可用；绑定远端的日志不把相同字符串当作本机路径，也不偷偷下载。错误为 `ACTIVITY_IMAGE_REQUEST_INVALID/NOT_FOUND/REMOTE_UNAVAILABLE/SOURCE_UNAVAILABLE/CHANGED` 及已有附件读取错误。当前路径协议的首次预览读取的是展开时的文件，不宣称重建模型当时所见的像素；缺文件或未返回可用图片时在展开区域提示。异步完成前绑定或记录变化会拒绝写入。旧 Codex 看图记录可复用既有 input 路径；新字段可选，旧配置不需迁移。

已批准宿主插件可 `api.services.intercept('images.viewed','read',handler)` 或 `override('images.viewed',{read})` 接入其他已核验图片来源；此同一服务被实际 IPC 消费，停用恢复核心，不另开任意路径读取权限。renderer 可使用 `observeSurfaces('runtime-image-log','replace',render)` 替换日志，或通过 `registerAttachmentAction({surfaces:['activity'],...})` 注册选项。类型、命令与具名 surface 更新契约快照；示例与合成插件不安装到用户环境。

| 覆盖 | 验证位置 |
| --- | --- |
| CLI 看图/生图区分、来源、并发、过期结果与服务替换 | `tests/activity-images.test.ts`、`tests/runtime-reading.test.ts` |
| 默认折叠、无文件名小图、直接打开、右键、根/子日志、多实例和停用 | `scripts/test-runtime-image-log-ui.mjs` |
| 真实批准宿主插件覆盖实际图片读取 IPC 并恢复验证 | `scripts/test-media-integration.mjs` |
| 原有生成结果、保存状态、根/子会话与导出保持 | `scripts/test-generated-images-ui.mjs`、`tests/generated-images.test.ts` |

<!-- image-viewer-glass:end -->


<!-- theme-presets:start -->
## 浅深色模板与代码着色扩展（2026-09-29 UTC；U117）

此前的 `addStyle` 与 manifest `contributes.theme` 只覆盖样式，不等同于注册可选择模板。本次在 API v1 增量开放 `RendererPluginApi.themes`、`RendererPluginApi.syntax`，保留既有样式、设置页与整壳替换能力；旧插件无需迁移。新接口类型和外观状态一起纳入插件契约快照。

### 持久选择与渲染

`AppearanceSettings` 新增 `lightPreset:ThemePresetId`、`darkPreset:ThemePresetId`，默认分别 `builtin.paper` / `builtin.charcoal`；继续使用 `appearance/get/set`、修订比较、状态事件与 `state.json` 的 `appearance` 字段。浅深色模式仍由既有 `theme/set` 管理；系统模式分别使用两种已保存选择。首次解析旧 `palette:'neutral'` 映射为 `builtin.porcelain` / `builtin.graphite`，旧 `warm` 映射默认组合；显式 ID 优先。保留旧 `palette` 参数：旧调用者主动写入它会选择对应的两套预设，其他字段保持。新 UI 选择预设只改对应模式 ID 并清除自定义 `accent`，保留独立字体、字号和另一模式的预设。

`ThemePresetId` 格式为 `builtin.<id>` 或 `plugin:<owner>/<id>`，最长 180 字符，不接受路径或 CSS。非法 ID 返回 `APPEARANCE_INVALID_PRESET`；格式合法但资源未注册或模式不符时，保留 ID 并临时回退到该模式内置默认，不静默重写选择。外观页明确显示缺失提示。重新注册原 ID 会自动恢复；升级应保留兼容 ID。`reset:true` 恢复两种默认 ID 和既有默认排版。

内置十二套独立颜色数据位于 `packages/appearance/themes.ts`，浅色为晨纸、瓷白、海盐、青苔、鸢尾、麦芽，深色为炭墨、石墨、深海、松夜、暮紫、余烬。每套包含背景、侧栏、表面、文字、边线、强调色及代码色，不通过修改字体伪装为新主题。`useThemePresets()` 订阅注册目录；`applyAppearance` 为两种模式生成变量层，同优先级插件 `addStyle` 仍在后层生效。

### 主题注册接口

| 入口 | 参数与返回 | 事件、错误和生命周期 |
| --- | --- | --- |
| `api.themes.register(definition)` | `ThemePresetDefinition` → `{id:ThemePresetId,dispose():void}` | 同步进入实际选择器；dispose 幂等；插件停用/失败/换 hash 自动释放，注册通知同步触发失败时也回收刚取得的资源 |
| `api.themes.list()` | 无 → `readonly ThemePreset[]` | 返回内置及已激活插件模板的只读快照，不含安装路径 |
| `api.themes.subscribe(listener)` | `()=>void` → 退订函数 | 注册/释放时通知，回调可重新 list；随插件释放，异常沿用 renderer 失败处理 |

`ThemePresetDefinition`：`id` 为以小写字母开头、最多 64 字符的小写字母/数字/短横线；`label` 1–80 字符；可选 `description` 最多 200 字符；`mode:'light'|'dark'`；可选 `base` 为同模式内置 ID，缺省使用该模式默认；可选 `colors:Partial<ThemeColors>`、`syntax:Partial<SyntaxColors>`。实际 ID 自动加入当前插件 owner，不能注册覆盖内置或其他插件 ID。每插件最多 64 项；重复 ID 拒绝，不以后到覆盖。数据复制并冻结，不受调用方事后修改影响。

`ThemeColors` 键：`bg,side,surface,raised,text,muted,line,hover,tint,accent,danger,warning,selection`。`SyntaxColors` 键：`background,foreground,keyword,string,number,comment,function,type,punctuation`。颜色必须为六位十六进制；不接受 URL、任意 CSS、未知键或字体字段。强调色文字对比色由核心生成。错误为 `APPEARANCE_THEME_INVALID`、`APPEARANCE_THEME_DUPLICATE`、`APPEARANCE_THEME_LIMIT`、`APPEARANCE_THEME_BASE_UNAVAILABLE`；失效 renderer API 沿用 `Plugin renderer is no longer active.`。内置颜色通过对比检查，第三方主题自身的视觉质量仍须由作者验证。

~~~js
export function activate(api) {
  const light = api.themes.register({
    id:'lagoon', label:'琉璃海', mode:'light', base:'builtin.sea',
    colors:{accent:'#296d63'}, syntax:{keyword:'#76518c'}
  });
  // Call only after an explicit user selection; registration alone does not select.
  async function select() {
    const current = await api.call('appearance/get');
    await api.call('appearance/set', {revision:current.revision,patch:{lightPreset:light.id}});
  }
  api.themes.subscribe(() => console.log(api.themes.list().map(item=>item.id)));
  return () => light.dispose();
}
~~~

接口属于已批准的 renderer 包（现有 `host` capability），不加载 Codex/Claude 原生插件、不授予新的设备或系统权限。参考 `examples/plugins/theme-studio`；示例仅留在仓库，不预安装到实际用户数据。模板数据只随当前插件代码注册；用户配置只保存 ID，注册/释放不改动代码批准 hash 或用户字体配置。

### 语法、代码字体与替换接口

`SyntaxCode` 为外观预览和 Markdown 代码块提供源码保真的词法着色，使用 `--font-mono` / `--code-font-size`，不随正文或界面字体覆盖。预览可切换 TypeScript、Python、JSON；核心着色另支持 JavaScript、Shell 及其常见别名，未知语言保持原文。它不是语义编译器，不承诺完整语言语义着色。`packages/appearance/syntax.ts::highlightCode(text,language)` 输出 `{text,kind}[]`；代码不执行，不解释 HTML，不发请求，复制仍使用原始代码。超过 128 Ki 字符或 20,000 个 token 时保留纯文本，避免大回复着色阻塞。

`api.syntax.highlight(text,language)` 调用当前着色器；`api.syntax.register(language,highlighter)` 返回幂等释放函数，可新增语言或暂时替换已有语言；相同语言最后注册者生效，非后进先出释放也不会覆盖剩余实现。`language` 为最多 32 字符的小写语言标识（字母开头，可含数字、`+`、`-`），非法参数返回 `APPEARANCE_SYNTAX_INVALID`。`highlighter:(text:string)=>readonly SyntaxToken[]` 必须保留完整原文；kind 只能为 `plain,keyword,string,number,comment,function,type,punctuation`。抛错、超限或返回文字与原文不符时回退核心着色，不把扩展输出当成代码或 HTML。`api.syntax.subscribe(listener)` 返回退订；注册/释放更新所有已挂载代码块，停用/失败自动释放。例：`api.syntax.register('config', text => [{text,kind:'string'}])`。受信任同步插件仍须控制自身执行开销，宿主不宣称能打断其无限循环。

新增 CSS 变量：`--code-bg`、`--code-text`、`--syntax-keyword/string/number/comment/function/type/punctuation`，以及既有 `--selection-bg`。`monacoTheme(document)` 将当前 CSS 颜色转换为 Monaco 主题；配色、模式及插件样式变化更新已挂载编辑器，不重建模型或丢失位置。Monaco 保留自身语言解析器，其语义分类不冒称与轻量正文着色器完全相同。

| 功能覆盖 | 实际扩展点 | 验证位置 |
| --- | --- | --- |
| 模板选择、持久化、模式和旧配置 | `appearance/get/set`、`ThemePresetId` | `tests/appearance-themes.test.ts`、既有 controller 持久化测试与隐藏 UI |
| 新主题注册、目录与缺失恢复 | `api.themes`、`ThemePresetRegistry` | 同上；真实 ZIP 批准、注册、重载、停用、重新启用、失败清理 |
| 高亮与独立代码字体 | `api.syntax`、`SyntaxCode`、CSS 变量、`monacoTheme` | 源码保真、异常回退、TypeScript/Python/JSON、回复代码及已挂载 Monaco |
| 示例与兼容门禁 | `examples/plugins/theme-studio`、契约基线 | `scripts/check-plugin-contracts.mjs`，保留旧 API v1 调用 |

桌面验证入口为 `scripts/test-appearance-ui.mjs` 与 `scripts/theme-preset-ui-checks.mjs`，使用独立状态、真实插件注册和隐藏 Electron。源码/协议测试与当前在用客户端、真实模型或远端部署分开报告。
<!-- theme-presets:end -->

<!-- plugin-followup:start -->
## 近期功能插件适配复核与紧凑主题选择（2026-09-29 UTC）

范围为 `42daed7` 至 `43d4165` 的 12 个已提交变更；逐项结论、生产路径与证据见 [近期功能审计](plugin-feature-audit-20260929.md)。随后其他窗口提交和未提交功能不自动纳入本次审计结论。本次修复字体贡献无法进入真实选择器、局部 UI 缺少具名定位以及契约门禁遗漏公开常量的问题；不是全仓或任意第三方插件组合兼容的保证。

### 功能覆盖矩阵

| 功能 | 公开入口与实际消费者 | 验证位置 |
| --- | --- | --- |
| 紧凑主题菜单 | 原 `api.themes.register/list/subscribe` → 主题行 → 内置/插件分组子菜单 → `appearance/set` | `scripts/theme-preset-ui-checks.mjs`：全部 12 个预设、键盘/点击/失焦、浅深色及窄窗 |
| 插件字体注册 | `api.fonts.register/list/subscribe` → 三个 FontPicker → `fontStack` / `useAppearance` → 正文、UI、代码及 Monaco | `tests/appearance-fonts.test.ts`、`scripts/test-appearance-ui.mjs`；真实批准 ZIP、重载、停用/重启用、激活失败与通知重入清理 |
| 具名局部替换 | 下表新增的 `api.surfaces` 名称 → `api.observeSurfaces(name,placement,render)` | 真实主题行和连接布局替换、通用多实例/异步清理；`scripts/test-file-browser-lifecycle-ui.mjs`、`scripts/test-plugin-extensibility.mjs` |
| 近期宿主功能生命周期 | 真实 `models.accounts`、`sidebar.order`、`actions.remote-cli`、`actions.session-storage` 服务及 `translation/quick-toggle` | `tests/recent-feature-plugins.test.ts`：批准 ZIP 调用/拦截/覆盖、停用及重启用；远端为合成适配器，无 SSH 请求 |
| 契约漂移门禁 | `npm run check:plugins` 增加字体、侧栏排序、账号、记忆回执、CLI/清理声明、具名 surface 及核心设置页 ID | `scripts/check-plugin-contracts.mjs`、`tests/plugin-contract-gate.test.ts`；签名检查不替代生产行为测试 |

### 字体贡献契约

`RendererPluginApi.fonts:FontPluginApi`，类型位于 `packages/appearance/fonts.ts`：

- `register({id:string,label:string,family:string,fallback?:'system'|'serif'|'mono'}):{id:PluginFontId,dispose():void}`。局部 ID 为小写字母开头、字母/数字/连字符组成，最长 64 字符；label 最长 80 字符。family 为一个安全的字体家族名，沿用 `validFontFamily` 校验，禁止注入 CSS。未指定 fallback 时为 system。只注册选择元数据，不下载、安装、复制或验证字体字节。
- `PluginFontId = plugin:<owner>/<local-id>`，owner 由实际批准的插件注入，不能冒用其他 owner。每个插件最多 64 个条目，同一 owner/id 不允许重复；不同插件可用相同局部 ID。未知字段拒绝。
- `list():readonly FontPreset[]` 返回不可变快照，条目为 `{id,owner,label,family,fallback}`；`subscribe(listener:()=>void):()=>void` 在注册/释放后通知。退出后快照保持原值，下一次 list 返回新快照。释放和退订幂等，停用、卸载、失败和迟到 API 调用沿用 renderer 生命周期；通知期间自身插件失败也不得留下新条目。
- 错误为 `APPEARANCE_FONT_INVALID/DUPLICATE/LIMIT`。持久选择的格式非法返回既有 `APPEARANCE_INVALID_FONT`；失效 API 仍拒绝为 `Plugin renderer is no longer active.`。没有新增宿主权限或自动用户配置写入。

三个字体选择器均显示注册目录，并通过既有 `appearance/set` 的 revision 比较保存独立选择。注册/释放实时更新已挂载选择器、正文与 Monaco，不重建编辑内容。插件字体缺失时，保留 ID：UI 回退系统字体、正文回退现有阅读字体栈、代码回退等宽字体栈；菜单明确“插件字体暂不可用（选择已保留）”。原 ID 重注册后恢复。家族已注册但字形加载失败时由浏览器使用声明的 fallback，不把目录注册成功当作字体加载证明。

~~~js
export async function activate(api) {
  // Use a font whose license permits packaging. An installed family also works.
  const url = await api.assetUrl('fonts/example.woff2');
  api.addStyle(`@font-face{font-family:"Example Plugin Font";src:url("${url}") format("woff2");font-display:swap}`);
  const face = api.fonts.register({id:'reading',label:'示例阅读字体',family:'Example Plugin Font',fallback:'serif'});
  // The user selects it in Appearance. Registration does not change preferences.
  api.onDispose(face.dispose);
}
~~~

`assetUrl/addStyle` 沿用已批准包资源和 CSP；未增加外网字体下载。示例字体仅是占位文件名，不随仓库分发；字体授权仍由插件作者负责。apiVersion 1 增量新增属性，旧 `local:` 家族、内置组合、Host `appearance/fonts` 的本机发现结果及既有存储版本保持不变。字体贡献目录只在 renderer 生命周期中存在，宿主验证并保存稳定 ID，不将该目录混进本机操作系统字体列表。旧工作台版本不认识新增 plugin 字体 ID，降级会回退；不承诺降级写配置无损。

### 紧凑菜单与具名挂载点

设置页将原来常驻的预设网格改为“主题”一行，触发器仅显示当前名称与 Aa 色标；点击后按内置/插件分组，子菜单滚动显示名称与选中标记。浅深色仍分别保存，切换预设仍保留字体字号并恢复预设强调色；选项悬停不会改变设置。方向键/Home/End 导航、左右键进出、Escape 返回及关闭、Tab/外部点击收起；弹层避开窗口边缘。关闭时不挂载预设条目。

| 公开 surface 名称 | 核心目标（由主程序维护映射） |
| --- | --- |
| `appearance-theme` | `[data-workbench-theme-picker]`，主题行 |
| `connection-layout` | `.connection-layout`，连接分栏 |
| `remote-files` | `.remote-file-dock`，远端文件区 |
| `remote-cli-row` | `.remote-cli-row`，每个运行时的维护行 |
| `session-retention` | `.remote-retention`，会话清理区 |
| `model-accounts` | `.local-model-accounts`，本机官方账号区 |
| `model-usage` | `.model-usage-summary`，每个来源的用量区 |
| `translation-toggle` | `[data-testid="translation-quick-toggle"]`，可见时的临时开关 |

例：`api.observeSurfaces('model-usage','after',({root,signal})=>{ root.textContent='Extension usage controls'; return ()=>stopOwnedWork(signal); });`。插件应使用具名入口并返回清理函数，继续支持 before/after/replace、多实例及后来插入实例；目标移除会 abort，停用清理并恢复核心可见性。替换视图不自动触发原操作或增加权限；已执行的宿主操作不因移除视图而回滚。错误、异步失败隔离、订阅和 onDispose 沿用 SurfaceRenderer 契约。

迁移：旧 `.appearance-preset-grid/.appearance-preset-scene` 等网格子结构已经撤下，`appearance-presets` 测试定位只表示主题行；`preset-<id>` 仅菜单打开时存在，不是公开调用入口。读取/选择预设使用 `api.themes` 与 `appearance/get/set`，替换选择器使用 `appearance-theme`，不恢复 CSS 驱动的全展开网格。其他旧 CSS 定位仍被通用 API 接受，但具名 surface 的内部映射变化现在纳入契约审查。

契约快照文件仍为 `plugin-contracts-v1.json`（插件 API v1），其内部 schemaVersion 升至 2 以记录公开常量；不是插件清单版本升级。刷新基线前须审阅声明和行为迁移，门禁本身不能证明任意 DOM 或私有方法稳定。AGENTS.md 已增加每次调整的前置盘点、注册贯通、行为证据、同批文档和提交前核对要求。
<!-- plugin-followup:end -->

<!-- system-mode-icon:start -->
## 系统模式缩略图修复（2026-09-29 UTC）

| 受影响功能 | 调用、注册与替换路径 | 本轮验证 |
| --- | --- | --- |
| 外观页的系统模式示意图 | `theme/set`、`state/get/onState` 与现有设置页生命周期不变；仅修正核心 CSS 的分割方向和级联 | `scripts/theme-mode-preview-checks.mjs`：真实像素、六种缩放/模式组合、批准插件调用及停用恢复 |

范围仅为装饰缩略图：背景只保留一次垂直明暗分割，小侧栏保持浅色；浅色旧规则降低选择器优先级，避免覆盖外观控件。三个按钮的 DOM、标签、选择状态、事件与持久配置不变。核心 CSS 选择器仍是实现细节，不因本轮测试变为永久公开契约。

- **调用与状态：** 继续使用 `api.call('theme/set',{theme:'system'})`，由真实宿主保存策略，renderer 随系统配色变化。返回值、错误、权限和状态事件沿用已有契约；缩略图没有自己的配置或运行时状态。
- **注册：** 本轮没有新增模式或可选目录；system/light/dark 是既有跟随/固定策略，图标修复不构成新模式的注册点。第三方配色预设仍经 `api.themes.register` 进入真实选择器与消费方，无新增硬编码预设分支或资源。
- **替换与生命周期：** 已批准插件的 `api.addStyle` 覆盖继续生效，停用/失败释放样式；需要替换外观页面时仍使用 `api.settings.register({id:'custom-appearance',label:'外观',replaces:'appearance',render})`。本次批准 ZIP 回归验证样式启停、重新启用、实际 `theme/set` 调用与系统切换；不是将 CSS 单独当成整个主题功能的扩展证明。
- **兼容：** 没有公开声明、具名 surface、持久格式或参数变化，契约快照无需刷新。旧页面/主题/字体扩展路径保持原样；多实例、异步挂载及页面替换沿用既有通用生命周期，本次没有新挂载实现。修复前的真实像素检测失败，修复后须同时通过浅深色与 100%/125%/150% 缩放验证，不能仅凭 CSS 字符串宣称图标正确。
<!-- system-mode-icon:end -->

<!-- system-mode-diagonal:start -->
### 系统模式图标保留斜切（2026-09-29 UTC）

按用户明确偏好，系统模式示意图恢复单一 110° 斜切；侧栏继续使用浅色实体背景，不再单独绘制第二条斜切。上一节的垂直分割是此前修复方案，当前以本节为准。

| 功能覆盖 | 接口影响与验证 |
| --- | --- |
| 模式示意图斜切 | 只改变核心背景角度；调用仍为 `theme/set` 与既有状态事件，注册仍为 `api.themes`，样式及外观页替换仍沿用上一节入口。无新增选项目录、资源、权限、参数、返回值、错误、持久格式或公开声明，契约快照不变。 |

`scripts/theme-mode-preview-checks.mjs` 的真实像素验收改为：空白扫描行仅有一次明暗转换，分界位置随高度倾斜，浅色侧栏没有额外暗楔形；同时覆盖浅深色及 100%/125%/150% 缩放。既有批准插件样式启停、重新启用、实际模式调用和系统跟随回归继续执行；不新增生命周期或依赖私有 DOM 的稳定性承诺。
<!-- system-mode-diagonal:end -->

<!-- session-feedback-following-20260930:start -->
## 缓存命中率与回合进度位置（2026-09-30 JST）

本节按本次用户修订覆盖此前“部分计数一律不显示命中率”和“停止不显示耗时”的规则。运行中的计时位于输入区上方、独立于正文滚动；停止或失败后回到该回合末尾，正常完成后保留在最终回复前的过程折叠入口。下一次明确发送建立新计时，不把旧回合时钟带入固定区。

### 接口先审与功能覆盖矩阵

| 功能 | 调用现有能力 | 注册新实现或选项 | 替换实际实现与验证 |
| --- | --- | --- | --- |
| 会话及模型命中率 | session/metrics({sessionId:string}):Promise<MetricsSnapshot>；models/usage 保留既有查询参数；cacheHitRate(records:readonly Pick<TokenCounts,'inputTokens'\|'cacheReadTokens'>[]):number\|null | RuntimeAdapter 经现有 runtimes.register 注册并 await emit({type:'usage',usage:UsageSample})，数据进入真实记录、选择器和 UI；本次无新设置目录 | 同名宿主方法中间件及 renderer.observeSurfaces('session-metrics','replace',render)；tests/session-metrics.test.ts、tests/model-management.test.ts |
| 固定活跃计时与历史耗时 | state/get 的 Session.turnTimings；readingTurns(entries,session):ReadingTurn[]；turnElapsedMs、formatTurnDuration | 注册 renderer.observeSurfaces('turn-progress',placement,render) 或 'active-turn-progress'，返回清理句柄，适用于所有运行时和多个工作区实例 | Workspace 把唯一活跃 TurnProgress portal 到输入区前的真实固定容器；scripts/test-session-feedback-ui.mjs |
| 过程折叠与中断说明 | readingTurns 的 completed/attention/timing；TurnTiming.error?:string 是所属回合的公开错误说明 | 注册具名 'turn-process' 和 'turn-error' surface；无新增运行时枚举或固定模型名单 | ConversationReading 生产实例提供 data-turn-id、过程 data-process-completed；tests/runtime-reading.test.ts、tests/turn-timing.test.ts、上述 UI 脚本 |
| 中断前已完成文件修改 | 既有 Session.fileChangeRecords、conversationTimeline、FileChangeCard | 文件能力沿用原生运行时适配和既有文件卡片接口；本次不新增文件写入、撤销或修改选项 | 卡片仍在所属回合、位于中断说明之后和末尾耗时之前；tests/file-changes.test.ts、上述 UI 脚本 |

所有命中率使用同一函数：筛选同一条记录中同时存在输入与缓存读取计数的样本，将缓存读取求和除以输入求和。没有有效正分母时为 null；实报零读取为 0；缓存写入、输出和未报告项不计入分子，也不将缺失项补零。缺失记录不再使其他已知记录的比例消失，累计 token 的 incomplete/partialHistory 和下界语义保持。会话总计、运行时/模型分组和账号/API 模型用量采用同一口径。

### 事件、权限与生命周期

沿用 state/onState、已批准 renderer 和 runtime 生命周期，没有新增轮询、模型调用、权限或持久配置。新增五个具名 surface：session-metrics、turn-progress、active-turn-progress、turn-process、turn-error；对应 data-session-metrics、data-turn-progress、data-active-turn-progress、data-turn-process、data-turn-error。计时含 data-turn-id 和 data-turn-status；固定容器含 data-session-id。每个实例由 observeSurfaces 管理，挂载、移除、异步清理、多插件覆盖、激活失败和停用恢复均走生产注册实例。

公开完整性错误仍为 SESSION_USAGE_INVALID；时间输入错误仍为 TURN_TIMING_INVALID_TIMESTAMP；插件注册失效沿用既有 renderer/runtime 错误，无新增错误码。输入计量字段、UsageSample、MetricsSnapshot 的原有成员和 session/metrics 参数保持兼容；新 error 字段可选。既有 '[data-turn-progress]' 与 '[data-session-metrics]' 定位继续有效，但不能再假定活跃计时是 .reading-turn 的后代；新实现请使用具名 surface。ConversationReading 新增可选 activeProgressTarget?:HTMLElement|null，省略保留内联兼容，null 等待固定容器，HTMLElement 作为运行时计时的挂载目标。

正常完成依赖原生结束回执，单条 final 文本或停止输出不表示回合已结束。Codex 使用 turn/completed 与消息 phase；Claude 使用 result，适配器将最后助手消息标为最终回复。过程中的工具、进度和公开思考状态按回合身份分组；用户输入、最终回复、文件卡片保持可读，折叠不删除或压缩模型上下文。已恢复的失败尝试属于历史，不再阻止成功回合折叠；仍在运行或结果未知的活动继续保留注意状态。停止、失败和结果未知不按成功折叠；已确认结束的耗时冻结在末尾，未知结束不伪造精确用时。

TurnTiming.error 在本机观察到终止时保存已有公开 nativeError；终止后迟到的说明仍绑定同一原生回合，下次发送不会清空旧说明。此前已经丢失的错误无法补造；旧记录没有 error 仍可读取。未产生用户消息就失败的准入也保留其独立错误与末尾计时。无新资源或配置目录，因此选项停用后选择回退、配置修订比较和资源导出在本次不适用。

```js
const usage = await api.call('session/metrics', { sessionId });
api.observeSurfaces('turn-progress', 'replace', ({ root, target }) => {
  root.textContent = `Turn ${target.dataset.turnId}: ${target.dataset.turnStatus ?? 'unknown'}`;
  return () => { root.textContent = ''; };
});
api.observeSurfaces('turn-error', 'after', ({ root }) => {
  root.textContent = '可展开本回合记录查看中断前的修改。';
});
```

### 兼容验证与边界

`scripts/test-session-feedback-ui.mjs` 通过隔离 ZIP 的真实 import/approve/activate 生命周期加载合成插件，贯通上述具名入口和生产组件；覆盖已有及后来新增实例、移除、异步清理、多插件叠加、停用/重启用、激活失败及核心恢复。未安装开发示例到用户环境。契约检查新增覆盖 TurnTiming、计量快照和 ReadingTurn 类型，并审阅五个具名 surface 的增量；不以刷新快照替代行为检查。

定向测试与隐藏 Electron 验证命中率、两家回合状态、长输出/滚轮、停止/失败后新发送、保留错误和文件卡片、浅深主题与窄屏。生产参数构建输出到忽略验收目录。未操作在用客户端、发起真实模型任务、读取聊天数据库、更新 CLI 或部署远端；共享工作区其他未提交变更不属于本轮验收结论。
<!-- session-feedback-following-20260930:end -->


<!-- structured-memory-citations:start -->
## 回复底部的结构化记忆引用（2026-09-29 UTC；U96）

接口审查范围：本机 NativeProviderRunner、SSH NativeCodexRunner、既有 Message.original/memoryReferences、state/get 与 state 通知、已完成回复工具栏，以及引用图标的多实例挂载点。无新增宿主命令、模型工具、配置、资源、运行时枚举或自动任务；主题、字体及提供方目录不受影响，因此本次不另建这些目录的注册接口。

| 功能覆盖 | 调用现有能力 | 注册新实现或来源 | 替换现有实现 |
| --- | --- | --- | --- |
| 原生引用保存与查询 | api.call<AppState>('state/get')；Message.memoryReferences?:{title:string,path:string,source:'native-citation'或'native-read'}[]；api.onState(listener):()=>void | api.runtimes.register(definition,adapter):()=>Promise<void> 接入真实运行时选择器与执行桥；adapter 经 ctx.emit({type:'message',id,text,phase:'final'}) 提交已有显式引用标签格式，完成回复消费同一解析路径 | 注册运行时提供其引用来源；显示替换通过下一行的具名局部挂载点，不要求替换整个应用 |
| 回复底部记忆图标与来源浮层 | state/get 返回原文及引用数组；原生未提供证据时不展示；悬停或键盘聚焦只显示元数据，不打开文件或启动任务 | api.observeSurfaces('reply-memory','after',render):()=>void 为每个现有及后续引用图标添加视图；SurfaceContext 提供 root、target、signal | placement:'replace' 替换全部匹配实例；注册顺序决定当前层，停用恢复剩余层或核心图标 |

生产链路：item/completed 的 agentMessage.memoryCitation → 两条原生接收器 → memoryCitations(text,nativeCitation?) → Message.memoryReferences → 持久状态及既有 state 通知 → replyMemoryReferences → 已完成回复的 ReplyMemory。SSH 的显式结果核对复用同一接收器。新字段是已经存在的原生字段，本次没有引入新的工作台存储格式；可选参数不破坏既有 memoryCitations(text) 调用。结构化有效条目先加入，旧正文标签继续解析，按路径及标题去重，最多 50 条；空 note 回退路径，非字符串路径/说明及无效行范围忽略，坏条目不影响有效同级条目或旧标签。行范围仅用于验证，不改变既有 path/title 结构；threadIds 不用于打开聊天或补扫原生资料。

兼容和迁移：已有引用数组继续优先，空数组仍可回退完整正文标签；没有结构化字段的旧运行时和插件标签照常显示。源正文保持运行时返回值，翻译与复制使用既有 visibleReply 行为。下个无引用回复不继承上个来源。过去已丢失元数据、正文也无标签的记录保持无图标，不根据模型自述、工具命令或正确答案推断来源。Claude 的成功结构化 Read 仍标为“本轮读取”，规则不变。

具名 surface reply-memory 对应既有 [data-testid="reply-memory"]；旧选择器保持可用，新插件优先使用名字。data-reply-id 仍是所属助手消息 ID，可从 target.closest('[data-reply-id]') 取得并对照 state。挂载回调可返回释放函数或异步释放结果；移除实例、停用、激活失败及包移除沿用多实例清理和 AbortSignal，迟到结果不得重新隐藏核心图标。核心图标响应 hidden，浮层出现时解除父工具栏半透明，保持路径可读。旧 CSS 的隐藏优先级不作为兼容承诺。

权限与错误：代码包沿用整包明确批准及 apiVersion 1；展示引用不授予文件读取、跨设备或账号权限。非法引用元数据降为无该条显示，不令已完成回复失败，不额外产生重试事件。插件注册的冲突、失效及 renderer 激活错误沿用运行时与 surface 的现有规则；旧插件不需要声明新权限。

```ts
// Renderer entry in an explicitly approved package.
export function activate(api) {
  api.observeSurfaces('reply-memory', 'replace', ({root, target, signal}) => {
    const messageId = target.closest('[data-reply-id]')?.dataset.replyId;
    const paint = state => {
      if (signal.aborted) return;
      const message = state.sessions.flatMap(s => s.messages).find(m => m.id === messageId);
      root.textContent = (message?.memoryReferences ?? []).map(r => r.title).join(', ');
    };
    const release = api.onState(paint);
    api.call('state/get').then(paint);
    return release;
  });
}
```

测试位置：tests/memory-citations.test.ts（结构化/旧格式、坏条目、限额、两条接收路径、SSH 显式核对及状态重启）、tests/turn-actions.test.ts、tests/permissions.test.ts；scripts/test-memory-citations-ui.mjs 使用实际安装 CLI、本机合成上游、隔离隐藏 Electron 和经真实导入/整包批准/激活的 ZIP 插件。覆盖调用、选择器到注册运行时输出、现有与后来实例、多个插件、异步迟到、失败、停用、重新启用和包移除。契约快照只增加 reply-memory 名称，审查未改变现有 SDK 声明或宿主入口；插件行为验收不以刷新快照代替。
<!-- structured-memory-citations:end -->

<!-- codex-account-access:start -->
## Codex 登录、凭据导入与共用账号卡片（2026-09-29 UTC）

实现前审查覆盖 models/accounts 登录及状态命令、NativeAccountTransport、AccountLogin、LocalModelAccount、SSH AccountCatalog、会话账号选择器、公开姓名配置与局部挂载点。登录与导入目录由生产 AccountAccessRegistry 同时供选择器和执行器消费；本机与 SSH 仅共用 AccountCard 展示与名称/邮箱语义，原生登录流程独立。没有新增运行时或远端权限。文件格式仅为输入格式目录，不新增模型厂商目录；本次没有新的字体、主题或资源注册需求。

| 功能覆盖 | 调用已有能力 | 注册新的实现或选项 | 替换及恢复 |
| --- | --- | --- | --- |
| 本机登录目录/执行 | login-methods → models.account-access.methods；login-start → start → 官方 transport | registerLogin(owner, definition) → AccountAccessHandle；实际 UI 与执行器共用此实例 | services.intercept('models.account-access','start',…) 按 method 替换单方式；释放恢复；不是替换整应用 |
| Codex 凭据导入 | import-formats / import → formats / parse → 校验 → 独立原生文件 → refresh | registerImporter(owner, definition) → 可释放句柄；插件格式进入真实下拉与提交路径 | services.intercept 的 parse 按 format 替换；异步停用结果拒绝，已轮换凭据保留 |
| 认证后建卡、名称 | prepare / refresh / rename；SSH accounts/rename → models.account-names.rename | 没有新的命名规则选项目录；第三方可经已批准服务拦截注册命名实现 | models.accounts.refresh、models.account-names.apply/rename 为具名替换位置；不改远端身份 |
| 本机/SSH 共用卡片 | AccountCardProps；卡片携带 data-account-id、data-provider | observeSurfaces 支持现有及后来多个实例 | model-account-card、account-name-editor、account-identity-email 的 replace；停用恢复 React 原内容 |
| 登录/导入局部 UI | model-account-login、model-account-import | 多实例 observeSurfaces | 注册/替换局部界面；保留核心取消与原生目录归属 |

### 命令、状态和类型

下列异步命令由 api.call 调用；id、jobId、revision 均使用上一回执值。

| 入口 | 参数 | 返回与行为 |
| --- | --- | --- |
| models/accounts/prepare | {provider:'codex'或'claude'} | LocalModelAccount 临时草稿；无持久卡片，无登录副作用 |
| models/accounts/draft-discard | {id:string} | {discarded:boolean}；取消所属登录、移除临时元数据；保留可能已签发/轮换的原生文件 |
| models/accounts/login-methods | {id:string} | AccountLoginMethod[]：id、label、description、available、reason? |
| models/accounts/login-start | {id,revision,method} | AccountLogin；Codex desktop/browser/device；Claude browser/sso/console；或插件命名空间 ID |
| models/accounts/login-callback | {id,jobId,url:string} | AccountLogin；仅接受本次 state、code 和原生 loopback redirect；最多 16,384 字符，无跳转跟随 |
| models/accounts/import-formats | {id:string} | AccountImportFormat[]：id、label、description；仅 Codex |
| models/accounts/import | {id,revision,format?:string,contents:string} | {imported,accounts,verification:'pending',failure?,remaining?}；2 MB/100 条上限；部分完成时保留已导入项并停止后续项 |
| models/accounts/rename | {id,revision,name:string} | LocalModelAccount；1–100 字符，与 revision 比较；只改名称 |
| accounts/rename | {id:hostId,accountId,generation,revision?:string,name:string} | SharedAccount；本机别名按 authority/catalog generation/provider/account generation 绑定；不写 SSH 凭据或远端配置 |

草稿只有在官方 inspect 确认 authenticated、模型目录非空且邮箱存在后，才保存为账号卡片，默认名称为完整邮箱；取消中途核实时拒绝晚到建卡。AccountLogin 增加 callbackSupported?:boolean 与 browserError?:string；URL/code 属于短期交互信息，不持久化。导入内容仅进入指定账号的原生目录，不进入 AppState、事件、日志或模型上下文。支持 auth.json、Agent Identity 对象/JWT、账号 JSON/数组、Sub2API accounts/credentials、CPA、accessToken、at-… 和 refresh_token；只提取认证字段，不带入密码备注、代理/服务地址等附加输入。JWT 解析仅提取字段，不冒充验签；最终可用性仍由原生回读核实。单独 refresh_token 仅向固定官方端点兑换一次，无自动重试；先排除目标文件已存在，再兑换，成功轮换的文件不因批次失败回滚。

SharedAccount.nameRevision 与 AppState.accountAliases（值为 SharedAccountAlias）是可选增量字段；旧状态无需迁移。SSH 别名跨相同 authority/代际的本机连接共用，重新入册或其他 authority 不继承。AccountCard 的标题可编辑；展开后的真实邮箱为只读文本，小眼睛仅控制该实例邮箱行的中间遮挡，默认遮挡、不持久化；标题及会话选择器始终使用完整名称，不受小眼睛影响。legacy models/accounts/create 保持旧插件持久建入口行为；新的添加界面只用 prepare，不要求填写名称。

### 注册、替换、事件、权限和生命周期

公开声明位于 packages/model-management/access-registry.ts、credentials.ts、types.ts、apps/desktop/host/account-names.ts 及 renderer/AccountCard.tsx。AccountLoginRegistration 包含 id、provider、label、description、可选 availability(account) 和 start(account,changed)→Promise<LoginHandle>；LoginHandle 提供 job、cancel()，可选 submitCode/submitCallback。AccountImporterRegistration 包含 id、label、description 和 parse(contents)→CodexCredential[] 或 Promise；返回 host-only auth 或 refreshToken，核心重新校验全部记录。AccountAccessService 还提供 methods/formats/start/parse/subscribe/dispose；parse 返回 records、AbortSignal 和 assertActive。AccountNameService 提供 apply/rename。

owner 使用插件 ID，本地 id 为小写字母开头的短横线 ID；非核心项组成 owner:id。界面保留已选择但缺失的 ID、提示不可用并禁止提交，重新启用同 ID 恢复。register 返回 {id,dispose():Promise<void>}，插件必须用 api.onDispose 持有清理；subscribe 返回取消监听函数。主进程订阅生产目录变更并使用既有 workbench:extensions 通知刷新目录，所以异步新增/移除也进入已打开的弹窗。目录事件不是账号登录成功事件；账号保存沿用 onState。失活先移除目录、终止 importer signal、取消所属等待/核实登录；晚到 start 会被取消，晚到 parse 拒绝，完成作业不重复取消。多插件 ID 可共存，重复注册失败，释放幂等。

所有 host 注册/替换仍须完整代码包批准。代码插件在宿主拥有相应信任，不自动获得其他设备或管理员权限。browser/device 通过官方 CLI；desktop 仅在 Windows 检测到官方 Store 安装后可用，使用独立 CODEX_HOME 和 Electron profile，清理只针对核实身份的所属进程。OAuth/desktop 启动前探测回调端口，不向既有 listener 发送取消；不能消除外部进程恰在探测后抢占的 OS 竞争。浏览器打开失败仍保留可复制链接；手动回调校验 state、唯一 code/state、origin/path 和长度，拒绝任意地址请求。没有模型调用、自动续投、登录默认客户端资料扫描或真实用户凭据测试。

主要错误：LOCAL_ACCOUNT_METHOD_UNAVAILABLE、DESKTOP_MISSING、DESKTOP_START_FAILED、DESKTOP_CLEANUP_FAILED、BROWSER_UNAVAILABLE、CALLBACK_PORT_BUSY、CALLBACK_INVALID、CALLBACK_UNREACHABLE、CALLBACK_REJECTED（均有 LOCAL_ACCOUNT_ 前缀）；导入错误为 LOCAL_ACCOUNT_IMPORT_SIZE/LIMIT/INVALID/JSON_INVALID/JWT_INVALID/IDENTITY_INVALID/ACCOUNT_ID_REQUIRED/NOT_CODEX/DUPLICATE/EXISTS/REFRESH_FAILED/WRITE_FAILED/FORMAT_UNAVAILABLE；注册错误 EXTENSION_INVALID/DUPLICATE/CLEANUP_FAILED；持久更新采用既有 CHANGED/BUSY/LIMIT/NAME_INVALID/EMAIL_UNAVAILABLE/DISPOSED 语义。错误不回显输入令牌。核心超时/退出/取消只清理本次流程；未知授权结果不会当作成功卡片。

```js
export function activate(api) {
  const access = api.services.get('models.account-access');
  const registration = access.registerLogin(api.id, {
    id: 'organization', provider: 'codex', label: '组织授权',
    description: '由此插件管理的显式授权流程',
    start: (account, changed) => organizationLogin(account, changed),
  });
  api.onDispose(() => registration.dispose());
  api.observeSurfaces('account-identity-email', 'after', ({ root }) => {
    root.textContent = '插件的账号说明';
  });
}
```

organizationLogin 是插件自身实现，必须返回上述 LoginHandle，示例不预装。旧 browser/device、Claude 方法、账号 id 和会话绑定不变；旧私有卡片内部 DOM 定位应迁移至具名 surface。原 model-account-card 覆盖扩展为 SSH 与本机，data-account-id 需结合 provider/所在容器区分；每实例恢复保持原 React 数据。测试：tests/account-access.test.ts（格式、真实 loopback、端口冲突、建卡/取消竞态、别名持久化、真实批准 ZIP 注册/停用/恢复）；tests/model-accounts-native.test.ts、model-management.test.ts、model-account-selection.test.ts、model-account-execution.test.ts；scripts/test-account-access-ui.mjs（实际组件/宿主、批准 ZIP、动态目录、局部多实例及明暗窄屏）；scripts/test-model-management-ui.mjs 与 test-administration-ui.mjs 回归。契约快照增量审阅后更新；源码/合成插件、独立原生启动与实际账号授权的证据边界见文档 16。
<!-- codex-account-access:end -->

<!-- project-preview-folder-open:start -->
## 项目悬停卡片的文件夹打开（2026-09-29 UTC；U2）

接口先审范围：项目标题悬停、Project.paths/path、概览计数、文件夹行、path/open、workbench.actions.openPath、state/get/onState 和插件多实例 surface。本次把已有只读路径接入已有本机目录打开能力，新增两处具名局部挂载点；无新增宿主命令、事件、持久配置、文件格式或资源。没有新增打开方式/路径提供方目录，故“注册新选项”不适用；第三方可注册新的局部行/卡片实现及替换实际打开实现，不需要修改核心源码。

| 功能覆盖 | 调用现有能力 | 注册新实现与替换；实际消费路径 |
| --- | --- | --- |
| 项目关联目录打开 | api.call('path/open',{projectId:string,path?:string}):Promise<null>；省略 path 打开主目录 | ProjectPreview 文件夹按钮 → Sidebar → 宿主路径成员/目录检查 → workbench.actions.openPath(path:string):Promise<void> → Electron shell.openPath；批准宿主插件使用 services.intercept('workbench.actions','openPath',handler) 或 services.override 替换同一生产成员，释放恢复 |
| 项目概览视图 | api.call('state/get'):Promise<AppState>、api.onState(listener):()=>void；Project 的 name、paths/path、pinned 与会话状态维持既有语义 | observeSurfaces('project-preview',placement,render) 定位浮层内的 [data-workbench-project-preview]；before/after 注册附加内容，replace 替换概览内容，保留定位/鼠标/焦点/Escape 外壳 |
| 每一条文件夹行 | 相同 path/open；稳定 target.dataset.projectId 和 target.dataset.projectPath 分别为所属项目 ID、完整路径 | observeSurfaces('project-folder',placement,render) → 所有 [data-workbench-project-folder]；卡片内已挂载与后来增加的行共用同一生产观察器；replace 保留隐藏核心按钮供停用恢复 |

surface 注册类型沿用 observeSurfaces(surface:string,placement:'before'|'after'|'replace',render:SurfaceRenderer):()=>void；render 接收 {root,target,signal}，返回 void、清理函数或其 Promise。卡片按项目 ID 重挂载；文件夹按完整路径保持实例身份，新增/移除目录触发挂载/清理。两种 target 都提供 data-project-id；只有文件夹 target 提供 data-project-path。元数据只标识当前目标，不构成文件权限授权。异步渲染完成后仍清理已停用实例，注册失败沿用插件故障隔离，多个替换最后注册者优先，停用任意层恢复剩余实现；浮层跟随内容尺寸重新限制在窗口内，缩小内容不向下跳动；替换聚焦行时，只要鼠标仍在卡片内就保持打开，重复离开事件会清理旧关闭计时器。

```js
export function activate(api) {
  return api.observeSurfaces('project-folder', 'replace', ({root,target,signal}) => {
    const button=document.createElement('button');
    button.textContent='打开 '+target.dataset.projectPath;
    button.addEventListener('click', async () => {
      try {
        await api.call('path/open', {
          projectId:target.dataset.projectId, path:target.dataset.projectPath,
        });
      } catch (error) { if (!signal.aborted) button.textContent=String(error); }
    }, {signal});
    root.append(button);
  });
}
```

权限与错误：代码插件按完整工作台包批准，未批准不激活。本机路径打开沿用关联目录检查与 stat 目录核验，拒绝未知项目、未关联路径、缺失路径、普通文件和 OS 打开失败；不打开远端路径或扩大设备/租户权限。核心行在等待期间以 aria-disabled 与调用锁阻止重复操作并保留键盘焦点，失败显示中文错误并允许用户再次显式点击，没有自动重试；插件替换者自行管理其忙碌/错误 UI。已经交给 OS 的显式打开不因停用回滚；停用清理监听器与服务替换，不更改项目/会话。没有新状态事件，项目编辑依旧经既有 state 推送更新卡片。

兼容审查：API v1 仅新增两项具名 surface 值，原有命令/服务参数、数据格式、概览 test ID、project-preview-folders 和 project-preview-edit 类名保持不变；契约快照只新增两项映射。历史依赖 .project-preview-folders>div 的扩展应迁移到具名 project-folder；文件夹现为原生 button，支持鼠标单击、Enter、Space，悬停/键盘焦点显示打开箭头。新扩展应依赖上述公开元数据，不解析路径文本或内部 SVG。没有新增只对核心开放的实现分支、固定运行时或选项名单。

测试位置：scripts/test-project-preview-ui.mjs 使用隔离隐藏 Electron、真实项目 IPC/成员验证及整包批准激活的合成插件，覆盖多个目录、移入浮层、键盘、等待去重、失败/重试、动态目录、浅深主题/窄窗、多个替换、注册失败、异步迟到、停用/重启用与服务恢复。tests/sidebar-actions.test.ts 复验已有项目/最近会话边界。OS shell 仅在测试边界记录调用，不宣称已打开实际资源管理器；没有操作活动客户端、用户资料、模型或远端。没有新增插件卸载入口；包移除的通用恢复沿用既有插件恢复验收，不把停用等同于卸载。
<!-- project-preview-folder-open:end -->

<!-- titlebar-theme-sync:start -->
## 顶部导航栏与原生窗口按钮的主题同步（2026-09-29 UTC）

接口前置审查范围：`appearance/get` / `appearance/set`、`theme/set`、`api.themes.register/list/subscribe`、生产 `themePresets` 目录、`useAppearance` 样式及事件、具名 `titlebar` surface、`desktop.menu` 服务和 Windows 原生 caption overlay。浅色顶部栏的固定底色、两种模式的固定文字/悬停色、原生按钮固定底色改为消费同一渲染结果，不增设宿主主题目录或第二份偏好。

| 功能覆盖 | 调用现有能力 | 注册新选项或实现 | 替换现有实现与释放 |
| --- | --- | --- | --- |
| 顶部栏的预设配色 | `api.call('appearance/set',{revision,patch:{lightPreset,darkPreset}})` 与 `theme/set`；参数及修订比较不变 | `api.themes.register(definition):ThemePresetHandle` 的 `side` / `muted` / `hover` / `text` 进入真实主题选择器及顶部栏；`dispose()` 释放 | `api.addStyle(css):()=>void` 可覆盖已注册主题或顶部栏；具名 `api.observeSurfaces('titlebar','replace',render):()=>void` 替换现有及后来实例，停用恢复核心；核心正确响应 `hidden` |
| Windows 原生窗口按钮颜色 | 新增 `api.call('desktop/titlebar',value:TitlebarAppearance):Promise<TitlebarAppearance & {height:number}>`；`TitlebarAppearance={color:string,symbolColor:string}`，两项均为不透明六位十六进制颜色；对应服务 `api.services.get('desktop.menu').setAppearance(value)` | 主题作者仍只注册同一主题目录，无额外原生主题注册；生产 `TitleBar` 读取计算后的颜色并串行同步 `desktop/titlebar` → `desktop.menu.setAppearance` → 实际 `BrowserWindow.setTitleBarOverlay` | 已批准宿主插件 `api.registerMethod('desktop/titlebar',handler):()=>void` 可替换同步实现；`api.call` 调用核心，`api.invoke` 走调度链。扩展目录变化会重新提交当前配色，停用宿主覆盖即恢复，无需 CSS 发生变化 |

生产链路监听 `workbench-appearance`、根节点模式/样式、顶部栏样式及 head 样式变化；按帧合并更新、仅在值变化或扩展生命周期变化时提交，单实例最多一个请求在途，后续保留最新值；扩展生命周期使用独立代次，迟到结果不能吞掉停用后的恢复提交。组件卸载断开观察器、事件和扩展订阅，取消尚未提交的帧。主题缺失/停用仍保留用户选择并回退内置主题，重新启用恢复注册主题；原生按钮同步同一回退结果。宿主保存的只是本窗口瞬时颜色，刷新原生菜单、系统明暗变化与缩放不覆盖它；缩放高度仍为 `round(46 * zoomFactor)`，不允许插件通过该颜色接口修改几何。

权限、错误与返回：沿用完整代码包批准、现有来源校验及插件停用规则，无新磁盘、网络或管理员权限。成功返回规范化的小写颜色和当前高度；没有新增状态事件或持久数据，颜色是派生显示状态。缺项、额外字段、透明值和非六位颜色报 `APPEARANCE_INVALID_TITLEBAR`，验证失败不改变窗口；关闭的窗口报 `DESKTOP_WINDOW_CLOSED`。非 Windows 平台保留该返回契约但不调用 Windows overlay，不承诺未验收平台的原生绘制。低层颜色调用是瞬时设置，主题或扩展变化可重新覆盖；持久主题应注册预设并通过 `appearance/set` 选择。替换整栏的插件若有独立视觉设计，应通过该接口同步自己的不透明颜色并管理清理；不能把任意半透明/渐变 CSS 宣称为原生按钮可直接绘制的背景。

兼容及迁移：`apiVersion:1`、旧配置、既有 `.desktop-titlebar` / `titlebar` 名称和布局不变，新增宿主方法及 `TitlebarAppearance` 为增量契约；旧主题无需新增字段。悬停使用既有 `hover/text`，常态使用 `side/muted`。不新增选项名单、资源格式或用户配置迁移；代码字体、斜切图标和紧凑主题菜单不改变。契约快照须只纳入本次类型/方法增量，不包含其他窗口未提交功能。

```ts
// Renderer entry in an explicitly approved package.
export function activate(api) {
  api.themes.register({id:'mint',label:'薄荷',mode:'light',base:'builtin.garden',
    colors:{side:'#dcefe6',muted:'#435c50'}});
  // Selecting plugin:<manifest-id>/mint now also colors the native window buttons.
}
```

```ts
// Separate host main.mjs entry; delegate to core without invoking the replacement again.
export function activate(api) {
  api.registerMethod('desktop/titlebar',value=>api.call('desktop/titlebar',value));
}
```

验证位置：`tests/titlebar-appearance.test.ts`；`scripts/test-appearance-ui.mjs` 现在挂载生产 `TitleBar`，调用生产 `installDesktopMenu`，`scripts/titlebar-ui-checks.mjs` 覆盖十二套真实选择、文字/悬停、系统模式、重载、缩放、既有交互、真实批准 ZIP 注册与 native 调用、多个插件共存、具名替换的动态实例、停用/重新启用、宿主方法替换恢复、迟到宿主结果、非法请求及失败清理。原生 API 记录是在调用实际 Electron setter 成功之后记录；renderer 截图不替代 OS 非客户区逐像素验收；隐藏窗口悬停样式通过 Chromium 伪状态检查，菜单和历史操作通过键盘验证，不冒称在用客户端鼠标命中验收。未修改原生按钮几何、命中测试或 OS 绘制器；包卸载复用停用清理，本轮不另验安装包删除。无新增异步资源加载，迟到模型结果、运行时接入与配置格式升级不适用。实际通过数量和边界见文档 16 的同名记录。
<!-- titlebar-theme-sync:end -->

<!-- account-export:start -->
## 账号卡片与单账号导出（2026-09-29 UTC）

### 先行接口审查及功能覆盖矩阵

受影响命令为新增 models/accounts/export-formats、export-preview、export-copy、export-save；生产服务 models.account-export 管理格式目录、序列化和释放。账号状态、登录、导入、额度兑换和模型选择沿用原契约；没有新增持久配置或运行时目录。每次打开默认官方，弹窗内选择不写入账号或插件配置。

| 能力 | 调用现有能力 | 注册新实现／选项 | 替换及实际消费方 |
| --- | --- | --- | --- |
| 账号卡片和额度视觉 | 原有账号／额度／用量入口 | 原有主题目录提供颜色；本轮无独立视觉选项目录，故无需新枚举 | model-account-card、model-account-quota 具名多实例 surface；AccountQuotaCard.css 消费既有主题变量 |
| 单账号导出 | 下列四个宿主入口 → controller.accountExport | models.account-export.registerFormat → 生产目录的 id/label → 弹窗下拉框及同一序列化器 | overrideFormat 分层替换单个格式；停用恢复上一层 |
| 导出建议名 | export-preview 返回 fileName；export-save 传给原生保存窗口 | registerFormat 的 serialize 返回自有 fileName，沿用同一生产校验 | overrideFormat 可替换单格式的文件名和内容；内置名采用邮箱、运行时及格式，无新增命名目录 |
| 导出入口与弹窗 | 账号右上角图标 → AccountExport | observeSurfaces 支持新增、移除及异步多实例 | model-account-export-trigger、model-account-export；不必替换整个设置页 |

### 命令、类型与权限

公开类型在 packages/model-management/account-export-types.ts。AccountExportRequest 为 {id,revision,formatId?}，默认 formatId 为 official；内置 ID 顺序为 official、sub2api、cpa。AccountExportFormat 为 {id,label,description,generation}，generation 只标记本次注册实例，非持久配置版本。内置显示标签为“官方auth.json”“sub2api”“cpa”；格式 ID 仍为 official、sub2api、cpa。

| 方法 | 参数 | 返回 |
| --- | --- | --- |
| models/accounts/export-formats | {id,revision} | AccountExportFormat[]，不含凭据 |
| models/accounts/export-preview | AccountExportRequest & {reveal?:boolean} | {formatId,fileName,content,redacted}；默认脱敏 JSON，仅 reveal:true 返回完整内容 |
| models/accounts/export-copy | AccountExportRequest | {status:'copied'}；完整 JSON 由宿主写入剪贴板，不经通用复制入口回传 |
| models/accounts/export-save | AccountExportRequest | {status:'saved'|'cancelled'}；原生保存窗口决定路径，不接收任意渲染器路径 |

HostActions.pickAccountExport(fileName):Promise<string|null> 是原生保存窗口注入点。序列化、预览、复制、保存限定用户指定的工作台账号独立原生目录。只读取 Codex auth.json 或 Claude .credentials.json；不扫描默认客户端目录／钥匙串，不执行登录、刷新或网络请求。缺失文件明确报错。账号停用仍可导出既有资料；账号被删除或 revision 改变则拒绝。文件读写拒绝链接，读入／输出上限各 1 MiB；原生资料目录不能作为导出目标，保存使用临时文件及原子替换。

这些是受信桌面／已批准完整代码包的敏感操作，不是模型工具或远端管理员能力。凭据不会进入 state/get、普通状态事件、日志或模型上下文；明确揭示的预览在关闭／切换格式时移除。复制／保存失败只返回固定错误码。格式实现可见所选账号凭据，因此必须随完整包审批，不能通过声明 apiVersion 自行增权。

### 格式协议与界限

官方格式保留原生 JSON 对象和未知字段，下载建议名为 邮箱-codex/claude-official.json；原生资料存储名仍为 auth.json／.credentials.json，不声称保留源文件空白与键排列。sub2api 为 type:sub2api-data、version:1、proxies:[]、单元素 accounts 数据包，OAuth 的 platform 为 openai／anthropic；只做字段映射，凭据过期时间从已有字段／JWT 元数据读取，不伪造登录验证。支持 Codex API key 及含完整原生记录的 Agent Identity；个人访问令牌或无法转换的 Agent Identity 返回不兼容。cpa 为单个 type:codex／claude OAuth 对象；API key、Agent Identity 等不转换为伪 OAuth。未知值不补造，当前真实消费者导入／联网登录未验收。字段来源和独立实现许可证审查见文档 07。

### 注册、替换、事件及生命周期

AccountExportDefinition 为 {id,label,description,serialize(context)}；新增 ID 必须为稳定 plugin.id:format 命名空间，内置及重复 ID 拒绝。context 为 {account,credentials,now,signal}；返回 {fileName,value} 或 Promise，value 必须为 JSON 对象，fileName 是单段 .json 名。序列化最长 30 秒，超时／释放会中止 signal，并拒绝异步迟到结果。不得把测试结果或任意 Node 权限单独作为生产接线证明。

models.account-export 暴露 formats、registerFormat、overrideFormat、subscribe、preview、copy、save。registerFormat 和 overrideFormat 返回幂等清理函数；必须通过 api.onDispose 注册。overrideFormat(id,{label,description,serialize}) 按注册顺序分层，非末层释放不影响末层，全部释放恢复内置。subscribe(listener) 返回释放句柄，只发送目录变更通知，不发凭据。弹窗每 1.5 秒回读 formats 并比较 generation，已挂载窗口随注册、停用及替换更新；选择格式缺失时保留 ID、清除旧预览、禁用导出并说明回退方式，重新启用恢复，不自动切换格式。

示例（仅文档／隔离验收，不预装）：

~~~ts
export function activate(api) {
  const service = api.services.get('models.account-export');
  api.onDispose(service.registerFormat({
    id: api.id + ':account-summary', label: '账号摘要', description: '不包含凭据的摘要',
    serialize: ({ account }) => ({ fileName: 'account-summary.json', value: { provider: account.provider, name: account.name } }),
  }));
  api.registerCommand('formats', ({ id, revision }) => api.call('models/accounts/export-formats', { id, revision }));
}
~~~

独立 renderer.mjs 入口：

~~~ts
// Production observer handles all existing and later instances.
export function activate(ui) {
  ui.observeSurfaces('model-account-quota', 'after', ({ root, target }) => {
    root.textContent = '账号：' + target.dataset.accountId;
  });
}
~~~

### 兼容、错误及验证

原有 model-accounts、model-usage 挂载点、model-account／model-quota-window／model-usage-summary 类、折叠和额度语义保留；新具名 surface 替代第三方猜测内部 DOM 的定位方式。model-account-card、model-account-quota、model-account-export-trigger 提供 data-account-id；导出 surface 另有 data-format-id。未修改旧插件方法签名或持久格式，SDK 快照新增导出类型、四个入口和四个 surface；不能把并行窗口的快照变化算作本次验证。

固定错误包括 ACCOUNT_EXPORT_REQUEST_INVALID、CREDENTIALS_MISSING、CREDENTIALS_INVALID、FORMAT_ID_INVALID、FORMAT_DUPLICATE、FORMAT_INVALID、FORMAT_UNAVAILABLE、FORMAT_UNSUPPORTED、DOCUMENT_INVALID、SERIALIZER_FAILED、TIMEOUT、COPY_FAILED、SAVE_UNAVAILABLE、SAVE_FAILED、DESTINATION_PROTECTED、DISPOSED（省略项沿用 ACCOUNT_EXPORT_ 前缀），以及既有 LOCAL_ACCOUNT_NOT_FOUND／LOCAL_ACCOUNT_CHANGED。错误不包含文件路径、解析原文或序列化器抛出的敏感内容。

测试位置：tests/account-export.test.ts（官方／sub2api／cpa，两家原生结构，缺失／损坏／链接／超限、修订变化、取消、保存保护、异步释放、多层替换、注册失败、真实 ZIP 导入批准／激活／停用／重新启用／包移除）；scripts/test-account-export-ui.mjs（实际 controller、生产格式目录、AccountExport、插件 renderer 与 observeSurfaces，多实例及后来实例，缺失选项恢复，浅色／深色／460px，9 项通过且零 renderer errors）。测试均用临时资料和合成凭据；不安装开发示例到用户环境。最终独立候选类型、文档、插件契约及定向回归见文档 16。
<!-- account-export:end -->


<!-- file-review-capsule-20260930:start -->
## 运行中文件胶囊与共享差异审查器（2026-09-30 JST）

本次先审接口范围为 Session.fileChangeRecords、conversationTimeline/readingTurns、TurnFileChanges、state/get/onState、renderer 插件 API、composer 固定进度区、文件打开/上下文菜单与多实例 surface。没有新增执行器、远端入口、文件写入或持久配置。运行中胶囊与结束/中断卡片使用同一个 FileChangeCard 生命周期和审查器；详情经 Workspace.reader 占用现有互斥右侧位置，与文件/计划/Subagent 阅读器互相切换；复用分隔条拖动/键盘调宽和关闭焦点恢复。打开详情时对话临时采用原文/译文上下排列，关闭恢复原 translationLayout 偏好与配对追踪，不修改存档、不遮住会话或输入区，未发送草稿保留。打开后遇到停止仍保留选中文件，下一回合独立登记。原生 turn 内的 steering 修改在展示层合并；不改存档和工具回执。

### 功能覆盖矩阵与实际消费路径

| 能力 | 调用已有能力 | 注册新的实现/选项 | 替换与恢复 |
| --- | --- | --- | --- |
| 当前挂载回合的修改记录 | renderer api.fileChanges.list(sessionId?) → FileReviewSnapshot[]；底层为 FileChangeCard bind/update 的生产实例 | 原生运行时仍通过公开活动 fileChanges/FileChangeRecord 数据进入相同通路 | api.observeSurfaces('file-change-card', 'replace', render)；不改原生记录 |
| 打开/关闭回合审查器 | api.fileChanges.open({sessionId,turnId}, path?) / close({sessionId,turnId}) → void；open 默认首个文件，并关闭其他回合的右侧审查面板 | api.fileChanges.registerView({id,label,render}) → {id,dispose}；注册目录被实际差异方式选择器和渲染器共同消费 | 可替换 file-change-reader、file-change-review 或 file-change-diff；释放恢复核心视图 |
| 合并、并排与插件差异视图 | api.fileChanges.listViews() → readonly FileReviewViewOption[] | registerView 自动生成 plugin:<owner>:<id>；render(FileReviewViewContext) 返回 void、清理函数或其 Promise | 所选插件停用/缺失时暂用 unified，保留当前面板选择，重新启用同 ID 恢复；多插件 ID 互不覆盖 |
| 固定进度行与文件浮层 | 既有 active-turn-progress、turn-progress；胶囊调用同一审查组件 | file-change-capsule、file-change-list 的 observeSurfaces 支持已有/后来实例 | 同名 replace 挂载和停用恢复；隐藏触发器时关闭旧浮层，避免脱离锚点 |
| 文件打开与上下文菜单 | 既有 files/info、files/open、path/open 及 LinkActions | 现有文件目标/宿主服务注册路径不变 | 本次不增加文件执行/撤销权限；菜单保持原有校验 |

公开类型在 apps/desktop/renderer/file-review-controller.ts：FileReviewTarget 含 sessionId/turnId，其中 turnId 为 list 返回的界面回合分组 ID，不是厂商 nativeTurnId；同一原生 turn 的 steering 卡片合并后使用首个用户条目的分组 ID。FileReviewSnapshot 增加 changes:TurnFileChanges 和 running:boolean；FileReviewViewContext 含 root:HTMLElement、signal:AbortSignal、sessionId、turnId、file（完整已保留的 patches/统计/截断标记）。自定义 render 收到记录的克隆，不得解释为磁盘完整快照。list 返回克隆；仅列出当前 renderer 已挂载的回合，未打开会话的数据仍通过 state/get 读取，open 不自动导航。

事件：api.fileChanges.subscribe(listener:()=>void) → dispose；挂载、回执更新、终态、卸载以及视图注册/释放时通知，回调通过 list/listViews 回读。文件选择属于面板内状态；具名 review/diff surface 的 data-file-path 随选择更新，不伪造宿主 onState。所有 file-change surface 都携带 data-session-id 和 data-turn-id；review/diff 另有 data-file-path，diff 的 data-diff-view 表示实际显示方式。并排区域小于 560 CSS px 时临时以 unified 显示并说明，放宽恢复；不保存新的全局偏好。

错误：FILE_REVIEW_UNAVAILABLE（目标未挂载/已关闭会话）、FILE_REVIEW_FILE_UNAVAILABLE（路径不在该回合）、FILE_REVIEW_INVALID_VIEW（非法本地 ID、空/过长名称或缺 render）、FILE_REVIEW_DUPLICATE_VIEW（同 owner 重复 ID）。停用后的调用遵循既有 renderer 生命周期错误。公开 actions 不读取/写入工作区、不请求模型；注册/替换须按现有完整代码包批准，不能授予模型、其他设备或管理员权限。取消监听和 dispose 幂等；render 的 signal 在文件切换、实例卸载、选项切换、停用时取消，异步迟到的清理仍执行。渲染失败沿用 renderer-failed 恢复链禁用所属插件并恢复核心。

示例（仅示意，不预装到用户环境）：

```js
export function activate(api) {
  api.fileChanges.registerView({
    id: 'patch-summary', label: '修改摘要',
    render({ root, file, signal }) {
      root.textContent = file.path + ' · ' + file.patches.length + ' patches';
      return () => root.replaceChildren();
    },
  });
  api.observeSurfaces('file-change-card', 'after', ({ root, target }) => {
    const button = document.createElement('button');
    button.textContent = '查看差异';
    button.onclick = () => api.fileChanges.open({
      sessionId: target.dataset.sessionId, turnId: target.dataset.turnId,
    });
    root.append(button);
  });
}
```

兼容/迁移：apiVersion 1 的增量字段，不修改现有会话持久格式或运行时枚举。旧 file-change-card test ID 和计时 surface 保留；运行中的卡片现在显示于固定进度行，依赖私有 .change-patches pre 的扩展迁移至 file-change-diff，运行中入口迁移至 file-change-capsule/list。合并/并排属于内置表现形式；第三方新显示方式必须经具名 registerView 注册，无仅核心可用的新选项目录。缺补丁、未知行数、截断和没有行号的原生片段均明确保留，不伪造零值、净 Git diff 或撤销能力。文件筛选与显示方式为瞬时界面状态，持久配置迁移不适用。没有替换宿主服务签名，审查范围不含其他窗口的账号管理变更。

测试位置：tests/file-review.test.ts（解析、合并、公开 actions/目录/清理）、tests/file-changes.test.ts 与 tests/runtime-reading.test.ts（原生确认和分组）、scripts/test-file-review-ui.mjs（真实 Workspace、实际批准 ZIP/激活、注册视图与调用、动态多实例、多个插件、失败/异步迟到/停用/重新启用、明暗窄屏、右侧互斥位置、翻译占位恢复与草稿保留）、scripts/test-session-feedback-ui.mjs（计时与中断历史回归）、scripts/test-translation-tracking-ui.mjs（原文/译文布局、文件/子会话占位、配对悬停/键盘追踪恢复）。契约快照增加上述公开类型和六个具名 surface。验证记录见文档 16；仅更新快照不视为兼容通过。
<!-- file-review-capsule-20260930:end -->

<!-- account-export-filenames:start -->
### 导出文件名语义审查（2026-09-29 UTC）

本轮先行审查并只调整内置三格式的下载建议名及安全文件名验证，不改 JSON 内容、登录／导入或账号状态。受影响入口为 models/accounts/export-preview 的 fileName 返回值、models/accounts/export-save 和 HostActions.pickAccountExport 的建议名。仍通过 models.account-export 调用；新增格式由 registerFormat 的 serialize 返回自己的 fileName，内置单格式可通过 overrideFormat 替换。没有新设置／目录／事件／surface 或 SDK 类型签名，既有注册释放及停用恢复不变，故不增设第二套命名注册表。生产弹窗和原生保存窗口消费同一个序列化结果；models/accounts/export-copy 继续只复制 JSON 内容。

约定改为 邮箱-codex/claude-official/sub2api/cpa.json，例如 member@example.com-codex-sub2api.json。优先账号邮箱，缺失时使用已读入凭据的邮箱元数据，再回退账号名称及账号短 ID。邮箱中的 @、+ 和中文账号名保留；前缀按 NFC 规范化、净化文件系统禁用字符并限制为 160 UTF-8 字节，Windows 保留设备名前加下划线。官方只修改下载建议名，原生资料存储名仍为 auth.json／.credentials.json。调用方应使用 preview.fileName；需要原生固定路径时由使用方按目标程序约定命名，不能再假定官方导出建议名恒为原生存储名。

插件仍可返回 fixture.json 等自定义名，不强制套用内置模板；校验扩展接受 Unicode 字母／数字／组合符和 _.@+ 空格及连字符，保留单段 .json 限制，扩展名前最多 200 个字符、完整名称最多 240 UTF-8 字节。拒绝路径分隔符、控制／双向文本字符及 Windows 保留设备名，失败沿用 ACCOUNT_EXPORT_DOCUMENT_INVALID。权限、原生资料目录保护、30 秒超时、异步迟到拒绝和释放句柄沿用前述契约；JSON 预览脱敏不变，文件名按用户请求显示用于识别的邮箱，不另写入日志或持久配置。

语义兼容审查：仅下载建议名改变，公开签名、事件、具名 surface、JSON 持久格式和旧插件自定义名均不变，契约快照经 check:plugins 核验无需刷新。没有新增配置，故旧配置迁移不适用。tests/account-export.test.ts 覆盖两家运行时全部六种组合、原生保存建议名、邮箱回退、Unicode／危险／超长名称、JSON 保持，以及经真实 ZIP 批准／激活的新格式、停用／重新启用／包移除恢复；已有多层替换、注册失败和异步释放回归继续运行。scripts/test-account-export-ui.mjs 覆盖生产目录、现有／后来实例、旧插件自有命名、明暗及长邮箱窄窗。独立候选验证及边界记录于文档 16。
<!-- account-export-filenames:end -->

<!-- account-export-label:start -->
### 官方格式显示标签（2026-09-29 UTC）

先行接口审查：本轮只将导出格式选择器的内置 official 标签改为“官方auth.json”。公开 models/accounts/export-formats 及 models.account-export.formats() 返回此 label，AccountExport 直接消费生产目录；插件仍通过 registerFormat 注册自有 id/label，或 overrideFormat 替换内置标签及序列化实现，调用示例和清理句柄沿用前述契约。预览／复制／保存参数、邮箱下载建议名、JSON、权限／错误、事件、状态／配置和具名 surface 均不变；无新增选项目录或迁移要求，旧插件自有标签和停用恢复不受影响，契约快照无需更新。测试位置为 tests/account-export.test.ts 与 scripts/test-account-export-ui.mjs，后者核验实际默认选项文本及真实批准 ZIP 的注册／停用／重新启用链路；结果见文档 16。
<!-- account-export-label:end -->


<!-- native-event-audit:start -->
## 原生事件审计与未来事件兼容（2026-09-29 UTC；U107/U108）

接口先审范围：两家原生接收通道、observer、状态账本、活动提示、插件激活及局部 UI。新增能力使用生产 PluginRegistry.nativeEvents 实例，经 controller.observeNativeSession → attachNativeObservation → NativeEventMonitor 消费；本机官方账号、第三方来源和 Codex SSH 共用此 observer。Claude SSH 研究适配器保留未验收门禁。

### 功能覆盖矩阵

| 能力 | 调用 | 注册 | 替换与实际消费 |
| --- | --- | --- | --- |
| 原生事件目录与分类 | host api.nativeEvents.catalog(runtime?) / inspect(runtime,value) | 精确 runtime + keys 的具名 presenter；返回幂等释放函数 | 同一生产事件 monitor 调用；后注册的匹配层优先，失败委托前一层或核心提示 |
| 有界接收账本 | state/get → Session.nativeEventAudit；api.nativeEvents.onReceipt(handler) | 每插件可注册安全元数据观察者并自动释放 | 既有 workbench.state 服务可调用；处理扩展不更改身份、回合结局或审批语义 |
| 兼容性提示 | RuntimeActivity.protocol → NativeEventNotice | observeSurfaces('native-event-notice',placement,render) | 既有多实例挂载生命周期；data-event-key / data-event-runtime / data-event-disposition 是稳定上下文 |
| 当前协议升级核对 | node scripts/check-native-events.mjs | 新类型需补 catalog、schema fixture、语义处理或明确 unsupported 原因及测试 | npm run check:plugins 自动执行清单覆盖检查；可传 --codex-schema、--claude-types 与 --claude-inventory 比对新版本 |
| 当前事件语义 | host services.get('native.event-semantics')，见 NativeEventSemantics | intercept/override 同一生产 taskKind/background/command/apply 成员，释放恢复 | ClaudeNativeChildTracker、NativeChildLifecycle、RuntimeNoticeTracker 及真实 observer 共用该实例 |
| 连续工具/诊断分组 | renderer api.activities.group(entries) | api.activities.register({id,classify}) → {id,dispose}；subscribe(listener) | ConversationReading 与 NativeChildConversation 消费同一 ActivityGroupingRegistry；停用重算已挂载组 |
| 分组与计时 UI | activity-group、turn-process、turn-progress 具名 surface | observeSurfaces 多实例、动态实例及异步清理 | 原生回合结束与后台停止独立；过程摘要中的计时不随后台清理移动 |
| 可复制适配诊断 | host api.nativeEvents.diagnostic(receipt) → string；界面复制使用同一 nativeEventDiagnostic | 沿用精确事件 presenter 注册 | native-event-notice 局部替换；复制只含类型/次数/时间/序号/长度/摘要，不含正文 |

### 公开契约

新增语义类型位于 packages/native-events/semantics.ts。`NativeEventSemantics.taskKind(type:string) → 'agent'|'command'|'other'` 由真实子任务分类消费；`background(value) → NativeBackgroundTask[]|undefined` 只接受完整替换快照、唯一任务 ID、最多 2048 项，invalid 返回 undefined；`command(value) → NativeCommandState|undefined` 只解析当前六种生命周期；`apply(session,frame) → void` 在有序 observer 队列中更新类型化元数据。同步覆盖不得返回 Promise；失败沿既有 observer/运行时失败路径停止观察，不自动重发。完整批准的宿主插件可通过具名服务 intercept 包装或 override 替换；这和仅改变提示文字的 presenter 是不同接口。服务成员直接连接生产实例，不提供模型调用或额外系统授权。

Session 新增可选 nativeBackground / nativeProtocol，Message 新增可选 nativeCommandState，child 新增可选 background / backgroundActive，RuntimeActivity 新增可选 presentation:'diagnostic'。完整后台快照仅更新活动级别，ambient 排除；空快照不能判定任务成功，进程清理还等待 native idle 或任务终止边。前台 Agent/Task 用对应工具结果结束，TaskStop 必须匹配类型化任务 ID 与类型。晚到 progress 不复活已终止任务。command_lifecycle 的 completed 只说明消息消费回合结束，不能替代 result；cancelled/discarded/refused 不自动续投。commands_changed 全量替换已知原生命令元数据；conversation_reset 清除活动上下文用量/计划，保留工作台历史。服务不添加新运行时/模型/设置选择项，因此该目录的用户选择/缺包回退不适用。

renderer 的 `ActivityGroupingEntry={id:string,activity?:RuntimeActivity}`；`api.activities.group<T>(entries:readonly T[]) → ActivityGroup<T>[]` 返回 `{id,items,label,diagnostic,attention}`，保留每条记录。普通分组只含同 runtime/child/turn 中相邻的已完成工具/命令/编辑，正文、审批、协作、失败、运行中和未确认活动形成边界。诊断独立汇集到一个默认折叠组，内部保留原有时序，不阻断已完成工具的邻接判断。`register({id,classify}) → {id,dispose}` 的 classify 同步返回 `{key,label}|undefined`，各字段 1–100 字符；局部 id 与 presenter 使用同一字母/数字/点/连字符规则，owner/id 唯一。后注册层优先，undefined、异常、无效值及 Promise 返回回退到较早层或核心；晚到 Promise 不应用。`subscribe(listener) → release` 通知当前组重算，失效 API 拒绝新增注册，停用/卸载释放贡献并恢复核心。没有持久分组配置，用户展开状态只属当前挂载实例，不改原生历史。

错误为 ACTIVITY_GROUP_RULE_INVALID、ACTIVITY_GROUP_RULE_DUPLICATE 及既有失效 API 错误；坏分类回调不会丢记录或隐藏失败。`activity-group` 的 data-group-id 和 data-group-kind（tools/diagnostic）为稳定局部上下文。原 turn-process/turn-progress selector 不变；完成/停止/失败过程统一采用 details 容器，旧插件若依赖私有 turn-process-live 子结构，应迁移具名 surface。无跨设备资源或权限变化；host 包仍需完整批准，renderer 沿既有批准激活流程运行。

类型位于 packages/native-events/types.ts 和 index.ts。api.nativeEvents 是 host PluginApi v1 的增量字段，不新增可扩充设置目录、运行时选项或权限选项。

- catalog(runtime?: 'codex' | 'claude') → NativeEventCoverage[]；inspect(runtime, value: Readonly<Record<string,unknown>>) → NativeEventCoverage[]。每项含 runtime/key/disposition/route。disposition 为 handled、observed、private、unsupported、unknown 或 malformed；handled 只说明有专门处理路径，审批内部某些 schema 仍可能明确不支持，不能据此宣称全部能力已实现。
- register({id,runtime,keys,present}) → () => void。局部 id 为字母起始的小写字母、数字、点和连字符，最长 80；最终 ID 为 owner/id。keys 是 1–64 个精确 discriminator 路径，不支持通配符。重复 owner/id 拒绝。present({event,value}) → {title,detail?} | undefined 必须同步；title 1–160 字符，detail 最长 4096。undefined 委托下层，异常或 Promise 返回恢复下层/核心且记录 adapterFailed。迟到 Promise 结果不应用，也不形成未处理拒绝。
- onReceipt(handler) → () => void。只传不可变元数据副本：类型、分组来源、次数、首次/最近时间、序号、字节数、SHA-256、处理分支与可选适配器 ID/故障标志。无正文、路径、字段值或原始 wire。回调失败不打断原生接收。
- NativeEventAudit = {version:1,frames,observations,unknown,unsupported,malformed,omitted,receipts}。observations 按唯一 discriminator/帧计数，含嵌套类型，可大于 frames。每会话最多 256 个按 runtime/child/key 分组的元数据条目；超限保留总计与可见 overflow 提示，不让新类型导致无限增长。现有活动列表继续遵守 256 行上限；全量分组摘要可由 state/get 读取。状态写入按 100ms 合并；flush、断线、dispose 会排空待写记录。
- RuntimeActivity.protocol = {receipt,presentation?} 是增量持久字段。停用/移除适配器会清除当前观察中的自定义展示并恢复核心；重启清除历史自定义展示，保留诊断账本。重新启用在下一帧重新验证公开字段；不重放历史任务或保留未知原始 payload 来模拟复算。
- 需要完整 host 代码包批准。present 在宿主读取被冻结的原生 value，须按新协议选择公开字段；不得将整个对象序列化到展示层。private 和已由核心处理的事件不会进入 presenter。接口只扩展提示的解释和展示，不授予控制请求回复、线程归属、权限授予、模型调用或回合成功的写入能力。需要新增原生动作时应另行定义并验证专用接口。
- 错误：NATIVE_EVENT_RUNTIME_INVALID、NATIVE_EVENT_PRESENTER_INVALID、NATIVE_EVENT_PRESENTER_DUPLICATE，以及既有失效插件 API 错误。注册失败经真实激活清理释放先前贡献；运行中 presenter 出错只记录安全故障标志，不把异常堆栈/原生值输出给用户。

```js
export function activate(api) {
  const release = api.nativeEvents.register({
    id: 'future-notice', runtime: 'codex',
    keys: ['notification/vendor/publicNotice'],
    present({value}) {
      const text = value.params?.publicLabel;
      return typeof text === 'string' && text.length <= 4096
        ? {title: '扩展运行时通知', detail: text} : undefined;
    },
  });
  api.nativeEvents.onReceipt(receipt => {
    // Safe discriminator metadata only. Do not add raw payload logging.
  });
  // release() is optional: disable/unload owns cleanup automatically.
}
```

兼容审查：旧插件、旧 Session 与 Activity 不含新字段仍可读取；无旧宿主命令签名变化。新具名 surface 取代对 runtime-step 私有 DOM 的猜测，不改既有 surface 名称。后台/实时音频、外部认证、SDK 专属回调等未启用能力仍明确标注 unsupported/observed/private，不通过“通用事件兼容”扩大权限。多窗口其他未提交改动不在本次验收范围。

测试：tests/native-events.test.ts、tests/native-event-routing.test.ts、scripts/test-native-events-ui.mjs；真实批准/激活的合成 ZIP 经生产 controller 和 observer 检查调用、注册、替换、停用、重启用、包缺失、注册失败、多实例及异步迟到清理。完整覆盖与证据层级见 [事件审计](native-event-audit-20260929.md)。

### 本轮补充调用示例与验证

```js
// Approved host entry: extend one concrete semantic parser used by observation.
export function activate(api) {
  api.services.intercept('native.event-semantics', 'taskKind', (next, type) =>
    type === 'vendor_agent' ? 'agent' : next(type));
}
```

```js
// Renderer entry: the real readers recompute their groups on registration/disable.
export function activate(api) {
  api.activities.register({id:'commands', classify(item) {
    return item.kind === 'command' ? {key:'commands',label:'运行命令'} : undefined;
  }});
  api.observeSurfaces('activity-group', 'after', ({root}) => {
    root.textContent = '扩展运行记录';
  });
}
```

语义兼容：API v1 增量，无旧命令移除；快照审阅新增声明及 surface。旧记录不伪造字段，升级只重分类曾标作 unknown 的已知事件，不重放缺失的正文，不回填成功/失败。中断主回合仍保留停止/失败时间；后台停止不覆盖已完成主回合结果。重复观察/初始状态和窗口恢复沿各自既有生命周期；没有新增持久选项、远程资源或自动安装。

新增覆盖位于 tests/native-event-semantics.test.ts、tests/native-event-routing.test.ts、tests/native-events.test.ts 和原生运行记录/计时回归。scripts/test-native-events-ui.mjs 经真实 ZIP 导入/批准/激活，验证语义服务被 observer 消费、事件 presenter、两家工具分组、既有/后来实例、多插件失败回退、迟到挂载清理、停用/重启用/包移除，以及后台停止前后计时器的同一位置。scripts/test-native-background.mjs 使用实际安装 CLI、独立临时 home 和合成回环上游，验证两家前台继续/后台结束及停止时主回合计时保持。无真实用户插件安装、付费任务或远端部署。最终数量与证据边界见原生事件审计与文档 16。
<!-- native-event-audit:end -->

<!-- session-native-preview:start -->
## 原生会话标题与有界首条消息预览（2026-09-29 UTC）

接口先审：现有标题由首条用户消息截取，没有消费原生 name 通知；悬停卡只有元数据。本次不生成新标题、不追加模型请求或提示、不强制英文。原生确实返回标题时才采用，其余沿用现有截取长度。

| 能力 | 调用 | 注册 | 替换与真实消费方 |
| --- | --- | --- | --- |
| 标题接收与截取保护 | host `sessions.presentation.nativeTitle/fallback/codex` | 已批准 `api.runtimes.register` 的适配器可 `context.emit({type:'title',title})` 提供实际运行时标题 | `api.services.override/intercept('sessions.presentation',member,...)` 作用于 controller 与三个执行器调用的同一生产实例 |
| 首条消息预览 | `session/preview({sessionId})` 返回有界 `SessionPreview` | 已批准服务覆盖可注册新的预览实现；不新增语言/模型目录 | `sessions.presentation.preview` → controller → IPC → 活动悬停卡；无模型或翻译任务 |
| 局部界面 | `api.onState`、`session/update` 和 `session/preview` | `api.observeSurfaces` 挂载已存在及后续实例 | 具名 `session-preview` / `session-preview-body` 支持 before/after/replace；每个目标提供 `data-session-id` |

### 契约、状态与权限

公开类型（含 `SessionPresentationService`、`SessionTitleMetadata`）位于 `packages/session-core/presentation.ts`、`packages/runtime-extensions/types.ts`。生产单例在 `WorkbenchController.developmentServices()` 注册为 `sessions.presentation`（服务契约 v1）。Codex 本地执行器、SSH 执行器、插件运行时与现有 API/离线截取路径均使用该实例；服务替换不是测试专用对象。

- `fallback(session:Session,title:string) → boolean`：保留各执行器原有 28/40 字符截取规则，写入 fallback 来源。native/manual、分支、显式创建及子任务标题不覆盖。
- `nativeTitle(session:Session,title:unknown) → boolean`：只接受非空、无控制字符、最多 500 UTF-16 单元的实际运行时标题；保留语言与原文，不翻译或强制英文。只有明确 fallback/native 来源可更新，manual、未知来源旧标题、分支、显式创建及子任务返回 false。无效原生字段忽略，不中断主任务。
- `codex(session,threadId:string|undefined,frame:{method?:unknown,params?:unknown}) → boolean`：仅消费 `thread/name/updated`，要求非空根 threadId、通知 threadId 和当前会话绑定完全相同；子线程、缺失身份、已重新绑定与其他事件均忽略。执行器在当前串行状态更新中调用；已关闭/替换连接不再接收旧通知。start/resume 的实际 `thread.name` 同样通过 nativeTitle；SSH handle 增量公开可选 `threadName?:string`，缺失时保持回退。
- `preview(session:Session) → SessionPreview`；`session/preview({sessionId:string}) → Promise<SessionPreview>` 返回 `{messageId?,source,excerpt,content,truncated}`。source 为 `translation | original | submitted | empty`。仅使用第一条 user 消息，完整/旧版无状态的已有非空 translation 优先；pending/failed/off 译文跳过。其后使用保存的 original（翻译输入场景下即用户原语言稿），再回退 submitted；不读取助手回复、原生私有聊天库或隐藏上下文。
- excerpt 最多 180 Unicode 码点加省略号，content 最多 1,200 码点；不拆开代理对。正文纯文本，初始三行，鼠标移入或右方向键聚焦卡片后展开；展开区域有限高并允许滚动。不截短持久消息，空会话不发预览 IPC。预览失败显示中文读取状态，不触发网络请求。未知 sessionId 沿用既有参数/会话不存在错误。
- `RuntimeContext.emit({type:'title',title:string}) → Promise<void>`：由已注册且活动的实际运行时适配器交付 metadata，不是模型工具。无效值抛出 `RUNTIME_TITLE_INVALID`；现有 `RUNTIME_OWNER_MISMATCH`、`RUNTIME_EVENT_EXPIRED` 和运行时停用处理继续生效。可忽略被手动保护的标题；适配器应 await 事件以保留次序。核心没有命名工具、额外 turn、后台标题总结器或注入提示。
- `Session.titleSource?: 'fallback'|'native'|'manual'` 在本地状态持久化；新建用户会话初始 fallback，`session/update({id,title})` 在同一串行写入中标记 manual。旧记录没有来源时保守保护，不以标题语言或是否类似前缀猜测。来源标记不写入原生数据、不改原生 name、不随停用删除。
- 路由调用仍经工作台现有能力和整包批准边界；不授予新账号、设备、系统或远端权限。服务覆盖为同步方法，返回值遵循上述契约；UI 再次限制返回正文长度。读取不写入状态，标题的成功更新沿用既有状态广播，无独立模型事件或网络资源。无新增配置、模型/语言目录或全局快捷键（右方向键属于已聚焦侧栏的局部导航）。

```js
export function activate(api) {
  api.services.intercept('sessions.presentation', 'preview', (next, session) => {
    const result = next(session);
    return { ...result, excerpt: result.excerpt }; // Delegate or supply a bounded presentation.
  });
  api.runtimes.register(runtimeDefinition, {
    async run(context, input) {
      const result = await adapter.run(input, context.signal);
      if (result.nativeTitle) await context.emit({type:'title', title:result.nativeTitle});
    },
    async stop(context) { await adapter.stop(context.signal); },
  });
}
```

同一批准包的 renderer 入口：

```js
export function activate(api) {
  api.observeSurfaces('session-preview-body', 'replace', async ({root,target,signal}) => {
    const result = await api.call('session/preview', {sessionId:target.dataset.sessionId});
    if (!signal.aborted) root.textContent = result.excerpt;
  });
}
```

示例中的运行时/适配器由插件实现；仅存在文档，不安装到用户环境。注册和 intercept/override 的释放句柄由既有宿主自动拥有，也可主动调用；多插件后注册层优先，释放恢复剩余层。具名 session-preview 为卡片内部内容，外层仍拥有定位、hover/focus/Escape；session-preview-body 为正文区域，每个目标的 `data-session-id` 是来源标识。原 `.sidebar-session-preview` 外层保留，依赖直接子结构的旧插件应迁移具名 surface；私有 CSS 子结构不是稳定契约。新/移除实例与异步完成遵循 observeSurfaces 清理。启用/停用事件使当前卡片重新读取预览；移出、换会话、内容变化或插件变化丢弃迟到读回。

### 兼容与验收

API v1 增量新增路由、title 事件成员、两处 surface 与来源类型，旧适配器不发 title 时无需修改。公开声明、路由和具名 surface 纳入契约快照，未替换旧签名。持久字段可选，旧配置无需迁移；手动标题优先规则属于明确语义变更。模型/语言/提供方目录没有新增选项，因此目录选择与缺失选项回退不适用；原生未提供 metadata 时原截取路径仍在。

`tests/session-presentation.test.ts` 覆盖 Unicode 上限、翻译失败、精确原生标题、绑定身份及手动/旧记录/分支保护；`tests/session-native-title.test.ts` 经本地真实 RPC 客户端与 SSH runner 的合成传输验证 name/notification、无额外命名请求及断连；`scripts/test-session-preview-ui.mjs` 使用真实导入、整包批准与激活的合成运行时/renderer 插件，贯通事件 → 会话列表、预览 route → 服务覆盖 → 卡片。覆盖未批准拒绝、已有与后续实例、异步迟到释放、多插件、注册挂载失败、停用/重启用与已结束事件拒绝。缺包/删除沿用停用清理，旧运行时兼容与缺包重启由 `tests/runtime-extensions.test.ts` 回归。

本轮隔离验证：33 项协议/单元及既有运行时测试、8 项隐藏 Electron 行为检查与 31 项侧栏 UI 回归通过；类型检查、插件契约检查和公开文档检查通过。浅色折叠、展开与深色窄窗截图已人工复核。未运行真实模型任务，不保证运行时主动生成标题；没有远端部署、活动客户端操作、原生私有历史读取或用户环境示例安装。侧栏旧回归夹具同步采用实际配置字体、现行纯展示/发现 IPC 和新的具名正文容器，不修改产品字体。产品一次只显示一张会话卡，因此并发多卡不适用；后来出现的不同会话实例已覆盖。未把其他窗口尚未提交改动纳入本轮验证范围。
<!-- session-native-preview:end -->

<!-- session-hover-repair:start -->
## 会话悬停连续性与标题编辑（2026-09-30）

### 实现前接口审查

| 影响范围 | 调用现有能力 | 注册新实现 | 替换与恢复 |
|---|---|---|---|
| 标题编辑 | `session/update({id,title})`，读取 `api.onState` 中实际标题 | `api.observeSurfaces('session-preview-title', position, mount)` 注册局部标题编辑器 | 具名 surface 的 replace；停用恢复核心按钮/输入框，不回滚已保存的手动标题 |
| 预览正文及元数据 | `session/preview`、`sessions.presentation`、`api.onState` | 既有 `session-preview` / `session-preview-body` 多实例挂载 | 既有服务 intercept/override 与 surface replace；外层管理定位、鼠标和焦点生命周期 |
| 触发与关闭 | 侧栏会话行的 hover/focus；有焦点时 ArrowRight；Escape 关闭 | 本轮没有新运行时、语言、主题、快捷键目录或可持久化选项，目录注册不适用 | 既有 `sidebar` surface 可替换导航；局部 `session-preview` / `session-preview-title` 可替换内容及编辑器，外层保持转移和关闭契约 |

受影响的公开命令与服务签名不变，新增具名 `session-preview-title` 和 `data-session-id` 身份标记；来源仍沿用 `Session.titleSource` 的 manual 保护及既有状态广播。不添加模型任务、网络资源、原生改名写入或用户配置。

### 契约、示例与生命周期

- `session/update({id:string,title:string}) → Promise<AppState>`：沿用既有宿主参数校验，标题非空且至多 150 个 UTF-16 单元；成功串行保存并标记 manual，广播实际状态。会话不存在、参数无效和持久化失败按现有 IPC 错误返回，不自动重试。相同标题取消编辑不产生写入。
- renderer `api.observeSurfaces('session-preview-title', 'before'|'after'|'replace', SurfaceRenderer) → dispose`：生产 `workbenchSurfaces` 指向 `[data-workbench-session-preview-title]`；每个目标通过 `target.dataset.sessionId` 指定会话。与既有 surface 一样传入 `{root,target,signal}`，允许同步/异步清理。整包批准、注册失败、自动回滚、后注册层优先及释放恢复规则不变，不增加原生配置或系统权限。
- 核心标题按钮单击进入行内输入，点击保存或 Enter 提交；取消按钮/Escape 只取消当前编辑，第二次 Escape 关闭卡片并回焦原行。输入法确认不会提交。保存期间阻止重复提交；失败保留输入并显示错误；卡片卸载后的迟到结果不会移动焦点或修改另一张卡片的编辑状态。显式关闭未提交编辑会丢弃草稿。
- 裸 ArrowRight 是有焦点的会话行的局部导航，现在可在 300ms hover 延迟前立即打开并聚焦；不是全局固定键，不截获正文输入框的方向键。鼠标移入卡片即可展开。浮层内有焦点时移开鼠标仍保留，离开其焦点和 hover、点击外部、Escape 或锚点滚动时关闭。
- 行内快捷按钮停留才替换预览为小提示；穿过它们进入卡片不再立即销毁卡片。返回同一行标题重新触发 hover。正文区域滚动不影响侧栏预览；侧栏/窗口滚动与 resize 仍关闭失去定位依据的浮层。

```js
export function activate(api) {
  return api.observeSurfaces('session-preview-title', 'replace', ({root,target,signal}) => {
    const input=document.createElement('input');
    input.setAttribute('aria-label','Conversation title'); input.maxLength=150;
    const save=document.createElement('button'); save.textContent='Save';
    save.addEventListener('click',async()=>{
      save.disabled=true;
      try { await api.call('session/update',{id:target.dataset.sessionId,title:input.value}); }
      finally { if(!signal.aborted)save.disabled=false; }
    },{signal});
    root.append(input,save);
  });
}
```

示例仅供插件开发，不预装。实际替换编辑器应通过 `api.onState` 读取标题并显示调用错误。停用、移除目标、激活失败均释放监听与挂载，恢复其余层；停用或包缺失不撤回已保存标题。现有 `session-preview` / `session-preview-body` 不改名；外层由不可交互的 tooltip 语义修正为非模态 dialog。旧插件若定位私有 `<strong>` 文本应改用新具名 surface 与 `data-session-id`，不要依赖编辑器子节点。API v1 增量扩展，不要求旧插件注册新 surface；持久格式与公开命令签名未改，契约快照只增加一处 named surface。

### 验证与边界

`scripts/test-session-hover-ui.mjs` 先在修复前重现五处关闭/时序问题，并另行重现经过快捷按钮中断鼠标路径的问题。修复后 18 项隐藏 Electron 检查通过，包括鼠标路径、快速切换、键盘/焦点、输入法、空值、失败/迟到保存、手动标题保护；真实导入/整包批准/激活的合成插件贯通 title surface → session/update → state → 侧栏。覆盖已存在及后续实例、多插件叠加、挂载失败、异步清理、停用/重启用、删除隔离插件包后重新加载恢复。产品同一时刻只有一张会话卡，并发多卡不适用。

兼容回归使用 `scripts/test-session-preview-ui.mjs`、`scripts/test-sidebar-ui.mjs`、`tests/session-presentation.test.ts`、`tests/session-native-title.test.ts`、`tests/runtime-extensions.test.ts`、`tests/plugin-api.test.ts`、`tests/plugin-services.test.ts`、`tests/sidebar-actions.test.ts` 和 `tests/sidebar-session-order.test.ts`。审阅范围只含本次悬停/标题编辑及具名 surface；无新增核心专用目录、设置名单或模型生成分支。人工检查浅色卡片与深色窄窗输入框；不读取真实聊天库，不操作活动客户端或安装真实环境示例，不把其他窗口未提交工作纳入验收。
<!-- session-hover-repair:end -->


## 上下文环零值回执修复（2026-09-30；U57）

接口先审范围：原生 Claude stream_event/assistant/compact_boundary、runtime.native-provider.openGateway/submit、NativeGatewayOptions.usage、Session.nativeContextUsage/metrics、state/get/onState、currentProviderContext/displayedContext 及既有 .model-controls surface。本次没有新增模型、运行时、配置选项、资源、权限或界面结构；目录注册与旧定位迁移不适用。

| 功能覆盖 | 调用现有能力 | 注册、替换及实际消费路径 | 验证 |
| --- | --- | --- | --- |
| 原生上下文回执 | 既有 runtime.native-provider.submit(id,preview)；openGateway(options:NativeGatewayOptions) 返回会话网关 | 已批准插件通过 services.intercept/override 包装 openGateway；原生进程实际消费网关 SSE，宿主保存 nativeContextUsage 后发布 state。新运行时仍通过注册 RuntimeAdapter 的 context 事件提交 NativeContextUsage | scripts/test-context-usage-native.mjs，tests/runtime-extensions.test.ts |
| 圆环和旧记录恢复 | state/get/onState 提供 Session；currentProviderContext(session,model) 返回 NativeContextUsage 或 undefined；displayedContext 返回容量、原生预算和百分比 | 既有 .model-controls 多实例 surface 可替换显示；不增加私有 DOM 契约。底栏累计统计继续独立读取 Session.metrics | tests/context-usage.test.ts，scripts/test-context-usage-ui.mjs |

语义修复：Claude 可在最后的 message_delta 到达前先发出 assistant，其用量仍为开始帧的零值。宿主现按单条消息合并 message_start 与 message_delta 的实际字段，缓存输入只计一次；不把 result.usage 的回合累计量当作当前上下文。开始帧、迟到旧助手快照和子流不覆盖已确认的根会话用量；新请求重置合并状态，压缩/重置丢弃旧流状态，显式 post_tokens=0 仍有效。新回执填写既有 turnId 字段，无存档格式变更。

旧 Claude 全零、无 turnId 的记录，仅在同一来源、运行时、原生线程、模型及当前回合有完整请求回执时恢复显示。使用最新请求而非累计量；后续压缩/重置阻断旧回执恢复，非零原生值、带 turnId 的零值和原生预算保留。此 selector 不写回存档，不读取原生私有聊天库，不发模型请求。未知数值继续未知，旧记录缺少匹配证据时不估算。

错误、权限与生命周期沿用既有契约：非法流计数忽略，尚无完整回执不抛异常；批准代码包才可改变网关，停用/移除释放拦截器并恢复核心。用隔离 ZIP 经过拒绝未批准、批准启用、停用、重新启用和包移除，验证真实 NativeProviderRunner 与已安装原生 CLI 的上下文消费；未安装到用户插件目录。未新增注册目录，因此目录多选项冲突、旧选择回退和新注册失败不适用；未改 surface，动态实例/异步释放沿用现有界面扩展生命周期。

兼容审查：apiVersion:1、公开类型/方法签名、具名 surface 与持久结构不变，契约快照无需刷新；这是对原生回执时序的语义修复。内部 tracker 不是新增稳定插件入口。测试位置还包括 tests/claude-fork-usage.test.ts、tests/native-provider.test.ts、tests/native-streaming.test.ts 与 scripts/test-native-compaction.mjs。真实 CLI + 合成上游证据不替代真实付费模型、用户已有会话及远端网络验收。

<!-- claude-native-title:start -->
## Claude 原生标题元数据适配（2026-09-30）

接口先审：受影响入口为本机原生 Claude 执行器、会话预览 route、标题状态广播及既有标题 surface。新增 `session/native-title/refresh` 和生产服务 `sessions.native-titles.read`；调用方只传工作台会话 ID，宿主解析已绑定原生 UUID、项目目录和该执行器实际配置根。不传令牌、不请求模型生成标题。

| 功能 | 调用 | 注册新实现/选项 | 替换 |
|---|---|---|---|
| 已绑定会话标题刷新 | `session/native-title/refresh({sessionId})` | 新运行时仍经 `api.runtimes.register` 发出既有 title 事件，无新运行时目录项 | host `api.useHost` 包装上述实际 route |
| 原生标题元数据读取 | host `sessions.native-titles.read(request)` | `api.services.override/intercept` 注册有清理句柄的新读取实现；无新增 UI 选项或用户配置目录 | 本机执行器初始化/收尾与活动预览读取同一生产服务实例 |
| 采用与显示 | `sessions.presentation.nativeTitle`、既有 onState | `session-preview-title` / `session-preview` 多实例挂载 | 既有手动标题保护、来源字段与局部 surface 替换/恢复 |

仅接收明确的 native customTitle/aiTitle，不将 summary、firstPrompt、消息正文或 hook 输入猜作自动标题。原生存储未知、不可读或没有标题时保持首条消息截取；SSH 的本机读取不适用，不猜测远端路径或触发远端命令。

### 入口、类型与生产接线

公开声明位于 `packages/session-core/native-titles.ts`，宿主生产单例由 `WorkbenchController.developmentServices()` 注册为 `sessions.native-titles`。接口为：

```ts
interface NativeTitleReadRequest {
  runtime: string;
  nativeSessionId: string;
  cwd: string;
  configDir: string;
  projectDirectoryName?: string;
  signal?: AbortSignal;
}
interface NativeSessionTitle {
  nativeSessionId: string;
  title: string;
  source: 'custom' | 'generated';
}
interface NativeSessionTitlesService {
  read(request: NativeTitleReadRequest): Promise<NativeSessionTitle | undefined>;
}
type NativeTitleRefreshResult = {
  status: 'updated' | 'unchanged' | 'unavailable' | 'protected';
};
```

- `session/native-title/refresh({sessionId:string}) → Promise<NativeTitleRefreshResult>`：只接收工作台会话 ID；宿主从绑定取得本机 Claude 原生 UUID、项目路径及同一执行环境的配置根。官方账号使用其独立原生目录，其他本机 Claude 使用实际 CLI 环境的 `CLAUDE_CONFIG_DIR` 或该 CLI home 下的 `.claude`。不向插件请求传入认证环境、令牌或消息。无效 ID/不存在会话沿用既有 IPC 参数错误。
- `updated` 表示实际标题或来源标记更新，`unchanged` 表示已采用相同原生标题，`unavailable` 表示不支持、没有可靠标题、读取失败、超时或实现已经释放，`protected` 表示手动、未知来源旧记录、分支或子会话标题受保护。没有可靠 metadata 时不清空、翻译或重新生成名称；具体语言沿用原生文本。
- `NativeProviderRunner.refreshTitle(id)` 是执行器公开服务方法；同一 ID 的并发刷新共用当前 Promise。根 Claude `system/init`、回合结束、所属进程清理完成后以及现有 `session/preview` 都调用该入口。`session/preview` 返回形状与正文上限不变，新增尽力刷新步骤最多等待标题读取 1,500ms。更新继续经过 `sessions.presentation.nativeTitle` 和串行状态更新；既有 `state` 广播刷新侧栏/卡片，没有新增模型事件或自动重试循环。
- `read` 默认只读一条已绑定原生会话。要求有效 UUID、绝对 cwd/configDir；解析实际目录后限定 `projects/<原生项目键>/<UUID>.jsonl`，不枚举其他项目或会话。读取首部 64KiB 与尾部最多 256KiB 加一个边界字节，只从完整顶层记录提取同一 sessionId 的 customTitle/aiTitle，忽略 user/assistant 标题属性、提示与压缩摘要。文件 IO 可能包含消息记录字节，但不返回、存储或展示正文。拒绝旁支、观察到的 cwd 不匹配、符号链接和非法标题；标题非空、无控制字符且最多 500 UTF-16 单元。
- 兼容原生 UUID 子目录内至多 16KiB 的 `custom-title.json`；尾部明确 customTitle 优先，只有首部历史 customTitle 时允许 sidecar 更新覆盖。仅在实际环境显式设置配置根时传入已验证的单目录 `CLAUDE_CODE_PROJECT_DIR_NAME`；其他超过已支持长度的原生哈希目录布局保守回退，不扫描查找。原生未落盘或超出窗口的 metadata 不保证被发现。

### 扩展、权限与清理

```js
export function activate(api) {
  // Host entry of a fully approved workbench package.
  const release = api.services.intercept('sessions.native-titles', 'read', async (next, request) => {
    if (request.signal?.aborted) return undefined;
    return next(request);
  });
  api.registerMethod('example.native-title/refresh', ({sessionId}) =>
    api.call('session/native-title/refresh', {sessionId}));
  return release;
}
```

替换实现使用 `api.services.override('sessions.native-titles', {read: async request => /* metadata or undefined */ undefined})`，返回既有清理句柄；生产执行器和预览读取同一实例，不要求修改核心。第三方运行时仍通过 `api.runtimes.register` 接入真实运行流程并 `context.emit({type:'title',title})`，本次没有添加运行时/语言/模型选项或固定选择器名单。目录注册、选项失效回退因此不适用；原生缺 metadata 的回退仍由标题策略提供。现有 `session-preview-title`、`session-preview-body`、`session-preview` surface、`data-session-id` 和 API v1 保持不变，无新增 DOM 定位迁移或用户配置格式。

服务覆盖要求既有整包批准的 host 能力，沿用服务清理/后注册层优先规则；不构成对其他账号、设备、远端或系统权限的授权。读取失败返回 unavailable，不影响模型执行、不写原生文件、不安装 SDK、不发命名请求。自定义实现应响应 signal；宿主在 1,500ms 超时、结束请求或 dispose 时 abort，并在写入前再次验证读取实现身份、会话绑定、项目目录和手动保护。停用/替换后的迟到返回丢弃；插件自身忽略 signal 的 IO 不代表宿主可以强制终止其代码。停用、激活失败及包缺失恢复剩余层或核心实现，不撤回已保存标题；再次启用按新实现读取。

### 兼容与验收记录

API v1 增量增加一条 route 和四个类型声明；`session/preview` 的返回结构、既有 title 事件及持久来源字段不变，语义新增本机 metadata 刷新。契约快照增加本文件公开声明和 route，旧插件无需实现新服务；手动和未知来源旧配置保持保护。不读取通用 `SDKSessionInfo.summary` 作为 title，避免其 prompt fallback 改变现有命名约定。没有额外模型调用、注入提示、语言转换、远端标题读取或原生写回。

- `tests/claude-native-title.test.ts`：10 项覆盖明确字段/sidecar、账号根/UUID/cwd/旁支/链接、巨大记录/部分写入/窗口边界、原生目录覆盖、历史 sidecar 优先、真实 runner 调用与持久化、相同文本来源升级、手动/绑定/释放迟到保护、超时与 shutdown。合成官方账号执行路径只提交一条原始用户 turn，确认没有 naming 内容。
- `scripts/test-claude-title-ui.mjs`：6 项隐藏独立 Electron 检查；实际导入、整包批准/激活的合成 ZIP 贯通生产 reader → refresh/preview → 列表与卡片。覆盖未批准拒绝、已有/后续会话、多层覆盖、激活失败回滚、停用/重新启用、迟到结果与删除隔离包后重载恢复。手动标题持久化与 native fallback 通过；零 renderer errors，已复核浅色实际标题截图。同一时刻只展示一张会话卡，并发多卡不适用。
- 针对性协议/单元/插件/模型档位回归 49/49，合并已提交原生事件修复后加入 5 项事件路由形成 54/54。既有预览 8/8 和原生标题 6/6 在新基线上再次通过；悬停 18/18、类型、`check:plugins` 与 `check:docs` 结果及基线记录在文档 16。

验收材料仅在忽略的 `build/qa/claude-native-title`。官方 metadata helper 的合成交叉核对及许可边界见文档 07；不把本次合成数据读取说成 print/stream-json 每次会自动生成标题，不宣称真实模型、远端、活动客户端或其他窗口未提交工作通过验收。
<!-- claude-native-title:end -->


<!-- file-navigation-resolution-20260930:start -->
## 文件链接解析、候选选择与操作一致性（2026-09-30 JST）

### 先行接口审查与功能覆盖矩阵

本次审查覆盖 Markdown/行内代码识别、任务目录、项目多文件夹、已加载公开工具路径、文件预览、右键信息、打开/定位/复制/另存为、候选 UI 和插件释放。不改模型工具、远端文件服务或会话工作目录，不增加持久偏好、运行时枚举或自动执行。高亮表示语法识别，不等于文件已存在；实际定位只在用户操作后读取本机元数据。

| 功能 | 调用与生产路径 | 注册新的实现或选项 | 替换与清理 | 验证 |
| --- | --- | --- | --- | --- |
| 语法及路径编码 | `api.markdown.link` → `fileLinkDestination` → `fileReference`；行内代码按字面文件名识别，复制链接使用 `fileMarkdownDestination` | 没有增加协议目录；支持范围固定为本机文件和既有 HTTP(S)，自定义可执行协议不适用；新的本机定位来源由下列注册接口提供 | 渲染替换使用具名 file-link；不修改原消息或发送内容 | file-links、message-markdown 测试 |
| 定位与候选 | `files/resolve` → controller → 生产 `files.navigation.locate/resolve`；FileBrowser/LinkMenu 消费结果 | `files.navigation.registerSource({id,candidates})`，具名且带类型/释放句柄；候选实际进入同一个定位器 | `api.services.intercept/override('files.navigation', …)`；核心及来源共同受后续本机 realpath/平台校验 | file-navigation 测试及完整 Electron 脚本 |
| 预览及文件动作 | files/browse、files/info、files/reveal、files/open、files/copy-content、files/save-as 全部先调用生产定位器；右键确认后使用同一规范路径 | 上述来源同样参与所有动作；原 actions.file-actions 服务继续可扩展动作实现 | 定位服务可替换，动作服务的旧参数结构保留；释放后回到核心 | 真实 controller、FileActionService、临时文件及 OS shell 参数边界 |
| 文件链接与候选界面 | MessageText、LinkMenu、FileBrowser 消费生产结果；候选经显式选择再次核验后打开 | `observeSurfaces` 支持下面四个具名、多实例挂载点及后续动态实例 | before/after/replace 及已注册释放、停用恢复；不要求全应用替换 | 真正批准 ZIP 的界面注册、动态实例与失败恢复 |

### 契约、语义与边界

新增主机入口 `files/resolve({sessionId?:string,path?:string}):Promise<FileResolutionResult>`；path 最大 4096 字符，缺省沿用会话工作区。公开类型见 `packages/navigation/file-resolution.ts`：

- `FileResolutionRequest {cwd:string; requested?:string; roots?:readonly string[]; knownPaths?:readonly string[]}`。
- `FileResolutionResult` 成功为 `{status:'resolved',path:string,line?:number}`；非唯一或查找未完成为 `{status:'ambiguous'|'incomplete',requested:string,candidates:string[],message:string}`。候选均为已核验的本机完整路径，但 incomplete 不声称列出全部匹配项。UI 显式选择后以完整路径复查；没有自动挑选第一个结果。
- 生产服务 `files.navigation` 实现 `FileNavigationApi`：`resolve(request):Promise<string>` 严格要求唯一，`locate(request):Promise<FileResolutionResult>` 保留候选，`registerSource(source):()=>void` 注册本机候选提供方。`FileResolutionSource` 的 id 为 `plugin:<plugin-id>/<name>`，`candidates(request,signal)` 返回最多 256 个完整路径或其 Promise。调用者将释放句柄交给 `api.onDispose`；信号在本次调用结束/超时及注册停用时终止。来源最多等待 2 秒，失败明确报告，迟到结果不恢复旧注册。
- 定位顺序：明确路径相对于会话冻结目录；缺失的非点号相对引用才依次查询已加载结构化文件记录、项目/公开工具工作目录、插件来源，最后有界发现子目录。绝对路径、`./`、`../`、`~/` 失败不跳到同名文件；没有会话目录时不使用主进程 cwd 猜测。相同层的多候选返回歧义，磁盘不存在的旧记录不使用。
- 有界发现默认最多 20,000 个目录项、2,000 个目录、2 秒；不自动遍历磁盘根目录，不跟随发现到的符号链接/junction，不展开 .git、.hg、.svn、node_modules、__pycache__、.cache。达到限额或不能读取某个目录时返回 incomplete 和已找到的候选；显式完整路径仍可访问这些普通本机目录。只检查目录项、realpath/stat，不读取候选文件正文，不解析或执行 shell 命令。用户选择后预览仍沿用 UTF-8/1 MB 限制。
- 同一设备普通文件仍受 OS 权限约束；UNC、网络 file authority、设备不兼容路径和可执行 URI 保持拒绝。已批准 host 插件属于完整包信任；注册本机候选不增加另一设备、租户、管理员或模型执行权限。源文件不因定位被写入。
- 保留原来的 `:line[:column]`、`#Lline[Ccolumn]`，增加对应范围尾缀，定位到起始行；相对目录、中文、空格、括号、方括号、百分号和点文件可识别。file URI 只解码一次；行内代码中的 `%20` 是字面文件名，Markdown URL 中的 `%20` 是编码空格。复制 Markdown 时编码百分号/井号并转义标签，避免再次打开另一文件。普通 fenced code 不转换为链接。

错误：`FILE_NOT_FOUND`、`FILE_PATH_AMBIGUOUS`、`FILE_SEARCH_INCOMPLETE`、`FILE_SOURCE_FAILED`；注册错误为 `FILE_SOURCE_INVALID`、`FILE_SOURCE_DUPLICATE`。`resolve` 的歧义/不完整错误还含 candidates；`locate` 把两者转换为上述可选结果。无新增推送事件；每次用户操作读取当前文件及活动注册，不保存猜测或候选缓存。切换文件清空旧内容，异步旧请求不能覆盖新的预览；根目录和既有标签可继续导航。

具名界面契约：`file-link`（data-workbench-file-link，data-file-path、可选 data-file-line）、`file-link-menu`（data-workbench-file-menu）、`file-reader`（既有 data-testid=file-dock）、`file-link-candidates`（data-workbench-file-candidates）。旧 .message-link、.link-menu、file-dock 定位保留；旧插件建议迁移到这些具名 surface，不依赖内部按钮层级。原 API v1、消息、会话和持久配置无需迁移；新类型和 surface 已纳入契约快照，旧动作方法仍接受原字符串参数。

```js
export function activate(api) {
  const navigation = api.services.get('files.navigation');
  api.onDispose(navigation.registerSource({
    id: 'plugin:' + api.id + '/project-aliases',
    candidates(request, signal) {
      if (signal.aborted || request.requested !== 'guide.md') return [];
      return ['/example/project/docs/guide.md']; // Configure a real local absolute path.
    }
  }));
  api.registerCommand('locate', payload => api.call('files/resolve', payload));
  api.services.intercept('files.navigation', 'resolve', (next, request) => next(request));
}
```

实际 host 入口由 `controller.developmentServices()` 登记同一个 FileNavigationService 实例；不是测试专用对象。新目录或自定义别名经 registerSource 进入真实 reader、菜单及动作，清理返回内置定位器。候选目录不是用户偏好，停用无需保留不存在的选项 ID；文件标签已记录的绝对路径不改写，重新启用后下一次短引用定位恢复来源。

测试位置：`tests/file-navigation.test.ts`（真实 controller、磁盘、注册来源及批准 ZIP）、`tests/file-links.test.ts`、`tests/message-markdown.test.ts`、`tests/file-actions.test.ts`、`tests/session-workspace.test.ts`；`scripts/test-file-resolution-ui.mjs`（隐藏独立生产 Electron、真实 Monaco/IPC、合成文件、批准插件、候选及键盘）、`scripts/test-message-file-links-ui.mjs`（原文/译文/子会话）。验收结果和未验证边界记录于文档 16。无开发示例安装到实际用户环境。


UI 状态盘点：本次没有新增可调偏好、窗口参数、阅读模式或默认值。候选集合、读取中/错误、菜单开合以及单次选择是瞬时导航状态，作用域为当前路径请求；不能持久化为文件别名或下次运行的存在性证据。下一次操作重新读取磁盘和活动插件，切换请求清理旧结果。既有文件标签、文件面板及分隔条的偏好所有者和存储格式不变；不把另一窗口尚未提交的全局 UI 持久化工作纳入本次验收。新候选按钮属于一次动作而非可保存开关，因此首次安装/配置迁移、显示器回退和重启恢复新偏好不适用；选择的完整路径按现有 reader 导航路径消费。

普通文档 `#section` 片段不会拼进磁盘文件名；打开对应文档但不承诺按标题滚动。字面井号文件名通过 `%23` 编码保留。
<!-- file-navigation-resolution-20260930:end -->

<!-- native-termination-20260930:start -->
## 原生回合结束与跨协议失败分类（2026-09-30）

接口先审范围：draft/prepare、draft/submit、session/api-acknowledge、session/native-reconcile、runtime.native-provider 的 submit/openGateway、runtime.codex 的事件/核对路径、NativeGatewayOptions.diagnostic、Session.nativeError/nativeTurnStatus、TurnTiming.error、state/get/onState，以及既有 turn-error/turn-progress 具名 surface。模型目录、执行位置、账号身份、权限和原生工具生命周期不变；不新增运行时或用户可选项，因此没有新目录注册和偏好默认值迁移。没有新增界面节点、交互状态或可调整控件；UI 偏好清单的既有所有权不变。

| 能力 | 调用现有能力 | 注册或替换 | 生产路径与验证 |
|---|---|---|---|
| 第三方原生网关 | runtime.native-provider.openGateway(options:NativeGatewayOptions) → Promise<{baseUrl,token,flushUsage,close}>，原 submit 路径实际调用 | 完整批准的 host 插件通过 services.intercept/override 注册具名网关处理器并返回释放句柄；新运行时仍由 RuntimeAdapter 注册进入实际选择器 | 两家 CLI 的真实请求经过网关；scripts/test-native-termination.mjs 覆盖批准、激活、停用、重启用与包移除恢复 |
| 失败分类与持久回执 | diagnostic(value:NativeProviderDiagnostic):void；state/get/onState 读取 nativeError 与历史 TurnTiming.error | 同一 openGateway 参数包装可观察或替换诊断策略；runtime 服务原有 submit/reconcile 可替换，错误 surface 支持多实例局部替换 | tests/native-termination.test.ts、tests/turn-timing.test.ts、scripts/test-session-feedback-ui.mjs |
| 跨协议请求及结束验证 | 既有 nativeWireRequest、collectStream、parseTurn，网关实际调用 | openGateway 是生产替换边界；无需私有 DOM 或替换整个应用 | tests/native-provider.test.ts、tests/native-streaming.test.ts、tests/native-stream-transport.test.ts、scripts/test-native-stream-tools.mjs |

NativeProviderDiagnostic 增量增加 timeout、transport、protocol 分类；status 仍为 HTTP 数值，code/param 仍可选，summary 为固定英文。新代码为 NATIVE_UPSTREAM_TIMEOUT（504）、NATIVE_STREAM_INCOMPLETE（502）、NATIVE_UPSTREAM_PROTOCOL（502）、NATIVE_UPSTREAM_TRANSPORT 或允许的连接错误码（502）。诊断不复制异常原文、地址、令牌、提示或工具内容。HTTP 上游错误原分类保留；旧插件应给未知分类提供通用展示，不能解析固定提示文本作为协议。网关失效回调不阻挡关闭/清理，诊断钩子抛错也不会漏清理。

跨协议且有工具时，在原生系统说明末尾附加英文传输约定：没有独立进度通道，需要继续工具工作时必须在同一次响应返回工具调用；纯文本会结束原生回合。原生说明前缀、用户内容及工具定义保留。同协议、无工具请求和官方账号直连不添加该段。不按自然语言推测或创造工具，不添加自动“继续”、额度轮换或宿主重试。该提示只缓解语义不匹配，不能保证模型任务完成质量。

声明 tool_calls/tool_use 却没有调用、跨协议无法表示的工具类型、未完成的输出项和错误协议结束标记不得伪装成纯文本成功。同协议转发保持字节内容；没有终止回执的 SSE EOF 追加明确错误，不制造完成帧。原生重试显示为重试中，成功回执清理对应临时错误；最终失败分类保存到所属回合，下一条消息及重启不抹掉历史错误。过期回合和子线程结束不能完成根回合。明确 commentary 保留阶段，不因 turn/completed 强改 final。

示例（在已批准 host 包的 activate 内）：

```js
api.services.intercept('runtime.native-provider', 'openGateway', (next, options) =>
  next({ ...options, diagnostic(value) {
    // Persist only the typed, bounded classification when needed.
    options.diagnostic?.(value);
  } }));
```

apiVersion 1、现有宿主方法、状态格式版本和具名 surface 不变；不迁移用户配置，不把老会话的缺失上游完成原因补成已知。新增分类属于可枚举契约扩展，网关/诊断公开类型加入契约快照并审阅。测试还覆盖官方账号分支、两家终止错误、断流/超时、失败后存储恢复、过期回执、成功重试、插件停用及恢复。多插件/动态实例/异步挂载失败使用既有错误 surface 的实际批准 ZIP 验收；本次未新增 renderer 挂载点。注册失败不会启动模型或授权新资源。权限仍是整个代码包批准及所属会话权限，不扩大账号、租户或设备边界。

验证区分：真实 CLI 加合成上游可证明工具循环和回执消费，不能证明官方账号或第三方真实模型的长任务可靠性；故障会话只做指定日志读取，没有重发、续跑或修改它。未修改活动客户端或部署远端，其他窗口未提交工作不属于此提交范围。
<!-- native-termination-20260930:end -->

<!-- remote-login-osc8-20260930:start -->
## Claude 远端登录终端链接修复（2026-09-30；U5、U6）

接口前置审查：受影响路径为 `remote-browser/start` → `actions.remote-browser.start` → SSH 请求内的 `browser_api.login` → 所选远端浏览器 profile。修复只改变原生 PTY 输出中的 URL 边界识别：OSC 8 的 BEL/ST 和其他控制字符不进入 URL，分段读取必须等到真实结束符；同一目标及其显示文本继续去重。不改变官方地址白名单、原生授权、浏览器 UID 或账号权限。

| 功能覆盖 | 调用、注册或替换入口 | 生产消费与验证 |
| --- | --- | --- |
| 开始既有登录 | `api.call('remote-browser/start',{id,accountId,profileKey})` → `Promise<BrowserLogin>` | controller 的管理员/运行时互斥检查 → 注册的 `actions.remote-browser.start(host,catalog,accountId,profileKey)` → 所属 SSH/PTY；`scripts/test-remote-browser-login.py` |
| 查询、取消、一次性代码 | `remote-browser/status({id,jobId})`、`remote-browser/cancel({id,jobId})`、`remote-browser/code({id,jobId,code})` → `BrowserLogin`；`remote-browser/open({id,jobId})` → void | 绑定同一 SSH 身份及 jobId；仅原生提示后提交代码，open 只打开回环 viewer；`tests/remote-cli-browser.test.ts`、`tests/controller-remote-management.test.ts` |
| 注册扩展工作流 | `api.registerCommand(name,handler)` 在批准包内注册，handler 调用上述具名入口，返回释放函数 | 真实 PluginRegistry 批准/激活 → command → controller；`tests/remote-browser-login-plugin.test.ts` |
| 包装或替换登录实现 | `api.services.intercept('actions.remote-browser','start',handler)` / `override('actions.remote-browser',{start?,status?,code?,cancel?,openViewer?})` | 操作实际宿主注册实例；每个替换成员保持原签名，返回释放函数并由插件生命周期回收；同一测试覆盖两个批准包共存、异步在途调用、失败清理和停用恢复 |

`BrowserLogin` 的既有类型在 `packages/remote-account-catalog/browser.ts`：`{jobId,accountId,state,viewerReady,codeRequested,cleanup,error?}`，state 为 preparing/awaiting-browser/authenticated/cancelled/expired/failed，cleanup 为 pending/confirmed/unconfirmed。无新增字段或推送事件；状态继续经现有查询回执取得，OAuth URL 不返回 renderer、不保存、不进入模型上下文。错误保留 `BROWSER_BUSY`、`BROWSER_CLOSED`、`LOGIN_DISCONNECTED`、`INVALID_AUTH_CODE`、`NATIVE_AUTH_UNCONFIRMED` 等现有英文码及宿主中文映射，不用导航成功代替认证回执。

本次没有新主题、运行时、账号类型、选项目录、设置、资源或具名 UI surface，因而无须新增可注册选择器。没有用户可调控件、布局或默认值变更；登录 URL、PTY 控制字符及本次进度属于瞬时授权交互，不应纳入持久偏好。现有浏览器用户资料、选择持久化所有者和 UI 偏好盘点均不变。没有 DOM 定位迁移。

示例（批准的 host 插件内；示例不安装到用户环境）：

```js
const release = api.services.intercept('actions.remote-browser', 'start',
  (next, host, catalog, accountId, profileKey) =>
    next(host, catalog, accountId, profileKey));
api.onDispose(release);
api.registerCommand('login', input => api.call('remote-browser/start', input));
```

兼容与生命周期：apiVersion 1、公共声明、宿主方法、具名 surface、持久格式与契约快照均无变化，已审查语义及释放路径，不刷新快照来绕过门禁。纯文本和既有 ST 超链接继续支持；BEL 超链接及分段地址新增回归。停用插件恢复核心成员，已经发出的请求仍属于原 job，不重投、不自动取消；后续调用和重新启用独立验证。激活失败释放已装配覆盖。没有新的插件安装/卸载实现或配置迁移；测试包仅在临时目录，完成后释放并移除。

权限仍要求完整包批准、已保存 root 管理员连接和同一账号/浏览器 profile。取消、EOF、超时及原生退出仍清理本次进程，未知清理不自动重试。测试分别证明 Linux 合成 CLI/真实地址校验器的接线，以及真实插件生命周期到生产 dispatcher 的接线；它们不替代真实账号授权、VPS 出网或桌面前台验收。实现记录与验证范围见文档 16。
<!-- remote-login-osc8-20260930:end -->


<!-- claude-create-recovery-20260930:start -->
## Claude 原生配置删除后的创建恢复（2026-09-30）

本次先审公开调用、生产服务、持久恢复记录及释放路径，修复范围仅为创建操作的明确拒绝恢复。功能覆盖矩阵增量如下：

| 能力 | 调用、参数与返回值 | 注册、替换和真实消费方 | 测试位置 |
| --- | --- | --- | --- |
| 创建原生配置 | `api.call('native-accounts/create-claude',{id:string})` → `Promise<{accountId:string}>` | controller 的管理员/目录身份检查 → 已注册 `actions.native-accounts.createClaude(host:SshHost,catalog:AccountCatalog)` → NativeRuntimeControl → SSH broker | `tests/claude-create-recovery.test.ts`；`scripts/test-claude-create-recovery-ui.mjs` |
| 刷新与显式删除 | `accounts/list({id})` → AccountCatalog；`native-accounts/remove({id,accountId,confirm:true})` → `{removed:string}` | 实际 `accounts.catalog.list`、`actions.native-accounts.remove(host,catalog,accountId)`；保留管理员、root、账号代际、目录版本和会话互斥检查 | `tests/native-account-control.test.ts`；`scripts/test-remote-cli-lifecycle.py` |
| 注册命名工作流 | `api.registerCommand(name,handler)` → 释放函数，handler 可调用上述具名命令 | 批准 ZIP → PluginRegistry 激活 → 插件命令 → 生产 controller；非测试专用注册器 | `tests/claude-create-recovery.test.ts` |
| 包装或替换创建行为 | `api.services.intercept('actions.native-accounts','createClaude',handler)` / `override('actions.native-accounts',{createClaude?})` → 释放函数 | 同一生产服务实例，保留 `createClaude(host,catalog):Promise<{accountId:string}>`；停用或激活失败时释放；插件替换须维持未知结果防重复语义 | 同上；批准包、多插件及在途结果场景 |

```js
api.registerCommand('create-login', input =>
  api.call('native-accounts/create-claude', input));
api.onDispose(api.services.intercept('actions.native-accounts', 'createClaude',
  (next, host, catalog) => next(host, catalog)));
```

恢复记录仍为本机应用数据中的 `native-account-requests/<connection-hash>.json`，内容 `{requestId,expectedRevision}`，按连接身份、authority 和 generation 隔离；不是用户设置、账号凭据或插件配置。成功或结果未知仍保存原请求，后续明确操作复用；仅目录明确包含该请求账号，或 SSH 正常完成且 broker 明确返回 `ok:false,error:'STALE_SELECTION'` 时退役对应记录。broker 在锁内先查请求账号，再做版本比较，因此此拒绝证明未创建，不能仅凭本地列表缺失或新版目录推断。退役前回读比对原记录，检测到并发改写时保留新记录并报错；既有单连接进程内互斥覆盖整个恢复过程，不新增跨进程事务保证。

当明确拒绝的是较旧目录版本，同一次用户点击最多使用一个全新 UUID、当前目录版本再创建；绝不提高旧 UUID 的版本后重建，因为删除保留旧 profile。当前目录本身过期或再次冲突时停止并显示原有“账号目录已变化”提示，同时退役已明确失败记录，下次显式刷新/添加可重新开始。断线、非零 SSH 退出、无效 JSON、不一致成功回执、其他错误或仅有同文案的异常不触发轮换。损坏记录保留且拒绝发送，文件读写错误可见。

权限不变：完整 host 包批准只开放工作台接口，不增加远端权限。公共方法、参数、返回类型、apiVersion 1、具名 surface 和持久格式不变；新增的结构化拒绝是本机私有实现，不增加公开错误码。创建仍经现有 state 发布/目录回读，无新增事件。旧插件及旧恢复记录无须迁移；卸载/停用恢复核心成员，不回滚已发送操作，也不自动启动授权。测试覆盖正常在途完成、停用/重新启用、多插件、激活失败清理、重启和记录被并发修改；既有身份迟到拒绝继续由 native-account-control 回归验证。

UI 偏好盘点：没有新增/调整窗口、缩放、分栏、面板、标签、排序、折叠项、可调编辑器或默认值；全部稳定键、范围、存储/恢复/重置保持现状。按钮 busy/error 属于瞬时操作状态，不持久化；创建 journal 属于既有操作恢复而非可调 UI。没有新选项目录、资源、设置页、挂载点或 DOM 定位，注册新选项、多实例 UI 替换、显示器回退与 UI 数据迁移对此修复不适用。契约快照审查无签名变化，不需刷新。

测试包仅位于临时 QA profile，使用合成传输；不安装进实际用户环境，不读取真实登录资料。协议、插件生命周期、隐藏桌面与真实 VPS/账号授权证据分开，具体完成范围见文档 16。
<!-- claude-create-recovery-20260930:end -->

<!-- remote-account-card-login-dialog-20261001:start -->
## SSH official cards and login dialogs (2026-10-01 JST)

Interface review covers account catalogs, native status/quota, numeric receipts, browser lifecycle, shared card/quota/usage surfaces and disclosure preferences. No provider, runtime, theme or login-method directory is added. Existing remote browser profiles remain the real selectable directory.

| Capability | Public call and production consumer | Register, replace and release |
| --- | --- | --- |
| Shared cards | AccountCard, AccountQuotaWindows and ModelUsageSummary serve local and SSH accounts; accounts/usage retains its contract | model-account-card, model-account-quota and model-usage named surfaces use observeSurfaces for current/later instances; dispose restores core |
| Claude draft | native-accounts/prepare-claude({id:hostId}) -> Promise<SharedAccount>; native-accounts/discard-claude({id,accountId}) -> Promise<{discarded:true}> | actions.native-accounts.prepareClaude(host,catalog), draft(host,catalog,id) and discardClaude(host,catalog,id); approved intercept/override registrations reach controller and browser consumer |
| Native login | codex-auth/* and remote-browser/start/status/code/open/cancel keep IPC parameters | accounts.catalog and actions.remote-browser remain production services; RemoteBrowserService.start adds optional fifth draft:boolean argument, default false |
| Token usage and pricing | models/usage and models/pricing/save use {kind:'account',id:sharedAccountRef(catalog,account)} | models.accounts.call remains replaceable; numeric receipts capture full authority/catalog/provider/account generation reference |
| Dialog presentation | Existing model-account-login includes remote dialogs | Approved observeSurfaces registration supports multiple/later dialogs and disposal restoration |

Only root administrators with a ready native-owner catalog can prepare/discard. The controller binds drafts to host and catalog generations; renderer metadata cannot create a draft binding. Preparation does not publish a card or start login. Starting uses the selected remote browser profile and official CLI. Broker runtime/claude-prepare and runtime/claude-discard validate authority/request/account identity. Private registry pendingLogin metadata survives restart without entering public catalogs, and member authorization refuses it. Native profiles are preserved. Legacy runtime/claude-create stays compatible.

Successful browser login needs official authenticated status and confirmed CLI/browser cleanup before runtime/login-release publishes a pending account. Failed/cancelled/expired release discards pending metadata. Unknown cleanup stays unpublished and blocks conflicting activity; cleanup is not falsely reported as confirmed. Discard refuses active reservations and published accounts. Late unmounts cancel returned jobs; polling never starts another login/model turn. Old brokers reject additive methods without falling back to a public slot. Deployment is separate.

Errors retain admin, identity, busy, unavailable and cleanup-unconfirmed behavior; malformed draft receipts reject. State events publish verified catalog changes. Dialog jobs, browser-profile choice, code and reveal are transient. Existing disclosure.open account scopes and usage.period/usage.expanded full-reference scopes persist through the shared preference service. No changed default or migration of existing choices. Quota windows reuse the model-page component; missing Claude quota remains unknown. Tokens represent this workbench's observations, not an all-device provider bill. Cycle statistics remain unavailable without a proven reset cycle.

Example: an approved plugin calls api.call('native-accounts/prepare-claude',{id}), then remote-browser/start with its account ID and a selected profileKey. To replace preparation, register api.services.intercept('actions.native-accounts','prepareClaude',handler) and hold its release callback with api.onDispose. Replacements must preserve unpublished identity and cleanup semantics; no development example is installed in user profiles.

Tests: tests/remote-account-dialog.test.ts covers actual broker publication/cancellation/restart, controller, approved ZIP intercept/override/disable, and generation-bound usage. scripts/test-remote-account-dialog-ui.mjs covers real components in hidden Electron. Account-access, account-usage, native-control, browser-plugin and metrics suites are regressions. Snapshot review adds the two IPC commands only; concurrent declarations are excluded from this change's evidence.
<!-- remote-account-card-login-dialog-20261001:end -->

<!-- follow-up-handling-20260930:start -->
## 跟进方式、持久队列与用户输入时间顺序（2026-09-30；U119）

接口前置审查范围：`draft/prepare/refine/submit/cancel`、`session/stop`、原生与插件运行时的 steer/submit、工作台 state 通知；新增模式目录、两个队列命令、设备偏好及五个具名 surface。普通 Enter 采用所选方式，Ctrl+Enter 对当前草稿取反，Shift+Enter 换行，IME/重复按键不提交。旧行为的默认值保持 `steer`，不会采集开发者当前设置。

| 功能覆盖 | 调用与类型 | 注册、替换及生产消费 | 行为验证 |
| --- | --- | --- | --- |
| 准备并确认跟进 | `draft/prepare({sessionId,text,followUpMode?:string,invertFollowUp?:boolean,...existingOptions}) → Promise<DraftPreview>`；返回可选 `followUp:{modeId,action:'queue'|'steer',expectedTurnId}` | controller 用注册目录解析并冻结动作；refine 保留意图，submit 读取宿主冻结值而非信任客户端回传；省略 mode 保持旧 API 的 steer 默认，标准编辑器显式传设备偏好 | `tests/native-bridge-controller.test.ts`、`scripts/test-follow-ups-ui.mjs` |
| 查看、发送或移除队列 | `state/get → AppState` 的 `Session.followUps?:FollowUpEntry[]`；`follow-up/send({sessionId,id}) → Promise<void>`；`follow-up/cancel({sessionId,id}) → Promise<void>` | controller 调用实际注册的 `sessions.follow-ups`；发送空闲会话或向运行会话引导，保留身份和能力检查；取消仅限 queued/paused | `tests/follow-ups.test.ts` |
| 注册新方式 | `api.services.get('sessions.follow-up-modes') as FollowUpModesApi`；`list()`、`resolve(id,canSteer,invert?)`、`register(mode)`、`replace(id,mode)`、`subscribe(listener)` | `FollowUpMode={id,label,description,action}`；id 为 `plugin:<owner>/<name>`。register/replace 返回 `{id,dispose()}`；选择器和宿主共同消费这一实例，state 中 `followUpModes` 随注册/释放更新 | 批准 ZIP → 生产 controller → 选择器/实际队列，替换层、失败清理、禁用/重启恢复 |
| 包装、替换队列行为 | `api.services.intercept('sessions.follow-ups','enqueue',handler)`、`override('sessions.follow-ups',{enqueue?,send?,cancel?,pause?})` | 保持 `FollowUpsApi` 签名，操作生产队列实例，返回释放函数；新选项映射基础 queue/steer 动作，扩展执行器通过已有 `api.runtimes.register` 的 run/steer/stop 接入 | `tests/follow-ups.test.ts`、`tests/runtime-extensions.test.ts` |
| 设置读取、修改与替换 | `api.uiPreferences.get/set/reset('composer.follow-up',...)`；host `ui-preferences/get/update` | 共用版本化偏好 store 与 renderer API；`api.uiPreferences.override` 可替换有效值，catalog 的 register/replace 扩充真实选项；核心缺省值不按运行时临时改写 | `tests/follow-ups.test.ts`、`tests/ui-preferences.test.ts`、隐藏桌面完整重启 |
| 局部界面 | `api.observeSurfaces('follow-up-settings'|'follow-up-queue'|'follow-up-menu'|'follow-up-detail'|'user-message',placement,render)` → 释放函数，支持 before/after/replace | General 文字标签选择、composer 上沿单行队列及按需菜单/详情、时间线各用户消息的多实例消费；user-message 保留 `data-message-id`，queue 带 `data-session-id` | `scripts/test-follow-ups-ui.mjs`；共用异步挂载/替换释放路径由插件生命周期回归覆盖 |

公开类型位于 `packages/session-core/follow-ups.ts`。`FollowUpsApi.enqueue(sessionId,preview,expectedTurnId)` 返回 `{queued:true,id}`，只在指定原生回合仍为运行/刚结束时接受，最多 100 条；标准扩展应经 draft 准备与确认保留翻译/审批边界。`send(sessionId,id,manual=true)`、`cancel(sessionId,id)`、`pause(sessionId,reason?)` 返回 Promise<void>；`status(sessionId)` 返回瞬时 `{error?:string}`，`subscribe` 返回解除监听函数。`observe`/dispose 和内部调度钩子不是插件启动自动任务的授权入口。插件必须保留明确用户输入、成功完成触发、停止和未知回执隔离。

`FollowUpEntry={id,preview,binding,afterTurnId,createdAt,status,error?}`，status 为 queued/paused/sending/uncertain。原稿、实际发送文本、附件和技能引用随 preview 保存；绑定快照包括运行时/模型/权限/项目，不因排队期间改选而静默变更。实际派发再次核验技能版本、附件、工作树及停止代际。成功才移除队列项，未知结果不重投；停止/失败暂停剩余消息，进程重启 queued→paused、sending→uncertain。未知回执项不能借再次点击退回可发送状态。存储失败令自动调度暂停，通过 `Session.followUpError` 和订阅通知显示瞬时错误，原持久记录保留；该投影不作为新的用户偏好保存。暂停队列写入失败不会阻挡 session/stop 继续停止原生或扩展运行时。队列恢复只读取本应用 state，不扫描原生私有聊天库。

事件沿用 state 广播；目录和服务 subscribe 驱动同一广播，UI 偏好沿用 `workbench.ui-preferences/changed`。错误包括 `FOLLOW_UP_BUSY`、`FOLLOW_UP_TURN_CHANGED`、`FOLLOW_UP_BINDING_CHANGED`、`FOLLOW_UP_STOPPED`、`FOLLOW_UP_UNAVAILABLE`、`FOLLOW_UP_ALREADY_DISPATCHED`、`FOLLOW_UP_STEER_UNAVAILABLE`、`FOLLOW_UP_QUEUE_FULL_OR_DUPLICATE`、`FOLLOW_UP_STORAGE_INVALID`，模式校验使用 `FOLLOW_UP_MODE_INVALID/CONFLICT/MISSING`。底层准备、原生回执、文件和偏好冲突错误仍保留既有边界；catch 不自动变成另一次模型请求。

```js
export function activate(api) {
  const modes = api.services.get('sessions.follow-up-modes');
  const handle = modes.register({
    id: 'plugin:example.followup/later', label: '稍后处理',
    description: '等待成功完成再发送', action: 'queue'
  });
  api.onDispose(() => handle.dispose());
  api.onDispose(api.services.intercept('sessions.follow-ups', 'enqueue',
    (next, sessionId, preview, turnId) => next(sessionId, preview, turnId)));
  api.registerCommand('send-queued', input => api.call('follow-up/send', input));
}
```

权限与生命周期：host 代码仍须完整包批准；目录注册不增加账号、设备或系统权限。禁用/缺失模式保留用户选择 ID，界面说明暂用引导，底层不支持引导时再回退排队；重新启用恢复。已确认预览保持冻结动作，不因插件释放改变为另一种发送方式。队列保存的是明确用户请求，停用模式插件不删除它们、不复制插件配置到代码 ZIP。插件激活失败释放注册；多层 replace 按层释放，晚到消费者读实时目录。已有通用插件包移除路径等价释放上述句柄，本次没有新增卸载命令；临时 QA 包不安装进用户环境。

UI 持久盘点见文档 37。没有新增窗口大小、分栏、拖拽、折叠控件或外部资源；队列每条约 30px、最多约三条高度并自动滚动，原稿单行省略；菜单与全文详情按需打开，busy/回执提示是运行状态。引导进入原有正常用户消息时间线，不创建排队卡片。设置采用现有文学风格文字标签，不使用原生下拉框或额外说明卡片；方向键/Home/End 与指针选择消费同一目录。消息修复为按原始顺序分段渲染，旧 users/process/answers 字段保留，`ReadingTurn.ordered?` 为兼容性增量；旧输出缺少 ordered 时仍能渲染。旧 turn-process surface 不再保证每回合只有一个实例，首段仍用原 turn ID，后续段增加首记录 ID 后缀，原 disclosure 偏好保留。扩展需通过多实例 observeSurfaces 或新 user-message surface 定位，不依赖“全部用户消息在回合顶部”。原文、原生 ID、字段和历史不会因显示调整被改写。

apiVersion 1、state.version 1 和 ui-preferences schemaVersion 1 保持；缺少新字段的旧文件按空队列和旧默认恢复，损坏/未知队列格式拒绝覆盖。公开类型、两个命令、五个 surface 与 ReadingTurn 增量已纳入审阅后的契约快照。真实 Codex turn/steer、本机 Claude stream-json、合成运行时及隐藏桌面属于不同证据层；不将本机接入承诺为所有 SSH 适配器支持引导，也不将测试当作真实模型、前台客户端或发布包验收。
<!-- follow-up-handling-20260930:end -->


<!-- native-explicit-completion-20260930:start -->
## 跨协议显式结束契约（2026-09-30；替代仅提示的结束约定）

接口先审范围：runtime.native-provider.openGateway、新增 runtime.native-completion.prepare、NativeGatewayOptions.completion/completionReceipt、NativeCompletionCodec/Boundary/Receipt、跨协议历史与 Responses phase、Session.nativeProviderReceipts、nativeError、TurnTiming.error、state/get/onState。没有新增模型目录、运行时选项、权限、工具执行器或界面控件。UI 偏好清单没有新可调节点；既有窗口、阅读器、折叠偏好及默认值不变。回执是运行事实，不是用户偏好，无新偏好的首次安装、显示器回退或重启迁移。

| 功能覆盖 | 调用现有能力 | 注册新的实现 | 替换及生产消费 |
|---|---|---|---|
| 显式结束 codec | api.services.get('runtime.native-completion').prepare(request,protocol) 返回 NativeCompletionBoundary 或 undefined | 批准 host 插件通过 services.intercept 注册 prepare 处理器并取得释放句柄；不是新增选择器目录 | services.override 替换 prepare，或 openGateway 参数指定 completion；controller 登记的同一对象被实际网关逐请求消费 |
| 请求、流及收尾 | boundary.request、push(delta)、finish(turn)、可选 dispose() | codec 返回自有请求级边界对象 | 网关实际消费以上入口，完成/失败/取消均释放；原生 CLI 执行全部真实工具，不替换整个运行时 |
| 安全回执 | completionReceipt(value:NativeCompletionReceipt):void；state/get/onState 读取 nativeProviderReceipts | openGateway 拦截器包装回调；新运行时仍经 RuntimeAdapter 注册 | 最多 32 条固定 protocol/finishReason、工具数、文本长度、boundary、受限 outcome、时间和宿主回合标识；不保存正文、参数、隐藏思考、上游 ID 或密钥 |

跨协议且允许工具选择时追加非执行性的 awb_complete_turn 完成封套，名称冲突使用独立后缀。模型返回真实工具调用，或 outcome:'completed'|'needs_input'|'blocked' 与非空 message；封套不作为工具发送给 CLI。Chat/Responses 使用 required，Messages 使用 any；存在 thinking 时保留 auto 并继续校验明确结束。原生强制工具、tool_choice none、无工具、同协议直连保留原控制；官方账号不增加此封套。

缺少封套、混用完成与动作、非法字段/枚举/空消息分别为 NATIVE_COMPLETION_REQUIRED/MIXED/INVALID，进入已有失败回执，纯进度不再包装为成功。上游不支持选择参数时明确失败，不静默降级或改协议；不推测自然语言意图、不捏造工具。原生有限重试保持原样，网关没有额外模型回合或自动 Continue。outcome 仅为模型声明，不是任务真实完成证明。

最终 message 增量显示，但收齐并验证回执前不发送可执行完成项。真实工具配文设为 commentary，最终封套设为 final_answer；下一次 Chat 历史把相邻进度和调用合入同一 assistant 批次，保留 ID 与结果，不改用户文本及工具定义。

批准包示例：api.services.intercept('runtime.native-completion','prepare',(next,request,protocol)=>{const b=next(request,protocol);return b?{...b,dispose(){b.dispose?.();}}:b;}); 实际生产注册来自 controller.developmentServices，不是仅供测试的对象。服务句柄按插件作用域释放；停用影响后续请求，已经准备的请求保留其边界到收尾，避免流中途换规则。重新启用影响后续请求；多插件及激活失败清理由现有批准生命周期负责。

completion 为可选细粒度编解码替换入口，旧 openGateway 插件不必增加参数；apiVersion 1、旧配置及 surface 不变。新增状态字段可缺省，旧会话不补造回执；公开 codec/网关类型及新服务与快照一起审阅。无新 DOM 定位、资源或目录选择回退。

测试位置：tests/native-completion.test.ts、tests/native-completion-plugin.test.ts、既有 provider/stream/termination；scripts/test-native-termination.mjs 贯通实际 CLI、真实批准 ZIP、工具往返、错误、显式结束和停用/重启用/包移除；插件单测覆盖实际 controller 注册、多插件、激活失败与在途停用；scripts/test-native-stream-tools.mjs 验证回执前零工具执行及封套增量译码。插件仅装进隔离 profile，不据合成上游宣称真实模型质量或官方兼容保证。
<!-- native-explicit-completion-20260930:end -->


## 2026-09-30 translation redesign: interface and preference audit

This change retains the module master and temporary pause, retires independent input/final switches, and uses one selected translation source. The implementation and acceptance evidence below belong only to this change.

| Affected capability | Call | Register | Replace and release |
| --- | --- | --- | --- |
| Translation source catalog and execution | `translation/targets`; `translation.translate/refine/segments` | `translation.targets.register(owner, provider)` returns a disposer; stable `plugin:<owner>/...` IDs reach the same selector and executor | Intercept/override `translation.targets`, `translation.workbench-targets`, or `runtime.translation-native`; unregister aborts owned work and rejects late results |
| Saved model source, limits, and input semantics | `translation/settings` with `TranslationProfile.source` and revision; module/quick-toggle commands remain | Source providers contribute actual models; protocol values are existing wire formats, not a new provider list | Existing translation service replacement; saved missing source is retained and reported unavailable, never silently switched |
| Translation-only usage and prices | `models/usage` and `models/pricing/save` with `{kind:'translation',id:'translation'}`; legacy `translation/usage` remains | Translation execution returns normalized counters; registered backends enter the same receipt ledger | Existing `models.accounts.call` interception and named translation usage surface; no session/account usage mutation |
| Reading placement and intermediate messages | Existing `translation/layout`, `translation/intermediate` | Existing named UI surface registrations | `translation-settings`, `translation-source`, `translation-model`, `translation-custom`, `translation-intermediate`, `translation-usage`; mounting and cleanup use the shared multi-instance renderer lifecycle |

Persisted owners: `AppState.translation.source` keeps source/tab, target and effort; `translation.revision` prevents stale saves; existing profile fields own limits/custom API configuration; `translationLayout` and `translateIntermediate` retain their existing owners. Shared `usage.period`, `usage.expanded`, and price-editor disclosure preferences use a separate translation scope. Unsaved credentials, form drafts, loading/error state and live catalog responses are transient. See document 37 for restoration/reset behavior. No new theme/runtime/language catalog is introduced.

Fresh profiles use `0` for character/call/wait limits. Existing numeric limits remain user preferences. Character limits count Unicode code points in source text before any request; they do not truncate main-model output. Input and final translation now follow the master/pause state; legacy flags remain readable but are normalized true. `translateIntermediate` stays independent and appears in the composer footer for both reading layouts (placement revised 2026-09-30).


### Contract, migration and failure behavior

- `translation/targets()` returns `TranslationTarget[]` (`id`, `name`, `description`, `model`, `runtime`, `ready`, optional `reason`, `efforts`, optional `defaultEffort`). It is discovery only; no translation/model probe is sent. Built-in API targets are enabled mappings; official account targets use the account-owned local native runtime. SSH account targets are not added by this change because that would introduce remote execution and a separate permission boundary. Registered providers may implement additional targets explicitly.
- `translation.targets.register(owner: string, provider: TranslationTargetProvider): () => void` requires `list()` and `resolve(targetId, profile, effort?)`. Resolution returns `TranslationBackend` with effective profile, stable source ID, runtime, and either API auth (`key` or explicitly `auth:'none'`) or `execute({instructions,input,profile,signal})`. Execution returns translated protected text and `TokenCounts`, optionally reported model and reasoning tokens. Numeric unknowns are `null`; they must not be invented as zero. `TranslationExecutionError` carries already-observed numeric usage on native failure. Plugins must attach the returned disposer with `api.onDispose`; registration does not grant account, network or execution authority beyond the approved host package.
- Errors include `TRANSLATION_PROVIDER_INVALID`, `TRANSLATION_CATALOG_INVALID`, `TRANSLATION_TARGET_UNAVAILABLE`, `TRANSLATION_EFFORT_UNAVAILABLE`, `TRANSLATION_NATIVE_FAILED`, `TRANSLATION_NATIVE_RESULT_UNKNOWN`, `TRANSLATION_NATIVE_TOOL_REJECTED`, `TRANSLATION_CANCELLED`, `TRANSLATION_USAGE_INVALID` and `TRANSLATION_USAGE_STATE_INVALID`. Missing/disabled providers retain the stable saved choice and fail explicitly. There is no automatic provider/model substitution or task replay. Provider disposal aborts queued/in-flight owned work; policy changes reject late delivery. Existing account/API maintenance and removal are blocked while translation holds that source.
- `TranslationProfile.source` is `{kind:'model',targetId,effort?}` or `{kind:'custom',targetId?,effort?}`. The custom variant may retain the previous managed choice for later switching; it never executes that target. Custom API fields remain saved independently. `revision` is returned with settings; after the first revisioned save, writers must return it or receive `TRANSLATION_SETTINGS_CHANGED`. Legacy clients must reread `state/get` and include the returned profile instead of manufacturing a profile. No unconditional stale-write compatibility fallback is provided. Passing a key while selecting a managed model raises `TRANSLATION_MODEL_SOURCE_KEY_FORBIDDEN`. Saving/discovery never starts a paid probe.
- Official-account translation uses `runtime.translation-native.run(launch,request)` and its `busy()/dispose()` lifecycle through `translation.workbench-targets`. It starts one owned ephemeral Codex thread or nonpersistent Claude print process in a temporary directory, uses the account service's native environment, disables tool/skill/hook/memory capabilities, and never reads/transmits native credential contents into direct translation HTTP. Startup RPC admission has its own bounded 30-second acknowledgement deadline; `timeoutMs:0` removes the model-completion wait timer. No outer retries or tools are allowed. Native context overhead remains runtime-owned; the source is not advertised as equivalent in cost to direct API translation.
- `models/usage({scope:{kind:'translation',id:'translation'},period:'1day'|'7day'|'month'})` uses the same aggregation and renderer component as account/API usage, backed exclusively by `AppState.translationUsage`. `cycle` is invalid for this scope. Input includes reported cache tokens; totals never add them again. Unknown/partial receipts stay visibly incomplete. `models/pricing/save` supports this independent scope with its existing price revision check. These prices do not modify account/API prices. Existing `translation/usage()` retains `calls` and `cost` and adds `snapshot`, `pendingReceipts`, and optional `persistenceError`. Failed receipt writes stay in memory for a later receipt-only save attempt and are shown in settings; a successful translation is not discarded or retried because statistics failed. Unpersisted receipts can be lost on process exit. Historical translations without receipts are not backfilled or assigned guessed costs.
- Usage has version 1 and validates numeric receipt/record correspondence on load. The existing state file's atomic serialized writer owns updates; unknown/corrupt usage fails closed without overwriting the original file. Records contain identifiers, model, timestamps, status and counters, never source text, response text or credentials. This change imposes no silent usage-history retention cutoff.
- Public state updates use the existing `state` event; extension catalog changes use the existing extension lifecycle notification. No new event name is introduced. The former intermediate checkbox location inside the translation-pane header is retired; use the named `translation-intermediate` surface in the composer footer (placement revised 2026-09-30). Source/model/custom/usage surfaces are new additive names. The shared account usage DOM and source scopes remain compatible.

Example approved host plugin (synthetic backend; attach cleanup):

```js
export function activate(api) {
  const targets = api.services.get('translation.targets');
  api.onDispose(targets.register(api.id, {
    list: () => [{id:`plugin:${api.id}/model`, name:'Example', description:'Example backend', model:'example', runtime:'api', ready:true, efforts:[]}],
    resolve: async (id, profile) => ({sourceId:id, runtime:'api', profile:{...profile, model:'example', consent:true}, execute:async request => {
      request.signal.throwIfAborted();
      return {text:request.input, counts:{inputTokens:null,outputTokens:null,cacheReadTokens:null,cacheWriteTokens:null,totalTokens:null}};
    }})
  }));
}
```

Acceptance locations: `tests/translation-redesign.test.ts`, `tests/translation-native.test.ts`, `scripts/test-translation-native.mjs`, `scripts/test-translation-redesign-ui.mjs`, and existing translation module/provider/quick-toggle tests. The approved ZIP fixture reaches the production controller registry, selector, executor and usage store; disable interrupts work, reenable restores the saved selection, and service overrides release. Registry tests cover duplicate IDs, invalid namespaces, coexistence and late resolution. Existing shared surface/preference lifecycle tests retain their multi-instance and failed-registration coverage. Contract snapshots add the new declared translation types and reviewed profile/usage signatures; this is an additive catalog/usage change plus the explicit legacy-input-toggle and revision semantics described above. Actual execution/visual results and boundaries are recorded in document 16.


Final semantic review: managed-source saves retain the last saved custom endpoint/model/credentials instead of validating or applying inactive custom drafts. `TranslationResult.providerName?` supplies a readable source label while `providerId` remains the stable identity. `translation.dispose()` now returns a promise and waits for admitted receipt writes after cancellation; host shutdown awaits it and outstanding message-translation deliveries. Legacy callers may ignore the return value, but lifecycle owners should await it before removing storage.


<!-- model-cost-lower-bound-20260930:start -->
## 部分用量的费用下界与缓存写入（2026-09-30 JST；U115）

先行接口审查覆盖 models/usage、models/pricing/save、models.accounts.call、AppState.modelUsage/modelPrices/translationUsage、state 事件、modelUsageRevision、ModelUsageSummary/ModelUsageGroup、parseTokenCounts 和 runtime.native-provider.openGateway 的 usage 回调，以及既有 model-usage / translation-usage surface。界面保留原类名、挂载点和偏好 key；没有新增选项目录、模型别名、运行时、资源、权限或网络查询。

| 功能覆盖 | 调用现有能力 | 注册、替换与生产消费 | 验证位置 |
| --- | --- | --- | --- |
| API、账号、翻译的已知费用下界 | models/usage({scope,period}) 返回 ModelUsageSummary；groups 含 ModelUsageGroup | 已批准插件通过 services.intercept('models.accounts','call',handler) 注册估算包装，或 override 同一服务成员；真实 controller 和 ModelUsageSummary 消费同一结果，释放恢复核心 | tests/model-cost-estimation.test.ts；scripts/test-model-cost-ui.mjs |
| 自定义单价 | models/pricing/save({scope,model,revision?,price}) 返回 SavedModelPrice | 插件调用同一持久化价格入口；拦截上述生产服务可接入自有定价策略。未增加价格来源选择器，故不建立无实际消费者的新注册目录 | 同上，含批准 ZIP 调用、价格冲突和重启 |
| 缓存写入回执及协议转换 | 既有 NativeGatewayOptions.usage、parseTokenCounts(value,protocol) → TokenCounts | 原生网关使用同一解析器；既有 runtime.native-provider.openGateway 可被批准插件包装/替换，注册运行时仍通过 usage 事件提交正规 TokenCounts | tests/model-cost-estimation.test.ts；tests/session-metrics.test.ts；tests/native-streaming.test.ts |
| 费用界面与偏好 | 既有 model-usage / translation-usage 具名 surface、usage.period / usage.expanded / disclosure.open | observeSurfaces 支持局部注册/替换及释放；已挂载/后来实例从同一宿主查询读取。无旧定位迁移 | scripts/test-model-cost-ui.mjs；既有 surface 与 UI preference 生命周期测试 |

API v1 增量：ModelUsageSummary 和 ModelUsageGroup 各增加可选 lowerBoundUsd?: number | null，单位 USD。非 null 表示已知用量按当前适用价格计算的保守下界，包含同一模型内可计价的残缺回执；不是完整账单。没有任何带价格的计费字段时返回 null；无记录的配置模型不会为缺价模型生成虚假的零美元下界。estimatedUsd 保持原有严格完整估算/null 语义，pricedUsd 保持完整模型组的小计语义，unpricedModels 仍表示不能完整估算的模型数；旧插件无需修改即可继续读取这些字段。新的 renderer 优先 estimatedUsd，其次显示“至少 lowerBoundUsd”，最后显示未知；旧插件未返回新增字段仍安全回退。

计算按回执进行，不把不同请求的输入、缓存和输出拼成完整记录。已知缓存部分用其单价；剩余输入在普通输入及尚未上报的缓存类别之间取最低适用单价，缺失输出只贡献未知的非负部分。原计数、incomplete 和 partialHistory 不被改写，零单价与实报零计数保留。完全缺价的模型仍需用户设置。金额仅针对收到的回执；缺失历史、长上下文/其他服务档、工具费、税费、订阅费不由此补算。

解析新增 input_tokens_details.cache_write_tokens（Responses）及兼容实现的 prompt_tokens_details.cache_write_tokens（Chat Completions）；保留 Anthropic cache_creation_input_tokens。不存在的字段仍为 null。Responses 的非流式和流式协议转换均保留已知缓存读/写字段，包括写入零值与只报写入的回执；不增加 HTTP 请求，不重放旧任务。

权限和错误沿用完整代码包批准、MODEL_USAGE_QUERY_INVALID、MODEL_PRICE_INVALID、MODEL_PRICE_CHANGED、MODEL_SOURCE_NOT_FOUND 和既有插件失效错误；没有新权限。持久单价更改沿 state 事件和 modelUsageRevision 刷新，新增下界仅为派生查询结果，不写入账本。服务包装返回释放函数，由批准插件生命周期清理；停用/移除恢复核心估算但不回滚用户价格，重新启用恢复包装。异步 UI 查询仍按 scope/period/refreshKey 失效屏障丢弃旧结果。多插件透传共存与激活失败清理使用实际批准 ZIP 验证，不把内部函数导出作为唯一接口证明。

```js
export function activate(api) {
  api.registerCommand('cost', p => api.call('models/usage', p));
  api.onDispose(api.services.intercept('models.accounts', 'call', async (next, method, params) => {
    const result = await next(method, params);
    if (method === 'models/usage') {
      // Consumers distinguish complete estimates from conservative known-usage bounds.
      const amount = result.estimatedUsd ?? result.lowerBoundUsd ?? null;
    }
    return result;
  }));
}
```

兼容审查：只更新这两个可选返回字段的契约快照，无旧入口、具名 surface、存储版本或默认偏好变化。测试覆盖真实批准/启用、未批准拒绝、调用、多个包装共存、激活失败释放、停用、重新启用、移除和已保存价格恢复。UI 覆盖浅/深色、窄窗口、已有/后来实例、完整进程退出重启及残缺回执补齐。目录缺包选择/新目录注册失败不适用，因为本轮未添加目录；沿用并验证共享偏好的损坏文件、并发修订、响应式回退、扩展停用和恢复规则。具体结果及证据边界见文档 16，偏好清单见文档 37。
<!-- model-cost-lower-bound-20260930:end -->

<!-- browser-first-navigation-20260930:start -->
## 远端浏览器首个页面与登录就绪状态（2026-09-30；U105）

接口前置审查覆盖 `remote-browser/launch`、`remote-browser/start/status/open/cancel/code`、`actions.remote-browser` 生产注册实例、所选 profile、登录状态及随请求组包的 Python 资源。普通启动过去显式传入 `about:blank`；现在传入 `chrome://newtab/`。临时登录先保留 manager 锁，收到经过既有白名单校验的原生授权 URL 后，直接以该 URL 启动第一个页面，不再预建空白标签页。

| 功能覆盖增量 | 调用、注册或替换入口 | 实际消费与行为验证 |
| --- | --- | --- |
| 普通用户启动 | `api.call('remote-browser/launch',{id,profileKey})` → `Promise<BrowserControlResult>` | controller → `actions.remote-browser.control(host,'launch',{profileKey})` → `RemoteBrowserService` → 随 SSH 请求组包的 manager；`tests/remote-browser-login-plugin.test.ts`、`scripts/test-browser-control.py` |
| 原生授权首个页面 | `remote-browser/start({id,accountId,profileKey})` → `BrowserLogin`；`status({id,jobId})` → `BrowserLogin`；`open({id,jobId})` → void | `actions.remote-browser.start/status/openViewer` → 原生 CLI/manager → 现有 `RemoteBrowserManager` 状态与按钮；`scripts/test-browser-first-navigation.py`、`scripts/test-remote-browser-login.py`、`scripts/test-remote-management-ui.mjs` |
| 注册工作流 | 批准包内 `api.registerCommand(name,handler)`，handler 调用上述具名入口 | 真实 ZIP 批准/激活 → command → 生产 controller/service；测试在 SSH runner 与操作系统打开 viewer 的边界注入合成结果，不连接真实主机 |
| 细粒度包装/替换 | `api.services.intercept('actions.remote-browser','control'或'start',handler)`；`api.services.override('actions.remote-browser',{control?,start?,status?,openViewer?,code?,cancel?})` | 每个成员保持既有类型；返回释放句柄，批准包生命周期清理。测试覆盖多插件共存、在途结果、激活失败、停用恢复、重新启用及随后调用 |

`BrowserControlResult` 仍为 `{running:boolean,viewerReady:boolean,profilesPreserved:true,profileKey?:string}`。`BrowserLogin` 仍为 `{jobId,accountId,state,viewerReady,codeRequested,cleanup,error?}`，状态及清理枚举不变。`preparing` 现在保持 `viewerReady:false`；manager 的内部 `ready` 只表示已占有锁并确认所选资料，`opened` 才表示浏览器以目标 URL 通过现有进程/显示服务检查。随后宿主建立 viewer 通道，公开 `viewerReady` 才可为 true；不代表网页网络加载完成或授权成功。成功仍须原生账号状态回读。现有 status 轮询和登录流逐行状态回执继续使用，没有新增事件。

权限仍为批准的 host 能力、root 管理员连接及绑定账号/profile；授权地址不传 renderer、不持久化。`BROWSER_BUSY`、`BROWSER_START_FAILED`、`BROWSER_CLOSED`、`LOGIN_DISCONNECTED`、`NATIVE_AUTH_UNCONFIRMED` 及未就绪 open 拒绝沿用既有错误路径；重复 URL 不再开新标签页，改变的合法原生 URL 只在同一活跃浏览器内打开。等待 URL 期间 EOF、取消和超时不启动浏览器；启动失败、断线和结束登录仍仅清理本次所有的进程，保留用户资料。普通浏览器的断线保留、显式关闭和恢复连接语义不变。

示例（仅在已批准的 host 插件中）：

```js
api.registerCommand('launch-profile', input => api.call('remote-browser/launch', input));
const release = api.services.intercept('actions.remote-browser', 'control',
  (next, host, action, options) => next(host, action, options));
api.onDispose(release);
// Login viewers must inspect remote-browser/status and honor viewerReady.
```

兼容/迁移：apiVersion、公开声明、具名 surface 和持久格式不变，审查后不刷新契约快照。旧插件继续按 `viewerReady` 决定可否打开；依赖 `preparing` 时提前打开的实现应改为等待 true。替换服务须保留管理员、锁、就绪与所属进程清理约束。无新增主题/提供方/选项目录或 UI 控件，故不新增选择器注册或挂载点；本次不是把可扩充选项藏入核心枚举。现有浏览器用户列表与运行路径仍读取同一 profile 目录。两个 Python 资源每次组包读取，须同时更新；已有进行中的进程保持原版本，后续新请求使用新资源。

偏好审查见文档 37：新标签页是启动默认值修正，不迁移/改写用户 Chrome 配置。`scripts/test-browser-first-tab.mjs` 使用真实本机 Chrome、临时资料与合成回环页面比较旧首个空白页、新普通首个页面和直接目标首个页面；仅为 headless 本机证据，不替代 Linux 二次命令投递、VNC 前台或真实授权验收。批准插件、Linux 合成协议及隐藏 UI 的分层结果见文档 16。
<!-- browser-first-navigation-20260930:end -->

<!-- browser-auth-url-20260930:start -->
## 远端 Claude 授权入口与准备超时（2026-09-30；U105）

前置接口审查覆盖 `remote-browser/start/status/open/code/cancel`、生产 `actions.remote-browser` 服务、`BrowserLogin` 状态、选定的远端账号/profile、SSH 组包资源及现有登录弹窗。CLI 和 Chrome 均在远端执行；本机只接收状态与 noVNC 画面。原生授权 URL 留在远端进程之间，授权码经既有临时输入交回远端 CLI，不保存到本机 CLI 配置。

| 功能覆盖增量 | 调用、注册、替换 | 生产消费与验证 |
| --- | --- | --- |
| 当前订阅授权入口 | `api.call('remote-browser/start',{id,accountId,profileKey})` → `Promise<BrowserLogin>`；`status({id,jobId})` → `BrowserLogin` | controller → `actions.remote-browser.start/status` → `RemoteBrowserService` 的 SSH 组包/状态解析 → Python URL 提取与 manager 首页校验 |
| 有界准备与失败状态 | 现有 `open/code/cancel` 命令和 `BrowserLogin.error`；无新增事件 | 等待可识别 URL 最多 60 秒；首次 open 到 manager `opened` 最多 70 秒；浏览器就绪后保留原 900 秒登录总期限。失败进入既有清理和占用释放路径，不自动重试 |
| 插件工作流注册 | 批准包内 `api.registerCommand(name,handler)` 调用上述入口，注册随停用清理 | `tests/remote-browser-login-plugin.test.ts` 实际 ZIP 导入/批准/激活 → 生产 controller/service → 合成 SSH 子进程边界 → 生产状态/错误消费；不启动真实 SSH 或授权 |
| 细粒度替换 | `api.services.intercept('actions.remote-browser','start',handler)`；`api.services.override('actions.remote-browser',{start?,status?,openViewer?,code?,cancel?})` | 沿用具名类型和释放句柄；既有批准生命周期测试覆盖多插件、在途结果、失败回收、停用恢复和重新启用。调用示例：`api.registerCommand('login', p => api.call('remote-browser/start', p));` |

新增内部错误 `NATIVE_AUTH_URL_TIMEOUT`（未收到完整地址）和 `NATIVE_AUTH_URL_UNRECOGNIZED`（收到地址但没有受支持的授权入口），由宿主映射为中文 `BrowserLogin.error`；`BROWSER_START_TIMEOUT` 沿用。URL 截断、OSC 8/BEL/ST、重复地址和首个页面语义保留。新增仅为 HTTPS `claude.com` 与 `/cai/oauth/authorize` 的确切组合；旧 `claude.ai`、`console.anthropic.com`、`platform.claude.com` 与 `/oauth/authorize` 保留。不放宽用户名、密码、非标准端口、控制字符或相似域名；并非任意域名/路径的交叉组合。

原生入口不是提供方目录或用户可注册选项，属于官方 CLI 输出校验边界；因此不新增 URL 白名单注册接口。第三方通过上述具名服务成员替换授权工作流，仍须遵守原管理员、账号/profile 绑定、锁、就绪与所属进程清理约束。没有新增 UI 挂载点、选择器或用户配置。权限仍为已批准 host 能力及管理员连接。

兼容审查：API 声明、apiVersion、状态枚举、具名 surface、持久格式均未变，不刷新契约快照。旧插件继续使用 `viewerReady`，并须把新的失败状态视为终态；准备阶段不再等待完整 15 分钟。60/70 秒为产品内部阶段期限，不是新增用户偏好；临时资源迟到不能令失败任务复活。两份 Python 资源每次请求重新组包，已有进程不热换；新增中文映射在宿主下次加载代码时生效。现有 `BROWSER=/bin/true` 与原生手动授权码路径保留，没有改成启动本机 CLI 或本机 OAuth。

测试位置：`scripts/test-remote-browser-login.py`（隔离 CLI/浏览器、真实生产提取/校验、临时环境/工作目录、手动码/合成回调、期限、取消/断线/清理）、`scripts/test-browser-first-navigation.py`（精确端点、旧入口和控制字符）、`tests/remote-browser-login-plugin.test.ts`（生产组包、错误本地化、批准插件生命周期）、`scripts/test-remote-management-ui.mjs`（既有 UI 的准备失败/重试/码框清理）。原生静态观察和真实登录的证据边界见文档 07、16；偏好审查见文档 37。
<!-- browser-auth-url-20260930:end -->

<!-- claude-ssh-catalog-20260930:start -->
## Remote Claude model catalog and execution boundary (2026-09-30)

Coverage matrix addition:

| Capability | Call | Register | Replace | Production consumer and lifecycle |
| --- | --- | --- | --- | --- |
| SSH Claude native catalog | `runtime/models({runtime:'claude',hostId,refresh?})`; `model-targets/list({refresh?})` | New runtimes/models continue through `api.runtimes.register(definition,adapter)`, with a cleanup handle and stable plugin ID | `api.services.intercept/override('models.targets','list',...)`; account-specific reads through `actions.native-accounts.models` | The controller, model menu, selection/session consumers, chat tools and memory default resolver share the production catalog instance. Metadata never grants executor admission. |

`ModelTargetCatalog.list(refresh:boolean):Promise<ModelTarget[]>` is the typed service `models.targets` (contract version 1). Optional `ModelTarget.unavailableReason:string` is localized display metadata, not a model identifier, permission or execution receipt. Existing target IDs, bindings, selection storage and `ready` semantics are unchanged. Generated model-tool listings continue projecting only their pre-existing fields. A blocked source is named Claude Code; returned native models appear as disabled rows with the independent local-tool bridge reason. There is no new renderer surface or structural selector: the changed content is provided by the replaceable catalog, not private DOM interception.

`NativeRuntimeControl.models(host:SshHost,catalog:AccountCatalog,accountId:string):Promise<NativeModelOption[]>` is exposed by `actions.native-accounts`. It calls broker `runtime/models` with authority/account generations under the existing SSH peer-UID policy. Only an assigned, authenticated Claude member account is accepted. The broker runs the account-owned CLI with no user frame, no enabled tools/MCP servers or project/user settings sources, sends one correlated `control_request/initialize`, projects model metadata, and terminates its owned process. Native managed restrictions still apply. These catalog-only launch settings do not change the user's files or define a future task execution configuration. Catalog jobs participate in the production runtime admission table, blocking account login/removal and CLI maintenance while active. Cleanup failure preserves that admission entry; shutdown may retry process cleanup without replaying initialization. Authentication and grants are rechecked before launch and after the reply. Reads have a bounded deadline, cleanup and reauthorization; the host deduplicates in-flight reads by connection/account identity and rejects late identity changes. No new state event is emitted for transient metadata; the list promise returns the result. Host state events retain their existing contract.

Errors include unauthorized/stale account or authority, unauthenticated account, old broker unsupported request, invalid metadata, initialization timeout, service closing and unconfirmed cleanup. An older broker reports incompatibility; it does not select a local account, invent models or enable execution. Last-known catalog entries are process-local and keep the source's unavailable reason after a failed refresh. Whole-package host approval is required for interception/replacement; this grants no additional SSH owner or account access. Overrides/interceptors release on disable, failed activation and disposal. A plugin with in-flight work owns its live-state fence; reenable installs a fresh instance. Registration of arbitrary metadata alone does not implement an executor.

Example: `api.services.intercept('models.targets','list',async(next,refresh)=>{const rows=await next(refresh);return rows.map(row=>row.ready?row:{...row,unavailableReason:explain(row)});})`. The returned release handle can be called early; normal plugin disposal also releases it. Native model entries must retain their exact binding/model identity. A new runtime uses the existing typed runtime adapter registration, not a synthetic SSH-ready flag.

Compatibility review: additive optional target field and named service; no IPC method rename, persisted-format change, credential transport or change to Codex acceptance. The contract snapshot now tracks model target and native catalog declarations. Approved synthetic ZIP tests cover real production consumers, runtime registration, multiple plugins, call/replace, blocked-execution independence, disable/reenable, late completion and activation-failure cleanup. Sources: `tests/model-target-catalog.test.ts`, `tests/claude-remote-catalog.test.ts`, `tests/account-runtime.test.ts`, `scripts/test-claude-ssh-catalog-ui.mjs`. Name cleanup was withdrawn at the user's request. The full VPS-Claude-to-local-Windows executor remains unimplemented; these changes do not certify it.
<!-- claude-ssh-catalog-20260930:end -->

<!-- claude-official-mcp-20260930:start -->
## Claude SSH official tool service (2026-09-30)

This dated contract adds the explicitly selected official MCP route. VPS native login, stream-json agent loop, model networking and native Agent orchestration remain remote; the local official `claude mcp serve` process implements file/command operations. This supersedes the earlier unavailable-executor statement only for this route. It neither enables the internal managed-cloud-worker protocol nor claims Codex deferred-executor equivalence. No SDK login, local inference proxy, custom model loop or native acceptance receipt is introduced.

### Coverage matrix and public production path

| Capability | Call existing behavior | Register an implementation | Replace behavior and production consumer |
| --- | --- | --- | --- |
| SSH Claude task lifecycle | Existing `model-targets/list`, `runtime/models`, `runtime/select`, `session/create`, `session/model`, `draft/prepare`, `draft/submit`, `session/permissions`, `session/approval`, interaction and `session/stop` commands | A new runtime uses existing typed `api.runtimes.register`; the account, model and execution catalogs remain distinct | `actions.native-claude` is the same `NativeClaudeService` instance passed from desktop main to controller and `NativeProviderRunner`; `api.services.override` / `intercept` target `supports`, `defaultDirectory`, `createTransport` and `openTools` |
| Local tool backend | `NativeClaudeService.openTools(ClaudeToolServerOptions): Promise<ClaudeToolServer>` | Approved host plugins register a namespaced backend service with `api.services.register`, then install it through the typed `openTools` replacement | `createTransport` calls that instance's `openTools`; the returned definitions/call/close are used by the real session's HTTP MCP handler, not a test-only registry |
| Native stream transport | `createTransport(NativeClaudeOptions): NativeProcessTransport` | Existing host service and runtime registration lifecycles own registration/release | The common native runner observes frame/fault/disconnect, writes native input/control frames, and awaits `stop`; no alternate agent loop |
| Native MCP activity | Existing native activity/file-review consumers; exact `mcp__local_device__` names remain stored | Existing native-event service replacement contracts | Only known official local names map to read/command/file-edit presentation; raw native frames and MCP tool names are not rewritten |

`NativeClaudeOptions` contains the frozen host/session, explicit executable, real local cwd, private transient profile directory, source environment, cancellation signal and `authorize()` callback. `ClaudeToolServerOptions` is its tool-only subset. `ClaudeToolServer` returns readonly native definitions, `call(name,args,signal): Promise<unknown>` and idempotent `close(): Promise<void>`. The runtime transport supplies `state`, `start`, `write`, `stop` plus EventEmitter frame/fault/disconnect; successful stop requires owned local process termination and the remote owner's cleanup receipt. These interfaces are declared in `services/claude-bridge/{index,tools}.ts` and `services/remote-supervisor/index.ts`, included in the reviewed SDK snapshot.

Example for an approved host plugin (the original method must be captured before replacement):

```js
export function activate(api) {
  const service = api.services.get('actions.native-claude');
  const original = service.openTools.bind(service);
  api.services.register('example.claude-tool-backend', {open: options => original(options)}, {version: 1});
  api.services.override('actions.native-claude', {
    openTools: options => api.services.get('example.claude-tool-backend').open(options)
  });
}
```

Both registrations return cleanup handles and are owned by the approved activation scope. Disable/uninstall/failed activation restores subsequent calls. Already acquired handles remain owned by their existing session until close; disable does not start another process or replay an in-flight request. Late acquisition after cancellation is closed before further startup. There is no new provider/runtime enum, configurable backend selector, UI mount point or preference file. Alternative product runtimes still use the existing runtime registry. This narrow backend replacement is independent of whole-application replacement.

### Authority, errors and lifecycle

The controller separately checks the assigned authenticated account generation, native metadata catalog, installed local CLI and remote `NativeRuntimeStatus.execution === 'local-mcp-required'`. Older status values remain readable but do not grant this route. The broker rechecks member UID, workspace policy, authority/account generation, runtime admission and immutable session/cwd binding. Startup uses only native `initialize` and `mcp_status`, verifies the local server is connected, and discards private status/config data before acknowledging readiness. Readiness means launch capability, not completed real-model acceptance.

One SSH connection owns a private remote Unix socket with a loopback relay. HTTP MCP is protected by an ephemeral secret/path; model HTTP routes are absent. The temporary remote MCP config is owner-private and removed after confirmed cleanup; it is not put into process argv, public receipts or login storage. The local server has its own transient Claude configuration, no inherited Claude login token, a synthetic closed-loopback model endpoint, and disabled updater/auto-memory. Actual local HOME/cwd and documented local shell selection/policy environment variables are retained; they are not replaced with a VPS profile. Bash or PowerShell may satisfy the command capability, according to the installed native tool catalog.

Local exported capabilities are explicitly limited to official Read/Write/Edit/Glob/Grep/Bash/PowerShell/NotebookEdit and available TaskOutput/TaskStop. No local Agent, WebFetch, Skill, scheduling or sampling is exposed. The client preparation timeout allows the owner identity/initialize/MCP checks to finish. The client preparation timeout allows the owner identity/initialize/MCP checks to finish. Local shell commands are foreground-only, using the documented background-disable setting; explicit background requests are rejected. VPS native Agent orchestration and its background lifecycle are preserved. This is a documented capability subset, not a claim that every native tool/plugin/skill/fork feature is equivalent. The caller's native approval flow controls MCP calls; plan/read-only modes also reject local mutations. Mode changes apply locally only after the correlated native acknowledgment. Approved host plugins remain full-trust code and may not forge owner authorization or silently add model execution to a tool-only backend.

Errors include `CLAUDE_REMOTE_BINDING_INVALID`, `CLAUDE_REMOTE_UNAVAILABLE`, `CLAUDE_REMOTE_RECEIPT_MISMATCH`, `CLAUDE_LOCAL_MCP_NOT_CONNECTED`, `CLAUDE_LOCAL_TOOL_FORBIDDEN`, `CLAUDE_LOCAL_TOOL_TIMEOUT`, `CLAUDE_CLEANUP_UNCONFIRMED`, `CLAUDE_INPUT_DUPLICATE_OR_INVALID` and `CLAUDE_TRANSPORT_TERMINAL`. Unknown writes/results are not retried. Stops revoke local access and terminate owned process trees; an absent remote cleanup receipt leaves the session uncertain. Input UUID deduplication survives broker restart; final failed transports reject further prompts. Native child approvals remain valid while background agents are active. Claude maintenance uses owned-stream/disconnect evidence and does not send Codex config/read health probes.

Compatibility: apiVersion stays 1; the service/interfaces and status union member are additive. Existing local/API Claude and Codex paths retain their launchers. Legacy remote status disables the new entry until both sides support it; no local-account or old-protocol fallback. Existing target/model/host/permission keys remain authoritative, including while a plugin or service is absent. No active desktop replacement or VPS deployment is implied by this source change.

Tests: `tests/claude-mcp-bridge.test.ts` (tool allowlist, real transport framing boundary, modes, stale receipts, cancellation and unknown cleanup); `tests/claude-owner-session.test.ts` (synthetic owner launch, private config, admission, deduplication, initialization, native background agents and failed-transmission fencing); `tests/claude-ssh-controller.test.ts` (production controller/runner selection, approval, permission, stop, restart and approved ZIP plugin call/register/replace, failure/disable/re-enable); existing native/runtime/catalog suites provide regression coverage. `scripts/probe-claude-mcp-tools.mjs` verifies real local fixture Read/Write/Edit/Glob/Grep/Bash/PowerShell and owned-command termination. `scripts/probe-claude-mcp-metadata.mjs` exercises production owner arguments against an isolated local native CLI using only metadata controls. Neither script opens SSH or sends a user/model input. `scripts/test-claude-ssh-catalog-ui.mjs` covers disabled legacy catalogs and selectable official MCP targets in an isolated hidden desktop, without submitting a task. `scripts/test-claude-ssh-catalog-ui.mjs` covers disabled legacy catalogs and selectable official MCP targets in an isolated hidden desktop, without submitting a task. No development example is installed into the real user profile.
<!-- claude-official-mcp-20260930:end -->

<!-- claude-local-resources-20260930:start -->
## Claude local resources and image content (2026-09-30)

This review extends the earlier official MCP bridge. It does not change native authentication, account ownership, model routing, the agent loop, or UI preferences.

| Capability | Call | Register | Replace and production consumer |
| --- | --- | --- | --- |
| Local resource discovery and skill loading | Core `actions.native-claude.openContext(options)` returns `ClaudeLocalContext`; `discover(directory?)`, `loadSkill(request,userInvoked?)`, `runSkillCommand(request,tools,signal?)`, `close()` | Approved host plugin registers its own namespaced context backend using `api.services.register` | `api.services.override('actions.native-claude',{openContext})`; core `openTools` acquires this backend, and the session gateway consumes its LocalContext/LoadLocalSkill/RunLocalSkillCommand tools and MCP prompts |
| Official Read image envelopes | `actions.native-claude.normalizeToolResult(name,result)` | Register a namespaced result adapter service | Replace this narrow method; core official tool calls use it on the RPC result before returning MCP content. Only verified official Read image envelopes are decoded by default |
| Local commands and images in activity/approval | Existing native task, approval, interaction and stop commands | Existing runtime/service registration; no new selector category | `RunLocalSkillCommand` has command presentation/approval semantics, while its original MCP tool name and native wire remain intact |

### Types, inputs, results and errors

`ClaudeLocalContext`, `LocalClaudeCatalog`, `LocalClaudeSkill`, `LocalClaudeSkillRequest` and `LocalClaudeSkillPlan` are declared in `services/claude-bridge/local-context.ts`. Options are the existing `ClaudeToolServerOptions`: actual local cwd, environment, executable, transient tool profile directory and owning cancellation signal. The catalog returns instruction paths with scope/kind, current repository memory path/files and effective enabled state, skill/command identities, native source paths, hashes, invocation policy and warnings. It reads resource metadata from native files; it does not read credentials or conversation transcripts, create a memory engine, or copy a local profile onto the VPS.

Skill requests contain `id`, current `hash`, optional `arguments`, and optional `directory` matching nested discovery. Results contain the complete substituted body, actual local support directory, explicit pending dynamic commands, and VPS execution metadata. `RunLocalSkillCommand` additionally requires `index` and the exact displayed `command`. The default backend executes it with official local Bash, captures the result for a subsequent load, and never retries an attempted command. Model-dependent skill work stays in the native VPS runtime. Model/agent metadata is not proof that a requested native subagent exists or inherits this MCP server.

Additive `ClaudeToolServer.listPrompts?` and `getPrompt?` advertise standard MCP prompts only when both are present. `prompts/list` returns stable `skill_<id>` names and readable titles; `prompts/get` accepts an `arguments` string and returns a user message containing the full skill plan. Thus the native command name is `/mcp__local_device__skill_<id>`, not an imitation of a native `/skill-name` command. Prompt discovery runs no command. The VPS launch no longer disables all slash-command discovery; it still disables native VPS file/process/Skill tools and isolates settings. Terminal-only commands and native UI dialogs are not remoted by this interface.

Errors use `LOCAL_CONTEXT_*` or `LOCAL_SKILL_*` codes, including changed/unavailable revision, invocation disabled, mismatched/already-attempted command, limits, unsupported substitution and unsupported native lifecycle. Unknown execution is not reported as success or retried. Native errors and ordinary text results are preserved. PNG/JPEG/GIF/WebP native Read envelopes become bounded MCP image blocks only after canonical base64 and signature checks; existing image blocks and non-image Read results remain intact. Foreground Bash/PowerShell timeouts support the native maximum of 600000 ms plus bounded response grace.

### Permissions, compatibility and lifecycle

LocalContext and LoadLocalSkill are read-only; dynamic commands use a separate mutating tool and both native VPS approval and local plan/read-only gates. Native skill/plugin toggles, invocation visibility, supported Skill deny rules and shell-execution policy are reread. Catalog metadata does not authorize a task or override user instructions. Disabled automatic memory is not silently enabled. Explicit memory edits use the existing official Read/Edit/Write tools and must be authorized and read back; remote automatic memory remains disabled. Files, native user configuration and memory survive tool-server cleanup unchanged except explicit approved file edits.

The two new service methods and two prompt methods are optional in their public interfaces, preserving old typed service/back-end implementations. The built-in service supplies them. A legacy tool-only replacement still works and advertises no prompts. Native hooks, background-skill lifecycle, unsupported substitutions/YAML forms and unverified custom-agent availability are not silently emulated. Long ambiguous native project memory keys require explicit `autoMemoryDirectory`. Local persistent background shell jobs are still not offered; native VPS child-agent lifetime is unchanged.

Context handles are acquired per session and closed with that session's official tool server, including late cancellation and failed startup. Plugin disable removes future registrations/replacements; already acquired handles retain their owner and cleanup function until their session ends. Re-enable affects new handles. Command output caches are bounded, in-memory and session-scoped. Prompt lists refresh on request; no SSE/list_changed support is claimed. No new persistent configuration, theme, font, model option, selector, UI surface or user-adjustable control is introduced, so registering a new UI option and migration of DOM locators are not applicable.

Example (approved host plugin):

```js
export function activate(api) {
  const core = api.services.get('actions.native-claude');
  const previous = core.openContext.bind(core);
  api.services.register('example.local-context', { open: previous }, { version: 1 });
  api.services.override('actions.native-claude', {
    openContext: options => api.services.get('example.local-context').open(options)
  });
}
```

The production instance is still controller → NativeProviderRunner → ClaudeSshTransport → core openTools → registered context/result adapter → authenticated local MCP gateway. Tests: `tests/claude-local-context.test.ts`, `tests/claude-mcp-bridge.test.ts`, `tests/claude-owner-session.test.ts`, and `tests/claude-ssh-controller.test.ts`. The latter approves/activates a ZIP plugin and calls discovery through the actual controller-created HTTP gateway, then exercises disable, re-enable, cleanup and activation-failure recovery. `scripts/probe-claude-local-context.mjs` uses the unmodified installed official server with a synthetic home and closed-loopback model routing to verify image bytes, scoped memory read/edit/write/readback, full skills/support scripts, MCP prompts, legacy commands and local shells. It never sends user/model input or SSH. Source, synthetic protocol, local official-tool evidence, real model behavior and deployment remain separate.
<!-- claude-local-resources-20260930:end -->

<!-- claude-local-async-20260930:start -->
## Claude local asynchronous commands and skill shell routing (2026-09-30)

The official local MCP bridge now exposes a bounded asynchronous command adapter for local work that must outlive one foreground tool call. It does not enable Claude Code's native `run_in_background` parameter, because the installed `claude mcp serve` catalog does not provide a verified output/status contract for that path.

| Capability | Call | Register / replace | Production consumer |
| --- | --- | --- | --- |
| Start an owned local command | MCP `StartLocalCommand({requestId,command,shell?,timeout?,description?})` -> receipt `{id,state,...}` | Approved host plugins replace the existing `actions.native-claude.openTools` service and may preserve or replace the built-in tool composition | `ClaudeSshTransport` -> local HTTP MCP session -> official local `claude mcp serve` tool process |
| Read or wait for output | MCP `LocalTaskOutput({taskId,waitMs?})` -> terminal receipt and native tool result | Same `openTools` service lifecycle; no separate renderer or persistent setting | The VPS native Claude session polls the receipt; no model or API request is created by the adapter |
| List or stop owned tasks | MCP `ListLocalTasks({})`, `StopLocalTask({taskId})` | Same service replacement and cleanup handle | Only tasks created by this local MCP session are visible or stoppable |
| Route skill dynamic commands | `LocalClaudeSkillPlan.commands[].shell` is `bash` or `powershell`; `RunLocalSkillCommand` dispatches the matching official local tool | `actions.native-claude.openContext` remains the typed replacement point | `shell: powershell` uses `PowerShell` when the native catalog exposes it; default and `shell: bash` use `Bash` |

Inputs are bounded: four running tasks, 128 session receipts, 32 KiB command text, 600000 ms maximum command timeout, and 1 MiB serialized result. A request ID is idempotent only for the exact same command, shell, timeout and description; changed reuse fails closed. A task result is read once for acknowledgement, and no failed or uncertain task is retried. Stopping a task aborts its owned official tool process; it cannot stop a VPS native Agent or an unrelated OS process.

Each asynchronous task opens a private, transient official `claude mcp serve` process and runs the command through its native foreground `Bash` or `PowerShell` tool. The adapter exposes a task receipt and waits outside the tool call, so this is an official-tool execution adaptation rather than a claim of native background-task parity. Results are not streamed incrementally, and unfinished receipts do not survive session cleanup. The transport closes all task processes before accepting a cleanup receipt from the VPS owner.

The existing local permission gate still applies: `StartLocalCommand` and `StopLocalTask` are mutating tools, while `LocalTaskOutput` and `ListLocalTasks` are read-only. Native remote `TaskStop` and VPS Agent lifecycle remain independent. Existing plugins that replace `openTools` continue to work; plugins that want the asynchronous surface must preserve the named MCP tools or document their replacement behavior. No new UI preference, setting, selector, or persistent storage is introduced.

Tests: `tests/claude-local-tasks.test.ts` covers exact-request idempotency, foreground-tool ownership, stop receipts and tool exposure. `scripts/probe-claude-local-context.mjs` runs the production `ClaudeBridgeService` and HTTP gateway against the installed official CLI with a synthetic PowerShell task, output polling, and cleanup. It sends no user/model input, SSH traffic, or live account request. The remaining unverified boundary is the vendor's own native background output protocol and any future CLI-specific task events.
<!-- claude-local-async-20260930:end -->

<!-- runtime-mcp-repair-20261001:start -->
## Native response mode, disclosure rendering and Claude MCP repair (2026-10-01 JST)

Interface audit before implementation: native gateway request/response framing, runtime.native-provider.openGateway/submit and diagnostics, native retry activities and Session.nativeError; renderer uiPreferences and activity-group/turn-process surfaces; actions.native-claude tool/context services and MCP messages; actions.account-setup plan/apply and the remote runtime/models/runtime/open-claude consumers. There are no new model, provider, language, theme, runtime or settings options, permissions, resource owners or selectors. Existing registration catalogs remain the production owners. Runtime receipts, transient protocol IDs and render caches are not user preferences; document 37 records the unchanged adjustable nodes.

| Capability | Call existing behavior | Register and replace in production | Lifecycle and evidence |
| --- | --- | --- | --- |
| Native third-party response conversion | runtime.native-provider.openGateway(options: NativeGatewayOptions) returns the existing gateway handle; submit sends native CLI requests through it | Approved host plugins register named backend services and intercept/override openGateway; runtime.native-completion.prepare remains the typed completion-codec replacement; new runtimes enter api.runtimes.register | The original downstream stream flag now determines JSON versus SSE for converted protocols; no additional model request/retry. tests/native-response-mode.test.ts, tests/native-completion-plugin.test.ts and scripts/test-native-termination.mjs cover the actual gateway and approved plugin activation/disable/reenable/removal |
| Retry recovery and public diagnostics | Existing state/get, runtime submit and native activity events | Existing native.event-semantics service hooks, registered runtime activity events, api.activities.register classifiers and named activity-group/turn-process/turn-error surfaces provide semantic, presentation and local replacement paths | A completed native answer/newly admitted tool clears only a matching retry in the same turn/child; it does not turn a later failure into success. tests/runtime-reading.test.ts and tests/native-provider.test.ts |
| Deliberate disclosure choices | api.uiPreferences.get/set/reset('disclosure.open', scope) returns the existing UiPreferenceRead/Promise result; subscribe retains global notification semantics | api.uiPreferences.register creates namespaced typed preferences; override replaces effective values on mounted consumers; api.activities.register and observeSurfaces('activity-group', ...) retain their existing cleanup handles | Core React consumers compare the effective value/revision/saved state for their own key, so an unrelated disclosure no longer rebuilds the whole conversation. scripts/test-activity-preference-ui.mjs uses approved plugins, mounted controls and full process restart; tests/ui-preferences.test.ts covers concurrency and damaged preferences |
| Claude official local tools and resources | actions.native-claude.openTools(options: ClaudeToolServerOptions) returns definitions/call/close; openContext and normalizeToolResult remain typed customization points | An approved plugin registers its own backend and overrides openTools/openContext on the same instance consumed by ClaudeSshTransport and its authenticated MCP gateway | roots/list reports the real bound cwd, ping is answered, and sampling/authentication remain unavailable. Server requests cannot consume outbound client requests sharing an ID. tests/claude-mcp-bridge.test.ts, tests/claude-ssh-controller.test.ts and official CLI probes cover the production route and release/failed-activation recovery |
| Remote installation completeness | accounts/setup-plan({id}) and accounts/setup-apply({id,planId,confirm:true}); actions.account-setup.plan/apply use the existing AccountSetupPlan contract | Approved host plugins may register a namespaced setup backend and replace the typed actions.account-setup methods; controller preview/confirmation and host binding still apply | The actual serialized desktop bundle and Linux installer now agree on claude_session.py. Existing differing deployments are not overwritten by discovery or setup. tests/account-service-setup.test.ts executes the real bundle-to-file mapping; scripts/test-account-setup.py checks Linux filesystem installation, refusal and recovery |

Protocol semantics: converted requests with stream false or omitted receive one native JSON response, even when the upstream answers with SSE. Explicit stream true receives SSE. Anthropic text and parallel tool results are emitted in sequential completed content blocks; tool arguments must validate before publication. Same-protocol forwarding is unchanged. Known stream-validation failures retain a fixed public error code (including NATIVE_STREAM_INVALID_TOOL_JSON and NATIVE_STREAM_TOOL_CHANGED); arbitrary exception suffixes, request contents and credentials are excluded. Native retry ownership and terminal-result semantics are unchanged; no outer continuation loop is added.

MCP initialization negotiates the supported 2024-11-05 and 2025-03-26 versions; an unknown requested version receives the supported preferred version for the client to accept/reject. The official local client advertises roots without list-change notifications and rejects an unsupported returned protocol with CLAUDE_LOCAL_MCP_VERSION_UNSUPPORTED, stopping its owned process and removing its transient profile. tools/prompts advertise listChanged:false. LocalContext and LoadLocalSkill return both their existing JSON text and object structuredContent. Task receipts likewise return an object; ListLocalTasks retains its legacy text array and adds structuredContent:{tasks:[...]}. This additive shape preserves existing text consumers and complies with MCP's object requirement. No outputSchema or change notification is promised. Cancellation, unknown completion, authorization and close ownership continue to use the existing contracts; a failed tool is never replayed automatically.

Example for a resource consumer: initialize, send notifications/initialized, then tools/call with {name:'LocalContext',arguments:{}}. Read result.structuredContent or JSON.parse(result.content[0].text). For ListLocalTasks, read result.structuredContent.tasks or parse the existing text array. The approved host-plugin example in the preceding Claude MCP section still registers a backend service and replaces the same production openTools method; no application-wide replacement is required.

Compatibility review: public TypeScript interfaces, host command names, named surface selectors, persistent schemas and shipped defaults are unchanged; no contract snapshot refresh or selector migration is required. Existing text-only plugins remain valid. Approved synthetic plugins exercise real controller-created MCP connections, context replacement, cleanup, disable/reenable and failed activation. The UI test separately verifies a mounted preference override and restoration. Multiple plugins and stale/asynchronous preference writes remain covered by the existing shared-registry tests. There are no new public option directories or user configuration fields to migrate.

Read image-result review: normalized MCP images contain binary data only in image content blocks. A duplicate structuredContent envelope is omitted for image results, and textual dimensions include only recognized finite numeric fields. Invalid/unsupported image envelopes and oversized Read text return a bounded isError result (CLAUDE_LOCAL_IMAGE_RESULT_INVALID or CLAUDE_LOCAL_READ_RESULT_TOO_LARGE) rather than forwarding Base64 as ordinary text. Ordinary non-image structured/text results remain intact. tests/claude-local-context.test.ts covers duplicate and malformed envelopes; the official local-tool probe verifies actual PNG delivery. This does not alter the separate cross-protocol request-mapping implementation.

Deployment boundary: source/build success is not an installed-server capability receipt. A broker without runtime/models and runtime/open-claude must receive a separately authorized, version-checked update including broker.py, runtime.py, runtime_maintenance.py and claude_session.py. Merely refreshing models never updates a remote host, installs a CLI, changes login, or sends a model turn. Real Claude understanding, child-agent tool choice and production provider behavior require separate user acceptance.
<!-- runtime-mcp-repair-20261001:end -->

## SSH 配置管理与远端程序生命周期（2026-10-01）

接口先行审查：原 Codex / Claude Code CLI 行的命令、持久策略和命名 surface 保持不变；同一个连接页签显示名改为“配置管理”，新增工作台远端配置行。第三方调用、注册和替换均连接生产注册实例，维护不调用真实模型。SSH root 授权仍由可信宿主验证，插件批准不授予新的远端权限。

| 功能覆盖矩阵 | 调用已有能力 | 注册新实现 / 选项 | 替换已有实现 | 验证 |
| --- | --- | --- | --- | --- |
| 工作台远端配置状态、安装、更新、卸载 | remote-configuration/list、plan、apply | remote.configurations.register(owner, definition) | remote.configurations.replace(id, adapter) | tests/remote-configuration.test.ts；scripts/test-remote-configuration.py |
| 远端配置自动更新策略与空闲调度 | remote-configuration/configure；RemoteConfigurationService.configure / autoUpdate | 同一注册适配器提供 configure / autoUpdate，真实调度器消费注册目录 | replace(id, adapter) 替换同一行策略与执行；命名行 surface 替换控件 | 批准合成插件经真实 maintainRemote 调度；Linux 持久策略/中断/防降级；隐藏 UI 重启 |
| 配置管理行和确认内容 | 同一命令读取和执行同一注册实例 | 带命名空间 ID 的注册行自动进入真实界面 | observeSurfaces('remote-configuration-row' / 'remote-configuration-plan', 'replace', render) | scripts/test-remote-configuration-ui.mjs；实际批准的合成插件 |
| SSH 模型目录更新后的恢复 | model-targets/list({refresh:true}) | 沿用 models.targets 与原生目录服务 | 沿用目录服务及 Claude 工具注册接口 | tests/claude-ssh-controller.test.ts；旧版本模型不可用保护继续保留 |

公开类型位于 packages/remote-account-catalog/configuration.ts。RemoteConfigurationStatus 返回 installed、running、currentVersion?、bundledVersion、canInstall、canUpdate、canUninstall、error?、installedRevision?、bundledRevision?、policy?；展示版本为服务文件内容摘要，不是账号数量或 CLI 版本。RemoteConfigurationRow 增加 id / label。插件可使用自己的版本字符串，核心使用 wb- 加 12 位摘要。自动更新需要递增的安全整数版本及 RemoteConfigurationPolicy：schemaVersion:1、revision、autoUpdate、lastAttemptTarget?、lastAttemptAt?（Unix 秒）、lastAttemptError?。远端固定错误为英文代码，桌面适配器映射成本地化消息。

- remote-configuration/list({id}) → RemoteConfigurationRow[]：仅已保存的 root 管理员连接；读取部署程序和 systemd 状态，不安装、不发模型消息、不读取登录凭据。单个条目错误保留为不可操作行。
- remote-configuration/plan({id,configurationId,operation}) → RemoteConfigurationPlan：operation 为 install / update / uninstall；返回一次性 id、configurationId、label、operation、currentVersion?、version?、targets、preserves。实际远端 token 不返回渲染层。预览只读。
- remote-configuration/apply({id,configurationId,planId,confirm:true}) → RemoteConfigurationRow：必须确认未过期预览。完整 SSH 连接身份、组件 ID、注册实例与版本绑定；五分钟失效，一次提交后即消费，未知结果不重发。
- remote-configuration/configure({id,configurationId,revision,autoUpdate}) → RemoteConfigurationRow：按远端策略修订进行比较后写入、原子替换和回读；只保存策略，不立即更新程序。冲突、损坏、保存未确认均可见；不在本地保存镜像值。

RemoteConfigurationService 是生产 development service remote.configurations。register(owner, {id,label,adapter}) 返回 {id,dispose()}，最终 ID 为 owner:id；core 保留工作台行 ID workbench。adapter 的 status(host)、plan(host,operation)、apply(host,preview) 均异步，plan 返回 RemoteConfigurationPreview，包括仅供宿主使用的 token。replace(id,adapter) 以有序叠加方式返回同型清理句柄，停用恢复仍活动的前一层；取消非顶层不影响顶层。subscribe(listener) 返回取消订阅函数；注册、替换、清理触发现有 workbench:extensions 通知，已挂载与后续挂载界面重新读取。移除、替换后迟到读取或预览不能恢复旧条目；已开始的远端维护不会因插件停用被假装撤销，旧结果拒绝作为新实现的确认。

自动更新扩展为可选成对方法 configure(host,revision,autoUpdate) → Promise<RemoteConfigurationStatus> 和 autoUpdate(host) → Promise<RemoteConfigurationStatus | undefined>；undefined 表示未执行、可在以后空闲周期重新检查。旧适配器不提供这两个方法时仍支持手动维护，不显示无效开关；只提供其中一个时注册失败。宿主 service.configure(host,id,revision,autoUpdate) 与 autoUpdate(host,id) 增加组件 ID，返回带 id / label 的行。保存策略与自动完成会使旧预览失效并通知界面；注册实例改变后的迟到结果被拒绝。插件应持久记录尝试目标后再修改程序，异常不得伪装成 undefined。宿主另外保留当前进程的未知目标保护。经 IPC 调用维护，或由真实空闲调度器执行，均通过同一主控维护锁。

示例（合成插件；适配器应由该包提供，须完成整包批准）：

~~~ts
const configs = api.services.get<RemoteConfigurationService>('remote.configurations');
const extension = configs.register(api.id, { id: 'custom', label: 'Custom configuration', adapter });
api.onDispose(() => extension.dispose());
const replacement = configs.replace('workbench', replacementAdapter);
api.onDispose(() => replacement.dispose());
const rows = await api.call('remote-configuration/list', { id: adminConnectionId });
// Enable only in response to the user's deliberate switch action:
await api.call('remote-configuration/configure', {
  id: adminConnectionId, configurationId: extension.id,
  revision: rows.find(row => row.id === extension.id).policy.revision, autoUpdate: true
});
const plan = await api.call('remote-configuration/plan', {
  id: adminConnectionId, configurationId: extension.id, operation: 'install'
});
// After the user reviews this specific plan:
await api.call('remote-configuration/apply', {
  id: adminConnectionId, configurationId: extension.id, planId: plan.id, confirm: true
});
~~~

权限与失败边界：维护对同一服务器的两家运行时同时设置准入锁，拒绝已有运行中、待提交、结果未知任务和登录；阻止更改连接身份及 CLI 维护并发。远端再次持有安装锁及两家 CLI 排他锁，核验本服务 cgroup 没有子进程，绝不以停止活跃模型任务完成更新。正在运行且使用外部非受管 CLI 的旧服务无法可靠隔离新启动竞争，返回 CONFIG_BUSY，须先在原管理渠道结束使用；不会擅自接管外部安装。

核心安装包只管理 account-runtime 中明确列出的程序和自身 systemd unit；独立的配置管理脚本随桌面携带，经 SSH 临时执行。首次安装创建或复用专用 owner，复用检测到的 CLI，缺少 CLI 时保持为空，由相应 CLI 行另行安装；不隐式下载安装两家 CLI。更新保留已有服务身份与配置。卸载仅停止、停用并删除已验证程序和 unit，保留原生 CLI、账号资料、目录、SSH 授权、工作空间与服务配置；重装复用它们。

自动更新默认关闭。策略在 /var/lib/agent-workbench-configuration/policy.json，root 所有、0600、schemaVersion 1，卸载/重装保留；只有明确切换才写入，重置由同一 configure 入口写 false。工作台运行时每 60 秒在既有维护周期检查，只有已安装且正在运行、内容不同、随包版本更高、用户开启、目标未尝试且两家运行时空闲时更新；缺失服务不会自动安装，停用服务不会自动启动。执行前重新持有远端安装锁及双运行时租约，并验证实际 cgroup；忙时延期，不记录失败。变更前落盘目标和 CONFIG_UNCONFIRMED，成功清除错误；失败/未知的同一目标跨客户端重启不重放，手动新预览可恢复。旧客户端不可用较小版本覆盖远端；同版本不同摘要也不自动替换。CONFIG_NEWER_INSTALLED、CONFIG_POLICY_CHANGED、CONFIG_POLICY_INVALID、CONFIG_RELEASE_INVALID 均有本地错误映射。只检查程序和元数据，不触发登录、模型消息或额度操作。

发布契约：services/vps-account-broker/configuration-release.json 的 revision 独立于桌面版本，sha256 为按文件名排序、LF 规范化的远端源文件哈希映射摘要。每次改变部署程序或 unit 必须提高 revision 并更新摘要；scripts/remote-configuration-bundle.mjs 计算/校验，build-host.mjs 强制验证匹配及 ASCII 后打包。用户安装包含新配置的桌面版本并运行后，已开启策略才生效；没有单独的远端下载渠道或后台常驻更新代理。发布包不包含 policy.json、账号资料或验收档案。

已知旧版本通过公开程序内容哈希白名单识别，仅容许 CRLF / LF 行尾等价，非版本猜测；后续受管版本由根用户安装回执核验。所有路径拒绝符号链接、硬链接、非可信所有权及未知 systemd override。应用前重新核对预览摘要；仅备份公开程序字节，失败回退程序与原运行状态。备份、事务清单和回执保存在 /var/lib/agent-workbench-configuration，均归 root；不导出用户资料。中断的事务保留，后续只能重新检查当前文件并明确确认新计划，无自动重试；损坏记录不覆盖。回滚失败显示 CONFIG_ROLLBACK_FAILED；已回滚显示 CONFIG_ROLLED_BACK；状态冲突 CONFIG_CHANGED、来源不明 CONFIG_FOREIGN、忙 CONFIG_BUSY、身份不匹配 CONFIG_IDENTITY；其他未确认结果统一 CONFIG_UNCONFIRMED，本机本地化，不泄露远端原始异常。

生命周期与兼容：本次只增加方法、类型和命名 surface，不改变 apiVersion。旧 remote-cli-row 仍只匹配原来的两家 CLI；工作台行使用单独 surface。连接页签 ID、connection-tab-cli / connection-panel-cli 及 connections.tab 保存值 cli 保留，已有定位迁移只需将可见中文标题更新为“配置管理”。预览、确认、状态错误、加载中是临时操作状态，重启不恢复批准；既有页签、CLI 自动更新偏好与披露状态沿用原所有者，详见文档 37。注册行无持久选择器，停用后不保存不可执行的条目或批准。禁用/重新启用、并存、失败清理、迟到结果及新实例由测试覆盖；未创建或安装开发示例到真实用户环境。

源码、真实本机文件系统上的合成 Linux 服务、批准插件加载和隐藏 Electron 是独立证据。本轮不部署 VPS、不重启正式用户窗口、不发送真实模型请求；真实服务更新及模型请求由用户手动验证。


<!-- claude-mcp-hardening-20261001:start -->
## Claude MCP reliability and result delivery (2026-10-01 JST)

Interface review covers the local tool process, normalized results, async receipts, catalog discovery and authenticated MCP session lifecycle. No desktop command, selector, named UI surface, theme, preference key or durable user setting changes. UI preference inventory: there are no new user-adjustable controls; policy limits are shipped runtime defaults, output handles are transient connection resources, and existing saved disclosure/window choices retain their owner and reset behavior. UI persistence scenarios involving new controls are therefore not applicable; the shared preference gate remains required.

### Coverage matrix and production registration

| Capability | Call existing behavior | Register or replace implementation | Production consumer and release |
| --- | --- | --- | --- |
| Bounds and diagnostics | `actions.native-claude.toolPolicy(options): ClaudeMcpPolicy`; `openToolProcess(options): Promise<ClaudeToolServer>` | Register a namespaced policy/process service with `api.services.register(id, service, {version:1})`, then override these typed methods | `openTools` captures the validated policy and opens the file lane and owned command processes through the same service instance; registered diagnostic/progress callbacks receive bounded metadata |
| Result storage and range reads | `actions.native-claude.openResultStore(options): Promise<ClaudeResultStore>`; store `put/read/close` | Register a namespaced store and override `openResultStore`; `openTools` remains the full backend replacement | Both ordinary results and `LocalClaudeTasks` use that store; actual MCP exposes `ReadLocalToolResult`; owning connection close disposes the store |
| Catalog discovery | `ClaudeToolServer.listTools?(): Promise<readonly Record<string,unknown>[]>` | `openToolProcess` backends may supply changing typed definitions; legacy backends can retain `definitions` only | Context/task/result adapters preserve refresh, allowlisting and local additions; session admission reserves the request ID before async discovery and rechecks cancellation/authorization |
| HTTP MCP lifecycle | `runtime.mcp-sessions.limits(): NativeMcpSessionLimits`; `NativeGatewayOptions.mcpSessionPolicy?` | Register a namespaced `NativeMcpSessionPolicy` and override `runtime.mcp-sessions.limits` through the approved lifecycle | `WorkbenchController.developmentServices` exposes the actual object used by native and SSH gateways; mounted and later gateways consult it; release restores preceding layers |

The backend and policy extension points deliberately operate below the tool selector. Adding arbitrary model sampling/authentication or silently broadening native tools is not supported by these reliability interfaces. No replacement of the entire application is needed. The existing native tool allowlist remains authoritative. All registration/override functions return cleanup handles owned by the plugin activation lifecycle.

### Contracts, limits and errors

Types are declared in `services/claude-bridge/{tools,policy,result-store,local-tasks}.ts` and `packages/model-api/native-gateway.ts` and included in the reviewed contract snapshot. Added `NativeClaudeService` methods and `ClaudeToolServer.listTools` are optional in the public interface for existing replacement services. The built-in implementation provides all of them. Existing call/close signatures and API version remain compatible.

`ClaudeToolServerOptions` adds optional `policy`, `diagnostic(ClaudeToolDiagnostic)` and `progress({callId,progress,total?})`. Diagnostics include a fixed code, optional tool/call ID, stage, outcome and elapsed milliseconds; delivery failures may include byte counts. They exclude arguments, result bodies, paths and arbitrary exception messages. Observer exceptions do not change execution. Only progress notifications correlated to an outstanding locally generated request ID are delivered. The HTTP endpoint remains POST JSON, without claiming server notification streaming.

`ClaudeMcpPolicy` defaults: 16 MiB native JSONL frames, 128 MiB output per bounded exchange, 8 MiB normalized/stored JSON results, 1 MiB inline results, 256 MiB storage per connection, 32 catalog pages, 512 catalog entries and four simultaneous foreground command processes. All bounds are positive safe integers; inline <= result < frame <= exchange and result <= storage. The wire envelope allows space for native image JSON and its structured representation before normalization; this is not an inference about billed duplication. `ProcessSupervisor.resetOutputBudget()` is used only when the tool adapter has no pending request. Other supervisors keep lifetime accounting. A long sequence of completed tool calls no longer consumes one cumulative lifetime budget; per-exchange stderr/output and individual frame limits remain active.

Native tool failures preserve `CLAUDE_LOCAL_TOOL_TIMEOUT`, `CLAUDE_LOCAL_TOOL_CANCELLED`, `CLAUDE_LOCAL_TOOLS_DISCONNECTED`, `CLAUDE_LOCAL_TOOL_REJECTED`, `CLAUDE_LOCAL_WIRE_LIMIT`, `CLAUDE_LOCAL_TRUNCATED_FRAME` and `CLAUDE_LOCAL_INVALID_FRAME`. Catalog pages reject repeated cursors, duplicate names, oversized catalogs and unsupported versions. Unknown exceptions become `CLAUDE_LOCAL_TOOL_UNCONFIRMED`. Results explicitly state that no retry occurred. A native return followed by delivery failure is distinguished from unconfirmed execution; no failed/unknown write is replayed.

`ClaudeResultStore` exposes `inlineBytes`, `maxResultBytes`, `put(value): Promise<ClaudeResultReference>`, `read(id,offset?,maxBytes?): Promise<ClaudeResultPage>`, and idempotent `close()`. References contain an opaque ID, exact UTF-8 JSON byte count, SHA256, encoding and a bounded preview. Pages return `id/offset/nextOffset/bytes/text/eof`. `ReadLocalToolResult({id,offset?,maxBytes?})` is read-only in the existing permission gate; default page size is 64 KiB and maximum 256 KiB, with UTF-8 boundaries preserved. Only handles owned by that connection resolve. No caller-supplied path is accepted. Files use exclusive creation, POSIX mode 0600 and the inherited local profile ACL on Windows; cleanup removes only the created store directory. Handles are not portable across connections or application restart. Storage/range/ownership failures use `LOCAL_RESULT_*` codes. Native images remain image blocks; ordinary inline structured results remain intact. This change does not claim token savings from the simultaneous presence of MCP content and structuredContent.

Async task receipts add optional `output` and `outputError`. A completed command whose output cannot be stored retains its known execution state and exposes the delivery error separately. Final state is published after output delivery and owned process cleanup. Output polling does not rerun a command; native incremental output is not invented. Results exceeding the wire/result/storage limits are explicitly refused rather than silently truncated. These limits and native CLI read limits still apply.

### Cancellation, lifecycle and compatibility

Bash/PowerShell invocations each own an official tool process. Cancelling one terminates its tree without terminating the file lane or other commands. The file lane is serialized to preserve the native read-before-edit state. A cancelled/timed-out file operation closes that lane; queued operations have not executed and are not automatically retried or replayed. Each new command uses the bound cwd; shell-local process state is not promised across separate invocations. Async commands continue to own their individual native servers.

**Process ownership and result storage are not network isolation. Local Bash/PowerShell can still initiate network connections and reveal the local egress IP. Proxy/environment handling, prompt text and output limits do not enforce an egress boundary.** This change does not authorize or perform a live model request or remote deployment.

MCP HTTP gateways default to 32 initialized sessions and five minutes idle retention. Pending invocations do not expire. Failed initialization is disposed; DELETE and gateway close release sessions. Exceeding capacity returns HTTP 429 with `MCP_SESSION_LIMIT`. A dropped HTTP response does not establish cancellation: the invocation remains owned until explicit cancellation, native timeout or gateway closure; it is never replayed. Existing gateways consult the current registered lifecycle policy. Existing tool connections retain their captured execution/storage policy and owned resources through plugin disable; later connections use restored defaults. Output storage is deleted when its owning connection closes. No saved user configuration migration is needed.

Example approved host plugin:

```js
export function activate(api) {
  const core = api.services.get('actions.native-claude');
  const base = core.toolPolicy.bind(core);
  api.services.register('example.claude-policy', {
    resolve(options) { return { ...base(options), inlineBytes: 512 * 1024 }; }
  }, { version: 1 });
  api.services.override('actions.native-claude', {
    toolPolicy: options => api.services.get('example.claude-policy').resolve(options)
  });
}
```

### Behavior evidence

`tests/claude-mcp-hardening.test.ts` covers bounded long exchanges, frame/truncation errors, safe diagnostic codes, catalog pagination/refresh/progress, late cancellation, command/file isolation, exact UTF-8 paging, ownership, cleanup and completed async delivery failures. `tests/claude-ssh-controller.test.ts` approves and activates synthetic ZIP plugins through the real registry and controller-created SSH MCP gateway, verifies actual result spilling/range retrieval, old and later consumers, multiple policy layers, disable/re-enable, failed activation and uninstall cleanup. Existing backend/context plugins retain their tests. No developer plugin is installed in a real user profile.

`scripts/probe-claude-local-context.mjs` validates the installed official CLI with isolated files and a blocked model route. `scripts/probe-claude-mcp-roundtrip.mjs` drives the official native loop against a loopback synthetic upstream, inspecting actual outgoing MCP results for JSON/INI/log range retrieval and image blocks; its three synthetic HTTP exchanges are not paid model requests. The probe requires an explicit `AWB_QA_CLAUDE` executable. Source, protocol/plugin tests, installed native-tool checks, synthetic native-model transport, real provider acceptance and deployed desktop evidence remain distinct.
<!-- claude-mcp-hardening-20261001:end -->

<!-- imported-workspace-claude-boundary-20261001:start -->
## Imported workspace readiness and MCP control-plane privacy (2026-10-01 JST)

Interface review covers `studio/import`, `studio/connect`, the additive `studio/prepare` command, `accounts.catalog`, `native.cli`, `actions.native-accounts`, `actions.native-claude.openContext`, `LocalContext`, `LoadLocalSkill`, and MCP `roots/list`. The model selector consumes the existing account/model catalogs. No provider, runtime or configuration directory was added. Imported devices keep their member SSH identity locally; native login credentials and administrator SSH keys are not transferred through this preparation flow.

| Capability | Call existing behavior | Register or replace implementation | Production consumer and validation |
| --- | --- | --- | --- |
| Imported workspace activation | `studio/import({previewId,confirm:true,deviceLabel?}) -> PreparedWorkspaceHost` | Register a namespaced backend and override the real `actions.workspace-management`, `accounts.catalog`, `native.cli` or `actions.native-accounts` service methods | The controller stores the member, selects it, reads its catalog, prepares missing official local tools and primes the production model selector; controller and approved-plugin regression tests |
| Preparation recovery | `studio/prepare({id,confirm:true}) -> PreparedWorkspaceHost` | The same registered catalog, installer and native metadata services are consumed; a namespaced backend can replace one stage | Existing saved non-root members only; no import/enrollment operation, account login or model input; concurrent calls coalesce |
| Existing workspace connection refresh | `studio/connect({id,workspaceId,confirm:true}) -> SshHost` | The same `WorkspaceManagementActions.connect` and `accounts.catalog` registrations are consumed; no fixed workspace or account list is added | Existing-member and newly connected paths both refresh the catalog before returning; controller regression covers repeated refresh |
| Control-plane redaction | Existing `actions.native-claude.openContext(options)` and MCP tool calls | An approved context backend still replaces `openContext` on the named service; the production context adapter applies the same typed sanitizer before JSON envelopes are exposed | `LocalContext`, `LoadLocalSkill`, and MCP prompt payloads remove authority/device/SSH/workspace/member fields; ordinary native file and command results are not passed through this adapter |
| Generic MCP root identity | MCP `roots/list` | An approved tool backend may replace `openTools`, but the built-in response keeps the stable generic root label | The bound URI is retained for native file resolution while the root name is `project`; model-facing server metadata contains no host/device label |
| Import and recovery UI | Existing import confirmation plus preparation receipt | `observeSurfaces('workspace-import', 'replace', factory)`; standard owned cleanup | Named `[data-workbench-workspace-import]` covers mounted and later dialogs, with approved plugin disable restoration; old test selectors remain |

`studio/import` requires invitation confirmation and a verified non-root member. Its additive `PreparedWorkspaceHost` preserves every existing `SshHost` field and adds `preparation: WorkspacePreparation`, declared in `apps/desktop/host/workspace-management.ts`. The receipt has `ready: boolean` and optional `reason: 'catalog' | 'account' | 'runtime' | 'bridge' | 'changed'`; it is not written into the saved host. Catalog identity must match `authorityId`, `authorityGeneration` and `remoteWorkspaceId`; mismatches cannot publish account state. `studio/connect` refreshes catalog metadata for existing and new members. Actual task admission retains its fresh account/capability check.

Only the explicitly confirmed import/prepare flow may install a missing local Claude CLI, using `native.cli.install('claude', false, false, 'native')` after administrator-managed account selection is verified. Existing installations are reused. The official installer, runtime maintenance fence and failure/no-replay behavior stay owned by `LocalCliService`; the invitation cannot provide installer commands or URLs. No local Claude authentication, token refresh, remote deployment, account switch or model input is initiated. Remote `models/status` discovery primes the same model cache and capability set consumed by the selector and runner. This is preparation evidence, not a real provider inference receipt.

Invalid confirmation or member identity still rejects before preparation. Failures after membership is saved return `ready:false` with a bounded stage code; arbitrary transport/installer errors are not exposed in the receipt. The UI preserves that member and offers explicit preparation recovery without repeating enrollment. Connection identity changes reject late readiness, and concurrent requests for the same binding share one operation. Closing a dialog does not cancel a confirmed operation; closing the application drains the existing owned CLI lifecycle. Restart never replays import or installation authorization.

MCP redaction applies only to workbench-owned resource envelopes, recursively and with case/underscore/hyphen aliases. Unsupported object serializers, cycles and nesting beyond 32 levels fail closed with a fixed internal error, mapped through the existing safe MCP error path. Actual paths required for file/skill resolution, user-authored text and native file/command results are preserved. This is data minimization, not a network sandbox, an anonymity guarantee or a provider-policy exemption. Fully trusted replacement tool servers retain their contract obligation to apply the same privacy boundary.

Compatibility: old consumers of the import result still receive all `SshHost` fields; old replacement import UIs returning no preparation receipt display membership completion without claiming runtime readiness. No saved-host/account schema or display preference migration is needed. New command/types and named surface are reviewed in the contract snapshot. There is no new extensible option directory: existing registered services and model catalogs remain authoritative. Document 37 inventories the transient preparation/recovery state and unchanged persistent owners.

Example for an approved host integration:

~~~ts
const studio = api.services.get('actions.workspace-management');
const accounts = api.services.get('accounts.catalog');
const imported = await api.call('studio/import', { previewId, confirm: true });
if (!imported.preparation.ready) {
  // Show the stage to the user. Never automatically replay a failed installer.
  return imported.preparation;
}
const catalog = await accounts.list(imported);
~~~

The example does not grant a plugin authority to export credentials or bypass the invitation confirmation. `accounts.catalog` is a read-only public metadata service for selection and readiness; native Claude authentication and model execution remain owned by the administrator-managed VPS runtime. Imported devices retain local project and shell execution for MCP tools, while the remote account and its policy remain bound to the administrator's authority.

Tests: `tests/controller-workspace-management.test.ts` covers import/catalog binding, member-only confirmation and unavailable readiness. `tests/claude-mcp-bridge.test.ts` covers generic root naming, alias redaction and fail-closed nesting/serializer limits. `tests/claude-ssh-controller.test.ts` uses real approval/activation of synthetic ZIP plugins, the production installer/catalog consumers and an authenticated session MCP gateway; it verifies import-to-model selection, explicit failed-install recovery, concurrent/late requests, context/skill/prompt privacy, backend disable/reenable and existing failed-activation cleanup. `scripts/test-workspace-ready-ui.mjs` exercises the production import UI in hidden Electron with disposable approved host/renderer plugins, later surfaces, narrow layout and full restart. No real provider request, remote deployment, real installer, credential export or active desktop replacement is implied. All four project gates remain required.
<!-- imported-workspace-claude-boundary-20261001:end -->

<!-- session-send-recovery-20261001:start -->
## Native follow-up, model controls and input recovery (2026-10-01)

Pre-implementation interface review: affected routes are `runtime/models`, `model-targets/list`, `session/model`, `session/model-target`, `draft/prepare`, `draft/submit`, `state/get` and state broadcasts. Affected services are `workbench.controller.observeNativeSession`, `runtime.native-provider`, `models.targets`, native account/model readers and the production state store. User choices remain session model/runtime/effort and their existing lane/last-selection owners. Recovery adds durable session working data, not an execution preference. No new runtime, account, permission, model enum, executable or resource is introduced.

| Capability / coverage | Call | Register or replace / actual consumer |
| --- | --- | --- |
| SSH model label and effort | `runtime/models({sessionId?,runtime?,hostId?,refresh?}) -> NativeModelOption[]`; `session/model({sessionId,selection}) -> AppState` | Existing native model readers and `models.targets.list` use the production cached catalog; `runtimes.register` still supplies added runtimes/models. `composer-model` is a new named multi-instance view surface. SSH Claude now reads the same detailed catalog as its model picker, including names, exact efforts and defaults. |
| Existing chat runtime/model switch | `session/model-target({sessionId,targetId,selection?}) -> Session` | Existing `models.targets`, runtime registration and per-runtime services remain replaceable. `composer-runtime` exposes the local control. The renderer chooses a ready target on the current source, preferring a saved lane; unavailable targets leave the chat and draft intact. Native IDs stay on their original lane, visible history follows the existing loss-aware handoff. |
| Failed input retention | `state/get -> AppState` includes optional `Session.draftRecoveries: DraftRecovery[]`; `draft/recovery-dismiss({sessionId:string,id:string}) -> AppState` | New typed service `composer.recovery: DraftRecoveryService` is registered on the actual controller and consumed by draft dispatch and StateStore mutations. `services.intercept/override` composes named methods with cleanup. `draft-recovery` is the named multi-instance view. |
| Observation lifecycle | Existing trusted `workbench.controller.observeNativeSession(id,source)` | Existing approved host service interception reaches the production listener. Initial native-thread allocation is allowed once, but thread replacement, authority/account/runtime changes remain rejected. Host display rename is not an authority change. Retiring a closed listener consumes its previous failure only after listener removal; a new binding still undergoes full validation. |
| Claude context and Fast | Existing `NativeModelOption.contextWindow`, `serviceTiers`; `NativeModelSelection.serviceTier` | `actions.native-accounts.models` and official local-account discovery feed `models.targets`, `runtime/models`, the composer and actual launch validation. Approved adapters may register runtime catalogs through `runtimes.register`, or replace these named readers/executors with cleanup; no model-name allowlist is added. |

`DraftRecovery` has `{id, preview:DraftPreview, outcome:'pending'|'not-sent'|'failed'|'uncertain'}`. The service methods `capture(session,preview)`, `observe(previous,session)`, `fail(session,id)`, `dismiss(session,id)` and `restart(session)` mutate the supplied session and return void; callers must use the notifying state facade for durable changes. The built-in submit route stores the exact original preview before starting a normal dispatch. Successful completion removes that pending record. Pre-send failures retain it as not-sent; terminal errors retain failed/uncertain outcomes. Restart converts pending to uncertain without replay. Queue and live steering continue using their existing durable entries/message receipts; this service does not duplicate that owner.

Confirmed unsent or failed input returns to an empty composer. A newer text, attachment, skill or annotation is never replaced automatically. Explicit recovery combines text and unique reference IDs; the durable backup remains until explicitly removed or replaced by a newly submitted recovered draft. Unknown outcomes offer explicit recovery and continue to require the existing receipt reconciliation before sending. Original text, attachment/skill references, annotations and translated preview remain intact; editing invalidates old submission authorization. No automatic retry, account rotation or native context migration is added.

`attachments/cleanup` retains recovery and queued-follow-up attachment IDs through its existing typed attachment-store service. Dismissing a recovery removes that reference, not a file still owned by another message or queue. Existing cleanup permissions and lifecycle are unchanged.

Claude model projection preserves each exact native value including `[1m]`, adds a readable 1M suffix only when needed, and does not synthesize absent variants or infer a lower capacity for unsuffixed values. A valid numeric `contextWindow` (integer 1..100000000) is projected if supplied; otherwise `[1m]` supplies 1000000. Supported efforts and valid native defaults remain exact. `supportsFastMode === true` projects the existing tier `{id:'priority',name:'Fast',description:string}`. Omitted/false capability means no switch; prior catalogs with `serviceTiers:[]` remain valid. Unknown metadata is not exposed by the remote public projection.

Example: `api.call('session/model',{sessionId,selection:{model:'opus[1m]',effort:'high',serviceTier:'priority'}})` is valid only if the current account catalog declares that exact model, effort and tier; omitting `serviceTier` requests normal speed. `session/model-target` and chat-session tools validate explicit SSH selections by the same current catalog. Local and SSH official Claude launches apply `--settings` with `fastMode:true/false`; this session-local overlay never edits native user configuration. New source options use existing typed runtime registration rather than adding a fixed model directory. Fast preference is requested state, not proof of account entitlement, effective runtime speed or billing. Unsupported or stale choices reject instead of silently selecting another model.

Remote bundle revision 2 includes the additive catalog metadata and optional `selection.serviceTier:'priority'`; prior source digests remain recognized for controlled migration. Older brokers return no Fast tier and do not offer the switch; using these SSH capabilities requires explicitly updating the remote configuration through its existing management lifecycle. Source delivery does not deploy that update. The broker rejects malformed selections with `CLAUDE_MODEL_SELECTION_INVALID`; desktop public metadata rejects secret-shaped/invalid fields. No new permission, network route, credential access or automatic retry is introduced. See document 07 for vendor sources. Additional tests: `tests/claude-remote-catalog.test.ts`, `tests/claude-owner-session.test.ts`, and the 1M/Fast cases in the hidden renderer script.

Errors: missing/stale IDs or dismissal of pending work produce `DRAFT_RECOVERY_CONFLICT`; 32 retained records produce `DRAFT_RECOVERY_FULL` before another send; malformed or future outcomes produce `DRAFT_RECOVERY_INVALID` on load and preserve the source file. Annotation validation retains its existing errors. Storage failure rejects the send before dispatch. Recovery uses local session access and requires no new OS permission. Full host-code approval remains necessary for service replacement; registering a view or policy never grants account/remote permissions.

Example: `const state = await api.call('state/get'); const entry = state.sessions.find(s => s.id === sessionId).draftRecoveries?.find(d => d.outcome !== 'pending');` A UI extension renders `entry.preview.original` and references for editing, then invokes the normal preview/submit flow only on explicit send. `await api.call('draft/recovery-dismiss', {sessionId, id: entry.id})` removes only that backup. Host instrumentation: `api.services.intercept('composer.recovery','observe',(next,previous,current) => next(previous,current))`; the registry releases the layer on disable, failure or unload. Renderer registration: `api.observeSurfaces('draft-recovery','replace',render)`; use the same API for `composer-model` and `composer-runtime`.

Compatibility: additive API v1 records, service and surfaces; old sessions without recovery records are unchanged. No preference default, model ID, effort label or selector is renamed. Existing composer and workspace-header surfaces remain; extensions should migrate internal child/CSS selectors to the three named surfaces for local replacement. Missing/disabled extensions preserve data and selections; restoring extensions does not send any model input. Async catalog scope checks and observation queues continue fencing stale results. New view state (notice/focus/menu) is transient; durable recovery is versioned by the existing version-1 state owner, validated on load and serialized through its mutation queue. Recovery data stays out of code exports and release packages.

Tests: `tests/session-send-recovery.test.ts` covers the production SSH Claude runner across two turns, pre-send failure, changed thread/authority fences, old observer cleanup, recovery restart/corrupt-data preservation, source/lane selection, and actual approved ZIP service interception/disable/reenable. `scripts/test-session-send-recovery-ui.mjs` exercises the built production renderer, source-backed names/efforts, automatic and explicit recovery, concurrent typing, same-chat model/runtime switches, current/later named surface mounts and cleanup, restart and light/dark fitting. Existing model catalog, native observation, model lane and UI preference suites cover old contracts and late results. Synthetic transports and hidden Electron do not establish live VPS or real-model acceptance.
<!-- session-send-recovery-20261001:end -->

<!-- native-send-preparation-20261001:start -->
## Native send preparation and pending input (2026-10-01 JST)

Interface review before implementation: affected commands are `draft/prepare`, `draft/submit` and additive `session/prepare-runtime`; production services are `runtime.native-provider`, `runtime.codex`, `composer.recovery` and `workbench.state`. Existing state notifications and user-message surfaces render the pending input. No new provider/runtime choice, resource package, UI mount, adjustable control or persistent preference is introduced. Existing selectors and registered runtime adapters retain their contracts; custom runtime preparation is not assumed or invoked.

| Capability | Call existing behavior | Register an implementation | Replace and release |
| --- | --- | --- | --- |
| Prepare an existing native session | `api.call('session/prepare-runtime',{sessionId:string}) -> Promise<{ready:boolean}>`; `runtime.native-provider.prepare(id)` / `runtime.codex.prepare(id)` have the same result | Approved host plugins register preparation policy with `services.intercept(service,'prepare',handler)` on the actual controller-owned runner | `services.override(service,{prepare})` replaces this narrow operation for current/later chat mounts and draft preparation; returned cleanup/disable restores core |
| Codex bundled model metadata | `runtime.native-provider.prepareCatalog(executable:string,model:ApiModel,env:NodeJS.ProcessEnv) -> Promise<{file:string,dispose():Promise<void>}>` | Intercept the production catalog reader; launches invoke the same instance | Override `prepareCatalog`; the runner always disposes its per-launch file. Do not export process environment or credentials |
| Pending original input | `composer.recovery.pendingMessages(session:Session,timestamp:string) -> Message[]` | Intercept this typed presentation operation, independent of persisted recovery capture | Override `pendingMessages`; `workbench.state.get`, `state/get` and emitted state all consume it. Returned pending messages are view projections, never saved native receipts |

Example (approved host plugin):

```js
export function activate(api) {
  const runner = api.services.get('runtime.native-provider');
  api.registerCommand('prepare', ({sessionId}) => runner.prepare(sessionId));
  api.services.intercept('runtime.native-provider', 'prepare', async (next, id) => {
    return next(id); // Register a preparation policy on the production entry.
  });
}
```

Preparation checks session/connection authority and only initializes the transport; it never sends draft text, a model turn or a memory-consolidation job. Entering an existing idle chat and preparing a non-demo draft invoke it without awaiting it in translation. Actual submit still checks authority, source, permission/model identity and remote quota admission. Preview cancellation never sends the draft. Local maintenance regards an owned prepared process as active; changing idle permissions closes the prepared process. Unused preparation expires after two minutes; speculation is limited to one idle session per runner, and shutdown releases owned resources. Preparation failures are best-effort in the UI; explicit submit retains existing errors and recovery behavior. Changed launch inputs fail with `NATIVE_PREPARATION_CHANGED`; unavailable installation/authority uses existing errors. No failed or unknown model request is automatically replayed. A failed unused transport may be replaced only by a new preparation or explicit submission; no background retry loop is added.

Codex resume preparation supplies `deferGoalContinuation:true`. SSH Codex still performs quota admission on actual send, not preparation. SSH Claude uses the existing verified official MCP transport, including its handshake. No remote code deployment or credential migration is required. Bundled Codex metadata is cached in memory by executable real path/stat revision, with shared concurrent reads and at most four revisions per reader. Each launch retains an independent disposable model-catalog file; read failures are evicted. Cold explicit sends overlap context discovery with native startup; later turns read fresh context.

Compatibility/lifecycle: API v1 command addition and additive service members; existing submit callers and plugins remain valid. Public snapshot adds `session/prepare-runtime` and the typed recovery presentation member; no old command or surface is removed. Old profiles require no migration. Pending originals come from the existing durable recovery owner and disappear on rejection or merge by message ID once the native submission is recorded; the label remains pending rather than claiming acceptance. Prepared processes/promises/timers are transient and are not restored after restart. A brand-new chat without a bound session, an expired preparation, or changed connection still needs cold initialization; no zero-latency network/first-token promise is made.

Evidence: `tests/native-preparation.test.ts` exercises local Claude/Codex and SSH Claude, timing barriers, in-flight send, stop, changed permission, revoked source, disconnect, bounded metadata reuse, projection deduplication and real ZIP approval/activation with layered interception, replacement, registration failure, disable/reenable/uninstall. `tests/native-bridge-controller.test.ts` covers SSH Codex preparation and send-time quota admission. `scripts/test-send-preparation-ui.mjs` uses a hidden isolated Electron profile, an approved synthetic plugin, pending/accepted rendering and complete process restart. Tests do not install examples into a real user profile and do not stand in for live account/VPS latency.
Validated: full suite 1684/1684 with the installed native Codex executable explicitly selected for the isolated skill-control fixture; typecheck, plugin contracts, public docs and UI preference checks pass. The hidden Electron pending-input screenshot was visually inspected. Final targeted lifecycle regressions pass. Other windows' staged/unstaged changes are excluded from this commit and are not independently certified by this record.
<!-- native-send-preparation-20261001:end -->

<!-- interaction-latency-20261001:start -->
## Submission, streaming interaction and MCP connection review (2026-10-01)

Pre-implementation interface inventory: affected calls are existing `draft/prepare`, `draft/submit`, `state/get`, `session/stop` and extension lifecycle commands. Production services are `composer.recovery`, `native.event-semantics`, `workbench.state`, `workbench.controller`, `actions.native-claude`, and `runtime.mcp-sessions`. Existing state notifications, native event receipts, user messages, `draft-recovery`, `turn-progress`, `active-turn-progress`, and `session-metrics` surfaces remain the named consumers. Runtime/model/permission selectors, resources and persistent configuration add no options or migration.

| Capability | Call | Register and replace | Production consumer and cleanup |
| --- | --- | --- | --- |
| Streaming admission and scheduling | `NativeEventSemantics.accepts(frame: NativeFrame): boolean`, `batchWindowMs(): number`, `auditWindowMs(): number` on `native.event-semantics` | Register a namespaced typed policy with `services.register`, then intercept/override these members | `attachNativeObservation` uses admission for semantic writes only, never to drop audit/activity events. Admission and audit windows consult the live service. Batch delay is captured on attachment, capped at 100 ms; zero/nonfinite disables batching. Audit delay is clamped to 100–1000 ms, nonfinite falls back to 1000 ms. Release restores previous service layers; existing queues drain their captured delay, later observers capture the restored default. |
| Immediate editor feedback | Existing `draft/submit` and `composer.recovery` | Existing registered runtime submission implementations and recovery interception; named composer and recovery surfaces remain replaceable | The frozen preview owns the dispatched text. The editor clears before native receipt and accepts typing while submission is pending. A rejected submission restores only an untouched editor generation; later edits survive. A successful receipt followed by refresh failure never restores submitted text. No automatic resend. |
| Honest running feedback | Existing `state/get` audit receipts and metrics, additive `ReadingTurn.lastNativeEventAt?` / `lastVisibleEventAt?` | Native event adapters/presenters remain registerable; existing `turn-progress` and `session-metrics` surface observers support local replacement and cleanup | Display last received event age without private thinking. Five minutes of reasoning without visible message/tool activity gets an explicit label. Recent reported speed is labelled as the previous measurement, not live throughput. Optional fields require no persisted format migration. |
| MCP socket lifetime | Existing typed `actions.native-claude.openGateway` and `runtime.mcp-sessions.limits()` | Registered gateway implementations replace the actual bridge factory; existing session-policy service layers remain supported | Core MCP responses advertise `Connection: close`, so forwarded idle sockets are not pooled across exchanges. Logical initialization and concurrent calls remain owned by `Mcp-Session-Id`. Session limits, cancellation, authorization and disposal remain unchanged; no replay after a lost response. |

Example host extension: `api.services.register('example.observation', { batchWindowMs: () => 16, auditWindowMs: () => 500 }, {version: 1}); api.services.override('native.event-semantics', api.services.get('example.observation'));`. Explicit frame extensions may intercept `accepts` and `apply` together. Legacy overrides/interceptors of `apply`, `background`, or `command` retain all-frame admission automatically, so earlier extensions are not silently filtered. Filtering excludes core no-op stream/thinking-token semantic writes; full native receipts remain counted. `OrderedMutations` keeps barriers ordered and drains timers on flush/dispose; storage errors still fail the observer. No additional permission or model request is introduced.

Compatibility evidence: `tests/claude-ssh-controller.test.ts` loads an approved synthetic ZIP through the real activation lifecycle, registers/intercepts policy, consumes custom frames through a running production observer, and checks disable/reenable restoration. Existing approved MCP policy/result tests cover layered replacement, activation failure and removal. `tests/native-observation-performance.test.ts` preserves 200 private-event receipts with at most four persistence updates and zero per-frame application snapshots. `tests/native-stream-transport.test.ts` checks asynchronous batches, barrier ordering, flush and failure propagation; `tests/claude-mcp-hardening.test.ts` checks explicit HTTP close with logical session retention. `scripts/test-interaction-latency-ui.mjs` validates delayed success/rejection, newer input preservation, streaming input, activity age and full process restart in hidden Electron. No synthetic plugin is installed in a real profile. Existing named selectors remain valid; additive semantic-service declarations are reflected in the reviewed contract snapshot.

Limits: forwarded idle-close racing is a transport mitigation, not proof of the cause of any historical ECONNRESET. A live native process and incoming thinking metadata prove liveness only, not useful progress or healthy upstream inference. Source/protocol/hidden desktop checks do not prove foreground deployment or that a long-running remote model request has recovered. No remote deployment, automatic cancellation, replay or change to selected thinking effort occurs.
<!-- interaction-latency-20261001:end -->

<!-- live-message-actions-20261001:start -->
## Live commentary translation and local MCP image preview (2026-10-01)

Interface review: affected commands are `message/retranslate({sessionId,messageId}) -> null` and `attachments/activity-images({sessionId,activityId}) -> AttachmentView[]`; existing services are `workbench.controller`, `translation.module`, and `images.viewed: ActivityImagesService`. State notifications carry existing translation status and activity attachment references. No catalog, selector, resource, permission or persisted format is added. Existing translation/message, runtime-log, attachment-list, image-thumbnail and image-viewer surfaces keep their names and multiple-instance cleanup.

| Capability | Call | Register or replace | Lifecycle and compatibility |
| --- | --- | --- | --- |
| Manual live commentary translation | Existing `message/retranslate` on the current public text snapshot | Registered translation providers feed the existing translation module; intercept the controller/service or replace the named message actions through existing renderer extension surfaces | A running turn and a last-position commentary no longer disable the action. Module-off and an active translation still disable it. Automatic intermediate translation remains independent. If source text changes while translation runs, discard the stale result and release `pending` to `off`, allowing another explicit request. No native turn submission/replay occurs. |
| Local MCP image preview in an SSH model session | Existing `attachments/activity-images`, `images.viewed.read(request)` | Register a namespaced `ActivityImagesService`, then override/intercept `images.viewed.read`; approved host activation owns cleanup | An exact `mcp__local_device__Read` activity in a Claude native-owner session bound to `executionId: local-device` can use its absolute local image path despite remote model hosting. Ordinary remote Read, other MCP servers and other execution locations remain rejected. Existing import validation, source identity checks, concurrent-read deduplication, cached attachment verification and preview ownership apply. |

Example: `const release = api.services.intercept('images.viewed', 'read', (next, request) => next(request));` reaches the actual attachment reader. Disable releases instrumentation without deleting imported image references or translations. Old plugins use identical signatures and surface selectors, so no contract snapshot migration is required. Existing errors include `ACTIVITY_IMAGE_REMOTE_UNAVAILABLE`, `ACTIVITY_IMAGE_SOURCE_UNAVAILABLE`, `ACTIVITY_IMAGE_CHANGED` and translation configuration/policy errors. No private thinking or inline image payload is persisted in activity records.

Evidence: `tests/activity-images.test.ts` tests native-owner local MCP versus genuine remote paths; `tests/translation-module.test.ts` tests manual running commentary and changed-source recovery. `scripts/test-live-message-actions-ui.mjs` loads an approved ZIP, intercepts the real image service, opens thumbnail/full viewer, translates the last commentary during a running turn with automatic intermediate translation off, verifies disable/reenable and full process restart. Synthetic profiles do not touch actual accounts or submit native model work. Source and hidden desktop evidence do not imply an existing foreground executable has been replaced.
<!-- live-message-actions-20261001:end -->

<!-- runtime-usage-20261001:start -->
## Claude completion statistics (2026-10-01 JST)

Pre-implementation interface review: affected state is existing Session.activities with category usage and numeric allowlisted JSON output; renderer consumers are ToolActivity and RuntimeUsage. No command, model prompt, runtime event, counter, persistence format, resource or runtime selector changes. Codex keeps its existing session/metrics footer; no synthetic completion activity is added.

| Capability | Call / read | Register / replace and cleanup | Evidence |
| --- | --- | --- | --- |
| Existing statistics | state/get and onState expose Session.activities; output remains the original numeric JSON | Renderer observeSurfaces('runtime-usage', placement, render) registers a specific multi-instance presentation; replace replaces only the statistics body | tests/usage-presentation.test.ts; scripts/test-runtime-usage-ui.mjs |
| Existing and later statistics bodies | Named runtime-usage selector [data-workbench-runtime-usage]; data-activity-id, data-session-id (when supplied), data-runtime identify the record | before/after/replace share existing SurfaceRenderer({root,target,signal}) lifecycle and returned cleanup; disabling, removing or failing a plugin restores the original node | Same hidden production renderer acceptance |

Claude result.duration_ms and duration_api_ms are distinct durations, num_turns is shown as model calls rather than user messages. Native input_tokens excludes cache counters, so its label is 未缓存输入; cache read and creation are shown separately. Missing/invalid counters are omitted; zero is retained. Corrupt/unknown old output keeps the existing text fallback. Rendering does not modify stored JSON, generate assistant text, call translation, start another model request or add billing records.

Approved renderer package access is required; no extra device or model permission is granted. Use the existing extension approval/activation path. Surface errors and asynchronous cleanup follow the existing renderer lifecycle, with no new error codes. No configurable catalog is introduced: registration here contributes a presentation directly to real mounted/later consumers. Multiple registrations use the existing surface ordering. API v1 remains additive; the named surface snapshot adds only runtime-usage. Old plugins and selectors remain valid, but plugins that inspected the private statistics pre element should use the named surface and state instead.

Example: api.observeSurfaces('runtime-usage','replace',({root,target})=>{ root.textContent='Usage for '+target.dataset.activityId; return ()=>{}; }); Use api.call('state/get') and api.onState for values; do not parse private DOM.

UI preference audit: the existing RuntimeTimeline.details.1 disclosure, scoped by activity ID, remains the only adjustable statistics node; its default, storage, reset and process-restart restoration are unchanged. The body is passive text with no new preference. Window, zoom, layout, tabs and ordering retain their existing owners. No migration or responsive preference rewrite occurs. Official protocol reference and the unverified Claude Desktop wording boundary are recorded in document 07.
<!-- runtime-usage-20261001:end -->

<!-- chat-events-20261001:start -->
## 聊天事件导航与适配诊断（2026-10-01）

本轮接口审查：公开状态为 Session.activities 的 RuntimeActivity（toolName、input、output、status）；分组入口为 renderer api.activities，导航复用现有会话选择回调，复制复用 clipboard/write，原生分类为 nativeEvents.catalog/inspect/register/onReceipt。没有新增运行时、模型或设置选项目录。UI 可调节点沿用 disclosure.open；单条聊天事件取消工具详情层，不新增持久格式。以下矩阵补充现有覆盖矩阵。

| 能力 | 调用 | 注册与替换 | 生产消费与验证 |
| --- | --- | --- | --- |
| 聊天事件识别与目标 | api.activities.chat(activity:Readonly<RuntimeActivity>) → ActivityChat 或 undefined | api.activities.registerChat({id,present}) → {id,dispose}；后注册有效结果优先，可覆盖核心或注册新工具 | 同一个 ActivityGroupingRegistry 同时驱动 ActivityGroups 和 ToolActivity；tests/chat-events.test.ts、scripts/test-chat-events-ui.mjs |
| 单次／多次呈现 | api.activities.group(entries)；chat-event surface 的 data-activity-id、data-target-session-id | observeSurfaces('chat-event', placement, render)，多实例局部替换，停用恢复；既有 activity-group 保持可替换 | 单次聊天直接显示，多次相邻聊天形成独立聊天组，不与命令混组；运行时／回合／子会话边界不变 |
| 会话导航 | navigation/open({sessionId:string}) → Promise<{sessionId:string}>；宿主核实会话仍存在后发送 workbench:navigate，既有 onNavigate 消费并选择会话；未知会话沿用 session 校验错误，无桌面导航适配器时 SESSION_NAVIGATION_UNAVAILABLE | registerChat 可替换目标解析；chat-event surface 可替换局部交互；useHost 包装 navigation/open，actions.openSession 服务可替换导航行为 | 两家原生工具事件、主会话及子会话阅读面板共用；缺失目标不跳转；不触发发送或恢复模型 |
| 诊断复制与原生引用 | nativeEvents.diagnostic(receipt) 与 clipboard/write({text}) → Promise<null> | nativeEvents.register 注册呈现；native-event-notice surface 替换局部展示；useHost 可包装 clipboard/write，desktop.clipboard 服务可替换实现 | NativeEventNotice 等待宿主写入后显示成功，拒绝显示失败并允许重试；tool_reference 按 observed 元数据处理，不据此判定任务完成 |

ActivityChat={label:string,targetSessionId?:string}；ActivityChatRule={id:string,present:(activity:Readonly<RuntimeActivity>)=>ActivityChat|undefined}。label 为非空且至多 100 字符，targetSessionId 为非空、无控制字符且至多 512 字符。局部 id 为既有小写字母／数字／点／连字符格式，完整句柄 owner/id；无效注册或重复分别抛 ACTIVITY_CHAT_RULE_INVALID / ACTIVITY_CHAT_RULE_DUPLICATE。present 同步执行，undefined、异常、无效返回及 Promise 回退较早层或核心，异步迟到结果不应用。subscribe 沿用注册表通知，释放、停用及卸载更新已挂载实例；失效插件 API 拒绝新注册。工具输出只解析完整 JSON 的明确字段，不从任意文本猜 ID，不把收件箱接收标记为模型已读。

```js
const handle = api.activities.registerChat({
  id: 'review-chat',
  present: activity => activity.toolName === 'review_chat'
    ? { label: '查看审阅聊天', targetSessionId: 'existing-session-id' }
    : undefined,
});
const presentation = api.activities.chat(activity);
handle.dispose();
```

兼容：apiVersion 1 增量接口，旧 classify 注册仍控制普通工具；聊天单例不再产生 ActivityGroups.details.1 或 RuntimeTimeline.details.1 的可见 details，旧插件应从私有 summary/pre 层级迁至 chat-event。原始活动记录和已有披露偏好不删除，多次聊天组继续复用首条活动 ID 的原有披露键。tool_reference 历史 unknown 回执通过现有 refreshNativeEventHistory 重分类为 observed，仅更新元数据／状态，不补写正文、不重放工具。剪贴板错误可见，不自动重试。插件批准、owner 范围、权限和宿主错误传播不变，无远端部署或原生客户端修改。

验收位置：tests/chat-events.test.ts、tests/activity-batches.test.ts、tests/native-events.test.ts、tests/native-event-routing.test.ts、scripts/test-chat-events-ui.mjs；后者使用隔离数据目录、真实批准激活的合成插件和隐藏生产 Electron，验证两家事件到导航、键盘、无效目标、复制回读与失败恢复，以及注册／覆盖失败／停用重启用／既有和后来实例。真实用户桌面、SSH 网络与真实模型任务不是本轮证据。
<!-- chat-events-20261001:end -->


## 2026-10-01 Claude SSH native session forks

Interface review and coverage matrix: the existing session/fork-options({sessionId:string,messageId?:string}) inspection and session/fork({sessionId:string,messageId?:string,location?:'workspace'|'worktree'}) -> Promise<Session> now include Claude native-owner SSH bindings. Calls retain the existing state event and Session.branch.native persistence. No public signature, apiVersion, selector directory or contract snapshot changes; semantic compatibility is additive.

| Capability | Call / register / replace | Production consumer and cleanup |
| --- | --- | --- |
| Claude SSH fork | api.call('session/fork', {sessionId, messageId, location:'workspace'}); existing api.registerCommand and api.useHost; named session-fork-action/session-fork-picker surfaces | Controller -> nativeProvider.forkSource -> Claude SSH bootstrap -> owner session launch; plugin disposal releases commands/interceptors/views without removing saved sessions |
| Native transport | Existing actions.native-claude service registration/interception | createTransport consumes the frozen session branch; stop releases SSH and local MCP resources with confirmed remote cleanup |

Approved host capability remains required for host extensions. No new permission is granted. The owner validates account generation, workspace membership, source session ownership, native thread and exact assistant UUID. First explicit input uses native --resume/--fork-session/--resume-session-at/--session-id; subsequent turns resume the child. No displayed-history replay or automatic model submission occurs on fork creation. Source executionSessionId is retained as lineage when a model lane owns a different execution identity.

Errors: NATIVE_FORK_BOUNDARY_UNVERIFIED and NATIVE_FORK_SOURCE_UNVERIFIED reject invalid or foreign sources; CLAUDE_REMOTE_FORK_UNSUPPORTED_OR_MISMATCH rejects old/mismatched remote receipts before user input. Older broker deployments require a separately authorized upgrade; no empty-session fallback. Existing local Claude and Codex paths remain unchanged. Unknown outcomes retain existing cleanup and no-replay behavior.

Verification: tests/claude-fork-usage.test.ts, tests/claude-owner-session.test.ts, tests/claude-mcp-bridge.test.ts and tests/claude-ssh-controller.test.ts cover exact boundary, independent identity, old broker refusal, source protection, approved ZIP command activation, production execution, disable/reenable and nested forks. Existing scripts/test-session-fork-ui.mjs covers mounted/later view instances, multiple extensions, failed registration and late results. No new adjustable UI or resource catalog exists, so new option registration and preference migration are not applicable. Real VPS/native model acceptance remains separate from synthetic protocol tests.


### File reader tab close placement (2026-10-01)

Interface-first review: affected production UI is the shared FileBrowser used by both runtime readers and the remote resource pane. Existing files/browse, files/resolve and remote-files/browse request/return types, file navigation services, file-reader and remote-files named surfaces remain unchanged. This change moves the existing close-all action beside the Files tab; file close removes only that preview, switching tabs keeps their order, and close-all invalidates pending reads and clears preview state before invoking the existing parent visibility owner. Escape uses the same close-all path. Closing the last individual file returns to its directory.

| Capability | Call existing behavior | Register or replace implementation | Production evidence |
| --- | --- | --- | --- |
| File resolution and preview | api.call('files/resolve', {path}) and files/browse retain existing typed results | files.navigation.registerSource with its cleanup handle feeds the actual resolver; existing service interception remains available | scripts/test-file-resolution-ui.mjs: approved ZIP, actual controller and Monaco, both runtime message paths |
| Reader UI and close controls | Existing file-reader named surface and native buttons keep their accessible labels | api.observeSurfaces('file-reader', 'before' or 'replace', render) registers scoped reader UI; dispose/disable restores core UI, including adjacent close controls | Same script exercises approved activation, later mounts, multiple plugins, failed mounts, late cleanup and disable/reenable; scripts/test-file-browser-lifecycle-ui.mjs checks retained mounted instances |

Example: api.observeSurfaces('file-reader', 'before', ({root}) => { root.textContent = 'Reader extension'; }); The existing observer returns a disposal handle and supplies the documented abort signal/cleanup lifecycle. Reader replacement is scoped to the reader, not the application. No new extensible option catalog is introduced, so new option registration is not applicable. No new host command, event, permission, resource format or SDK signature is introduced. Existing host capability approval and browse errors remain unchanged; UI close grants no filesystem or execution authority. Contract snapshot review found no public signature change. Old file-dock and file-reader locators remain valid; header-child CSS selectors for the far-right button were never a public contract and must use the named reader surface.

Approved reader replacement acceptance also found that the reader flex layout overrode the native hidden attribute. FileBrowser.css now honors file-dock[hidden], so replacement actually hides the core reader and disposal restores it.


<!-- runtime-switch-response:start -->
## Runtime switch response and test-only demo (2026-10-01)

Pre-implementation review: affected commands are runtime/choice, runtime/select, session/model-target and model-targets/list; services are models.targets and runtime.native-provider; state is lastSelectedRuntime, lastModelTargetId, lastModelSelection, lastModelHostId and runtimeModelPreferences. Existing state notifications and composer-runtime/composer-model surfaces remain the consumers. No resource, new option catalog or persistent format is added.

| Capability | Call | Register / replace | Production lifecycle |
| --- | --- | --- | --- |
| Resolve destination runtime | runtime/choice({runtime:RuntimeKind,sessionId?:string,hostId?:string}) returns Promise<{target:ModelTarget,selection?:NativeModelSelection}> | api.runtimes.register supplies plugin models; api.services.intercept or override on models.targets.list(refresh:boolean) controls resolution | Uses list(false), without forcing plugin/SSH rediscovery. Owner/readiness, saved destination model and session lane rules remain enforced; RUNTIME_MODEL_UNAVAILABLE is unchanged. Explicit model-targets/list({refresh:true}) remains the discovery path. |
| Select and persist | runtime/select and session/model-target retain their arguments, result state/session and state events | Registered runtimes reach selector and execution; useHost wraps commands; composer-runtime and composer-model are named multi-instance replacement surfaces | Selector immediately displays destination plus pending state. Send, permissions and model changes wait for resolution. Failure restores the current identity; leaving the draft fences late results. Disable/reenable preserves saved plugin IDs. |
| Internal offline fixtures | Existing demo.sample/get, session/create({runtime:'demo'}) and direct test protocols remain available | Existing host middleware and demo services remain unchanged | No demo selector option or sample-loading button in the shipped workspace. A fresh or legacy demo draft presents an unselected runtime and cannot submit until a real runtime is selected. Existing historical records are retained. |

Example: const choice = await api.call('runtime/choice', {runtime:'claude'}); await api.call('runtime/select', {runtime:choice.target.runtime,targetId:choice.target.id,selection:choice.selection}); Use await api.call('model-targets/list', {refresh:true}) only for explicit discovery. A trusted extension can intercept models.targets.list via api.services.intercept('models.targets','list',(next,refresh)=>next(refresh)); cleanup removes its layer on disable/unload. Approval and permissions remain unchanged; selection does not grant execution or start model turns. No public signature/surface changes, so the contract snapshot is unchanged after semantic/lifecycle review. Private DOM selectors for the removed demo button have no replacement; test fixtures should use the existing protocol.

Tests: tests/model-target-catalog.test.ts covers both SSH catalog readers, explicit refresh, approved interception and disable. tests/runtime-extensions.test.ts covers registration failures, coexisting layers and late discovery. scripts/test-runtime-switch-ui.mjs uses approved synthetic adapters in hidden production Electron for both native selectors, pending/failure/navigation fencing, restart, and registered-runtime disable/reenable/new instances. No actual SSH latency, paid model run, user desktop or deployment claim.
<!-- runtime-switch-response:end -->

<!-- claude-card-controls-20261001:start -->
## Shared official quota cards and account enable scopes (2026-10-01 JST)

This revision supersedes the earlier remote Claude no-quota placeholder. Local and SSH cards consume AccountQuotaSummary, AccountQuotaWindows, AccountResetCards and ModelUsageSummary. Authenticated SSH cards no longer mount NativeAccountState, metadata disclosure, login-command copying or browser login tools; new login stays in the provider dialog. Existing model-account-card, model-account-quota and model-usage surfaces remain the supported replacement points. The legacy native-account-state surface remains available only where that component is still mounted for recovery; plugins targeting logged-in cards must migrate to the named account surfaces. Internal component imports and arbitrary selectors are not a public replacement contract.

| Capability | Call / production consumer | Register / replace / lifecycle |
| --- | --- | --- |
| Account enable | accounts/set-enabled({id,accountId,accountGeneration,expectedRevision,enabled}) -> Promise<AccountCatalog>; RemoteAccountCard header and runtime selection consume refreshed catalogs | accounts.catalog.setEnabled(host,input) is a typed production service; approved intercept/override registrations are disposed normally; no new extensible option directory |
| Enable receipt | SharedAccount.enabled/accessRevision and workspaceEnabled/workspaceAccessRevision are optional additive fields | Missing legacy fields mean true/0; unsupported old brokers reject mutation, never emulate a local switch |
| Quota read | accounts/usage({id,accountId}) now accepts both native providers and returns AccountUsage; models/accounts/refresh remains the local call | actions.account-usage.read and models.accounts.call are existing replaceable services; model-account-quota supports current/later instances and disposal |
| Reset cards | Existing accounts/reset-preview/reset-redeem and models/accounts/reset-preview/reset-redeem contracts retain immutable preview and explicit confirm:true | Shared visual component; admin-only SSH redemption, original request recovery and no automatic retry/new redemption remain enforced |

The broker account/set-enabled validates authority, account generation, caller membership and the relevant expected revision. Root changes the global flag; a member changes only its own workspace preference. Effective availability requires both flags plus existing assignment/runtime permissions. Disabled cards remain manageable; selectedSharedAccount, controller admission and native runtime authorize reject disabled execution. Existing active connections recheck authorization on native traffic. Reenable preserves each workspace's preference and native authentication. Concurrent changes reject stale revisions. The broker registry persists flags and per-generation workspace preferences; restart validates them, and account identity replacement does not inherit a retired generation's workspace preference. Sibling catalogs are refreshed through each host's own membership, never by copying an administrator catalog.

Claude quota comes only from validated native rate_limit_event/rate_limits observations on the official stream. The broker persists allowlisted numeric windows under authority/account-generation identity and serves them through runtime/usage without launching a model or reading credentials. Missing windows stay visibly labeled 5h/Weekly with no fabricated percent; elapsed reset receipts are displayed as unknown. Persistence failure does not terminate the native turn and subsequent reads report unavailable until a valid observation is saved. Claude polling while an expanded card is mounted reads these saved receipts only; collapse/unmount releases the timer. This is not a promise that every CLI version emits both windows. Claude reset-card enumeration/redemption is still unsupported by the verified native contract; UI explicitly reports that limit rather than creating a working-looking redemption button.

No new theme/provider/runtime/profile directory is added, so new-option registration is not applicable. Existing named surfaces, preference registration and service replacement provide the relevant call/register/replace dimensions. Plugins must preserve broker authority, independent scope and confirmation semantics. Example: api.call('accounts/set-enabled',{id:hostId,accountId,accountGeneration,expectedRevision,enabled:false}); an approved api.services.intercept('accounts.catalog','setEnabled',handler) observes or replaces the real consumer and releases via api.onDispose. Errors cover unavailable service, stale authority/revision, unassigned account and malformed receipt; writes are not silently retried. State updates publish the reread catalog.

Evidence: tests/claude-account-controls.test.ts exercises actual broker persistence, two memberships, stale writes, execution authorization, generation isolation, receipt reload and an approved ZIP activation/interception/disable/reenable cycle through the controller. tests/account-usage.test.ts covers reset permissions, nonconsumption, uncertainty and original-request recovery. scripts/test-remote-account-dialog-ui.mjs mounts real local/SSH components in hidden Electron, compares both quota windows, removes legacy controls, changes both scopes, checks reset confirmation/cancellation and restarts preferences. Existing snapshot fields are additive; no user profile, real login, remote deployment or release acceptance is inferred.
<!-- claude-card-controls-20261001:end -->

## 2026-10-01: Server-timed one-use workspace export

| Capability | Call | Register / replace | Production consumer and cleanup |
| --- | --- | --- | --- |
| Export authorization duration | `studio/export-managed({id,workspaceId,ttlSeconds?})`, `studio/export-connection({id,memberId,ttlSeconds?})` | Register a namespaced backend with `api.services.register(id, backend, {version:1})`, then override the existing `actions.workspace-management.exportManaged` / `exportConnection` methods | Controller validates duration before invoking the live service; service disposal and override cleanup retain the existing lifecycle |
| Duration editor | `WorkspaceExportDuration` submits the same typed duration parameter through existing export commands | `api.observeSurfaces('workspace-export-duration','replace', render)` supplies a local editor implementation with cleanup, including later dialogs | Both the global export dialog and workspace detail export dialog use the named surface; legacy invite editor shares it |
| Import expiry | Existing `studio/import-preview`, `studio/import` and `workspace-import` surface | Existing management backend registration/overrides and named import surface remain applicable | Host and renderer no longer reject a server deadline using the device clock; actual server redemption remains authoritative |

Public service signatures are `exportManaged(host:SshHost,workspaceId:string,ttlSeconds?:number)` and `exportConnection(admin:SshHost,member:SshHost,ttlSeconds?:number)`. Results remain `{saved:boolean,path?:string,expiresAt?:string}`; cancellation returns `{saved:false}`. No new event is emitted; existing command completion and snapshot refresh remain the observation path. `ttlSeconds` defaults to 3600 and accepts only 3600, 21600, 43200, 86400 or 604800. Unsupported values fail before opening a save dialog or invoking a plugin backend. Administrator/member binding, host pins, exclusivity, shutdown and stale-connection checks remain mandatory. No renderer receives bootstrap keys.

These five values are a closed authorization policy, not an extensible theme/model catalog. Registering additional durations is intentionally inapplicable: a display registration cannot authorize an unsupported lifetime on the server. Plugins can register and substitute the export implementation or duration editor, but core commands retain this policy. Other implementations must preserve one-use authorization and server time semantics; full-package host approval is required. Example:

```js
export function activate(api) {
  const registration = api.services.register('example.workspace-export', {
    exportManaged: (host, workspaceId, ttlSeconds = 3600) =>
      approvedBackend.exportManaged(host, workspaceId, ttlSeconds),
  }, {version: 1});
  const backend = api.services.get('example.workspace-export');
  const override = api.services.override('actions.workspace-management', {
    exportManaged: (host, workspaceId, ttlSeconds) =>
      backend.exportManaged(host, workspaceId, ttlSeconds),
  });
  return () => { override(); registration(); };
}
```

The example assumes an extension-owned `approvedBackend`; it does not grant new remote privileges. See `scripts/test-workspace-export-ui.mjs` for a complete synthetic backend installed, approved and activated through the real plugin lifecycle.

SSH preparation now receives relative `ttlSeconds`, computes `issuedAtEpoch` and `expiresAtEpoch` on the VPS, and returns both for host validation. The forced command and OpenSSH UTC `expiry-time` share that deadline. Redemption rechecks expiry after acquiring the key-file lock, and atomically replaces the single bootstrap authorization. Copies cannot authorize another identity. Existing successful exact-key recovery remains available after expiry; it is not a second grant. Display timestamps use the reader's local timezone and explicitly say so; neither desktop clock determines validity. Changing the issuing server clock itself is outside the device-skew guarantee.

Compatibility: version-1 files remain readable without rewrite; old files keep their original server deadline, never get an extension from import. Existing callers omitting duration retain 1h. Old JavaScript overrides accepting two arguments still load, but must accept the third argument to honor nondefault durations. Legacy HTTP invitation creation keeps its existing 60-second minimum and gains a 604800-second maximum in the bundled control service; older separately deployed HTTP services may reject 7day until explicitly updated. No remote deployment is implied. Core SSH preparation carries its own updated script. Contract snapshot changes only add the named surface. Private selectors should migrate to `workspace-export-duration`; existing `workspace-import` is unchanged.

UI state: duration, selected member and open modal are transaction inputs, reset for each new export and after process restart; they are not preferences. No profile key, persisted schema, shipped window default or migration is added. Closing/cancelling never authorizes. Rebuild/update cannot replay the transaction. Existing shared profile restoration remains unchanged.

Evidence: `tests/workspace-export-expiry.test.ts`, `tests/portable-workspace.test.ts`, `tests/workspace-enrollment.test.ts`, workspace controller/client/control regressions and `scripts/test-workspace-export-ui.mjs`. The latter exercises all five values through a registered approved backend, invalid input, mounted/later surface replacement, disable/reenable, full process restart, narrow light/dark layout and authoritative import errors. Core tests cover copies, one-use behavior, original-key recovery, server expiry boundary and client clocks far ahead/behind. Existing surface lifecycle suites cover multi-plugin ownership, async late results, failed activation and cleanup. No real SSH, model request or currently running user desktop acceptance is claimed; the authorization is provider-independent and applies equally to Codex and Claude member connections.

<!-- claude-active-quota:start -->
## Active Claude quota acquisition (2026-10-01)

Interface review and coverage matrix:

| Capability | Call and production consumer | Registration / replacement / lifecycle |
| --- | --- | --- |
| SSH quota | `accounts/usage({id, accountId}) -> AccountUsage`; `actions.account-usage.read(host,catalog,id)` calls broker `runtime/usage` and projects native `get_usage` | Existing typed service interception replaces `read`; approved ZIP test invokes the host command and verifies disable/re-enable restoration |
| Local quota | `models/accounts/refresh` -> `models.accounts.call` -> official transport inspection, same native control request | Existing account service interception; provider registration is unchanged because no provider or option is introduced |
| Card rendering | Existing `model-account-quota`, `model-account-card` surfaces consume `AccountUsage` | Existing multi-instance surface lifecycle remains; no DOM/selector migration or new UI registration |

Before implementation, review covered host commands, services, native events, account state, quota surfaces and bundle resources. No public signature, selector, event name, preference or persistent account schema changes; contract snapshot remains unchanged. An ephemeral native metadata process sends `initialize`, then `get_usage` with `skip_behaviors:true`, never a model/user message. Only numeric windows and observation time cross the remote boundary; no native session/behavior data or credentials are stored by this query. Existing CLI maintenance leases, shutdown tracking, output bounds, 20-second deadline and confirmed cleanup apply. The native response uses percentage utilization and ISO reset timestamps; malformed/missing replies do not reuse passive cached data as a fresh read.

Permissions: existing administrator or authorized workspace quota reads, including disabled accounts, with generation and membership rechecked after reply. Workspace redemption remains forbidden; administrator Codex redemption still requires the existing second confirmation. Claude `get_usage` declares no reset-card capability. Errors include `CLAUDE_QUOTA_QUERY_UNSUPPORTED`, `CLAUDE_QUOTA_QUERY_FAILED`, `CLAUDE_QUOTA_RESPONSE_INVALID`; old installed CLIs may require updating. No CLI is automatically installed/updated and no remote deployment occurs. Remote configuration bundle revision advances with its source digest.

Example: `await api.call('accounts/usage', {id: 'host-id', accountId: 'account-id'})`; a host-capable approved plugin can use `api.onDispose(api.services.intercept('actions.account-usage', 'read', (next, ...args) => next(...args)))`. Tests: `tests/claude-account-controls.test.ts` (real approved ZIP activation, production service forwarding, disable/re-enable), `tests/claude-remote-catalog.test.ts` (request sequence, percent/date projection, no prompt, permission revocation, unsupported/malformed cleanup), `tests/model-accounts-native.test.ts` (local transport). Existing card surfaces and reset confirmation tests remain applicable. New option registration, new preference migration and multi-plugin ordering changes are not applicable: no new catalog, persisted choice or interceptor semantics were introduced. Live account/network results remain unverified.
<!-- claude-active-quota:end -->
## SSH account quota and model catalog cache (2026-10-01)

### Historical workspace attribution repair (2026-10-02)

`actions.quota-accounting.read(host,catalog,usage,refresh?)` now replays only numeric, verified `modelUsage` receipts whose session retains the same native account, host, runtime and workspace binding. It sends bounded `{scope,tokens,baselineTokens,resetsAt}` history records through the existing `quota/observe` service; the authority deduplicates scope cursors and never treats old history as a fresh provider percentage sample. Missing or ambiguous bindings remain unassigned. The first ledger refresh upgrades old proportional baselines to full account shares without changing existing debts or settled workspace consumption, and sets `attributionVersion:2` for idempotence. The account-wide native window remains distinct from workspace attribution, so an unused workspace does not inherit another workspace's history. `QuotaLedgerView` continues to expose signed balances, token totals, debts and `coverage:'workbench-observed'`; history-derived totals are evidence of local observed usage, not an official provider bill.

The member card resolves the authoritative `workspaceId` and allocation through `quota/context`; it does not infer a member card from the administrator account list. Unmanaged members remain usable and show no fabricated allocation. The public service and plugin surface signatures are unchanged; lifecycle disposal, SSH membership checks, account generation checks and existing plugin replacement hooks remain in force. Tests: `tests/quota-coordinator.test.ts`, `tests/quota-allocation.test.ts`, `tests/workspace-control.test.ts`, and the approved account allocation UI exercise. Recovery evidence is limited to numeric receipts; prompts, credentials and raw provider frames are excluded.

Additional history contract: authority receipts advertise historyVersion:1 before numeric recovery is sent. Each history item has scope:string, tokens:integer, baselineTokens:integer and resetsAt:number; batches are limited to 100 and existing 4096 cursor limits still apply. Errors use INVALID_QUOTA_OBSERVATION, QUOTA_ACCOUNT_NOT_ALLOWED or REGISTRY_FULL, with no renderer write endpoint. The socket binds each item to the authenticated member namespace. Window fields baselineAt, recoveredTokens and recoveredPercent are optional/additive; older plugins continue receiving the existing balances and tokenTotals fields. Estimated recovered percentage is capped by the original provider baseline and never created without aligned samples. The account exhaustion gate remains independent. Third parties call accounts/usage, register an approved service implementation through the existing service registry, intercept actions.quota-accounting.read/begin/observe/finish for replacement, or replace account-allocations through the named multi-instance surface. No new option catalog or resource is introduced, so option registration and resource migration are inapplicable. Existing disable/reenable and async surface cleanup remain authoritative; public method signatures and the declared snapshot are unchanged. History replay and identity context are shared by Codex and Claude. Permissions remain member SSH identity or administrator reads; unsupported authorities return existing views plus a visible history warning. Numeric replay does not submit model turns. Retained bindings are required: deleted or ambiguous sessions are deliberately not guessed. Tests cover these boundaries; a local fixture does not establish remote deployment or real-account acceptance.

Interface inventory and coverage matrix:

| Capability | Call / production consumer | Register / replace / cleanup |
| --- | --- | --- |
| Official quota receipt | `accounts/usage({id,accountId,refresh?:boolean,cacheOnly?:boolean}) -> AccountUsage`; `actions.account-usage.read(host,catalog,id,options?)`, options additionally include host-derived usage `revision` | Approved service interception on `actions.account-usage.read` changes the receipt reaching real cards; plugin-owned services may provide the implementation and disposal restores core reads |
| Allocation ledger | `actions.quota-accounting.read(host,catalog,usage,refresh?) -> QuotaLedgerView | undefined`; same account command carries `usage.ledger` | Named service interception supplies replacement numeric views; registered backends retain kernel membership/admin checks; disposal releases overrides |
| Model directory | `model-targets/list({refresh?})`, `runtime/models`; `models.targets.list(refresh)` consumes actual remote catalog and independent execution readiness | Existing runtime registry admits new runtimes; `actions.native-accounts.models` and `models.targets` replacements reach production selection; lifecycle cleanup restores core |
| Allocation presentation | Named `account-allocations` surface, instances carry `data-account-id`; existing `model-account-quota` and `model-account-card` unchanged | `api.observeSurfaces('account-allocations','replace',({root,target,signal})=>cleanup)` covers current/later cards; deactivate releases all instances and restores core |

No new selectable option or preference is introduced. Events remain existing state/usage revisions. Cache-only reads perform no SSH and hydrate the last successful receipt. Normal command reads reuse it until usage revision changes or its deadline elapses; explicit refresh requests the native reader. Failed/unsupported refresh retains prior values and observation time with a visible reason. No prior receipt means unknown, never zero. The typed service's legacy three-argument call retains an active read; command defaults intentionally change to cache-first. In-flight reads coalesce by verified connection/account identity. Version-1 quota receipt files use hashed identity keys and atomic writes; invalid files remain preserved, errors are surfaced, and no credential is stored. Confirmed Codex redemption invalidates the saved receipt; failed redemption cannot authorize another reset. Workspace reset use remains forbidden; administrator use still requires the second confirmation. Claude reset-card rows are omitted.

`QuotaLedgerView` adds optional allocations, currentWorkspaceId and tokenTotals; each window adds reserveUsed/overdrafts. Signed balances are accepted; old receipts remain readable with missing fields shown as unknown, not a fabricated allocation. Percent bars divide signed remaining account percentage by the assigned share, clamp visually to 0–100, and retain negative numeric labels. Debt source labels use account percentage points and preserve individual lenders across cycles. Zero allocation has no finite percentage denominator; signed account remainder still displays. Live allocation edits preserve consumption/debt and recalculate inventory without creating lendable quota from deficits. Older deployed quota authorities need an explicitly authorized update for these fields and reallocation semantics; source changes do not deploy them. Token totals include only newly observed deltas, not pre-existing cumulative history.

Claude native sends now call the existing quota begin/check/observe/finish service before model submission and after owned process cleanup, including cancellation. Only native root result numeric token receipts are reported, scoped to the explicit submission; no renderer quota-write command is added. Missing/unmanaged quota policy retains prior behavior, denied allocation blocks submission, unknown results do not automatically replay a model request, failed reporting retains the numeric outbox. Administrator provider windows are account-wide; the existing token summary is local recorded activity and the ledger reports only workbench observations from participating spaces.

SSH catalog discovery runs on first ordinary access, coalesces concurrent requests and retains the last directory after transient refresh failure. Connection/authority/account changes reject late results. Confirmed unsupported execution status removes readiness without erasing model metadata. Model selection remains stored by the existing runtime preference owner; a directory is not execution authorization.

Examples: `await api.call('accounts/usage',{id:'host-id',accountId:'account-id',cacheOnly:true})`; `api.onDispose(api.services.intercept('actions.account-usage','read',(next,...args)=>next(...args)))`; `api.observeSurfaces('account-allocations','after',({root})=>{root.textContent='Extension allocation view';})`. Tests: account-usage, model-target-catalog, claude-ssh-controller, claude-account-controls, quota-coordinator and workspace-control suites; `scripts/test-remote-account-dialog-ui.mjs` uses a real approved synthetic ZIP with the production allocation surface and core cards. Existing surface lifecycle coverage owns multi-plugin ordering, asynchronous cancellation and activation-failure recovery. Snapshot review adds only the named allocation surface; no existing surface or method is removed. Synthetic profiles and plugins are isolated from real users.

Workspace allocation now uses weekly quota only. Official account five-hour windows remain visible. Legacy fiveHourPercent fields and stored history remain readable but do not drive allocation accounting or admission; new administrator edits clear that legacy allocation. Confirmed weekly reset restores cycle shares, clears current reserve/overdraft usage and repays each original lender, carrying unpaid debt. Multiple account cards fill rows horizontally before wrapping; responsive wrapping adds no preference and retains existing disclosure keys. Existing named card/allocation surfaces remain the replacement interface.

<!-- desktop-updates-20261001:start -->
## Desktop push-triggered updates (2026-10-01)

| Capability | Call existing behavior | Register implementation | Replace behavior | Lifecycle and evidence |
| --- | --- | --- | --- | --- |
| Desktop update/download/install | `desktop-updates/status`, `desktop-updates/check`, `desktop-updates/install` | `desktop.updates.register(DesktopUpdateRegistration)` | `services.override('desktop.updates', members)`; named `desktop-update` renderer surface | Production timer, checker and click handler use this service; tests/desktop-updates.test.ts loads approved ZIPs and verifies disable/reenable and failed activation |

The service exposes the typed `DesktopUpdatesApi` from packages/desktop-updates/index.ts: snapshot(): DesktopUpdateState, check(): Promise<DesktopUpdateState>, install(): Promise<void>, subscribe(listener): cleanup, register({id,create}): cleanup. Backend IDs use `plugin:<plugin-id>/<name>`; the last live registration wins. Removing an inactive layer leaves the active layer unchanged; removing the active layer restores the previous backend. Factories must implement check/install/subscribe/dispose. Use `api.onDispose(service.register(...))` so failed activation, disable and uninstall release the backend. Subscribe cleanup and disposal suppress obsolete events. Host plugins are package-approved full-trust code; this does not grant remote or administrator access. Native Codex/Claude plugins are not loaded here.

The three commands take no parameters; status/check return phase, optional version, percent and fixed error. Install returns no value and may restart the application. Events use `PluginHostEvent` with type=plugin, id=workbench.updates, topic=changed and a DesktopUpdateState payload. Errors include DESKTOP_UPDATE_NOT_READY, DESKTOP_UPDATE_SESSION_BUSY, DESKTOP_UPDATE_REGISTRATION_INVALID, DESKTOP_UPDATE_CHECK_FAILED, DESKTOP_UPDATE_DOWNLOAD_FAILED and DESKTOP_UPDATE_INSTALL_FAILED. No raw network errors or credentials enter the renderer. The installer action is explicit and task-gated; development mode disables the native backend's automatic checks and installation.

Example: `const updates=api.services.get('desktop.updates'); const off=updates.subscribe(state=>{/* observe phase */}); api.onDispose(off); await api.call('desktop-updates/check');` An alternative backend registers `{id:'plugin:'+api.id+'/source',create:()=>backend}` and owns its network/download resources until dispose. UI extensions use `api.observeSurfaces('desktop-update','replace',render)`; existing and later instances follow the shared renderer cleanup contract. Core restoration does not change user profile values.

Compatibility: these are additive methods/service/surface; existing surfaces and settings selectors remain unchanged. No runtime/provider/model option is added. Update source registration affects execution, not a cosmetic selector; core distribution has one reviewed feed. Download progress and update availability are derived operational state, not adjustable preferences. Existing profile and window restoration owners remain authoritative. Installer location is a shipped per-user default, never copied from a developer profile. Detailed package/trust limits and verification commands are in document 38. Contract snapshots must include the new interfaces, surface and three host methods; tests do not certify hosted or installed-package behavior.
<!-- desktop-updates-20261001:end -->

### Local repair packages and short program paths (2026-10-02)

| Affected behavior | Call | Register | Replace and restore | Evidence |
|---|---|---|---|---|
| Local package update eligibility | Existing `desktop-updates/status/check/install` commands and `DesktopUpdatesApi` | Existing `desktop.updates.register({id,create})` typed backend with cleanup | Existing `desktop.updates` service replacement and `desktop-update` surface; disposal/late-event rules unchanged | `tests/desktop-updates.test.ts`; installed package restart |
| Installer artifact filename | `npm run package:windows` and `scripts/build-bootstrap.ps1` emit `<version>.exe` in their respective output directories | Build-time package version; no runtime option catalog because installation precedes the plugin host | Build configuration and script own filenames; runtime update service replacement is unchanged | Actual NSIS artifact/manifest checksum and isolated bootstrap compilation; invalid version rejection |
| Published installer entry | Public `/releases/latest` serves the current versioned full installer; `prepare-update-site.mjs` emits the same link | This external download link is build-time distribution metadata, not a runtime option catalog | Existing `desktop.updates` backend replacement remains available; no installed service signature changes | Generated site link, release asset digest, NSIS directory selection, and existing updater/plugin lifecycle tests |
| Program and data defaults | NSIS directory picker and `/D`; existing `desktop/data-directory` commands | Existing `desktop.data-directory` service and approved surface registrations | `services.override('desktop.data-directory', members)` and `data-directory-settings`; release-time NSIS include | `scripts/test-installer-paths.mjs`, `tests/app-data-relocation.test.ts`, `scripts/test-data-directory-ui.mjs` |

Interface review: no new command, event, selector, UI mount, preference schema or API-v1 signature. `package.json.workbenchDistribution` is immutable package metadata: only `release` enables the public update channel in a packaged Windows application without a test profile. Local, missing and unknown markers retain the existing disabled state; check performs no download and install returns `DESKTOP_UPDATE_NOT_READY`. CI assigns `release` when producing the publication candidate. This prevents locally built repairs from being replaced by older source with a higher published version. It does not alter user credentials or stored preferences. Backend registration retains its typed cleanup and package approval lifecycle and cannot bypass package eligibility. This build identity is not a selectable runtime provider or plugin option catalog. Plugin runtime registration cannot run before installation, so the installer default is configured by the versioned NSIS include; profile operations still use the named production service.

Fresh per-user programs use `%LOCALAPPDATA%\AgentWorkbenchApp`; profile data remains `%LOCALAPPDATA%\AgentWorkbench`. Registered install locations and explicit `/D` remain authoritative; the picker permits another program directory. The per-user mode page preserves the resolved location and a revisited picker choice. Binaries never select an empty profile or merge competing trees; existing data locators remain authoritative. The packaged installer artifact and `latest.yml` entry are `<version>.exe`. `prepare-update-site.mjs` publishes matching `bootstrap-v2.json` for new online installers and a checksum-identical old-name alias with `bootstrap.json` for already distributed bootstrap clients. This changes no plugin command, parameter, result, event, error, permission or lifecycle; the installed updater and data-directory services retain their existing call/register/replace and cleanup paths. Explicit update installation, busy fences and preference flushes remain. No remote or administrator permission is added. Public declarations and contract snapshots remain unchanged. Source, isolated plugin/installer checks and installed-profile recovery are separate evidence layers.

Installer filename follow-up (2026-10-02): `scripts/build-bootstrap.ps1` is the build entry point for the online installer and now emits `build/bootstrap/<version>.exe`, with the numeric version read from `package.json`. Invalid versions fail before compilation; compilation failures remain terminating errors. Like the NSIS artifact name, this build output exists before any plugin host can load: runtime invocation, option registration and implementation replacement do not apply to its filename. The existing `desktop.updates` call/register/replace contract, approved activation/cleanup, permissions, events and compatibility snapshot are unchanged. No persistent or transient UI choice is added. Verification is an actual isolated bootstrap compilation and output filename inspection, plus the existing `tests/desktop-updates.test.ts` approved-plugin lifecycle and repository gates. Published legacy bootstrap filenames and compatibility feed aliases remain supported until a separately authorized release.

## Native CLI and installer diagnostics (2026-10-01)

Interface review: `native.cli` remains the approved host service for `list`, `check`, `configure`, `install` and `uninstall`; `local-cli/list`, `local-cli/check`, `local-cli/install`, `local-cli/configure` and `local-cli/uninstall` remain the public commands. Existing parameters and return shapes are unchanged. A plugin can call these methods, register an alternate approved host command, or override `native.cli` with service cleanup; the production CLI settings page reads the real command result. No new provider, selector, adjustable UI node or persistence key is introduced. The installer stage label is transient product state; no UI preference migration is needed.

Failed native commands now classify a bounded diagnostic stream into `CLI_INSTALL_DOWNLOAD_FAILED`, `CLI_INSTALL_CHECKSUM_FAILED`, `CLI_INSTALL_PLATFORM_UNSUPPORTED`, `CLI_INSTALL_PERMISSION_DENIED` or the existing `CLI_COMMAND_FAILED`. These fixed codes appear in `LocalCli.error` and command rejection. Raw official output, URLs with credentials and local paths do not become plugin events, UI text or persisted data. An unrecognized failure is explicitly unknown, not automatically labeled a network failure. Existing plugins receiving `CLI_COMMAND_FAILED` should accept the additional codes; the API version and command signatures are unchanged. Installation still requires an explicit user action, uses the original official channel, and retains the runtime-specific maintenance lock and idle-session gate. CLI status is re-read after failure, process restart or external installation. Example: `try { await api.call('local-cli/install',{runtime:'claude',installMethod:'native'}); } catch { const items=await api.call('local-cli/list'); /* inspect the fixed error code */ }`.

2026-10-02 follow-up: the same bounded `native.cli.install(runtime,update?,automatic?,requestedMethod?) -> Promise<LocalCli[]>` and `local-cli/install({runtime,update?,installMethod?}) -> LocalCli[]` production paths now classify explicit Git Bash prerequisite, proxy authentication, TLS/certificate and native setup exit markers as `CLI_INSTALL_GIT_BASH_REQUIRED`, `CLI_INSTALL_PROXY_AUTH_REQUIRED`, `CLI_INSTALL_TLS_FAILED` and `CLI_INSTALL_NATIVE_SETUP_FAILED`. The existing renderer error map consumes these codes after the real command; it does not persist raw installer output. Generic `CLI_COMMAND_FAILED` remains for unknown failures. The selected native Windows installer remains independent of Node/npm, which is only an optional method. Callers can register/intercept/replace `native.cli` under the existing approved package lifecycle; the `local-cli-row` surface replaces mounted and later rows, with disable/reenable restoring the core view. No new selector, event, command signature, permission, persistence field or snapshot declaration is added; existing plugins should handle the additive error codes. Failed operations retain the maintenance lock until their child exits, then reread actual installation state; no automatic channel fallback or retry occurs. `tests/native-cli-methods.test.ts` covers fixed-code process output and both native channels in isolated profiles. This source check does not identify the unreported failure on a different device or install anything there.

Desktop update backend disposal suppresses late events and cancels a pending download as soon as its token becomes available. The existing `desktop.updates.register({id,create})` cleanup contract, timer, `desktop-updates/status/check/install` commands, `workbench.updates/changed` event and named `desktop-update` surface are unchanged. Replacement still restores the core backend after disable or activation failure. Tests: `tests/native-cli-methods.test.ts`, `tests/desktop-updates.test.ts`; package compile: `scripts/build-bootstrap.ps1`. This changes failure semantics only, with no contract snapshot signature change. It does not establish the cause of an earlier failed native installation or modify an already installed client.

Publication and recovery review: the push-triggered Windows build now completes the same serial plugin contract suite and approved recovery UI exercise before creating deployable artifacts. `plugin-recovery-process` still checks descendant PID and creation identity before termination; its bounded Windows enumeration and stop deadlines are 30 seconds, with a 45-second guardian startup deadline and 90-second recovery action response deadline. `recovery/*` commands, safe-mode state, events and named recovery surfaces are unchanged; plugin registration/disable and failure cleanup behavior remain covered by `tests/plugin-recovery-process.test.ts`, `tests/plugin-recovery.test.ts` and `scripts/test-plugin-recovery-ui.mjs`. The quota preview retains the existing `quota.allocate` effect descriptor and `localizeControlEffect` call signature; it now displays `fiveHourPercent` as legacy information, without changing the weekly-only allocation executor. `tests/quota-allocation.test.ts` covers this presentation. No option registry, selector, persistence key or contract snapshot signature changes; registered UI replacements continue to receive the same effect descriptor and dispose through their existing handles.

<!-- streaming-media-repair-20261002:start -->
## Streaming interaction, viewed images and Windows links (2026-10-02)

Interface audit covers state/get and existing state notifications; native.event-semantics, runtime.native-provider and runtime.codex; attachments/activity-images and images.viewed; api.markdown; files/resolve and files/open; activity-group, turn-process, runtime-image-log and file-link surfaces. There are no new selectable options, permissions, packaged resources or persistent configuration fields. The following rows extend the feature coverage matrix.

| Capability | Call and production consumer | Register, replace and release | Evidence |
| --- | --- | --- | --- |
| Streaming public text | NativeEventSemantics.batchWindowMs(): number on native.event-semantics; both native runners consume it before persisting public deltas | Register a namespaced typed policy with services.register and intercept/override batchWindowMs; disposal restores the previous service. Each new text batch captures the current policy, with 32 ms default, 100 ms cap and zero/nonfinite disabling the wait. Completion, tool and other queued barriers drain pending text first. | tests/native-preparation.test.ts uses an imported, approved, activated ZIP against local Codex, local Claude and SSH Claude; tests/native-bridge-controller.test.ts covers SSH Codex ordering and terminal drain |
| Viewed-image snapshots | attachments/activity-images({sessionId,activityId}): Promise<AttachmentView[]> -> images.viewed.read(ActivityImageRequest); runtime-image-log reads only when expanded | Existing typed images.viewed service supports approved registration/intercept/override for verified sources. Existing attachment actions register activity options; observeSurfaces('runtime-image-log',...) replaces each current/later instance and releases on disable. No caller-supplied arbitrary path is accepted by the command. | tests/activity-images.test.ts; scripts/test-streaming-workspace-ui.mjs |
| Windows Markdown links | api.markdown.tokens(source): TokensList retains native drive-path separators in inline, image and reference destinations; api.markdown.link(href,label) returns the same LinkedText/FileReference | Existing file-resolution provider registration controls destination lookup; named file-link/file-reader surfaces provide local replacement with cleanup. No protocol or parser-option catalog is added. | tests/message-markdown.test.ts; tests/file-navigation.test.ts; scripts/test-message-file-links-ui.mjs; scripts/test-streaming-workspace-ui.mjs |
| Timeline rendering and disclosure | Existing state subscriptions, api.activities registration and api.uiPreferences get/set/reset/override feed the same production components | Unchanged state branches and Markdown tokens are reused inside the renderer; collapsed activity bodies mount on demand. Named activity-group/turn-process surfaces remain the extension contract; later body mounts and removal invoke the existing surface lifecycle. | tests/renderer-state-sharing.test.ts; tests/ui-preferences.test.ts; scripts/test-activity-preference-ui.mjs |

Viewed-image semantics supersede the earlier source-only behavior: relative paths resolve against activity.cwd or the bound session projectPath. Local preview no longer uses a profile-directory exception, directory denylist or workspace containment rule. Remote paths remain unavailable; the previously verified SSH Claude local-device MCP Read exception remains. Network/device/alternate-stream paths and hard links remain rejected; ordinary local symlinks resolve to readable sources and snapshot consistency is verified. Existing size limits apply. First successful display creates a managed local snapshot; later reads and process restart reuse its ID and verify snapshot integrity even if the source is removed. Old source-backed records retain their integrity checks. Only attachment metadata enters viewedAttachments/state notifications; thumbnails are an on-demand IPC result, never message text or an automatic model attachment. Missing files before first successful preview remain unavailable.

Errors retain ACTIVITY_IMAGE_REQUEST_INVALID, ACTIVITY_IMAGE_NOT_FOUND, ACTIVITY_IMAGE_REMOTE_UNAVAILABLE, ACTIVITY_IMAGE_SOURCE_UNAVAILABLE and ACTIVITY_IMAGE_CHANGED; protected path-name classification was removed; ordinary I/O and integrity errors remain visible. Concurrent reads coalesce, changed binding/path rejects late publication, and transient retry/loading/error state does not persist. No automatic model turn, continuation or remote read is introduced.

Example inside approved activate(api): register a namespaced policy with services.register('plugin:example/stream-policy',{batchWindowMs:()=>40},{version:1}), then services.override('native.event-semantics', policy). Renderer plugins can call api.markdown.tokens(source) or observeSurfaces('runtime-image-log','replace',render), returning cleanup for mounted resources. Host code still requires full package approval; it grants no new remote access. Existing API v1 declarations, command signatures, named selectors and stored schemas are unchanged after contract snapshot review. Legacy plugins continue receiving the same state/event shapes; internal callback or JSON object identity is not a public contract. Plugin body implementations must support unmount/remount and must not depend on a collapsed private DOM subtree. Public message text/copy and ordinary HTTP(S) escaping remain unchanged.

Isolated approved-plugin acceptance covers activation, mounted/later surfaces, disable/reenable, both image runtimes, real local HTML navigation and process restart. Existing service/surface suites cover failed registration, layered plugins and late cleanup. Development plugins and test profiles stay under ignored QA directories; source/protocol/hidden desktop evidence does not certify the active user desktop, real provider throughput, release packages or remote deployment.
<!-- streaming-media-repair-20261002:end -->

## Shared account allocation view (2026-10-02)

### Advisory accounting correction (2026-10-02)

Live native-window follow-up: the authority's embedded reader now omits missing, nonfinite, invalid or expired reset clocks independently per window. Claude can report an idle five-hour window with zero usage and no clock; this must not reject its valid weekly observation or numeric finish. The `accounts/usage` result still displays native availability, while `actions.quota-accounting.read` and the existing allocation surface consume the valid ledger windows. The registration/replacement/cleanup paths in the matrix below are unchanged, as are API-v1 signatures, events, permission checks, persisted schemas and snapshot declarations. No new option, resource, selector or adjustable UI state exists. Unknown clocks do not create a fictitious reset or calibration. `tests/quota-native-source.test.ts` executes the exact embedded Python reader with the production calculator, covering idle Claude completion/calibration, Codex dual windows and invalid clocks; the approved-plugin lifecycle remains covered by `tests/claude-ssh-controller.test.ts`.

This correction supersedes earlier descriptions of quota accounting as model admission. The affected public paths are `actions.quota-accounting.begin/observe/finish/read`, `accounts/usage`, member `quota/observe/read`, native numeric usage events and the existing `account-allocations` surface. No new selector, UI control, resource or option catalog is introduced. Registering additional selectable options is therefore inapplicable. Authorization stays in the native account/workspace executor; provider rejection and explicit native permissions remain authoritative. Estimated allocation, calibration and ledger availability never authorize or deny a core model submission.

| Capability | Production call and return | Registration, replacement and cleanup |
| --- | --- | --- |
| Advisory turn accounting | `begin(session:Session,handle:{threadId:string}):Promise<void>` installs a numeric observer and queues SSH accounting; `observe(sessionId:string,usage:unknown):void` collects native numeric deltas; `finish(sessionId:string,handle:{threadId:string}):Promise<void>` durably journals a receipt without waiting for SSH | Approved plugins register a namespaced backend with `api.services.register(id,backend,{version:1})`, then intercept or override `actions.quota-accounting`; the already-mounted Codex and Claude runners use that same instance. Scoped cleanup restores core methods. |
| Automatic calibration | `accounts/usage({id,accountId,refresh?:boolean})` calls `read(host,catalog,usage,refresh?):Promise<QuotaLedgerView\|undefined>` and refreshes provider evidence through the member authority even when a weekly window already exists | The existing service replacement and `account-allocations` surface consume the resulting numeric view. No renderer observation/write endpoint is introduced. |

Example: inside an approved host plugin, `api.services.register('plugin:example/accounting',backend,{version:1}); api.services.intercept('actions.quota-accounting','begin',(next,...args)=>{backend.observeStart(...args);return next(...args);});`. These full-package-approved extensions can deliberately replace core behavior; the core implementation itself does not gate native sends on the ledger. Accounting only uses an exact local account-generation binding; unresolved bindings skip attribution without querying SSH or throwing. The native executor independently verifies account identity and authorization before model submission. Ledger transport/provider failures retain numeric outbox receipts; local journal write failures reject `finish` and follow existing runner reporting. `read` failures retain the existing visible ledger-sync warning. No new events are needed: native numeric events and existing account-usage receipts own updates.

The outbox keeps its hashed scope filenames and numeric-only format. Foreground writes are serialized separately from SSH; an older acknowledgement cannot delete a newer receipt, and multiple unsent turns retain their combined deltas. Restart replays the same scope without stale official windows. Missing official telemetry no longer discards a finish or leaves its producer active: the authority saves numeric usage before returning `QUOTA_UNAVAILABLE`. The next successful read or turn observation samples official weekly use automatically. A first positive aligned increment enables an estimate; zero increments, ambiguous resets and coverage gaps do not create one. Known simultaneous producers settle together using reported token weights, not whichever member finishes first. Raw-token weighting does not distinguish model/cache cost, and unreported external usage cannot be uniquely attributed. Historical estimates remain bounded by the original account baseline and isolated by account generation and weekly reset.

API-v1 method names/signatures, surface selectors and receipt schema remain compatible; contract snapshot review requires no signature refresh. `begin` completion now means observer registration, and `finish` completion means local journal persistence, not successful remote settlement. Old clients can retain their former blocking behavior until updated. Old authorities keep their own calibration semantics until explicitly updated; rebuilding the desktop does not replace an already-running authority. No remote deployment is implied.

Validation: `tests/quota-coordinator.test.ts` covers both runtimes, stalled transport, concurrent receipt persistence, generation checks and restart replay; `tests/native-bridge-controller.test.ts` submits consecutive Codex turns with the real coordinator stalled; `tests/claude-ssh-controller.test.ts` loads an approved synthetic ZIP into the production service lifecycle and verifies actual Claude submission, disable and reenable. `tests/workspace-control.test.ts` covers three-member settlement, first-sample calibration, resets and deduplication; `scripts/test-quota-socket.py` uses real local Linux peer UIDs and provider failure/recovery. Existing service suites cover layered registrations, failure rollback and late cleanup. Profiles/plugins remain isolated. UI persistence is unchanged; see document 37. These tests do not establish real-account or live-VPS acceptance.

Interface review covers accounts/usage, actions.quota-accounting.read and member quota/context/read/observe/check, AccountUsagePanel and the named account-allocations surface. Both native runtimes use the same production quota authority endpoint. Administrators no longer run a newer in-memory calculator beside an older member process. The versioned quota-v2.sock, quota-runtime-v2 and lifetime lock reuse the existing state.json and control.lock; old runtime files and active model processes are not killed or overwritten. Existing administrator workspace discovery prepares this workbench-owned endpoint. Member-only devices require administrator maintenance if it is not provisioned. A separately installed formal control socket remains authoritative and must provide the matching endpoint. Existing old desktop writers are not certified compatible; deployment must coordinate participating clients. No deployment was executed by this source change.

| Capability | Call | Register / replace / cleanup |
| --- | --- | --- |
| Shared numeric ledger | accounts/usage -> actions.quota-accounting.read -> authenticated quota-v2.sock | Approved service registration/interception remains connected to the production read and runner lifecycle; deactivation restores core |
| Account allocation display | account-allocations surface with data-account-id | observeSurfaces supports mounted/later replacement and disposal; account card surfaces unchanged |

All permitted spaces for the selected account remain visible to members; this does not grant access to other accounts. Identity is the account ID plus generation within the authority; weeks, tokens and loans remain isolated. Workspace rows aggregate reported devices, rather than inventing unobserved per-device statistics. Explicit reads reread the shared ledger because another device can change it without local usage revisions. Official provider quota caching remains separate. Explanatory footer blocks and history protocol paragraphs were removed from cards; numeric rows, pending calibration and actionable errors remain. No new preference, option registry, resource, renderer write command or surface signature is introduced, so registration of new selectable options is inapplicable. Old arbitrary DOM text is not a contract; named surfaces remain stable. Existing errors and UID/membership authorization apply. Tests: quota-coordinator, workspace-control, test-quota-socket.py (actual isolated Linux peer UIDs), and the approved ZIP lifecycle in test-remote-account-dialog-ui.mjs. No contract snapshot change is required.


### 2026-10-02 account usage cache and calibration behavior

`accounts/usage` now uses the persisted native receipt for the account-page initial read (`cacheOnly:true`); an official provider request is made only when the user activates the existing refresh action (`refresh:true`). This preserves the public API, account-usage service replacement and cleanup lifecycle while preventing repeated page-entry queries. Workspace allocation rows remain derived accounting state. A recovered token total remains `待校准` until an aligned native percentage sample exists; additional model tokens are retained as numeric receipts and do not invent a provider conversion.

## Reading scroll responsiveness (2026-10-02 JST)

Interface review: the existing `translation-original`/`original-pane` reading surface and `ConversationReading` renderer remain the named consumers. No new command, service, event, selector, provider catalog, or permission is added. Approved renderer plugins continue to replace or observe the existing named surface through the current lifecycle; this change only changes scheduling and scroll-follow behavior inside the core consumer.

While a model streams public output, an upward wheel event immediately pauses bottom-follow before the browser's later `scroll` event. Returning to the bottom resumes follow automatically through the existing scroll position check. The follow path skips redundant `scrollTop` writes, and the conversation timeline uses a deferred presentation snapshot so editor and control input keeps urgent priority. `overscroll-behavior-y: contain` and `overflow-anchor: none` keep wheel intent inside the active reading pane. The behavior is transient interaction state: it is not persisted, exposed as a plugin setting, or carried between sessions.

Compatibility and cleanup are unchanged. Existing plugins, saved profiles, mounted/later reading instances, and disable/reenable restoration keep their previous contracts. No migration or contract snapshot refresh is required. Validation is `scripts/test-streaming-workspace-ui.mjs`, which exercises the production renderer with an approved synthetic host/renderer plugin and checks that an upward wheel intent remains stable while a second public stream updates the session; the existing streaming, file-review and translation-tracking UI checks remain applicable. The hidden desktop evidence is isolated and does not claim foreground deployment or live model throughput.

## SSH metadata read failures and bounded handshake recovery (2026-10-02)

Interface review: host/discover, accounts/list, accounts.catalog.list(host, source?), actions.native-accounts.models(host, catalog, accountId), workbench.actions.discoverWorkspaces and their existing state/error consumers. No new command, selector, event, resource, provider option, UI surface or persistent schema is added; API-v1 declarations and contract snapshots remain unchanged. Read-only account/discovery behavior applies to both native providers. Claude runtime/models uses the same explicit read policy; Codex model execution and its native protocol are unchanged.

| Capability | Call and result | Registration, replacement and lifecycle |
| --- | --- | --- |
| Workspace discovery | host/discover({id}) returns WorkspaceDiscovery or a fixed localized SSH diagnostic with SSH_<code> | Approved plugins can register the existing named host/discover method; production action injection remains available through workbench.actions.discoverWorkspaces. Scoped method/service disposal restores the underlying controller route. |
| Account catalog | accounts/list({id}) calls accounts.catalog.list and stores AccountCatalog; failed transport keeps availability unavailable with a fixed reason rather than asserting the broker is absent | Approved host plugins register namespaced commands using api.registerCommand and intercept/override the actual accounts.catalog.list service. The core controller, existing UI and later reads all consume the same instance; disable restores core and reenable reapplies the extension. |
| Native model catalog | actions.native-accounts.models returns validated NativeModelOption[] for the bound account; existing account-generation and permissions apply | The existing named service supports interception/override with scoped cleanup; no new model choice or implementation directory is introduced. |

Example: an approved host plugin uses api.services.intercept('accounts.catalog','list',async(next,...args)=>{const result=await next(...args);return result;}) and api.registerCommand('read',payload=>api.call('accounts/list',payload)). Registration handles belong to the plugin scope; no sample is installed in real profiles. New selectable options are inapplicable because this change only repairs transport reporting for existing reads. Unknown remote output, addresses and identity paths are never reflected in error messages. Explicit service rejections keep their existing broker messages.

Only the three named metadata reads may make one additional SSH attempt, and only when OpenSSH explicitly reports a timeout before receiving the server banner. Both attempts share the original deadline and identity; discovery cancellation stops the retry. Authentication rejection, host-key mismatch, arbitrary connection closure and unknown command outcomes are not retried. Login, device registration, selection writes, account maintenance, quota writes and model submissions retain their existing single-attempt and uncertain-outcome semantics. No remote configuration change or account authorization is implied. No new adjustable UI exists: busy/error feedback is transient, and saved connections, model choices and UI preferences remain owned by their existing stores.

Validation: tests/ssh-read-only.test.ts covers one-attempt recovery, retry exhaustion, cancellation, deadlines, redaction, both-provider catalog failures and mutation non-replay. tests/ssh-read-plugin.test.ts loads an approved ZIP against the production controller and service instances, exercises actual discovery/catalog calls, verifies rejection before approval and disable/reenable restoration. Existing catalog suites retain concurrency, late-result and disposal coverage. Type, plugin, documentation and preference checks remain required. A live read-only probe reproduced intermittent pre-authentication banner timeouts; it also verified existing administrator/member credentials and a ready Claude account catalog. This is not a real model execution, another-device import, remote deployment or proof of uninterrupted network availability.

## Workspace account selection and model refresh (2026-10-02 JST)

Pre-implementation review: affected commands are accounts/list, accounts/select, model-targets/list, runtime/models and runtime/select; services are accounts.catalog, actions.native-accounts, actions.native-codex and models.targets. State consumers are accountCatalogs, activeWorkspaceId, lastModelHostId and existing runtime/model preferences; notifications use the existing public state broadcast. No new credential access, model task, remote installer or permission is introduced.

| Capability | Call existing behavior | Register / replace | Production consumer and lifecycle |
| --- | --- | --- | --- |
| Choose workspace account | accounts/list({id}); accounts/select({id,provider,accountId,expectedRevision}) returns AccountCatalog | Approved accounts.catalog list/select overrides provide account sources; runtime registration remains api.runtimes.register; cleanup releases layers | Claude and Codex share AccountSelector, with provider-specific selection revisions; a new API draft retains the workspace account entry. Explicit account choice changes the new task source to SSH and preserves its text. Existing chats keep their bound identity. |
| Refresh sources and models | model-targets/list({refresh:true}) returns ModelTarget[] | models.targets.list(refresh:boolean), accounts.catalog and per-runtime model readers remain typed production services with release handles | Explicit refresh first rereads non-root member account catalogs, coalesces concurrent account discovery, then reads native models. Passive list(false) does not refresh account metadata. No account is automatically selected. Maintenance or stale identity errors reject the read; errors do not authorize model execution. |
| Replace the account control | api.observeSurfaces('composer-account','replace',renderer) returns cleanup | Additive named multi-instance surface; target.dataset.hostId and target.dataset.provider identify the workspace and native provider | Mounted and later instances participate; disable restores the original control. Existing composer-runtime and composer-model remain supported. Private .composer-account-picker selection should migrate to this name. |

An authorized account with no usable default remains a disabled source row with an explicit selection explanation. The row is display metadata and cannot create a session. Local official accounts retain their separate selector. Cached unavailable account cards can recover on settings reentry; failed reads preserve stored UI choices. Catalog refresh responses are sequenced so an older passive result cannot overwrite an explicit refresh. Errors remain visible through existing inline reporting; no fallback selects an arbitrary account.

Example: const catalog = await api.call('accounts/list',{id:workspaceId}); await api.call('accounts/select',{id:workspaceId,provider:'claude',accountId:chosenId,expectedRevision:catalog.claudeSelectionRevision??0}); const models = await api.call('model-targets/list',{refresh:true}); A renderer extension may use api.observeSurfaces('composer-account','after',({root,target})=>{root.textContent=target.dataset.provider;return ()=>root.replaceChildren();}); Host code uses the existing full-package approval; renderer disposal owns surface cleanup. Account authority and revision checks are unchanged.

Contract review: one additive surface and dataset contract; no command signature, ModelTarget shape or persisted schema change. Tests: tests/claude-ssh-controller.test.ts exercises approved plugin activation, missing selections, fresh discovery, overlapping refresh, changed identity and disable/reenable. scripts/test-workspace-account-selector-ui.mjs exercises both native SSH paths with synthetic approved adapters in the production hidden desktop, API-to-account draft changes, provider isolation, manual refresh, current/later surface replacement, narrow layout and complete process restart. These are isolated protocol/UI checks, not a real provider task or deployed VPS acceptance.

First-account entry: runtime/choice retains its existing RUNTIME_MODEL_UNAVAILABLE error. For a new native-runtime draft with a workspace, the renderer may then call runtime/select without a model target and show the account picker; this grants no execution readiness and does not alter a running chat. Both providers are covered by the isolated selector test with all API mappings and default accounts removed.

<!-- native-third-party-completion-repair-20261003:start -->
## Third party native completion repair (2026-10-03)

The existing `runtime.native-completion` service remains the named replacement surface. `prepare(request, protocol)` may add an optional completion declaration when the request already has tools; the production gateway accepts a protocol successful stop for automatic tool choice and keeps `required`/`any` policies binding. `Boundary.finish(turn)` returns the normal turn when no declaration was supplied, and validates an explicit declaration when supplied. If the declaration repeats already streamed text, the boundary emits one copy; distinct progress and final text remain separated.

No new permissions, commands, events, catalogs or persisted formats are introduced. Plugin replacement and disposal semantics are unchanged: a prepared boundary keeps its service for the in-flight request, while disable/reenable affects later requests. Errors remain `NATIVE_COMPLETION_INVALID`, `NATIVE_COMPLETION_MIXED`, protocol/incomplete stream errors and `NATIVE_COMPLETION_REQUIRED` only for an explicitly required tool policy.

Tests: `tests/native-completion.test.ts`, `tests/native-provider-compatibility.test.ts`, `tests/native-streaming.test.ts`, `tests/native-completion-plugin.test.ts`; the installed synthetic termination script is updated to accept normal third party text stops.
<!-- native-third-party-completion-repair-20261003:end -->

Completion repair coverage matrix: callers use `api.services.get('runtime.native-completion').prepare(request, protocol)` or `runtime.native-provider.openGateway(options)`; extensions register interception with `api.services.intercept('runtime.native-completion','prepare',handler)` and release the returned handle through `api.onDispose`; replacement uses `NativeGatewayOptions.completion` or the same production service interception. There is no new selectable catalog, so registration of a user option is not applicable. Production controller registration and gateway consumption remain unchanged. Example: `api.services.intercept('runtime.native-completion','prepare',(next,...args)=>next(...args))`. Existing permissions remain approved host-package access; this does not grant model, device or account authority. `completionReceipt` reports `boundary: 'unmarked'` for a successful normal stop without an outcome, not an error and not proof that the user's task was fulfilled. Unknown protocol endings still fail in `parseTurn`/`collectStream` before boundary acceptance.

This supersedes the 2026-09-30 rule rejecting all unmarked text. Old explicit envelope plugins remain compatible; public declaration and snapshot shapes, named UI surfaces, old profile formats and preference keys are unchanged. No semantic natural-language heuristic or cross-turn content deduplication is added. Only the explicit envelope/text pair within one response is compared. Approved activation, multiple plugins, activation failure, in-flight disable, later requests, reenable and uninstall are covered by the production service/gateway plugin test and isolated installed CLI script.


## Streaming history and scroll scheduling (2026-10-03 JST)

Interface inventory: public session state and `api.onState`, `session/fork-options`, `session/fork`, `attachments/activity-images`, `images.viewed.read`, annotation actions, activity grouping, UI preferences and the named reading surfaces below. The optimization uses the same production consumers for Codex and Claude. There is no new option catalog, native protocol, permission, resource owner or persisted schema. Registering a new scheduling option is inapplicable because scheduling is internal behavior, not a user-selectable mode.

| Capability | Call existing behavior | Register / replace and production consumption |
| --- | --- | --- |
| Reading and nested surfaces | `api.call('state/get'):Promise<AppState>` and `api.onState(listener):()=>void`; `mountSurface(surface,placement?)` retains its single-target handle | `observeSurfaces(surface:string,placement:'before'|'after'|'replace',render:SurfaceRenderer):()=>void` consumes `conversation`, `turn-process`, `activity-group`, `runtime-image-log` and `annotation-selection`; before/after adds content, replace layers local implementations with owned cleanup |
| Tool grouping | `api.activities.group(entries)` returns the existing typed groups; `subscribe(listener)` reports registry changes | `api.activities.register({id,classify})` returns an owned disposal handle; the real `ActivityGroups` consumer consults the registry whenever its body mounts, and reacts to classification changes while mounted |
| Deliberate disclosure | `api.uiPreferences.get(id,scope?)`, `set(id,value,revision,scope?)`, `reset(id,revision,scope?)` retain `UiPreferenceRead` / promised read results for `disclosure.open` | `register(definition)` creates typed namespaced preferences; `override(id,resolve)` replaces effective values in mounted and later consumers without erasing the saved choice. Shared preference subscriptions and revision errors are unchanged |
| Selection annotations | `api.annotations.get/add/update/remove/clear/translate/subscribe` retains active draft semantics | `registerAction({id,label,run})` adds real selection-toolbar actions; `overrideAction('core.add',...)` replaces the actual add action; `annotation-selection` supports local surface replacement |
| Branch eligibility | `session/fork-options({sessionId:string,messageId?:string})` returns existing location eligibility; `session/fork({sessionId,messageId?,location?})` returns `Promise<Session>` | Existing `registerMethod` / `useHost` and `actions.worktrees.inspect` hooks remain on the host route; `session-fork-action` / `session-fork-picker` replace the real UI. The renderer's per-snapshot index is internal; every host action still validates fresh mutable state |
| Viewed images | `attachments/activity-images({sessionId,activityId})` and `images.viewed.read` retain their image results and existing errors | Approved host services intercept/override the same image reader; `runtime-image-log` and registered activity attachment actions extend/replace the actual log. A saved open disclosure now mounts thumbnails on restart through its effective preference |

DOM discovery from mutation notifications is coalesced into the next animation frame. Registration and disposal still reconcile synchronously. Arbitrary legacy selectors continue observing attribute changes; new plugins should use named surfaces rather than private descendants. A folded historical `turn-process` keeps its summary and named outer surface but unmounts its body, nested activity groups and images. Reopening mounts fresh nested surface instances; removal aborts owned work and late async results are cleaned. Plugins must retain durable state in their existing configuration owner, not a detached DOM node. Multiple replacement layers still restore the earlier layer/core on disposal. Invalid selectors/renderers, renderer activation failures and stale APIs retain existing failure isolation and cleanup; full-package code approval remains required. No API-v1 declaration or named selector changed, so the reviewed contract snapshot needs no refresh.

Within the same reading view, the complete presentation snapshot, including its render callback, is deferred behind urgent editor/control updates. Session/layout and paired-tracking mode changes commit immediately with their visible controls, so the first focus never uses the previous view's handlers. Native state and host action validation remain authoritative. Historical branch availability shares one immutable message/completion index instead of rescanning all messages per reply. Locating original text or clicking a paired translation first opens the existing persisted process disclosure, then resolves and focuses the mounted block. Scrolling dismisses only the transient annotation toolbar; native selected text and saved annotations remain intact.

Example in an approved renderer plugin (the host owns returned cleanup):

```ts
api.observeSurfaces('activity-group', 'after', ({root,signal}) => {
  root.textContent = 'Extension activity details';
  const release = api.activities.subscribe(() => {
    if (!signal.aborted) root.textContent = 'Activity grouping updated';
  });
  return release;
});
const policy = api.uiPreferences.override('disclosure.open', (value,scope) =>
  scope?.includes('ActivityGroups.details.1') ? false : value);
// policy.dispose() restores the saved value without changing its revision.
```

Behavior evidence: `scripts/test-streaming-workspace-ui.mjs` exercises approved host/renderer plugins, both runtime fixtures, wheel-follow intent, folded-body removal, locate-original/paired click, image restoration after full restart and enable/disable/reenable. `scripts/test-native-events-ui.mjs` covers mounted/later instances, legacy attribute discovery, stacked replacements, activation failure, late asynchronous cleanup and package removal. `scripts/test-activity-preference-ui.mjs` covers effective overrides on mounted/remounted disclosures and restart. `scripts/test-context-annotations-ui.mjs` covers selection actions and toolbar dismissal; `scripts/test-translation-tracking-ui.mjs` covers existing paired focus/hover and layout fallback. `tests/session-fork.test.ts` covers snapshot indexing and fresh host revalidation; existing UI preference tests cover revisions, unknown/corrupt data and reset. Evidence uses isolated synthetic profiles only; no active desktop, real provider, SSH or installed release acceptance is implied.

## 2026-10-03: Offline defensive-design audit ledger

This change adds repository inspection tools only. `scripts/audit-defensive-designs.mjs`, `scripts/audit-defensive-designs.py` and `scripts/render-defensive-audit.py` read version-controlled source, attach review annotations and emit a local approval ledger. Entry arguments, records, exported decisions, errors, scope and evidence are specified in [the ledger guide](defensive-design-point-ledger-20261003.md).

| Coverage | Call existing behavior | Register options/implementations | Replace implementation | Lifecycle and compatibility |
| --- | --- | --- | --- | --- |
| Offline source audit | Three CLI entry points; TS/Python extraction functions | No production catalog or setting is introduced; review annotations are repository JSON | Extraction/rendering scripts can consume the documented record artifacts | No host, renderer or native runtime lifecycle changes; approval decisions are data and do not execute modifications |

No public command, service, event, resource, selector, surface or persisted product format changes. Production registration and synthetic approved-plugin activation are not applicable: the tools do not run in the application or extension host. Existing contract snapshots need no semantic or signature migration. The standalone review page stores decisions locally and exports them explicitly; it does not use or modify a real user profile. Tests cover static extraction and isolated-browser review behavior, not model execution or deployment. Existing plugin, documentation, preference and type gates remain the regression checks.

## 2026-10-03: D001-D004 remove redundant translation and command gates

Interface review: `draft/prepare`, `draft/submit`, `translation/settings`, `translation/targets`, `session/permissions`, state events, the production `translation`/`translation.targets` services and API `run_command` execution are affected. Existing `composer-draft-recovery`, translation settings and permission surfaces retain their names. No new UI preference, file format, setting or option catalog is introduced.

| Capability | Call | Register or replace | Production connection and cleanup |
| --- | --- | --- | --- |
| Translation text handling | `translation.translate/segments/refine` and `draft/prepare` retain their arguments/results | `translation.targets.register(owner, provider)` registers an actual target; translation service interception/override replaces behavior | The selected target executes through Translator and the shared queue; approved plugin disable cancels work and restores overrides, saved target IDs persist |
| API command execution | `runtime.api.tools.call(session, name, args, signal, approve, current?)` uses the actual session permission; `executeCommand(command:string,cwd:string,signal:AbortSignal):Promise<unknown>` returns the existing command result | Register a named executor service and override `runtime.api.tools.executeCommand`; no new permission option is needed for this existing full-access semantic correction | The controller exposes the same ApiLocalTools instance consumed by ApiRunner, and call dispatches through executeCommand; service releases restore the core executor |

Translation no longer rejects output solely for Han characters or source for credential-like vocabulary. Existing configured data-transfer consent and actual API-key/login-credential validation remain. Incomplete Markdown fences are preserved as literal code; when a nested code token cannot be mapped exactly, its containing Markdown block is retained verbatim. Token disappearance/duplication and mismatched previews remain errors. There is no automatic resubmission and no new warning dialog. `TranslationResult.protectionVersion` remains 2: placeholder syntax is unchanged; input acceptance semantics broaden. The former private `assertNoSecrets` helper is removed and was not a plugin SDK contract.

Commands in full-access use the user's existing choice, while default mode still calls `approve` and read-only/plan modes still reject execution, including after an asynchronous approval. Existing run_command schema and result are unchanged; its description now matches actual behavior. `runtime.api.tools` is an additive named host service; plugins may return their own executor result through the existing tool-result serialization. Service contract version 1, no new event, automatic network/device authority, or lifecycle ownership is introduced. Existing SDK snapshots have no signature change.

Example in an approved host plugin: `api.services.register('example.executor',{execute:async(command,cwd,signal)=>({exitCode:0,stdout:'Synthetic',stderr:''})},{version:1}); api.services.override('runtime.api.tools',{executeCommand:(...args)=>api.services.get('example.executor').execute(...args)});`. Host-owned service releases restore the prior executor on disable/failure. These trusted extension hooks do not change OS permissions or the session checks performed before execution.

Behavior tests: `tests/translation.test.ts`, `tests/translation-prose.test.ts`, `tests/translation-redesign.test.ts`, `tests/model-api.test.ts` and `tests/html-preview.test.ts`. Approved synthetic ZIP plugins exercise translation target selection, mixed-language and unfinished-code input, command execution through the actual API tool consumer, replacement, disable/reenable and restoration. Existing async cancellation and permission-change tests cover stale results. No real provider, SSH task, installed desktop or release acceptance is implied.

## 2026-10-03: D005-D008 interaction and diagnostic interfaces

Pre-implementation review: project/archive-sessions and project/remove use a shared named sidebar.projects service and return an additive sidebarUndoId; project/undo reverts the recorded operation. The sidebar menu calls the same commands. Its undo notification is transient interaction state; the resulting project/session changes still persist through StateStore. Permanent session deletion retains its existing confirmation. Public surfaces retain sidebar and add a dedicated sidebar-undo mount. No project folder is deleted or edited.

Chat creation retains the same tools, exact direct-user quote provenance, owner/location boundary and operation ID. The regex classifier of intent/negation is removed; the model-facing tool contract still requires the user's actual request. Quotes remain bound to the latest direct input or its stored submitted translation; peer messages and generated first tasks are not that input. The presence of a quote is provenance evidence, not semantic proof of permission; models must follow the explicit-user-request tool contract. No new user approval UI or automatic chat creation is introduced.

Explicit draft/prepare({bypass:true}) represents the existing original-input action and does not need a second confirmOriginal field or language classifier. The old field is accepted for compatibility. Automatic submission of a bypass preview remains disabled. Preview version checks and explicit submit remain. The shared diagnostics.errors.format(error) service exposes diagnostic formatting and replacement; it preserves explanatory text while redacting credential values. Timeout/cancellation wording refers to the operation instead of assuming every error came from translation.

D005-D008 contract details and evidence:

| Capability | Call / return | Register / replace | Lifecycle and compatibility |
| --- | --- | --- | --- |
| Reversible project changes | `sidebar.projects.archive(id)` / `.remove(id)` return `AppState & {sidebarUndoId:string}`; `.undo(id)` returns `AppState`; matching host calls use `{id:string}` | Register a named alternative service and override/intercept the specific sidebar.projects method; `sidebar-undo` supports observe/replace through the standard renderer surface API | Legacy `confirm:true` is accepted but unnecessary; old AppState consumers can ignore the extra result field. Receipts are host-process-local and released at disposal. Undo avoids reparenting a chat moved after removal. |
| Diagnostic rendering | `diagnostics.errors.format(error:unknown):string` | Register a formatter service; override or intercept format; host IPC formatting calls the same object via safeError | Disable restores the core formatter. No broad length cutoff; Error text is retained with value-level redaction. No new persisted field or event. |
| Original preview | `draft/prepare({bypass:true,...})` returns the existing DraftPreview; `draft/submit` remains explicit | Existing translation workflow and submission.gate services; named composer draft-recovery surface | Old confirmOriginal callers remain valid; no new language, runtime, model or permission selection. |
| Chat quote provenance | Existing sessions.agent-tools and workbench_create_session schema | Existing typed chat tool service interception/replacement; no new option catalog | Exact latest direct-input/stored-translation provenance remains; lexical intent is delegated to the model's explicit-user-request contract, not represented as host-verified permission. |

Errors retain existing project existence/busy/state and quote provenance errors. A missing/used undo receipt reports that it was already used or the host restarted; it does not recreate anything. No new resource, device or tenant permission is granted. Contract snapshot changes are additive only: project/undo and sidebar-undo. Existing selectors continue working except removed project confirmation dialogs; extensions should use the action service or the named undo surface instead. Transient toast state is documented in document 37.

Validation: 51 focused tests passed across sidebar actions, chat creation, device feedback, context annotations, diagnostics and translation flow. `scripts/test-defensive-ux-ui.mjs` passed hidden real-host archive/remove, undo, approved plugin surface mounting before/after creation, disable/reenable and complete process restart. Production build, typecheck, plugin/document/preference checks passed. Test providers used no real model or SSH task. The registered diagnostic/project implementations and actual command consumer were exercised, not only private helper imports.

## 2026-10-03: D009-D016 owner files, export and editing limits

Pre-implementation review covered API file tools, generated images, attachment save-as, account export, worktree configuration, native Skill export and draft refinement. These are existing capabilities; no new provider catalog, permission mode, saved preference or file format is introduced. Directory names and legacy controlPaths no longer define an extra file-access boundary. Owner/device grants, OS ownership, exact write versions, existing source identity and duplicate-send checks remain. Legacy controlPaths and generated-image managed-workspace callback arguments are accepted but no longer restrict destinations. Account export protects actual native-accounts credential filenames rather than the entire data directory; atomic writes still reject changed/linked destinations.

| Capability | Call and return | Register / replace | Actual consumer and cleanup |
| --- | --- | --- | --- |
| Owner files | runtime.api.tools.call(session, read_file/list_directory/write_file, args, signal, approve, current) retains results | Register a named file adapter service and override/intercept the existing tool call | ApiRunner uses the same registered instance; permission and version checks remain. Disable restores the core service |
| Generated images | images.generated.receive(GeneratedImageInput): Promise<Attachment> | Register an artifact sink and override/intercept receive | Native observations await the actual service before committing a receipt; cleanup restores it without replay |
| Attachment export | attachments/save-as({id,png?}): Promise<boolean>; actions.attachments.saveAs | Register a destination provider and override/intercept saveAs | Native dialog selection is used by the actual controller; source replacement remains an error; cancellation returns false |
| Account export | models/accounts/export-save and models.account-export.save retain AccountExportResult | Existing registerFormat/overrideFormat and service replacement | Selected registered serializer feeds the same file writer; release cancels late work and preserves source credentials |
| Worktree root | worktrees/configure({root,autoDelete?,limit?}); actions.worktrees.configure | Register a worktree implementation and override/intercept configure/create | Actual controller and session forks share it; roots under application data work, roots inside the source repository still fail |
| Skill export | native-skills/export({id,hash}); native.skills.exportZip(id,hash,destination) | Register a skill implementation and override/intercept exportZip; native-skill-export is a named multi-instance UI mount | Official and personal file-backed skills share the real dialog/archive path; builtins without files have no fabricated ZIP. Disable restores host and renderer layers |
| Skill input and refinement | composer/skills, draft/prepare/refine/submit and submission.gate | Existing native.skills discovery and submission.gate service overrides; no new option catalog | Codex accepts more than six selections; Claude retains its actual single leading slash-command syntax. Revisions have no arbitrary count limit; stale and repeated sends remain invalid |

Public surface native-skill-export selects [data-workbench-skill-export] and identifies each skill through data-skill-id. Existing row selectors remain; official rows now include the same export action. Example approved renderer extension: api.observeSurfaces('native-skill-export','after',({root,target}) => { root.textContent = target.dataset.skillId; });. Host example: api.services.intercept('native.skills','exportZip',(next,...args)=>next(...args)). Automatic disposal restores all registered layers. No new event or authority is granted. Existing host method signatures and SDK declarations are unchanged; the surface snapshot adds one entry. Former CONTROL_PLANE_DENIED, ATTACHMENT_SAVE_PROTECTED and WORKTREE_ROOT_IS_CONTROL_DIRECTORY errors no longer arise from directory classification; genuine ownership, format, source-change and Git overlap errors remain.

Validation locations: tests/defensive-ux-files.test.ts loads a fully approved ZIP and exercises actual controller/native consumers, twelve refinements, one-send semantics, disable/reenable; security-foundation, generated-images, attachment-actions, account-export, native-skill-controls, worktree-forks, composer-memory and translation tests cover content, source preservation and failures. scripts/test-defensive-files-ui.mjs uses a hidden isolated real host for official export bytes, mounted/later extension surfaces, disable/reenable and complete restart. UI state ownership is recorded in document 37. No real credential, provider, SSH or running user installation is involved.

## 2026-10-03: D101-D107 recoverable discovery and diagnostic detail

Interface review covers appearance/fonts, appearance.reference-fonts.status/read, the awb-font protocol, models/accounts/login-methods, models.account-access registration/start, readOnlySsh consumers and the standalone pre-install bootstrap. No new provider choice, permission, stored setting or automatic model retry is introduced. ClaudeFontStatus and FontCatalog.claude add optional reason text; old consumers remain valid. Discovery caches successful font locations only. Missing/failed discovery can be tried again; read failures retain their cause and invalidate the cached location. Protocol errors distinguish missing resource (404), invalid URL (400), access/path change (403), invalid format (422), size (413) and unexpected I/O (500), with redacted text. Its two allowed resources remain unchanged.

| Coverage | Call | Register / replace | Consumer and release |
| --- | --- | --- | --- |
| Font discovery | appearance/fonts returns FontCatalog; appearance.reference-fonts.status(refresh?) returns optional reason; read(style) supplies bytes | Existing font preset registration controls selectable families; a registered reference implementation can override status/read on appearance.reference-fonts | Actual font enumeration and protocol use that instance. Refresh repeats discovery; failure does not overwrite saved font choice. Host override release restores the core object |
| Login discovery | models/accounts/login-methods({id}) returns AccountLoginMethod[] with redacted reason; the UI exposes explicit rediscovery | models.account-access.registerLogin(owner,definition) installs actual availability/start behavior; service methods can be intercepted/replaced | The same directory drives tabs and start. A failed probe starts no login; refresh invokes availability again. Disable removes options and cancels owned handles |
| Diagnostic UI | font-discovery and login-discovery named surfaces | Standard observeSurfaces/mountSurface support current/later instances, replacement and disposal | Selectors are [data-workbench-font-discovery] and [data-workbench-login-discovery]; disable restores core status/refresh controls without changing preferences |
| SSH read diagnostics | readOnlySsh retains SshReadError.diagnostic and adds optional detail | Existing typed SshRunner injection and registered consumer services remain available; no new SSH identity or routing option | Classified guidance includes redacted stderr/transport cause, never stdout. Identity-file references, account/host identifiers and credential values are redacted; pre-banner retry count/deadline are unchanged |
| Bootstrap download/install | BootstrapTransfer.Run(HttpClient,feed,directory,CancellationToken,Action<string,int>,Func<string,Task>) returns Task; Diagnostic(Exception) returns redacted detail | Client/launch/progress delegates are explicit compile-time replacement points | This executable runs before the workbench/plugin host exists, so runtime plugin activation and renderer surfaces do not apply. The form owns one job, download cancellation and cleanup; an already launched installer remains owned until exit |

Bootstrap close hides its window immediately. During transfer it cancels the request/stream; after launch it waits for the separate installer without killing it or deleting an in-use package. Success/cancellation cleans the temporary directory before exit. Visible failures show selectable diagnostic details and retry; errors after deliberate close are recorded in a separate temporary error report. Existing package length/hash verification, single-job admission and source ownership remain. No user data is deleted, installer is published or installed by acceptance tests.

Example host extension: api.services.override('appearance.reference-fonts',{status:async()=>({available:false,italicAvailable:false,source:'installed-claude',family:'Anthropic Serif',reason:'Resource temporarily unavailable'})});. Existing registerLogin availability callbacks can throw useful errors; the host redacts values and displays their cause. A renderer can observe login-discovery to replace only the discovery row, without replacing the whole application. No lifecycle signature breaks; optional reason fields and two named surfaces are the deliberate contract snapshot additions.

Behavior evidence: appearance-reference-font, account-access, ssh-read-only and claude-remote-catalog tests cover retry, reason redaction, resource status, approved host overrides, both SSH metadata consumers and unchanged mutation non-retry. scripts/test-account-access-ui.mjs covers approved login availability errors/recovery, current/later surfaces and disable/reenable; the fixture uses its own UiPreferenceStore and complete synthetic host identity. scripts/test-installer-bootstrap.mjs compiles the actual C# transfer/form and verifies close ownership, cancellation, delayed launch completion, HTTP/checksum failures and redaction without showing a window or launching an installer. Live model, SSH, foreground installation and release acceptance are outside this evidence.

## D017-D019: ordinary network paths and hardlinked reads (2026-10-03)

The existing file-reference parser, files/browse command and files.navigation resolve/locate/source registry accept ordinary UNC and file://server share paths. Explicit user navigation uses OS access and authentication. Attachments and generated-image workspace paths no longer classify UNC as device streams. Device namespaces and alternate data streams remain separate from ordinary files. No source or destination directory whitelist was added.

| Coverage | Call | Register or replace | Lifecycle and compatibility |
| --- | --- | --- | --- |
| File references and browsing | fileReference, linkedText, files/browse; normalizeBrowsePath is pure mapping | Existing renderer fileReferenceRecognition registry, host files.navigation source registration and method interception | No new selector or preference; old local references and ambiguity behavior remain. UNC is tested without network access |
| Attachments and generated images | actions.attachments import/payloads; images.generated receive | Named production services allow method interception/replacement | Hardlinked sources can be read/replayed; changed bytes still reject stale attachment identity. Save-as/write protection remains |
| Native resources and shared text | native.skills exportZip; readArchive, collectDirectory, SharedDataRoot.read, readExplicitSkillFile | Existing native.skills production service and shared resource services remain the extension owners | Read-only hardlinks are allowed. Symbolic-link traversal is unchanged in this batch; mutation rules remain separate |
| Owner files and worktrees | OwnerFileService.read; actions.worktrees cleanup/restore | runtime.api.tools continues to consume the owner service; actions.worktrees is replaceable through existing production instance | Owner/device grants, version checks and archive hashes remain. Restore creates independent files, preserving bytes rather than link topology; external aliases are untouched |

No plugin version or persisted format changes. Existing plugin registration, disposal, reenable and missing-plugin behavior remain. Example: an approved host extension can intercept native.skills.exportZip, call files/browse with a UNC path, or register a files.navigation candidate source returning one. Test fixtures never access real network shares. No new UI state or surface is introduced.

Validation: file-links, file-navigation, generated-images, hardlink-reads, security-foundation, defensive-ux-files, worktree-retention, drag-attachments and attachment-storage tests cover path mapping, real local hardlinks, read integrity, shared-content write refusal and external alias preservation. The approved ZIP fixture exports a hardlinked official Skill through the actual consumer and verifies disable/reenable. Protocol tests do not establish live SMB or remote-files acceptance.

## D020-D021: file pages and continued search (2026-10-03)

Large local UTF-8 files open in pages, with a Continue reading action. Directory trees can load subsequent entries instead of ending at 1000. A line reference seeks preceding bytes in bounded chunks and displays original line numbers; From beginning opens earlier content. Incomplete short-path searches expose Expand search with concrete candidates. Copy content collects all text pages before updating the clipboard. These changes apply to local file links from both native providers. Remote SSH browsing retains its separate transport contract.

| Coverage | Call and types | Registration/replacement and actual consumer |
| --- | --- | --- |
| File paging | files/browse accepts optional cursor: FileBrowseCursor and pageSize: number. FileView adds startLine and next; FileBrowseOptions/FileBrowserApi are in packages/navigation/file-browser.ts | files.browser is the production FileBrowserService used by controller calls. registerReader({id,browse}) returns a cleanup function; newest reader returning a view wins, undefined delegates. Intercept/override browse replaces existing behavior. Disabled late results/errors are ignored |
| Continued search | files/resolve and files.navigation.resolve/locate accept budget?: Partial<FileSearchBudget>. entries/directories/milliseconds are nonnegative integers; zero means unlimited | Existing registerSource remains the real candidate directory. The former 256-candidate cap is removed; source timeout uses the request budget. Incomplete results include nextBudget for an explicit retry. Ambiguous results never become an automatic choice |
| Paging controls | New file-pagination named surface: [data-workbench-file-pagination] in preview and each directory continuation row | observeSurfaces/mountSurface support mounted/later nodes, replacement and disposal. Existing file-link-candidates owns search choices and continuation; file-reader remains the whole reader surface |

Cursor offsets count directory entries or file bytes; version binds a page to the filesystem identity, size and modification metadata. A changed source asks the caller to refresh; UI refresh restarts the read. Default pages remain 1000 entries or 1 MiB as a per-request allocation, with no total browse limit. UTF-8 split code points are retained and page content is literal text. Unsupported binary/encoding is still represented by unsupported; custom preview readers can supply a supported view. HTML preview requires complete content from the beginning. Copy-content intentionally reads complete native UTF-8 bytes, independently of plugin preview renderers. No command execution, write grant or model task is added.

Example: const browser=api.services.get('files.browser'); api.onDispose(browser.registerReader({id:'plugin:'+api.id+'/format',browse:async(cwd,path,options)=>undefined}));. Existing files/browse calls remain valid; optional fields are additive and no profile format changes. Request cursors, page contents and expanded search budgets are transient operations, not stored preferences. Existing reader wrap, source-only and directory disclosure preferences retain their owners and reset semantics.

Validation: file-pagination tests cover large UTF-8, one-byte pages with split Unicode, distant line seeking, 1005 directory entries, changed-source refresh, continued ambiguous searches, 300 provider candidates and reader lifecycle. The approved plugin in file-navigation tests registers a reader and intercepts actual controller paging; disable restores the core. scripts/test-file-pagination-ui.mjs uses hidden production Electron, real Monaco, 1007 directory entries, explicit search continuation, surface replacement/disable/reenable/later instances and full restart with reader preference restoration. Public contract snapshot additions are the paging types, optional search fields and one named surface. No live model, remote share or active user desktop validation is claimed.

## D022: attachment capacity and channel-aware reads (2026-10-03)

The fixed 10-file, 20 MiB per-file and 50 MiB aggregate restrictions are removed from composer, preload, host IPC and AttachmentStore. The duplicate Codex 5 MiB image estimate is also removed; actual native transport and provider protocol capabilities still apply separately. Local files are hashed in chunks instead of allocated as one buffer at import; managed snapshots copy and verify exact bytes. Native path ownership, source hashes, immutable submission identity and duplicate suppression remain. No new cap is introduced.

| Coverage | Call and return | Registration/replacement and lifecycle |
| --- | --- | --- |
| Import/resolve/views/save | Existing attachments/import, attachments/pick, attachments/views, save-as and actions.attachments methods | Existing actual AttachmentStore service remains interceptable/replaceable; default UI and preload consume it without separate count/size policies |
| Payload inclusion | actions.attachments.payloads(ids, options?: AttachmentPayloadOptions) returns AttachmentPayload[]; optional dataOmitted marks verified bytes deliberately not retained | New attachments.payload-policies is the production AttachmentPayloadPolicies instance. register({id,includeData}) returns cleanup; custom plugin IDs can be selected through payloads options.channel; intercept/override includeData replaces existing channel behavior |
| Send consumers | native channel retains images and small inline text; api additionally retains PDFs; preview loads image bytes; verify checks hashes without retaining bytes; omitted channel preserves legacy full behavior | ApiRunner, NativeCodexRunner and NativeProviderRunner start/steer paths use these policies. Claude uses api because its native message protocol transmits PDF blocks. This is a transport contract, so no user preference selector is introduced |

Example: api.onDispose(api.services.get('attachments.payload-policies').register({id:'plugin:'+api.id+'/metadata',includeData:()=>false})); then call actions.attachments.payloads(ids,{channel:'plugin:'+api.id+'/metadata'}). Unknown/disabled custom channels report ATTACHMENT_POLICY_UNAVAILABLE. Core defaults never fabricate empty inline text for omitted data. Existing payloads(ids) plugins still receive all bytes; new optional dataOmitted and payload declarations are recorded in the contract snapshot. The legacy MAX_ATTACHMENT_* exports remain source-compatible constants but no longer enforce product limits.

No persisted attachment format changes or new UI state. Names and metadata remain immutable references; closing a picker does not import, and changed sources cannot be sent with old hashes. Display/full media and byte-array uploads still need memory proportional to actual image/document data; streamed verification does not claim arbitrary native protocol frame support. Subsequent transport audit items track those independently.

Validation: attachment-channels, drag-attachments, attachment-storage, hardlink-reads, device-feedback, generated-images, defensive-ux-files and native provider/bridge suites. The approved plugin test registers a byte-inclusion policy, replaces the real attachment consumer and verifies disable/reenable. Hidden production drag UI exercises eleven real OS files, a 21 MiB file, a 53 MiB aggregate, image/text paste, edit cancellation and restart; all 17 behavior groups passed. No real model or remote upload occurred.

## D023: decoded images without arbitrary pixel/byte rejection (2026-10-03)

| Coverage | Call/return | Register/replace and production lifecycle |
| --- | --- | --- |
| Native generated images | images.generated.receive(GeneratedImageInput) returns Attachment with the decoded MIME and file extension; decode(bytes) returns GeneratedImageFormat | The controller's actual WorkspaceGeneratedImages instance exposes registerDecoder({id: plugin namespace, decode}) with cleanup. Latest registered decoder returning a format wins; undefined delegates. Service interception/override replaces receive or decode. Disabled asynchronous results and errors are ignored |
| Clipboard and annotation | Existing attachments/copy-image, attachments/save-as and blob-save methods; existing attachment/image-viewer named surfaces | Existing host actions and multi-instance UI replacements remain applicable. Pixel dimensions are obtained by real nativeImage/Chromium decoding; copying and annotation convert to PNG, while received files retain exact source bytes |

Example: const images=api.services.get('images.generated'); api.onDispose(images.registerDecoder({id:'plugin:'+api.id+'/format',decode:bytes=>undefined}));. GeneratedImageFormat declares mime, extension, width and height. The core desktop decodes PNG, JPEG, WebP and GIF; additional formats enter the real sink through registered decoders. Decoder registration rejects malformed/duplicate IDs; invalid encoding, unsupported/undecodable bytes and missing decoder report GENERATED_IMAGE_ENCODING_INVALID, GENERATED_IMAGE_FORMAT_UNSUPPORTED/INVALID and GENERATED_IMAGE_DECODER_UNAVAILABLE. No network request, new permission, model turn or settings selector is added. Native identity, source ownership, verified hashes, independent file creation and receipt-before-cleanup semantics remain.

The former 20 MiB and 40-million-pixel limits are removed. MAX_GENERATED_IMAGE_BYTES stays exported solely for source compatibility; native transport frame capacity remains a separate contract. Sink-only GeneratedImageService implementations remain valid because decoder methods are optional. Direct construction of WorkspaceGeneratedImages now needs a native decoder (fourth argument) or a registered decoder; the production controller supplies the desktop decoder. Existing PNG metadata and default registerGenerated calls remain compatible. A replay that changes bytes, format or destination fails before creating another format under the same identity. No stored preference/default changes; browser/OS actual decode or allocation failure remains a reported operation error.

Validation: generated-images and attachment-storage unit suites; real approved decoder ZIP activation/disable/reenable in scripts/test-image-formats-ui.mjs, with PNG/JPEG/WebP/GIF original bytes/extensions, WebP clipboard conversion, a >20 MiB input, corrupt decoding, conflicting identity and actual JPEG viewer. A 7000 x 6000 image passes native copy and actual annotation save; the system clipboard is intercepted at its OS boundary. scripts/test-generated-images-ui.mjs covers root/child previews and delivery states. Hidden screenshots were inspected. Plugin contracts include generated image declarations; no live model, real clipboard, active desktop update or remote deployment is claimed.

## D024: streamed API file pages and binary writes (2026-10-03)

| Coverage | Public call/result | Register/replace and lifecycle |
| --- | --- | --- |
| API reads | runtime.api.tools.call(session, 'read_file', {path, offset?, limit?, encoding?, version?}, signal, approve, current?) returns FileReadPage; UTF-8 offsets count JavaScript characters, base64 offsets count bytes | runtime.api.tools.registerFileReader({id,read(path,options,next)}) returns cleanup. Latest non-undefined result wins, next invokes the real owner file reader. The actual ApiRunner calls readFile through this instance. Intercept/override readFile replaces the core implementation; disabled late results/errors are ignored |
| Owner file service | OwnerFileService.readRange(context,path,FileReadOptions) returns realPath/content/version/bytes/encoding/offset/nextOffset/truncated and totalCharacters for UTF-8; existing read returns a complete compatible text snapshot | Owner/device grant and OS ownership still gate core reads. Registry replacements are approved trusted host code; grant issuance is not a model tool. Public service interfaces are included in the contract snapshot |
| Writes and directories | write_file accepts optional encoding utf8/base64; list_directory accepts offset/limit and returns total/nextOffset | Existing call interception applies. prepareWrite accepts optional encoding; write approval binds exact decoded bytes, hash, owner and context. Read-only/plan, concurrent versions and duplicate-write results remain |

Example: api.onDispose(api.services.get('runtime.api.tools').registerFileReader({id:'plugin:'+api.id+'/reader',read:async(path,options,next)=>next()}));. Existing calls default to UTF-8 with a 16000-character page; the former 32000-character maximum is removed. Directory defaults are a 1000-entry page with explicit continuation. No total file cap is configured by ApiLocalTools; OwnerFileService optional maxBytes remains available to explicit callers, with no default cap. Reads/hash verification scan 64 KiB chunks and retain only the requested page; each page verifies the whole-file hash, so distant reads incur scan I/O rather than full-file allocation. Caller-supplied version detects changes between pages. Full legacy reads and full write payloads still allocate their requested content.

Invalid ranges/encoding, unsupported UTF-8 (with a base64 remedy), revoked grants, ownership failures and changed versions retain structured errors. No new permission, automatic model replay, persisted setting, event or UI control is added. Existing file tools and read/prepareWrite signatures remain source-compatible through optional fields. Binary writes now return base64 content; UTF-8 defaults remain unchanged. Plugin failure/disposal restores the core reader through existing service cleanup.

Validation: owner-file-pages, security-foundation and model-api (55 tests), including >2 MiB input, >32000-character pages, Unicode chunk boundaries, binary byte equality, cancellation, source-change detection, 1003 directory entries and actual approved plugin activation/disable/reenable through ApiRunner. The compaction fixture declares output capacity on the model rather than a retired connection field; the large-file fixture uses an explicit adequate window to isolate file behavior. D027 separately tracks fixed context/summary budgets. No native Claude/Codex protocol change, live API call, remote operation or UI persistence change is claimed.

## D025: command duration and durable full output (2026-10-03)

| Coverage | Call/result | Register/replace and lifetime |
| --- | --- | --- |
| Command execution | runtime.api.tools.executeCommand(command,cwd,signal,options?:ApiCommandOptions) and model run_command optional timeoutMs/maxOutputBytes | registerCommandExecutor({id,execute}) returns cleanup; latest synchronously non-undefined result owns execution. Promises, even if later undefined/rejected or disabled, never delegate/replay. Existing intercept/override executeCommand still replaces production execution |
| Full output | ApiCommandResult includes exitCode, inline stdout/stderr, stdoutPath/stderrPath, byte counts and truncated | Actual local execution streams all bytes to command-results under the local profile. Existing read_file pages can read the returned paths; no command rerun is needed. The caller-selected inline limit affects preview only |

No timeout is imposed by default. timeoutMs=0 also means none; a positive explicit timeout stops the owned process tree using the existing cancellation contract. maxOutputBytes defaults to 16000 per stream, with zero providing paths/byte counts only and no imposed maximum. The complete command is executed from a temporary script so Windows argument-length limits do not reintroduce the former 16000-character policy. Script files are removed after completion/cancellation; output files persist in the user's local profile for subsequent reading. They are user data, excluded from release artifacts. There is no automatic expiry or replay. Existing shell/environment policy is unchanged and separately tracked under D047.

Example: api.onDispose(api.services.get('runtime.api.tools').registerCommandExecutor({id:'plugin:'+api.id+'/executor',execute:(command,cwd,signal,options)=>undefined}));. Old three-argument executions remain valid; results retain exitCode/stdout/stderr and add file references. The preview can be shorter than before, explicitly marked truncated with full paths. Approval details include the exact explicit timeout/preview options. Invalid options fail before execution, start failures retain the native cause, output-write failures and unconfirmed cleanup remain uncertain. Partial output references are preserved in the real activity record on cancellation/failure. No new user-adjustable UI or persistent preference key is introduced; these are per-command arguments.

Validation: api-command-output and model-api (37 tests) cover >16000-character scripts, >1 MB exact output, configurable previews, UTF-8, explicit stop/timeout, oversized timer durations, fully approved executor registration/interception/disable/reenable and in-flight disable without a second execution. A separate isolated command runs for 122 seconds to verify the former timeout is absent. Build/type/plugin/docs/preference gates apply. No model request, remote command, installed update or active desktop operation is claimed.

## D026: explicit per-turn API call budget (2026-10-03)

| Coverage | Call / state / event | Register, replace and lifetime |
| --- | --- | --- |
| Saved session budget | session/api-budget({sessionId,limit,expected}) returns {limit}; runtime.api.configureBudget provides the same command behavior; Session.apiCallBudget defaults to 0 (unlimited) | runtime.api.budgets.register({id,limit(session)}) returns cleanup. Latest non-undefined policy wins in the actual ApiRunner; service interception replaces limit/configureBudget. Removing a registration restores the saved value without rewriting it |
| Request loop | Budget is frozen at explicit submit; positive values count ordinary inference calls, excluding context-summary calls. A completed final response completes normally; exhausting a chosen budget saves apiBudgetPause and nativeTurnStatus=budget-exhausted | Active turns keep their frozen budget across plugin/config changes. Stop and unknown-result handling remain. A new explicit task clears the pause; there is no automatic continuation or tool replay |
| Renderer | api-call-budget and api-budget-pause named surfaces cover mounted and later controls/notices | observeSurfaces supports before/after/replace and cleanup. Disable restores core UI; native Codex/Claude paths have no standalone API loop and do not display this preference |

Example: api.onDispose(api.services.get('runtime.api.budgets').register({id:'plugin:'+api.id+'/budget',limit:session=>session.projectId==='example-project'?100:undefined}));. Host plugins must use their approved lifecycle; this grants no owner, device or execution permission. Invalid values return API_CALL_BUDGET_INVALID; stale expected values return API_BUDGET_CHANGED; non-API sessions return API_SESSION_REQUIRED. Duplicate policy IDs fail registration without replacing a live policy. State updates use the existing public state event and serialized store writes.

Migration: missing legacy budget means 0; the fixed 64-call failure is removed. Old command shapes remain unchanged, and new fields are optional. The pause is persisted known operational state, with tool results retained and queued/untransmitted inputs marked not-sent. It is classified as stopped for duration reporting, not a failed or completed task. Corrupt saved budget values are handled by existing store recovery; they are not silently rewritten. The contract snapshot adds the typed policy/pause interfaces, command and surfaces.

Validation: model-api and turn-timing tests exercise 66 calls, explicit budget, stale writes, frozen active policy, unsent steering, restart and fully approved policy enable/disable/reenable through real requests. scripts/test-api-budget-ui.mjs uses the production hidden host/renderer and approved synthetic ZIP to verify fresh zero, control save/reset, full process restart, pause display, named replacement and later surfaces. No real model, native CLI, SSH, installed update or foreground operation was used. Document 37 records the persistent owner; no new model permission or core-only registry branch was introduced.

## D027: capacity-based context scheduling without preflight rejection (2026-10-03)

| Coverage | Public call | Register / replace / production consumer |
| --- | --- | --- |
| Scheduling | runtime.api.context.estimate(text,model):number and budget(model):number or undefined | register({id,estimate}) returns cleanup; newest defined estimate wins. Synchronous estimates must be finite, nonnegative and monotone for growing input. Actual history and in-turn compaction use the registered production instance; service interception replaces estimation, budget or summarize |
| Summary processing | summarize(text,model,signal,complete,budget?):Promise<string> splits ordered text by estimated capacity, preserving Unicode boundaries | complete performs the actual selected provider request. Registered tokenizers affect real chunk scheduling; disable restores core approximation without stored-setting changes |
| Conversation client | ApiConversation optional contextPlanning; estimatedInputTokens uses provider usage plus estimated new content; compact keeps latest input | Direct clients default to an independent core planner. Existing estimatedInputBytes remains available but is no longer compared with token capacity; compact(signal,budget) still accepts an explicit scheduling budget |

Example: api.onDispose(api.services.get('runtime.api.context').register({id:'plugin:'+api.id+'/tokenizer',estimate:(text,model)=>model.model==='example-model'?tokenizer.encode(text).length:undefined}));. A missing model window remains unknown; known input budget is contextWindow minus configured/reported output capacity. The former fixed 80 percent/2048 reserve, 100 MiB historical attachment gate, sixteen-summary cap and single-entry/post-summary rejection are removed. Core estimates count approximate ASCII and Unicode text, never claim tokenizer precision, and do not assign a synthetic 20000-token charge to binary media. Actual usage calibrates subsequent in-turn scheduling. The model/provider remains authoritative for whether a request fits.

Summaries are finite source traversal within the explicitly requested task; no failed request is replayed. Oversized records split across ordered requests. If a returned summary itself fills the estimate, remaining unsummarized reference is retained for inference instead of entering endless compaction. Latest inputs are preserved even when the estimate is high. Cancellation and provider errors propagate without auto-retry; summary tool requests are rejected as an invalid operation. Original messages, activity outcomes and source hashes remain in local history. Summary calls remain outside the ordinary-inference call budget described by D026.

Compatibility: no new saved preference or UI surface, no API model format migration, and no permission change. The optional planner and estimator interface are added to the contract snapshot. Existing manually supplied positive model capacities no longer have an arbitrary 100-million ceiling. Tests cover three provider shapes, >16 summary requests, a large single source, Unicode order, oversized generated summaries, actual usage calibration, verified 102 MiB historical attachments, approved registration/disable/reenable and unchanged original history. Native Codex/Claude context remains runtime-owned; no native CLI, real model, live SSH or installed update is claimed.

## D028: user-defined reasoning values without mandatory probes (2026-10-03)

| Coverage | Public call and state | Registration / replacement / lifetime |
| --- | --- | --- |
| Suggested values | model-api/reasoning/options({model:ApiModel}):Promise<string[]> reads models.reasoning-options.list(model) | ReasoningOptionCatalog.register({id,levels(model)}) returns cleanup. Registered sources augment the real settings list; intercept/override list replaces it. Source IDs use the plugin namespace, while values remain the provider's exact wire tokens |
| Manual configuration | model-api/save retains ApiModel.manualEfforts/defaultEffort; session/model and native target selectors consume availableReasoningEfforts | Existing model.connections call interception reaches production saves. A custom input adds arbitrary valid provider identifiers; selection reaches standalone requests and both native protocol adapters without requiring a probe |
| UI | reasoning-options named multi-instance surface contains options, custom input and default selection | observeSurfaces supports call/register/replace with cleanup. Extension notifications refresh active option lists; stale async catalog replies are ignored. Removing an unselected suggestion removes it; saved manual values remain usable independent of the suggesting plugin |

Example: api.onDispose(api.services.get('models.reasoning-options').register({id:'plugin:'+api.id+'/levels',levels:model=>model.model==='example-model'?['vendor-depth']:[]}));. Existing seven names remain convenient suggestions in their prior order; custom names append without the former seven/twenty item limits. Structured upstream error enums may declare custom values. Compatibility detection remains an explicit separate inference operation with existing consent, cancellation and diagnostics; saving effortCandidates no longer requires detection, and rejected/inconclusive detection results no longer block saving. Candidate lists remain probe choices, not proof or manual execution configuration. Set manualEfforts to select unverified values explicitly.

Existing identifier format, concurrent revision and active-connection integrity semantics remain; no new permission or network request is introduced. Save may perform the existing directory GET, but never inference unless explicitly requested. Missing source/disable does not erase a chosen token or invent fallback. Restoring automatic removes the manual override and uses actual provider metadata. Optional fields and standard effort order remain compatible; command/surface/source declarations are added to the contract snapshot. No native CLI enum is fabricated: custom upstream values are applied by the provider gateway, with native CLI configuration following its own contract.

Validation: reasoning-manual/probe/passive, model-connection-plugin, model-api-settings and native-provider-compatibility cover custom values, 32-level lists, rejected diagnostics, credential/revision preservation, both native wire families and approved source lifecycle. scripts/test-reasoning-options-ui.mjs uses a hidden production host and renderer with an approved plugin to verify live options, replacement/restoration, custom editing, three protocol changes, full restart and retained defaults. All actual HTTP requests in that UI test are synthetic directory GETs. No real model, native CLI, SSH, installed update or active desktop operation is claimed.

## D029: explicit HTTP endpoints and query-preserving routes (2026-10-03)

| Coverage | Public call/result | Registration / replacement / consumer |
| --- | --- | --- |
| Endpoint construction | models.endpoints.resolve({baseUrl,resource,defaultVersion?}):string; shared apiEndpoints singleton | register({id,resolve}) returns cleanup; newest non-undefined resolver wins. Approved host plugins intercept/override resolve; duplicate IDs preserve the existing registration. Source IDs use the plugin namespace by contract |
| Actual requests | Translation endpoint/listModels/Translator; API discoverModels/ApiConversationClient; reasoning probes; Codex and Claude native gateway forwarding | All use the same production endpoint instance. Registration therefore changes real resource paths, not just settings display. Dispose restores future requests; an in-flight request is never rerouted/replayed |

Example: api.onDispose(api.services.get('models.endpoints').register({id:'plugin:'+api.id+'/routes',resolve:request=>{if(!request.baseUrl.startsWith('https://gateway.example/'))return;const url=new URL(request.baseUrl);url.pathname='/deployment/'+request.resource;url.hash='';return url.href;}}));. This trusted routing code belongs to the approved package and adds no device/tenant permission.

Configured HTTP, LAN, link-local and unspecified addresses are no longer rejected by a hostname policy. Query and fragment components are accepted; path resources append before the query, query values remain intact, and fragments are omitted from HTTP requests as URL semantics require. The former 2048-character and lexical address gates are removed in favor of URL parsing. Unsupported transport schemes remain unavailable to the HTTP implementation. Existing userinfo/independent-credential handling and prohibited Claude login-web endpoints remain, as do authenticated redirect behavior and no automatic replay. Invalid URL/credential diagnostics omit supplied values.

Compatibility: existing addresses and provider prefixes retain normalization; translation retains official-host version defaults while direct API connections preserve explicit prefixes. No new option, saved format, UI node or event. Existing connection/translation profile persistence stores the normalized URL; query and fragment are retained across save/reload. Tests cover all three protocols, translation/direct discovery, actual native loopback gateways for both runtime families and a fully approved resolver enable/disable/reenable. All upstream requests are intercepted synthetic requests; no LAN/link-local/remote service was contacted. Native gateway tests do not claim native CLI or live SSH acceptance.


## D030: visible partial translations (2026-10-03)

| Coverage | Public call/result | Registration / replacement / lifetime |
| --- | --- | --- |
| Output decoding | translation.outputs.read(data,protocol):TranslationOutput returns text and optional incomplete | register(TranslationOutputReader) returns cleanup; newest defined reader wins. The production Translator uses this instance for custom API responses. Approved service interception replaces read; native backends propagate the same completion flag |
| Input review | draft/prepare, draft/refine and interaction/prepare return optional incomplete in DraftPreview/AnswerPreview | Existing translation target registration and translation service replacement remain active. Automatic submission of a partial result stays in the existing preview; manual confirmation sends the visible text once with existing source/revision/receipt integrity |
| Reading and UI | translation.translate and segments preserve readable text; partial-translation named surface appears in ordinary, native-answer and asynchronous-answer previews | Output consumers receive a visible partial label. Missing or mismatched segment fields retain their own original text. observeSurfaces supports mounted/later call/register/replace and disposal |

Example: api.onDispose(api.services.get('translation.outputs').register({id:'plugin:'+api.id+'/decoder',read:(data,protocol)=>typeof data.customText==='string'?{text:data.customText,incomplete:data.finished!==true}:undefined}));. Reader IDs use plugin namespaces; duplicate registration returns TRANSLATION_OUTPUT_READER_DUPLICATE without replacing the existing owner. Plugin activation approval and service capabilities remain unchanged. Core no-text results still report a readable error; refusal/thinking/tool payloads are never executed or presented as translated text. Readable text beside such payloads can be inspected as partial. Native termination/disconnect preserves observed text and usage; explicit cancellation invalidates it. No failed request is retried.

Protected tokens are restored when complete. Unusable segment values retain their corresponding source rather than moving text into another field; complete string pairs in truncated JSON remain usable. Extra fields do not alter question IDs, options or annotation association. Incomplete refinement retains the previous original and exposes the partial edited result for review, without launching its second translation step. Partial usage retains the existing failed receipt status for compatibility. Output labels travel with translated reading text, so every existing reading layout keeps the distinction; input labels are UI-only and are not inserted into submitted text.

Compatibility: new fields are optional, existing complete results and old callers retain their behavior, and no saved preference or permission is added. Direct-send preference is not rewritten by a partial result. Draft/answer previews are transient; original drafts and original messages retain their existing owner. Public output-reader declarations, result metadata and named surface are snapshot-reviewed. Tests: translation-provider/native/module/flow, translation-redesign, interaction-flow and context-annotations; 135 focused cases pass. scripts/test-partial-translation-ui.mjs builds a hidden production app and loads an approved reader/surface plugin through import/activation, verifies current/later previews, disable/reenable, replacement cleanup and full restart. No real model, SSH, active desktop or installed update is claimed.


## D031: translation capacity and scheduling (2026-10-03)

| Coverage | Call / result | Registration / replacement / lifecycle |
| --- | --- | --- |
| Queue scheduling | translation.scheduling.limits():{concurrency:number}; enqueue(key,priority,run,signal):Promise | register({id,concurrency}) returns cleanup. Approved service interception replaces limits/enqueue; the real TranslationModule uses this exposed queue for input, output, segments and refinement. Latest registration wins; disposal restores the preceding policy |
| User budgets | translation/settings accepts maxCharacters/maxCalls/timeoutMs and maxOutputTokens using existing TranslationProfile | Existing translation settings/target services provide call/register/replace; values persist in the same profile, with existing config revisions and invalidation. 0 continues to mean unlimited for optional character/call/time budgets |
| Response and catalog | Translation API readers consume complete response bodies and all returned pages; segment IDs retain correspondence | Existing output readers and target providers extend/replace actual behavior. No separate size policy or new admission switch is introduced |

Example: api.onDispose(api.services.get('translation.scheduling').register({id:'plugin:'+api.id+'/schedule',concurrency:4}));. Default concurrency remains 2 as a scheduling choice, with no 64-entry pending rejection. Raising a registered concurrency admits pending work immediately; lowering it lets current work finish. Duplicate operation keys still share one promise, input then final then progress priority remains, and cancelled entries never call their backend. IDs follow plugin namespace convention; duplicate IDs or invalid concurrency return TRANSLATION_SCHEDULING_INVALID. The legacy constructor capacity argument remains accepted but no longer rejects pending work. Disposal does not replay or cancel already-owned requests.

The 2 MB response cap, 512-field segment cap, 2000-model and ten-page catalog caps are removed. Pagination still follows real returned cursors and rejects a repeated/non-progressing cursor. User numeric budgets retain integer semantics up to JavaScript safe-integer precision, rather than arbitrary product maxima. Output tokens accept positive values; the Anthropic fixed-thinking contract still reserves output space. Long timeout budgets are scheduled across native timer intervals, preventing large values from wrapping into an immediate timeout; completion/cancel cleans up the timer. Translation URL settings and discovery no longer impose the old 2048-character gate. No provider is automatically retried.

Compatibility and evidence: no new saved field, event, permission or UI node; existing settings retain defaults, reset and migration. The existing translation-settings surface and preference ownership apply. 119 translation tests pass, including 2.4 MB decoded text, 600 segments, 80 waiting jobs, 12 catalog pages, a long deadline, retained user limits and approved production scheduler activation/interception/disable/reenable. The hidden production script test-partial-translation-ui additionally saves above-old-ceiling values through real controls and verifies full restart. Native transport capacity is addressed separately by D032; no native CLI, real model, installed update or live remote execution is claimed here.


## D032: native stream and gateway capacity (2026-10-03)

| Coverage | Public call / return | Registration / replacement / actual path |
| --- | --- | --- |
| Process transport | runtime.native-streams.create(ProcessSpec):ProcessSupervisor, createNativeProcess(spec) | register(NativeProcessFactory) returns cleanup; newest non-undefined factory wins. create(spec,core) can use the supplied core constructor. Service interception replaces creation. Both local native-provider families, translation children, Codex SSH, Claude SSH and local execution-server construction consume the production singleton |
| Gateway protocols | runtime.native-provider.openGateway(options), runtime.native-request and runtime.native-completion | Existing codec registration/interception and gateway replacement cover actual request decoding and final output. HTTP bodies, non-streaming JSON and collected SSE no longer use the fixed 32 MiB/4 MB/32 MB cutoffs |
| Native relay | SSH native-owner bridge and account-owner NativePipe; both provider input loops | Host transport registration affects the SSH subprocess. Remote native-adapter registration remains the deployment extension entry; this source change is bundled at configuration revision 6 and is not deployed by these tests |

Example: api.onDispose(api.services.get('runtime.native-streams').register({id:'plugin:'+api.id+'/transport',create:(spec,core)=>core({...spec,env:{...spec.env,EXAMPLE_TRANSPORT:'enabled'}})}));. Approved code can call, register or replace process construction; this adds no SSH identity, tenant or action permission. Duplicate factory IDs return NATIVE_PROCESS_FACTORY_DUPLICATE. Factory cleanup affects future processes; existing processes keep their owned lifecycle and are stopped by their original session owner. Existing injected process factories remain compatible.

ProcessSpec optional positive maxFrameBytes/maxOutputBytes still honor explicitly supplied caller policy. Omission now means no artificial byte cutoff; the native model paths no longer inject 8/48 MiB limits. JSONL chunks accumulate as Buffer slices and concatenate once per complete frame, avoiding repeated full-frame copying. UTF-8, JSON-object integrity, exact raw bytes/hash, process cancellation, explicit lifetime, disconnect and no-replay semantics remain. SSH member and owner input readers consume complete lines and NativePipe no longer rejects >48 MiB payloads. Configuration state-file validation and separate management request budgets are unchanged and are reviewed under their own audit items.

Collected API tools no longer fail merely because there are more than 64 calls, arguments exceed 512000 characters or a valid tool index exceeds 4096. Tool identity, association, complete JSON and terminal receipts still determine execution readiness. Native output streaming retains response backpressure and stops at the protocol completion receipt. This change does not claim constant-memory handling of a single arbitrarily large JSON object: the current protocol codecs require the complete frame/request, and system memory remains the physical boundary.

Compatibility: no saved UI state, new selector or preference; ProcessSpec shape is unchanged and new factory declarations are additive. Focused validation covers 214 protocol/runtime/account/codec/compatibility cases, including both >32 MiB loopback gateway requests, three >32 MB provider streams with 66 large tool calls, >4 MB JSON, a 49 MiB process frame followed by another frame, >8 MiB outbound input, both SSH relay envelopes, owner decoding, Claude owner admission, plugin activation/interception/disable/reenable, cancellation and backpressure. Remote bundle digest/known-source migration and full build are verified. No real CLI model task, live SSH deployment, installed desktop or active-user UI acceptance is claimed.

## D033: discovered Claude local tool catalog (2026-10-03)

| Coverage | Call and result | Registration / replacement / production consumer |
| --- | --- | --- |
| Catalog selection | runtime.claude-tool-catalog.select(tools):readonly Record<string,unknown>[] | register(ClaudeToolCatalogSource {id,select}) returns cleanup; newest non-undefined selector wins. Service interception replaces selection. The production openOfficialClaudeTools uses this singleton for initial listing, cached definitions, list_changed refresh and actual call admission |
| Native calls | runtime.claude.openToolProcess(options), ClaudeToolServer.listTools/call/close | Existing process replacement remains available; selection only changes tools offered by this tool process, not native remote model/session ownership |

Example: api.onDispose(api.services.get('runtime.claude-tool-catalog').register({id:'plugin:'+api.id+'/catalog',select:tools=>tools.filter(tool=>tool.name==='ExampleTool')}));. Source receives actual raw definitions; undefined delegates. Duplicate IDs raise CLAUDE_LOCAL_CATALOG_DUPLICATE. Removing a source immediately restores cached catalog selection and later calls; active calls retain their original execution owner. Tool-list notifications still refresh actual native definitions. No new event, saved setting, UI surface or permission is introduced.

The fixed ordinary-tool allowlist and required complete file/shell set are removed. Newly discovered tools, WebFetch/WebSearch and partial native installations are usable without a core edit. LOCAL_CLAUDE_TOOLS remains an exported legacy list for source compatibility, no longer an admission list. Agent/Task/Skill/scheduler model and lifecycle operations remain bound to the existing native runtime; this local tool-only server still cannot initiate sampling or authentication. Unknown tool metadata does not grant read-only authority. Plugins can deliberately replace selection through their approved code lifecycle; this does not grant OS or remote tenant rights.

Validation: 25 synthetic MCP/catalog/hardening cases pass, including new ordinary tools, incomplete installation, actual calls, refreshed catalog and an approved ZIP plugin with registration, interception, disable and reenable. Type/plugin/docs/preference checks apply. Codex uses its native catalog and has no equivalent fixed Claude allowlist; no Codex protocol change is needed. No real CLI, model, live SSH, installed update or active desktop was exercised. Public declarations are additive and the contract snapshot is reviewed. No UI preference migration applies.

## D034: local tool capacity and scheduling (2026-10-03)

| Coverage | Call / result | Register / replace / real consumer |
| --- | --- | --- |
| Tool budgets | runtime.claude-tool-policies.resolve(input?:Partial<ClaudeMcpPolicy>):ClaudeMcpPolicy | register(ClaudeToolPolicySource {id,resolve}) returns cleanup; newest defined policy wins, explicit caller fields take precedence. Service interception replaces resolution; ClaudeBridgeService.toolPolicy consumes the production singleton before opening actual tool processes, queues and result stores |
| Execution and output | NativeClaudeService.openTools/openToolProcess/openResultStore/normalizeToolResult; ClaudeResultStore.put/read/close | Existing approved native service replacement/interception remains; the policy catalog provides granular new options without replacing the whole runtime |

Example: api.onDispose(api.services.get('runtime.claude-tool-policies').register({id:'plugin:'+api.id+'/capacity',resolve:()=>({commandConcurrency:2,inlineBytes:65536})}));. Zero means unlimited for frameBytes/outputWindowBytes/resultBytes/storedBytes/catalogPages/catalogTools/commandConcurrency. inlineBytes is a paging threshold, not a data-loss limit; zero pages all nonempty ordinary results. Defaults remove the 16/128/8/256 MiB wire/output/result/store and 32-page/512-tool caps, retain 1 MiB inline paging and four execution slots. Connections freeze their policy; disable/reenable changes later connections, never replays active work. Existing positive explicit policies remain honored. Invalid numeric values retain CLAUDE_LOCAL_POLICY_INVALID; duplicate registration returns CLAUDE_LOCAL_POLICY_DUPLICATE.

Command slots now queue with cancellation instead of rejecting busy calls. File operations retain their ordered native read/edit state and commands retain independent process trees. Queued cancellation never opens a process. MCP retains distinct in-flight IDs without a 64-request ceiling; duplicate IDs still fail. No fixed host request timer interrupts tool calls/catalog initialization; native tool arguments and explicit cancellation own duration. Catalog cursor/name integrity remains. Read normalization no longer rejects large text/image envelopes merely on size; base64 and image identity validation remain. Complete ordinary results persist in the session-owned result store and ReadLocalToolResult accepts caller-selected page sizes beyond 256 KiB. Images keep their native image blocks. There is no automatic command retry or result truncation. Explicit storage failure still reports that execution already returned.

Compatibility: policy fields and result/page shapes remain; zero now has documented unlimited meaning. No new UI control, saved preference, event, selector or migration. Plugin declarations and snapshot are reviewed. Validation: 29 MCP/capacity/catalog/hardening tests pass, covering 578 tools over 34 pages, a 17 MiB native frame, 9 MiB exact Unicode output, >7 MiB base64 image, 80 concurrent requests, duplicate IDs, explicit limits, approved production policy registration/interception/disable/reenable and cancelled queued execution. Codex keeps its own native tooling; no real CLI/model, live SSH, installed update or active desktop was used.

## D035: queued asynchronous local commands (2026-10-03)

| Coverage | Call / result / event | Registration / replacement / real path |
| --- | --- | --- |
| Async commands | ClaudeLocalTasks.start/output/stop/list/pending/subscribe/close; StartLocalCommand, LocalTaskOutput, StopLocalTask and ListLocalTasks via production MCP | runtime.claude-tool-policies registration controls commandConcurrency for newly opened LocalClaudeTasks; approved NativeClaudeService.openToolProcess replacement executes commands in the actual production bridge |
| Receipts | LocalClaudeTask.state adds queued; subscriptions report queued, starting, running and terminal transitions | Caller receives a stable receipt before queued execution. Duplicate requestId with identical canonical input returns that receipt; changed input retains LOCAL_TASK_REQUEST_CHANGED |

The 128-record/four-task admission failures, 600000 ms workbench maximum/default, 30000 ms wait maximum and arbitrary command/description/ID length limits are removed. Four remains the default execution concurrency; excess work queues. Explicit registered concurrency or zero/unlimited is supported through the D034 policy contract. timeout is forwarded unchanged when present; omission uses the official tool's native behavior, with no workbench deadline added. Native tools may have their own timeout semantics. Larger waitMs retains its actual duration across native timer intervals. Cancelling a wait does not cancel execution; stopping a queued receipt prevents process creation. Closing during startup waits for and cleans up the late process before finishing, without dispatching its command.

Example: api.onDispose(api.services.get('runtime.claude-tool-policies').register({id:'plugin:'+api.id+'/async',resolve:()=>({commandConcurrency:2})})); then invoke StartLocalCommand with a stable requestId and use the returned id with LocalTaskOutput. Existing callers remain valid; queued is an additive nonterminal state and callers must await a terminal receipt. No automatic model continuation/replay, new permission, persistent UI field, selector or control is introduced. Uncollected results retain the connection as before. Remote fixed tool guidance is synchronized in configuration revision 7; this is source-only, not deployment.

Validation: 49 distinct focused async/MCP/policy/SSH-controller/owner cases pass across the relevant runs. Coverage includes 140 receipts, exact large command/description values, a 900000 ms native timeout argument, omitted timeout, a wait exceeding native timer range, FIFO scheduling, queued stop, duplicate input, late startup cleanup and approved policy consumption through production StartLocalCommand. Type/plugin/docs/preference and remote-bundle checks apply. Codex native task behavior is unchanged. No live model/SSH, installed update or real user desktop was exercised.

## D036: readable skill source and syntax adapters, partial delivery (2026-10-03)

| Coverage | Call / result | Registration / replacement / actual path |
| --- | --- | --- |
| Skill compilation | runtime.claude-skill-adapters.load(ClaudeSkillAdapterInput,core):Promise<LocalClaudeSkillPlan> | register(ClaudeSkillAdapter {id,load}) returns cleanup; newest synchronously defined promise owns compilation. Undefined delegates, rejection never silently replays. Actual LocalClaudeContext.loadSkill validates discovery/hash/invocation before the registry and checks its lifetime after asynchronous completion |
| Resource result | LoadLocalSkill and MCP prompts return optional source and execution.nativeRequirements | Original full source accompanies readable instructions. Sequence argument lists, pwsh alias and exact custom effort tokens are adapted. Existing approved context service can replace resource discovery; the adapter is the granular syntax extension |

Example: api.onDispose(api.services.get('runtime.claude-skill-adapters').register({id:'plugin:'+api.id+'/syntax',load:(input,core)=>input.skill.name==='example'?core().then(plan=>({...plan,instructions:plan.instructions.replace('example-token','example-value')})):undefined}));. Duplicate IDs return LOCAL_SKILL_ADAPTER_DUPLICATE. Disable affects subsequent compilations; in-flight results retain ownership and still obey closed-context checks. Source/hash, native visibility, exact dynamic command and no-replay protection remain. Existing dynamic commands no longer have arbitrary invocation/output-count caps or an injected 120-second timeout. Explicit permission still comes from the existing MCP/OS owner.

hooks, isolation, background, inline model and unknown native syntax no longer prevent reading the whole skill. Requirements remain in source and nativeRequirements with an explicit unexecuted status. They are not silently treated as implemented, and loading a resource is not a completed native Skill invocation. Built-in remote/local lifecycle execution for those declarations is still outstanding, so D036 is not marked complete. No new restriction or approval flow is introduced. Codex already consumes its own native skills; no adapter change there. No saved UI node, event, selector, preference migration or real model request applies. The additive declarations and production service snapshot are reviewed.

Validation: 39 context and synthetic SSH-controller cases pass, including sequence arguments, shell alias, custom effort, readable lifecycle source, exact dynamic execution, user-only prompts, changed-source rejection and an approved syntax plugin through production MCP load, disable and reenable. No live native lifecycle, model, SSH deployment or installed desktop acceptance is claimed.

## D037: complete skill discovery and source access (2026-10-03)

| Coverage | Call / result | Registration / replacement / production consumer |
| --- | --- | --- |
| Native catalog and body | native-skills/list and native-skills/read({id,hash}); native.skills.scan/readMarkdown | Approved host extensions register interceptors or overrides on native.skills. NativeResources.call and composer discovery consume that same service. No new option catalog is required to remove a ceiling |
| Source sharing | native.skills.planLinks/applyLinks; existing typed SkillLinkRequest/Plan/Result | The same service replacement and host routes consume complete source hashes without a 256 KiB gate; link ownership and stale-plan checks remain |
| Claude local resources | LocalContext / LoadLocalSkill / prompts, LocalClaudeContext.discover/loadSkill | The existing context service and runtime.claude-skill-adapters own resource discovery and compilation. Their disposal and later-instance behavior is unchanged |

The former 8/5-level directory limits, 5,000/2,048-directory and 512-file limits, 32/64-ancestor limits, 256 KiB body gate, bounded frontmatter/name/description gates and display YAML/icon size ceilings are removed. Skill group directories are not rejected by their names or dot prefix. Discovery stops at an installed SKILL.md so its references, examples and nested fixtures remain supporting resources, not additional installations. Canonical paths terminate cycles and preserve origin aliases. UTF-8/NUL, actual file type, native visibility and current-source hashes remain data/permission contracts. Rules and local memory use the same uncapped walk but retain their existing source-selection conventions. No automatic script or model execution is added.

Example: api.services.intercept('native.skills','readMarkdown',async(next,...args)=>({...await next(...args),warning:'Extension annotation'})); followed by api.call('native-skills/read',{id,hash}). The approval lifecycle owns the interceptor; disable restores the original call and reenable reinstates it. Return signatures, persisted formats, selectors, events, settings and UI preference keys are unchanged, so no snapshot or preference migration is needed. Actual I/O/changed-source errors remain visible; capacity errors no longer occur solely from catalog or source size. In-memory scans still allocate full metadata and bodies; no constant-memory claim is made.

Validation: tests/skill-discovery-capacity.test.ts, tests/claude-local-context.test.ts and tests/native-skill-links.test.ts pass 39 cases; the optional installed CLI probe is skipped without an explicit executable. Tests cover both provider roots, large/long metadata, 70 ancestors, 5,005 empty directories, 521 Claude skills, nested supporting files, a cycle, large shared source, and an approved extension through the production host read/command/disable/reenable paths. Type/plugin/docs/UI-preference checks apply. No live model, SSH, deployment or user desktop interaction was performed.
