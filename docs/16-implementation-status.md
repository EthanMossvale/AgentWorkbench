# 16 · 实现与验收记录

## Image directory restriction removal (2026-10-03)

The user clarified removal of extra interception while retaining permissions, data integrity and duplicate-send protection. Attachment imports, source resolution and native activity previews no longer classify local files by workspace membership, credential-like directory names or workbench data roots. The earlier managed-workspace exception is superseded. Pasted images in the installed layout's clipboard temporary directory use the same snapshot path as other readable local images. No additional metadata whitelist is introduced. Existing local/remote ownership checks, I/O integrity, snapshot hashes, storage ownership, byte limits and send guards remain.

Both Claude and Codex have synthetic regression coverage for clipboard images, uploads, cross-directory images, symbolic links, absent workspace roots and persisted snapshots. The approved plugin lifecycle restores the new behavior after disable. No new adjustable UI state or contract signature is introduced. Validation: 48 relevant tests passed; type checking, plugin contracts, documentation, UI preference checks and production build passed. This entry records source and automated verification only; the running installation and live SSH/model behavior have not been accepted by this change.

## Device feedback remediation (2026-10-03)

The 0.1.6 device feedback was treated as evidence and proposals, not as instructions to edit another device, reset private state or deploy. The local implementation adds an explicit acknowledgement path for uncertain sessions while retaining unknown historical outcomes and preventing automatic replay. Runtime activity blocks acknowledgement. Missing terminal results are not inferred from a message boundary. Generic send failure text no longer blames translation.

Configured managed Claude/Codex workspace image paths can preview without opening credential/control directories. Owned attachment snapshots are metadata/hash verified. Bare code filenames remain text; explicit links and the existing known-path/structured-tool resolver remain available. Large-file diagnostics now direct native local workflows to full paths; byte/count limits and remote attachment transport are not expanded.

Translated-only reading and a one-command seamless preset reuse persistent settings. Failed translation retains the draft and offers a manually reviewed original-only preview, never an automatic raw retry. Public registration/replacement contracts, compatibility and preference inventory are in documents 36 and 37. Validation is tracked below; local source, synthetic protocol/UI checks, live native SSH behavior and distributed packages remain distinct. No remote deployment, real account repair or release is performed.

Validation: 55 focused tests passed across device feedback, activity images, attachment storage, file links/navigation and translation. Type checking, production build, plugin contracts, public documentation and UI preference gates passed. Hidden Electron acceptance passed five scenario groups covering both runtime recovery controls, translated-only reading with a file reader, manually reviewed original fallback, approved plugin activation/disable/reenable and later mounts, narrow dark rendering and full process restart. The test isolates confirmation calls in its synthetic renderer to prevent native dialogs appearing on the user's desktop. Screenshots were reviewed locally; no live SSH/model or other-device package acceptance is claimed.

## Third-party provider compatibility and retained connection edits (2026-10-03)

Model connections now preserve explicitly supplied API prefixes without appending `/v1`. Editing the address, protocol or upstream model retains manual reasoning levels, valid defaults and manual context settings while invalidating source-specific discovery and probe evidence. Omitted keys reuse the existing encrypted credential; saving a changed source atomically rebinds its scope, and an explicitly empty key still clears it. Revision checks, active-source protection and failed-save credential cleanup remain enforced.

The shared native gateway now translates Responses system/developer instructions into target system instructions, uses string content for text-only Chat messages, and does not impose required tool choice when adding the completion envelope. Explicit native tool policy and completion validation remain intact. These fixes address reproducible request compatibility failures across Codex and Claude; they do not establish which upstream parameter caused a particular private endpoint's HTTP 422. Interface, plugin lifecycle and persistence reviews are recorded in documents 36 and 37.

Validation passed: the complete suite reports 1,856 tests, zero failures and zero skips; plugin contracts, documentation, UI preferences and typecheck gates pass. Fourteen installed native CLI scenarios exercise Codex and Claude with synthetic providers; 24 isolated reasoning UI checks and four full-desktop groups cover protocol/address edits, key reuse, manual settings, full process restart and explicit clearing, with zero renderer errors. Approved synthetic ZIP plugins exercise the production model-connection service, runtime selectors, replacement, disable and reenable; regression coverage includes concurrent revisions, busy sources and credential rollback. Light and dark desktop screenshots were reviewed.

Evidence is isolated source, synthetic protocol, installed native CLI and hidden desktop acceptance. No real provider credential or user chat database was read, no authenticated third-party service task was run, and no live desktop installation or remote deployment is implied. Existing saved URLs are not silently rewritten; users can explicitly remove an unwanted version prefix.

## Complete native observation snapshot optimization (2026-10-03)

The earlier streaming optimization left the Codex observer snapshot guard outside its scoped commit. This follow-up includes that guard and direct regression coverage: threadless reasoning deltas retain bounded audit receipts without per-frame full-state reads, while local and SSH observers continue checking explicit thread identities and reject foreign frames. The existing Claude performance regression remains in scope. No account, SSH authorization, data location, UI preference or public contract changes. Interface and lifecycle review is recorded in document 36.

Validation passed: 70 focused tests across native observation performance, child conversations, generated images, the SSH Claude controller, native event routing, event semantics and event audit. Coverage includes approved synthetic plugin activation and policy restoration. Typecheck, plugin contracts, public documentation and UI-preference checks passed. Review found no new core-only extension branch, hardcoded catalog, named surface or persisted format. No desktop installation, real-model task or remote execution is implied.

## Program updates preserve the current data location (2026-10-03)

The installed bootstrap unconditionally attempted to relocate old workspace/tool directories. Coexisting old and current Claude tool-profile directories, including empty ones, could raise APP_DATA_LEGACY_MIGRATION_FAILED before the renderer opened. A program update is not authorization to move data. Startup now reuses the selected or recognized existing profile in place, leaves auxiliary directories and aliases untouched, and creates a default only for a fresh installation. Automatic conversion of old generated profile locations is removed. Explicit pending user-requested relocation retains its existing transactional path.

Scope: packages/app-data/index.ts and its bootstrap tests; public contracts and the UI preference inventory are reviewed in documents 36 and 37. No account credentials, chat stores, native CLI installations or remote configuration are edited. Validation distinguishes synthetic bootstrap and approved-plugin coverage from an installed desktop reaching its actual main renderer.

Validation passed: 25 focused data-directory tests, including approved ZIP activation/replacement/disable/reenable; seven real Electron bootstrap checks; typecheck/build, plugin contracts, public documentation and UI-preference checks. The updated Windows package passed six isolated account-selector checks for Claude and Codex. Installed executable/archive hashes matched that package. Two complete launches of the installed desktop reached a visible main renderer with loaded state; the selected data directory and location-file bytes remained unchanged. No paid model request, other-device acceptance, remote deployment or push is claimed.

## SSH paths, Windows ACLs and truthful connection errors (2026-10-02)

The prior profile migration remapped general file paths but omitted host `identityFile` and `knownHostsFile`; Node copies also inherited destination Windows ACLs. A copied key could therefore be both referenced at a retired location and rejected by OpenSSH for excess access. Migration now rewrites both owned references and copies into an owner-only staging root; old cleanup journals refuse to delete a still-referenced source. Portable import/export and legacy enrollment explicitly protect application-owned key files and directories, including resumed devices. External user-selected keys and remote policy are unchanged.

The native model control path now checks SSH failure before parsing service JSON. Banner timeouts are reported as SSH handshakes rather than invalid model receipts. Workspace import exposes allowlisted stage diagnostics, preserves device keys, and confirms a lost enrollment response with one read-only identity probe without replaying enrollment. No new provider, preference, credential channel or server deployment is introduced.

Validation is scoped to the isolated candidate: migration/memory and actual Windows OpenSSH ACL tests; portable/legacy enrollment, expiry, controller import, native catalog and account-control regressions; approved synthetic plugin consumers and hidden desktop restart checks. Production checks separately exercise the installed/source entry points and read-only account/model/usage APIs. A repaired local connection returned account metadata, fresh usage and a native model catalog; intermittent SSH banner failures remain a transport boundary and are not evidence of a malformed model service or successful other-device enrollment. No paid model task or remote deployment is part of this repair. Validation passed: 111 distinct focused tests across migration, ACL, enrollment, catalog and service suites; four real Electron bootstrap checks; seven approved-plugin workspace UI checks; five SSH model-menu checks; typecheck, plugin contracts, public documentation, UI preferences and Windows packaging. The model-menu fixture explicitly classifies runtime/models as read-only metadata while still refusing task creation and submission.

## Startup recovery after profile relocation (2026-10-02)

A relocated profile retained memory delivery receipt paths under a removed historical root. `MemoryExchange.initialize()` correctly rejected those paths, but the failure stopped the desktop before the main window was shown. Building successfully or observing Electron processes did not prove that the existing profile could start. Local recovery rebased only verified delivery-path metadata after preserving the original ledger; it did not reset memory, mark pending deliveries as received, or move the profile again.

The source fix makes Windows source and installed launches consume the same existing per-user locator while retaining fresh-development and explicit-override behavior. Relocation now validates destination receipt ownership before publication/source retirement, preventing an already inconsistent ledger from being carried into another destructive cleanup. Existing receipt validation stays strict. Plugin contract and UI preference reviews are recorded in documents 36 and 37.

Validation: 32 data-directory/memory-migration tests plus 70 related service, memory receipt/background/consolidation and UI preference tests passed (102 total). Real Electron bootstrap checks cover consecutive moves, acknowledged and missing pending receipts, retained archive bytes, unsafe path rejection, source/installed singleton ownership and corrupt locator preservation. Six approved-plugin desktop checks passed, including service consumption, later surface mounts, disable/reenable and process restart. Typecheck, plugin contracts, documentation and UI preference gates passed. A clean candidate was packaged, its installed application archive was hash-matched, and two complete installed launches reached a visible main window with recovery `ready` and the selected profile. The actual `Start-Dev.cmd` rebuilt the shared source and opened a responding visible window against that same profile. Its unrelated preexisting working-tree edits were preserved and excluded from the candidate and scoped commit. These startup checks do not claim real Claude/Codex model or SSH execution; no remote deployment or publication was performed.

<!-- recovery-presentation-20261002:start -->
## Recovery panel focus coalescing (2026-10-02)

The independent plugin-recovery guardian now separates automatic incident presentation from explicit user requests. Repeated snapshots, heartbeat-derived incidents and safe-mode notifications consume one automatic presentation per guardian lifetime; an existing panel is not repeatedly focused, and closing it suppresses later automatic refocus. `plugin-recovery/show`, the diagnosis menu and in-panel recovery actions still reopen it explicitly. No preference, profile or release payload changes.

Validation: `tests/plugin-recovery-presentation.test.ts` executes the production guardian bundle with a synthetic BrowserWindow and confirms one automatic show, no show after dismissal, explicit reopen, safe hidden QA behavior and a fresh-process show; `npm run test:plugin-recovery` passed all 17 checks; typecheck, plugin, documentation and UI-preference gates passed. The probe is isolated process evidence, not visible installed-desktop acceptance.
<!-- recovery-presentation-20261002:end -->

<!-- startup-appearance-20261001:start -->
## Startup appearance restoration (2026-10-01)

Fixed the first-window light flash: document load no longer reveals the desktop before asynchronous state hydration. First presentation joins document/window-state restoration with core readiness and completion of approved renderer plugins, including discovery that arrives after core readiness. Theme mode and palette application run in React layout effects; two rendering frames precede the one-time reveal. Later state changes and plugin reactivation do not refocus the window. Failure keeps the existing independent recovery guardian available and reports `WORKBENCH_PRESENTATION_FAILED` if frame preparation fails.

Validation: 27 focused first-presentation/appearance/preference tests and 21 recovery tests; 33 existing hidden Electron appearance checks; `scripts/test-startup-appearance-ui.mjs` bundles production host, preload and renderer into an isolated candidate and intercepts OS show/maximize/fullscreen reveal operations. It verifies fresh light defaults, a remembered dark preset, complete process restart, maximized/fullscreen restoration after palette readiness, delayed state and plugin discovery/activation, approved plugin palette on first presentation, disable/reenable without preference loss or repeat reveal, missing-plugin fallback, and current OS system policy. This is first-show decision/computed-style evidence, not a visible user-desktop or packaged-installer pixel capture. Both native runtimes share this shell; no Claude/Codex model or SSH task is involved. Typecheck, plugin, documentation and UI-preference gates are required. Existing concurrent changes are outside this fix's acceptance claim.

`Start-Dev.cmd` and the packaged application use the same production entry points, so packaging alone would have preserved the old bug and subsequent builds include this correction. No installer, release, real profile, native client or remote device was modified. Public contracts and preference inventory are reviewed in documents 36 and 37.
<!-- startup-appearance-20261001:end -->

<!-- memory-ssh-receivers-20261001:start -->
## SSH memory receiver repair (2026-10-01)

The saved native default could resolve an SSH model, while the background executor rejected every `hostId`. Both SSH runtime paths now use their existing native transports with a private session and device-local scoped memory tools/storage. The frozen account/model/effort/permission are retained; foreground sessions are not created or mutated. Codex background cleanup closes only its own session. Host removal/maintenance observes background reservations, interactive tasks stop without automatic approval, and native/cleanup uncertainty cannot become successful completion. Identical unsupported jobs are deduplicated across restart, with explicit recovery when an executor becomes available. Separate legacy provenance conflicts remain protected and are not automatically repaired by this routing change.

Isolated candidate validation: 211 passed, 0 failed, 1 skipped across 212 scoped tests covering memory/background/receipts/consolidation, local account/provider execution, SSH controllers, maintenance/retention and UI preferences. The skipped installed-Codex config API probe reported its runtime unavailable; synthetic native-config cases still ran. Twelve SSH cases include both actual native protocol adapters, the authenticated local Claude MCP HTTP gateway, verified local references, read-only refusal, cancellation/approval/failure, changed-identity rejection, uncertain cleanup and approved ZIP executor replacement/disable/reenable. No live SSH or paid model request was made. Test files use isolated synthetic profiles and do not edit user memory. Public interface and persistence review is in documents 36 and 37. Production desktop replacement, real backlog processing, live remote acceptance and release/deployment remain outside this evidence.

TypeScript, plugin declaration review, public documentation checks, UI preference inventory and production build passed in the isolated candidate. Existing runtime font and bundle-size advisories remain. The final permission test also explicitly exercises Codex read-only and Claude plan without starting a model transport. Other windows' unfinished changes are excluded from this validation and commit scope.
<!-- memory-ssh-receivers-20261001:end -->

<!-- ssh-account-dialog-status-20261001:start -->
## SSH official account cards and unpublished login drafts (2026-10-01)

SSH accounts reuse the model settings AccountCard, quota-window and ModelUsageSummary components. Native-owner usage is attributed to the full authority/catalog/provider/account generation reference, including retained observations after chat deletion. Codex device authorization and Claude remote-browser login run in dialogs. Claude preparation stays hidden from public catalogs and member authorization; only verified authentication plus confirmed native/browser cleanup publishes the account. Cancellation/failure removes unpublished metadata while preserving native profiles. Legacy public accounts and legacy create methods remain compatible. Missing official quota remains unknown; token statistics cover workbench observations only.

The isolated task candidate passed 145 focused regressions (broker restart/publication/cancellation, account access/control/usage, browser lifecycle, model usage and metrics), typecheck, plugin contract review (342 declarations, 308 methods after integration with the current committed base), public documentation, UI preference inventory and production build. The remote bundle revision/digest is updated; existing font/chunk advisories remain. Linux-only configuration lifecycle checks were not run on this Windows host. The approved ZIP lifecycle test exercises preparation interception, actual controller/browser consumption, disposal and reactivation. Hidden Electron verifies both login dialogs, cancellation/failure without a new card, successful publication, shared usage, light/dark/narrow layouts and preferences after full process restart. Evidence is synthetic and local: no real credentials, live SSH login, user-profile changes, foreground desktop replacement, remote deployment or release is included. The remote draft protocol requires the updated broker/browser source to be deployed separately; unsupported brokers fail without creating a public slot. API and persistence reviews are in documents 36 and 37.
<!-- ssh-account-dialog-status-20261001:end -->


## Per-chat translation call budgets (2026-10-01)

The translation call cap now applies independently to each workbench chat. Input, output, refinement, questions, plans, child overlays and annotations pass an explicit owning chat ID. Counts are saved before admission, survive restart and module/model changes, and start at zero for a new chat or fork. Existing limit values and unlimited default 0 remain unchanged. The settings label and budget error now describe chat scope. Plugin entry points, compatibility and migration are recorded in document 36; persistent owners are inventoried in document 37.

Focused synthetic regressions cover independent chats, concurrent admission, restart, invalid persisted counters, unlimited mode and approved ZIP provider activation/disable/reenable, together with existing translation consumers. The isolated candidate passed typecheck, build, check:plugins, check:docs, check:ui-preferences and 170 related tests. Hidden Electron passed eight checks, including saving the cap through the settings UI, independent new-chat allowance and preserved old-chat exhaustion after complete process exit. The existing UI fixture now returns synthetic English instead of echoing Chinese, consistent with the input-language gate. The captured dark/narrow settings view was visually inspected. Initial shared-tree checks encountered unrelated in-progress type/contract changes; candidate results do not certify those concurrent changes. No paid model, live user profile, running desktop, remote deployment or release package is part of this acceptance.

<!-- model-switch-continuity-20261001:start -->
## Model switching latency and context continuity (2026-10-01)

Claude and Codex share immediate model/effort selection feedback, serialized latest-choice persistence and per-model capacity retention. Model changes no longer delete used context or trigger repeated remote discovery; same-source target switches retain the native thread. The native adapters record receipts through one typed service. Inferred carryover is labelled until a new receipt arrives, and 1M returns with a previously confirmed model capacity. Unknown capacity and native reset boundaries remain explicit. Warm shutdown is removed from the selection critical path; prewarming is debounced and actual submission still revalidates its selected transport.

Acceptance locations: context usage regressions, SSH Claude/Codex controller fixtures, preparation lifecycle tests and hidden full-app `scripts/test-model-switching-ui.mjs` with an approved synthetic plugin. Required type, contract, docs and preference gates run against a task-only candidate excluding concurrent changes. Plugin and UI persistence inventories are in documents 36 and 37. Source/protocol/isolated UI evidence does not replace real model/VPS timing or update the existing foreground executable. No remote deployment or live model task is performed.

Validation: the isolated candidate passed the full test suite, TypeScript/build, plugin contract, public documentation and UI preference checks. Approved hidden Electron acceptance passed for both SSH runtimes with model/effort save responses deliberately held, last-choice coalescing, failure rollback, model-specific capacity restoration, complete process restart and narrow layout; the screenshots were visually inspected. Existing font-resolution and bundle-size build advisories remain. Concurrent unfinished account, translation, media and browser edits are excluded from this change.
<!-- model-switch-continuity-20261001:end -->

<!-- runtime-context-repair-status-20261001:start -->
## Runtime/context and SSH workbench tool repair (2026-10-01)

Scope: restore destination model/effort/Fast independently by runtime; connect native official/SSH context-window receipts to the displayed capacity and 1M label; preserve partial LocalContext discovery; require English input translation on explicit sends and recovered retries; connect all 10 existing workbench model tools to SSH Claude's authenticated local MCP server, including independent sidebar chat creation. Original draft text remains local editing/history data. Existing native subagent tools are preserved. Public/plugin and persistence review is recorded in documents 36 and 37.

Isolated candidate evidence: 1676/1676 full tests passed with the repository acceptance-pinned Codex runtime; 12 hidden Electron cases passed, including an unsuffixed native 1M receipt, retranslation after recovery, per-runtime restoration, full process restart and approved plugin disable/reenable. The authenticated local HTTP MCP test invokes the production controller, compares the complete workbench tool inventory, creates and reads an independent sidebar chat, rejects invented authorization, and proves duplicate-call idempotency and live plugin removal. TypeScript, plugin contract review (338 declarations, 304 methods), public docs (46 files, no findings), UI preference inventory and production build passed the final gates. Existing font/chunk-size build advisories remain. Test fixtures were updated where their prior raw-Chinese bypass or echoed translation behavior was intentionally removed. No production desktop replacement, real model request, native client modification, remote deployment or release package is included. Other windows' unfinished changes are excluded from the candidate.
<!-- runtime-context-repair-status-20261001:end -->


<!-- context-annotations-20261001:start -->
## Selected context annotations (2026-10-01 JST)

Conversation Markdown selections from either the original or translated pane now offer Add to conversation. The composer holds multiple editable/removable excerpts in a count capsule; sent user messages and queued-message details retain read-only capsules. Input translation processes the body and each excerpt as separate named segments, retaining the selected text and submitted translation. Paused/disabled translation sends original excerpts. Annotation-only submissions, edit/resend cancellation, user-message forks, pending preview invalidation and stale revision rejection are included. No action initiates a task until the normal explicit send/confirm path.

Follow-up correction: each annotation now displays its Chinese reading translation below a horizontal divider within the same numbered item. Reading translation is stored independently and never added to the runtime prompt. Selected Chinese text is translated during preparation and requires preview confirmation even with auto-submit enabled; missing/failed translation retains the draft, and stale or paused reading results cannot overwrite newer data. The actual sent message retains the selected original and submitted translation in one capsule. The saved auto-submit preference is unchanged.

The production host service `composer.annotations`, renderer `annotations` API/action registry and three named UI surfaces support calls, registration and narrow replacement. Session drafts use versioned local state with revision checks; disclosure and editor resizing use shared preferences. Unknown/corrupt draft records remain on disk. API/persistence coverage and migration are recorded in documents 36 and 37; snapshots include the additive contracts.

Scoped source/protocol regressions: 118 tests passed, covering annotation state/translation/submission, native/API/plugin runtime regressions, queues, forks, translation controls, composer skills, approved plugin lifecycle and UI preferences. The independent hidden Electron production build passed 14 interaction scenarios with zero renderer errors: actual mouse text selection plus translated selection, multiple excerpts, editing/deletion, full exit/restart, capsule history and clear-on-success, edit/cancel, approved ZIP action registration/override and named surface replacement, current/later instances, disable/reenable with late asynchronous result rejection, translated previews and stale preview cancellation, and light/dark compact geometry. Light bilingual, same-item reading translation, Chinese submission preview, sent paired capsule and dark compact screenshots were inspected. Plugin contracts, public docs, UI preference inventory and TypeScript checks passed. Existing font URL and bundle-size build advisories remain.

Validation found and repaired a second raw-input equality check that rejected annotated direct sends; scrolling now updates the selection toolbar position. Fixture timing/IPC names and a disclosure assertion were corrected during the UI run; earlier failures are not counted as passes. QA data and packages live only under ignored `build/qa/context-annotations/`. The candidate excludes other windows' unfinished work. No full repository test run, real provider/model request, foreground user-client rebuild/restart, installer/update package, push, release or remote deployment is claimed. Source/protocol and hidden desktop evidence do not substitute for real user desktop or provider acceptance.
<!-- context-annotations-20261001:end -->

<!-- native-tool-image-token-audit-20261001:start -->
## Native tool-image token inflation repair and large-paste handling (2026-10-01 JST)

Source inspection and offline reproduction confirmed two cross-protocol defects: Responses tool-result image arrays became ordinary JSON text including Base64, while Claude tool-result arrays lost their images. The mapper now retains typed image blocks, places all tool results before Chat user-image attachments and preserves tool-call attribution. Same-protocol traffic remains transparent. Cross-protocol text fields now accept strings only; malformed object envelopes are rejected before upstream dispatch instead of being JSON-stringified into model prose. Legitimate JSON, INI, source code and other long strings remain unchanged.

The composer now follows the large-paste optimization requested for this audit: a plain-text paste whose UTF-8 encoding exceeds 100,000 bytes is imported through the existing verified attachment store as `pasted-text.txt`, and only its metadata/path enters the model prompt. Smaller text remains normal composer input. The same attachment policy applies to dragged or selected UTF-8 JSON, INI, source and TXT files: text up to 100,000 bytes may be included in the manifest, while larger text stays a metadata reference. ZIP and other binary files stay metadata references; images use typed image inputs, and API PDF inputs use typed file/document fields where the destination protocol supports them. The native cross-protocol mapper does not invent a document representation and rejects unsupported typed content before an upstream request.

The scoped audit also checked cumulative native deltas, duplicate stream frames, gateway/native double counting, cache-subset accounting, attachment construction, visible handoff, native shared-context injection and explicit-turn admission. No additional inflation defect was reproduced in those audited paths. A 143-request synthetic regression exceeds 40M cumulative tokens while every request stays below 1M, verifying the distinction between cumulative usage and context capacity. Some failed conversions/streams lack complete usage receipts, so the aggregate is not a settlement ledger. This repair does not reduce/reset historical usage, and attachment construction does not guarantee that a native model will read a large file only once.

Private diagnosis retained only usage numbers, structural lengths, timestamps and fixed error codes in an ignored local directory; no credentials, conversation bodies, image bytes or real private identifiers enter source/docs. The related Claude MCP normalization remains a separate logical change and is not used as a token-saving claim here. The renderer media API adds a bounded text-paste policy surface so approved plugins can lower the attachment threshold with explicit cleanup; the core 100,000-byte ceiling remains the default.

Validation: the independent candidate passed the focused native image, attachment and mapper regressions, TypeScript and public documentation checks. The new attachment regression uses multi-megabyte JSON, INI, TypeScript and ZIP fixtures and verifies that no text body is placed in the manifest. A UTF-8 threshold regression covers 100,000/100,001-byte text and non-ASCII text; policy registration, bounded override and cleanup are covered by the real registry. Hidden Electron clipboard regression `scripts/test-drag-attachments-ui.mjs` passed **16/16**, including large plain-text paste to `pasted-text.txt` with an empty composer. The approved renderer plugin integration exercises the bounded policy in the live composer and its disable cleanup. No real model request is required for these checks.

The public OpenAI Codex CLI reference documents explicit image attachments (`--image`); it does not establish a public universal threshold or guarantee for automatic large-text-to-TXT conversion. The workbench behavior above is therefore an explicit compatible product rule, not a claim about an undocumented Codex implementation. No real model requests, active-client rebuild/restart, push, release or remote deployment are performed.
<!-- native-tool-image-token-audit-20261001:end -->

<!-- translation-footer-20260930:start -->
## 会话底部翻译开关与侧栏标识（2026-09-30 JST）

按用户修订移除 Workbench 文字左侧的 Logo 实例，原生窗口与托盘仍保留 B 方案。中途消息翻译从右上角移至会话输入框下方，统一按“关闭翻译 → 翻译后直接发送 → 翻译中途消息”排列；双栏和行内共用该控件。缩短文案不改变原有可恢复暂停、模块主开关、已有译文或全局记忆。窄窗口使用已有换行布局，统计信息可移到下一行。

先行接口审查、调用/注册/替换矩阵、迁移说明和生命周期见文档 36；具名 translation-intermediate、translation-toggle、sidebar 入口与宿主命令保持，未新增配置、事件或公开签名，也未刷新契约快照。文档 37 记录原有状态归属与具体排除项。实际批准插件的替换验收发现 flex 样式覆盖原生 hidden；已增加仅针对该底部控件的 hidden 规则，停用恢复原控件。

限定候选基于已提交树 `7dc26c9`，排除其他窗口未提交工作：源码/协议 54/54、隐藏生产布局与插件生命周期 6/6、图标回归 10/10、真实 renderer 合成宿主控件回归 20/20 通过。覆盖深浅色、双栏/行内、1440/860 宽度、开关排列、全局状态、暂停/恢复、模块关闭、批准插件当前/后来实例、停用/重启恢复，以及草稿保留、保存失败和待保存交互；无 renderer 错误。已查看深色双栏与浅色窄屏截图。生产构建通过；交付前对齐已提交树 `f0cb584`，相关产品源码无交叉差异，重新运行类型、插件（272 声明、294 方法）、文档（46 文件、零发现）和 UI 偏好门禁（41 key、42 hook、39 节点）通过。字体协议和大 chunk 提示是既有提示。

首次归档候选暴露 SVG 被 Windows Git 转成 CRLF 后的源码哈希差异；补充 SVG 的 LF 仓库约定，图像数据和原生图标没有变化，回归通过。尺寸验收使用相邻既有开关的实际尺寸，未重新指定产品开关大小。证据保留在已忽略的 `build/qa/translation-footer/`。未运行全仓测试或旧翻译模块脚本全集；其旧文案断言已同步。未调用真实模型、读取真实用户资料、更新正式 dist、操作活动客户端或发布部署；隐藏测试不替代用户桌面与安装包验收。
<!-- translation-footer-20260930:end -->

<!-- translation-selector-label-20260930:start -->
## 翻译模型选择器名称去重（2026-09-30 JST）

根因是 API 目标的 description 已包含“来源 · 模型 ID”，界面再次追加相同的 name。现在只在完整名称已处于描述末尾时省略重复追加；不同别名、官方账号来源、同名但不同来源的独立选项和不可用提示保留。仅修改派生显示，不更改目录原始字段、稳定 targetId、已保存选择或实际执行模型。

先行接口与兼容审查、覆盖矩阵见文档 36，偏好清单见文档 37。基于已提交树 `7dc26c9` 的限定候选验证：相关源码/协议回归 60/60、隐藏生产 Electron 检查 7/7、renderer 错误 0；覆盖实际核心目录、不同来源同名模型、批准 ZIP 注册及执行、现有/后来界面实例、停用/重新启用和完整退出重启。浅色与深色窄窗口截图已查看，选中模型均只显示一次。首次新增不可用选项检查使用框架的 `isDisabled()` 得到 false；改为读取原生 `option.disabled` 后通过，未因此修改产品禁用逻辑。

类型检查与生产构建、插件契约（272 声明、294 宿主方法）、文档检查（46 个文本文件、零发现）、UI 偏好门禁（41 个类型 key、42 个 hook、39 个具名节点）通过；构建保留既有字体协议和 chunk 大小提示。证据位于已忽略的 `build/qa/translation-selector-label-20260930/`。仅使用隔离合成 profile 和一次回环 API 请求；未运行全仓测试，其他窗口未提交工作不纳入本次范围。未操作真实用户客户端、更新正式 dist、调用真实模型、打包、发布或远端部署；源码修复不表示当前运行窗口已更新。
<!-- translation-selector-label-20260930:end -->

<!-- connected-w-branding:start -->
## B 方案连笔 W 标识（2026-09-30 JST）

采用已确认的深褐底 `#30201A`、珊瑚 `#FF9676` 与杏色 `#FFDAAB` 连笔 W。统一源码 SVG、16–256 像素 PNG 和多尺寸 ICO；侧栏/原有 Mark、原生窗口与托盘消费同一身份。窗口此前没有设置 icon，现显式使用产品图标；主题、窗体尺寸和用户偏好不随图标改变。ICO 是源码资源，本轮不修改已安装可执行文件或固定快捷方式缓存。

先行接口审查、调用/注册/替换矩阵与兼容说明在文档 36。批准的宿主插件通过 `api.branding.get/list/register/subscribe` 进入实际 PluginRegistry，驱动窗口、托盘及已挂载/后来挂载的 Mark；新增 `branding/get`、`branding/list` 和 `brand-mark` 具名界面挂载点。注册验证图片格式与界限，支持多插件非后进先出释放、激活失败清理、停用恢复、迟到调用拒绝及旧初始读取保护。契约快照只增加相关类型、成员、读方法和 surface。没有新增可调控件或 Logo 选择器；已有插件批准/启用状态在重启时重建贡献，文档 37 记录现有偏好归属和具体排除理由。

原候选基于已提交树 `bd4fd58`，随后对齐已提交树 `c6758e1` 的限定候选，排除其他窗口未提交工作。最终专项源码/协议回归 58/58、隐藏生产图标验收 10/10、通用插件回归 12/12 通过，图标验收无 renderer 错误，深浅色截图已查看。图标验收覆盖深浅色/窄布局、原生窗口设置调用及实际图片像素、托盘分辨率、真实批准插件生命周期、动态实例、迟到读回、完整进程退出重启和既有侧栏偏好保留。类型检查、生产构建、插件契约（261 声明、293 宿主方法）、文档（46 个文本文件、零发现）与 UI 偏好门禁（41 个类型 key、42 个 hook、39 个具名节点）通过；构建保留既有字体协议及 chunk 大小提示。通用插件首次回归在重启后立即导航设置时与持久页面恢复竞争；测试改为等待已恢复的具名页面控件，保留原断言，独立重跑通过，未修改产品逻辑或放宽超时。

没有运行全仓测试、真实模型或远端任务，也没有更新正式 dist、操作活动客户端、读取真实用户账户或发布安装包。证据留在已忽略的 `build/qa/branding-b/`。隐藏 Electron 和原生图片验收不等于前台操作系统任务栏、打包资源或安装升级验收；源码完成不表示已运行窗口即时更新。
<!-- connected-w-branding:end -->

<!-- inline-visualizations-status-20260930:start -->
## 回复内交互展示（2026-09-30；U120）

此前只有 HTML 文件侧栏预览。本次新增明确的可视化回复标记，主回复、译文和原生子会话可直接运行隔离 HTML，支持方案轮播、表单控件及脚本图表。普通 HTML/代码示例仍保留字面文本；原始消息与翻译保护保持。页面不获得主应用、Node、网络或系统权限。

具名 renderer 目录同时驱动插件接口、实际选择器和 iframe 消费；调用/注册/替换、异步失败与释放、全部动态实例、批准激活和停用恢复已接入。源码模式、renderer 选择和页面主动提交的 JSON 状态进入共享用户偏好，以会话和规范文件路径作用域恢复，重启不会自动发模型任务。英文能力说明通过原生启动/API 和既有 Codex SSH 桥提供；没有写入原生用户配置或另建 agent loop。

最终候选对齐已提交基线 `2b479bf`：全套 1,480/1,480、零跳过；原生展示专项 8/8（实际安装 Codex 0.159.0 / Claude Code 2.1.284，临时 Home 和合成上游）；重建隐藏生产 Electron 18/18、无 renderer 错误，覆盖可信鼠标/键盘输入、真实退出重启、原文/译文/两家子会话、批准插件生命周期和深浅/窄屏。类型、插件契约、文档与 UI 偏好门禁通过。全套沿用既有验收 Codex 0.155.1 原生技能配置夹具；0.159.0 的既有配置写入失败和并行检查中的一次进程清理失败、独立重跑结果均见 [本轮记录](inline-visualizations-20260930.md)，不冒称全仓新版 CLI 或任意并发负载兼容。其他窗口未提交工作不在验收范围。

本次仅本地代码/文档与提交，未覆盖正式构建、操作活动客户端、读取真实用户聊天或凭据、调用付费模型、推送发布或部署 VPS。源码完成不表示当前运行窗口已更新。
<!-- inline-visualizations-status-20260930:end -->


<!-- ui-persistence:start -->
## UI preference persistence and clean release defaults (2026-09-30 JST; U118)

The reviewed inventory in document 37 covers native geometry/state/zoom, sidebar and reader splits, translation visibility, connection panes, navigation/settings tabs, reading modes, per-entity disclosures, file-tree expansion, image zoom, and user-resized editors. Existing appearance, ordering, shortcuts, and model selection retain their existing persistent owners. The new catalog has 37 typed keys; the static inventory verifies 37 preference hooks and 39 named native disclosure/editor nodes. Legacy public-progress buttons are included, and child/remote account scopes use actual entity identities. Transient menus, approvals, reveal toggles, unsaved contents, and measured composer height remain explicitly excluded.

Preferences live in a versioned device-local file outside application code. Per-key revisions reject stale updates, rapid drag changes coalesce, and graceful shutdown drains the renderer and host queues. Responsive fitting and missing displays change only effective geometry. Corrupt/future files are preserved with visible failure status. Old sidebar/address-mask values migrate once; explicit reset tombstones prevent reimport. Product defaults are constants, never sampled from developer profiles. AGENTS.md now makes UI persistence a same-level delivery gate with plugin adaptation; the standard verification script runs both gates.

Interface review and the coverage matrix are in document 36: the production typed renderer API supports call/register/override/subscription; actual host services support window/store replacement. New declarations, the optional account preference scope, three host methods and one named status surface were reviewed in the contract snapshot. Existing control tags, classes and named surfaces remain; temporary plugin absence preserves saved IDs. Restored wide review panes exposed an asymmetric minimum-column layout; the two side columns now share the same minimum so the activity capsule remains centered. This is derived geometry and retains existing extension surfaces.

Final source/protocol, TypeScript, plugin/documentation/inventory checks use a scoped candidate from committed base 43026be plus only this change, excluding other windows' uncommitted work. The production build and 22-case preference acceptance were rerun on the scoped 342f7a3 candidate; the later baseline commit changes remote login parsing, not these UI paths. The additional specialized UI regressions below were completed earlier on the scoped 66a7c08 candidate:

- Full source/protocol suite: 1434/1434 passed, zero skipped, using the previously verified Codex 0.155.1 binary for the suite's isolated native configuration test. The first run selected a different desktop-bundled executable from PATH and that configuration test failed; the mismatch is recorded rather than hidden or fixed by weakening assertions. This is not verification of that other binary's memory support.
- New persistence/window tests: 12/12 passed, including revision conflicts, damaged/future data, namespace lifecycle, queued stale writes, missing-monitor fitting, maximized/fullscreen state capture and restoration, and listener disposal. Maximized/fullscreen assertions use the production manager with native-event fixtures, not a visible user window.
- Hidden production Electron preference acceptance: 22/22 passed, with real process restarts, final-change exit, normal window geometry/zoom, actual splitters, code wrap, file tree, source tabs, legacy progress, textarea drag handles, clean second profiles, migration/reset, corrupt-file UI, and no user profile in the isolated code build. Approved ZIP plugins cover registered preferences, mounted/later consumers, native host replacement, multi-plugin ordering, failed activation, late cleanup, disable/reenable and package removal.
- Hidden regressions: event/group/plugin lifecycle 20/20, file-review/reader 16/16, image/attachment interaction 19/19, child reader 14/14 (four synthetic loopback translation requests; no real model). Test harnesses now initialize the preference owner; the image fixture releases every synthetic delayed read instead of overwriting a single resolver. Light and dark narrow preference views and the corrected narrow reader screenshot were inspected.
- TypeScript, public documentation checks, UI inventory, plugin contracts (236 declarations; 285 host methods), and isolated production build passed. Build output retains the preexisting font-protocol and bundle-size notices.

Evidence is in ignored build/qa/ui-persistence-work/candidate/build/qa directories. No active desktop, real account profile, credentials, real native-memory profile, paid model task, production dist or remote deployment was changed. Installer/update format, signed distribution, real display hot-plug, OS-forced termination durability and package upgrade acceptance are not claimed. Public vendor distribution/update documentation is recorded separately in document 07; it does not select an AgentWorkbench release channel. Only a local scoped Git commit is authorized here.
<!-- ui-persistence:end -->

<!-- memory-receiver:start -->
## 接收方各自归纳的职责修正（2026-09-30 JST）

修正之前默认模型“一个会话替两家接收”的设计：工作台只统一调度；Codex 和 Claude Code 分别在自己的原生后台会话中接收对方来源，各用该运行时在新任务选择器中明确保存的默认目标、模型和思考档位。缺失默认值不推断对应账户或模型；原生关闭、权限不足和执行位置不支持继续保持待收。

后台冻结两方清单并串行执行，宿主 read/store/verify 按接收身份隔离。第一方启动后失败或中断不自动派发第二方；取消收集中的调度、插件执行器释放和迟到工具调用均有验证。旧任务/回执保留，不把历史单会话记录误报为由各接收方完成。短入口与受管引用路线保留，仍不冒称官方自动记忆归纳。

验证使用基于已提交树 `66a7c08` 的限定候选，排除其他窗口未提交工作：

- 全量单元/协议测试 **1405/1405**，零跳过；最终使用 `node --import tsx --test --test-concurrency=4 tests/*.test.ts`。其中本次 consolidation 接收方测试 19 项，覆盖 136 份串行积压、默认模型及档位分离、跨方向拒绝、冻结清单、失败停止、收集/权限检查期间取消、插件释放与恢复。
- 两家已安装 CLI 的隔离协议/文件发现 **4/4**；各自只存本方应收档案，另一方保持待收，新项目经原生文件工具读到已保存主题。回环模拟推理不调用真实模型账户。
- 隐藏隔离 Electron 界面 **12/12**，明色及暗色窄视图已人工查看；验证接收方说明、独立缺省提示、空待收方向隐藏提示、两个会话之间租约仍禁用重复提交，以及原有回执诊断。
- `npm run check:plugins`、`npm run check:docs`、类型检查及候选目录构建通过；契约为 224 声明、282 宿主方法，公开文档零检查发现。构建保留既有 chunk 大小提示。

验收异常保留：并行运行全套测试、构建或 CLI fixture 时，两轮全量中的原生技能配置测试出现 `CLI_PROCESS_STATE_UNKNOWN`；一次 CLI fixture 在 Codex 新会话终结等待时超时。单项复核、随后独立运行的最终全套及 CLI fixture 均通过；未证实根因，也未把这些既有进程清理/时序问题声明为本次已修复。没有为获得成功修改断言或放宽超时。

接口覆盖矩阵、真实批准 ZIP 插件经生产控制器/default/writer/执行器的双方向生命周期、参数/错误/权限/迁移及 UI 状态归属已同步文档 36。审查没有新增仅供核心消费的模型或账户分支；本次限定为既有两种原生记忆来源的接收职责，不新增运行时目录。新默认值复用既有 StateStore，缺失/停用不抹去用户选择，重读持久文件验证保留；界面只增加派生说明和准入状态，没有新可调控件。共享工作区其他 UI/持久化改动未纳入此通过范围。

上述证据不表示真实模型已验证语义质量、真实用户积压已接收或运行中的客户端已载入修复；未更改真实记忆、账本或已有客户端安装，未部署远端。
<!-- memory-receiver:end -->

<!-- activity-batches:start -->
## 默认折叠的实时事件批次（2026-09-30 JST；U108）

命令、读取、搜索、编辑和普通工具从第一条记录起进入默认折叠批次；运行中摘要显示当前公开动作，并行任务显示数量，最后加入的任务完成后回显仍在执行的任务。批次结束后按实际活动汇总，例如“运行了 2 个命令并编辑了文件”；失败、取消和结果未确认保留摘要提示，失败编辑不会宣称成功修改。长命令单行省略，详情、键盘展开、原始输入／输出仍可用。

核心分组 key 不再依赖活动状态或命令／编辑类型，输出增长和完成不会从单项切换到新容器。实时回合与完成回合复用外层节点，保留手动展开和正文布局；重新进入历史回合默认折叠，同一回合恢复运行会重新显示过程。正文、审批、协作消息、独立提示、看图和生图仍保留边界。主会话与原生子会话消费同一生产分组注册实例，不变更原生事件、会话数据或任务执行。

接口审查及覆盖矩阵已同步文档 36：沿用 `api.activities.group/register/subscribe` 和 `activity-group` / `turn-process` surface，旧分类规则继续有效；多状态输入、单项容器、异常计数和外层稳定生命周期的迁移约定已记录。公开 TypeScript 声明及具名 selector 未变，没有刷新契约快照。新增只读 `data-group-status` 供局部替换读取状态。没有新增仅供核心执行的注册分支或硬编码提供方／运行时目录。

验证使用基于本地已提交树 `2f06409` 的限定候选，排除其他窗口未提交工作：

- 定向单元／协议回归 **63/63**：批次稳定 ID、所有终态、输入边界、读取／搜索／混合摘要、旧分类、多插件、失败回退和原生事件／计时／阅读回归。
- 独立隐藏 Electron 事件与插件专项 **20/20**：两家生产 observer 接入合成原生帧；MutationObserver 核对连续输出、并行命令与编辑期间原批次节点、折叠状态、行高和正文高度；键盘展开后新事件与回合结束保持原节点；浅深色窄窗口、失败提示、历史重启折叠；完整 ZIP 导入、批准、激活、既有／后来实例、多插件替换、重复注册失败回滚、异步迟到清理、停用重启用与包删除恢复。
- 计时 **8/8**、阅读滚动与反馈 **14/14**、子会话 **14/14**、聊天工具 **8/8**、双语定位 **10/10**。这些隐藏窗口检查均为零 renderer errors，已复核浅色汇总、深色窄窗和子会话截图。旧 UI 测试同步为显式打开历史过程／批次，不再依赖完成时自动折叠或没有单项容器的私有结构。
- TypeScript、`npm run check:plugins`（216 项声明、281 个宿主入口）及 `npm run check:docs` 通过；构建保留既有字体协议和分包大小提示。

验收材料保存在忽略目录 `build/qa/activity-batches/`。本轮仅声明上述源码、合成协议、插件生命周期与隔离桌面证据；没有真实模型任务、活动客户端操作、生产 dist 替换、真实用户插件安装或远端部署。仅创建本地提交，不推送发布；其他窗口正在进行的设置、记忆或文档改动不计入本轮验收或提交。
<!-- activity-batches:end -->

<!-- memory-consolidation:start -->
## 2026-09-30 · 默认模型单会话记忆整理

实现范围：按新任务默认选择解析后台模型/运行时/档位，一个独立会话处理双向冻结积压；默认不可用时明确拒绝。新增明确整理命令及 UI，设备内互斥，相同工作重启后也不反复请求，失败不自动重发。模型负责英文语义归纳，宿主写原生可发现引用并核验完整入口→目录→正文链路。来源范围、并发更新、取消及只读边界保留。有效用户指令入口只增加一条短引用，两家已有自动生成索引不变。

接口审查：公开 default resolver、后台执行器 mode/store、可替换 reference writer 和 process 命令贯通生产控制器，真实批准 ZIP 的调用/注册/替换、停用/重新启用及激活失败清理有行为测试；没有新增固定模型名单。旧插件不声明 mode 时保持原批次协议，旧 journal 可读；快照审阅新类型/方法，文档 36 列明权限、错误与迁移。记忆设置页沿用具名 memory 页替换契约，没有把测试 DOM 定位当作插件接口。

验证记录（独立候选树，基于 54064ab，仅加入本节范围）：全量 npm test **1381/1381 通过，0 跳过**；其中受影响记忆单元/集成测试 48 项。npm run typecheck、check:plugins（216 声明、281 命令）、check:docs（44 文本、0 发现）及候选目录 npm run build 均通过。首次全量运行因旧技能测试默认的 npm CLI 路径不存在而失败；使用其预留 AGENT_WORKBENCH_TEST_CODEX_EXECUTABLE 指向已安装官方 CLI 后，全量重跑通过，没有改测试断言或生产配置。构建仍有既有大 chunk 提示。

隔离原生实验覆盖 Codex 0.155.1、Claude Code 2.1.284：4/4 新协议检查均通过单后台会话双向存储和新项目目录的原生文件读取；既有原生后台协议另外 4/4 检查通过前台隔离、隐藏审批终止与同会话修复；隐藏 Electron 的 8/8 检查覆盖明亮、暗色窄布局、真实组件按钮单次触发、运行禁用、旧任务兼容及具体错误。安装的原生 CLI 真实运行，但推理响应来自本地合成端点；这不是实际账户/模型语义质量、真实积压处理或远端部署验收。

边界：官方机制核对到公开文档层，未声称复刻官方源代码或通用跨厂商记忆 API。新增引用独立于 Auto Memory 开关，关闭生成不抹除已有引用。一个会话仍可能有多次 API 请求，没有官方安全频率保证。未改真实用户原生记忆/回执、未运行生产积压、未操作运行中的客户端、未替换其 dist、未推送或部署。并行窗口的未提交改动不计入本次验收。
<!-- memory-consolidation:end -->


<!-- runtime-effort:start -->
## 切换运行时保留模型思考档位（2026-09-30 JST）

同一 API 来源/模型映射在 Codex 与 Claude Code 之间切换时，输入框显式传递当前模型及思考档位，不再用目录默认值替换。已有会话切换接口同时接收并校验 API selection；显式选择优先于旧 lane，最后运行时、目标、模型参数和主机偏好一并保存。不同模型的无参数切换仍按既有 lane/默认行为，失效档位拒绝而不静默降级。旧版本已覆盖的选择无法猜测恢复。

插件接口与兼容审查见文档 36 本项记录；无新增方法、持久字段、具名 surface 或快照变化。只改变模型参数传递与保存，未新增模型调用，也不改官方 CLI 登录或原生配置。

验证：新增回归先复现 medium 覆盖 ultra；修复后定向测试 63/63、隐藏生产 Electron 交互 7/7、零 renderer errors；TypeScript、npm run check:plugins、npm run check:docs 通过。桌面覆盖当前档位变更、双向多次切换、空草稿、已有会话、新会话、两次真实进程重启与旧 lane 覆盖；已查看深色和浅色窄窗口截图。合成批准 ZIP 验证具体选择接口的调用、策略叠加、后来会话、停用/重启用和激活失败清理。首轮验收修正了测试夹具的服务类型和模型弹窗等待，最终完整流程通过；接口和界面测试未派发真实模型任务。材料位于忽略目录 build/qa/runtime-effort-candidate-*/build/qa/runtime-effort-ui。候选基于已提交基线并合入同期已提交侧栏修复，只纳入本项新增变更；其他窗口未提交文件不属于本轮验证范围。生产构建、活动客户端、真实模型和远端均未改动。
<!-- runtime-effort:end -->

<!-- fork-routing:start -->
## 非 Git 会话直接创建分支（2026-09-30 JST）

回复下方分支按钮先检查会话绑定目录：普通目录或无目录直接在原工作区创建聊天分支，Git 目录保留“当前工作空间 / 新工作树”二选一。侧栏同步按实际 Git 检查改为普通目录单击创建、Git 子菜单选择；悬停不触发创建。已识别 Git 仓库但没有首个提交等情况继续显示具体工作树禁用原因。没有重新绑定既有会话目录或初始化 Git。

预检与创建共用单次点击锁，检查失败/不可分支不创建，切换会话后不处理旧检查结果；侧栏结果按会话和消息绑定，避免复用上一个菜单的结果。原有来源定位、历史前缀、独立目录、编号及重启持久化保持原约定。接口审查、功能矩阵、局部挂载点、示例、兼容和错误/生命周期见文档 36；没有新增 location 目录或持久配置，契约快照仅增加两个具名 surface。

验证：隔离候选 TypeScript、npm run check:plugins、npm run check:docs 通过；分支、工作树、回合边界及插件定向回归 40/40、零跳过；真实生产入口的独立隐藏 Electron 交互检查 24/24、零 renderer errors。合成批准 ZIP 验证宿主检查策略被实际界面消费，以及已有/后来实例、多个插件、异步清理、激活失败、停用和重新启用。已查看浅色 Git 弹窗、深色窄窗口普通目录菜单与无提交仓库提示。初轮发现检查期间悬停丢失及按钮样式覆盖插件隐藏状态，均已修正；测试夹具另修正 Electron evaluate 参数与异步启停等待，最终完整流程重跑通过。材料位于忽略目录 build/qa/fork-routing-candidate-*/build/qa/fork-ui-acceptance 与 fork-ui-integrated；最终候选合入同期已提交基线后，再次通过同组检查。候选基于已提交源码，只加入本项逻辑变更；不包含其他窗口未提交改动，不操作活动客户端或真实模型，不替换生产构建，不推送或部署。
<!-- fork-routing:end -->


<!-- configurable-shortcuts:start -->
## 可编辑键盘快捷键（2026-09-30 JST）

快捷键页从固定说明改为真实设置：25 个动作可搜索、录制修改、添加多个绑定、逐个删除到“未分配”、单项恢复及确认后全部恢复默认。新加入的会话归档、删除、置顶、未读和聚焦输入框默认不占用按键。已有界面风格保留，新增功能说明、编辑/删除/添加图标、冲突和保存反馈。配置在本机保存，重启恢复；修订检查避免覆盖并发修改，录制不触发功能，IME/AltGr/重复键不执行。

界面、侧栏、聊天输入框与原生菜单共用实际绑定目录；移除旧搜索监听及原生重复加速器，删除 Shift+F10 后也不由浏览器回退重新打开菜单。菜单提示同步更新，缩放、换行和上下文菜单均按修改后的组合键执行。系统编辑、Tab/Esc、原生输入法及独立插件恢复保留其原行为。

接口审查、功能覆盖矩阵、示例、错误/权限、生命周期与迁移见文档 36。本轮增加 `api.shortcuts` 注册/调用/覆盖接口，具名快捷键页和录制器挂载点，以及 `shortcuts/get/set`、`desktop/action`；生产注册表同时驱动设置与执行，插件停用/包缺失保留偏好并释放实现，重新启用恢复。测试使用真实批准/激活的合成 ZIP，不安装示例到用户环境。

验证基于已提交基线加本轮快捷键变更的独立候选：TypeScript、npm run check:plugins、npm run check:docs 全部通过；快捷键、插件生命周期、侧栏、输入框与预览定向回归 73/73，零跳过；隐藏 Electron 专项 16/16，零 renderer errors。已查看浅色、深色、窄窗口和录制弹窗截图，实际按键验证包含新旧绑定切换、删除、冲突、重启持久化及换行的原生撤销。合成插件经真实批准/激活流程覆盖新目录、替换和清理。材料保存在忽略目录 build/qa/shortcuts-candidate-*；并行未提交改动从候选及提交排除，不纳入完成范围。生产 dist、活动客户端、真实模型和远端均未改动，未推送或部署。
<!-- configurable-shortcuts:end -->

<!-- subagent-terminology:start -->
## Subagent 界面术语统一（2026-09-30 JST；U108）

按用户要求，界面原“子 Agent”统一显示为 Subagent：包括两家运行时的详情页标题和回复角色、未知标题回退、模型参数提示、工具/审批标记、后台提示及相关设置说明。其余中文、原生任务标题与消息内容保留；不改变执行、模型、权限或历史结构。

接口先行审查及覆盖矩阵见文档 36：新增 subagent-reader、subagent-label、subagent-model-settings 三个具名局部挂载点，连接真实详情组件；没有新增状态/配置/选择目录。旧定位和数据格式保持兼容，中文可访问名称迁移已说明。契约快照仅增加三项 surface 映射；未发现仅供核心的新执行分支或运行时硬编码名单。

验证：TypeScript、npm run check:plugins、npm run check:docs 通过；子会话、参数、逐条翻译及插件协议定向回归 24/24；独立隐藏 Electron 阅读检查 14/14，通用插件扩展检查 12/12，零 renderer errors。真实合成 ZIP 通过导入/批准/激活，核验多标签、后来打开的会话、未批准拒绝、停用/重新启用、异步迟到清理和历史不变；通用检查覆盖多插件、注册失败与恢复。已人工检查浅色和深色窄窗口截图。首次界面测试发现英文术语前缺空格，修正后完整重跑通过。

验收记录位于忽略目录 build/qa/subagent-terminology、build/qa/child-reader 和本次 plugin-extensibility 运行目录；构建仅写隔离验收目录。只声明本次定向回归，不代表全仓或并行未提交改动验收。未操作活动客户端、调用真实模型、安装示例到用户资料、覆盖生产 dist、推送或部署。
<!-- subagent-terminology:end -->

## 问答发送与待回答修复（2026-09-29 UTC；U107）

异步问答此前被实现为“填入回复”，与卡片直接发送和现有翻译预览约定不符。现已从卡片直接调用受管输入流程，主编辑框文字、附件和技能保持独立：翻译模块关闭时原文发送；开启时沿用“翻译后直接发送”，关闭先预览、开启翻译后直发，返回修改回到问题输入。

“稍后回应”改为真实操作，收进紧凑“待回答”列表；可恢复或忽略。异步问题在所属回合结束后默认收起，忽略只关闭本地问题；仍在等待的原生问题收起后保留 pending 并明确提示等待，忽略按原请求回传拒绝。新问题的展示状态持久保存，重复帧不重现已忽略问题；旧记录保留兼容规则。准备中翻译开关变化、回合结束、收起和忽略均失效旧预览，禁止自动改发原文；主编辑框草稿和当前卡片未发送答案保留。

证据：本次隔离候选全仓单元／协议回归 **1239/1239**、零跳过，TypeScript、公开文档、插件契约和 renderer/main/preload 隔离构建通过。独立隐藏 Electron 的真实 Workspace 交互专项 11/11、键盘专项 7/7，零 renderer errors；已检查浅色回答预览、结束回合的收件箱和深色窄窗口。宿主／协议专项覆盖两家原生拒绝映射、收起后仍等待、已结束请求失效、重启回读、来源绑定及单次提交。具体运行报告位于忽略目录 `build/qa/async-questions/`。这些是本地源码、合成协议与隔离桌面证据；本轮没有真实模型任务、用户活动窗口操作、生产构建替换、SSH/VPS 部署或推送。接口及兼容见文档 36，公开协议依据见文档 07。

验收准备曾混入并行附件接口，并遇旧 CLI 路径导致原生配置测试失败／跳过；剥离无关改动并显式选择已有 CLI 后，四并发回归出现一项临时目录 EBUSY 清理错误。该文件独立 **14/14**，随后单并发完整回归 **1239/1239** 通过；未修改现有 CLI 配置、用户资料或原测试断言。


<!-- sidebar-session-order:start -->
## 会话手动排序与静置一小时保护（2026-09-29 UTC；U102）

会话行支持当前项目、置顶区和同名分组内拖拽前后插入及 Alt+↑ / Alt+↓；搜索过滤不丢失隐藏行，重启保留顺序。项目拖拽、跨项目移动和原生身份保持原约定。日常渲染读取宿主保存的顺序，消息、工具、审批和结束不再每次触发全表优先级排序。

只有静置严格超过一小时后再次活动的会话重新按优先级放置，其他行相对顺序保持；刚好一小时不触发，连续活动续期，持续运行的长任务不因暂无输出被视为闲置。手动整理给当前区域重新开始一小时保护，避免目标或相邻会话立即更新后反弹。打开/已读、标题、翻译及设置变化不触发排序。并行命令在宿主串行应用相对目标，过期归属、删除及归档目标拒绝，不以窗口的旧整表覆盖其他操作。

新增 `session/reorder`、稳定顺序/活动时间字段和实际接线的 `sidebar.order` v1 可替换服务；覆盖迁移、错误、权限、生命周期、兼容、示例及停用恢复，详见文档 36。需求登记同步 U102。

最终隔离候选基于 `a5d72d9` 加本次限定改动，排除共享目录其他未完成外观改动：TypeScript、生产参数构建、全仓 **1,213/1,213**（零失败/跳过）、公开文档检查和插件契约基线通过。隐藏 Electron **9/9**、零 renderer errors，覆盖真实 Chromium 前后拖拽、插入线、Escape、键盘、过滤、置顶/最近会话、跨项目及项目排序回归、并行 IPC、后续原生状态更新与重启；已查看浅色插入线、暗色窄窗和紧凑侧栏截图。

初次界面断言误将常驻但隐藏的附件层要求为不存在，修正为可见性断言后完整重跑通过；未修改附件显示实现。最终材料在忽略目录 `build/qa/session-order-20260930/`，仅使用合成任务、临时用户目录和独立隐藏应用。没有调用付费模型、操作在用客户端、替换正式 dist、部署或推送；合成状态更新与真实拖拽证据不冒充真实模型任务。
<!-- sidebar-session-order:end -->

<!-- local-model-management:start -->
## 本机官方账号与统一模型页（2026-09-29 UTC；U115）

“模型 API”改为“模型”，API 连接以紧凑折叠行完整排在上方；下方官方账号沿用技能页的 Codex/Claude 标签分区。每个分区默认三列响应式卡片，更宽或缩小时增加列，窄窗减为两列/一列。卡片默认折叠并保留开关；API、账号和用量详情箭头收起向右、展开向下。登录添加默认跟随当前厂商，界面不合并两家的登录方法。

Codex 管理式浏览器/设备码、Claude 原生订阅/SSO/Console 流程使用每账号独立原生目录；Console 另隔离 Anthropic 配置目录。浏览器回调失败时仅在 Claude 原生提示后接受一次临时授权码，不保存或发给模型。登录成功还须回读官方身份与模型目录。选择器顺序为 SSH、官方、API；官方模型在自家运行时去重，再由独立账号选择器指定来源。模型、思考档位、账号及项目/运行时权限沿用记忆；账号失效不自动换号，切换账号不复用其他账号的原生线程。

展开显示原生剩余 5h/周额度与重置倒计时；不存在的窗口不补造，倒计时归零不自动显示满额。Codex 卡片可预览指定卡片、确认后幂等兑换，未知回执只能核对原请求；Claude 尚无已核实的直接卡片读取/兑换通道。API 与账号提供滚动 1day/7day、本周期/本月总计及逐模型输入、输出、缓存和 API 等价金额；未知字段与单价不伪装成零。前台与记忆后台数值回执进入独立账本，删聊天保留统计，不导入账号全部历史。

已完成合成协议、宿主绑定、价格/周期/账本、服务覆盖恢复及隐藏独立 Electron 验收；界面 12/12，零 renderer errors，覆盖厂商标签、箭头、三/多/两/一列与 80% 缩放、22 行 API 流式排列、取消兑换及账号记忆，浅色、深色、窄窗截图已检查。官方登录参数另以公开文档和隔离目录内 CLI `--help` 核实。基于已提交基线 `3cc4b95` 加本次改动冻结独立候选，TypeScript、生产参数 renderer/main/preload 构建通过；全仓 **1199/1199**，零跳过，公开文档 **42 份 / 254 个宿主入口 / 零问题**。插件契约基线仅新增 15 个兼容入口，服务包装/停用恢复及原生登录失败清理均有覆盖。

首轮全仓检查遇到旧测试默认 Codex 路径不存在及新增插件入口尚未更新契约基线；改用实际已安装的可执行文件在临时目录验证，并审查 15 个增量接口后更新基线，再完整通过。共享工作区的外观和侧栏并行改动未纳入候选或本次提交。

这不是实际官方登录、真实模型调用、重置卡消费、风控或网络出口验收。未操作活动客户端、读取账号凭据/私有聊天、更新正式 dist、连接或部署 VPS。只本机源码与合成验收；开发接口和迁移约定见文档 36，来源见文档 07，材料在忽略目录 `build/qa/model-management/`。
<!-- local-model-management:end -->

<!-- plugin-recovery-audit:start -->
## 插件预开源审计、独立恢复与修复草稿（2026-09-29 UTC；U111）

审计确认：已有插件调用/替换能力不能等同于长期兼容承诺。补齐可选 host/service/member 要求、服务契约版本、摘要固定的已登记重命名适配及公开接口变更基线。服务后来可用时清除已解决的兼容故障，未变化的故障不反复生成新记录；未声明要求的旧插件仍明确标记 unchecked。尚无完整依赖求解、事务式插件升级回滚或官方 ZIP 发布者验证链，完整本机代码权限也不是恶意代码沙箱。

独立恢复进程先于插件启动，主进程/界面无响应或退出仍可显示诊断与安全模式入口。归因区分已定位、疑似和未知；损坏偏好及诊断原文件保留。紧急重启只停止核实创建身份的本工作台进程树，安全模式暂停导入插件，保存代码批准、配置与启用偏好，不改动内置功能或原生插件设置。初始状态/导航未完成不能被其他状态推送提前伪报 ready；最后一个异步宿主激活结束后再次确认，避免一直显示启动中。

普通诊断复制旁新增“复制诊断并准备 Agent 修复草稿”。用户点击后复制并保存，安全模式下填入新会话文本框，实际插入后按 ID 确认，不重复覆盖编辑或因重载重投。中文 UI 草稿使用中文，其他 UI 语言用英文；错误码和接口名保持原文。不会创建模型会话、调用准备/翻译/提交或强制选择模型；是否发送由用户决定。缺少可验证适配时不改版本号伪装修复。批量操作按插件和包摘要去重，单项失败继续处理其余目标；部分成功不显示全部修复，同包的独立清理故障也不会因适配成功而被清除。一份草稿汇总全部保留的未解决目标，未执行者保持未检查；50 项日志和有界诊断草稿已验证重启读取。

本轮最终集成基于 `46717ec` 加限定差异的独立源码快照，排除共享工作区其他未完成模型管理、界面及文档改动：全仓 **1161/1161**，零失败/跳过；TypeScript、生产参数 renderer/main/preload 构建、插件契约基线 **48 项声明 / 239 个宿主方法**、公开文档检查 **42 份文本 / 零发现** 通过。隐藏 Electron 恢复 **17/17**，既有多实例/设置/服务扩展 **12/12**，插件页及相关原生资料回归 **16/16**，均无 renderer exceptions。已人工检查浅色诊断、深色窄窗、兼容问题、安全模式主界面与实际可编辑修复草稿。

故障注入包含真实主进程死循环、renderer 死循环、process.exit、初始状态接口被中间件无限等待、声明接口版本不兼容、可修复重命名、不可修复接口、损坏偏好、实际安全/正常重启和旧接口适配恢复。批量注入同时包括 2 个可修复目标、1 个适配后仍失败目标及无适配目标，确认真实命令回执和部分结果；超过 10 秒的批量回执与修复中真实死循环后的安全重启均通过。草稿验证覆盖普通复制不生成任务、重启持久化、用户编辑、确认后重载不再填入、非中文界面使用英文、模型选择控件保留及全程零新增会话。CLI 配置相关全仓测试使用显式已安装二进制与隔离临时目录；不调用真实付费模型或修改用户设置。

公开树/本地可达历史候选扫描、依赖审计与许可证元数据检查见 [预开源审计报告](plugin-preopen-audit-20260929.md)，接口/生命周期/错误/覆盖矩阵见 [文档 36](36-workbench-plugin-api.md)。开源许可证仍待项目所有者确定；参考资产再分发权、发行签名/通知及非 Windows 恢复验收不能由本轮代码测试代替。CI 配置已加入但未在远端执行。

证据保存在忽略目录 `build/qa/plugin-recovery-audit-20260930/`，日期后缀使用 JST。早期失败实验不计入上述通过数。未更新正式 dist、操作活动客户端、部署 VPS、改写 Git 历史或推送。
<!-- plugin-recovery-audit:end -->

<!-- memory-receipt-fix:start -->
## 记忆接收回执与后台收尾修复（2026-09-29 UTC；U96）

本机任务/回执元数据确认两类失败：原生正文已写入但索引引用缺少来源标记；整理后的内容被提交为 already_present，不能通过原文包含核验。旧核验器在一项失败时拒绝整批，而且后台模型拿不到核验反馈。现提供绑定活动批次的 workbench_verify_memory_handoff；返回逐档案英文诊断，有效项独立盖章，失败项保持待收。原任务最多核验两次，允许一次本地证据修正，不新增模型回合或自动重投。重新发放保留前次错误；任务页显示具体中文原因与已核验部分进度，旧日志兼容。来源版本先更新再验旧回执，主动核验不替其他运行时批次盖章。接口、错误和覆盖矩阵见 docs/36-workbench-plugin-api.md。

两家真实 CLI 的合成流程进一步复现 Windows 清理顺序问题：先关闭 stdin 可能让原生 CLI 提前退出，遗留持有管道的工具子进程，已完成的接收任务仍停在运行中。ProcessSupervisor 现在先终止所属进程树，再关闭 stdin；其他平台保留进程组清理。未按进程名清理其他客户端，也未改原生子 Agent 能力。

最终验证使用已提交 6832920 加本次文件的独立源码快照，排除共享工作区其他未完成改动：TypeScript、生产参数 renderer/main/preload 构建、全仓 1120/1120（零跳过）通过。两家实际安装 CLI、独立临时 Home 与合成 loopback 上游通过 4/4，覆盖原生文件写入、核验错误返回、同任务修正完成、前台隔离与交互停止；隐藏 Electron 5/5，零 renderer errors，浅色/深色窄窗截图已人工检查。公开文档检查通过（41 份文本、226 个宿主入口、零问题）。证据位于忽略目录 build/qa/memory-receipt-20260930。

首轮真实 CLI 测试在 Windows 管道清理处超时；定位并修复后完整重跑通过，失败运行保留为诊断，不计通过。共享工作区一次类型检查遇到其他窗口尚未完成的插件契约类型变更；隔离快照检查通过，未改动或纳入该并行工作。只读诊断不输出聊天或凭据；本次未改用户记忆原文、交接账本或待收队列，未调用真实付费模型、操作活动客户端、替换生产 dist、推送或部署。合成接收完成不证明真实模型的英文整理质量或现有积压档案已经接收。
<!-- memory-receipt-fix:end -->

<!-- cli-release-fix:start -->
## 远端 CLI 检测误报与紧凑行（2026-09-29 UTC；U105）

旧请求使用 Python 默认客户端标识，在本机对官方版本及安装入口复现 HTTP 403；相同地址声明 AgentWorkbench 标识后正常返回。现统一元数据 GET、发布包大小 HEAD、安装脚本及发布包请求标识，区分 HTTP 状态、超时、TLS、连接/DNS 与发布格式异常，通过既有 SSH/宿主接口保留安全诊断。旧通用错误不再直接要求检查 VPS 出网，不新增镜像、旧版回退或自动重试。

远端 CLI 采用紧凑行：名称与安装状态同行，版本集中显示，自动更新和维护操作并排；缺失安装不再重复展示空版本块。每个运行时只有一处当前错误，成功预览或刷新清理相应旧提示；历史自动更新失败可展开查看。窄内容区换行，保留两家独立维护、预览确认、策略修订比较和插件替换挂载点。开发契约与功能覆盖矩阵同步文档 36，来源核对见文档 07。

以已提交基线加本次文件冻结独立候选验收：TypeScript、生产参数 renderer/main/preload 构建通过；全仓单元/协议 **1,111/1,111**，无跳过；发布诊断 **8/8**、Linux 临时目录合成安装生命周期 **11/11**；隐藏 Electron 管理 **21/21**、资源及文件回归 **13/13**，renderer errors 为零。已查看安装/缺失状态、浅色、深色及窄窗口截图，确认错误去重和控件可达。公开文档检查器 **3/3**，扫描零问题。独立候选不包含其他窗口正在进行的记忆改动。

初次全仓检查因旧验收默认 npm 程序路径不存在而有一项失败、两项跳过；显式提供已存在的本机 Codex 可执行文件，仅在临时 Home 中重跑原生设置/技能检查后完整通过，未修改技能实现或实际用户设置。UI 验收补齐异步策略保存与刷新完成的等待，再完整重跑；不以延迟截图代替状态断言。

本机真实官方 HTTP 只读探测确认修复后的完整发布发现可取得两家的版本、大小和摘要；这一证据与 Linux 合成安装、桌面布局分开计量。未连接目标 VPS、运行真实官方安装器或进行原生登录，不声明截图中的 VPS 安装已成功。候选与材料位于忽略目录 build/qa/cli-release-fix；正式 dist、活动客户端和 VPS 部署未改变，未推送。
<!-- cli-release-fix:end -->

<!-- remote-file-interactions:start -->
## 连接分栏、文件开关与静默目录缓存（2026-09-29 UTC）

远端 CLI 页移除重复的闲置回收开关及归档提示／状态读取，自动更新和安装维护保留；清理设置与详情统一在“会话清理”，既有策略值不变。连接目录—详情、详情—文件两条分隔线支持拖动、键盘和边界约束。文件区开启时解除设置页外层最大宽度限制，拉宽窗口将新增空间分给文件区；关闭后恢复正常比例分栏。窄内容区改为上下布局。“远端文件”与右上角关闭入口同步，关闭／重开保留当前目录和展开状态。

目录使用单连接、仅内存缓存，默认 64 项／估算 4 MiB、30 秒更新间隔、5 分钟缓存时效。浅层预取和悬停预取有队列、并发上限，不递归扫描或预读普通文件正文；关闭面板停止待发队列，身份变化销毁缓存。右键菜单和复制路径本机即时显示／执行；编辑、属性、移动和删除选择后才核对远端回执。读取失败有原因和重试；确认之前保持禁用，过期回复不重新打开弹窗。文件变更仍以远端 revision 拒绝覆盖，冲突保留本机草稿；手动刷新与写入失效缓存。

最终独立候选 TypeScript、renderer/main/preload 构建通过（保留既有大 chunk 提示）；全仓单元／协议 **1,109/1,109**，无失败或跳过；新增缓存／布局定向测试 **8/8** 包含在其中。隐藏 Electron **13/13 + 4/4**，零 renderer errors：验证两条拖动线、开关同步／资源失败时仍可用、宽窗新增空间、窄窗可达、阻断 SSH 时菜单仍可用、目录预取／重复展开、权限重试、写入冲突、删除确认、连接身份切换，以及本机文件路径／行号变化、刷新和插件替换后的停用恢复。已检查浅色／深色／窄窗与延迟菜单截图。公开文档检查器 **3/3**，扫描零问题。

接口、权限、返回类型、生命周期、错误、兼容说明、调用示例与覆盖矩阵同步文档 36。候选和合成证据保存在忽略目录 build/qa/remote-file-interactions；测试无真实主机或聊天资料。本轮未改动 VPS 协议、正式 dist 或在用客户端，未推送或部署；合成慢响应验证不代表真实 VPS 延迟测量。保留其他窗口预先存在的文档与验收脚本改动，不混入此提交。
<!-- remote-file-interactions:end -->

<!-- session-retention-console:start -->
## 远端会话清理详情、自定义时限与本机日志（2026-09-29 UTC）

SSH 管理员新增“会话清理”标签。Codex、Claude 分别显示自动清理开关、默认 24 小时且可设置为 1–8760 整数小时的闲置时限；可查看工作台登记的远端会话、模型最后活动、已闲置时间、到期倒计时、处理中／中断／未知／已回收状态和本机归档信息。列表按服务器时钟计算，每秒显示倒计时、每 15 秒只读刷新；超过一千条会话可分页到达。到期显示“待清理”，不伪报已经删除；页面刷新不初始化或续期活动时钟。断网显示旧观测并暂停倒计时，本机日志仍独立可读。

自定义时限贯通实际候选、残留进程停止、归档开始与删除标记前复核。保存使用 revision 比较并回读，修改时限会取消本机对应后台归档。旧常驻服务若不能证明支持该时限，拒绝清理并解释升级原因，不默默回退到 24 小时。原有开关与原生文件校验、恢复、取消及分轮传输机制保留。

运行日志只写入本机应用数据目录，记录策略、检查、归档、清理、续传、取消、恢复及错误原因；按 VPS 保存最近 30 天且最多 2,000 条／4 MiB，空检查按小时合并。没有额外远端运行日志文件；不记录聊天正文、凭据或原始 SSH 输出。日志损坏、权限或磁盘问题明确说明，原文件保留；日志失败不阻断已校验清理，清理锁先释放，日志等待有 2 秒上限。界面延续阅读字体、紧凑平整行和细分隔线，支持浅深色与窄窗。

冻结集成候选全仓单元／协议 1,101/1,101，无跳过；TypeScript、生产参数隔离构建和公开文档检查通过。Linux 合成元数据／策略十项、原生删除恢复故障七项、资源与实际进程收尾十八项通过。隐藏 Electron 新页面八项、原资源界面六项通过，renderer errors 为 0；已查看浅色、深色与窄窗口截图。覆盖只读刷新、倒计时、独立保存、分页、修订冲突、离线日志、日志写入失败和大小限制。测试数据与证据在忽略目录 build/qa/session-retention-ui。

公开接口、错误、生命周期、兼容保护、调用示例与覆盖矩阵见 docs/36-workbench-plugin-api.md。没有操作在用客户端、部署真实 VPS、读取真实凭据／原生聊天或删除真实会话；本轮工程验证不替代真实远端部署和 Claude 原生 SSH H 验收。
<!-- session-retention-console:end -->

<!-- connections-compact:start -->
## 连接页文案与间距精简（2026-09-28 JST）

工作空间、共享账号、远端 CLI、浏览器用户和连接详情五个标签移除装饰性标题与重复常驻说明，缩短按钮和状态文案。浏览器恢复、关闭与刷新集中于顶部；两家 CLI 独立开关收紧间距。回收说明采用悬停提示，额度规则默认折叠；错误、安装预览、删除确认和实际归档状态保留。接口与扩展挂载点沿用原契约，兼容说明和覆盖矩阵见文档 36。

隔离候选的 TypeScript 与生产参数构建通过。隐藏 Electron 回归：远端管理 16/16、资源及文件管理 6/6、SSH 工作空间 19/19、原生账号 14/14，共 55/55；渲染错误为 0。检查了五个标签的浅色、深色及窄窗口截图，并补充展开空间、两家共享账号的七张截图检查。公开文档检查通过。

初次旧管理脚本停在已取消的 SSH 身份提示和删除结果卡，未作为通过证据，也未恢复旧界面；工作空间最终使用现行 SSH 脚本验收。原生账号测试首轮业务检查完成后因缺少既有启动读取夹具失败，补齐具名只读返回后完整重跑通过，未忽略未知请求。证据保存在忽略目录 build/qa/connections-compact；未改动正式构建、运行中的客户端或真实 VPS。
<!-- connections-compact:end -->

<!-- browser-control:start -->
## 浏览器用户启动、恢复连接与显式关闭（2026-09-28 JST）

每个可用浏览器用户旁新增“启动并打开”，启动所选用户后自动用本机默认浏览器打开实时操控；顶部“恢复连接”仅恢复已有浏览器的 noVNC／SSH 通道，“关闭远端浏览器”经确认结束受管理 Chrome、显示服务、连接进程，保留用户配置、Cookie 和登录文件。现有浏览器运行时，第二次启动由远端 manager.lock 内检查拒绝，提示先关闭；同一用户也应使用恢复连接继续操控。断线和退出工作台只结束本机操控通道，日常远端浏览器保留，不进入内存自动清理范围。

验收：冻结独立候选后 TypeScript、生产参数隔离构建通过；集成最新已提交基线后的全仓单元／协议 1,064/1,064，无跳过。Linux 控制入口 5/5、浏览器用户及配置保留 23/23、合成 CLI 登录 8/8；隐藏 Electron 16/16，renderer errors 为 0，查看浅色／深色与窄窗口截图。真实回环 HTTP/WebSocket RFB 握手、第二次启动保留原操控连接、退出与失败清理、开发服务实际 IPC 替换恢复均有测试。首次全并发测试中既有 Codex 配置夹具失败，单独复查及限制四路并发的完整重跑均通过，未修改该测试。公开文档检查 41 个文件、220 个宿主方法、0 发现。

证据在忽略目录 build/qa/browser-control。正式工作台及真实 VPS 未部署；不读取真实账号和聊天、不启动真实浏览器、不修改用户参考脚本。前述本机合成验收不替代真实 VPS 联验。
<!-- browser-control:end -->

<!-- planning-modes-20260928:start -->
## 两家计划模式接线与正常停止（2026-09-28 JST）

Claude 本机第三方原生连接补齐运行中权限控制及原生 mode 回读；计划批准显示正文，“继续规划”保留 plan，批准退出后按真实事件更新权限。所属进程使用原生人工审批配置，避免计划命令／子 Agent 依赖未核实的第三方安全分类器。普通 MCP 首次审批继续保留，没有自动扩大权限。

Codex 加号菜单与 /plan 现接独立 collaborationMode，输入框显示可关闭的计划胶囊，保留原访问权限。模式持久化、旧记录默认、线程恢复及从 plan 返回 default 均有实际派发路径。本机两家主动停止在所属进程清理完成后直接恢复输入，清空待批准与运行状态，正常情况不再显示停止警告、空计时行或恢复发送操作。未知断线与清理失败仍明确保留。

补齐 Claude 计划执行权限选择（手动批准编辑／自动接受编辑／完整访问），批准以原生 setMode 更新退出计划；Codex 原生 plan 项保留在会话正文并提供继续修改／按计划执行，后者明确派发 default 协作回合。两家完整计划均能在右侧查看原文与中文译文；占位期间对话临时上下双语，关闭恢复既有偏好和未提交草稿。翻译关停、请求过期、原文或配置变更时不写入迟到结果。切换运行时各自保存权限和协作设置，不将 Claude plan 冒充 Codex read-only；旧计划按钮失效，下一轮原生工具和当前 UI 随新运行时更新。

计划阅读采用逐段原文／译文配对、正文细分隔线和紧凑排版；重译操作复用正文下方同一个图标组件，只更新选定段。列表、嵌套列表和表格中的说明文字参与翻译，内联字面量和列表内嵌代码保留；独立代码块只显示一次，不请求翻译。重译保留上一版，失败可手动重试，不覆盖其他段；并发及迟到结果有独立检查。单段调用通过公开 plan/translate 的 blockIndex 接口贯通。

接口与覆盖矩阵见文档 36，来源与原生版本边界见文档 07。冻结候选全仓单元／协议 1,090/1,090，零跳过，TypeScript 与公开文档检查通过；分段与计划审批定向测试 17/17，含列表内嵌围栏／缩进代码及重启重试恢复。安装版 CLI 合成上游 9/9；运行时菜单隐藏 Electron 8/8；计划隐藏 Electron 回归 8/8，含两家模式、审批执行权限、正常停止、同会话运行时切换、布局恢复、单段重译及列表／表格／代码，渲染错误为 0。检查浅色、深色窄窗口的完整计划截图。证据分别记录于忽略目录 build/qa/native-planning 与 build/qa/plan-mode-fix。未调用真实第三方模型、操作在用客户端或部署 VPS；源码完成不代表活动窗口已经载入。/goal 及其目标胶囊本轮仅核对原生入口，工作台仍未实现。
<!-- planning-modes-20260928:end -->

<!-- compact-popovers:start -->
## 用量与权限浮层紧凑重做（2026-09-28 JST）

用户否决此前用量大卡片，随后再次否决过度压缩、隐藏未知缓存命中与移走权限小字的第一稿。本次最终源码恢复完整信息与阅读层次：两处统一宽 280px，用量总量采用 22px，输入／输出及速度／缓存命中为对齐的两列标签与数值，未知命中显示“—”。单来源合成样例约 235px 高；多来源模型名在上、运行时在下、用量靠右，逐项展开精确明细，列表最高 176px。selection 单独表示已选配置，切换不清空历史；新选择未收到匹配回执时显示“暂无记录”，同名模型按运行时区分，不把最近请求速度解释为新模型速度。

权限每项恢复名称、下方小字说明与勾选，不再使用公用说明页脚；保留长说明换行，以较小内边距控制密度。两处采用阅读区同类衬线字体与既有浅暖／深灰配色。原权限值、说明、宿主保存及原生审批边界不因本轮布局改变；悬停不保存。补齐权限控件的公开类型与多实例 surface，修复插件隐藏核心控件后旧 portal 未关闭的问题，停用恢复核心入口。共享文件中其他窗口正在修改的原生权限说明单独保留，不纳入此界面提交。

本轮八个源码／测试文件及两个文档的独立差异在已提交基线冻结验证：定向单元／协议 **54/54**、两组隐藏 Electron **14/14 + 18/18**、零 renderer errors；TypeScript 与 renderer/main/preload 构建通过，保留既有大 chunk 提示。公开文档检查零问题，检查器 **3/3**。已人工查看浅深色、多个来源、切换后无回执与窄屏长名截图；新增两列对齐、缓存命中常驻和逐项权限说明检查。未复跑全仓测试；这些工程检查不代表用户已经认可此视觉方案，也不作为真实模型或远端部署证明。

接口、参数、事件、错误、权限、生命周期、兼容说明、调用示例和覆盖矩阵同步于 docs/36-workbench-plugin-api.md。证据在忽略目录 build/qa/compact-popovers-20260928；未纳入其他窗口的未完成改动，未覆盖正式 dist、重启或操作在用客户端、读取真实凭据／聊天、推送或部署。本地源码修订不代表活动窗口已重新载入。
<!-- compact-popovers:end -->

<!-- remote-maintenance:start -->
## 远端资源面板、原生副本与闲置维护（2026-09-28 JST）

连接详情增加 VPS 内存／磁盘指标、手动及自动空闲内存回收，右侧复用会话文件浏览器显示远端内容；提供新建、文本编辑、重命名／移动、复制、确认删除、上传下载、属性和刷新。Codex／Claude 各自提供自动更新与 24 小时闲置回收开关，未安装时也可保存，不触发安装。浏览器资料删除修复限于可证明从未打开的新建资料：其他资料运行不再一概阻止删除，已用或不明确的共享资料仍保留。

内存清理只处理登记的空闲工作台原生进程，保留正常执行中的任务、浏览器及无关后台软件。已判结果不明的所属进程在下次维护检查直接收尾；控制回路持续 120 秒不响应也会中断／回收。清理确认后释放不明状态，不自动重发。低内存连续采样、冷却和新任务准入共同减轻风险，不能保证所有软件永不 OOM。

原生历史逐组存入本机，完整校验后回收远端；24 小时取模型／工具实际活动，不取查看或健康探测。保留子会话和分支依赖，其他活跃组不挡住过期组。取消、部分传输／删除、丢回执、坏清单与空间不足有恢复或拒绝删除路径；原生 resume 前还原所需历史。凭据、原生数据库／索引、日志及其他软件内容保留，不承诺全 VPS 磁盘恒定。本节补充旧“原生归档尚未实现”的阶段描述。

验收：冻结本轮独立源码，TypeScript、生产参数隔离构建和公开文档检查通过；全仓单元／协议 1,024/1,024，无跳过。Linux 资源／文件／所属进程 17/17、归档故障 5/5、原生 socket 26/26、浏览器资料 21/21、CLI 生命周期 10/10 通过。实际安装的 Codex／Claude 在合成原生目录和回环上游恢复原线程、图片与工具上下文 4/4；没有用可见聊天重建上下文。新增隐藏 Electron 6/6、既有远端管理回归 13/13，renderer errors 为 0；查看了浅／深色、开关与窄窗口文件面板截图。开发服务实际 IPC 替换／恢复、旧回执隔离、退出取消与归档不占全 CLI 准入由主流程测试覆盖。

证据在忽略目录 build/qa/remote-resources，构建未覆盖正式 dist。早期完整回归的旧技能测试未找到其硬编码 CLI 路径，改用显式发现的已安装程序后全套重跑通过；UI 夹具补齐真实 checkbox 语义、初始化只读入口并收紧编辑按钮作用域后重新验收，未降低断言。没有部署真实 VPS、读取真实凭据／聊天、安装远端 CLI、重启正式工作台或推送。Claude 原生格式恢复与远端执行 H 分别计量，后者仍不宣称通过。
<!-- remote-maintenance:end -->

<!-- session-feedback:start -->
## 用量浮层、实时原生正文与回合耗时（2026-09-28 JST 后续修订）

用量详情改为悬停 1 秒预览或左键立即展开，点击后保持；支持 Esc、点外部、重复点击和关闭图标。精简为大号总量、两列计数与速度／命中率，多模型明细按需展开；未知与部分下界保留。浅深色与窄窗口采用同一主题变量，原有底栏指标和上下文环不增加重复副本。

查明并修复两处实际积攒：跨协议 provider 先收完 SSE 再给 CLI 整段答案；Claude 本机宿主只处理 assistant 完整消息，遗漏 stream_event.text_delta。现在跨协议正文边收边转换，Claude 公开增量进入同一消息，完整回执对齐原生 UUID 而不重复追加。同协议仍原样转发；工具只在完整参数及有效回执后交付原生 CLI。思考生命周期沿用原生状态，隐藏推理和签名不作为公开文字。

每次进入执行状态即记录工作台墙钟起点，消息区显示“已处理”与每秒更新的时长，即便尚无 CLI 输出也有明确等待状态。结束后持久化“用时”，有过程时可展开；插入输入与切页不重置，遗留运行／断线不伪造已完成时长。旧历史缺少起止记录时保持未知。修复首次完成时原生 details 与 React 开关状态竞争造成的自动重新展开；插件可逐实例替换计时显示并在停用后恢复。

已通过：四条跨协议的完成前首段文本验证、中断错误与工具完成边界；真实安装的 Codex / Claude Code 在全新临时原生目录和合成回环上游中通过 4/4，确认两家 CLI 实际发出首段时上游尚未完成，随后完成文本不重复、请求仅一次、计时结束落盘。隐藏 Electron 用量控件 18/18、真实 Workspace 计时 8/8，零 renderer errors；已人工查看浅／深色、完成与等待、折叠／展开、窄窗口截图。源码接口与兼容变更见文档 36。

测试资料留在忽略目录 build/qa/session-feedback/ 和 build/qa/session-metrics/ui/。只使用合成任务、隔离原生目录与隐藏测试窗口，没有访问真实登录资料／聊天数据库、调用真实商业模型、操作在用客户端或更新生产 dist；本地源码修改不表示当前活动窗口已载入。最终独立检出以已提交基线加本轮明确文件冻结：全仓 1003/1003，零跳过；TypeScript、renderer/main/preload 生产参数构建和公开文档检查通过。共享工作区试跑另有远端存储 9 项失败、9 项新接口未登记，不混入本轮通过结果；既有子会话 UI 脚本的 13px／14px 字体断言在修改前基线同样失败，该脚本未计为通过。
<!-- session-feedback:end -->

<!-- session-idle:start -->
## 24 小时模型闲置判定与恢复验收（2026-09-28 JST）

新增 session_idle.py 作为可信原生输出、远端过期进程收尾和存储候选选择共用的闲置时钟。24 小时取最后模型／工具实际活动；中断、结果未知、审批等待、残留 running 或子会话状态不构成永久保留理由。界面查看、刷新、SSH 心跳、账户／额度查询和原生健康检查不续期。旧记录只建立一次活动基线，缺失时间不立即删除。

本机回收默认每轮最多传输 16 MiB、处理 8 个候选、运行 30 秒，随后释放锁并轮转候选；释放远端租约的额外请求最多等待 2 秒。256 KiB 分块和进度落盘，断线／重启从已校验前缀继续。未完成的坏分块可从原件重取，完整副本校验失败仍拒绝删除。单个归档、清单或传输错误不会停止其他有效组。归档锁不占用整个 CLI 的任务准入；关闭开关会取消该运行时的后台传输，退出取消所属请求，前台停止也能取消原生连接前的恢复上传，不发送模型任务。

远端已完成回收的收据退出候选队列，保留恢复所需的归属证明；超过 1,000 个未完成候选时分页轮转。恢复中断会留下标记，过期组重新核验本机完整归档后，可清除该归档的远端上传残片，不碰其他归档。仍被其他原生会话引用的历史保留。磁盘不足会报告并保留唯一副本，释放当前任务锁；远端新任务准入另留系统余量。本流程不会为了腾空间而删除尚未确认保存的唯一历史，也不保证其他软件、日志或原生数据库的总占用恒定。桌面离线时不执行归档删除。

验证：冻结的集成候选单元／协议 1,033/1,033，无跳过；独立闲置时钟十项；本机故障、调度及停止路径十八项；Linux 原生删除／恢复故障七项。实际 Codex 0.155.1 和 Claude Code 2.1.283 在合成临时目录和回环上游完成归档、删除、进程重启恢复和原线程续聊四项验证，保留图片上下文与原生工具结果。证据在忽略目录 build/qa/session-idle/。没有部署 VPS、删除真实会话、读取真实登录资料或操作正式客户端；Claude 原生格式恢复不代表远端执行 H 已通过。
<!-- session-idle:end -->

<!-- translation-tracking:start -->
## 内联译文停用追踪命中（2026-09-28 JST）

修正上下显示时仍挂接悬停/焦点事件、保留命中样式的问题。追踪统一由实际显示位置、译文可见性及窄窗口状态判定：仅左右对照启用；设置为消息下方、文件/子会话占用右侧、隐藏译文或单面板时移除成对事件和 Tab 停靠，清除旧高亮及待执行的跨栏滚动。恢复右侧译文后重新启用。正文选择、复制、链接和明确来源定位保留，译文内容与布局偏好不改写。

已提交基线加本轮自有差异的隔离树验证：全仓 982/982、零跳过（四并发），TypeScript、隔离 Vite/host 构建和公开文档检查通过。隐藏完整 Electron 10/10，覆盖内联、文件/子会话占用、恢复对照、隐藏译文、浅深主题、窄窗口、选文和文件链接；零 renderer errors，已查看对应截图。夹具仅含合成消息和临时文件，无模型或翻译请求。

验收记录位于忽略目录 build/qa/translation-tracking-20260928；开发契约及覆盖矩阵见文档 36。仅源码和隔离构建，不替换生产 dist、不操作或重启用户活动客户端、不推送或部署远端。
<!-- translation-tracking:end -->

<!-- windows-file-links:start -->
## Windows 文件超链接误降为普通文本（2026-09-28 JST）

复现原生回复中带空格和行号的 `/<drive>:/...` 文件链接：Markdown tokenizer 已正确生成 link token，但公共文件解析器不识别盘符前的单个斜杠，返回 undefined，最终仅渲染文件名。复制原消息仍含链接，故问题位于展示/导航识别，不是模型漏传或复制丢失。

只在公共解析器补齐该盘符写法的规范化；两家运行时、原文、译文、公开过程、子会话和 renderer 插件沿用同一实现。路径与行号进入原有预览、右键及复制接口，消息原文、Markdown 与代码示例不重写。开发入口、兼容和覆盖矩阵见文档 36。

已先取得两项失败复现，修复后专项 37/37；独立候选全仓 980/980、零跳过，TypeScript 和公开文档检查通过。隐藏 Electron 9/9、零 renderer errors，已查看隔离候选截图。界面覆盖原文/译文/实际子会话、鼠标/键盘导航、复制路径与行号、原始 Markdown 复制、插件纯函数、流式完成、代码围栏及深浅色/窄窗口；导航和剪贴板使用合成回调，不操作活动客户端或用户文件。未替换生产构建、推送或部署，源码修复不表示正在运行的客户端已更新。材料留在忽略目录 `build/qa/windows-file-links/`。
<!-- windows-file-links:end -->

<!-- generated-images:start -->
## Codex 生图结果自动保存到本机工作区（2026-09-28 JST）

原生 `imageGeneration` 完成事件自动进入本机接收器；根会话、子会话保留原生身份，PNG 直接保存到绑定工作区 `generated_images`，元数据接入附件预览、查看器、导出及清理引用保护。无需模型额外上传工具调用或用户传图提示；公开状态和翻译不存放图片 Base64。相同身份不重复创建图片，不覆盖用户改动；非法编码、过大图片、路径变化、链接与写入失败均保留失败状态且不发远端删除回执。

SSH 账号服务增加所属连接的图片回执：本地字节与活动记录确认后，远端再次核验本连接原生完成事件、账号授权、线程、文件位置、大小、哈希及文件身份，才清理该 PNG。断线、旧服务不支持、状态落盘失败或回执不明确时保留远端文件；不重跑生成、不自动恢复回合。源代码已有实现，未部署远端。

当前原生桥基线 0.155.1 会先写自己的 PNG 再发完成事件，原生历史也可保留图片数据；故交付语义是“本地确认后清理 PNG”，**不能宣称零远端落盘或零图片存储占用**。清理后原生远端路径不再可用，工作台显示本地产物路径；原生图片历史保持不变。没有改动登录、二进制、原生工具 schema、模型提示或聊天数据库。

本轮只交付图片接收与独立 PNG 回执清理，不表示“VPS 存储不持续增长”的整体目标已完成。Codex / Claude 的本机原生会话归档、恢复、闲置回收与容量管理尚未实现；不能把现有工作台可见聊天记录当作完整原生恢复副本，也未启用任何按时间删除远端会话的任务。

最终隔离候选验收：全仓 978/978、零跳过；包含 14 项生图专项，覆盖接收、重复事件、重启、子会话、失败、插件接收替换/恢复和传输上限。Linux 实际临时文件验证确认后删除及链接/变更拒绝；真实 Codex 0.155.1 加合成登录/合成回环上游完成工具发现、原生生图调用、完成事件、本机字节回读和附件加载，3/3。隐藏 Electron 8/8、零 renderer errors，已检查根/子会话、浅色、深色窄窗口和远端清理未确认截图。TypeScript、公开文档检查和隔离生产构建通过；构建保留现有大分块提示，没有替换正在使用的正式构建。

材料位于忽略目录 `build/qa/generated-images/`。以上不等于真实商业模型选择生图工具或实际 SSH/VPS 联验；未读取真实凭据和聊天库、消费商业模型额度、操作活动客户端、替换正式构建、推送或部署。公开依据见文档 07，开发接口、生命周期和覆盖矩阵见文档 36。
<!-- generated-images:end -->


## U114 · 无推理识别与档位滑块贯通（2026-09-28 JST）

本节覆盖后文旧版“勾选自动后台检测”“保存时检测”“无效值对照先行”行为。模型设置不再在打开、勾选、编辑或保存时创建推理作业；目录读取与普通保存仅使用模型目录 GET。设置页数量、详情、聊天滑块、目标默认值、会话校验及两家原生协议转发共用有效档位规则，目录声明不再因缺少生成探测凭证而被清空。已有 verified/declared 与显式手动选择继续可用；旧 inconclusive 不能掩盖新目录。手动默认值优先，恢复自动不把旧手动数组冒充目录证据。

SSH 原生模型保持远端目录与配置路径：runtime/models → 原生 model/list/config/read 回传思考档位、默认值和服务档位，不调用独立 API 的 reasoning/start/save 探测。不同原生运行时的目录能力独立核实，缺字段保持未知，不用测试请求补造能力。此次没有远端调用或部署。

底层显式验证兼容接口保留，新增 allowInference:true；缺少该标记时在网络/保存前返回固定错误。普通设置界面不提供自动调用路径。显式验证只测合法候选，响应被接受表示请求兼容，不证明服务内部采用了相应思考强度。旧 ignored 仅解释为无效值对照不足，不能当连接失败。cancel 能停止已保存接管的进行中作业，完成的结果不回滚。公开插件入口、迁移与覆盖见文档 36。

以已提交基线和本次变更组成的独立候选树完整回归 964/964、零跳过；针对性协议/宿主回归 89/89；隐藏隔离 Electron 23/23、零 renderer errors，已查看五档可选滑块及无推理设置页截图；TypeScript 与公开文档检查通过。首次全回归有两项启动器测试因候选目录未链接已有依赖而失败，补上隔离依赖链接后完整重跑通过，没有修改这些测试或安装新依赖。全部上游测试限注入合成 fetcher 或本地 loopback，无真实提供方推理请求；DSH 只读核对安装代码。未替换生产构建、重启或操作活动客户端，源码变更不代表当前运行版本已生效。验收资料留在忽略目录 build/qa/reasoning-passive-20260928。

## 双语上下区域分别复制（2026-09-28 JST）

补充修订同日用户消息复制：用户消息、模型输出及子会话的上下原文／译文各有独立复制图标。上方位于分隔线前，下方与编辑重发、翻译、分支等操作同排；复制与编辑重发间距缩为 4 px，上下复制图标同列对齐，额外操作出现或消失时仍按实际宽度对齐。普通用户消息下方复制本地原稿，模型及子任务下方复制实际译文。单语保留一个；译文等待／失败且无正文时不提供占位复制，保留旧译文时可复制旧版，新内容到达后使用当前版本。运行中可复制，历史及未发送草稿不变。接口、选择器、错误、生命周期、兼容和覆盖矩阵见文档 36。

验证基于已提交基线加本轮七个文件的独立快照：TypeScript、公开文档检查和隐藏 Electron 控件检查 19/19 通过，renderer 错误为零。覆盖用户原稿、模型译文、两家子会话任务与消息、单语回退、动态增减操作后的同列对齐、4 px 间距、键盘、剪贴板错误、流式更新、重译保留／缺失、面板切换及既有记忆来源浮层。已人工检查浅深色、窄窗口和子会话截图；记忆浮层另以合成引用截图展示，未修改记忆功能。首轮断言误将模型已有 visibleReply 尾部空白处理当作新增回归，调整夹具以保留原契约后重跑通过。证据位于忽略目录 build/qa/bilingual-copy-20260928。剪贴板使用宿主桩，未覆盖真实剪贴板、操作活动客户端、读取用户聊天库、替换生产 dist、调用真实模型、推送或部署。

## 已发送用户消息复制（2026-09-28 JST）

用户消息的编辑重发图标左侧新增复制图标，复用既有 clipboard/write。复制当前消息显示的提交正文，没有提交正文时取原文；保留 Markdown、换行和空白，剥离已单独显示的技能前缀，不复制标签、译文或未发送草稿。运行中仍可复制，失败报告错误并保留草稿和历史；不会提交、停止任务或自动重试。开发契约、权限、生命周期、兼容和覆盖矩阵同步见文档 36。

验证基于已提交基线加本轮四个文件的独立快照：TypeScript、公开文档检查和隐藏 Electron 控件检查 14/14 通过，renderer 错误为零。新增复制检查覆盖键盘触发、左右位置、提交正文与原文回退、技能前缀、空白与 Markdown 保留、失败后显式重试、运行中可用及草稿／历史不变；浅深色与窄窗口截图已人工检查。共享工作区首次类型检查有两项来自并行生成图片测试的类型错误，不计为本轮已修复；本轮独立快照类型检查通过。证据位于忽略目录 build/qa/message-copy-20260928。剪贴板使用宿主桩，未覆盖真实系统剪贴板、操作活动客户端、替换生产 dist、调用真实模型、推送或部署。

## 数学公式与符号识别补齐（2026-09-28 JST）

复现 `\(\boxed{21}\)` 原样显示：普通 Markdown 链路缺少数学 token 和排版引擎，字符实体也仅覆盖六个命名项。新增四种公式定界符及 equation/align/alignat/gather 环境、本地 KaTeX 字体与 HTML+MathML、完整 HTML5 实体解码；主回复、译文、公开过程和子会话沿用同一组件。公式中的星号/下划线不再干扰 Markdown 强调；代码、金额、转义示例和原文复制保持字面语义。未闭合、非法、超限或不支持公式保留原文并区分状态，不宣称支持全部 TeX 宏包。

公开 renderer api.markdown 提供 tokens/blocks/code/link/text/math，已验证插件调用、全部动态公式实例替换和停用恢复。接口、错误、权限、生命周期与兼容约定见文档 36；功能与依赖许可证审查见 conversation-ui-20260928.md。

验证限定于已提交基线加本轮文件的隔离树：全仓 934/934、零跳过，TypeScript、生产参数 renderer/main/preload 构建、文档检查和生产依赖审计通过。首次全仓默认 Codex 路径不存在导致 1 项失败及 2 项跳过，显式指定已安装程序后完整复跑通过；未修改该程序或用户配置。Markdown/公式专项 30/30、隐藏 Electron 公式 8/8、既有会话交互 9/9；浅深色、窄窗口和长公式滚动截图已人工检查，正常方框无多余滚动条。证据在忽略目录 build/qa/math-symbols。没有调用真实模型、更新生产 dist、操作在用窗口或部署远端；当前在用客户端不因此自动载入新代码。

## 会话控件与失败记录删除（2026-09-28 JST）

按本次修订，用户消息的编辑重发改为图标；输入框模型显示“模型 · 思考档位”，移除其右侧下拉箭头；运行中的空输入显示停止图标，有正文、附件或技能时切回发送图标，继续遵守原生 steer 能力。左下角固定翻译总开关，与设置中的双语工作流双向联动，直接发送开关移至其右侧。

失败后仍为 uncertain 的会话此前被删除边界一律阻止。现在删除确认框解释未知结果，明确确认后可通过新增可选 discardUncertain 字段删除已无活动操作的本地记录；真实运行、待提交、翻译和其他会话操作仍受保护，异步关闭后再次检查。项目文件、其他会话和原生历史不属于删除范围；不自动重发或宣称撤销。

验收基于已提交基线与本轮变更的隔离树：TypeScript、公开文档检查及 104 项专项回归通过（零跳过）。共享工作区合并回归另有一项上下文压缩断言失败（消息数 25/26）；隔离树对应测试通过，不将尚未完成的并行改动或该失败计为本轮已修复。独立隐藏 Electron 的真实控件专项 10/10，通过图标、模型档位、单按钮切换、附件／技能、失败回滚、双向翻译联动及浅深色／窄布局检查；真实宿主 IPC 删除专项 4/4，覆盖取消、确认、文件保护与重启回读；独立 loopback 翻译集成 14/14，覆盖设置联动、准备取消、实际三种协议与重启。停止方块按最终修订放大为 14 × 14 px，并检查其中心与按钮中心重合。所有资料位于忽略目录 build/qa/composer-controls-20260928；未操作用户活动窗口或真实会话、未替换生产构建、未部署远端。接口与兼容见文档 36。


## 子 Agent 参数与模型创建独立会话（2026-09-28 JST；U108、U109）

子 Agent 详情页右上角新增只读模型、思考档位和 Fast。Codex 子线程配置、调用请求、Claude 子通道模型及本次固定 API 映射按字段保存并标明来源；未知值不从父会话后来修改的控件或模型的身份自述反推。保留旧 model 字段、临时子 ID 合并、嵌套阅读及完成状态。Fast 与思考档位独立，配置回传不当作上游物理模型或实际思考量的证明。

新增 workbench_list_projects 与 workbench_create_session，接入 Codex dynamic tools 和 Claude MCP。包含空项目的目录可检索；用户明确要求新建聊天即可创建独立侧栏会话并发送首条任务，不要求将其称为子 Agent。模型和运行时默认沿用来源；用户指定模型或思考档位时，以显式 targetId/effort 为准，不可用时报错，不静默回落。只换模型未指定档位时采用所选模型默认档位。同所有者、同执行位置与既有权限边界保留；操作预约先落盘，重启、失败、取消及回执未知不重投。独立聊天记录创建来源，保留指定标题，不设 agentParent；普通 peer 消息仍仅入箱，不启动新回合。

验证：隔离候选完整单元/协议 **954/954**（--test-concurrency=4，无跳过），新增专项 **18/18**，类型与公开文档检查通过；隐藏 Electron **9/9**、零 renderer errors，两家实际安装 CLI 均完成“发现空项目 → 创建独立聊天 → 首条任务 → 读取结果”，分别验证默认继承与指定模型/档位，并核对发往合成上游的实际请求参数、重启保留和无重复提交。已查看原生参数浅色、请求参数深色窄窗口与指定模型的新建 Claude 聊天截图。插件实际分发、MCP、服务替换与停用恢复有单元验证。前次高并发回归遇原生配置读取或子进程退出状态未知（原生资源单独复跑 **13/13**），以及扩充工具说明触及既有上下文预算断言；精简说明后完整复跑通过，没有放宽该断言或改动原生技能实现。旧完整阅读脚本另遇主消息 13px/译文 14px 的既有字体断言，此轮没有改动该无关样式；使用新增专项脚本覆盖本次参数布局及真实 CLI 路径。

验收资料位于忽略目录 build/qa/agent-session-ui 与 build/qa/child-settings-20260928。参数展示用合成元数据验证，CLI 使用隔离 Home 和合成上游；不等于商业模型实际采用参数、真实 Claude 模型选择质量或远端部署。未操作用户活动客户端、读取真实凭据或聊天库、替换正式构建、推送或部署。开发接口、事件、兼容与错误见文档 36，公开依据见文档 07。

## 回复侧分支、DS 用量与问答回车（2026-09-28 JST）

按本次修订，用户消息侧移除分支按钮，保留编辑重发；助手完整回复和侧栏继续提供分支。Claude 本机 direct-api 接入原生指定回复分支：保存助手 UUID，明确发送时创建新原生会话，保持工具历史并排除来源后续回合。旧 Codex before-turn API 和已保存草稿兼容；SSH Claude 门禁不变。

切换运行时/模型时分别保存上下文回执；旧缺失值可从同一运行时、模型目标、原生线程及模型的最近完整请求恢复，不使用累计用量。DeepSeek 命中计数映射为缓存读取，未命中不伪装为缓存写入。未报告的缓存项从 UI 隐藏，实报零值保留；协议转换保持输入和缓存只计算一次。

问答框普通 Enter 下一题，最后一题校验通过后发送；Shift+Enter 换行。IME 确认、keyCode 229、重复键及修饰键不发送，分页聚焦可见题目。翻译预览仍需确认；异步问题最后一题保留填入回复语义，不自动另开模型回合。

验证分层：最终集成已提交基线及本轮自有变更的隔离树，全仓 901/901、零跳过（测试并发数 4），TypeScript、生产参数隔离构建与公开文档检查通过。Claude Code 2.1.283 配合合成上游原生验证 6/6；复用现有独立模型配置的 deepseek-flash 实际模型验证 6/6，包括原生 Read 工具历史、精确边界、源记录不变、重启、换目录与用量回执。隐藏 Electron 分支 UI 14/14、计量 UI 14/14、问答键盘专项 7/7，已检查浅/深色及窄窗口截图。旧综合问答脚本的新增键盘检查及前段 17 项通过，但后续 Codex 续聊等待出现超时；该整套脚本未通过，不以专项替代全套成功。

初次全仓运行未指定现有 CLI 路径，出现一项失败和两项跳过；修正路径后默认并发出现一项原生设置读取失败，该项单独 14/14 通过，最后限定四并发完整复跑 901/901 通过。

验收资料在忽略目录 build/qa/claude-fork-20260928。当前仅源码和隔离构建，不替换生产 dist、不重启或操作用户活动窗口、不部署远端、不推送；真实配置与密钥不进入提交。开发契约、兼容与覆盖矩阵见文档 36，公开来源见文档 07。

## 记忆交接移入独立后台任务（2026-09-28 JST）

U96 按本次修订从前台提示注入改为记忆模块管理。明确用户提交后冻结运行时、模型、思考档位、项目与权限；使用独立原生线程和临时存储处理本机档案，不复制前台消息，不进入聊天列表。前台移除交接提示、记忆工具及旧读取入口，官方原生系统提示和模型环境保持原样。已有聊天中的旧上下文不自动改写。

每个接收运行时最多一个任务，最多 120 份冻结档案、每批 12 份；逐批完整回执核验后才能继续。进程完成不等于记忆完成。失败、结果未知和交互要求停止，关闭、取消、退出和十分钟超时终止所属进程；重启只标记未知，不恢复运行。记忆页展示状态及取消，完整批准的工作台插件可通过注册式执行器替换并恢复，接口见文档 36。本机 direct-api 的两家 CLI 已接入；其他执行位置保持不可用，不改账号、路径映射或远端权限。

当前工作区全套 901 项测试通过（零跳过），TypeScript 与公开文档检查通过；专用回归覆盖后台调度及现有档案/回执协议。两家实际安装 CLI 配合独立临时 home 和合成推理接口完成前台隔离、记忆工具发现、未核验回执阻止完成、原生问题停止测试。隐藏 Electron 完成聊天列表隔离与记忆页状态视觉检查。原生 Claude 模型环境可在空白合成会话中自行携带所选模型名，不是工作台另加身份提示。以上不等于真实模型英文记忆质量、真实失败会话工具选择或远端出网验收；未操作在用客户端或部署构建。

## 翻译整段英文残留与原生工具发现检查（2026-09-28 JST）

复现正文保护器将英文缩写中的单引号误配对、隐藏整段句子的问题；普通单双引号和中文引文也被整体保护，导致模型无法翻译并在还原时重新插入原文。版本 2 移除普通引文保护，只对明确的路径和技术字面量使用占位符；路径匹配不再吞掉邻接正文或排版引号。翻译提示明确要求完整翻译普通引文、缩写和所有格，保留专名及字面标识。已增加双向、分段、三协议、落盘与原文不变回归，旧译文不自动重写。

原生问答另行核对：真实安装的 Codex/Claude CLI 在临时 Home、128K 自定义模型映射下，均将各自原生提问工具的名称、完整说明和问题 schema 发送到合成 Chat 上游，并完成提交/拒绝回传。六种协议转换组合保持工具名称、说明、schema 和原生回传名称。不以注入宿主提示词改变工具选择；没有证据证明用户失败回合曾丢失工具，不能把合成工具调用成功宣称为真实模型已会主动选择工具。

验证：全仓 **887/887**、零跳过，TypeScript 通过；真实 CLI 合成上游问答 **4/4**。首次全仓因旧测试默认 npm 可执行文件路径已不存在而失败并跳过两项；显式提供本机已安装 CLI 路径后完整复跑通过，未修改技能产品代码。资料位于忽略目录 `build/qa/translation-interaction-20260928`。未读取真实凭据/聊天库、消费真实模型额度、操作活动客户端、推送或部署。

## 迁移后已有记忆交接阻断启动的修复（2026-09-28 JST）

应用目录已搬迁，但交接日志的 receipt 仍为旧绝对路径，严格字符串比较因此抛出 `Memory exchange contains an invalid delivery.`。旧目录别名只能保证文件可达，不能自动满足该比较；前轮三项启动检查未覆盖带交接历史的服务初始化。本轮用待接收、已有待核验回执、已接收和关闭状态四类合成日志复现相同错误。

现在仅在旧回执为该批次固定文件名、且旧 exchange 根经 realpath 证明与当前根相同后规范地址。保留原日志、交接身份、token、原始档案、完成记录与原生证据；所有检查通过后才原子保存。相同内容的外部副本、错名、错误 token、重复 ID、未知条目和被改向的别名仍拒绝且不改写磁盘。没有以忽略异常、清空记忆或关闭交接规避启动问题。开发契约与覆盖矩阵见 docs/36-workbench-plugin-api.md。

验证：新增迁移回归 **10/10**，记忆交接与目录专项合计 **42/42**，隔离提交树全仓 **867/867**，零跳过；TypeScript 与生产参数构建通过。真实 Electron 完整桌面 **3/3**：带已接收和待接收日志完成迁移启动、重启保留历史、记忆页和宿主目录回读，零 renderer errors，未创建模型任务。已查看合成记忆设置页截图。公开文档检查通过。本机只核对了新旧目录及兼容链接的元数据，没有读取真实日志、记忆、聊天库或凭据，也未重启用户客户端；不推送或部署。验收资料保存在忽略目录 build/qa/memory-migration-20260928。

## 运行时命令目录、原生压缩与同会话切换（2026-09-28 JST）

输入 / 按当前绑定运行时加载已接入命令与原生技能，分开标识工作台操作。补齐模型、权限、上下文入口和本机两家原生手动压缩；Claude 保留计划模式，Codex 识别 approvals 别名。原生压缩保留线程、权限与模型，不追加工作台提示、不重投失败请求，不以普通聊天文本假冒控制操作。原生桥未接入的命令显示不可用原因，不放宽 SSH 准入。

同一会话切换 Codex/Claude 保留斜杠查询，立即清空旧目录并重新读取，移除旧运行时的选中技能。目录携带 scope，宿主在扫描后和执行前复核；前端同时隔离迟到的成功、失败和收尾响应。原生进程清理完成的状态通知会刷新可用性，不留下过期禁用项。注册式运行时不再被固定枚举拒绝；已批准插件可成对扩展目录和执行，停用恢复核心行为。接口与示例见 docs/36-workbench-plugin-api.md。

独立提交快照验证：全仓 815/815、零跳过，类型检查及隔离 Vite/host 构建通过；真实 Codex 0.155.1 / Claude Code 2.1.283 加合成上游手动压缩 6/6；隐藏完整 Electron 界面 8/8、故意乱序/失败响应界面 4/4，已检查浅色及深色窄窗口截图；公开文档 40 份、193 个宿主入口、0 问题。证据位于忽略目录 build/qa/runtime-commands/。隔离临时原生目录与合成上游，不证明真实摘要质量；未读取真实账号资料、消费付费模型、替换生产构建、操作用户活动客户端、推送或部署。


## U114 · 档位声明识别与手动选择修订（2026-09-28 JST）

检测改为先发送无效档位，解析与该字段绑定的允许值列表及嵌套参数错误，不再等待普通生成基线；有枚举即作为上游声明供选择，没有枚举再逐档测试。支持兼容服务返回的有界 SSE，单请求 30 秒、整批 180 秒；鉴权/限流停止整连接，单模型 5xx 只影响该模型。失败返回固定类别与 HTTP 状态，不再统一显示“暂未验证”，未知结果不作为下一次显式检测的成功缓存。

详情新增手动七档复选与默认档位，可在检测未成功时保存，进入会话选择器及两个原生协议适配；标明手动/声明/实测来源，不把用户配置当验证结果。后台结果与目录刷新保留手动选择；恢复自动移除覆盖，来源变更清除旧选择，连接忙碌保护保留。开发接口与覆盖矩阵同步文档 36。

本次变更与已提交基线组成的独立树：全仓 909/909、零跳过，针对性协议/宿主回归 28/28、隐藏隔离 Electron 界面检查 21/21、TypeScript、生产参数隔离构建及公开文档检查通过，已人工检查浅/深色手选界面。全工作区首次运行 922 项中一项子 Agent 元数据断言失败，相关并行未提交改动未纳入本次树；不宣称整个混合工作区已通过。未替换生产构建或操作活动客户端。未读取真实凭据或聊天库；用户截图所示本地接口在检查时未响应，真实上游识别和真实模型任务尚未验收，不用合成测试代替。验收材料位于忽略目录 build/qa/reasoning-manual-20260928。

## U112–U114 · 输入、附件、工作树与后台检测（2026-09-28 JST）

本节是后续修订，覆盖早期保存阻塞探测、额外默认档位和小图片弹窗。输入框按文本/换行/宽度增减高度，最大 360 px 且为工具条和对话留出空间。图片查看器占满应用视口，支持 Ctrl+滚轮、按钮缩放、拖动、左右键/按钮翻页、适应窗口、关闭和原图另存为；文件名、大小和尺寸仅保留底部小字。编辑为撤销式笔画标注并导出 PNG 副本，不宣称 AI 图片编辑。

核对本机 Codex 安装物后按来源处理附件：拖入本机文件引用原路径，无路径粘贴图片放系统临时目录的工作台专属目录，其它无路径数据为托管副本。保留旧快照兼容，不触碰原生客户端缓存；新增位置入口和数据与隐私页的目录/七天未引用副本清理。源文件/临时文件变化或丢失会明确失败。实际附件仍不进入独立翻译服务。

默认应用根改为 ~/.agentworkbench；旧数据及相邻工作树/附件目录在下次正常启动、取得单实例锁后迁移并保留旧路径链接，冲突拒绝覆盖，失败回滚。当前运行中的用户客户端未重启，真实目录尚未在本轮搬迁。已用真实 Electron 复现并修复 Windows 单实例锁占用旧目录导致的 rename EPERM：旧实例探测后将实际锁放到独立临时位置，再迁移。真实数据未手动搬动，活动客户端未重启。工作树自动清理可启用，默认保留 15 个；先保存、校验包括 ignored/untracked/staged 的可恢复副本，再移除旧 checkout，保护置顶、当前查看、运行/待提交/待确认。不可完整归档则保留。支持设置页及历史会话恢复，原目录存在时不覆盖；正常退出等待维护完成。按后续反馈将数量和清理操作收为紧凑单行，输入框及数字右对齐。

思考档位勾选后后台检测，保存无需等检测/目录请求；连接使用中允许改名/添加模型，敏感连接修改仍保护。结果按准确配置匹配发布，忙碌时延后应用；不重复启动会话，不自动重试限流。滑条恢复细线/小圆点和手掌指针，有档位不再插入“默认”，只有未知/无档位显示默认；重置与真实发送使用同一实际档位。

最终隔离提交树全仓 **857/857**，TypeScript、生产构建与公开文档检查通过；隐藏 Electron 模型 **16/16**、媒体交互 **9/9**、完整应用与插件启停 **10/10**，零 renderer errors。真实 Electron 数据目录启动 **3/3**：首次迁移、第二实例拦截、重启复用；启动脚本 --check 通过。已查看浅深色、窄窗口、全窗口图片与紧凑右对齐数量截图。归档验证未推送 HEAD、暂存/未暂存、忽略/未跟踪文件、引用/置顶/当前会话保护和退出等待；附件验证原路径、超过旧 IPC 限制的粘贴图片、导出、清理与迁移兼容。只用合成数据/上游，未读取真实凭据/聊天库、未覆盖正式构建、未重启活动客户端、未推送或部署。证据位于忽略目录 build/qa/worktree-background-20260928。


## 紧凑模型弹层与保存时档位检测（2026-09-28 JST）

模型按钮先打开两行标题与滑块的小弹层，当前中文档位、模型名、右上角重置；点击模型名才展开来源列表，选完返回参数页。按用户截图收紧至示例 224×96，原始参数、来源和检测说明放入悬停提示。Fast 改为左上角闪电，仅当前原生模型明确支持 priority 时显示，启用点亮；没有能力证据则不占位。保留键盘、焦点、绑定锁和服务默认语义。

API 设置保存时检测启用的模型：light、low、medium、high、xhigh、max、ultra 原样独立测试。基线与无效值对照防止将“任意参数均成功”当成全部支持；只有实际接受的档位进入 API 滑块。显式指定的候选不支持或未能验证时，拒绝保存并保留编辑内容、旧配置和旧密钥。鉴权、限流、服务器与网络故障不冒充不支持。请求/时间/响应有界，不自动重试，不带用户历史或原生登录资料。缓存 24 小时；可在保存前选择重新检测，不会后台消费额度。

验证：隔离提交树全仓 **785/785**，模型/设置/原生传输专项 **61/61**，隐藏 Electron **18/18**、零 renderer errors；TypeScript、生产参数构建与公开文档检查通过；已检查浅/深色、窄窗口、Fast 与失败保存截图。合成 HTTP 服务验证真实网络传输、原子拒绝、缓存与重启；没有调用真实商业模型或验证其思考质量。插件接口、生命周期和验证范围同步记录于 docs/36-workbench-plugin-api.md。证据位于忽略的 build/qa/model-effort-20260928；不操作用户活动窗口、不覆盖正式 dist、不推送或部署。

> 实现与验收日志；按各条目的日期和范围阅读，同一功能的后续修订优先。成员名为公开别名；本地证据未随仓库分发。 [文档导航](README.md)

## 默认压缩预算调整为 90%（2026-09-28 JST 后续修订）

按用户要求统一将模型容量的默认请求预算由 95% 调整为 90%，保留完整容量、未知值、手动映射与原生压缩策略。例：258400 → 232560，32001 → 28800。模型详情、model-api/context-budget 的 percent/compactAt、两家原生启动参数及相关测试同步修改；无新增存储字段，已运行进程保持原配置。Codex 实报可用窗口仍是其原生的 95%，与压缩阈值分别验证。更保守的原生预留仍可提前触发，不承诺精确 token 边界。

同轮只读检查确认：现有斜杠菜单仅覆盖工作台操作和当前运行时技能，截图所示的完整原生内置命令、手动压缩入口尚未接通；本次比例修改没有声称补齐该菜单。

验证：隔离提交快照全仓 800/800，TypeScript 与 Vite/host 构建通过；两家真实 CLI 加合成上游压缩 19/19、审批/恢复 7/7；隐藏 Electron 界面 6/6，已查看浅深色及窄窗口截图；公开文档 40 份、190 个宿主入口、0 问题。原生用量为合成输入，不证明真实长文本摘要质量。没有操作用户活动客户端、调用付费模型、推送或部署。本轮证据位于忽略目录 build/qa/context-budget-90/。下方 95% 条目保留本日早期版本的历史验证结果。

## 模型详情 95% 预算与原生压缩复核（2026-09-28 JST）

模型 API 的模型“详情”新增只读自动压缩预算，按已声明容量的 95% 向下取整；例如 258400 得到 245480，完整容量独立保存，未知保持未知。保存后用于新启动的原生进程。稳定只读入口 model-api/context-budget 与既有 save/refresh、服务替换入口同步开放，见文档 36。

Codex 0.155.1 的 ModelInfo 会将请求阈值进一步限制在容量的 90% 以内；工作台保留其原生安全限制，不虚增容量来强制达到 95%。Claude Code 2.1.283 的自定义模型路径不能仅靠百分比或 AUTO_COMPACT_WINDOW 降低阈值，现将 95% 预算送入 MAX_CONTEXT，完整模型容量仍用于展示。原生预留和检查时机可能让两家更早压缩，UI 明示预算不是精确触发点。

真实 CLI/合成上游检查 19/19：32K、64K 名称别名、128K、非整档 258400、400K、1M 和任意数值 1050000；压缩事件后摘要进入下一请求，所有请求使用同一配置模型。128K 的 50% 不压缩；258400 的 Codex 89% 不压缩、90% 压缩，Claude 94% 已压缩；显式 DISABLE_AUTO_COMPACT 仍被遵守。1050000 只是数值夹具，不是某个商用模型容量声明。证据不能证明真实长文本摘要质量、任意上游兼容或官方服务内部模型大小。

scripts/test-context-budget-ui.mjs 的 6 项隐藏 Electron 检查通过：即时计算、目录刷新保留手工值、未知清空、保存回读、浅深色和窄窗口；scripts/test-native-compaction.mjs 为上述 19 项原生检查入口。最终隔离快照：TypeScript、Vite/host 构建通过；全仓 789/789，另有原生审批/恢复回归 7/7；文档 40 份、188 个宿主入口、0 问题。全仓首次运行的原生技能测试依赖失效默认 npm 路径，显式指定已核验的 AGENT_WORKBENCH_TEST_CODEX_EXECUTABLE 后全部通过，未改技能实现。浅深色与窄窗口截图已查看。资料位于忽略目录 build/qa/claude-compaction/；没有读取真实登录/聊天库、调用付费模型、操作用户客户端、推送或部署。

## 会话审批、分页、Markdown 与模型窗口（2026-09-28 JST）

本轮完成命令审批的紧凑展示及两家原生记住规则、多题分页、已回答问题归入原回合、原文/译文/子会话 Markdown 与独立代码复制、严格工具批次顺序、HTTP 失败后手动继续，以及按上游模型容量配置原生窗口。Codex 未知模型的 max_context_window 会截断仅传入的 1M 配置，现使用安装版本公开目录形成进程专用映射；Claude 的家族/[1m] 名称采用必要的网关内部预算别名，准确的上游 ID 不变，主动压缩不关闭。容量缺失显示未知，映射支持手工来源并保留刷新值。

专题、兼容边界及许可证核对见 [会话 UI 与模型窗口](conversation-ui-20260928.md)，同轮开发接口和覆盖矩阵见 [文档 36](36-workbench-plugin-api.md)。历史 400 没有保存原错误正文，不能据此确定那次的具体原因；已复现和修复的工具消息顺序问题独立记录。

验证：TypeScript 通过；以已提交 2b45ed7 加本轮独立源码冻结，全仓限制并行复跑 752/752，零失败、零跳过。默认高并行运行曾在既有原生记忆配置探测用例失败；同一用例单独运行及限制并行的完整复跑通过，未确认其环境根因，没有把失败删除或改成跳过。真实 Codex 0.155.1 / Claude Code 2.1.283 加合成 loopback 上游的审批、HTTP 400 手动恢复和原生窗口探测 7/7；1M 模型的 Codex 原生可用预算为 950000，保留运行时自身余量。隐藏 Electron 真实组件及模拟宿主桥 9/9，覆盖浅深主题、窄窗口、分页草稿和精确代码复制。完整应用隐藏 Electron 问答流 24/24，零 renderer errors，覆盖原生重连复用请求 ID 后两轮历史各自保留、分页、预览与翻译开关，以及既有原生工作树分叉回归。验收中发现旧 ID 覆盖历史，已修复并增加 5 项单元回归；一次新增测试把强制停止误断言为 idle，已改为正常回答第二轮后复核，没有放宽产品的未知回执保护。浅深主题与窄窗口截图已检查。冻结生产参数构建通过；公开文档检查 40 个文本文件、185 个宿主方法、0 项发现，检查器测试 3/3。并行窗口未完成的技能连接、模型推理探测等改动不在本轮冻结与提交范围。

本地忽略证据目录 build/qa/approval-ui/。没有真实付费模型或实际 1M 文本语义验收，没有读取真实登录/聊天库、操作用户客户端、远端部署、覆盖生产 dist 或推送。源码变更不会自动替换正在运行的旧桌面实例。

## 预览回车与工作树聊天分叉（2026-09-28 JST）

普通发送及回答预览默认聚焦确认按钮，Enter 走原有确认发送动作；IME、长按重复和修饰键不触发提交，Escape 返回修改。renderer 插件可订阅、确认、取消当前精确预览，也可替换专用界面 surface。

消息末尾新增紧凑二选一，侧栏分叉菜单同样可选原目录或新工作树；新会话依次使用原名加 `(1)`、`(2)`，继承历史末尾显示“从聊天中继续”，可回到父聊天的准确位置。本机 Git 工作树使用独立 detached HEAD checkout，复制当前暂存/未暂存修改和未忽略普通文件，核对源目录及复制结果，不切换源分支。设置新增根目录和托管工作树列表；失败时不强制删除有修改的目录。归档/删除聊天仍保留文件。

开发接口、事件、错误、权限、兼容与示例见 [插件接口](36-workbench-plugin-api.md#预览确认与工作树聊天分叉2026-09-28-jst)。原生 CLI 不会自动替工作台生成这些 UI 与 Git 生命周期。Codex 分叉按原生回合边界返回独立 thread；原生 Claude 的既有未验收分叉门禁保留。自动清理、可恢复快照、Local/Worktree 交接和远端工作树未实现。

已验证：隔离提交源码 TypeScript 与全仓 725/725 单元/协议测试通过，零跳过；隐藏 Electron 22/22 原生问答/预览检查及 13/13 分叉界面检查通过，零 renderer errors。实际 Codex 0.155.1 在合成 loopback 上游完成准确历史分叉、新工作树 cwd 与后续回合；真实 Git 临时仓库核对暂存/未暂存/未忽略文件、原目录不变、缺失工作树拒绝继续、编号、来源跳转和重启恢复。开发服务覆盖/恢复与预览过期/重复动作也有断言。浅色、深色和 860×640 窄窗口截图已人工检查，短内容不撑高、长正文内部滚动，确认按钮保持可见。

本地证据保存在忽略的 `build/qa/preview-forks-20260928/`；文档检查通过。使用独立构建、临时原生 Home 与合成模型/翻译端点，未读取用户聊天库、调用真实付费模型、改动正式 dist、操作活动客户端或部署远端；并行未完成的审批、Markdown 和模型配置改动不纳入本轮提交。

## U107 · 原生交互核对、紧凑问答与可选翻译（2026-09-27 UTC）

补齐 Codex 原生提问与 Claude `AskUserQuestion`：单选、多题、多选叠加其他回答、自由文本、拒绝、隐私回答、单次回复和请求过期。答案回复既有原生请求，不额外启动回合；新宿主 receipt 防止旧 UI 回答复用 ID 的新请求。追加简单 MCP 表单/URL、已识别的本回合额外权限、原生计划/异步问题与未知请求的明确不支持回执，常规审批仅显示原生提供的会话级允许选项。重启保留历史，失联请求不能继续点击。

按本轮 UI 反馈移除大卡片、重复标题和过大选项；在原文下逐项显示问题及选项译文。中文自由回答复用现有输入翻译和左下角“翻译后直接发送”：开启直接回传译文，关闭先预览；编辑、配置变更、停止和过期使旧预览失效。**翻译模块关闭时没有问答翻译调用或翻译预览**；处理中关闭保留草稿、取消旧结果，不自动发送原文。非隐私问答记录保留原稿与实际提交，隐私值不进入工作台问答历史或独立翻译。

2026-09-28 JST 后续修正：回答预览中的原问题同样采用原文在上、译文在下，按问题 ID 复用已有译文，不新增翻译请求。普通会话预览改为中文原稿在上、实际发送英文在下，移除弹窗内的修改/补充框；返回修改保留原稿、使旧预览失效并恢复输入框焦点。两种预览共用内容自适应浮层：按中英文长度和换行量选择 440/520/620px 宽度，短内容不撑高，高度上限为窗口的 76% 且不超过 680px；长文只滚动正文，底部按钮始终可见。浮层独立于双栏阅读区，缩成窄窗口不会随原文栏隐藏；问答返回修改同时显示原问题并聚焦回答框。全部功能仍受翻译模块开关控制。共用 `PreviewModal` 为应用内部渲染组件，沿用既有 draft/interaction 准备、取消、提交接口及权限生命周期；本轮未新增插件可调用入口。

后续验收：TypeScript、隔离源码 680/680 及合入阅读器提交后的 690/690 单元/协议测试通过；隐藏 Electron 19/19 交互检查完成独立与集成回归，已检查短/中/长内容和深色 860×640 截图。详细检查记录和截图保存在本机忽略的验收目录。扩展问答按原生回合完成回执验证，不把进程清理进入 idle 的时点当作本轮预览结论。旧 `test-desktop.mjs` 的运行时权限默认项及 `test-translation-module-ui.mjs` 的历史会话载入 demo 入口在普通预览修改前后的构建均复现失败，未计入通过项；对应断言已随移除编辑框更新，遗留入口问题保持单独记录。未操作用户活动客户端或覆盖生产 dist。

逐项矩阵、未实现项目和官方升级边界见 [原生交互核对](native-interactions-20260927.md)。仍未实现高级 MCP schema/verification、结构化策略 amendment、entries/glob 权限模型、全量原生斜杠菜单、外部 token/attestation 回调；SSH 根回合结束后的全部子请求生命周期和 Claude H 不宣称已验收。官方引擎升级不等于新 UI/协议自动适配。

验证：全仓 **680/680**、专项 **49/49**（子集），零跳过；实际 Codex 0.155.1 / Claude Code 2.1.283 **4/4**，另用已安装 Codex 0.157.1 **2/2**；全部原生探测使用临时目录和合成 loopback 上游。隐藏 Electron **14/14**、零 renderer errors，TypeScript 与隔离生产参数构建通过；浅深色、860×640 与预览截图已检查。证据位于忽略的 `build/qa/native-interactions/`。未调用真实账号、操作用户活动客户端、改原生配置、覆盖生产 dist、部署 VPS 或推送；原固定版本执行门禁保留。

## U99：两家原生安装默认、npm 可选（2026-09-27 后续）

「运行时 CLI」中，未安装的 Codex 与 Claude Code 都默认选择官方原生安装；下拉选项保留 npm，选择本身不会安装。没有 npm 时仅禁用 npm 选项，不阻挡原生安装。已安装卡片显示实际安装方式，检查更新、更新与卸载沿用原渠道，不把用户现有 npm Codex 自动迁移为 native，也不改变配置目录。

已接入 Codex Windows 官方 PowerShell 安装器与短入口发现，识别其原生版本目录/junction 布局；原生版本检查改为官方 releases channel，npm 沿用 npm registry。Claude 补齐可选 npm 包的发现、更新与卸载，原生仍使用原安装器及 `claude update`。Codex 原生卸载先检查程序边界与链接，持有安装锁，仅移除已核验的程序内容，保留 `.codex` 原文、其他包、无关文件与桌面端。

验证：全仓 **535/535**，新增渠道与卸载专项 **9/9**，TypeScript/生产构建通过。专项包括两家默认原生/可选 npm、无 npm、原渠道更新/检查、安装状态竞争、Codex junction 发现与保留边界、链接替换拒绝、Claude npm 卸载；持锁后再次核验 launcher/版本文件，拒绝主机检查后发生的外部替换。Codex 原生卸载命令在临时 Windows 样例目录中实际执行，其余安装/更新使用模拟执行器；未在用户环境执行官方安装器、渠道迁移或卸载。

隐藏离屏界面：安装方式/维护/插件 **8/8**、CLI 条件显示 **6/6**、通用桌面 **47/47**，renderer errors 为 0；已查看 860×640 安装方式选择截图。生产构建已更新，没有操作用户正在使用的窗口。证据为 `build/qa/native-install-{tests,typecheck,build,safety,ui,conditional-ui,desktop}.log` 及 `runtime-management-ui/report.json`、`local-cli-ui/report.json`、`desktop-report.json`；所有样例、下载参考与构建产物均不纳入提交。

## U97–U100：CLI 维护修复及两家原生插件目录（2026-09-27 后续）

修复前后端共用全局忙碌锁：Codex 与 Claude Code 可同时检查/更新，各自运行时内互斥；偏好写入独立，检查过程中仍可关闭自动更新。自动维护在没有运行中/结果未知会话及待处理会话操作时进行，启动前复核空闲，任务准入也检查维护锁。安装默认获取最新版；后续更新沿用原生安装/发布渠道。

已安装 CLI 增加卸载图标及二次确认。主机端核对安装 revision 和渠道，Codex npm 先验证全局 prefix；Claude native 仅移除 launcher 和二进制版本存储，允许安全解除官方 launcher hard link，拒绝替换成链接目录的目标。保留原生配置、登录资料、记忆、技能、交接档案及工作台偏好；未知渠道显示限制。未在真实用户环境执行安装、更新或卸载来证明此功能，命令和身份/空闲/并发/保留范围由模拟执行器验证。

Codex 0.157.1 使用隔离 strict-config 正/负探测识别工具聊天记忆字段，修复第二开关被旧版本白名单锁住。Claude Code 2.1.283 通过原生初始化元数据及禁用差分发现 **15 个自带技能**，移除 2.1.281 的意外精确限制。技能设置使用本机实际 CLI，不复用固定版本执行桥。关闭的 Codex 父插件可以在明确影响范围后启用，并保留其他技能的独立停用项；真正的项目/托管覆盖有解释入口。原生配置短进程完成后清理整个自有进程树，解决后台发现子进程持有管道导致等待超时的问题。

插件页增加两家原生「已安装 / 可安装」列表、运行时/市场来源、整组开关和安装确认。Codex 使用 native installed/list/install 与版本化配置写入；Claude 使用 native available JSON、用户范围安装及 enabledPlugins。未注册的 Claude 官方市场可以先预览；选择安装后才由原生 CLI 注册。目录部分失败时保留已安装证据，操作后必须回读。没有把原生插件复制成工作台宿主扩展，也没有自动接受额外安装命令或凭据授权。

验证：全仓 **526/526**；TypeScript 与生产构建通过。当前 Codex **0.157.1** / Claude Code **2.1.283** 的隔离原生验收 **12/12**，包括两家的真实本地样例插件安装、原生目录回读、整组开关、父插件启用及技能发现/禁用/恢复。资源界面 **29/29**、CLI 条件界面 **6/6**、并行维护/卸载/插件界面 **6/6**、通用桌面 **47/47**；renderer errors 为 0。已查看 860×640 插件布局和卸载确认截图。通用桌面测试补等异步能力条目载入，不改变能力验收标准。

证据：`build/qa/runtime-management-{tests,build,desktop}.log`、`native-skill-controls-current.log` 与 `native-skill-controls-report.json`，以及 `native-resources/report.json`、`local-cli-ui/report.json`、`runtime-management-ui/report.json` 和对应隐藏离屏截图。真实原生命令仅在临时 Home/本地合成插件中验收；用户的 CLI、配置、记忆与已安装插件未被测试改动，未发送模型任务或修改 VPS。未认证所有远端市场、套餐权限、插件依赖/鉴权及托管策略；失败仍须原生核对。生产构建已更新，未主动重启或操作用户的工作台窗口。

## U99–U100：本机 CLI 管理与原生记忆控制（2026-09-27 后续修订）

已实现「运行时 CLI」设置页：本机可执行文件/版本发现、官方版本检查、可选官方默认安装、按识别渠道更新与默认关闭的空闲自动更新。Windows Codex 使用现有 npm，缺少前置条件时明确提示；Claude 使用官方安装器与 native updater。没有配置目录接管、登录复制、缺失 CLI 强制安装或固定版本执行桥替换。新任务选择器过滤缺失运行时，发现变化保留草稿，历史会话绑定不改。

记忆页增加独立的本机原生控制：Codex 主开关同时控制 feature/generate/use，另保留工具聊天来源选项；Claude 使用 `autoMemoryEnabled`。原生配置为状态来源，保存前检查版本/原文 revision，保存后回读，外部修改通过聚焦/定时刷新体现。交接开关继续独立；零安装、一家、两家及卸载后历史管理分别呈现。缺失运行时暂停交接且不清空原文、档案、队列和偏好；接收方关闭或未知时不发放。远端自动记忆关闭只修改仓库启动参数，未部署或修改真实 VPS。

验证：全仓测试 **515/515**、TypeScript 通过（`build/qa/cli-memory-full-tests.log`、`cli-memory-typecheck.log`）；原生资源隔离 Electron **29/29**（`native-resources/report.json`），CLI 条件界面 **6/6**（`local-cli-ui/report.json`），通用桌面 **47/47**（`desktop-report.json`），renderer errors 均为 0。已查看两家记忆页及 CLI 页 860×640 浅色离屏截图。测试使用真实安装的 Codex 0.155.1 配置 API 与隔离 Home；安装/更新通过模拟执行器检查命令、并发和超时，不执行真实升级。配置进程改为关闭 stdin 后等待退出，避免上一个原生进程未退出便重开引起的偶发失败。桌面测试补等示例输入载入完成，避免测试先提交旧文本。用户要求停止桌面输入后，后续 QA 使用隐藏离屏窗口，不操控用户窗口。

Claude Desktop 核查：按用户明确要求参考 CC Switch 的 3P profile 文件方式，使用假 key 与关闭的回环端口、重启已安装 Desktop；只读确认进入 Gateway 首页。没有进入记忆设置页，因此不能宣称已实看「只有一个开关」。四个临时文件/受管字段均已按所有权收据清理，保留应用新建的无关偏好；再次只读确认恢复官方登录入口。未读改原有 packaged-app 配置、CLI 登录或聊天数据库。

边界：Claude 的 MDM/Windows 注册表/server-managed 和全部启动覆盖未完整解析，面板不是任意会话最终有效配置的证明。CLI 自动记忆与 Desktop Chat/Cowork/3P 设置不能混同。此轮未执行真实模型回合、记忆吸收/召回、真实安装升级或 VPS 部署；原有 H 与远端到本机记忆映射门禁继续保留。

## U97：Claude 官方技能、原生开关及官方/个人入口（2026-09-26）

补齐 Claude 已安装官方插件发现，按原生注册表的实际版本和声明子集读取；另从本机 Claude Code 2.1.281 的隔离初始化元数据中自动发现 15 个自带技能，排除固定命令，不创建或复制 Skill 正文。列表统一为「Claude Code · 官方」，不追加“内置”。官方页仅查看与开关，无导入或导出按钮；个人页保留 ZIP 导入和右侧导出，导入始终写入用户选择的原生个人目录。后端同样拒绝官方导出，且在打开保存对话框前检查。

替换旧工作台独有的开关：Codex 经官方 skills/config/write 写入原生配置，文件按路径、插件技能按原生命名空间；Claude 普通/自带技能写入 skillOverrides，插件技能以 enabledPlugins 整组控制，并在界面先确认范围。状态从原生配置读取，保留不相关设置；已发现的项目覆盖、无配置接口、无效配置不能假称已成功。旧版关闭偏好提示重新应用，不自动批量修改原生资料。

按用户最终决定，保证**新会话生效**，提示「已保存，新会话生效」，无需重启工作台，不主动重载既有会话。本机设置不冒称覆盖独立远端、会话启动覆盖或已经载入的上下文。自带技能没有可分享的 SKILL.md；详情解释这一事实，列表不增加分类标签。

验证：TypeScript/生产构建通过；全仓单元与协议 **502/502**，末次局部调整后资源专项 **34/34**；真实隔离 Electron 资源界面 **28/28**、通用桌面 **47/47**。固定原生 Codex 0.155.1 / Claude 2.1.281 离线验收 **8/8**：Codex 系统及实际安装的插件技能经新原生扫描确认关闭/恢复；Claude 自带技能从原生发现移除且直接调用被拒绝，个人技能 frontmatter 别名也被拒绝，插件由真实 enabledPlugins 控制。不是仅检查复选框或工作台目录。已查看最终官方页截图，确认简化标签、无导入/导出及新会话提示；个人页与窄屏导入流程回归通过。

证据：`build/qa/native-skill-controls{.log,-report.json}`、`skills-native-{build,full-tests,resource-tests,ui,desktop}.log` 与 `build/qa/native-resources/` 报告/截图。全部写入验收使用临时原生 Home 和合成技能/插件，未修改真实用户资源、启动真实模型回合或部署 VPS；没有重启用户正式工作台。截图中的 Claude PDF / Claude Word 为隔离测试样例，不是替用户安装的官方插件。此节覆盖下方“只过滤工作台目录”和“官方技能可导出”的历史实现描述。

## U97 简化入口：直接打开 Skill 导入弹窗（2026-09-26）

按用户认可的弹窗样式，移除导入按钮前置的安装目标下拉菜单及箭头，删除闲置菜单组件与样式。点击「导入 ZIP」立即打开现有拖放弹窗，目标仅在顶部 Codex / Claude Code 标签选择；初始显式选中 Codex，可切换后再拖入或选择文件。保留原有弹窗尺寸、字体、颜色、图标、虚线区与安装流程。修复点击遮罩关闭时焦点被浏览器默认行为带走的问题，关闭后返回导入按钮。本节覆盖下方“先选目标再打开弹窗”的历史记录。

验证：TypeScript 与生产构建通过，隔离 Electron 资源专项 **26/26**、通用桌面 **47/47**。实际验证一键打开、无前置菜单、弹窗内切换目标、点击/拖放安装、取消与错误恢复、键盘和遮罩关闭、焦点返回，以及深浅色/窄窗口截图。证据为 build/qa/skill-direct-{build,ui,desktop}.log 与 build/qa/native-resources/ 的 report.json / skill-dropzone-*.png。仅使用隔离测试 Home，未重启用户工作台或改动真实个人资源。

## U97 后续修订：紧凑弹窗与 ZIP 拖放安装（2026-09-26）

保留先选 Codex / Claude Code 的 176 px 紧凑菜单，选好后打开 440 px 宽的导入弹窗。顶部是细文字标签，下方为带 ZIP 图标的单一虚线区，支持拖放和点击选择文件；沿用文学字体、暖白/中性炭灰主题，无路径输入或两块大选项卡。该流程覆盖下方历史记录中的“选来源后立即打开文件选择器、不显示弹窗”。

本机拖放通过 Electron preload 的 webUtils.getPathForFile 接入后端原有 ZIP 安装器，目标仍为用户选中的原生个人目录。两种入口共用校验、不执行脚本、不覆盖已安装内容。错误在弹窗内反馈并允许重试；取消文件选择保留弹窗；安装期间禁用重复操作、来源切换与关闭，并保持焦点；成功关闭弹窗并用返回目录刷新列表。

验证：TypeScript 与生产构建通过；全仓 **495/495**，资源专项 **27/27**；隔离 Electron 资源 UI **26/26**、通用桌面 **47/47**。真实磁盘文件通过 Chromium 拖放事件经过 preload/IPC 安装到 Claude，Codex 文件选择器安装与导出往返保持通过；检查多文件/非 ZIP/损坏文件/重复安装、取消与焦点锁定、来源切换、深浅色和 860×640 布局。所有文件操作仅使用临时原生 Home。证据：build/qa/skill-drop-{build,full-tests,resources,ui,desktop}.log，build/qa/native-resources/skill-dropzone-{dark,hover-dark,light-narrow}.png 与 report.json。没有重启用户工作台、修改真实个人资源或推送部署。

## U97 修订：导入时选择提供方与 Claude 展示兜底（2026-09-26）

点击 Skill「导入 ZIP」在按钮下方展开约 176 px 宽的两行文字菜单，选择 Codex / Claude Code 后打开文件选择器。根据用户对首版卡片弹窗的否定反馈，已移除居中弹窗、遮罩、两张大卡片和说明文案；沿用现有菜单样式，支持方向键、Escape、点击外部关闭和焦点返回。两者均为个人安装，目录自动识别，不显示目录输入或常驻提供方筛选；主机和服务层不再接受省略目标或 auto，不替用户默认选 Codex。成功后通知实际目标并刷新来源标签。关闭菜单不打开文件选择器，取消文件选择不安装，可重新选另一方；已有安装拒绝覆盖。

原生导出只打包技能与资源，不绑定导出电脑上的来源标签；真实 Electron 已验证 Codex 安装、导出、再装入 Claude 的往返，资源保留且新标签为 Claude Code · 个人。针对用户追问，核对 OpenAI / Claude 官方文档与 CC Switch 上游源码：agents/openai.yaml 为可选信息，缺失时用原生 SKILL.md 的名称/描述、界面单行省略和通用图标，不生成文件或摘要；同一原目录的两方链接只列一项并保留双方来源。CC Switch 的链接/复制分发不等于运行时语法转换，详见 docs/07-research-sources.md 与 docs/35-native-memory-skills-plugins.md。

验证：构建与 TypeScript 通过，全仓 **494/494**；真实隔离 Electron 资源专项 **22/22**、通用 **47/47**，无 renderer error。补充后端目标必选/非法目标/取消不落盘、官方导出再装个人目录、两方目标隔离、无 openai.yaml 展示与共享链接来源回归；已检查菜单尺寸、与按钮的锚定关系、无卡片边框/遮罩、方向键和外部点击关闭，并查看暗色及浅色窄屏截图。证据为 build/qa/skill-install-{build,full-tests,ui,desktop}.log 及 build/qa/native-resources/ 截图/报告。全部安装与文件操作使用临时 Home，没有修改真实 Skill、记忆或 CC Switch 配置，没有启动真实模型或推送部署。

## U96–U98 修订：自动同步、记忆管理与原生 Skill 阅读列表（2026-09-26）

按最新参考图与用户要求，记忆配置只保留「Codex与Claude Code自动同步」开关，另显示最近成功同步的本地日期时间，以及「查看与管理记忆」入口。取消首次同步、方向、目录和 Claude 项目选择，开启后直接同时处理双方已有及后来新增的原生资料；没有启动过 Claude 也能建立全局读取入口。运行期间五秒检查，退出期间的原生变更在下次启动补齐。全局指令与项目自动记忆均自动发现，保留项目范围；自动同步不改写原生正文与 Codex 生成索引。旧版已启用状态迁移，未确认的默认连续开关不视为写入许可。

记忆管理器可搜索、查看、编辑并确认删除原始文件；同步副本不重复列入列表。明确保存或删除时才修改所选来源，开启同步会立即更新另一侧；关闭期间也可管理，重开后补齐。原文版本校验拒绝覆盖并发外部更新，保留草稿，离开未保存内容需确认；独立原件和受管入口保留，删除空 Codex override 的正文不会意外激活旧 fallback。源文件保存成功但副本冲突时分别反馈。未读取或修改真实用户记忆作为测试数据。

去重采用正文指纹及来源回执，忽略 BOM、换行差异与首尾空白；相同内容复用正文并保留各来源范围，相同索引但相对主题不同则保持独立。排除自己的同步副本、入口块、旧来源指针和 Codex 中间提取输入，防止双向回流。来源更新或删除只维护所属副本，外部编辑冲突保留双方；不开模型回合、不冒称语义合并近义或矛盾记忆。公开机制核查与实际限制见 [原生记忆、Skill 与插件](35-native-memory-skills-plugins.md)。本节覆盖下方旧版首次同步与单向选择记录。

Skill 改为无外框的阅读式列表：上方官方/个人文字标签与搜索，左侧图标，中间标题及一行短描述，右侧「Codex · 个人」「Claude Code · 个人」等来源标签、开关、导出。直接读取原生 agents/openai.yaml 的显示名、短描述与包内图标，模型使用的原生名称/描述不变。移除来源与导入位置选项框，ZIP 自动装入已检测到的原生个人目录；同名冲突、逐路径开关和完整资源分享保留。插件收起行压至约 70 px，新增插件后说明仍在最后一个插件下方。

验证：构建与 TypeScript 通过；全仓单元/协议 **491/491**；真实隔离 Electron 通用 **47/47**、专项 **19/19**，无 renderer error。专项含工作台外同时新增、未启动 Claude 的全局入口、单开关及同步时间、原文编辑/删除及对应副本更新、并发冲突与草稿保护、搜索、官方/个人提供方标签和原生图标、说明单行/导出位置、插件高度/说明置底、ZIP、重启及 860×640 无横向溢出；已查看最终浅色、深色与窄屏截图。证据为 `build/qa/native-resources-v2-{build,full-tests,desktop,ui}.log` 与 `build/qa/native-resources/` 报告/截图，均不提交。

所有写入验收使用隔离临时 Home；没有改写真实用户记忆/Skill、调用真实模型、联系并行会话或部署 VPS。仅本地提交，不推送。原生模型 H 联验状态保持原有边界。

## U96–U98：原生记忆、Skill 与插件（2026-09-26）

记忆改为自动识别当前用户的原生位置，兼容 `CODEX_HOME`、`CLAUDE_CONFIG_DIR`、Claude 项目记忆及 `autoMemoryDirectory`。记忆页没有目录输入框、浏览按钮或路径展示；只有多个 Claude 项目时需要选择项目。用户选择 Codex → Claude 或 Claude → Codex，首次手动同步成功后启用默认打开的持续同步；工作台运行期间检查更新，重启恢复，切换来源后重新确认首次同步。目标自身记忆保留，只维护本工作台拥有且哈希未变的文件与索引；冲突不覆盖，来源删除只清理对应投影。测试同时覆盖空来源删除、写入冲突、方向变更和重启恢复。

官方机制核查没有发现 Claude 可直接运行 Codex 提取/整合引擎的依据，因此实现 Markdown 文件适配。Claude 目标通过原生 `MEMORY.md` 索引发现同步内容；Codex 目标通过原生 `AGENTS.md` 和外部笔记来源指针发现，不覆盖生成的 `MEMORY.md` / `memory_summary.md`。工作台仅保存开关、来源和同步回执，正文仍在原生目录；新会话读取所选来源。此节覆盖下文旧的工作台共享记忆库方案；不再把自行实现自动提取或复制 Skill 资源作为此方案的待办。

Skill 直接发现两家个人、项目、系统及官方插件缓存目录，按真实路径去重，不复制已安装内容到工作台。列表提供来源标签、搜索、逐路径开关、正文按需预览和同名冲突提示；多个同名项同时开启时均不进入新会话可用目录，停用多余项即可消解。开关约束工作台新会话目录，不修改两家客户端的全局配置。ZIP 导入进入用户选择的原生个人 Skill 目录，导出保留脚本、引用和资源；拒绝路径穿越、链接文件、碰撞、超限和覆盖已有安装。本机只读发现实测 **62 个 Skill（39 官方、23 个人），无冲突或扫描错误**。

设置增加「插件」，内置双语工作流移入其中、默认折叠、右侧开关控制既有模块。外部插件通过 ZIP 导入导出，默认停用；支持上下文、颜色、本地背景，以及显式批准后的 Node 宿主入口、命令、请求中间件和退出清理。批准绑定整包哈希，文件变化后需要重新启用；宿主插件是完全信任的代码，不宣称沙箱。上下文和请求钩子已接入现有新会话准备与桌面 dispatcher，管理入口保留停用能力。协议、示例、限制与官方来源见 [原生记忆、Skill 与插件](35-native-memory-skills-plugins.md)。

验证：生产构建与 TypeScript 通过，全仓单元/协议 **480/480**；真实隔离 Electron 通用检查 **47/47**，专项检查 **10/10**，renderer errors 为 0。专项覆盖首次同步与默认持续开关、原生位置自动识别且无目录控件、Skill 冲突与 ZIP 资源往返、插件上下文/颜色/背景/停用、重启恢复及 860×640 浅色布局；已查看最终记忆深色和插件窄屏浅色截图，其余受影响页面亦完成视觉检查。证据：`build/qa/native-resources-{build,unit,desktop,ui}.log`、`build/qa/native-resources/report.json` 和同目录截图，均为不提交的生成物。

验证写入仅使用临时原生 HOME，不修改真实用户记忆、Skill、原生配置、账号或 VPS；没有真实模型调用。接线和本地验收不等同于 Claude/Codex 的真实 H 端到端验收，不改变既有运行门禁。仅提交本地代码，未推送或部署。

## U95：完整聊天与指定消息分支（2026-09-26）

侧栏右键现有「分支 → 创建聊天分支」；每条回复下方有「分支到新聊天」，用户消息旁有「从此处创建聊天分支」。完整分支保存当前全部历史；回复分支保留该回合及之前内容，提问分支保留该回合之前的历史，并把用户原稿放入输入框，等待用户发送。原文、实际提交文本、既有译文和对应工具/文件修改记录按边界保留，之后的消息不进入分支。分支拥有新本机 ID、创建时间和来源记录，沿用项目、目录、账号、运行时、模型及权限设置；不继承运行中审批、子 Agent 连接或上下文用量。复制时未完成的译文可在分支内独立重试。

新分支立即打开并进入侧栏；来源链接可返回源聊天并定位消息。重命名、归档、删除和后续发送均各自独立；删除源聊天后，分支保留来源标题和全部已保存内容。用户提问生成的待发送原稿可跨重启恢复，成功提交后清除。子菜单支持悬停、方向键、Escape、Tab 与焦点返回，沿用现有暖白/炭灰视觉。聊天分支共用原工作目录，不建立 Git 分支、不复制或回退文件。

Codex 使用固定 0.155.1 的 `thread/fork`，持久化 `lastTurnId` 或 `beforeTurnId`，在首次显式继续时创建独立原生线程；`deferGoalContinuation: true` 阻止创建即触发目标续跑。旧消息通过原生 item ID 与分页历史核对回合，不靠正文相似度猜测；同一回合中间的进度回复不作为完整原生分支点。原生历史由运行时保存，不把聊天正文重新拼成新用户请求，不对源线程调用 rollback。账号服务只允许同账号、同成员工作空间、同设备环境/目录的来源回执，目标来源和边界创建后不可替换；新线程回执丢失但服务已记录 ID 时恢复该 ID，完全不明时保留限制而不自动再 fork。已有子分支恢复不受源聊天后来运行或待确认回合影响。所有后续模型回合继续经过原有身份、H、配给和明确执行环境检查。

验证：生产构建、TypeScript、全仓单元/协议 **468/468**；隔离 Electron **57 项**（分支专项 10、通用桌面 47），已查看侧栏浅色、分支内容和 860×640 深色截图；本地 Linux 真正 Unix socket/peer UID **26/26**，含来源越权/目录变化拒绝、独立分支续聊、broker 重启恢复；真实官方 Windows Codex 0.155.1 在隔离 HOME/CODEX_HOME、合成历史和关闭的回环 provider 下 **8/8**，覆盖完整/向前/向后边界、原历史保留、新线程 ID 与进程重启恢复，**无登录、无模型回合**。证据：`build/qa/session-fork-{build,tests,desktop}.log`、`session-fork-ui/`、`session-fork-account-socket.json`、`session-fork-offline-native.json`，均不提交。

本轮没有部署/升级真实 VPS 服务，没有读取真实聊天库或凭据，也没有真实模型/H 端到端验收。新统一账号服务安装会包含此版本的分支隔离逻辑；已有常驻服务需要显式升级。Claude 原生 Windows 工具链 H 仍未验收，有历史的 Claude 会话分支入口明确禁用，不通过复制文本伪装成可继续的原生分支。已实现的是离线示例完整流程、Codex 原生协议与服务接线，真实模型可用范围继续由各绑定的原生验收决定。

## 运维补记：旧 root CLI 已停用清理

用户明确选择“旧的清空”，包括停用仍在运行的旧账号服务，之后自行从工作台重新安装。已停止并移除 `codex-device-auth.service`、旧 worker slice 的安装文件和启动入口，清除旧账号 socket；删除 `<admin-home>/.local/bin/codex`、`<admin-home>/.codex/packages/standalone` 与 `/opt/codex` 两份旧 Codex 程序，共释放原已分配磁盘 **709,292,032 字节（约 676 MiB）**。原 `/opt/codex-devices` 辅助代码及其中的旧元数据、少量 systemd 配置移至 root 私有的 `<admin-home>/.local/state/retired-codex-cli-20260926/` 留档，不再作为运行入口。下文旧记录中“root 私有 Codex 安装保留”的状态已被本补记覆盖。

`<admin-home>/.codex` 的登录、配置和历史数据，以及原账号服务的数据目录均保留；只检查文件元数据，没有读取令牌、私有配置内容或聊天数据库。退出旧服务时日志/队列 SQLite 临时 WAL/SHM 关闭，主文件仍在原 inode；登录文件 inode、大小和修改时间保持不变。独立浏览器的 `/opt/jp-remote-browser` 与 `/var/lib/jp-remote-browser` 保留，三个 sing-box SSH 身份、公钥和 SSH 配置没有修改；没有系统包操作。

真实验收：旧程序、服务入口、socket 与进程已不存在，root 登录环境中两家 CLI 均不可解析；root 新连接、PC1 原密钥新连接与实际 TCP 转发通过，`sshd -t` 通过，未冒称 PC2/PC3 设备实连。工作台当前实际安装预检返回 `installable`、无阻断，只有 `CLI_MISSING_CODEX` 与 `CLI_MISSING_CLAUDE`，不再发现旧 CLI。本轮没有重新安装、登录或调用模型；旧账号服务入口按用户选择停用，保留数据不代表已经接入未来的新服务。证据位于 `<private-evidence>/root-cli-cleanup\` 的 `retirement-receipt.json`、`workbench-plan-after.json` 与 `ssh-forward-check.json`。

## U94：永久删除空间、SSH 特例保留与 root 集中公钥（2026-09-26）

本节覆盖下文 U89/U93 的旧“仅删除登记、保留用户文件”语义。正常删除现在核对普通 Linux 用户、UID/GID、整个 `/home/<username>`、工作目录、目录 inode/device 与根拥有的父目录；拒绝外部根目录、符号链接、挂载（包括同设备 bind mount）、身份变化和 SSH 专用保留用户。预览显示整个 HOME 与分配磁盘占用，输入精确用户名才可确认。应用先写入不可重放操作日志并撤销账号策略，再过期锁定该用户、关闭其用户服务与进程、将 HOME 移到根拥有的隔离目录，通过固定 userdel 命令删除身份并用防符号链接遍历删除目录。目录之外的文件不在递归删除范围内，集中登录账号和共享 CLI 不受影响。只有 `purged` 回执才显示完成；未知结果保留限制并查询，不自动重放。旧服务的记录删除预览被拒绝，较大的 apply 允许十五分钟处理。

受管与只读发现的空间均走上述删除流程，不先纳管或暂时授权。设备/邀请撤销、账号使用权与配给清除；成功后移除对应本机连接描述，保留本地历史与用户选择的私钥文件。彻底删除后的“重新创建”改走 create，生成新空间代次与空目录，连接时重新生成设备密钥；不恢复旧数据或权限。

按用户本轮明确授权，**实际在原 VPS 完成一次性清理**：`member-a`、`member-b`、`member-c` 的旧空间、缓存、浏览器和重复运行时数据已删除，三个 HOME 的原分配空间合计约 **2.49 GiB**，随后连剩余 SSH/基础 shell 目录一并删除。保留三个成员身份及原 UID（具体值不公开）供既有网络服务使用。公钥逐字节迁入 root 拥有的 `/etc/ssh/authorized_keys.d/<username>`（0644），目录为 0755；`/etc/ssh/agent-workbench-ssh-only.conf` 仅匹配这三个用户，作为主配置末尾 Include。没有改设备端密钥或改用 root 登录。旧主配置备份在 `/etc/ssh/agent-workbench-backup-20260926/sshd_config`；恢复时不能仅回滚到已删除 HOME 的授权路径。passwd 原 HOME 字段保留但路径已不存在，SSH 转发不依赖它；普通 shell 登录可能提示无法进入原 HOME，三个身份不再用于工作空间。

全程保留 root 恢复连接；候选和生效配置均通过 `sshd -t`，核对 root 的完整有效配置不变，三个成员除了公钥路径外有效选项不变，使用 reload 保留既有连接。迁移后及 HOME 删除后均以原密钥成功建立 root、PC1 新连接；PC1 `-W` 实际 TCP 转发收到目标 SSH banner。PC2/PC3 原私钥不在本机，只有公钥一致、身份和有效配置验证，未冒称两台设备已实连。root 原 Codex 二进制保留，现有 sing-box 配置未改。公开保留清单 `/var/lib/agent-workbench-policy/ssh-only-members.json` 阻止旧名称新建/纳入/删除，发现列表与对应本机工作空间描述不再显示这三位，界面注明 SSH / sing-box 专用身份。通过实际产品的管理和发现代码重新只读连接 VPS，确认三位保留身份可识别，受管/发现工作空间数量均为零（`build/qa/ssh-retained-product-read.json`）。

验证：生产构建和 TypeScript 通过；全仓单元/协议 **452/452**；真实本地 Linux 临时用户生命周期 **13/13**，覆盖实际进程终止、HOME 与公钥删除、同名空白重建、外部链接目标保留、挂载/身份变化/非法操作 ID 拒绝及一次性 SSH 保留；隔离 Electron 管理 **24/24**、通用桌面 **47/47**，已查看 860×640 删除确认、删除记录与重建截图。远端清理证据与产品隔离测试分别保存：`build/qa/legacy-retire-{plan,receipt,verification}.json`、`ssh-centralize-{install,remove-homes,verify}.json`、`destruction-{build,tests,administration,desktop}.log`、`workspace-destruction-linux.json`、`workspace-destruction-20260926/`；均为忽略的本机验收产物，不提交公钥、凭据或用户资料。

本轮**没有在真实 VPS 创建新工作空间、安装集中账号服务、修改原凭据、登录或调用模型**。两家各一份共享 CLI、每个账号一处专用低权限原生登录源、各空间按策略使用的设计不变；root 负责安装和管理。现有 root 私有 Codex 安装不能冒充已完成的 `/opt/agent-workbench/native` 共享部署，仍通过已实现的“确认一键配置”流程准备。程序完整退出重启后使用新构建；已有常驻管理服务若仍为旧版本，必须显式升级才会执行新删除语义。Claude Windows 本机工具链 H 仍未完成。

## U93：管理员空间直接管理与共享 CLI 一键配置（2026-09-26）

按本轮五张截图修复实际入口。管理员工作空间页首次激活即读取管理列表与已发现空间，保留手动刷新、失败重试和连接身份隔离；隐藏页不重复触发，保存管理员连接不再额外发起重复发现。目录生成与成员名提交校验分离：`<digits>` 现在也即时显示 `/home/<digits>/workspaces` 两个预填值，同时提示当前成员用户名须以小写字母/下划线开头并禁用提交；改为 `user-<digits>` 后自动更新。非法路径片段仍不生成目录，自定义字段各自保留，既有用户名与空间根目录不可变。

已纳管和已发现空间的每行均有可访问名称的垃圾桶。未纳管空间支持直接预览删除，服务器核对普通成员 UID、目录、当前版本及外部观测；确认后只登记无账号/设备权限的删除状态，不先纳管授权，不创建/删除系统用户、不触碰原公钥与文件。列表过滤删除状态，刷新不会重新出现，仍可从「已删除的工作空间」复用原身份和文件重建。受管空间继续撤销本服务登记的授权。确认成功后移除本机同端点、所有者、成员及对应代次的连接描述，保留历史会话和密钥文件；失败/未知回执不移除，查询恢复时重新核实当前状态。其他 VPS 或新代次连接不混删。

真实 VPS 只读诊断已经执行：管理员 SSH 正常；root 的 `<admin-home>/.local/bin/codex` 存在，最终指向 `0.155.1` 发布目录，其中 `bin/codex` 与父 `bin` 归成员 `member-b` 所有，且路径经过 root 私有目录，因此不能作为专用服务身份的受保护共享安装。PATH 和本轮检查的常见位置没有找到 Claude，不能扩大为整机任意目录均未安装。旧检测只搜三个共享目录，且错误分类把路径信任失败混成未安装/版本问题，现已分开显示已发现路径、私有/权限/版本状态。使用既有管理员密钥由 SSH 完成认证，没有读取密钥内容、认证令牌或用户聊天资料。

「准备统一账号服务」现在可预览并一键配置缺少的共享 CLI。使用固定官方 Codex 0.155.1、Claude 2.1.281 发布包，按 Linux x64/arm64 与 Claude libc 类型选包；支持的平台使用预置官方 SHA256 和大小，下载完成、校验及隔离 `--version` 自检通过后，才发布到 `/opt/agent-workbench/native/` 独立 root 所有目录，再准备服务。复用已有受保护且匹配的共享安装；不修改 root 原安装、PATH、原凭据、成员用户或系统包，不执行远程 shell 安装脚本。预览不联网下载，确认仍绑定部署快照、完整 SSH 身份及有效期；未知/失败回执要求重新检查，替换 URL/目标、校验不符、链接和外来内容均拒绝。支持已完成相同文件的恢复，已有不匹配服务版本仍不自动覆盖升级。最小窗口中说明区域滚动，确认栏固定可见。

验证：生产构建和 TypeScript 通过，全仓单元/协议 **448/448**；隔离 Electron **85 项**（管理 24、原生账号 14、通用桌面 47），实际查看数字用户名目录、两类垃圾桶、未纳管删除预览、深浅主题和 860×640 一键配置截图。本地 Linux 共享安装 **14/14**：12 项文件/所有权/校验/失败场景，另有两家真实官方 x64 包的实际下载、哈希校验、安装与隔离版本执行；全部安装位于临时目录，测试后清理，没有登录、模型、系统用户或服务操作。原统一服务准备文件系统 **10/10**，系统命令仍用替身。证据：`build/qa/onboarding-{build,tests,administration,native-ui,desktop}.log`，`build/qa/workspace-onboarding-20260926/`，`build/qa/native-account-ui-20260926/`，`build/qa/native-cli-install-official.json`、`build/qa/account-setup-linux.json`。实际 VPS 只读准备回执为 `build/qa/account-plan-live-readonly.json`：可安装、无阻断，明确返回 `CLI_UNTRUSTED_CODEX` 和 `CLI_MISSING_CLAUDE`。

**没有在真实 VPS 下载/安装 CLI、创建服务身份、启动服务、改动空间、登录或调用模型。** 当前程序完整退出后重启，进入管理员页即可自动加载；统一账号服务页的「确认一键配置」才会执行已预览的远端变更。真实部署和原生 H 验收仍是后续步骤，Claude Windows 本机工具链仍未完成。

## U92：统一原生账号源、服务准备与原账号接入（2026-09-26）

本节修复 U82 切换原生来源后，桌面已退出旧认证路径、真实 VPS 却尚未部署或迁移造成的账号不可见与新增入口不可用，以及 Claude 在目录缺少来源时仍显示逐工作空间登录说明的问题。两家现共用管理员管理入口：每个账号只有一处由专用低权限身份保管的官方原生登录配置，工作空间通过授权使用同一账号，不各建一份登录。账号页仅在实际打开时自动读取，避免隐藏页的目录请求打断工作空间表单。

默认目录继续以 `native-owner` 为唯一认证和执行来源，失败也保留来源及不可用状态；另行发现旧服务的公开账号元数据，显示为「已发现的原账号／待集中接入」。旧元数据不使新服务就绪、不进入可选授权账号、不覆盖原生身份缓存，也不恢复旧 token 注入。管理员接入时重新读取并核对旧来源、账号 ID、代次和公开邮箱，保留原账号标识与配给代次；原生登录命令复用该账号已有私有配置。Codex 与 Claude 都从中央入口完成登录，旧会话历史仍走明确迁移流程，公开邮箱核对不冒充账号 ID 的密码学证明。

新增「准备统一账号服务…」检查、预览与确认流程。只读检查复用已有服务，核对 root 身份、工作空间公开策略、受保护共享 CLI、专用服务身份与安装位置；可先接通已满足条件的一家。确认计划绑定完整 SSH 身份、五分钟有效期、部署内容和权限来源；应用一次后消耗，未知结果不自动重试。远端仅安装缺失或内容完全一致的本工作台服务文件，拒绝外来部署、符号链接及 systemd 覆盖；已有服务不可用时不另建认证源。不会替换 CLI、读取或复制原凭据、修改成员用户、停用旧 broker、登录或启动模型。专用目录为 0700，socket 继续使用真实 UID 和工作空间授权。所有 VPS 源码、注释及固定状态为英文/ASCII，中文说明在桌面呈现。

验证：TypeScript、Vite 与 host 生产构建通过；全仓单元/协议 **441/441**。隔离 Electron **82 项**：原生账号 13、管理界面 22、通用桌面 47，覆盖服务缺失、旧账号可见、检查取消/受阻/确认、原账号接入、两家中央登录命令及隐藏页回归；已实际查看深浅主题与 860×640 最小窗口截图。真实本地 Linux 内核 UID/socket **23/23**：三个空间 UID 共用同一 Codex 配置并保持线程隔离，也共用同一 Claude 配置；成员无法读取私有登录目录或取得管理员登录操作，Claude 状态仍明确本机工具链未验收。服务准备文件系统检查 **10/10**，核对只读计划、变更拒绝、同版本中断恢复、外来文件/符号链接/覆盖拒绝、已有服务复用及单厂商准备；创建系统身份和 systemd 命令均使用明确替身。

证据：`build/qa/account-source-{build,full-tests,ui,administration,desktop}.log`、`build/qa/native-account-ui-20260926/report.json` 及截图、`build/qa/account-single-source-socket.json`、`build/qa/account-setup-linux.json`。以上为本地实现、合成原生 CLI/账号与隔离桌面验证，**没有部署真实 VPS，没有真实登录、模型调用或用户历史迁移**。完整退出并重启工作台后加载本轮构建，管理员可从 root → 共享账号 → 准备统一账号服务进入明确预览流程。真实服务部署、账号接入及原生 H/出网验收仍需另行完成；Claude Windows 本机工具链 H 仍未实现/验收，不能以中央账号管理替代。未改变已有工作空间删除边界，也未新增未受管 SSH 连接的垃圾桶入口。

## U89–U91：空间目录默认值、删除重建与账号自动识别（2026-09-26）

新建表单的空间目录和默认工作目录均按有效普通成员用户名自动填入 `/home/<username>/workspaces`。两个字段独立跟随用户名；自定义一个不会覆盖另一个的自定义值，也不会阻止另一个继续自动填写。清空或输入非法用户名时，自动值清空，不产生 `/home//workspaces`。手改空间目录时，仅仍跟随旧空间目录或留空的默认工作目录同步更新。已有空间显示只读用户名和空间目录；修改显示名称或默认工作目录不重命名 Unix 成员、不移动文件，服务端的 username/root/uid 不可变边界保留。

「删除工作空间…」从更多菜单移到空间操作栏。服务端计划确认页明确显示空间名称、成员和保留目录；取消预览不执行。沿用已有删除语义：撤销本空间的账号使用权、管理服务登记的设备公钥和未使用邀请，保留系统成员、文件、其他 SSH 授权及已建立连接。删除后展开「已删除的工作空间」，每位成员显示最近一条可重建记录；有活跃空间复用该成员或 UID 时不提供重复重建。重新创建按纳入流程重新核实保留的 UID 和目录，生成新管理 ID/代次，旧设备和邀请不恢复；账号与配给从空选择开始，需用户审阅，成功后选中新空间。生产后端没有新增系统删除或改名逻辑。

账号空白问题来自表单此前只在点击按钮后读取公开目录。现在打开新建、纳入、配置或重新创建即读取，并移除手动账号 ID 输入。展示已识别账号的邮箱/名称、Codex/Claude、登录状态及套餐；自动读取不自动授予任何账号。读取中、识别为空、服务不可用、请求失败分开显示，提供重新读取；读取期间禁用账号选择和计划预览。已有但本次缺失的账号及配给保留并标明，可显式取消分配。目录刷新保留表单草稿并重新核实额度窗口，取消重开通过请求代次丢弃迟到结果，连接变化仍沿用完整 SSH 绑定的组件隔离。继续只读可信公开账号目录；未安装服务时显示原因，不扫描登录凭据、不回退旧 token 路径，也不自动部署 VPS。

验证：TypeScript、Vite 与 host 构建通过，全仓单元/协议 **430/430**。扩展的真实 Python 控制器合成夹具验证删除后原身份/文件/旧公钥保留、旧邀请失效、重建新 ID/代次且无旧设备/权限，以及显示名称修改不能改系统身份。隔离 Electron 共 **76 项**：管理界面 22、原生账号 7、通用桌面 47；覆盖无缓存自动读取、Codex/Claude 信息、失败/空结果/不可用、取消重开的迟到响应、自定义路径独立保留、缺失账号配给保留及移除、删除取消与确认、重建回执和默认选中。管理夹具修正了重复 UID、删除污染创建模板及额度账号选择的旧假设。实际查看新建深色、异常状态、亮色只读身份、删除预览、重建与窄窗配给截图，860×640 最小窗口无横向溢出，长表单原生滚动。

证据：`build/qa/workspace-lifecycle-{build,tests,ui,native-ui,desktop}.log`，`build/qa/workspace-lifecycle-20260926/` 报告与截图；原生账号回归截图另在 `build/qa/native-account-ui-20260926/`。以上使用隔离资料与合成账号/SSH 回执，没有读取真实账号凭据或用户聊天数据库，没有改动真实 VPS、Unix 成员或正式应用资料；不作为真实服务器账号识别或 SSH 验收。完整退出工作台再启动后加载新构建。

## U86–U88：单字折叠侧栏、拖动调宽与会话工作区（2026-09-26）

侧栏的隐藏动作已改为折叠，标题栏历史按钮右侧增加切换按钮，视图菜单与 Ctrl+B 同步更新。展开状态沿用原来的 240px 最小宽度；折叠为 64px，并继续使用原有项目、会话行及菜单处理。项目以文件夹形单字标和展开箭头呈现，会话用大写首字母或单个中文/Unicode 字素，保留完整可访问名称、悬浮详情、选中态、运行/未读/待处理标记。置顶、分组、项目展开与分页、新建、设置以及鼠标/键盘右键菜单都可在折叠栏使用。搜索会自动展开侧栏，折叠时清除搜索，避免留下不可见筛选。

展开状态的右边界支持指针捕获拖动和键盘左右键、Home/End 调宽；Escape 取消当前拖动，双击恢复 240px。上限取 600px、窗口一半和保留 520px 主阅读区三者较小值，最小宽度仍为 240px。窗口缩小时仅限制当前显示，不覆盖宽窗口偏好；折叠再展开恢复之前宽度。本机界面偏好保存到独立 localStorage 键，损坏或不可写时安全回退。布局变化不重建当前会话，也不丢失当前编辑草稿；本轮没有新增跨会话草稿缓存能力。

最近会话的 ENOENT 来自自动工作目录此前仅在首次原生连接时创建。受支持的新 Codex 会话现于创建时准备该目录；旧未运行会话在打开或浏览工作区时，仅补建宿主生成的同一自动目录。会话菜单改为「打开会话工作区」，使用独立 `session/open-workspace` 路由，由宿主按会话 ID 读取固定 `projectPath`，不接收项目菜单的目录替代；复制为「复制工作区路径」。项目菜单仍为「打开主文件夹」。修改或移除项目不重定向已存在会话。若会话原本选择了项目主目录，这两个入口本就会到达相同位置；没有为既有会话搬目录或创建额外隔离工作树。已使用工作区或用户选择的目录丢失时返回带路径的中文错误，保留原绑定，不创建空目录冒充原文件。

验证：TypeScript、Vite 和 host 构建通过；全仓单元/协议 **426/426**。隔离 Electron **115 项**：新增布局 9、工作区 4、导航 12、侧栏 31、项目 6、通用桌面 47、文件交互 6。真实鼠标拖动、复制菜单、项目与会话目录差异、搜索、主题、860px 窄窗口和独立进程重启恢复已检查；实际查看折叠栏与菜单的深浅主题和窄窗口渲染截图。修复了验收中发现的旧 `.sidebar-divider` 横线样式冲突，拖动控件现用独立样式名。

证据：`build/qa/sidebar-layout-tests.log`、`sidebar-layout-build.log`、`sidebar-layout-ui.log`、`session-workspace-ui.log`、`sidebar-layout-regression-*.log`，及 `build/qa/sidebar-layout-20260926/`、`build/qa/session-workspace-20260926/` 的报告与截图。仅使用隔离资料和合成会话，目录读写、IPC、剪贴板是真实宿主操作，资源管理器启动以可观测 `shell.openPath` 替身验证目标；未冒称真实资源管理器窗口、模型或 SSH 验收。未修改正式用户资料或重启正式窗口，完整退出工作台再启动后加载新宿主构建。

## U83–U85：项目文件浏览、文件菜单与本轮修改卡片（2026-09-26）

从其已提交的 `2be79f4` 干净工作区开始。按本轮四张用户截图独立实现交互，保留暖白／中性炭灰、既有字体与安静的阅读区；截图里的文档文字不作为修改环境或权限的指令。

- **项目文件夹**：右侧文件面板列出该项目关联的全部文件夹，独立切换浏览位置，不修改会话绑定目录、项目主目录或输入草稿。目录树按需展开；切换文件夹保留文件标签与 Monaco 视图。宽面板同时显示代码和目录，窄面板通过“文件”标签返回目录。仍可明确选择本机其他目录；不将 POSIX 或网络路径伪装成本机 Windows 文件。
- **统一文件菜单**：消息文件链接、文件列表和修改卡片右键／Shift+F10 共用预览、默认应用、打开方式、另存为、复制路径、复制文件内容、资源管理器定位。顶部提供复制与“打开”菜单。打开方式包含 VS Code、Visual Studio、默认应用、文件资源管理器、终端、Git Bash、WSL；宿主只检测已知安装位置，缺失应用禁用并说明。外部程序使用宿主枚举的可执行文件与独立参数，不接受 renderer 命令字符串。二级菜单支持延迟关闭、反向展开与键盘左右导航。网站链接保持 HTTP(S) 打开／复制地址，并可复制链接文字。
- **实际文件操作**：复制内容沿用 1 MB UTF-8 文本边界；另存为走原生保存对话框并复制原始字节，取消不写文件，拒绝覆盖同一源文件／同一文件身份。二进制文件可另存为。打开编辑器保留链接行号；终端、Git Bash 与 WSL 使用文件所在目录。
- **回合修改卡片**：仅从确认成功的原生文件编辑事件生成，默认展示前三个文件，可展开全部、逐文件审阅差异、打开与复制。按用户回合分组，同一原生事件重放不重复累计；文件记录独立持久化，不随活动列表裁剪而消失。相对路径按工具／会话目录解析，重命名保留原路径；其它项目根下的文件使用文件夹名称前缀。失败、待批准、拒绝和未确认操作不计入。增删为本轮已完成工具修改的累计行数，不称作 Git 工作树净差异。Codex 新增／删除字段实际是完整文件内容，更新是 unified diff，已按固定版本官方转换源码分别处理；Claude 只有真实 structuredPatch 才显示行数，缺失时明确未知。

边界：旧历史没有保存的文件差异不从助手正文补造；普通 shell 命令改文件而未返回结构化文件事件时，不猜测其影响。单次最多保留 256 个文件条目与 64 KiB 差异，截断明确提示，统计使用完整原生内容。此卡片是工具修改记录，不自动扫描 Git 或提供可能覆盖后来编辑的整仓撤销。

验收与证据：TypeScript／Vite／host 构建通过；全仓单元与协议 **419/419**；隔离 Electron 共 **84 项**（新文件交互 6、Monaco 7、紧凑控件 11、项目 6、运行时间线 7、通用桌面 47）。日志见 `build/qa/file-workflow-*.log`。新交互报告与深浅主题、宽窄布局、二级菜单、逐文件审阅截图位于 `build/qa/file-workflow-20260926/`；已实际查看渲染截图。使用隔离资料、真实临时文件和持久化的合成原生事件；文件读写／剪贴板经过实际宿主，保存位置对话框与外部应用启动用可观测替身；不冒称真实编辑器／WSL 会话、模型或 SSH 验收。未改动 VPS、原生客户端或正式工作台资料，未强制重启现有正式窗口；完整退出并启动后载入新宿主构建。

## U82：Codex 单一原生账号入口与旧会话迁移（2026-09-26）

本节取代 U81 中“保留旧 token 执行路径”的决定。仓库内聊天、模型目录、额度查询、重置卡兑换以及配给原生读取均统一到 `native-owner`。旧 `remote.ts` 只保留同一实现的导出别名，不含第二套启动/认证逻辑。旧 token 获取、注入、刷新回调与临时带凭据 app-server 已删除；旧公开目录只支持明确的只读迁移核对，默认账号目录不再按 socket 是否存在自动回退。旧直接使用权保存入口退出生产 UI，授权由工作空间管理策略统一保存。

新增管理员迁移工具 `services/vps-account-broker/migrate_legacy.py`。桌面可复制只含公开绑定的单会话迁移资料；管理员明确核对原账号，保留原账号 ID/代次创建原生私有登录位置，由用户完成官方 CLI 登录。迁移仅暂存/复制原生 JSONL 历史，不碰认证文件、私有配置、SQLite 数据库或 SSH 密钥。原记录保留；复制与回执可重复恢复，符号链接、硬链接、写入竞态、外来线程、身份冲突和缺失前缀依赖均拒绝。原生 `parent_thread_id` 和旧 source 子线程关系均支持；原生分页/回退物理文件与逻辑线程分开处理，多个根版本必须明确原生活跃路径，不能按文件时间猜测。

账号登录由原生 `account/read` 核实；其固定版本 schema 不返回可与旧 fingerprint 直接比对的 ChatGPT 账号 ID，所以原账号映射需要管理员明确确认，并核对原生公开邮箱，**不把邮箱相同冒称为租户/账号 ID 的密码学证明**。成员只能读取自己 UID 的迁移回执；每次读取仍核对当前授权。桌面在接入时核对原账号、线程、回合、设备与目录，保留消息、草稿和未知提交状态；正常发送仍需独立 `native-owner` H。旧会话不再锁住新入口的默认账号选择。

配给账本沿用原账号 ID/代次，迁移会话沿用原数值去重 scope，既有借还账不清零。原重置卡未知请求只有在新所有者确认旧/新账号映射后，才能通过同一原生幂等键主动核对，不自动消费或另建请求。已确认子线程归属写入回执，可在重连后延续，不添加工作台子 Agent 数量上限。

验证：全仓单元/协议/主进程 **411/411**，TypeScript 检查通过，证据为 `build/qa/native-unification-full-tests.log`、`native-unification-typecheck.log`；本地真实 Linux UID/socket **20/20**，见 `native-unification-socket-20260926.json`；配给 socket **5/5**，见 `native-unification-quota-socket-20260926.json`。固定官方 Codex 0.155.1 在隔离 HOME/CODEX_HOME、无登录账号、仅闭环地址的合成 provider 下，使用合成历史确认 `thread/resume(path)` 保留原线程和双向消息，**3/3** 检查通过，未调用 `turn/start`，见 `native-unification-offline-history.json`。隔离 Electron 原生账号/迁移 **7/7**、工作空间/配给 **16/16**，已实际查看迁移提示的深浅色窄窗口截图。生产配置 renderer/main/preload 构建通过，未覆盖共享 dist 或重启正式窗口。

**部署边界：没有修改真实 VPS，没有迁移真实账号/用户历史，没有登录、模型请求或真实重置卡操作。正在运行的旧桌面/远端进程不会被仓库修改自动替换；实际消除线上旧路径还需要受控部署、原账号迁移、停用工作台旧通路及新的原生 H/出网验收。** 已安装、供其他客户端使用的外部 broker 不在本轮自动停用范围。Claude Windows H/额度/重置卡和配给 sidecar 生命周期仍保持 U81 的未完成状态，不混报成此次完成。管理员操作顺序与回退边界见账号服务 README。

## U81：原生账号所有者入口、旧会话与可用性（2026-09-26）

本节覆盖下方早期“仅有账号目录、尚无执行入口”的实现描述。已在本地接通 `native-owner` Codex 网关及桌面主进程：共享受保护的官方 CLI，账号登录由专用非 root 身份下的官方 app-server 管理；工作空间只传输会话协议和绑定本机执行器的隧道，不接收登录 token。账号代次、真实 UID、空间、设备、目录、root thread 固定；原生子 Agent 继承可验证父线程关系，包括 spawn 完成前的 thread/started，不额外设置数量、层级或模型上限。

Claude 账号管理支持私有登录配置、幂等创建、官方原生登录命令及公开状态读取，两家默认账号/CAS版本分别保存。丢失响应或目录刷新不会造成重复创建；状态结果重新核对连接、厂商、账号代次和授权。界面中的“Claude 写作账号”是测试数据，已改为“Claude 测试账号”并标注“合成数据，未连接 VPS”，没有创建真实账号。

旧受管会话保留原线程、账号、历史、目录和回合；服务端回执可恢复丢失的本地启动回执。真正结果未知的模型提交不重发，不能用更早完成回合核销；仅空线程创建回执丢失不永久锁定。入口明确答复尚未交给模型的拒绝，返回单独回执，桌面显示原因、撤回虚假的已发送消息并允许后续主动操作；普通原生错误/断线不冒充此回执。新默认账号可在健康受管会话运行时修改，不影响其固定账号。

限制状态按账号/代次持久化，仅明确原生 usageLimitExceeded/unauthorized 可建立共享限制。普通网络故障、临时速率错误、原生 willRetry、工具和模型文本不会建立持久锁；正常状态查询不串行锁死全账号。成员主动核实原生状态确认恢复即可解除对应额度/认证限制；不自动消费卡、不自动换账号、不另加模拟人工延迟或外层续跑。会话许可和这些保护不构成风控豁免。

**旧入口没有静默迁移。** 缺省 `accountRuntime` 保持 `existing-codex`，历史验收可与新来源验收共存，新路径不能借用旧 H 回执。旧路径仍有 VPS 内部 token 获取/注入，仍依赖旧服务当前选中账号；切换冲突现在明确提示恢复原账号，不能说旧路径风险已全部消除。额度查询显式绑定旧/新来源，新服务失败不降级到旧 token 路径。

验证：全仓 **401/401** 单元/协议/主进程测试；真实本地 Linux socket **13/13**（内核 UID 隔离、原线程恢复、服务重启后的不确定状态、明确拒绝与成员恢复、进程死亡唤醒、后代清理、原生额度公开投影、成员兑换拒绝、无 token 请求及 systemd unit 语法检查）；隔离 Electron 原生账号 **5/5**、既有工作空间与配给管理 **16/16**。TypeScript 与隔离生产配置构建通过，已查看深色与浅色窄窗口截图。所有原生上游和账号数据都是合成夹具；没有真实模型、登录、重置卡兑换或 VPS 写入。

证据：`build/qa/account-runtime-full-tests.log`、`account-runtime-typecheck.log`、`account-runtime-socket-20260926.json`、`native-account-ui-build.log`、`native-account-ui-20260926/report.json`、`account-runtime-administration-20260926/report.json`。隔离应用位于 `build/qa/native-account-ui-20260926/application`，未覆盖共享 `dist` 或重启用户正式窗口。

附带原生账号服务 systemd unit（专用非 root 用户、控制组清理、崩溃监督），但未安装/启动，实际开机和 cgroup 行为尚待部署验收。**仍未完成：新入口真实 Codex H/模型/出网验收；Claude Windows 本机原生工具链 H、Claude 额度与重置卡接口；配给 sidecar 的热升级与开机托管；旧 token 会话的显式迁移方案和实机验证。** 未以登录管理或本地测试替代这些能力。详细边界见 `account-runtime-boundaries.md` 与 `services/vps-account-broker/README.md`。本轮没有再次联系并行会话、启动开发子 Agent、提交/推送 Git 或改动真实凭据。

## U73 修订：逐账号周/5小时配给、借还与共享账本（2026-09-26）

本节取代下方早期月度 USD 预算方案。每个账号旁填写周额度百分比，有原生 5 小时窗口才显示该项；三个空间各 33% 为 99% 配给、1% 剩余，第二账号独立计算。留空与零区分，合计不超过 100%，暂停保留预留、删除释放；旧预算只留兼容元数据。配置保留 CAS 预览确认。

每账号「允许超限使用」默认开启。自己用尽后优先借余额最多的其他活跃空间，保留原出借方；对应窗口下一次已确认刷新，从借方新份额归还，不足结转。账号/代次/周和5小时窗口不混算。已开始窗口比例修改下次刷新生效，超限开关立即生效。关闭后不产生获准借款，下一回合检查余额；单个进行中请求仍可能超出。

VPS 本机 Unix socket 共享账本以真实 peer UID 绑定成员，无新网络监听端口，成员无需管理员密钥。可信 helper 读取原生额度并替换成员提交的百分比/刷新时间，凭据不回传。首次确认应用配给才按需安装组件，管理员刷新可在 VPS 重启后拉起；代码、注释、固定提示与日志全英文/ASCII。**此轮未部署到真实 VPS，未重启用户正式工作台。** 已运行 sidecar 的自动代码升级与 systemd 开机托管未实现；正式管理服务已有时保留其权威，不旁建第二账本。

原生回合前检查、数值 token 通知和结束/停止/断线记账已接通。累计游标去重，首条只计本次 last，多通知累加；恢复原 scope 数值记录，不重放陈旧额度。补查修复配给检查期间停止后仍可能发送的竞态、重复 finish 和计数回退重计。有效样本至少 2pp 后经验标定；已知并发生产者结束后按观测 token 比例分摊。覆盖缺口保留未归属；不是固定官方换算、全客户端硬配额或独立子 Agent 完整计量。

验证：生产构建通过；全仓 **365/365** 单元/协议测试；隔离 Electron 管理 **16/16**；实际本地 Linux socket **5/5**，用两个内核 UID 与合成 reader 验证身份隔离、拒绝伪造、共享去重及原出借方偿还。无真实 VPS 写入、模型请求或卡片消费。证据：`build/qa/quota-build.log`、`quota-full-tests.log`、`quota-allocation-20260926/report.json`、`quota-socket-report.json`。已检查深浅色/窄窗口配给截图，借还账截图单独归档。当前管理 UI 回归为 `scripts/test-administration-ui.mjs`；旧 `test-studio-ui.mjs`、`test-studio-management-ui.mjs` 是退休布局历史脚本，不计本轮通过结果。

用户追问的运行时勾选仍只是策略配置，不能推断已安装 CLI、已接通账号或拥有执行资格：不复制 root CLI/私有登录，不自动将新成员加入旧 broker；Claude 共享认证未实现。账本不替代账号执行服务。参考方法/许可核查见研究来源 CodexQuotaGuard 条目。未再次联系并行会话，未启动开发子 Agent。

## U70–U73：工作空间、账号授权、额度与重置卡（早期记录，预算部分已由上节取代）

- **工作空间管理**：新增按需 SSH 管理通路，复用现有控制 socket；没有常驻服务时仍能管理。首次读取严格只读，确认预览时才创建本项目日志；创建/纳入/编辑/暂停/移除保留版本绑定与一次执行回执。刷新列表整合已有空间，不重复建立成员。空间可导出 SSH 邀请、连接本机；已有可用本机连接先复用。
- **使用权与 Claude**：授权改成空间逐行、小型多选和行内保存，移除巨型原生 checkbox/select 表单。Codex 与 Claude 独立页签；Claude 未登录状态、原生状态刷新和登录说明已就绪，未实现复制登录令牌或跨 UID 共用 Claude 凭据。
- **原生额度/重置卡**：依据固定 0.155.1 生成 schema 和官方文档接入 `account/rateLimits/read`、`rateLimitResetCredits` 和 `account/rateLimitResetCredit/consume`。未知与零分开；显示真实窗口、重置时间、卡片明细和到期。兑换明确确认，持久化绑定账号/SSH身份的 UUID 与 creditId，失联后只恢复同一幂等请求，四种原生结果分别展示。没有消费真实卡片进行测试。
- **预算与环境**：空间额度分配表显示月度预算明细、合计与具体变更预览。预算是配置管理，可信费用计量、厂商额度转移及全客户端硬限额仍未实现，不以模拟消费数据替代。移除 host/probe IPC、读取环境及连接详情重复发现按钮；空间选择改为成员身份验证，原生上下文不再注入远端 profile。

验证：全量 TypeScript、生产构建、331 项单元/协议测试、12 项隔离 Electron 管理交互通过。已实际查看深浅色、窄窗口和 Claude 页面截图。真实只读 Electron 使用独立测试资料，经原 SSH 登录返回管理 ready，发现 3 个既有空间、1 个 Codex 账号，并显示真实额度和 2 张 Full reset 卡。实际远端写入、模型回合、卡片兑换均为 0。新建/移除/暂停/兑换的副作用测试使用临时目录和合成服务，不能替代真实远端破坏性验收。

证据：`build/qa/administration-build.log`、`administration-unit.log`、`administration-ui.log`、`administration-20260926/report.json` 及截图；真实只读证据 `build/qa/administration-live/report.json`、`real-workspaces-readonly.png`、`real-quota-cards-readonly.png`。源码路径：`packages/account-usage`、`packages/workspace-control/ssh-control.ts`、`services/vps-workspace-control/ssh_entry.py` 和 renderer 的 ProviderAccounts/AccountUsage/WorkspaceBudgets。只在开始时与并行会话协调一次，没有开发子 Agent。没有强制重启正在使用的正式窗口；新主进程随完整启动载入。

仍保留的边界：新建系统成员不会自动改旧 broker 的 allowed-users 或安装 CLI；原 SSH 邀请设备未并入 HTTPS 服务设备撤销列表；原生执行资格继续按连接独立验收。这些不是新增空间已能共享所有原生账号、自动强制扣费或已撤销所有旧 SSH 权限的保证。

## 右键菜单灰阶反馈修订（2026-09-26）

按用户最终提供的Codex菜单参考，保持既有文学排版和高级灰：侧栏会话、项目、左下角菜单及复制子菜单统一使用平整的纯灰整行高亮。浅色命中 #eaeae8／按下 #d8d8d5，深色命中 #4b4b4b／按下 #5b5b5b；文字与图标同步提高对比。撤掉中途方案的棕色背景、强调色竖条和悬停描边；删除仅图标保留提示色，整行背景仍为灰阶。键盘焦点使用细灰线，显式区分鼠标与键盘输入，防止鼠标移到下一项后旧焦点仍高亮；展开的父项保留选中路径，禁用项保持低调且不产生命中效果。菜单位置、字体、尺寸与具体操作保持原有设计。

验证：renderer构建、TypeScript检查和侧栏31项交互回归通过；隔离Electron实际检查两种皮肤的悬停、按下、子菜单、禁用项、删除图标与键盘反馈，已查看两张菜单局部截图。证据：`build/qa/menu-feedback-20260926/report.json`、`renderer-build.log`、`typecheck.log`、`sidebar-regression.log`、`dark-menu-detail.png`、`light-menu-detail.png`。只使用合成会话，没有实际执行置顶／删除／复制或调用模型、SSH；未强制刷新正在使用的正式窗口。

## U63–U65、U69：设置与顶部菜单、最近会话侧栏和运行时记忆（2026-09-26）

同日最新外观修订：按用户补充，深色顶部栏由原 #271b29 改为与侧栏一致的 #1e1e1e（renderer直接使用 `--side`），原生窗口按钮区域同步；移除菜单右侧的“Agent Workbench”文字。亮色和46px高度不变。构建及导航12项回归通过，已查看真实隔离Electron深色截图。证据：`build/qa/navigation-20260926/titlebar-build.log`、`titlebar-navigation.log`、`workspace-dark.png`；正式窗口下次完整启动载入。

左上角 Workbench 保留为静态品牌，连接与环境、能力验收、归档会话统一进入可搜索、分组导航的设置。左下角展开仅保留设置与浅深皮肤切换。归档页支持搜索、打开、恢复、永久删除确认；设置切页保留工作台草稿。顶部实际读取了本机 Codex 的四个菜单内容后，为本应用实现文件／编辑／视图／帮助原生菜单及快捷键，连接新建项目／会话、搜索、前进后退、设置、侧栏显示、原生编辑、缩放和全屏。拖动栏增至46px，浅色为暖灰 #efede8，深色保留用户参考图的 #271b29；原生窗口按钮随缩放协调。

最近会话在侧栏拥有项目头、折叠、五条分页、新建小图标、置顶、名称和主目录编辑、打开目录、批量归档、移除和设置恢复；会话快捷置顶／归档保持可用。批量归档原子拒绝在途任务，不迁移历史 projectId、消息和固定工作目录。用户随后明确此项目行为仅限侧栏：项目选择器已恢复“选择项目／不关联项目”，不出现最近会话条目；普通无项目草稿不会继承最近目录，只有从最近会话侧栏直接新建时使用其设置的主目录。

运行时最后一次主动选择保存到可信宿主状态。全局、普通项目、最近会话、文件菜单、Ctrl+N 的新会话统一沿用；首次空白界面从保存值初始化。打开历史会话和账号切换不改偏好，旧会话身份不变；快速切换采用串行保存，延迟状态通知不会覆盖当前选择。旧版缺省／非法值沿用原离线默认，偏好选择不会触发模型、SSH或空会话创建。

验收：TypeScript/Vite/host构建通过，完整代码测试322项；本轮实际隔离Electron验证导航12、运行时6、项目6、侧栏31、紧凑控件11、桌面47项，共113项。运行时验证包含两次完整进程退出／启动、各新建入口、打开旧历史、快速切换、显式返回离线，以及草稿／既有身份保留；无renderer异常。已实际查看恢复后的无项目选择器、浅色设置与深色860px布局。证据集中于 `build/qa/navigation-20260926/` 的 `report.json`、`runtime-report.json`、各测试日志和PNG；完整桌面报告另见 `build/qa/desktop-report.json`。全部使用隔离资料、合成会话及离线样例，没有调用真实模型、翻译服务或SSH。

正式窗口的第一轮菜单／设置改动此前已加载并截图；本次两项纠正完成后，检测到现有正式窗口正在连接设置中，保留其现场而未强制退出。最终构建需下次完整退出并启动后载入；隔离进程重启验证不冒充该用户窗口已刷新。

## U66–U68：Agent 协作工具化与运行过程、输入控件修订（2026-09-26）

本节覆盖之前“协作弹窗／子 Agent 设置页／默认 1 个子 Agent、1 层／工具仅显示汇总／上下文点击弹窗／粗胶囊滑块”的决定。用户要求协作提供给 Agent 使用。会话顶部和设置页已移除协作入口、人工消息表单和容量设置，renderer 的 collaboration/send、overview、settings 路由也已移除；原生注册的 list/send/read/wait 工具和持久收件箱保留。子 Agent 继续使用厂商原生机制；Codex、Claude 两条启动路径和真实 Codex SSH bridge 均不注入工作台并发、深度或子模型覆盖，旧保存值加载后迁移为 native。由原生事件确认的 Codex 子线程可使用绑定父工作台身份的协作工具，外来线程仍拒绝。

工具活动按首次出现时间和同一时间内的原生事件次序与正文交错显示，完成和输出更新不会改变位置。记录公开命令、目录、退出码、文件 diff、MCP/dynamic tool 输入与文本输出；command/file outputDelta 在回合结束前更新展开的行。每项输入和输出各保留至64 KiB，并明确标识截断；不复制原生 thinking、签名或图片二进制。旧版只存状态的历史记录无法凭空恢复内容，展开显示未提供。原文列的工具与段落左沿对齐，并去除每段重复的原文标签，保留原文复制。用户查看较早内容时不强制跟随滚动。

模型控件在激活绑定工作空间时自动读取目录，不调用模型。model/list 的目录默认值结合远端当前受管运行时 config/read 的 model、model_reasoning_effort、service_tier 三项；thread/start/resume 的实际模型设置单独保存并优先显示。bridge 只返回这三项，不返回配置层、提示词或凭据。未就绪明确显示状态，不再统一写“原生默认”。保留下一回合生效，滑块改为细轨、离散刻度、小圆点；拖动松开才提交。Fast 状态直接显示在控件旁，可明确关闭。上下文圆环改为鼠标悬停或键盘焦点显示224px小卡，不抢文本框焦点；移入卡片保持可见，Escape关闭。二级复制菜单添加延迟关闭与子菜单进入取消关闭，保留原键盘导航及边缘翻转布局。

验收：TypeScript/Vite/host 构建通过；完整代码回归320项；真实隔离 Electron 交互49项（协作与时间流7、紧凑控件11、侧栏31），均无renderer异常。已实际查看浅色时间流、模型菜单、context hover和深色860px菜单截图。证据：`build/qa/assistance-build.log`、`assistance-unit.log`、`assistance-ui.log`、`assistance-compact.log`、`assistance-sidebar.log`、`assistance-20260926/report.json`及该目录PNG。本轮UI输入来自合成原生事件与模型目录，协议测试另覆盖真实宿主路由和远端Python配置投影；不将其当成真实模型／SSH验收。未调用模型、翻译服务或SSH，未修改VPS或现有原生客户端；未重启另一会话操作中的正式工作台窗口。

## U61–U62：项目与主文件夹分离、真实参考细化（2026-09-26）

本节覆盖早期将项目与目录选择混在同一弹层的决定。项目条保留在新会话输入框上沿，弹层只显示/搜索项目名称，移除子文件夹选择、路径提示和“打开文件夹”；创建项目直接选中且不丢草稿。新对话使用项目主文件夹。

创建/编辑项目改为名称、源文件夹列表与底部操作，按用户提供的 Codex 截图实现：单行文件夹名称，悬停显示完整路径；主要标记固定紧凑比例（约46×27px）。非主文件夹“设为主要”仅在对应行悬停或按钮键盘聚焦时显示，移开隐藏并禁止不可见区域点击。更换主文件夹会更新对应待发送新草稿，已有会话的固定工作目录不变。原有分组保存不丢失，移除项目仍沿用确认流程。

模型菜单收至252px：当前思考档位、模型、胶囊滑块、独立 Fast，保留原生能力目录及运行中下一回合生效提示。文件面板改为占满工作区高度，顶部与工作区平齐；Monaco 自动换行默认开启。可见“翻译后直接发送”开关保留，深浅主题继续使用同一组字体、边框和圆角。

验证：TypeScript/Vite/host 构建通过；隔离 Electron 共 **90 项**（项目6、布局6、编辑器7、紧凑控件11、桌面47、翻译13），项目测试在最终悬停样式修改后重跑。项目测试覆盖鼠标移入/移出/另一行、键盘 Tab、紧凑标记几何、草稿保留、主目录切换与旧会话绑定，以及面板顶部/底部对齐。已实际查看深浅主题悬停截图。完整代码测试 **312/312**，见 `build/qa/ui-polish-unit-tests.txt`。

证据：`build/qa/ui-polish-build.txt`、`build/qa/ui-polish/test-*.log`、`project-report.json`、`project-edit-hover-light.png`、`project-edit-hover-dark.png`、`project-picker-light.png`、`model-light.png`、`model-dark.png`、`file-panel-dark.png`。均为隔离 Electron/本地临时目录/合成账号能力/离线演示；未调用真实模型、翻译服务或 SSH。实际用户窗口更新单独记录，不将隔离测试当成真实窗口已更新。

实际窗口：2026-09-26 05:12 JST，在确认本机工作台进程已不存在后启动新构建，使用原用户资料。实际查看项目菜单仅列 MOD 项目及创建入口，项目条位于输入框上沿，可见翻译直发开关；打开 MOD 编辑项目核实三个源文件夹及紧凑主要标记后取消，未保存项目更改、未发送任务。新构建窗口保持打开。

Git：本轮相对 `ui/redo-20260926` 的细化保存为独立快照 `ui/project-polish-20260926`，仅纳入本轮19个界面、测试和文档文件；使用独立 index，当前分支、HEAD 和原暂存区不变。

## U58–U60：项目条、原翻译开关与右侧代码浏览器重做（2026-09-26）

本节覆盖下文 U54–U57 中误把新会话选择器一并移到顶部、把原翻译开关改成按钮的界面决定。以用户给出的 Codex 项目条、Claude 紧凑输入区/滑块截图，以及 Claude 官方桌面代码视图作为布局参考，保留已确认的暖白和中性炭灰主题。

- 当时新会话项目选择器回到输入框正上方，支持原有搜索、多目录、临时目录和新建即选；其中多目录/临时目录已被上方 U61–U62 的项目名称选择取代。运行时/账号同处项目条。发送创建会话后，项目入口消失，身份控件进入会话顶部。切换身份保持草稿和旧会话 binding。
- 输入框下恢复可见的“翻译后直接发送”开关：关闭时先预览确认，开启后翻译直发。关闭整个翻译模块时显示“开启翻译”。权限、上下文、模型/离散胶囊滑块和独立 Fast 保留；会话选择菜单随主题渲染，不再使用 OS select；输入区没有 hover 提示。
- 文件浏览改为可拖动/键盘调整的右侧面板，保持对话输入可用，关闭恢复此前双语布局。支持目录筛选、文件标签页、复制路径和资源管理器操作。
- 代码使用本地打包的 Monaco 0.57.0：语法高亮、行号、折叠、搜索、括号匹配、自动换行、行定位和光标状态；切换文件/目录保留视图。只读，UTF-8/1 MB 上限仍沿用宿主文件服务。编辑器/JSON worker 和图标字体均随构建分发，禁用 JSON schema 网络请求；MIT 许可随 dist 分发。

验证：TypeScript/Vite/host 构建通过；代码测试 **312/312**。隔离 Electron 回归共 **84 项**：桌面 47、翻译 13、紧凑控件 11、布局重做 6、Monaco 7；无 renderer exceptions。检查包括深浅主题、860px 窗口、菜单键盘导航、项目/运行时切换草稿保留、翻译预览/直发与失败后的原文预览、真实 TS/JSON 高亮、图标字体、搜索/Escape、折叠、标签/目录切换、文件只读和面板恢复。截图已实际查看，不用单纯 DOM 通过代替视觉检查。

证据：`build/qa/ui-redo/report.json`、`code-report.json`、各脚本日志、`new-dark.png`、`new-light.png`、`conversation-dark.png`、`file-dock-dark.png`、`file-dock-narrow.png`、`code-search-dark.png`、`code-light.png`，以及 `build/qa/ui-redo-unit-tests.txt`。测试仅使用隔离资料、合成目录/账号事件和离线演示；本轮没有真实模型、翻译上游或 SSH 请求。

Git：接手时被拒绝的界面与其它已完成功能混在未提交工作区，HEAD `00d34c8` 不是用户所说的上一版界面。已完整保存在 `checkpoint/ui-before-redo-20260926`（`a9321b1`），随后按参考恢复交互并重做；没有执行会删除其它功能的整仓 reset，也不把本次修改称作已完成精确历史版本回退。重做版单独保存在 `ui/redo-20260926`，以该检查点为父提交，差异只包含本轮 UI、构建依赖、测试与文档；使用独立 index，不改用户当前分支或暂存区。

2026-09-26 04:30–04:35 JST：通过实际运行的 Agent Workbench 窗口确认当前输入为空后刷新 renderer；未结束宿主进程。实际窗口已显示新项目条、可见翻译开关和右侧 Monaco，打开本仓库 `CodePreview.tsx` 实见高亮/行号/标签/只读状态。恢复刷新前 Codex 运行时选择，未点击模型目录或发送按钮。原项目和会话列表保留；不是重新启动真实模型任务。

## U54–U57：会话导航、紧凑原生控件与文件链接（2026-09-26）

已实现会话顶部运行时/账号切换，新身份进入新的懒创建任务并保留输入草稿；切换不会修改旧会话 binding 和在途回合；权限可随时保存，只有下一回合使用新值。消息文本识别安全的本机路径与 HTTP(S) 地址，提供文件目录/UTF-8 文本预览、复制、资源管理器定位、网站外部打开和键盘/右键菜单。Codex 原生 adapter 按固定版本的 `model/list` 动态读取模型、思考档位和服务档位；`thread/tokenUsage/updated` 驱动上下文用量圆环，容量未知时只显示未知。模型、effort 与 Fast 选择按下一回合生效。

输入区收敛为权限、模型/上下文控件和发送；运行时、工作空间、账号放在会话顶部，输入区下只保留翻译入口。编辑历史输入可用“取消编辑”或 Escape 恢复编辑前草稿，旧消息不删除。未启动真实模型回合或读取用户凭据；模型目录/上下文显示依赖已验收的原生连接。

验证：全仓 **312/312**（`build/qa/compact-full-tests.txt`）；Electron 桌面回归 **47/47**（`desktop-report.json`）、新增交互 **11/11**（`compact-ui-report.json`）、翻译 **13/13**（`translation-module-ui-report.json`），TypeScript／构建通过。新增桌面检查包括文件行定位、两侧链接、键盘右键、外部网站宿主转交、下一回合模型/权限、账号切换草稿保留和 860px 布局；无 renderer exceptions、无截图。原生目录／用量协议使用合成数据验证，本轮没有真实模型或 SSH 请求。

边界：Claude 原生执行与模型目录尚未接通，切换入口不代表 Claude 已能运行；上下文容量缺失时显示未知，窗口与压缩阈值由原生管理。文件预览是本机 UTF-8 文本／目录浏览，不执行 HTML 或二进制。用户现有窗口未重启，构建结果与运行中旧窗口分开记录。


## 2026-09-26 翻译设置精简与首次读取模型修复

修复首次配置被页面底部外发确认挡住的问题：用户点击“保存并读取模型”后，先加密保存独立 key，再执行仅携带认证的 GET 模型目录请求；无需先授权发送翻译正文，也不自动勾选授权。前端与两层目录服务门禁一致调整，实际翻译仍要求明确确认外发范围，关闭模块仍禁止目录与翻译请求。

移除独立模块大卡片，开关并入 32px 标题行；设置页移除宣传标题，表单缩减重复说明与间距，外发确认紧跟模型选择。思考参数及调用预算默认折叠到“高级设置”，翻译行为保持三个紧凑开关；修改确认不再清空已经读取的模型目录。

验证：翻译相关 **58/58**、隔离 Electron 翻译界面 **13/13**、通用桌面 **52/52**，typecheck／构建通过。新增回归覆盖无正文授权时读取目录、目录不携带正文、目录读取不隐式授权翻译，以及折叠高级设置后的原有三协议配置。全部服务请求为本机合成数据，本轮真实 Codex 与翻译服务请求均为 **0**。

2026-09-25T17:41:06Z 确认实际窗口无未保存表单／草稿且全部会话空闲后，正常退出并启动新构建，原会话身份与消息数量保持一致。实际窗口已打开精简设置页，读取目录按钮可用。报告：`build/qa/translation-compact-live-report.json`。

## 2026-09-26 Codex 真实桌面发送已接通

当前 pc1 已分配账号的 Codex 0.155.1 已完成独立桌面发送、流式原文、原生命令／补丁审批、本机文件读写与 PowerShell、运行动态，以及停止清理的真实验证。凭据仍只在 VPS，旧客户端／SSH 配置未修改。首次发现原生 interrupt 回执后本机命令仍继续的问题，现通过清理本会话执行器进程树解决。冷恢复按固定版本行为使用持久绑定回执，并在每次 turn/start 强制本机环境；断线结果不确定时不自动重发。

入口按主机、空间代际、账号及官方执行器哈希启用；其它未验收连接和 Claude 继续阻断。远端 profile 自动注入但本机工具结果真实。详细实现、失败记录、累计 **6 个真实模型回合**及报告见 [24 · Codex 原生执行接入与验收](24-codex-live-runtime.md)。全仓 **304/304**、既有桌面 **52/52**、真实桌面 Codex **7 项**通过，typecheck／构建通过。此前下文“所有真实模型提交均阻断”是历史状态，现由本节对已验收的 Codex 绑定覆盖。

2026-09-25T17:09:53Z 已正常退出空闲旧窗口并切换到新构建，恢复用户原先的 Codex 会话和未发送草稿。实际窗口显示该绑定 `nativeReady=true`、状态 idle、消息数仍为 0；没有替用户发送草稿。报告 `build/qa/native-live-update-report.json`。其它未通过验收的会话不解锁。

## 2026-09-26 接手：已有账号、SSH 选择与直接导出

本节为最新状态，覆盖下文历史阶段的“旧 Broker 不可用”和“仅有 HTTPS 邀请”说明。保留既有改动，由主会话独立收尾。

- **现有账号**：复用已运行的 `/run/codex-device-auth/broker.sock` 的公开 list/select。root 能显示 `<shared-account-id>` 及 member-a/member-b/member-c 分配控件；成员仅显示本工作台获分配账号。分配使用 root 管理的版本化策略，既有选中账号可在无新策略时继续显示。没有重新登录、token 读取或额度请求。修复“已登记账号”按钮可用而保存处理器拒绝的 UI 错误，并自动显示选空间时读取的目录。
- **SSH 选择**：成员的“设为本机工作空间”保存为本机默认，自动读取允许的 VPS 环境字段与公开账号目录；对话移除空间下拉框，仅显示绑定名称，保留账号选择。新任务使用当前空间，旧会话固定身份，管理员不可作为工作身份。迟到采集不能覆盖后来选择。
- **直接导出**：导出与导入并列，管理员选择已有成员后直接保存 SSH 型 `.awworkspace`，无需先部署新 HTTPS 控制服务。邀请包含新生成、1 小时有效、仅可执行固定设备登记命令的 bootstrap 密钥；没有管理员／既有设备私钥或原生账号 token。接收端生成独立密钥、固定主机公钥并核实非 root 身份。同设备可恢复，其它设备不能重放。SSH 型设备暂未并入新控制服务的撤销清单，详见 [21](21-workspace-administration.md)。
- **环境决定**：用户要求核查 Claude 的 VPS/SSH 用法后选择保留本机工具的方案 2。自动远端采集、纯投影和 SSH UI 已接通；本机原生结果保持真实，不承诺任意 PowerShell/Python/Blender 只能看见 VPS 硬件。此处没有部署 VM，也没有完成真实模型的环境注入与全部工具隔离。H bootstrap 仍是独立未完成项。
- **Paseo 对照**：固定提交核对表明它主要是客户端远程连接 daemon，CLI 与工作目录通常在 daemon 所在设备；不是本项目的 VPS CLI → Windows 工具链。Claude 走 Agent SDK + 已安装 CLI，Codex 走 app-server。官方资料支持原版 CLI 托管及原生认证方向，没有“该项目从未触发风控”的可验证证明。来源与结论见 [23](23-paseo-remote-comparison.md)。

验证：`takeover-final-tests.txt` **298/298**；TypeScript、Vite、host 构建通过；真实隔离 Electron 回归：桌面 **52/52**、账号 **26/26**、管理员 **11/11**、完整工作室 **42/42**、SSH 发现 **18/18**，无 renderer exceptions，无截图。新增检查覆盖旧账号分配、configured 账号保存、SSH 选空间、导出绑定和无需模型调用。

真实 VPS 的 SSH 型邀请验证报告 `build/qa/portable-live-report.json`：导出、新设备密钥登录、同设备恢复、其它设备重放拒绝均通过；原 `authorized_keys` 哈希恢复一致。该验证使用同一物理 Windows 设备上的独立接收端数据目录，证明密钥分离与协议，不冒充在第二台实体设备操作。

2026-09-25T16:04:34Z 正常关闭空闲旧窗口并启动新构建，保留实际用户数据目录和深色主题。在实际 Electron 页面核实 root 可见 `<shared-account-id>`、账号分配控件存在；选择 member-a 后自动读取 9 项远端字段、显示 Linux 及已有默认账号；新建空草稿显示该空间和 `<shared-account-id>`，没有创建或发送模型任务。窗口留在 pc1 的 SSH 页面。报告 `build/qa/takeover-live-ui-report.json`。此次 UI 实连只读，无远端修改，累计本轮模型请求为 **0**。

**保留的未完成项**：两家完整 H 原生执行链、Claude 跨 OS 文件／shell 视图、可信计量、强隔离／环境物化仍未验收。应用真实模型提交入口继续阻断，账号可见和 SSH 登录不能替代真实模型调用。没有新部署常驻控制服务、安装 Paseo、改写 CLI 二进制或推送仓库。

## 子 Agent 基座、任务收件箱与轻量运行动态

本轮 U44、U47 已完成本地基座与适配器接入。设置新增「Agent 协作」，默认每主任务 1 个子 Agent、深度 1、保留原生模型选择；保存仅影响新任务，旧任务持有独立快照。两家原生 CLI 参数构造默认带限额，仍保留 Claude 原生启动例外与 Codex V2 覆盖项的有效配置限制，不标成可信全局硬限额。

任务标题栏新增「协作」：可选择同 owner 的已有任务、发送精确保留的消息、查看收发记录和原生接收状态。持久消息按 operationId 幂等，投递时重验原生身份、账号及工作空间代际；发送本身不启动模型回合。Codex 以 turn/start 回执、Claude 以对应 user UUID 的原生回放确认接收；未知写入、断线、重启中断和身份漂移都保留待确认，不自动重投。模型工具的 source identity 由宿主绑定，不能通过参数冒充别人或伪造 ACK。Codex 固定版本 dynamicTools 注册和 item/tool/call 回传已接进适配器，校验当前 thread/turn、namespace、callId 并防重复。Claude 侧提供标准 MCP initialize/list/call/cancel 的绑定会话处理器，取消等待不伪造回复。协作 schema、错误、包络使用英文，原始用户/peer 正文保留。

运行动态在对话下方显示简洁摘要，可展开工具状态，并单独列出子 Agent 完成记录。命令、文件修改与消息均来自结构化生命周期，不从助手文字猜操作；后台 Bash 的启动回执不等于完成。只有明确的子任务完成事件才显示完成，父任务不会因子结果或同 UUID 的子消息提前结束。修复 Codex 子线程向父线程发信会把父线程误归为 child 的边界；隐藏推理、签名、命令参数与工具输出不复制到动态。重启/断线未完成项变为待确认；减少动画偏好生效。

验证：**全仓 292/292**（`build/qa/collaboration-full-tests.txt`），构建/typecheck 通过；隔离 Electron 协作 **6/6**（`collaboration-ui-report.json`），现有桌面回归 **52/52**（`desktop-report.json`），翻译模块桌面回归 **13/13**（`translation-module-ui-report.json`）；无 renderer exceptions、无截图。桌面事件由明确标记的合成 host 事件注入验证，协议回归使用合成子进程/transport；均不消费真实模型额度。此前 288 项中旧 Claude 参数位置断言的失败已通过保持原权限参数位置修复。

**尚未实连的边界**：两家真实 H 链仍未验收，主应用不启动远端原生回合。`nativePeerContext`、`nativePeerTools`、`nativePeerMcpSession`、`observeNativeSession` 是可信 bootstrap 接口。Codex 动态工具已在适配器注册；Claude MCP 处理器已有协议接入，但从 VPS 原生 CLI 到本机该处理器的受认证传输/配置仍须随 H bootstrap 建立并核验，不能直接开放无鉴权监听端口。目前可在 UI 入箱、可由适配器在下一次获准回合投递，但不能声称正在运行的两家模型已经能够自主互聊。Claude 原生同用户 ListAgents/SendMessage、交互式 Teams 和跨厂商工作台收件箱严格分开，详见 `docs/22-native-collaboration-research.md`。本轮未部署 VPS、重启用户运行窗口或读取旧客户端会话/凭据。

## 管理层级、邀请分发、托盘与简化连接页

本轮 U33–U40、U45–U46 的本地实现已组装。管理员入口只用于管理，输入区和可信主进程均拒绝将管理员／root 作为工作身份。本机仍须选择成员空间。连接页收敛为紧凑 VPS／成员列表和“工作空间、共享账号、连接详情”页签；成员不显示管理员页签。默认收起环境、账号认证字段、设备邀请和暂停／移除操作，只保留空间配置与邀请设备等常用入口。切页签不发起远端操作，组件保持在途状态；切连接则丢弃旧结果。修复重复 React key 导致旧管理面板残留、导入后迟到刷新抢选连接、重新选择邀请后键盘焦点丢失的问题。

管理员控制面包含 root peer UID 核实、版本／摘要／过期／单次计划确认、接管／创建／策略更新／停用／恢复／移除管理、设备和邀请撤销、不确定回执查询与持久恢复锁。移除保留系统用户和文件，只操作本服务登记的公钥，不能终止已建立 SSH。中央 Codex 账号仅管理员发起设备代码授权；每次成员请求按实际 UID 和受保护策略过滤账号目录。成员默认账号独立，旧会话不漂移。Claude 保持手动登录和只读扫描。

`.awworkspace` 为限时一次性设备邀请；桌面只显示公开预览，令牌保留在主进程。导入由本机生成独立 Ed25519 密钥、HTTPS 提交公钥、按邀请 pins 创建专用 known_hosts，再核实非 root SSH 身份。主进程严格绑定 authority／generation／空间／路径／主机公钥／设备指纹，复用本次登记记录，不覆盖旧密钥；已有原设备允许过期恢复，新设备拒绝过期邀请。X 隐藏同一窗口并保留草稿，托盘恢复原窗口；明确退出才执行一次清理，托盘创建失败则正常关窗退出。

桌面合成检查全部无截图：`studio-ui-report.json` **42/42**（邀请、CRUD、账号／预算、逐设备撤销、迟到结果、简化页面与最小宽度），`studio-management-ui-report.json` **11/11**，`codex-login-ui-report.json` **24/24**，`ssh-discovery-ui-report.json` **18/18**，`tray-ui-report.json` **8/8**，`desktop-report.json` **52/52**。构建／typecheck 通过，无 renderer errors。专项客户端／主进程／Python 后端 **42/42**，账号 Broker 策略相关 **22/22**；最终联调全仓 **289/289**（`build/qa/collaboration-full-tests.txt`）。协作模块新增 CLI 参数后的旧索引断言已改为按参数名称核实；本轮最终日志已回读确认。

2026-09-25T14:53:33Z 核实旧工作台进程已退出后，启动本轮已验收构建，保持实际用户数据目录、1 个管理员与 3 个成员连接、用户当前深色主题，显示新的工作空间页。报告 `build/qa/reviewed-workbench-live.json`。此步骤不调用 SSH、不修改远端、不读聊天数据库或真实私钥。该时间点之后另一个主任务继续独立协作模块验收，运行窗口与后续源码构建须分开记录。

**远端边界**：新控制服务和账号 Broker 未部署真实 VPS，未新建／删除系统账号、修改真实 SSH 授权或消耗模型额度。预算可保存为策略，`enforcement: unavailable`；厂商原生额度未知。跨 UID 共享模型运行、可信计量／硬限额、环境物化、真实跨设备登记和 H 执行链仍未验收。

## 亮色去绿，保留深色

亮色背景改为暖白 `#faf9f6`，侧栏米灰 `#efede8`，正文墨色 `#302e2b`，辅助文字 `#6c665f`；修正旧边框、hover、状态点、阴影及主题预览中的绿偏。所有旧色补丁限定亮色；深色变量及工作区实测颜色与修改前基线完全一致。主／辅助文字在阅读区、白底、侧栏的对比度均至少 4.5:1。`light-theme-report.json` **6/6**、侧栏回归 **31/31**，本阶段未读取图片或生成截图，DOM／计算样式证据不冒充用户视觉验收。

## 翻译配置闭环、模块启停与英文模型边界

本轮新增 U41–U43。翻译默认开启，可在自己的设置页独立关闭；SSH、会话、权限、记忆/技能与协作属于基座，不增加泛化插件管理页。`packages/translation/module.ts` 负责请求队列、凭据访问、配置代际和撤销；关闭时不读翻译 key、不读目录、不翻译输入/公开进度/结果、不阻塞原文提交。正在执行的原生回合不因关闭翻译而假称取消。旧预览失效、在途迟到结果丢弃，已存配置与历史译文保留，重新启用不能复活旧预览。

设置支持第三方 URL/API key、基础/完整端点规范化、保存并读取实际模型目录、搜索选择/手填、Chat/Responses effort、Anthropic adaptive/预算。非默认思考参数为显式确认的**请求配置**，`effectiveEffort` 保持未知，不把目录或 HTTP 成功当实际思考证据；无自动付费探测和降级重试。顺带修复原模型目录绕过注入网络适配器、配置更改后旧预览仍可发送、离开设置前草稿丢失问题。

新增模型可见英文边界回归，框架生成的 prompt 包络、环境说明、边界错误与协议字段为英文；补充要求标签改为 `Additional requirements:`。用户输入/AGENTS.md/记忆正文和原生返回不被重写；UTF-8 BOM、CRLF、路径与签名保留。中文 UI 文案仅用于本地展示。

验收证据：`build/qa/translation-module-tests.txt`（10/10）、`model-facing-language-tests.txt`（5/5）、`translation-module-ui-report.json`（13/13，真实隔离 Electron + 本机 HTTP 合成上游，三协议请求已捕获）、`desktop-report.json`（52/52，无截图/renderer errors）、`translation-full-tests.txt`（全仓248/248）。TypeScript、Vite 和 host 构建通过。未调用真实服务/模型，未读取真实密钥，未重启用户正在使用的应用或修改 VPS；原生 H 入口继续遵循既有验收门禁。

## 真实 VPS 连接登记与工作空间发现

观测时间：2026-09-24T22:57Z 起。经用户本轮明确授权，已通过实际 Electron 工作台的 `host/save` 登记并回读 **1 个管理员 + 3 个工作空间 SSH 连接**；重复使用同一端点/用户名记录，不生成重复连接。实际用户数据目录为 `<workbench-user-data>`，没有直接覆盖整份应用状态或读取用户聊天数据库。

四个身份各用本机既有私钥路径、严格 `known_hosts` 校验，通过真实 SSH 的 `id -un` 与 `id -u` 验证：root 为 UID 0；三个成员分别核验了独立的非零 UID（真实用户名和 UID 不公开）。私钥没有被工作台读取、复制、导出或发送到 VPS；认证由本机 OpenSSH 使用原文件完成，三个工作空间均未使用管理员私钥。

只读识别从既有设备登记与各用户设备标记得到三个工作空间、各自工作目录和授权公钥指纹；两家 CLI 均存在，Codex 为 0.155.1，Claude Code 为 2.1.273。配置只展示允许字段，并修复不支持的 TOML 表头/多行值可能污染顶层配置的解析问题。

账号结果分开记录：各空间的 Claude 原生状态返回未登录；Codex 原生静态状态返回未登录，而旧 Broker 目录保持未知。另行只读核实旧 `codex-device-auth.service` 为 inactive/dead、disabled，socket 不存在。临时凭据配置下的原生未登录不能证明旧账号丢失；本轮没有重启服务、读取认证文件或改动旧登录状态。

实际 Connections 页面已显示三个空间、六个 CLI 版本、各工作空间本机密钥路径关联，以及区分来源的原生账号/Broker 状态。报告：`build/qa/vps-connection-registration.json`、`build/qa/vps-workspaces-live.json`。无图片读取或截图，无远端包安装/配置改写/账号创建，无真实模型任务。SSH 登录验证与工作台 H 原生执行链仍分开，后者保持原有门禁。

## 权限入口位置修订

按用户主动提供的 Codex 参考图，将权限选择器移入输入框内部左下角工具栏，与右侧发送操作相对；移除项目/运行时一行中的原入口，权限字号调至 11px 并使用正文色。权限存储和执行协议不变。

TypeScript、Vite 与主进程构建通过；无截图 Electron DOM 回归 **52/52**、renderer errors 为 0。新增空白/历史会话在标准窗口与 860×640 内容窗口下的四项位置检查，确认按钮位于文本框下方、输入框左半侧且与发送按钮不重叠。报告时间 2026-09-24T22:17:34.318Z；未自动重启已有用户窗口。

## 项目单入口与权限选择器

已将输入区的项目与工作文件夹控件合并为一个按钮：同一弹层支持搜索/选择项目、选择项目内多个文件夹、新建项目，以及临时打开文件夹。新建成功后直接选中当前草稿，不重挂载输入区；取消、过期保存结果与目录选择均不会覆盖后来打开的草稿。键盘 Tab/Escape、中文输入法箭头、原生目录对话框返回焦点均有 DOM 回归。

权限选择器已按运行时提供选项：Codex/离线示例为默认、只读、完全访问；Claude 为默认、自动批准编辑、计划模式、完全访问。值随会话持久化；旧会话缺省为 default；切换运行时重置为安全默认。可信主进程拒绝非法组合及准备/修订/提交/运行期间的权限变更；UI 在发送预览期间也锁定。原生适配层已显式传递 Codex 固定版本 thread/turn 审批与沙箱参数、Claude --permission-mode，来源和版本差异见研究记录 S27。两家 H 执行门禁保持原有状态，此次不代表真实远端权限或模型执行已验收。

本轮完整代码/协议回归 **106/106**；TypeScript、Vite 与主进程构建通过；真实 Electron DOM 回归 **48/48**，包含会话权限保存、重启恢复、多目录切换、新建即选与草稿保留。renderer errors 为 0。全程未查看图片、未截图，报告明确 `screenshots: false`。证据：`build/qa/permission-project-unit-tests.txt`、`build/qa/desktop-report.json`（运行时间 2026-09-24T21:57:41.631Z）。未访问 VPS、修改已有原生客户端、读取真实凭据或调用真实模型。

## 启动入口修复：进程存在但窗口不可见

2026-09-25 04:58 JST，复现并修复 `Start-Dev.cmd` 无可见窗口的问题。根因为 `scripts/start-dev.mjs` 对交互式 Electron 主程序也传入了 `windowsHide: true`：同一真实 Electron 探针在该参数开启时报告 `isVisible() === false`，关闭后报告 `true`。仅将应用启动改为 `windowsHide: false`，依赖检查与构建辅助进程继续隐藏控制台；不改界面、用户数据或原生能力边界。

回归断言先在旧参数下失败，再在修复后通过。完整代码测试 **97/97**、桌面交互 **36/36**、TypeScript/Vite/host 构建均通过。新增 `--no-screenshots` 桌面测试选项，本轮报告 `screenshots: false`、renderer errors 为 0，全程未读取或生成图片。最后从 `<external-working-directory>` 实际执行修复后的 `<project-root>/Start-Dev.cmd`，确认 `Agent Workbench` 拥有非零可见主窗口句柄且正常响应，并保持窗口打开。测试仅使用合成离线内容，不代表真实模型或远端链路验收。

## 后续交互修订：无项目新会话与全局技能

新建会话改为直接进入空白输入区，不弹配置Modal、不创建空记录；项目可为 null，文件夹可不选，项目/工作目录/运行时/SSH均在输入框附近选择。首次发送采用单次创建保护，不因会话ID从空变为新建值而清掉草稿。侧栏保留无项目历史、置顶/归档与深度链接。旧的空 `welcome / 开始使用` 容器按精确条件迁移为无项目归属，历史内容与真正项目不动。

技能移除逐会话勾选，改为全局metadata目录可发现、完整SKILL.md按id/hash读取。已完成框架读取合同；真实原生模型按需调用仍不冒充H联验已通过。最新代码/协议测试 **97项通过**，真实Electron交互 **36项通过**，覆盖无项目空白、快速Enter单次创建、共享技能按需正文和项目选择不丢草稿。原来翻译预览Modal/补充/Stop/双栏回归同时通过。下文的90/31是前一轮基线记录。

实施授权：2026-09-25，实施要求为模块拆分、实现和组装。用户随后明确解除旧的单 agent 限制：桌面 UI、安全基础、原生适配分别由子 agent 实现；主 agent 负责翻译、可信主进程、组装和独立验证。

## 本轮工作单

- [x] 还原 U1–U19、D01–D15 和既有 Codex 原生链基线。
- [x] 独立翻译代码：原文保护、三协议、提交闸门、公开文本旁注。
- [x] 安全基础代码：SSH 严格主机校验、环境 profile、owner-wide 文件服务、会话绑定。
- [x] 原生协议适配代码：Claude stream-json 和 Codex app-server；真实 H 仍未验收，入口 fail closed。
- [x] 桌面基础组装：项目/会话、设置、连接、能力状态；随后按用户反馈进入下列界面修订。
- [x] 完成最新界面修订：Codex式侧栏、多目录、右键深链、全窗左右双语与块追踪、中性深色、共享记忆/skills、发送预览弹窗/补充/直发开关/停止重发。
- [x] 最终整仓/桌面回归归档：90 项代码/协议测试与 31 项真实 Electron 检查通过。

## 本轮追加要求（最新决定优先）

详见 `requirements.json` 的 U20–U26：选择 Codex 侧栏/多目录/右键深度链接；保留用户认可的暖灰亮色，不走 Cursor 模板；深色改中性暖炭灰。全局左右 pane 同时容纳用户请求与助手回复：左是实际提交/返回内容，右是本地中文。分隔条可调整，点击块追踪对侧，悬停轻微双边呼应；用户已取消“联动滚动勾选项”的提议。预览可补充/修改，旧预览必须失效。

框架级记忆和 skills 共用，不按 Claude/Codex 切库。已实现显式 notes/SKILL.md 和同源、带来源hash的首轮上下文适配。**尚未实现官方 Codex 后台自动提取/整合引擎；skills 当前是 instruction-only，脚本/资源没有自动复制或运行。**

## 已发现并修复的集成问题

- JSON 解析错误不回显上游正文，防止网关错误反射凭据。
- 翻译配置/同意变化会撤销旧代际；排队但未发送的请求不能继续外发。
- SSH probe 迟到结果重验连接身份；切换连接后的 discovery 不串主机。
- 译文来源与 Agent demo 状态分开，不把真实第三方译文标为离线固定样例。
- 记忆关闭/删除后，旧未提交快照失效；已提交原生历史只允许有精确 receipt 的无再注入恢复。
- 空白可选记忆摘要回退为内容摘要，避免 UI 默认值导致只有引用ID而无实际偏好。
- 设置保存期间封闭新翻译请求的进入窗口，避免新 epoch 读取尚未提交的旧 consent；并发设置保存串行化。
- Stop 区分可取消阶段与完成落盘阶段；晚到请求明确返回未取消，不把正常完成误报成停止。

## 本地验收结果

最后完整运行：**2026-09-25 03:27 JST**（机器可读报告使用 UTC）。`npm run check` 四阶段全部成功：

| 检查 | 结果 | 不能由此推出 |
|---|---|---|
| 单元 / 协议 / 安全 / 主进程集成 | 90/90，0 fail，0 skipped | 不是远端真实模型验收 |
| TypeScript + Vite + Electron host build | 通过 | 不是已签名生产安装器 |
| 真实 Electron 窗口 | 31 项通过 | 使用合成内容和离线运行时 |
| npm audit | 本次报告 0 个已知漏洞 | 不等于完整安全审计或生产认证 |

桌面检查包括：左右用户/助手内容、modal预览、回中文补充、Enter/Shift+Enter、hover/点击定位、鼠标/键盘分隔条、默认关闭的直发与Stop、保留历史编辑重发、真实右键菜单、多目录、共享记忆笔记、独立key实际OS加密、真实进程重启及deep-link参数导航。OS全局协议注册未在QA中执行；正常启动注册本应用scheme。整合补充的模型调用用假响应测试，不消耗真实上游额度。

证据位置（生成物不提交Git）：`build/verification/summary.json`、`build/verification/tests.txt`、`build/qa/desktop-report.json`、`build/qa/light-workspace.png`、`build/qa/dark-workspace.png`、`build/qa/preview-modal.png`、`build/qa/context-menu.png`、`build/qa/shared-memory.png`。

## 固定边界

仅修改本仓库。无 VPS 部署、系统代理改动、旧插件改动、账号迁移或真实模型费用授权。第三方翻译 key 由用户在新应用中主动配置；不搜索或读取已有账号凭据。测试使用合成内容。不能将协议测试标成真实模型验收，也不能将投影标成强隔离。

本地可运行版本是阶段交付，不自动宣称完整 H 原生链、Claude 文件视图、VM 物化、远端出网和生产部署均已通过。P2/P3 保留原优先级，不在本轮改成自研 Agent loop。

## 必须保持可见的未完成项

- 独立真实翻译服务的模型质量/费用验收：尚未使用用户真实 key 调用上游；三协议与补充整合使用合成响应测试。
- Claude H：真实文件视图、shell wrapper 部署、跨 OS 路由、PTY/后台生命周期和远端网络证据尚未完成。
- Codex H：历史原生链已按合同拆模块，但本仓库尚未启动真实 executor/tunnel/VPS 模型回合。
- Windows owner 文件：可信 ACL helper 已实现；本仓库部分文件 owner SID 与当前用户不同，因此会被正确拒绝。不能将注入测试 owner adapter 的跨目录读写当作真实所有者授权或多租户隔离证明。
- 管理：只读发现与确认/幂等计划已实现，真实创建/分发/重建、安装回滚、账号额度/重置卡未上线。
- Memory/Skills：共享内容与两家输入合同已测，但自动记忆提取/整合、skill脚本/资源分发与跨进程原生历史恢复仍未完成。

没有修改原有 VPS、系统代理或既有 CLI 配置；没有替换旧插件，没有推送/发布远端仓库。所有用户要求（包括本轮变更）保留在 requirements.json，未把未完成项从范围中删除。

## U80 · Claude 订阅使用边界与协作加固（2026-09-26）

按用户授权，保留原生协作并修复可控风险：独立翻译保存/读取/请求链拒绝已识别的登录令牌、Cookie 和认证文件，拒绝网页登录端点；失败不保存新值、不覆盖旧值、不外发。协作消息增加持久化变更版本，read/wait 只关注参与会话，领取和确认及时通知，重复投递不制造唤醒；等待结束重验身份。工具说明要求不确定发送复用 operationId。

Claude 公开 api_retry 通知仅观察、不接管原生重试；最终失败后封闭当前适配器/传输的后续提交，先排空已收到事件再判断新任务，拒绝空白输入凭 peer inbox 启动回合。正常恢复成功和子 Agent 独立错误不会封闭主任务。原生子 Agent 数量、层级、模型与 CLI 二进制未改，协作工具没有移除。

验证：相关回归86项通过；最终全仓测试 **365/365**（`build/qa/usage-safety-final-full-tests.txt`）；受影响源码 TypeScript 检查通过（`usage-safety-scoped-final-typecheck.txt`）；main/preload 生产配置隔离构建通过（`usage-safety-host-build.txt`，输出在 `usage-safety-build/host`）。全仓 TypeScript 当时仍报并行配额工作区内 `quota-accounting.ts` 与 `quota-allocation.test.ts` 两处诊断，记录 `usage-safety-global-typecheck.txt`，未修改它们或据此宣称全仓类型检查通过。

本轮只在开始时向用户指定并行会话交接一次，未再联系、打断或重启正式窗口，未覆盖共享 dist。测试使用临时状态、合成 key、本机合成 CLI 子进程；真实 SSH/模型/兑换调用均为0。没有读取真实凭据、修改 VPS 或自动调用 Claude。Claude H 门禁仍未开放；当前失败锁定不是跨应用/跨设备/重启后的账号限额服务。详见 [完整审查与上线边界](claude-usage-safety-20260926.md)。


## U96 · Device-local native memory handoff (2026-09-27)

Implemented the revised archive/receive/verify design. First import selects existing Codex, Claude Code or both; unselected existing files are baselined. Native additions, revisions and withdrawals enter device-local recipient queues. Per-task hooks dispatch by frozen runtime, including resumed/forked Codex contexts, irrespective of third-party provider/model labels. Receivers get explicit English format, English memory prose and deduplication guidance. Native file/index evidence is checked before recording receipts; partial/invalid receipts remain pending, imported provenance prevents echoes, and later native corrections remain exportable. No extra model turn or cross-device sync was introduced.

The UI retains one switch, adds a compact initial selection and pending counts, distinguishes archive capture from verified receipt time, and keeps original-file CAS editing/deletion. Legacy projections retire only with matching ownership hashes. Skills/plugin behavior remains intact; permanent foreign-memory snapshot injection is removed.

Validation: TypeScript passed; full regression 505/505 (build/qa/memory-handoff-tests.txt). Isolated native-resource Electron QA passed 28 checks, with no renderer errors (build/qa/native-resources/report.json), including first-source selection, pending state, native edits and 860x640 visual inspection. General desktop QA passed 47 checks using AGENT_WORKBENCH_TEST_APP pointed at the isolated build (build/qa/memory-handoff-desktop.txt); production dist was not overwritten. A transient toast wait was replaced by persisted modal/state evidence in the UI test.

Limits: tests use temporary native homes, synthetic runtime transports and model-free native metadata fixtures. They do not prove semantic fidelity, English translation quality, native background absorption, future recall or remote-runtime/local-memory-store mapping. Codex external generated-memory ingestion has no verified universal write API; queued notes are not accepted as completed imports. Claude per-task hooks are contract-tested, while the actual Claude H bridge remains unverified/closed. No real model call, credential access, VPS modification, push or deployment occurred.

## U98/U100 · Plugin tabs, full UI extensions and independent memory controls (2026-09-27)

Implemented the requested workbench/runtime plugin tabs with keyboard navigation. The bilingual workflow now has one module switch; its expanded form reflects the switch immediately and no longer repeats a translation heading/switch. ZIP import and development notes belong only to the workbench tab. Native plugin installation/group confirmation remains in the runtime tab.

Audited and expanded the workbench plugin API: approved host code can invoke the existing core services and subscribe to state events; approved renderer bundles can add styles/panels or replace the whole application shell. All executable entry points require approval of the entire package hash. Source snapshots are revalidated before delivery, package changes revoke active contributions, failed or late activation releases owned resources, and renderer failures are reported in plugin details. Core resource-management routes remain unintercepted. The native recovery menu disables extensions persistently and reloads the base shell. A complete importable example and API guide are in examples/plugins/shell-workspace and docs/36-workbench-plugin-api.md. This is a full-trust local code facility, not a sandbox or a native-provider plugin compatibility claim.

Codex memory enablement and external-tool-context preferences now display at the same level, save independently while memory is off, and have independent override ownership. Source permission does not enable memory generation or use. Claude Code retains the verified autoMemoryEnabled toggle; official documentation did not establish an equivalent tool-context filter. Other memory-related settings, including directories and CLAUDE.md rules, are not being called nonexistent.

Validation: TypeScript passed; full unit/protocol regressions **539/539**, no skips (build/qa/plugin-full-tests.txt). Isolated native-resource/plugin Electron QA **37/37**, zero renderer errors (build/qa/plugin-expansion/report.json); translation synthetic-HTTP UI **13/13** (plugin-translation-ui.txt); runtime-management UI **8/8** (plugin-runtime-ui.txt); general desktop **47/47** (plugin-desktop-ui.txt). The isolated production-config renderer/main/preload build is build/qa/plugin-expansion/app; production dist was not overwritten. Dark and 860x640 light screenshots were inspected, including the complete replacement shell. The recovery menu was exercised through Electron; no foreground/system keyboard acceptance is claimed for the shortcut. An older transient-toast deletion check was repaired to verify the persistent list/file result. The translation regression exposed and verified a fix for delayed disabled controls after consolidating the switch.

Scope: temporary native homes, synthetic runtime mutations, native local configuration reads/writes in isolation, and loopback translation fixtures only. No real model turn, live-user configuration mutation, SSH/VPS deployment, account/credential access, push, or operating the user's active client. Exactly one initial coordination message was sent to the named neighboring chat; its CLI-install commit was kept separate.

## U96/U98/U99 · Memory history tabs, plugin ZIP modal and runtime settings style (2026-09-27)

Memory management now separates Codex, Claude Code and Workbench. Native rows retain their owning runtime and show verified foreign provenance; Workbench includes all archive revisions, pending/received records and withdrawals with read-only source evidence. Successful receipts persist native file/index hashes, including already-present evidence. Later body edits, removed markers or missing native files update current-evidence status without removing the archive or revoking the historical receipt. Old stored records retain existing ledger associations; insufficient old evidence remains explicitly unknown. Catalog refreshes never overwrite an editing draft, and original-file CAS protection remains intact.

Workbench plugin import opens the compact Skill-style ZIP drop modal without runtime selection. Picker cancellation, invalid/multiple/duplicate files and real Chromium file drops were exercised; imported code stays disabled until the existing approval path is used. The runtime CLI page now follows the established reading typography and flat rows with fine dividers. Native/npm choices replace the system select; paths, commands and timestamps are initially folded under installation details. Maintenance semantics, separate runtime locks and uninstall confirmation are unchanged.

Validation: this task's source was frozen on base `293b6fe` under `build/qa/memory-runtime-source`, excluding the other window's unfinished model-API edits. That source passed TypeScript and **545/545** unit/protocol tests with zero skips (`build/qa/memory-runtime-final-tests.txt`). Tests used the existing repository Codex 0.155.1 executable with temporary native profiles after the previously discovered local CLI executables became unavailable; no installation or real configuration mutation was performed. A discovery-only memory fixture now supplies its synthetic executable paths explicitly instead of depending on a real installation accidentally found outside the fixture.

Hidden Electron checks: plugin/catalog interaction **13/13** (`build/qa/memory-catalog/report.json`), final catalog regression **4/4** (`build/qa/memory-runtime-catalog-final/report.json`), runtime layout/maintenance **9/9** (`build/qa/memory-runtime-layout/report.json`), all with zero renderer exceptions. Dark/light, mixed installed/missing states and 860x640 screenshots were inspected. The broad native-resource rerun could not complete once the real Claude executable used by its bundled-skill metadata checks was no longer installed; it is not reported as a full native-resource pass. Earlier receipt UI timing was fixed by waiting for the actual loaded row.

Scope: isolated source/builds and temporary native homes; maintenance UI mutations are intercepted fixtures. No real model task, native absorption/translation-quality claim, user memory change, active-client interaction, production dist overwrite, VPS deployment or push. Shared model-API edits remain outside this change and its isolated acceptance.


## 多来源模型 API、会话切换与子 Agent（2026-09-28 JST，U101）

已实现：设置「连接与运行 → 模型 API」位于连接与环境上方，常规工作台增加同名快捷入口。多个来源独立保存协议、地址、系统加密密钥与显示名称映射；保存自动读取模型目录。每行最右侧复用技能/插件的开关，后端同时管控新会话、旧会话和子 Agent 的可用性；关闭保留连接/密钥/历史，重新开启恢复。运行中、待提交或结果未知时拒绝修改、删除与开关切换。

执行层支持 Chat Completions、Responses、Anthropic Messages 的流式回复、工具调用及结果回传；源之间不共享密钥、请求状态或原生线程。API 与已验证 SSH 模型同列选择，同会话空闲切换保留公开历史和回复来源，原生执行身份独立恢复。用户明确要求时可用精确目标和幂等操作创建 API↔API、API↔SSH 子任务；父子导航、同 owner 消息与查询不自动启动其他会话。未验证 Claude H 继续关闭。

模型目录中实际报告的窗口、输出上限、思考档位及默认值自动映射；缺失保持未知并可手动补充。压缩归执行层：SSH 保留原生压缩，API 在窗口已知时按 80%/输出预留预算执行有界公开记录摘要，字节估计与真实用量回执区分，原始消息/活动保留。默认文件修改需审批，命令始终需审批，版本冲突/未知写入不重放；命令环境不含 API 凭据，停止只影响所属回合及进程树。

验证：本轮源以 `f814754` 为基线冻结到 `build/qa/model-api/source-final`，排除另一主会话尚未完成的附件/侧栏拖拽修改。冻结源 TypeScript 通过；最终单并发全仓 **564/564**，零跳过（`build/qa/model-api/final-tests.txt`，含本轮 19 项专项测试，约 53 秒）。一次并发回归中既有原生 Codex 配置探测返回未知；该文件独立复核 14/14 通过，最终单并发全仓也通过，没有为绕过探测而修改既有原生控制。实际隔离 Codex 配置测试使用已有仓库 0.155.1 二进制与临时原生目录，没有真实配置写入。

独立隐藏 Electron **12/12** 检查通过、零 renderer exception（`build/qa/model-api/ui-results.json`）。生产参数 main/preload 与 Vite renderer 的隔离构建通过；检查了暗色/浅色、860×640 布局、稳定开关状态和固定可见的保存按钮。真实 loopback 合成 SSE 与两种来源/协议切换、跨来源子任务、重启恢复、来源删除和公开状态密钥排除均通过。截图位于同目录。

范围：本地代码、合成上游与 SSH 适配器、真实本机临时文件/审批/命令和隐藏 Electron。真实付费模型调用、真实 SSH 模型任务、跨厂商无损迁移、所有供应商私有协议未验证；没有修改真实凭据、原生配置或 VPS，没有操作用户正在使用的客户端，没有覆盖生产 dist 或推送。参考与用户说明见 `07-research-sources.md`、`model-api-connections.md`。


## U102 · 侧栏拖拽、项目浮层与任务附件（2026-09-28 JST）

项目支持真实拖拽及 Alt+方向键调整顺序，保留置顶分区和重启后的手动排序；会话支持拖到项目和右键移动，原工作目录、线程、运行时和执行状态保持。移动后目标自动展开，会话退出原置顶/自定义分组。项目浮层显示会话数、待处理/运行状态、关联目录及置顶/编辑入口。列表默认五条并显示余量，保存展开/折叠选择，支持一键全部折叠/展开；优先级为待处理/审批、运行中、未读、最近活动，手动项目顺序不受消息刷新影响。

附件选择、全会话区域文件拖放、图片粘贴、去重、缩略图/完整图预览、移除和仅附件提交已接通。宿主存储有摘要的独立快照，预览和修订绑定附件 ID，发送前回读核验；附件不进入独立翻译服务。历史、编辑重发、取消编辑和分支保留附件。图片已接入 Codex 原生 image/url 输入与三种 API 的实际内容块；PDF 按对应 API 文件/文档块发送，普通文本提供受界定内容，其余文件经本机快照路径和文件工具使用。没有仅有缩略图却静默丢弃附件的实现。

验证：生产参数 renderer/main/preload 隔离构建通过；TypeScript 通过；全仓 **578/578**、零跳过（`build/qa/drag-attachments/full-tests.txt`），其中附件/侧栏与原生桥专项 **29/29**。隐藏 Electron **15/15**、零 renderer errors（同目录 `report.json`）：原生 Chromium 项目/会话拖拽、真实 OS 文件拖放、图片粘贴、选择器桥选取/取消、预览、移除、去重、只附件发送、编辑恢复、批量折叠、重启恢复均通过；浅色及暗色 860×640 截图已检查。首次 UI 运行因测试使用错误关闭按钮标签而中止，修正为实际“关闭窗口”后最终全部通过。

协议事实来自仓库已有 Codex 0.155.1 的生成类型和当轮读取的官方公开文档，详见 `07-research-sources.md`；用户说明与限制见 `sidebar-and-attachments.md`。每条最多 10 个/50 MiB、单文件 20 MiB；原生连接受现有帧预算限制，图片合计 5 MiB 在发送前检查。API 模型是否实际理解图片/PDF仍需对应模型验收；Claude 原生 H 门禁未改变。

本轮仅向指定相邻会话交接一次，无子 Agent。相邻会话的模型 API 改动已独立提交为 `721f3f2`；本轮在其上集成附件，不混入其未完成改动。验证使用独立构建、临时状态及合成 transport/API 回执，没有真实付费模型/SSH 任务、凭据读取、生产 dist 覆盖、活动客户端操作、VPS 修改或推送。

## U101 后续 · 模型连接界面精简与目录诊断（2026-09-28 JST）

按照本轮反馈重做模型 API 弹窗：文学风格标题、紧凑连接信息、可搜索的勾选列表，只有点击「映射」才展开名称与上游 ID。移除无密钥选项、工具／子 Agent 开关、输出预算、超时和能力参数表单；空密钥直接处理，已存密钥支持保留／替换／明确清除。右侧来源总开关保持作用于用户及子 Agent。修正展开映射导致底部操作被裁切的问题，改为单滚动区域与固定完整可见的页脚。

执行层默认提供文件／命令与子任务工具，仍要求用户委派授权并遵守审批；旧工具关闭和预算设置在读取／保存时归一化。输出上限优先使用上游报告值，未知采用内部兼容默认；思考档位、默认值和上下文继续由目录映射。更换地址或协议不转送原密钥，也不沿用旧目录及能力。

核对翻译与 Agent 目录请求：生产均使用 Node fetch，同一地址规范化、路径与鉴权规则；三种协议的合成请求对比一致。只读目录失败不再冒称未知模型任务；DNS、TLS、连接拒绝／重置／超时、HTTP 鉴权失败和目录缺失分别提示，3xx 不转发密钥，异常消息与上游正文不回显。目录 404／405 可用手动映射；对话传输未知状态仍不自动重投。

公开无密钥检查：Node 和隔离 Electron Node 均为 ECONNRESET；隔离 Chromium 为 ERR_CONNECTION_CLOSED；Windows curl 在 TLS 握手阶段失败。未收到 HTTP 响应，不能证明真实密钥错误，也未读取用户真实密钥、私有翻译设置或实际付费调用。该连接问题只定位到 HTTP 前的网络／TLS 边界，没有据此修改代理、证书、系统网络或其他客户端。

验证：TypeScript 通过；全仓 **585/585**、零跳过（`build/qa/model-api-redesign/full-tests.txt`）；模型专项 **26/26**。生产参数 renderer/main/preload 隔离构建与隐藏 Electron **15/15**、零 renderer errors（同目录 `ui-results.json`），覆盖空密钥、密钥替换／清除、清晰报错、映射、来源开关、真实合成流、会话切换、用户授权的跨来源子任务、重启与隐私。检查深浅主题及 860×640 截图，并断言保存按钮完整位于弹窗内。早期视觉检查发现页脚裁切后已修复，最终复验通过。

本轮未启动开发子 Agent、未再向相邻窗口发消息、未操作活动客户端或覆盖生产 dist、未部署 VPS 或推送。相邻 SSH／工作空间改动保持独立，不纳入本轮本地提交。用户说明见 `model-api-connections.md`。


## U103 · SSH 连接、空间授权与删除交互（2026-09-27 UTC）

SSH 页面重排为暖白/暖灰、文字层次和细分隔线；角色由默认管理员/root 的分段按钮选择，新增密钥文件与受限 OpenSSH 配置选择入口。配置只读取字面连接字段，不执行附带指令。确认连接时将所选密钥原样复制到本机 `.ssh/agent-workbench/<selection-id>/identity`，原文件和既有密钥不变；当前 Windows 用户保持完整控制，仅隔离其他普通用户读取，不改变远端登录身份。首次连接核对指纹后保存主机记录，真实 UID 验证角色。密码/口令密钥/PPK 未适配，界面明确说明。

修复新建成员缺少 `.ssh/authorized_keys` 导致的连接失败、22 端口主机记录写法和导入公开预览/最终身份不一致。受管导出携带真实 authority/space 身份，服务端固定登记命令绑定公开策略中的 authority/generation/space ID；即使同名空间被删除重建，旧能力也不能消费。管理员可看 SSH 登记设备名并踢出，精确编辑对应公钥行，其他原始授权字节保留。设备列表为登记状态，不虚构实时在线状态或已建立 SSH 会话终止。

文件只能成功导入一次，本机、文件副本、重启和不同设备重放均拒绝；提示“文件已失效，请向管理员重新获取。”。未确认登记可恢复同一原密钥。停用暂移除有效设备公钥并取消未用导出，保留授权；启用恢复原公钥，被踢设备不恢复。工作空间删除并重建必须新授权。原控制文案及文档中“恢复需重新授权”的旧约定由本节覆盖。

左树在未连接本机前即可展示远端空间，可折叠；管理员/成员卡片除眼睛外全区域命中，IP 不可选择复制。小眼睛同步遮盖 IP，包括连接名称中重复的主机地址。连接/导入成功立即设为新任务默认，仍可继续导出给其他设备。两类本机连接均可移除，处理中任务阻止移除；删除远端空间后直接从列表、导航和本机连接消失，不留已删除列表、重建入口或常驻删除结果。内部防重放记录不作 UI 条目。

验证：全仓 598/598 单元及合成协议测试；TypeScript 与隔离生产构建通过。隐藏独立 Electron 的 SSH 专项 16/16，包括整卡/IP/眼睛命中、遮盖持久化、远端树、折叠与开关、设备踢出、一次性导入、自动默认、连接后再导出、文件选择确认、管理员/成员移除、删除后无记录；renderer errors 为 0。已查看浅/深色、连接对话框与 1100px 窗口截图。WSL 临时 HOME 中 7 项实际 POSIX 检查通过，覆盖空目录初始化、原子单次登记、原公钥恢复、设备发现/撤销、停用取消未用文件、同名重建拒绝旧能力和 symlink 拒绝。

证据在忽略目录 `build/qa/ssh/`：`all-tests.txt`、`build-results.txt`、`posix-results.txt`、`ui/results.json` 和页面 PNG。隔离源快照基于 `8431659` 加本轮拥有的文件，避免覆盖并行会话构建或操作用户当前窗口。没有真实 VPS 部署、真实 SSH 登录或模型调用；此前版本的 VPS 验收不代表本轮实现已在线生效。未新增第三方依赖或复制外部实现代码。


### U103 follow-up · SSH 文件拖入与可选身份记录（2026-09-27 UTC）

登录密钥区域支持真实本机文件拖放、拖入高亮与替换提示；原先独立的“已有 SSH 配置？导入”按钮已移除。点击和拖入共用同一识别流程：私钥只在主进程检查有界格式头，SSH 配置沿用安全字面字段解析与多服务器选择，不执行配置命令。preload 使用 Electron `webUtils.getPathForFile`，不把私钥内容传给 renderer；拒绝多文件、无磁盘路径的浏览器构造文件、目录、空/过大文件、公钥、误选的 known_hosts 和 PPK。拖入不连接、不复制；仍在确认连接时复制至本机 `.ssh/agent-workbench`，取消保持原文件不变。

高级设置默认折叠，明确“可选，通常无需设置”：不选择 known_hosts 也可继续；首次连接独立核对服务器指纹后自动保存。已有可信记录可选择复用，也可改回连接时核对。记录用于识别服务器，不能代替登录密钥或授予登录权限。严格服务器身份校验保持不变。

验证：SSH 单元测试 7/7；隔离全仓回归最终 600/600，无跳过；TypeScript 与隔离生产构建通过。第一次全仓运行有一项旧 Skill 测试指向已经不存在的 npm Codex 路径，使用现有 `AGENT_WORKBENCH_TEST_CODEX_EXECUTABLE` 覆盖为当前可执行文件后，全部通过；相关原生配置写入只发生于测试临时 HOME。隐藏 Electron 19/19，包括 Chromium 真实 OS 文件拖入穿过 preload、配置点击/拖入、取消无复制、多文件拒绝、浏览器构造 File 拒绝、不选身份记录继续指纹确认。浅/深色和拖入/高级说明截图已查看，renderer errors 为 0。

证据：忽略目录 `build/qa/ssh-drop/` 的 `all-tests-current-cli.txt`、`build-results.txt`、`ui/results.json`、页面 PNG 和官方说明页。验证基于 `be25e57` 与本轮拥有的改动，未混入并行会话未完成文件；共享 controller/main/contracts 只暂存本轮 SSH 片段。未操作用户当前窗口、读取真实私钥、更新 VPS、消耗模型额度、覆盖生产 dist 或推送。

### U101 follow-up · 映射清理、地址补全与批量选择（2026-09-27 UTC）

手动模型行增加始终可用的右侧移除图标；展开区保留移除操作，同时清理草稿和当前目录视图，避免删除后立即由缓存补回。未填写上游 ID 的空行、只填名称的行及未勾选空行，在界面提交与宿主校验时自动清理，不占用已选计数或已配置模型上限；只有 ID 时默认将其作为显示名称。有效但格式错误的模型仍须修正，不静默删除已配置内容。

模型 API 地址在失焦、读取目录和保存时补全缺失版本的 /v1，保留网关前缀及显式 v1/v2/v1beta 等版本，不重复追加；保持原有 URL 安全校验。允许零模型或目录读取失败时保存并关闭，之后重新打开编辑名称、地址、协议、密钥和模型。全选／取消全选覆盖完整目录，不受搜索或前 100 行展示上限影响；原来源开关、密钥隔离和执行准入边界保持。

验证基于已提交的 fb4c0c6 加本轮独立文件快照，排除其他窗口尚未完成的改动。TypeScript 通过，全仓 **606/606**（无跳过），新增设置专项 **6/6**；隔离生产 renderer/main/preload 构建及隐藏 Electron **19/19**（零 renderer errors）。实际点击覆盖展开／收起行移除、未选空行与名称残稿保存、目录 404 仍保存、重新编辑全部字段、125 模型搜索外全选和取消、ID 自动命名、零选保存及原有会话／子任务回归。深浅主题及 860×640 截图已检查，页脚保存按钮完整可见。

证据位于忽略目录 build/qa/model-api-editing：snapshot.json、typecheck.txt、full-tests.txt、ui/ui-results.json 及截图。没有读取真实密钥、发起付费模型／真实 SSH 任务、操作活动客户端、覆盖生产 dist、部署或推送；本轮仅提交拥有的模型配置、测试和对应文档。


## U104 · 会话权限偏好、运行中输入与回复交互（2026-09-27 UTC）

已实现项目及无项目分别记忆权限，按运行时保留其原生含义，选择模型来源不会再丢失该偏好；API 运行中权限即时重查，等待审批的动作执行前再次检查。Codex 中途输入使用带预期回合 ID 的原生 turn/steer；API 明确发送的输入加入下一个请求边界，不重放正在执行的请求。未发送、已确认和未知回执分开呈现，旧预览不启动新回合。来源选择明确区分 API 直连、SSH 原生、模型参数及缺失状态。

回复底部加入复制、助手分支和只悬停的记忆来源提示；用户消息移除分支。图标来自原始引用元数据或本轮成功的 Claude 原生项目记忆读取，不能据此推断后台注入、记忆吸收或 Claude H 已验收。文件右键补齐路径行号及 Markdown 链接，复用已有系统打开方式。HTML 默认进入无工作台/Node 权限的本机隔离预览，支持脚本、样式和有界相邻静态资源，提供源码/刷新切换，不是通用联网浏览器。

翻译模块开启时处理每条完成的公开助手消息，右上角“翻译中途消息”默认开启、全局持久化；关闭保留历史，最终回复继续翻译。没有阶段标记的最后一条原生消息在正常完成回合后补为最终回复，不将中断进度当最终回复。

**已按用户最新澄清实现运行中拨动 Codex CLI 权限。** 工作台立即发送 thread/settings/update，收到原生成功回执后更新选择并保存项目/无项目偏好；原生拒绝时保留原值，不中断或重启回合。具体从哪条请求开始使用新权限由 CLI 决定，不再因此阻止切换或等待下个回合才发送。此前 Codex 0.155.1 的隔离探测仍作为原生内部时序证据保留：回执成功后，同回合两次工具请求沿用旧审批策略，turn/settings/update 拒绝 approvalPolicy；这些不再属于工作台拨动功能的未完成项。Claude 公开 SDK 的运行期控制不代表本工作台 H 桥已接通；该门禁保持关闭。完整行为、复现步骤与来源见 [会话控制说明](session-controls-20260927.md) 和研究来源记录。

验证：以已提交 a6c5e95 为基线冻结本任务 32 个源码/测试文件，按实际差异排除另一个窗口未完成的远端 CLI 管理改动；共享 controller/runtime 文件仅纳入本任务片段。冻结源 TypeScript 通过，全仓 **619/619**、零跳过；生产参数 renderer/main/preload 隔离构建通过。独立隐藏 Electron **11/11**、零 renderer errors，包含复制/悬停/无用户分支、全局开关保留译文、文件菜单、实际 HTML 脚本/CSS/相邻资源、模型来源及权限恢复、API 运行中输入与权限切换、进程重启；暗色/浅色和 860×640 截图已检查。测试夹具的异步开关操作修正为等待落盘；一次冻结源漏带 runtime 片段造成的失败已修正并完整重跑，没有将失败结果算作通过。

证据：忽略目录 build/qa/session-controls 下的 source-manifest.json、full-tests.txt、typecheck-final.txt、ui/report.json、ui/*.png 和 native-live-permission-{control,probe}.json。原生探测使用已有官方 Codex 可执行文件与临时原生配置、合成 loopback Responses；所有工具审批均被拒绝，没有真实付费模型调用。无真实 SSH/Claude H/远端出网验收、VPS 部署、真实凭据读写、生产 dist 覆盖或推送。

权限拨动修订验证：以 `78292e3` 与本轮独立文件冻结验证，排除并行窗口改动。TypeScript 通过，原生控制器、权限、账号运行时及偏好专项 **65/65**，零跳过；验证立即发送、延迟确认后才保存、原生拒绝保留原值、项目与无项目偏好独立落盘，以及会话不中断/不重启。证据为忽略目录 `build/qa/native-permission-forwarding/` 的源清单、类型检查与测试日志。本次未改 renderer，未重复视觉验收或真实模型调用。


## U105 · 远端 CLI、浏览器用户与模拟授权（2026-09-27 UTC）

已实现管理员「远端 CLI」「浏览器用户」页签：新安装/更新动态核实官方最新版本并调用官方原生安装器，受管程序可图标卸载并二次确认；运行时分别互斥、未知回执不自动重试，保留账号与用户资料。账号移除调用原生 logout，成功后清掉目录与默认选择，保留原文/记忆。Codex 原有设备码、地址、复制与打开按钮保留。

Claude 通过 VPS 原生 CLI 和 VPS 浏览器登录，复用用户 <private-reference>/remote-browser 的既有布局及浏览器用户，支持增删改名与显式选择。没有环境时先完整预演并确认新增依赖，当前自动配置限 DNF Linux x86_64。桌面入口只打开严格 SSH 回环转发的远端画面；原生自动回调优先，按原生提示显示临时授权码备用入口，不保存或翻译代码。成功必须核实原生状态，登录后关闭本次启动的进程、保留用户配置；不接管已有浏览器，清理未知不重新授权。

**用户绝对禁止测试使用真实浏览器的 Claude 登录状态、Cookie、配置或进行真实授权。** 已采用假 CLI、临时用户目录、回环回调和完全模拟的隐藏界面；未打开真实 Claude 登录页。详细设计、依赖许可、事故边界和证据见 [远端维护验收记录](remote-management-20260927.md)。

验证：以 de51e94 加本轮独立源码冻结，TypeScript 与隔离构建通过；全仓 **634/634**、零跳过；Linux 模拟授权 **8/8**、浏览器用户/进程监督 **19/19**、CLI/账号生命周期 **10/10**、账号服务准备回归 **10/10**；隐藏 Electron **13/13**，renderer errors 为 0。浅/深色、模拟登录和窄窗口截图已检查。测试夹具的关闭按钮选择器与只读 IPC 漏项已修正并完整重跑。证据在忽略目录 build/qa/remote-management。

此前只读检查仅在检查过的位置未发现远端 CLI/进程/账号服务，所以无需清理程序；没有以此声称全盘不存在。当前为源码及模拟验收，未部署 VPS、安装真实远端程序、操作用户当前窗口、访问真实 Claude 浏览器登录状态或消耗模型额度；未覆盖生产 dist、推送或发布。Codex 原有执行版本门禁与未验收的 Claude H 边界保持。

## U101 原生执行修订与 U106 子会话阅读（2026-09-27 UTC）

本节覆盖前述 U101 独立 ApiRunner 的生产执行设计。第三方模型现在作为已安装 Codex / Claude Code 的 provider，按显式回合启动或精确恢复原生 CLI；凭据保留在宿主，原生进程只获得随机会话网关凭据。网关转换已支持的 Responses / Chat Completions / Messages 公开消息及工具协议，没有外层 Agent 推理或工具循环。各来源的原生线程分别保留，SSH 原生路径及 H 门禁独立。旧 ApiRunner 仅保留兼容测试/历史边界，不能冒充当前原生执行。

顶部只选运行时，底部模型选择器统一显示对应运行时的 SSH 与 API 来源，SSH 置顶；勾选目录保持原位置。上游实报思考等级驱动离散滑块，未知不编造；新会话及重载记住上次明确选择的运行时、模型、档位，后台子任务与浏览历史不覆盖偏好。多来源总开关同步约束用户和子任务准入。Codex 动态工具与 Claude 会话绑定 MCP 支持用户明确授权的跨来源子任务，两家可互为父子；不把 Ultra 当成两家通用原生权限条件。

主时间线增加原生/跨来源子 Agent 卡片，显示任务、来源、状态和最近公开内容。点击在右侧阅读区查看已收到的公开消息、工具输入输出及嵌套子任务，支持返回上级、关闭与 Esc。临时原生标识归一后保持打开的子会话；断线/未收到消息保持明确。原生任务生命周期与界面有界历史分开，不以显示数量限制原生子任务。Claude 2.1.283 的实际 Agent 请求即使未指定后台仍可能返回 isAsync=true；工作台依据 task_started / task_notification，不把启动回执当完成，也不在父回复结束时提前关闭仍在运行的已观测原生子任务。

子 Agent 的任务输入和回复默认不自动翻译，各条消息下方图标仅请求该条中文译文，工具日志/隐藏思考不进入独立翻译。请求按消息去重、核对原文及配置版本；译文单独保存，重启只恢复显示。插件 → 双语工作流提供「右侧对照」（默认）和「消息下方」，单独保存无需改动翻译连接。文件、HTML/代码预览、子会话占用右侧时，主会话已有及后续译文移到原文下方，关闭后恢复；内联样式始终按消息呈现。采用现有暖色、细分隔与衬线阅读风格。

验证：TypeScript 通过；最终全仓 **655/655**、零跳过（`build/qa/native-provider/full-tests.txt`）。实际安装的 Codex **0.155.1**、Claude Code **2.1.283** 在临时原生 HOME 与合成 loopback 上游中通过 **7/7**：两家精确线程恢复、各自真实本机工具、Claude 前台请求/后台请求的实际原生调度及公开结果、原生 Edit 拒绝/批准；证据 `build/qa/native-provider/live/report.json`。没有消耗真实模型额度。

生产参数 renderer/main/preload 隔离构建通过；隐藏 Electron 模型接入 **11/11**（`build/qa/native-provider/ui/report.json`）、子会话/译文阅读 **10/10**（`build/qa/child-reader/report.json`）、原有会话控件回归 **10/10**（`build/qa/session-controls/ui/report.json`），均零 renderer errors。检查了浅色、深色、860×640 截图；逐条翻译、占位后的新译文、嵌套返回、真实跨来源子任务、来源开关、档位记忆和进程重启均有针对性检查。早期夹具的空翻译密钥/缺少 stop 回执、缺少 archived 字段和数组消息匹配已修正重跑；真实 CLI 验收发现的 async 启动误判已修复并增加回归测试，未将这些失败算作通过。

范围限制：跨协议事件目前在收到完整上游结果后转成原生 SSE，并非逐 token 转换；不支持的原生内容/托管搜索/专用压缩接口明确拒绝或关闭。Claude 公开 task_notification 可能只有结果摘要，界面不会虚构未收到的完整原生聊天历史；没有为补全界面扫描用户聊天数据库。真实付费 API、真实 SSH 推理、任意私有协议、完整长上下文压缩及本机 provider 原生 fork 未验收；Claude 自定义模型窗口仅显示上游元数据，不声称已通过通用原生设置注入。源码/模拟/真实 CLI 本机工具证据不替代真实上游或 VPS 验收。

本轮未启动开发子 Agent；给相邻主会话的唯一一次交流已用完，此后未再通信。保留相邻会话已提交的独立文档变更；没有修改真实 CLI 配置、凭据或 VPS，没有自动推送、部署、覆盖生产 dist 或操作用户当前客户端。实现与来源详见 `model-api-connections.md` 和 `07-research-sources.md`。


## U108 · 原生运行记录、紧凑阅读与后台子任务（2026-09-27 UTC）

主会话与子会话统一为原文、6px 间距细分隔线、译文、操作按钮；不重复显示译文标题，保留实际提交文本与原稿。子 Agent 改为单行状态胶囊，按原生时点显示开始/完成，点击仍打开右侧公开会话；任务原文不重复显示，单条翻译及文件占位后的译文回流保持。已完成回合默认折叠过程，保留用户输入和最终答复；运行中、异常及未确认事项可展开，右侧译文定位会打开对应原文。

对照 Codex 0.155.1 的全部 19 类 ThreadItem 和两家公开通知，补齐上下文压缩、原生重连、读取/搜索/图像、Hook、MCP/终端进度、模型改派、等待、思考状态及 Claude 公开结果统计。隐藏思考与签名不显示、不翻译。原生重试次数只按实报值显示；没有外层重启、续投、账户切换或购买额度。逐项覆盖和未覆盖范围见 [运行记录审计](runtime-reading-20260927.md)。

修复本地第三方 provider 路径把根回合与所有后台子任务绑在一起的问题：父回复结束后可发送下一条明确任务，仍使用同一原生进程、线程与来源；后台工作继续受维护和来源切换互斥保护，支持明确停止并保留未知记录。补上 Codex 已绑定子线程自身的完成回执。原生前台等待行为不改，SSH/Claude H 原边界保持。

验证：类型检查与全仓 690/690（零跳过）；实际安装 Codex 0.155.1 / Claude Code 2.1.283 的隔离合成上游中，既有 provider 检查 7/7、后台并行/停止 4/4、同请求问答回归 4/4；隐藏子会话 UI 12/12，浅/深色、窄窗口与折叠/展开截图已检查。证据在忽略目录 build/qa/runtime-reading 及 build/qa/child-reader；均不消耗真实模型额度、不读取真实凭据、不覆盖生产 dist、不操作用户窗口、不部署 VPS。仅本地源码提交。


## U109 · 聊天目录、公开历史与跨会话来源（2026-09-28 JST）

原有协作列表只有ID/运行时/状态、读取只针对收件箱；现在补齐带真实标题的同owner目录与公开聊天历史。模型可搜索、分页、选择当前或归档聊天，再按准确ID阅读公开消息；运行时、模型与执行位置独立返回。查询不启动模型回合，不扫描原生客户端私有数据库，不暴露账号引用、隐藏思考或草稿修订。Codex动态工具和Claude MCP共用同一身份校验及有界投影。

跨会话发送由宿主记录来源ID、运行时、发送时标题及已知模型，幂等重试保留原标记。收到消息采用小字来源、紧凑正文与显示更多；可跳到准确来源聊天，来源删除后保留标题但禁用跳转，回执不等于模型已读。收到的协作上下文不折入已完成过程，空会话亦可展示，绝不伪造用户输入或自动开启新回合。插件查询入口为 `session/catalog` 与 `session/public-history`；参数、返回、边界、事件和例子见 `chat-tools-20260928.md`。

已验证：类型检查，专项35/35；实际Codex 0.155.1与Claude Code 2.1.283通过合成上游执行目录/历史/发送/收件/等待，6组检查通过；隐藏Electron界面8/8，浅色和深色窄窗口截图已人工检查。本轮独立变更快照的全仓回归697/697通过、零跳过；与相邻窗口未完成的插件和文档改动分开验证及提交。未调用真实付费上游、未读取真实凭据或用户原生聊天库、未部署SSH/VPS，也未覆盖生产构建或操作用户正在使用的客户端。

## U111 · 全功能开发接口与公开文档（2026-09-28 JST）

已将当前工作台全部功能面接入开发接口：所有宿主命名空间均进入插件中间件与同名方法替换链，包含原生记忆、技能、插件、CLI 维护和扩展自身管理。新增方法、服务、自定义事件与实际实例的包装/覆盖可由已批准的插件注册；覆盖作用于既有引用，允许增加新实现。控制器状态保存通知、运行时、翻译、交互、协作、原生工具引导、账号/空间依赖和 Electron 平台服务均公开装配。`translation` 导入包不再按内置名称拒绝；接管行为仍由显式 API 注册决定。局部界面可在命名位置或 CSS 目标前后挂载/替换，并支持完整主界面替换；停用、失败、包变更和覆盖层恢复均有清理路径。完整本机代码权限不是安全沙箱，也不额外授予其他设备、租户或系统管理员权限。

`AGENTS.md` 已增加强制规则：后续所有功能新增、修改或替换，须提供可调用、可扩展、可替换的开发接口，并在同一逻辑变更更新 `docs/36-workbench-plugin-api.md`、覆盖矩阵及验证。文档 36 补齐服务/方法、参数、返回、事件、错误、生命周期、兼容说明和可导入示例；`check:docs` 对照 TypeScript AST 检查宿主方法目录漂移。

`docs/README.md` 区分现行开发专题、需求、研究、历史方案、验收记录及仓库外环境维护。公开化当前 `AGENTS.md`、README 和 docs：个人绝对路径、私有会话/附件标识、具体成员身份以明确占位符替换；保留原日期、版本、结果及未验证范围。当前文件整理不清除 Git 历史；正常推送仍可能包含旧版本，未执行历史重写或上传。

验证基于已提交 `e6d574e` 加本窗口独立源码快照，未混入其他窗口尚未提交的输入菜单、记忆读取或预览改动。类型检查通过，全仓 **706/706**、零跳过；文档检查 **39 个文本文件、179 个宿主方法、0 项发现**，检查器测试 **3/3**。隔离生产参数 renderer/main/preload 构建通过；隐藏 Electron 原生资源与插件回归 **44/44**、零 renderer errors，检查了浅/深色和 860×640 窗口截图。覆盖全命名空间替换、实际服务调用/包装、状态通知、新方法/事件、工具定义及 MCP 引导、局部/完整界面、延迟目标重建、非后进先出的覆盖释放、失败清理、包批准撤销、核心停用恢复及重启。原生记忆保存测试改为等待保存完成后的稳定编辑状态，并核对原文件与交接档案，避免依赖短暂提示或保存期间的只读状态；最终完整回归已重跑通过，早期失败不计为通过。

证据位于忽略目录 `build/qa/public-docs-20260928/`：`snapshot.json`、`source/`、`typecheck-verified.log`、`full-tests-verified.log`、`ui-verified-v2/report.json` 及截图。使用独立应用数据与合成原生 Home，没有真实模型/VPS/远端出网验收、真实凭据读取、部署、生产 dist 覆盖或推送。所有功能面已开放接口，不等于任意第三方插件组合、未来原生版本或远端部署均已验收。

## 输入菜单、原生技能调用与记忆交接读取（2026-09-28 JST）

已移除原生 Claude/Codex 任务额外收到的工作台跨运行时技能目录；原生运行时自行发现元数据、在调用时加载正文。输入区增加紧凑加号菜单，提供附件、工作区文件、技能、Claude 原生计划模式、会话状态及记忆/插件/连接/设置入口。加号不直接展开全部技能；斜杠搜索命令与当前运行时技能，美元符号仅搜索技能。菜单最多 480 像素宽，受视口高度约束；支持方向键、Enter/Tab、Escape 与输入法保护。选择、消息和预览保留图标及高亮名称，编辑重发/分支草稿保留选择。

技能身份由宿主根据当前运行时、项目范围、原生启用状态和版本解析，提交前再次核验。Claude 每次一个原生斜杠调用，重新选择替换；Codex 最多六项原生 skill 输入。翻译仅处理正文，原生标识独立保存；关闭翻译时不调用翻译器。菜单是工作台实现，采用官方 CLI 不会自动生成宿主 UI；此次不宣称覆盖所有官方桌面命令或连接器。

记忆后台采集、当前批次发放与核验完成分开显示。新增 workbench_read_memory_handoff 原生工具及 session/memory-handoff/read 开发入口，只能读取绑定运行时/会话当前已发放的档案，校验实际文件及摘要并分页返回；关闭设置、结束批次或接收状态不可用时拒绝读取。英文交接指引明确授权设置与档案内容的区别，要求尝试读取后再判断文件是否缺失。原生文件和索引回执仍是完成条件，没有回执就保持待接收；不增加模型回合或自动继续。接口、错误、扩展和生命周期见 docs/36-workbench-plugin-api.md。

验收：以 7f1ba25 为基线的独立源码快照通过 TypeScript、全仓 713/713（零跳过）及公开文档检查（39 个文本文件、181 个宿主方法、零问题）。实际安装的 Claude/Codex CLI 配合临时 Home、合成 loopback 上游及隐藏 Electron 通过 10/10，覆盖原生技能正文加载、无跨运行时目录、模块关闭时零翻译调用、预览返回保留技能、输入法、深浅主题/窄窗口、实际档案读取及无回执不冒充成功。截图已检查。证据在忽略目录 build/qa/composer-memory-20260928/ 的 candidate-manifest.json、candidate-typecheck.txt、candidate-tests.txt、candidate-docs.txt 和 candidate-ui/report.json。

没有调用真实付费模型、读取真实凭据或用户原生聊天库、启动远端任务、覆盖生产构建、操作活动客户端或推送。真实模型整理质量、全部待接收条目的吸收及未来召回仍需真实任务证据，不能用本轮传输验收代替。

## Git 历史脱敏与发布准备（2026-09-28 JST）

在本轮明确授权下，对全部 4 个本地分支的 47 个历史提交进行原地脱敏，包含处理期间刚完成的并行提交。历史中的个人目录、私有会话/附件标识、具体成员和外部工程位置改为公开占位符；同步修正旧需求测试对私有会话标识的依赖。现行源码仅有仓库外浏览器来源 README 的路径说明发生变化，运行逻辑与测试夹具保持原样。两组提交身份原本已使用项目通用名称和保留域名，未发现需删除的个人身份；作者、日期、父子关系和合并结构保留，提交哈希随重写改变。

重写结果逐个核对提交拓扑与元数据，50 份 JSON 历史版本解析通过。旧 reflog 已清空，移除 327 个不再使用的旧对象（47 个提交、133 个树、147 个文件对象），其中包含此前已不可达的敏感文档版本。241 份文档历史版本隐私检查通过；全引用及剩余对象复查未检出本轮识别的私有路径和标识；通用路径、保留示例地址、模拟密钥与合成测试内容不当作真实凭据删除。仓库完整性检查通过。

按要求未创建恢复备份、备份分支、tag 或 bundle。没有 checkout/reset 工作树、覆盖并行源码或混入其他窗口未提交的改动；清理对象时临时锁定已有分支和共享索引，保留其他未引用的开发对象。提交映射仅保存在本机 Git 元数据中，不包含旧文件内容。处理时仓库未配置远端，未推送、发布或部署。

上述结论对应本轮检查的历史与规则，不代表后续新增提交自动通过发布审查。新的公开文件、二进制、截图和来源仍需按项目规范复查；旧记录中的提交哈希为重写前的证据标识。此项是文档与历史维护，不替代运行时、模型或远端功能验收。

## 个人技能双运行时连接（2026-09-28 JST）

个人页顶部增加双运行时批量入口与当前列表接入计数，每行来源右侧、原生开关左侧均有 Codex／Claude logo。圆形图标按目录实际连接点亮，外部条目只读，冲突/断链显示异常；右侧开关继续写入原生启用设置。批量确认仅包含当前过滤列表，紧凑弹窗展示新接入、复用、跳过或可撤销数量，支持 Escape、焦点返回与深浅主题/窄窗口。描述单行省略时保留完整文本的原生 title 悬停说明，描述与来源在同一行时至少相隔 24px。

连接完整目录而非复制 SKILL.md；解析 CC Switch 式入口的最终真实目录后直接连接。相同目标复用，不接管外部链接；同名不同目标、断链和循环/重叠目录不覆盖。撤销仅移除工作台建立且身份仍匹配的链接，保留源、配套资源及外部管理器配置；外部替换后立即丧失工作台删除权限。项目、官方和插件技能不被提升为全局个人技能。原生目录和开关分别回读，不增加跨运行时上下文目录，不主动重载已有会话。

两分钟、单次消费的 plan/apply 接口核验源、目标、根路径和登记并发变化；整批预检后逐项执行，I/O 失败停止后续动作并明确返回部分结果。文件系统操作不具备跨进程事务保证。完整参数、返回、错误、权限、扩展与生命周期已同步到文档 36。

验证基于已提交 b33257d 加本轮独立源码快照：TypeScript 通过，全仓 **770/770**、零跳过；其中新增连接测试 **18/18**，包含源/目标/根目录变更、外部替换、同名/断链/别名、部分 I/O 失败、过期/重放、原生禁用分离和实际 Codex skills/list 在未传入技能路径时的前后发现。隐藏 Electron **12/12**、零 renderer errors，实际两家 CLI 配合临时 Home/合成 loopback 响应验证链接后技能正文加载；覆盖行内位置、悬停完整描述与至少24px间距、筛选批量确认、外部保护、窗口 focus、重启、深浅主题与860×640窗口，截图已检查。公开文档检查40个文本文件、187个宿主方法、零问题，检查器测试3/3。

早期一次并发全测中，既有原生配置读取测试返回未知状态；该项单独复验及最终四进程全仓重跑均通过，未修改其生产逻辑或弱化断言。最终证据在忽略目录 build/qa/skill-links-20260928/ 的 candidate-manifest.json、final-typecheck.txt、verified-tests.txt、final-docs.txt 和 verified-ui/report.json。

所有验收使用临时原生目录、隐藏 Electron 和本地合成响应；没有替用户自动分发真实技能、读取真实凭据或用户聊天库、操作/重启活动客户端、修改 CC Switch、覆盖生产 dist、推送或部署。原生格式的运行时专属能力仍可能不兼容，未来版本和其他操作系统未由本轮 Windows 证据覆盖。


## U111 后续 · 注册式运行时与任意 UI 重构（2026-09-28 JST）

交付快照已合并本轮验证前其他窗口的已提交工作：800/800 测试通过，类型检查与构建通过，40 份公开文本及 190 个宿主方法文档检查为 0 问题。全量测试通过 `AGENT_WORKBENCH_TEST_CODEX_EXECUTABLE` 指向实际发现的 CLI，并使用 `--test-concurrency=4`；早先默认并发下的一次原生配置探测未知已单独复验通过。构建保留现有大 chunk 提示，不影响通过。

插件新增 `api.runtimes.register`，不再要求第三运行时替换多处固定分支。注册后进入普通选择器、模型目录、权限、会话创建、输入预览与提交、消息、审批、问题、停止、明确恢复、可选插入和分支。检查点及模型 lane 持久化；插件缺失、停用、变更、失败激活及同 ID 不同 owner 均有处理，原聊天历史保留，过期事件与回执拒绝，没有自动重放任务。适配器能力由实际方法推导，缺少可选能力时不伪装可用。

UI 继续开放完整 CSS、任意选择器挂载和整壳替换，新增批准包图片/字体 `assetUrl` 及自动清理事件监听 `listen`。同一个 `examples/plugins/runtime-studio` 参考包同时提供第三运行时、背景/配色、阅读密度、局部工具栏以及整个主界面和宿主功能调用。示例仅用于源码与开发文档，不预装、不自动启用，不安装进实际用户工作台。

已完成 11 项运行时专项测试及隔离 Electron 的 10 组检查，renderer 异常为 0；检查包含通过常规 UI 发送、模型与自定义权限、审批、页面切换、重启、停用、完整主界面、任意选择器和实际宿主实现替换。人工查看了背景/审批界面与完整替换界面截图。接口、示例、错误、兼容和覆盖矩阵同步见 `docs/36-workbench-plugin-api.md`。回声适配器是离线协议证明，不是真实第三方 CLI/模型验收，未部署远端，未修改用户原生配置。

## U111 再次审计 · 多实例界面、设置注册与独立数据（2026-09-28 JST）

本轮发现并补齐三处正式开发接口缺口。`observeSurfaces` 为任意选择器的每个匹配元素提供独立实例，处理新增、属性变化、移除、异步清理与替换层恢复。`settings.register/open/list` 接入实际设置导航和搜索，可新增页面或叠层替换任何内置设置页；失效时恢复剩余层/核心页。host 与 renderer 的 `storage.read/write` 共享插件独立非敏感 JSON 配置，按修订比较保存，升级及停用保留，代码包批准 hash 与 ZIP 导出不混入配置。

未用全信任 Node/DOM 访问替代契约：类型、参数、结果、事件、错误、权限、兼容性、生命周期、覆盖矩阵与示例均已更新文档 36。AGENTS 与 U111 验收要求同步维护。`examples/plugins/ui-workshop` 仅供开发文档与源码参考；验收仅在临时数据目录导入，未安装进实际用户环境。

最终源码快照以已提交的 8f48d6f 为基线并仅加入本轮逻辑改动；其他窗口的未完成附件、工作树、模型检测改动留在工作区。全仓 **809/809** 测试通过，零跳过，其中本轮配置/设置专项新增 **9/9**。类型检查与构建通过，保留既有大 chunk 提示。公开文档检查 **40** 个文本文件、**192** 个宿主方法、零问题；检查器测试 **3/3**。

隐藏 Electron 新增扩展验收 **12/12**，既有运行时/整壳皮肤回归 **10/10**，两组 renderer errors 均为零。覆盖真实侧栏多个任务、设置搜索与内置替换、配置 host/renderer 回读、重启、停用恢复、任意层卸载、属性改变、迟到清理与异步失败释放；人工检查设置页与整壳截图。证据位于忽略目录 `build/qa/extension-audit-20260928/` 的 review.json、tests-reviewed.txt、build-reviewed.txt、docs-reviewed.txt 和两组 UI result.json。使用实际发现的 CLI 路径和四进程测试并发；这些证据不等于真实第三方模型或远端部署验收。

未操作活动客户端、读取真实凭据/聊天库、修改原生配置、推送或部署。支持面继续演进，不宣称已证明任何未来需求都无需新接口；后续功能仍须按 AGENTS 同步开放与验证。
<!-- plugin-extensibility-status:end -->


## 会话底栏统计与模型归属（2026-09-28 JST）

新增紧凑会话底栏：轮数、模型调用步数、tok/s、累计 token 与缓存命中率。悬停或键盘聚焦显示精确输入、输出、缓存读取/写入、分组总量，并按运行时 × 模型保留历史归属；中途切换来源不会清空。原有上下文环形指示器保持一份，不新增替代指示器。

采集覆盖 SSH 原生根流、本机 Codex/Claude 原生进程、Responses/Chat Completions/Anthropic API 及注册运行时。API 在协议转换前被动采集真实用量，避免转换层丢掉缓存明细；相同原生回执不二次累计。原生累计与消息快照去重，重启保留游标；使用提交时模型来源，避免下一回合选择或旧原生默认值污染当前归属。速度标明 API 耗时或包含工具/等待的回合观测耗时。缺失字段保持未知，已知部分有下界标识；不补造旧历史、不从字符估 token、不叠加缓存和推理输出、不改变未验收的执行准入。

稳定只读 session/metrics、Session.metrics、RuntimeEvent usage 事件、底栏多实例替换、错误和停用恢复均记录在 [插件 API](36-workbench-plugin-api.md)。本轮使用既有文档登记，无新增文档文件。

验证：以已提交源码加本次独立差异冻结，相关单元/协议 **116/116**（含用量专项 **23/23**）、隐藏 Electron **12/12**、TypeScript、Vite/host 生产参数构建和公开文档检查通过。已检查实际 Workspace 底栏、精确分组浮层、浅/深色与窄窗口截图；包含悬停保持、键盘、真实状态落盘重读、读接口无写入、插件动态多实例替换及停用恢复。合成网关检查没有增加模型请求，SSH 使用协议帧；不宣称真实商用账单或远端出网验收。隔离文件预览在组件夹具中不启用，生产构建仍编译原模块。

本地证据位于忽略目录 build/qa/session-metrics/。本轮未读取真实登录资料或聊天数据库、操作活动客户端、覆盖正式 dist、部署或推送。共享工作区文档检查曾报告并行功能新增入口尚未登记；本次冻结范围文档检查为 40 份文件、194 个入口、0 项发现，未接管其他窗口的未完成修改。


## 回合末端操作与运行中历史分支修订（2026-09-28 JST）

- 已实现：复制与分支只显示在每个已完成回合的最后回复，过程及当前运行回合仅留翻译入口；结束前先收到 final 文本也不提前显示。已完成回复原文／译文分别复制，用户输入原有复制与编辑功能保留；原生子会话输出同样收敛到结束处。
- 已实现：运行中可从此前已完成回复创建聊天或 Git 工作树分支，原生上下文仍固定到准确回执。当前回合、过程、缺失回执与结果未知不开放；后续流式追加不再误报源会话变化，选中历史或连接身份变化仍拒绝；源线程不被停止、回滚或重连。
- 已实现：工作树禁用理由细分为非 Git 目录、无提交、缺 Git 等，不替普通目录初始化仓库。独立检出保留当前文件快照；它不代表旧消息当时的文件状态。复制期间文件变化及失败清理保护仍有效。
- 已实现：停止按钮使用32px中性色圆形、12px居中方块，主题规则不会覆盖成发送按钮的圆角方形；新草稿恢复发送图标的行为不变。未复制其他客户端代码或图形。
- 记忆诊断：原生正文引用解析、显示与本机提供方原文保留通过合成测试；修复空 memoryReferences 缓存遮住正文后续完整引用。Codex 未返回引用标签时不伪造来源；Claude 成功结构化记忆读取与显式引用区分。仅凭界面截图不能确认具体一次原生回复有没有返回引用，不宣称该真实模型任务已经复核。

本轮验证与证据：定向测试涵盖完整回合与插入输入、活动源执行器、后续流式事件、真实临时 Git 检出、原文／身份漂移拒绝与干净检出回收；隐藏 Electron 检查末端按钮、双语复制、来源返回焦点、停止／发送状态、主题和窄屏。验收资料保存在忽略目录 build/qa/turn-actions-20260928。最终计数以同目录报告为准；源码、协议夹具、真实模型及远端验证分别计量，不操作活动客户端或读取真实聊天数据库，不覆盖正式 dist，不部署或推送。

验证结果：类型检查与公开文档检查通过；指定本机已安装 CLI 的隔离测试路径、限制测试文件并发为 4 后，全量 990/990 通过；隐藏 Electron 的控件检查 20/20、实际分支流程 14/14 通过。默认测试曾因旧 CLI 路径不可用及高并发原生配置回读失败而未通过；修改前代码的该项单测通过，未修改原生配置实现或真实用户设置。受控全量结果不代表默认并发下的稳定性已经修复。

### 停止图标双主题统一（2026-09-28 JST 后续修订）

浅色与深色主题统一为此前暗模式的浅色圆底、深色方块：外圆 32px，方块 12×12px、圆角 2px，中心偏移为 0。不再通过主题反色造成视觉大小差异；发送／停止切换行为不变。插件颜色变量、调用示例与生命周期已同步到文档 36。

本次隐藏 Electron 控件检查 20/20，通过实际组件确认双主题尺寸、中心、颜色完全一致，CSS 变量覆盖及撤销恢复通过；浅色、深色和窄窗口截图已人工检查。证据位于忽略目录 build/qa/stop-unified-20260928，使用合成宿主，不操作活动客户端或覆盖正式 dist；本次未复跑全仓测试，不复用上一轮 990 项作为本次通过数。

仅包含本次三个文件差异的冻结源码快照通过类型检查与公开文档检查（41 份文件、208 个宿主入口、0 项发现，检查器测试 3/3）。共享工作区检查曾被其他窗口尚未完成的远端文件功能阻断：缺少 openFile 参数和 8 个接口目录条目；本次未修改或提交这些并行文件。

配色修正（2026-09-28 JST）：用户要求统一方块尺寸，而非将两种主题改为同色。亮色版恢复深色圆底，中间采用此前暗色版圆底的暖浅色；暗色版保留浅底深方块。两边仍为 32px 圆底、12×12px 方块、2px 圆角、零中心偏移；上方同色版本记录属于此前验收。

本次配色修正的独立源码快照通过隐藏 Electron 控件检查 20/20 和类型检查；逐主题测量颜色、尺寸、居中、悬停及插件变量覆盖／撤销恢复，检查浅深色与窄窗口截图。证据保存在忽略目录 build/qa/stop-light-20260928；未修改发送／停止行为，不覆盖正式 dist，不操作活动客户端或远端。


## 跨协议流式转发与宿主开销修复（2026-09-28 JST）

在已存在的正文增量转发基础上，补齐 Chat Completions、Responses、Anthropic Messages 到两家原生运行时的工具参数增量。普通工具、命名空间映射、custom 工具字符串转义、并行调用、UTF-8 分片与最终内容一致性均受检查；只有有效完成回执才释放工具／响应完成事件。私有推理与签名不伪装成公开正文；同协议保留原生字节及能力范围。

修复同协议背压与取消；两条路径不再等待用量落盘才交付完成，读取在协议终止后结束而非等待额外 socket EOF。正文转换不再对每个 token 重扫全部历史前缀。宿主合并等待写盘期间的碎片与观察更新，去掉 Claude 每个事件反复保存相同会话 ID 的操作，保留完成／审批顺序和最终落盘屏障。新可替换入口 `runtime.native-provider.openGateway` 接通真实启动；公开契约、生命周期与失败处理见文档 36。

隔离合成对照以 `7697d0f` 为基线，6 条协议组合各 3 组、前后顺序交替：加入 120ms 用量保存延迟时，上游结束到客户端结束的中位附加耗时约 **124.90ms → 0.60ms**；首段传递中位附加耗时约 **0.42ms → 0.36ms**。16000 个 64 字符片段（共 1,024,000 字符）的转换器压力重放中位处理耗时约 **9119.82ms → 6.59ms**，检查总正文与最终结果一致。这些数值是本机受控转发／转换开销，不是模型 tok/s、真实首字时间或普通任务整体提速倍数。

验证记录保存在忽略目录 `build/qa/native-stream-repair/`。两家已安装真实 CLI 使用隔离原生目录和无副作用的合成工具，四条跨协议工具往返均完成；每条路径恰好一次工具请求和一次最终回复请求；完整参数已经到达但最终回执尚未放行时，原生测试工具仍未执行，之后恰好执行一次，正文不重复；宿主插件包装入口与停用恢复也通过。没有调用付费模型、读取真实登录资料、改动远端或操作当前活动客户端。当前窗口需要后续正常重新加载构建才能使用新源码，源码验收不等于已部署。

最终冻结验收：以 `7697d0f` 加本轮限定差异独立检出，定向协议／宿主回归 **86/86**，真实 CLI 文字流式 **4/4**，四条工具往返加插件接管／恢复 **5/5**，TypeScript 与生产参数构建通过，公开文档检查通过。全仓 **1022** 项：**1019** 通过、**2** 跳过、**1** 失败；唯一失败为 `tests/native-resources.test.ts` 中已有的原生技能控制测试，已在未加本轮差异的同一基线复现（`Native skill control is unavailable or overridden; refresh the catalog.`），不宣称全仓全绿。当前共享工作区的定向回归与 TypeScript 也通过；其他窗口的未提交功能不纳入本轮提交和验收声明。


<!-- translation-quick-toggle:start -->
## 翻译模块与会话临时开关解耦（2026-09-29 UTC）

插件页“启用双语工作流”作为模块总开关；会话框左下角改为独立的全局临时暂停开关，不再反向修改插件状态。详情页展开后可配置“显示临时翻译开关”；只有总开关与该选项均开启才显示。临时状态跨会话与重启保留，隐藏该开关时恢复正常翻译并保留此前临时状态；总开关关闭时下方翻译控件全部隐藏，输入框略下移，底部保留至少 12px 留白，会话统计保留。

临时暂停贯通输入、输出与手动翻译门禁；明确发送使用精确原文，不读取翻译凭据或发起翻译。暂停、恢复与显示选项变化取消旧准备和在途翻译、保留草稿与历史译文，迟到响应不能自动提交。临时暂停不妨碍详情页显式读取模型目录；模块完全关闭仍禁止目录请求。公开入口 translation/quick-toggle、状态类型、权限、错误、生命周期、迁移说明及功能覆盖矩阵同步文档 36。

在已提交 5b7756d 加本次差异的隔离候选验证：TypeScript、生产参数 renderer/main/preload 构建通过；全仓单元/协议测试 **1,130/1,130**，零跳过。隐藏 Electron 真实组件 **20/20**、完整应用和合成 loopback 翻译服务 **15/15**，均零 renderer errors；覆盖显示条件、保存失败、在途取消、重启持久化、精确原文与翻译协议。已检查设置展开、浅色、深色及窄窗截图，开关隐藏后左侧留空，未贴边或溢出。公开文档检查器 **3/3** 与 41 份文本、227 个宿主入口检查通过。

首轮全仓测试因旧默认 CLI 路径不可用失败；显式传入已安装程序路径后完整通过，原生设置测试仅使用临时 Home。界面脚本已等待异步状态回读与焦点恢复，并以持久化字段比较重启历史，修正夹具时序后重跑通过。隔离候选排除其他窗口的未完成改动，证据保存在忽略目录 build/qa/translation-quick-toggle。没有修改在用客户端、真实配置或生产 dist，没有真实付费模型、SSH 或远端部署；本次工程验收不代替真实翻译质量验证。
<!-- translation-quick-toggle:end -->


<!-- appearance-settings:start -->
## 外观设置、Claude 阅读字体与数字排版（2026-09-30 JST；U116）

外观页已提供浅深色/系统模式、暖灰/中性配色、自定义强调色、可搜索本机字体，以及独立界面/正文/代码字体与字号、数字等高、减少动态效果、实时预览和确认恢复默认。既有文字样式接入语义字体变量及相对字号，菜单、侧栏、主回复、译文、子会话、Markdown 和已挂载 Monaco 均可响应。用量/金额/计数默认使用系统字体与等高数字，移除这些位置对 Georgia 旧式数字的依赖。

用户明确选择 Claude 桌面应用阅读字体。本机已安装 Claude Desktop 2.7032.0 的静态样式及字体 name table 核验默认回复为 Anthropic Serif Variable Text；正文默认使用该字体，中文回退到系统字体。只读引用本机安装资源，未把商业字体复制进仓库、系统字体目录或发行包；不可用时使用 Georgia 与系统中文回退。既有显式字体选择保留，刷新目录可重新发现，安装资源变化后的浏览器字体需重启窗口加载。系统字体枚举当前仅支持 Windows。

外观选择通过既有原子状态存储持久化到 `<app-data>/state.json` 的 `appearance` 字段，修订比较防止覆盖并发修改；不改变原生客户端配置。公开 `appearance/get`、`appearance/set`、`appearance/fonts`、CSS 变量及共享服务 `appearance.reference-fonts`，接口、事件、错误、迁移、固定字体资源协议及插件停用恢复见文档 36。

以已提交基线 `0a47b40` 加本轮限定差异冻结验收：TypeScript、生产参数 renderer/main/preload 构建、公开文档检查和插件契约门禁通过；全仓单元/协议测试 **1,225/1,225**，零跳过，外观定向测试 **12/12**。全仓测试显式选择已安装 Codex 程序路径并限制测试文件并发为 4，原生设置只用临时 Home；不将历史默认路径缺失当成本轮功能失败。

隐藏独立 Electron 外观检查 **14/14**，零 renderer errors，读取 **243** 个系统字体家族。使用生产 CSP 与实际字体协议，Chromium 平台字体报告确认 Anthropic Serif 与微软雅黑实际字形，也确认切换后的 Arial；覆盖独立字号、已挂载 Monaco 与插件样式恢复、配置重载、保存失败、缺失字体、搜索键盘路径、数字、主题及减少动态。浅色、深色窄窗和阅读预览截图已检查。其他回归：此前同一功能集的 composer 隐藏组件 19 项及零 renderer errors 通过；它不替代本次默认字体的独立验证。

证据保存在忽略目录 `build/qa/appearance-20260930`；候选快照排除共享工作区其他未完成改动。没有读取真实账号或聊天数据库，没有操作在用客户端、覆盖正式 dist、调用付费模型或进行远端部署。本次为源码、隔离配置和隐藏桌面验收，当前生产窗口需后续正常构建/启动才能使用更新。

### 字体说明精简（2026-09-30 JST）

按用户要求删除字体选择区下方常驻的 Claude 来源／回退说明及其专用样式。字体选择、来源查询、资源读取、缺失回退和保存行为不变；接口前置审查、功能覆盖矩阵、内部 DOM 定位迁移与契约快照无变化结论同步于文档 36。

以 `a16898d` 加本轮限定差异生成隔离候选：TypeScript、`check:plugins`、`check:docs` 通过，外观／字体定向测试 **21/21**，隐藏 Electron **26/26**，零 renderer errors。检查浅色与深色窄窗截图，确认说明已移除；真实字形报告仍确认 Anthropic Serif 与微软雅黑，批准插件的字体注册、三个选择器、渲染消费、停用／重新启用和失败清理通过。初次 UI 构建因隔离候选缺少本地依赖路径失败，补齐指向现有依赖的目录链接后重跑通过，没有安装或升级依赖。证据位于忽略目录 `build/qa/appearance-font-note-20260930`；共享工作区其他未提交改动不属于此验收范围，未操作在用客户端、覆盖正式构建或部署。
<!-- appearance-settings:end -->

<!-- image-viewer-glass:start -->
## U112 · 朦胧图片预览与附件右键交互（2026-09-30 JST）

图片预览使用当前主题 42% 不透明底色与 20 px 高斯模糊，透出柔化的页面轮廓；去掉斜向渐变，保留轻边线与控件浮层。图片操作组和圆形关闭按钮位于独立系统窗口区域下方；缩放居中放在底部，文件元数据保持底部小字。点击图片外空白关闭；图片本体、控件、拖动、标注和导出中状态不误关，关闭后归还焦点。

图片直接点击缩略图展开，不增加独立的“查看图片”按钮；验收页面也移除多余测试入口和覆盖附件按钮的示例样式。会话图片、普通文件、生成结果、草稿与全屏预览均提供中文右键菜单；会话运行不禁用附件操作。支持复制原图、打开、定位、另存为和加入当前草稿，草稿追加保留文字、去重并作废旧预览，绝不自动提交或干预模型任务。补齐菜单键盘操作、边界定位、取消保存反馈、快捷键语义和失效草稿保护；流式输出的程序滚动不收起菜单，菜单外点击只收起菜单。

模型看图按原生事件单独呈现：根/子会话默认折叠，展开后为约 78 px 小图，不显示文件名、大小或路径，直接点击和右键操作。只有展开时才加载已绑定日志的本机图片；展开期间原生来源或完成状态更新会刷新缩略图，不要求重新开合、不残留旧图。Codex imageView 与 Claude Read 的显式图片结果识别各自验证，不按扩展名猜测、不保存图片 base64 到活动。生图结果保留既有独立链路。远端仅返回路径且没有可用本机图片时明确提示，未接入自动下载或假定路径等价。服务替换通过真实批准的合成宿主插件进入实际 IPC 并验证停用恢复。

以已提交基线 `a251fa4` 加本轮限定差异构建独立候选：TypeScript、生产 renderer/main/preload 构建、公开文档检查与插件契约门禁通过。附件、原生事件与生图定向测试 **51/51**；隐藏隔离 Electron 预览/附件交互 **19/19**、既有媒体交互 **9/9**、完整应用及批准插件启停 **15/15**、生成图片回归 **8/8**、看图日志交互 **7/7**，零 renderer errors。已检查浅深色、宽窄窗口、小截图、长文件名、大字号标注及菜单截图。验证包含原图字节导出、原尺寸像素复制适配、标注 PNG、拖动/翻页、加载失败和停用恢复；系统剪贴板、默认应用和文件定位使用观测适配器，未宣称第三方应用粘贴或打开已实测。

插件审查覆盖调用、注册与替换三条路径：新增三个宿主命令、`media.addToDraft`、`media.registerAttachmentAction`、六个具名 surface 和 `images.viewed` 服务；实际注册目录进入四类菜单，已挂载与后续草稿实例均可扩展，停用/重新启用恢复。单测覆盖多插件覆盖顺序、非后进先出释放、注册失败清理和迟到句柄拒绝；真实批准激活的合成 ZIP 插件验证委托核心命令、动态挂载和开放菜单移除项。无新增持久选项目录，材质沿用主题和可覆盖变量；稳定声明与命令清单更新契约快照。要求与公开扩展契约同步 `requirements.json`、文档 36，依赖证据同步文档 07。

证据位于忽略目录 `build/qa/image-viewer-20260930`；只使用合成附件和隔离应用数据。未操作活动客户端、替换正式构建、调用模型、推送或部署。其他窗口未提交改动未混入候选与通过范围；源码与隐藏渲染验收不代表当前生产窗口已更新。
<!-- image-viewer-glass:end -->


<!-- theme-presets:start -->
## 浅深色主题模板、代码高亮与插件注册（2026-09-29 UTC；U117）

已实现十二套原创预设：浅色晨纸、瓷白、海盐、青苔、鸢尾、麦芽，深色炭墨、石墨、深海、松夜、暮紫、余烬。模式内展示配色缩略图；浅深色各自保存选择，跟随系统时使用对应预设。切换模板保留独立界面/正文/代码字体和字号，恢复该模板强调色。旧暖灰/中性配置兼容迁移；主题 ID、修订和既有外观配置持久化到同一状态存储。

外观代码预览支持 TypeScript、Python、JSON 切换并显示关键词、字符串、数字、注释等颜色；回复里的代码块共用源码保真的轻量词法着色，已挂载 Monaco 保留自己的解析器并同步配套主题。代码字体与字号独立使用，修改正文或界面字体不覆盖。未知语言、超限或扩展返回异常时保留原文，不执行或解释代码中的 HTML。

新增 renderer `api.themes.register/list/subscribe`，主题可由插件注册进入真实选择器；`api.syntax.highlight/register/subscribe` 可扩展或替换代码着色。注册命名隔离、颜色校验、目录通知与自动清理均贯通。停用或失败释放模板/语法扩展，暂时回退内置主题并保留所选 ID，重新启用恢复。示例仅位于 `examples/plugins/theme-studio`，未预装到用户环境；完整参数、错误、权限、生命周期、迁移与覆盖矩阵见文档 36。

以 `49229d7` 加限定差异冻结验收：TypeScript、生产参数 renderer/main/preload 构建通过；全仓单元/协议 **1,231/1,231**，零跳过，外观定向 **18/18**。内置模板正文/背景对比至少 7:1、弱文字及全部代码颜色/代码背景至少 4.5:1；这些颜色对的数值检查不代表整个产品已经完成无障碍认证。公开文档检查通过；插件契约门禁覆盖 64 个声明与 258 个宿主入口。

隐藏独立 Electron **22/22**、零 renderer errors：逐一应用十二模板，验证浅深色独立保存/重载、系统切换、三种语法实际颜色、独立代码字体、回复代码与已挂载 Monaco 更新。使用真实 ZIP 插件注册器验证未批准拒绝、批准后进入选择器、重载、停用、重新启用、失效 API 拒绝、激活失败清理及注册通知同步失败的回收。检查浅深色完整页、配色画廊、代码预览和窄窗截图；没有把 CSS 字符串检查冒充实际界面。

证据位于忽略目录 `build/qa/theme-presets-20260929`，冻结快照排除其他窗口未完成改动。不读取真实账户/聊天数据库，不操作正在使用的客户端，不覆盖正式 dist、推送或部署；本次结果是源码、独立配置与隐藏桌面验收。
<!-- theme-presets:end -->

<!-- plugin-followup:start -->
## 紧凑主题选择与近期插件适配复核（2026-09-29 UTC）

按用户提供的界面参考，移除常驻展开的预设网格，改为“主题”单行选择器及内置/插件分组子菜单。保留十二套颜色、独立代码字体、语法高亮、浅深色选择和缺失主题回退。详见文档 36 的后续修订；历史“图库”描述保留为原实现记录，不代表当前布局。

核查 `42daed7` 至 `43d4165` 的 12 个已提交变更，补齐字体贡献目录到三个选择器和实际排版、八个具名局部挂载点，以及契约门禁遗漏的公开常量和近期数据类型。新批准 ZIP 回归覆盖真实宿主服务、选择器、停用/重新启用和失败清理。审计矩阵见 [近期功能插件适配审计](plugin-feature-audit-20260929.md)；AGENTS.md 增加逐次调整的强制前置分析和完成门槛。

本轮只维护源码与隔离验收候选，不覆盖生产 dist、不操作当前客户端、不推送或部署，不读取真实账号凭据、私钥及聊天数据库。其他窗口未提交功能不纳入本轮完成结论。
验证结果（隔离候选基于 `503935f`，未纳入其他窗口未提交代码）：完整单元/协议测试 **1243/1243**，零跳过；外观隐藏 Electron **24/24**，零 renderer errors；真实连接布局/文件生命周期 **4/4**。TypeScript、生产参数构建、插件契约门禁（98 个声明、259 个宿主方法）和文档检查（43 个文本文件）通过。浅色收起状态、深色菜单和窄窗子菜单已目视检查；键盘回归覆盖重复打开后自动聚焦与返回。输出位于忽略目录 `build/qa/plugin-followup-20260929/`，不是公开发行附件。构建仍有原有大 chunk 提示，没有把它当作构建失败或额外优化范围。

<!-- plugin-followup:end -->

<!-- system-mode-icon:start -->
## 系统模式图标的分割修复（2026-09-29 UTC）

已复现外观页“跟随系统”缩略图的视觉缺陷：整体背景与小侧栏分别使用斜向渐变，形成额外黑色楔形；浅色全局旧规则还会覆盖局部修正。改为统一左右明暗分割、浅色侧栏，并降低旧默认规则优先级。仅修改样式，模式按钮结构、选择逻辑、字体与主题菜单不变。

新增实际截图像素验证，修复前明确捕获浅色区域的黑色楔形。覆盖浅深色环境与 100%/125%/150% 缩放，并复验批准插件调用 `theme/set`、样式停用及重新启用；开发契约影响与不适用范围同步文档 36。

最终隔离候选基于 `a66b633`（已在更新后的集成基础重新验证）：隐藏 Electron 外观检查 **26/26**、零 renderer errors；六种缩放/模式组合的截图已目视核对。TypeScript、插件契约门禁（114 个声明、262 个宿主方法）及公开文档检查（43 个文本文件）通过。未重复全仓单元/协议或真实模型验收，本次通过范围为样式修复与受影响外观/插件行为；验收 renderer 构建仍有既有大 chunk 提示。

证据保存在忽略目录 `build/qa/theme-mode-icon-20260930/`，使用独立隐藏 Electron 和临时配置；未操作在用客户端、覆盖正式 dist、连接 VPS 或调用模型，其他窗口的图片/附件改动不纳入本次提交。
<!-- system-mode-icon:end -->

<!-- system-mode-diagonal:start -->
## 系统模式图标恢复单一斜切（2026-09-29 UTC）

用户明确选择保留斜切，故将系统模式缩略图的背景恢复为 110° 分割，保留已修正的浅色实体侧栏与旧规则优先级。斜切本身不是缺陷，原问题是侧栏重复绘制产生额外黑色楔形；上一节的垂直分割不再是当前设计。按钮、选择策略、主题菜单、字体及配置均未改动。

像素回归改为检查单条倾斜分界、每条空白扫描行只有一次明暗转换，继续检查侧栏、六种模式/缩放组合和批准插件生命周期。接口审查记录同步文档 36；仅使用隔离隐藏 Electron 和临时配置，不覆盖正在运行的客户端或正式构建。

基于 `8f931de` 的隔离候选：隐藏 Electron 外观检查 **26/26**、零 renderer errors；六种明暗/缩放截图已核对。TypeScript、插件契约门禁（114 个声明、262 个宿主方法）和公开文档检查（43 个文本文件）通过。证据位于忽略目录 `build/qa/theme-mode-diagonal-20260929/`；本轮未重复全仓单元/协议测试，不包含其他窗口未提交的功能。
<!-- system-mode-diagonal:end -->

<!-- session-feedback-following-20260930:start -->
## 缓存百分比、跟随计时与中断历史（2026-09-30 JST）

- 已实现：命中率按同条已知用量记录的缓存读取总和 / 输入总和计算；部分回执缺字段不再隐藏已知命中率。会话、运行时/模型分组及模型用量页使用同一函数，输出与缓存写入不计命中，未知不补零。
- 已实现：仅运行中将计时固定在输入区上方；长输出、滚轮和查看旧历史不移动它、不强制用户回到输出底部。正常完成后在最终回复前折叠过程；已恢复的失败尝试不阻止正常折叠，未结束事项仍可展开。
- 后续明确修订已实现：停止/失败后耗时回到本回合末尾，保留中断前正文、公开错误和已完成的文件修改卡片；不把失败当成正常总结。下一次明确发送新建时钟，旧错误和耗时留在历史，不占固定位置。结果未知不伪造结束时刻，准入阶段无消息的失败仍可见。
- 插件接口先审范围：session/metrics、models/usage、state/onState、RuntimeEvent usage、TurnTiming、ReadingTurn、renderer surface 及文件卡片保留路径。具名计时/过程/错误/用量入口覆盖真实生产组件，并通过批准 ZIP 激活、多个动态实例、多插件共存、停用恢复和失败清理验证。完整契约、迁移和不适用维度见文档 36 本日条目。
- 验证：定向单元/协议 97/97；隐藏 Electron 用量、计时、紧凑浮层及跟随回归均通过，零 renderer errors；类型、插件契约和公开文档检查通过。检查了正常完成、停止/失败、浅深主题与窄屏截图。源码和合成 UI 验证不替代真实商业模型、现有活动客户端或远端验收。

证据保存在忽略目录 build/qa/session-feedback-following、build/qa/session-feedback、build/qa/session-metrics 与本轮隔离构建目录；没有新文档文件。未改变现有模型进程、原生配置和外部服务，未推送或部署，未将其他窗口的主题/文档整理改动纳入本次提交。
<!-- session-feedback-following-20260930:end -->


<!-- structured-memory-citations:start -->
## 记忆引用图标漏接修复（2026-09-29 UTC；U96）

已复现并修复：Codex app-server 会把引用从 agentMessage.text 拆到独立 memoryCitation 字段。此前本机接收器没有保存该字段，SSH 接收器只解析正文标签；于是实际有引用的回复也可能没有底部图标。两条路径现统一解析结构化条目并保存到已有 Message.memoryReferences；旧标签兼容、空缓存回退、Claude 本轮读取和无证据不展示保持原规则。图标位于完成回复的底部操作行，悬停/键盘聚焦显示来源说明与路径。

插件审查同步文档 36：新增具名 reply-memory 多实例 surface，保留旧定位；修复核心图标样式覆盖 hidden 导致替换层不能隐藏图标的问题，以及工具栏半透明影响浮层路径可读的问题。无需新增设置或硬编码运行时分支；合成注册运行时经过真实选择器、执行器和末端显示，整包批准的视图插件覆盖现有/后来实例、叠加、异步清理、失败与停用恢复。

最终验收使用 a16898d 加本次 12 个文件的独立冻结候选，排除其他窗口未提交修改：定向单元/协议回归 63/63、TypeScript、check:plugins（125 项声明、262 个入口）和 check:docs（43 份文本、0 项发现）通过。实际 codex-cli 0.155.1 配合本机合成上游及隐藏 Electron 7/7 检查通过，renderer errors 为零；共 3 个合成请求、0 次真实模型调用。人工检查浅深色及窄窗图标与浮层，完成两条同屏引用、多插件叠加、动态实例、异步迟到、失败及停用/重新启用/包移除验证。没有新增仅核心可用的选项名单；契约快照差异仅新增具名 surface。构建仍有既有字体协议的构建时解析提示及大分包提示，运行期引用显示检查通过。证据目录 build/qa/memory-citations-20260930；源码、安装版 CLI 配合本机合成响应、隐藏桌面、真实模型与远端验收分开计量。没有读取真实聊天库或凭据、操作活动客户端、替换正式构建、推送或部署。截图对应的旧历史没有逐条读取；已丢失且无法从原文恢复的元数据不补造，修复不等于这些旧回复已经回填。
<!-- structured-memory-citations:end -->

<!-- titlebar-theme-sync:start -->
## 顶部导航栏的浅深主题联动（2026-09-29 UTC）

已定位浅色模式顶部导航栏没有跟随预设的原因：浅色底色被写死，暗色才读取主题变量，原生窗口按钮还使用另一组固定颜色。顶部栏现在统一读取 `side/muted/hover/text`；Windows 原生按钮接收实际渲染后的不透明颜色，保留原有高度、缩放、菜单及侧栏交互。紧凑选择器、110° 斜切系统图标和字体设置不变。

插件适配沿用生产主题目录与具名 titlebar surface，补充 `desktop/titlebar` 及宿主服务方法，修复替换层不能隐藏核心栏的问题。公开契约、示例、生命周期、权限、错误、快照增量及不适用范围同步文档 36。验证使用隔离配置和隐藏 Electron，正式构建与当前活动客户端不变；不调用真实模型、不访问远端，其他窗口未提交快捷键/文档修改不纳入本轮提交或验收。

最终基于 cab83da 的冻结候选通过：定向单元/协议及契约测试 18/18、隐藏 Electron 外观回归 33/33、零 renderer errors；TypeScript、插件契约门禁（126 项声明、263 个宿主入口）、公开文档检查（43 份文本、零发现）及生产参数构建通过。青苔、海盐、暮紫截图已目视检查；原生 overlay 记录来自实际 setter 成功调用，隐藏截图不包含 OS 非客户区的逐像素证明。悬停样式通过 Chromium 伪状态检查，菜单/历史/侧栏以键盘验证；未操作在用客户端或验证 Windows 鼠标命中。初次合并测试暴露了用例间字体菜单残留和异步样式取值问题，已隔离瞬时状态并等待实际渲染结果后完成全部回归。

证据保存于忽略目录 build/qa/titlebar-theme-20260930/。构建保留已有字体协议解析和大分包提示；没有覆盖正式 dist、推送或部署。提交仅包含本轮配色同步、其验证和文档增量。
<!-- titlebar-theme-sync:end -->

<!-- project-preview-folder-open:start -->
## 项目悬停文件夹单击打开（2026-09-29 UTC；U2）

核实现有项目概览已提供项目名、会话计数、目录列表、置顶和编辑，但目录行仅为文字。现将每条目录改为可点击按钮，复用已有 path/open 与实际本机打开服务；悬停/键盘聚焦时显示高亮和右上箭头，Enter/Space 可打开对应目录，支持多个路径、长路径换行、无目录提示和明确错误后重试。等待期间阻止重复请求并保留焦点，既有目录成员/目录类型验证不变。清理重复关闭计时器；插件替换聚焦行时保持仍被鼠标悬停的卡片，动态内容缩小不把浮层移离指针。

插件先审与交付：沿用 path/open、state/get/onState、workbench.actions.openPath，新增 project-preview/project-folder 具名多实例挂载点及稳定项目 ID/路径元数据；真实批准 ZIP 验证第三方调用、注册局部视图、覆盖宿主打开方法、多层替换、动态目录、异步清理、失败与停用/重启用恢复。契约快照只增两项 surface；原内部 div 选择器迁移说明与权限/不适用维度同步文档 36。没有新增核心专用分支、选项目录或持久格式。

验收使用 d604c59 加本次文件构成的冻结候选，排除其他窗口未提交修改：定向单元/接口 20/20，隐藏 Electron 专项 9/9、零 renderer errors；TypeScript、check:plugins 和 check:docs 通过。人工核对浅色、深色窄窗和插件停用恢复截图。OS shell 在测试边界记录路径，真实项目 IPC、目录验证与插件批准生命周期均实际执行；没有打开用户资源管理器、调用模型、读取真实聊天/凭据、连接远端、操作在用客户端或覆盖正式 dist。包移除通用恢复沿用已有验收，不把本次停用测试称为卸载测试；未重复全仓模型/协议回归。

证据位于忽略目录 build/qa/project-preview-work/acceptance-final，脚本为 scripts/test-project-preview-ui.mjs；保留既有字体协议构建时解析与大 chunk 提示。没有新增公开文档文件；本轮仅本地提交，不推送或部署。
<!-- project-preview-folder-open:end -->

<!-- account-export-status:start -->
## 账号额度卡片与单账号导出（2026-09-29 UTC；U5、U115）

卡片改为主题同色的透明底、轻边框及细分隔线；5h／周额度突出剩余百分比，工作台统计去掉深色嵌套块，保持实际额度、未知态、倒计时、折叠与用量来源语义。账号右上角新增导出图标，打开弹窗，格式仅官方（默认）、sub2api、cpa，支持脱敏预览、明确显示／隐藏、复制和下载 JSON。重新打开恢复官方默认，失败／取消有独立反馈。

复制和保存由宿主消费完整凭据；未将内容放入常规状态、事件或模型上下文。仅访问用户指定账号的独立原生文件，不读取默认客户端目录／钥匙串、不刷新令牌、不调用登录端点。不兼容格式明确拒绝。插件格式注册、单格式分层替换、四个具名局部多实例挂载点已贯通生产目录、选择器、执行及释放；无签名／持久格式破坏，细节、矩阵与来源见文档 36、07。

最终独立候选基于 9648aee，仅叠加本轮限定改动：TypeScript、npm run check:plugins（147 个声明／270 个入口）、npm run check:docs（43 份文档／零问题）以及生产参数 renderer／main／preload 构建通过。导出、既有账号／额度／选择和插件回归 55/55，零跳过；隐藏独立 Electron 9/9，零 renderer errors，已检查浅色、深色和 460px 窄窗截图。真实合成 ZIP 覆盖批准、激活、新格式进入真实选择器和执行器、现有／后来新增 surface、停用、重新启用与恢复；8 项导出专项包含包移除、注册失败、多层共存及迟到结果拒绝。首轮 UI 测试发现预览把 sub2api-data 格式标签也脱敏，修正为固定公开标签白名单后通过；文档首次检查发现总入口目录漏登记，补齐四项后通过。并行未提交改动不纳入本轮完成范围。

全部资料位于忽略目录 build/qa/account-export；只使用合成账号／凭据和临时用户资料，不修改活动客户端、真实剪贴板、正式 dist、远端或消费者服务。不以合成输出声称真实 sub2api／cpa 导入、官方登录或模型任务已验收。未推送、发布或部署。
<!-- account-export-status:end -->

<!-- codex-account-access-status:start -->
## Codex 接入修复与本机/SSH 共用账号卡片（2026-09-29 UTC；U5、U115）

已修正两个独立问题：Codex app-server 返回授权链接后宿主没有自动打开；主进程只允许设备页导致正常 OAuth 链接也被拒绝。现在支持官方桌面端、OAuth、设备码三选一，缺少桌面安装时禁用对应入口。OAuth 有链接/复制/打开按钮及手动回调；回调绑定本次原生 state/redirect，端口冲突拒绝并提示设备码。Claude 订阅、SSO、Console 原生路径保持独立。

新增 Codex Token/JSON 接入，支持 auth.json、Agent Identity、账号 JSON/数组、Sub2API、CPA、accessToken、at-…、refresh_token；限制大小/条数，验证整批形状与重复，既有文件不覆盖，refresh-only 无自动重试，已轮换结果不回滚。导入结果先核实原生身份及模型目录；解析成功不等于账号有效。

添加账号直接进入接入弹窗，不再填写名称；新的卡片只在 authenticated、模型目录及邮箱核实后持久化，默认完整邮箱。标题可改名，展开邮箱只读并提供局部小眼睛；眼睛不影响标题或会话账号名称。AccountCard 供本机与 SSH 两家账号共用，SSH 别名仅保存在本机并绑定原生代际，远端登录流程没有合并或部署修改。旧插件 create 接口兼容保留，新增 UI 使用临时 prepare。

验证：账号协议/状态/选择/执行回归以及新格式、回调端口与取消竞态测试通过；隐藏独立 Electron 验证无名称阶段、无提前建卡、OAuth 回调、设备取消、邮箱/改名语义、真实批准 ZIP 的登录/导入选项进入生产路径、多实例 surface 停用恢复及明暗窄屏。既有模型管理桌面回归通过。最终限定提交树基于 18d49c4 通过 TypeScript、npm run check:plugins（170 个声明/278 个宿主入口）及 npm run check:docs（43 份文档、零问题）。相关协议与插件回归 77/77；初次限定候选的生产构建通过；接入专项隐藏 Electron 6/6、既有模型管理界面 12/12，均无 renderer errors，已查看浅色、深色和窄窗截图。旧管理整套脚本仍停在已移除的 studio-ssh-only 前置定位，未声称整套通过；限定账号区的四项额度/重置/Claude 管理交互及邮箱窄窗检查另行通过，夹具明确排除无关壳层服务。其他窗口改动不纳入本轮验收。

真实原生探测使用 Codex 0.155.1 与新建目录：OAuth 打开 OpenAI 登录页；设备码签发成功且浏览器可打开（页面遇到站点验证）；Windows 官方客户端可独立启动/取消，取消后未生成卡片。三种路径均未完成真实账号授权，也未调用真实模型或读取现有凭据；不能宣称真实账号登录/导入消费者已验收。资料仅留在忽略目录 build/qa/codex-account-repair、account-access-ui、model-management；未推送、发布或部署。插件契约、覆盖矩阵、错误及迁移见文档 36；来源和许可证见文档 07。
<!-- codex-account-access-status:end -->


<!-- file-review-capsule-20260930:start -->
## 运行中文件胶囊与差异审查（2026-09-30 JST）

运行中在输入区上方同一固定行显示左侧计时和居中文件胶囊，窄窗压缩辅助文字以避让；点击展开当前回合文件列表，选文件进入共享的右侧差异审查面板。完成或中断后恢复历史文件卡片；中断前已确认修改继续可看，新的显式回合重新计时和统计。原生同一 turn 的 steering 不重复显示多个胶囊，正在查看的差异不会因停止而关闭。

详情使用既有右侧阅读器位置及可调分隔条，与文件、计划和子会话互斥。占位期间对话采用原文/译文上下排列，关闭恢复用户原有布局及配对追踪，保留未发送草稿；没有详情弹窗或遮罩。审查器加入文件筛选、逐次补丁、原生 hunk 行号、合并/并排模式；窄区域自动暂用合并，放宽恢复。缺补丁/未知行数/截断如实说明。保留文件打开和上下文菜单。统计为本轮已确认操作累计，不是 Git 净差异；没有加入撤销、写回或自动模型代码审查。Claude Desktop 的官方文档与安装包静态参考边界见文档 07。

接口审查与开发者入口同步文档 36：生产组件登记 api.fileChanges 的目标/记录/动作，具名视图目录贯通选择器与执行器，六个具名 surface 支持细粒度替换及恢复；无新运行时硬编码、持久配置或权限。

基于 3507070 的本次隔离候选通过定向单元/协议测试 105/105、隐藏 Electron 文件审查专项 16/16、计时回归 14/14 和翻译布局/追踪回归 10/10，renderer errors 为零；typecheck、check:plugins（158 项声明、270 个宿主入口）、check:docs（43 份公开文本、零发现）及 renderer/main/preload 生产构建通过。已目视核对胶囊浮层、右侧合并/并排差异、深色窄窗及翻译上下排列截图；真实批准 ZIP 贯通调用和视图注册、动态多实例、多插件共存、失败清理、异步迟到、停用/重新启用和包移除恢复。初次 UI 用例暴露了隐藏锚点后浮层关闭以及插件停用异步完成的等待边界，已按实际生命周期核验并通过。保留既有字体协议构建时解析与分包体积提示。验收资料在忽略目录 build/qa/file-review-ui 与 build/qa/file-review-work；不包含其他窗口未提交代码，不操作活动客户端、真实模型或远端，不推送或部署。
<!-- file-review-capsule-20260930:end -->

<!-- account-export-filenames-status:start -->
## 账号导出文件名包含邮箱（2026-09-29 UTC；U115）

内置官方／sub2api／cpa 下载建议名统一为 邮箱-codex/claude-格式.json，预览和原生保存窗口一致。缺少邮箱时读取同一已授权凭据对象的邮箱元数据，再回退账号名及短 ID；支持邮箱 +、中文名称，清理非法字符、Windows 保留名及过长前缀。仅改下载建议名，JSON 内容和原生资料存储名不变；没有改登录、导入、账号状态或卡片布局。

文档 36 同步先行接口审查、功能覆盖矩阵、兼容语义和调用／注册／替换路径。沿用 models.account-export 的生产格式目录、serialize 返回名和 overrideFormat 清理机制；旧插件自定义名不被内置模板覆盖。公开类型、事件和 surface 均无变化，契约快照无需刷新；没有新增核心专用选项或持久配置。

验收采用 3ac1d7c 加本次六个文件的冻结候选，排除其他窗口未提交与已暂存工作：导出专项 11/11、隐藏独立 Electron 9/9、零 renderer errors；TypeScript、check:plugins（147 个声明／270 个入口）及 check:docs（43 份公开文本／零发现）通过。实际批准 ZIP 贯通注册、自有文件名、生产调用、现有／后来实例、停用／重新启用及包移除；人工检查浅色与 460px 长邮箱截图。首轮测试发现 sub2api 导出时间随每次序列化更新，断言按既有行为排除时间差后核验其余 JSON 相同。没有修改产品渲染器／CSS，也未刷新并行窗口的契约快照。

证据位于忽略目录 build/qa/account-export-names；仅使用合成账号、凭据、保存窗口替身和临时用户资料，保留既有字体协议构建提示。未操作活动客户端、真实剪贴板／账号、模型、远端或真实消费者服务；不以本次命名与隐藏桌面验证声称真实消费者导入通过。本轮只作范围独立的本地提交，不推送、发布或部署。
<!-- account-export-filenames-status:end -->

<!-- account-export-label-status:start -->
## 官方导出格式标签补全（2026-09-29 UTC；U115）

仅将导出弹窗下拉框的“官方”改为“官方auth.json”，继续默认选择 official；邮箱命名、下载内容及账号流程不变。插件先行审查、生产目录到选择器的接线、注册／替换／释放及兼容说明同步文档 36。基于 dd52102 的五文件独立候选通过导出测试 11/11、隐藏 Electron 界面检查 9/9、零 renderer errors，以及 typecheck、check:plugins、check:docs；已核对窄窗显示。复用真实批准 ZIP 生命周期验证，全部使用合成资料与隔离目录；其他窗口的未提交及暂存修改未纳入本次验证或提交。证据位于 build/qa/account-export-label，未操作活动客户端、真实账号或远端。
<!-- account-export-label-status:end -->


<!-- native-event-audit:start -->
## 原生事件接收与未知事件审计（2026-09-29 UTC；U107/U108）

两家适配器已有常见消息/工具/压缩/交互路径，但此前未知非公开事件可能直接被展示过滤器丢弃。新增独立、有界的元数据账本与可见兼容提示，覆盖顶层通知/请求及嵌套项、内容、增量和结局类型；保留隐私边界，不把未知结果当成功，不自动审批、重发或切换账号。补接 Codex patchUpdated、警告、MCP 启动与自动审查状态，以及 Claude 通知、权限拒绝、后台任务 patch 等公开事件。正式插件 presenter 进入生产 observer，停用/失败恢复核心。

目录识别与完整能力支持分开记账；实时音频、外部认证/证明、部分高级审批 schema 和 SDK 专属模式仍有明确边界。当前实现、升级清单、测试位置与最终证据见 [原生事件审计](native-event-audit-20260929.md)。本地改动不代表 VPS 部署、真实账号模型任务或全部未来事件语义已验证。

2026-09-30 补充修复：已识别 command_lifecycle/requesting、完整后台快照和当前原生输出的九个补充 system 事件；已知元数据按语义记账，启动/MCP/配置/兼容性提示默认收进折叠运行记录，未知事件可复制适配诊断。两家连续已完成工具和编辑共用分组，子会话阅读器同样消费。前台结果、后台存活与未知结果分开；TaskStop、前台 Agent 结果、晚到进度均覆盖。停止后台任务不再将成功主回合改为 interrupted；历史已完成 timing 不因后续全局 stop 标记移位。旧 unknown 记录只重分类，不伪造历史结果。

本轮独立候选验证：全仓 1,353/1,353，类型检查、check:plugins、check:docs 均通过（197 项公开声明、279 个宿主方法、44 份文档）；详细门禁结果见原生事件审计；真实安装 Codex 0.155.1 / Claude 2.1.284、隔离 home / 合成回环上游的后台生命周期 4/4；真实批准插件/隐藏 Electron 事件与分组 UI 12/12，零 renderer 异常，明暗与窄窗截图已复核。源码与协议/合成 CLI/隐藏 UI 为各自证据层级，没有真实付费模型任务、用户会话数据库读取、活动用户客户端操作或 VPS 部署。其他窗口未提交文档调整未纳入候选。
<!-- native-event-audit:end -->

<!-- session-native-preview:start -->
## 原生标题接收与首条消息悬停（2026-09-29 UTC）

按最新用户澄清，只消费实际运行时标题；没有原生 name 时继续首条输入截取，不创建标题工具、额外总结回合或命名系统提示。Codex 本地与 SSH 消费实际根线程 name/name-updated；插件运行时可交付同一有生命周期检查的 title 事件。手动、未知来源旧标题、分支及显式命名任务受保护。列表和卡片标题保留实际语言，不能从英文/中文外观推断是否有总结。

悬停卡在现有标题、项目、时间和状态下加入首条用户消息。已有有效译文优先，否则保存的用户原稿，再回退实际 submitted 文本；不会为悬停发起翻译。初始最多 180 码点、三行；移入或右方向键展开到最多 1,200 码点，有限高滚动、Escape 回焦和窗口边界定位可用，不改变原消息。

接口审查与覆盖矩阵、错误、权限、兼容和示例同步写入文档 36；新增 session/preview、生产 sessions.presentation 服务、原生 title 事件和两个具名 surface。真实批准/激活的合成插件验证生产消费路径、动态实例、多插件、失败清理、停用/重启用和迟到结果；不是通用 Node 权限或文档代替证明。

隔离候选验证：33 项针对性协议/单元及既有运行时回归、8 项隐藏 Electron 检查与 31 项侧栏 UI 回归通过，类型、插件契约及文档检查通过；人工复核浅色折叠/展开及深色窄窗。合成源和结果保存在已忽略 QA 目录，不提交截图、聊天记录或安装示例。没有真实模型、远端连接/部署、其他活动客户端或未提交并行修改的验收声明。
<!-- session-native-preview:end -->

<!-- session-hover-repair:start -->
## 会话悬停可靠性与鼠标题目编辑（2026-09-30）

修复前在隔离桌面重现：快捷按钮回到标题不重新触发、正文滚动误关闭、点击当前悬停行误关闭、过早按 ArrowRight 无效、聚焦浮层后移出鼠标仍关闭。另补路径检查，确认鼠标经过快捷按钮时会立即销毁预览；现改为停留后才切换小提示，允许直接移入标题。

有焦点的会话行现在可用 ArrowRight 立即打开并聚焦，卡片持有焦点时可移开鼠标；该键不是全局固定开关。鼠标移入可展开正文，直接点击标题进入行内改名，保存/取消按钮及 Enter/Escape 可用。输入法确认、150 字符上限、空值、保存错误、迟到结果与手动标题保护均有行为覆盖。不为改名或悬停生成模型请求。

隔离候选的 18 项新增隐藏桌面检查通过；兼容验证包括 8 项既有预览检查、31 项侧栏检查和 55 项协议/单元/插件/排序检查。新 title surface 经真实批准激活插件验证生产调用、动态实例、异步释放、多插件、挂载失败、停用重启用与包移除恢复；浅色及深色窄窗人工复核。接口、错误/权限、兼容迁移和测试入口见文档 36，原生标题证据边界见文档 07。类型、插件契约和公开文档门禁纳入本次提交检查；不包含其他窗口未提交修改的验收，不声明真实模型自动命名或远端部署通过。
<!-- session-hover-repair:end -->


### 2026-09-30：上下文环零值回执修复（U57）

隔离的真实 Claude Code 进程已复现：合成上游上报输入 80,000、输出 100、缓存读取 78,000；assistant 提前上报 0/0，随后 message_delta 才携带完整用量。旧实现仅消费 assistant，导致底栏有累计统计而圆环显示零。现合并单消息原生流用量，新记录保留回合身份，并从同一线程/模型/回合的最新完整请求恢复旧零值显示；不把累计 token 当作上下文。缓存不重复计入，压缩和显式零值受保护。

验证：tests/context-usage.test.ts 覆盖时序、部分计数、重复回执、子流、未知值、压缩、旧记录及来源隔离；scripts/test-context-usage-native.mjs 使用真实 Claude/Codex、临时原生目录、合成流式/JSON 上游及真实批准 ZIP 插件生命周期；scripts/test-context-usage-ui.mjs 在隐藏 Electron 检查实际圆环的 8%、80,100/1,000,000、独立原生预算、未知/显式零值和深浅/窄屏显示。公开接口与插件覆盖审查见文档 36 的同日修复记录。

本次独立提交快照通过 typecheck、check:plugins、check:docs、97 项针对性回归、8 组真实 CLI/插件生命周期场景、19 组原生压缩场景和 5 项隐藏 Electron 检查；深色及窄屏截图已人工查看。本次未修改或重启正在使用的客户端，未读取用户聊天库、发起真实上游推理或部署远端；源码修复不等于运行中应用已更新。仓库其他并行未提交工作不属于此修复的通过范围。

<!-- claude-native-title:start -->
## Claude 已有原生标题适配（2026-09-30）

本机 Claude 会话现可在原生初始化、回合完成/进程清理及打开预览时，按绑定 UUID、项目目录和实际账号配置根同步明确的 native customTitle/aiTitle。列表与悬停卡保留原始语言；没有可靠原生标题继续已有首条输入截取。手动、未知来源旧标题、分支和子会话受保护。相同文本从 fallback 升级 native 来源，防止后续 fallback 覆盖。

读取只限已绑定本机会话的有界 metadata/sidecar，不枚举原生会话目录、不输出消息正文、不写回原生名称，不新增 SDK、命名模型请求、提示或重试循环。读取超时 1,500ms，插件释放、绑定改变和 shutdown 后的迟到结果均丢弃；SSH、未知原生目录布局或没有落盘标题仍回退。无法据此保证 print/stream-json 每次自动产出标题。

公开 `session/native-title/refresh` 与生产 `sessions.native-titles.read` 支持调用、拦截及分层替换；新运行时沿用原有 title 事件。文档 36 同步接口先审、覆盖矩阵、类型/错误/权限、生命周期、示例和兼容边界，契约快照仅增加本轮 route/声明。原生格式依据、官方 helper 合成交叉验证与许可证核查见文档 07。

隔离候选的针对性协议/单元/插件/模型档位回归 49/49 通过；其中 10 项原生标题测试覆盖大文件、半写入、窗口边界、精确身份、账号隔离、sidecar 与标题来源升级，实际 runner 合成官方账号路径确认仅一条原始用户 turn 并持久化标题。隐藏 Electron 原生标题专项 6/6 通过，零 renderer errors，已复核实际标题截图；真实导入、完整批准并激活的合成插件覆盖生产入口、后续实例、多插件、失败清理、停用重启用及包删除恢复。合并已提交的原生事件修复后，限定候选基于 4936bd4 通过扩展回归 54/54（含 5 项真实 runner 事件路由），原生标题专项 6/6 和既有预览 8/8 再次通过；TypeScript、check:plugins（201 项声明、280 个宿主入口）、check:docs（44 份公开文本、零问题）通过。悬停专项 18/18 在同一新基线上再次通过。保留现有字体协议和构建分包体积提示。

材料在忽略目录 `build/qa/claude-native-title`；全部使用虚构身份、临时原生文件、合成传输和独立隐藏应用。没有真实模型、用户聊天库、活动客户端操作或远端部署；其他窗口未提交改动不在本轮验收声明内。仅创建本地提交，不推送发布。
<!-- claude-native-title:end -->


<!-- file-navigation-resolution-status-20260930:start -->
## 文件链接定位与候选恢复（2026-09-30 JST）

修复已高亮短文件名只与会话根目录拼接，导致实际位于子目录的文件在预览和资源管理器菜单中均失败的问题。所有本机文件动作共用定位器，利用已加载结构化路径、项目多文件夹及有界目录发现；明确绝对/点号相对路径保持严格语义。同名歧义或发现未完成时，reader 和右键菜单显示已核验完整路径供用户选择，不将第一项或部分结果当唯一结果。切换文件清理旧内容，操作使用确认后的同一规范路径。

同时修复行内代码误按 URL 解码、file URI 重复解码、复制 Markdown 链接不编码百分号/井号、中文裸路径及标点边界、相对目录与常见文件名字符、行号范围及文档片段识别。UNC、非本机路径与执行协议仍拒绝，fenced code 保持字面内容。高亮只证明识别到路径语法；失效文件、发现限额和重复文件有明确结果，不承诺全部目录都能自动唯一定位。

先行接口审查、覆盖矩阵、类型、错误/权限、事件、生命周期、兼容和迁移已同步文档 36；新增 files/resolve、生产 files.navigation 来源注册与四个具名 surface，旧文件动作参数及 API v1 保持。契约快照按新增声明和 surface 审阅。新候选状态为单次导航，不新增持久用户偏好；未改变既有分隔条、标签和阅读模式的存储约定。没有仅供核心使用的新定位分支或运行时选项名单。

验证范围：以 b8a7901 的已提交树加本次限定文件构建独立候选，排除其他窗口未提交工作。定向单元/接口/插件回归 43/43；隐藏独立生产 Electron 专项 9/9，以及原文/译文/子会话链接回归 9/9，renderer errors 为零；TypeScript、check:plugins（223 项声明、282 个宿主入口）和 check:docs（44 份公开文本、零发现）通过。renderer/main/preload 构建通过，保留既有字体协议构建时解析及大 chunk 提示。人工检查浅色候选、深色窄文件面板和恢复后的真实 Monaco 预览。真实批准 ZIP 贯通生产调用、来源注册、多插件、动态多实例、细粒度替换、失败清理、异步迟到、停用/重新启用及包移除恢复。

本机问题目录另做文件元数据核验，确认根目录拼接错误及有界发现可以返回实际嵌套文件；未读取真实聊天、凭据或文件正文。自动化中的打开/资源管理器由 OS shell 边界记录规范路径，不能称为真实资源管理器前台验收。未执行真实模型或远端任务，也未改动活动客户端、覆盖正式 dist 或部署。测试脚本为 scripts/test-file-resolution-ui.mjs 和 scripts/test-message-file-links-ui.mjs；截图/报告及隔离候选只在忽略目录 build/qa/file-link-repair。全部相关源文件和文档纳入同一本地逻辑提交，其他窗口工作不混入。
<!-- file-navigation-resolution-status-20260930:end -->

<!-- native-termination-status-20260930:start -->
## 原生运行中提前结束排查与错误保留（2026-09-30）

指定会话的有界日志核对显示两种不同现象：前两次中止位置有原生正常结束回执，最后内容是仍在描述后续工作的纯文本；另一次真实失败为本机 provider 网关 502。没有保留原始上游响应，因此不能把前两次绝对归因于模型，也不能证明所有第三方或官方模型都存在／不存在此问题。未读取其他用户会话、认证文件或私钥，原始记录不进入公开树。

修复包括：跨协议工具请求附加准确的回合结束约定；拒绝空的工具结束回执及无法表示的工具类型被降成纯文本成功；验证同协议 SSE 完成边界；保留超时、网络、协议、原生 HTTP/上下文/额度及 Claude 原生限制的安全分类；原生重试与最终结束分开，成功清理临时提示，失败原因留在所属历史回合。明确的进度阶段保留，迟到旧回合不结束新回合。没有添加宿主自动继续或重试，没有替换原生 agent loop。

公开入口、调用/注册/替换审查、兼容、生命周期、错误与 UI 偏好排除理由同步文档 36。验证使用已提交基线加本次限定文件的隔离候选，排除其他窗口的界面和记忆工作；报告在忽略目录 build/qa/native-turn-termination。真实 CLI 合成对照表明：Codex 和 Claude 均会在模型纯文本正常结束时停止当前回合，而工具调用后可继续回传并产生最终回答。这只是运行时行为证据，不是实际模型完成质量对比。

隔离候选通过 132 项针对性回归、全套 1,421 项测试（零失败／跳过）、8 组真实 CLI 同协议／跨协议及批准插件生命周期场景、4 组真实 CLI 工具往返和 14 项隐藏 Electron 回归。TypeScript、check:plugins（226 项声明、282 个宿主入口）、check:docs（44 份公开文本、零发现）通过。既有全套测试首次因测试默认旧版 Codex 路径不可用失败，指定实际已安装程序后全部通过；未修改无关技能逻辑。初版原生对照夹具缺少完整 Responses item 事件和 Claude 权限模式不合法，已修正夹具并重新跑完，失败结果不算通过。错误展示截图已人工复核。随后合并新的已提交记忆修复基线，重新通过完整测试、类型、构建和公开门禁；保留既有大分包构建提示。不会据此宣称活动工作台已更新、官方账号真实推理已验收或远端部署完成。
<!-- native-termination-status-20260930:end -->

<!-- remote-login-osc8-status-20260930:start -->
## Claude 远端登录空白页修复（2026-09-30；U5、U6）

隔离复现了登录 URL 没有正常交给浏览器的两个缺陷：原生 OSC 8/BEL 超链接中的控制字符被拼入地址并被严格校验拒绝；PTY 地址分段到达时提前发送不完整 URL。旧代码新增场景中四项失败，修复后 BEL/ST、纯文本、分段、同目标去重、自动 callback 和手动代码均通过；没有放宽官方 URL 白名单或改用本机 OAuth。

生产改动仅为 `services/vps-browser/browser_api.py` 的 URL 边界规则。插件调用/注册/替换、类型、状态、错误、权限、清理和 UI 偏好不适用原因已审查并登记文档 36；静态原生输出依据与证据边界登记文档 07。没有新增可调 UI、存储迁移或 SDK 声明变更。

验证使用已提交基线 342f7a3 加本次限定文件的独立候选，排除其他窗口未提交工作。Linux 合成登录 13/13；浏览器资料/进程监督 23/23；独立浏览器控制 5/5；远端 CLI/账号/安装生命周期 11/11；TypeScript 定向协议与插件测试 24/24。真实批准的两个临时 ZIP 验证新命令经实际 controller 调用、细粒度服务替换、多插件共存、管理员边界、在途结果、激活失败清理、停用和重新启用。新增测试最初遗漏必填 SSH 身份类型字段，已修正夹具；失败轮次不计作通过。

独立候选的 TypeScript、`npm run check:plugins`（226 项声明、282 个宿主入口）、`npm run check:docs`（44 份公开文本、零发现）均通过；公开契约快照未变。没有更改 UI，因此没有将既有或合成截图冒称本次桌面验收。

本机 `dist/host/remote-browser/browser_api.py` 与旧基线完全对应后，仅同步这一个已验证脚本并回读核对，保留原文件于忽略 QA 目录。该脚本在每次登录请求组包时读取；进行中的旧尝试不热替换，用户结束旧尝试后新登录使用修复。没有重建或覆盖其他窗口的主程序/renderer，也没有重启或点击活动客户端。

证据只留在忽略目录 `build/qa/remote-login-osc8`。没有请求真实 Claude 授权页、读取真实认证资料、完成账号授权、调用模型、操作活动客户端或部署 VPS。实际账号授权和截图远端环境仍须用户下一次明确登录核验；源码修复不冒称真实授权成功。
<!-- remote-login-osc8-status-20260930:end -->


<!-- claude-create-recovery-status-20260930:start -->
## Claude 原生配置删除后不能重新添加（2026-09-30；U5、U6）

隔离复现了“创建配置 → 删除 → 重启 → 重新添加”持续报账号目录变化的问题：本机创建 journal 保留已删除账号的 requestId 与旧 expectedRevision，刷新目录后仍重复同一明确失败请求。修复前新增六项测试中三项失败，失败证据保留；原因不是刷新按钮无效或登录权限变化。

修复只改 `packages/workspace-control/native-runtime.ts`：区分 broker 明确拒绝和传输/回执不确定；仅收到正常 SSH 的 `STALE_SELECTION` 时回读并退役对应记录，旧版本请求最多换用一个新 UUID 和当前目录版本。当前目录过期或第二次冲突时停止并清除明确失败记录，下次显式刷新/添加可恢复。旧 UUID 不重建，远端删除保留的 profile 不覆盖；断线、损坏回执、其他错误与本机损坏/并发改写记录继续保守处理。无需后端协议更新或远端部署。

已同步文档 36 的调用/注册/替换覆盖矩阵、权限、错误、状态、兼容及释放路径；无公共签名、surface、持久格式、可调 UI 或产品默认值变化。UI 偏好盘点说明操作 journal 与瞬时 busy/error 的边界，既有用户偏好不迁移；没有用新增硬编码目录或核心私有入口绕过插件路径。

验证基于已提交基线 bd4fd58 加本次限定文件的独立候选，排除其他窗口未提交工作。TypeScript 定向协议/控制器/批准插件回归 30/30，Linux 临时账号 broker/CLI 生命周期 12/12，实际本地 bundle 模块提取回归 16/16；生产 renderer/controller/恢复服务加已批准合成 SSH 插件的隐藏 Electron 验收 5/5，renderer errors 为零。完整进程退出后重启、删除后新身份创建、二次版本竞态有界停止、显式刷新后恢复均通过；截图人工复核。没有用真实账户、凭据、模型或 VPS 代替夹具，也没有把隐藏桌面称为用户前台或真实授权验收。

构建含 TypeScript 检查通过；`check:plugins`（236 项声明、285 个宿主入口）、`check:docs`（45 份公开文本、零发现）、`check:ui-preferences`（37 个类型键/使用钩子、39 个具名节点）通过，契约快照未变。构建保留既有大 chunk 提示。早期测试夹具的可选回调类型、启动路径与同名 JSON 冲突、重启 UI 尚未恢复的导航时机均已修正；失败轮次不计通过。

本机 dist 的原账号恢复模块与基线构建逐字等价（只对齐 bundle 导入变量名）后，仅替换该模块，前后其余字节完全一致；备份、语法检查、模块回归和同步哈希留在忽略目录 `build/qa/claude-account-recreate`。未重建覆盖其他窗口的主程序逻辑或 renderer，未读取/手动删除真实 journal，也未重启或操作活动客户端。已运行进程仍持有旧模块，用户需要完全退出并重新打开工作台，再刷新 Claude 账号并添加。没有发布、推送或部署；实际远端重新授权仍由用户明确操作后确认。
<!-- claude-create-recovery-status-20260930:end -->


<!-- follow-up-handling-20260930:start -->
## 运行中跟进、紧凑排队与消息顺序修复（2026-09-30；U119）

已按本轮确认的交互实现：常规设置使用现有文学风格的“排队 / 引导”文字标签，默认保持引导；Enter 采用所选方式，Ctrl+Enter 只对本条反向，Shift+Enter 换行，IME 与重复按键不提交。引导写入普通用户消息时间线；仅未发送队列贴在输入框上沿，以约 30px 单行显示，最多约三条高度滚动，全文与额外操作按需打开，不增加常驻说明卡片。

“收到引导但用户消息像消失”的可复现根因是阅读分组把同一原生回合的所有用户消息移到顶部，再显示全部过程输出。现按原始顺序交错渲染用户消息与过程段，首段保留旧折叠偏好的键，旧插件缺少可选 ordered 字段时继续兼容。原生和扩展运行时先保存补充输入，再发送并保留接收或未知状态；未知回执不自动重发。

队列保存已确认原稿、实际发送文本、附件/技能及会话绑定，成功完成后逐条派发。停止、失败或重启暂停待发送项；发送中退出标为未知，不能通过重复点击恢复为可重发项。派发前重查回合、绑定、技能版本、附件与停止代际；存储错误可见并暂停自动调度，但不阻挡停止信号传给运行时；新增回归先复现保存失败导致 Stop 未派发，再修复并通过。共享 composer.follow-up 偏好支持修订冲突、重置、完整进程重启和缺失扩展保留。调用、注册、替换、五个局部 surface、错误/权限及清理在文档 36；偏好盘点在文档 37，公开原生依据在文档 07。

验证基于已提交基线 2c94679 加本次限定文件的隔离候选，排除其他窗口未提交的原生完成协议及文档整理。完整 TypeScript 测试 1,460/1,460，零失败和跳过；涵盖实际批准 ZIP 的新方式进入 controller/选择器/队列、服务拦截、替换层、多插件、失败回滚、禁用/重新启用与旧配置。TypeScript、check:plugins（243 项声明、287 个宿主入口）、check:docs（45 份公开文本、零发现）、check:ui-preferences（38 个类型键、40 个使用钩子、39 个具名节点）通过。契约快照按新增类型、命令、surface 与兼容的 ReadingTurn 增量审阅更新。

隐藏生产 Electron 使用独立构建与临时 profile，跟进验收 13 项、输入框回归 20 项、阅读与文件审阅回归 16 项均通过，renderer errors 为零；浅色、深色窄窗口、长/多行队列、完整重启、正文引导顺序及扩展动态挂载截图已人工复核。旧输入框夹具未初始化共享偏好、仍假设展开状态随卸载清空，导致验收超时；已接入合成的带修订偏好桥并按持久展开行为复测。早期候选误混入另一窗口尚未提交的完成协议字段也已剔除后重新验证；失败轮次不计通过。构建保留既有字体运行时解析和大分包提示。

已安装 Codex 0.155.1、Claude Code 2.1.284 配合隔离原生目录和 loopback 合成推理通过 5 项原生场景：两条运行中输入均进入模型请求并各保留一次，结束回合拒绝迟到引导；Claude 在 MCP 工具仍等待期间收到的输入进入同一原生回合，无需先停止。接收节点由运行时决定，不能把 stdin 写入完成承诺为立即插入；前一个 result 不得抢先关闭还有明确输入未接收的进程。未支持引导的适配器采用工作台排队，不承诺所有 SSH 路径都具备相同能力。

证据保留在忽略的 build/qa/follow-up-work 与 build/qa/follow-ups 下；没有读取真实聊天库、使用真实账号或付费模型、操作活动客户端、更新生产 dist、打包发布或部署远端。源码、真实 CLI 合成传输和隐藏桌面证明分层记录，不冒称实际模型质量、用户前台或安装升级验收。
<!-- follow-up-handling-20260930:end -->


<!-- native-explicit-completion-status-20260930:start -->
## 跨协议进度回复再次提前结束（2026-09-30）

指定问题回合与进程的有界核对确认：此前提示式修复已经包含在运行构建中，仍收到原生正常结束回执，最后只有进度性质文本。原始上游回执缺失，不能证明模型独占责任。已确认的适配缺口是没有要求明确完成决定、输出阶段缺失，以及把进度与相邻工具拆为独立 assistant 消息。公开树不包含私有会话、聊天正文或环境地址。

新增请求级完成 codec，跨协议工具任务需要显式结束封套；纯进度不再包装为成功。真实工具仍由 CLI 执行，未增加宿主续跑循环。修复进度/最终阶段与历史批次，保存最多 32 条无正文结构回执；不支持参数或封套的提供方明确失败。outcome 仍为模型声明，不能保证任意模型不提前宣布完成。

调用、注册、细粒度替换、类型、生命周期、错误与兼容同步文档 36。UI 没有新增可调节点、默认值或偏好迁移。最终隔离候选以已提交的跟进消息修复为基线，叠加本次限定改动；排除其他窗口仍未提交的界面及文档整理。证据留在忽略目录 build/qa/native-explicit-completion。

最终隔离候选完整 TypeScript 测试 1,471/1,471，零失败、取消和跳过；类型检查、构建、check:plugins（247 项声明、287 个宿主入口）、check:docs（45 份公开文本、零发现）、check:ui-preferences（38 个类型键、40 个使用钩子、39 个具名节点）通过。构建仅保留既有大分包提示。此前工作树试跑出现无关原生技能配置测试失败及旧契约快照不匹配，不计为通过；限定并更新候选后完成全量复验。

已安装原生 CLI 配合隔离 profile 与合成上游通过 14 组终止/工具/批准插件生命周期场景和 4 组流式工具往返；工具只执行一次且必须等待合法终止回执。无封套响应时，本机 Codex 共请求 6 次（初次加原生 5 次有限重试），Claude 随协议请求 1–2 次；这些由原生运行时发起，网关没有额外重投。隐藏桌面反馈验收 14 项通过，renderer errors 为零；不以隐藏窗口代替用户前台验收。

本机程序包实际模块的 16 组前后对照验证旧版接受纯进度结束、新版拒绝，并保留工具、明确结束与无工具请求。写入前核验原文件摘要；仅更新本轮模块及两个局部接入点，保留其他窗口的程序包字节；写入后语法及摘要回读通过。已更新本机 dist/host/main.cjs，未退出或重启活动客户端，现有进程仍须完整退出后重新打开才能加载。证据为忽略目录中的 bundle-regression.json、bundle-patch.json 与 bundle-applied.json。

真实模型调用为零；尚未验证第三方模型或官方账号的长任务完成率，未操作活动客户端、打包发布或部署远端。合成验收证明协议与运行时边界，不证明任意模型不会主动错误宣称完成。
<!-- native-explicit-completion-status-20260930:end -->


## 2026-09-30 — Translation source, compact controls and separate usage

- The enabled translation module now owns input/final translation; the redundant independent input switch is removed. Master enable and temporary pause remain separate. The intermediate-message checkbox is in the global workspace header in both inline and side-panel reading layouts. Reading-placement controls are compact radio choices.
- The model-source tabs select either an enabled API/local official-account model or a separately configured custom API. Registered plugin targets enter the actual catalog and executor. Missing choices remain saved without automatic substitution. Native-account translation uses its account-owned native environment and a separate ephemeral/nonpersistent process, with no main-chat history or extracted credential transfer.
- Fresh character/call/wait limits are 0; existing numeric preferences survive. The character check counts source Unicode code points before dispatch and never cuts off main-model output. Translation failures do not rerun native tasks. Receipt persistence failures keep completed translations and expose unsaved statistics without sending another model request.
- Translation receipts are persisted separately and shown through the existing `ModelUsageSummary` account/API component: 1 day, 7 day and calendar month, without quota cycle. Input/output/cache counts and optional reasoning receipts are retained; period/expansion and pricing scopes are independent of main sessions and account/API usage. No receipt-free historical usage is invented.
- Interface and preference audits, contracts, compatibility/migration, errors, named surfaces, example and coverage updates are in documents 36 and 37. Source changes are isolated from concurrent work.
- Acceptance: the new host/registry/usage/native fixture tests pass, including approved ZIP activation, actual selector/execution, in-flight disable, late resolution rejection, reenable, stale settings, legacy limits, corrupt-file preservation, receipt deduplication and shutdown writes. Hidden desktop acceptance passes compact controls, both reading layouts, selected API traffic, translation-only periods/counters, plugin surfaces on mounted/later pages, model unavailability, complete process restart and narrow dark layout. Inspected captures are synthetic and retained only in ignored QA storage.
- Installed Codex 0.159.0 and Claude Code 2.1.284 each completed one loopback synthetic translation with zero advertised tools; usage and temporary-directory cleanup passed. This validates the invoked native protocol/configuration, not a real subscription, paid model, translation quality, remote egress, installer upgrade or release package. No real account task, production profile mutation, VPS operation, push or deployment occurred.

Verification commands: `npm run typecheck`, `npm run build`, `npm run check:plugins`, `npm run check:docs`, `npm run check:ui-preferences`; `tests/translation-redesign.test.ts`, `tests/translation-native.test.ts`, existing translation and model-usage tests; `scripts/test-translation-native.mjs`, `scripts/test-translation-redesign-ui.mjs`, and `scripts/test-translation-module-ui.mjs`. The older module UI assertion was updated to honor the explicitly opened history-pane preference on restart; disabling translation still sends no model traffic. Full-suite totals and integrated-tree evidence are appended after the final check.


Final isolated candidate verification: 1,488/1,488 repository tests passed, including 17 new translation redesign/native tests. Typecheck, build, plugin contract gate, public documentation gate and UI preference inventory passed. Six redesign desktop groups and the existing translation module UI workflow passed after waiting for acknowledged preference writes before restart. Two installed-CLI loopback checks passed. Full-suite runs before the final snapshot refresh correctly rejected the stale public contract baseline; one earlier Windows temporary-directory cleanup race passed on focused and final full reruns. Those earlier failures are not counted as successful checks. The candidate was reviewed against the original source base; any later committed integration requires separate verification.

Integrated candidate verification, after retaining the separately committed visualization and branding work: 1,501/1,501 repository tests passed, with zero failures, cancellations or skips. Typecheck, build, plugin contracts (272 declarations and 294 host methods), public documentation (46 files, zero findings) and UI preference inventory (41 keys, 42 hooks, 39 nodes) passed. The six redesign desktop groups and 15 existing translation-module checks passed again. An isolated-checkout CRLF conversion initially failed the unrelated SVG byte-hash check; restoring the exact committed SVG bytes resolved it without changing artwork. The existing queued-preview fixture now waits for queue removal and verifies its native turn receipt before cleanup, preventing deletion during an unfinished state write; it also verifies that no steering request occurred. Failed trial runs are excluded from the final totals. This evidence covers the reviewed candidate tree, not concurrent uncommitted edits from other work.


<!-- model-cost-lower-bound-20260930:start -->
## 2026-09-30 JST — 部分用量费用估算与缓存写入修复（U115）

- 原因：严格估算遇到任一必要计数缺失返回 null，逐模型汇总又因一条残缺回执清空整组金额，导致有单价、有输入/输出/缓存读取仍显示未知。Responses 新增的 input_tokens_details.cache_write_tokens 原先未解析，协议转换也未保留写入字段。
- 实现：保留旧 estimatedUsd 严格语义，增加可选 lowerBoundUsd；逐条保留可计价部分，未知缓存分类按最低适用单价计算下界，汇总显示“至少”。无单价和无计费用量分别说明；无记录模型的零值不掩盖其他模型缺价。API、官方账号和翻译使用同一查询与组件，保存价格后即时重算；原始未知计数不补零、不回填缺失历史。
- 协议：新增缓存写入解析，非流式/流式 Responses 转换保留写入及显式零值；缓存只计一次，不增加模型请求或历史重投。现有官方参考表本日复核一致，未更改价格、猜测第三方别名或引入自动价格查询。
- 同轮接口和持久化审查见文档 36/37；契约快照只增加两个可选返回字段。实际批准 ZIP 验证调用、服务包装、多插件共存、激活失败清理、停用/重新启用、包移除、价格修订冲突和重启保留。具名 surface 与存储结构不变。
- 最终隔离候选：1,513/1,513 测试通过，零失败、跳过或取消；npm run build（含 typecheck）、check:plugins（272 声明、294 宿主入口）、check:docs（46 文本、零发现）、check:ui-preferences（41 键、42 钩子、39 具名节点）通过。12 项新增费用/协议/插件回归包含在全量结果中。5 组隐藏 Electron UI 验收通过，覆盖三种来源、真实金额、手动价格、完整退出重启、偏好恢复、晚到完整回执和后来挂载实例；浅色、深色及窄屏截图已人工检查，renderer errors 为零。
- 失败边界：共享工作树的插件检查因另一项未提交 surface 改动拒绝旧快照，本次未吸收该改动。隔离归档首次全量运行遭遇 SVG 换行过滤及测试默认旧 npm CLI 路径；仅在隔离候选恢复 HEAD 的原始 SVG 字节并显式绑定已安装 CLI 后重跑，全量通过。UI 首轮重启发现合成翻译夹具缺少匹配 receipt，改为使用生产 recordTranslationUsage 生成后复验通过；未修改用户资料或弱化校验。
- 证据位于忽略的 build/qa/model-cost-candidate-* 与 model-cost-ui-*；隔离候选排除其他窗口未提交的文档、界面及远端浏览器工作。无真实付费模型调用、用户聊天库/凭据读取、用户插件安装、活动客户端操作、安装包发布或 VPS 部署。源码/隐藏桌面验证不代表当前运行实例已加载，也不代表真实账单或套餐配给。
<!-- model-cost-lower-bound-20260930:end -->

<!-- browser-first-navigation-status-20260930:start -->
## 普通远端浏览器首个空白页与登录启动顺序（2026-09-30；U105）

普通“启动并打开”同样出现空白，根因为 `remote_browser.chrome_arguments` 明确把首个页面设为 `about:blank`。登录还先启动空白浏览器，随后用第二次 Chrome 命令投递授权 URL；viewer 在目标 URL 到达前就被宣告就绪。这与此前修复的终端 URL 边界解析是不同缺陷。新增六项回归在旧实现全部失败。

本次普通启动改为原生新标签页；登录先校验所选资料并保留 manager 锁，等待经过原有白名单校验的原生 URL，再把 URL 作为第一个页面启动。重复 URL 不再新增标签页，等待期间不开放 viewer；完成进程/显示服务启动及本机通道连接才就绪，不把网页加载或账号授权成功混作就绪。EOF、取消、超时和启动失败保留原有所属进程清理、账号释放及配置保留边界。

公开调用、注册、细粒度替换、生产消费、类型/错误/权限、插件生命周期及兼容审查同步文档 36；启动默认值和原生 profile 偏好所有权同步文档 37。没有新 UI 控件、公开签名、具名 surface、偏好格式或快照变更。未将未知就绪模拟为 true，未修改官方 URL 白名单、远端登录身份或 Chrome 用户配置。

隔离候选先基于 fbc36e4，后纳入另一个窗口已提交的 38cba57 费用修复，再通过集成检查；其余未提交的界面/文档工作不计入范围。Linux 合成 manager 6/6、浏览器资料/监督 23/23、原生登录 15/15、日常浏览器控制 5/5、远端 CLI/账号生命周期 12/12。TypeScript 定向协议/控制器/真实批准 ZIP 生命周期 24/24，覆盖 production service 到请求资源组包、就绪拒绝、多插件、停用/重新启用和失败恢复。

真实已安装本机 Chrome 使用全新临时资料、headless 和合成回环页完成 3/3 对照：旧第一个标签页空白但新建页正常；新普通启动仅一个原生新标签页；指定目标直接成为第一个且唯一页面。成功截图已检查。早期 Windows headless 第二次命令行投递试验未通过，未将其算作 Linux singleton/VNC 验收，最终测试明确只验证首个页面和新建页行为。

隐藏独立 Electron 完成 21/21 远端管理 UI 检查，包含 preparing 时打开按钮禁用、目标就绪后可打开、代码备用入口及等待期间取消；renderer errors 与未预期调用均为零。初次夹具缺少共享偏好接口导致导航回退，第二次发现缺少 branding/titlebar 回执；补齐测试夹具并在最终集成候选重跑通过，失败轮次不计入通过结果。没有更改生产 renderer 来迁就测试。

最终候选 `npm run build`（含 typecheck）、`check:plugins`（272 项声明、294 个宿主入口）、`check:docs`（46 份文本、零发现）、`check:ui-preferences`（41 个类型键、42 个钩子、39 个具名节点）通过；构建保留既有大分包提示。未重跑不相关的全仓测试，也不把另一个窗口的未提交工作归为已验收。

核对旧文件与已提交基线后，仅同步本机 `dist/host/remote-browser/browser_api.py` 和 `remote_browser.py`，备份、摘要及内容回读通过。进一步单独执行现有主程序中的请求组包函数，确认连续新请求均从磁盘读取这两个新资源；主程序和其他浏览器资源摘要不变。无需重启工作台来读取脚本，但已经运行的浏览器/登录流程不热替换：普通使用须明确关闭后重新启动，登录须结束旧尝试后重新开始；“恢复连接”不会重新启动浏览器。

证据只在忽略目录 `build/qa/browser-first-navigation`。没有真实账号授权、真实用户 Cookie/配置读取、模型调用、活动客户端鼠标键盘操作、远端执行、安装器更新、推送或部署。仍须用户下一次新启动核对其远端前台；本机 headless、合成协议和隐藏桌面不冒充真实 VPS 授权或网络验收。
<!-- browser-first-navigation-status-20260930:end -->

<!-- browser-auth-url-status-20260930:start -->
## 远端 Claude 新授权入口与准备阶段停滞（2026-09-30；U105）

本次只读核对已安装远端 Linux Claude Code 2.1.285 的版本和程序常量，发现其订阅地址使用 `claude.com/cai/oauth/authorize`，而工作台提取器/manager 原先只接受旧入口。新增 URL 的合成试验在修复前返回 expired，修复后完成协议验收。这定位了可复现的适配缺陷；没有读取真实登录任务的私有配置/输出，故不将静态版本证据冒充用户当次登录的完整实测。

原生程序区分手动与自动回调 URL。工作台保留 `BROWSER=/bin/true`、读取原生终端地址并交给远端 Chrome 的既有手动码路径；授权在 VPS 页面完成，临时码提交给 VPS CLI，本机只承载 noVNC 画面和状态。没有把远端登录改成本机 CLI 登录，没有复制本机凭据，也没有新增自建令牌交换或失败续投。

修复同步接纳严格的新域名/路径组合，保留旧入口、OSC 8、分段 PTY、重复地址过滤、首个目标页面及 profile 所有权。等待完整受支持 URL 限制为 60 秒；发出首次 open 后等待 manager 就绪限制为 70 秒，之后仍遵守原 900 秒总期限。新增两类地址错误并本地化，浏览器未就绪沿用启动超时。失败走原有所属进程清理/账号释放路径，未确认清理仍不可重新准入。接口和偏好审查同步文档 36/37；公开声明、具名 surface 和持久格式不变，无需刷新契约快照。

基于已提交 769b25c 的隔离候选通过 67 项 Python 检查（原生登录合成 19、首页/端点 8、profile/监督 23、控制 5、CLI/账号生命周期 12）、21 项 TypeScript 接口/控制器/批准插件生命周期检查。新增真实批准 ZIP 通过生产 controller、RemoteBrowserService 的 SSH 组包与状态消费；只替换子进程边界，不发起真实 SSH。覆盖新旧入口、输入环境/工作目录隔离、手动码、合成 loopback、超时、取消/断线、错误本地化及停用/重新启用。

隐藏独立 Electron 最终 24/24 检查通过，renderer errors 和未预期调用均为零；三种准备错误清除码框、禁止打开未就绪 viewer、恢复重试。失败提示截图已检查。初次新增 UI 夹具误用 Electron evaluate 参数导致不可克隆对象，修正测试参数后重跑通过；初次新增插件测试的 tuple 类型错误也已修正。未改生产界面以规避测试。`npm run build`（含 typecheck）、`check:plugins`、`check:docs`、`check:ui-preferences` 通过，保留既有字体运行期解析与大分包构建提示；未将其他窗口未提交工作纳入通过范围。

仅将两份核验后的 Python 资源同步到本机运行目录，并向既有宿主 bundle 精确加入两个错误翻译赋值；备份、摘要、语法与内容回读通过，移除新增两行后其余 bundle 字节完全一致。实际组包函数连续两次读取新脚本，其他浏览器资源摘要不变。新请求无需重启即可读取 Python 修复；已经运行的尝试不热换，必须先结束再新建。新中文错误翻译在宿主下次启动加载，不强制关闭当前用户窗口。

验收材料仅保留在忽略目录 `build/qa/browser-auth-url`。远端检查仅程序元数据、公开常量与安全版本探测，没有真实账号授权、令牌/Cookie/私有配置/聊天库读取、真实授权页请求、活动客户端操作、远端写入、安装、部署或进程终止。真实远端前台和账号授权成功仍待用户新尝试验收；本次未推送或发布。
<!-- browser-auth-url-status-20260930:end -->

<!-- claude-ssh-catalog-status-20260930:start -->
## Remote Claude catalog progress and remaining execution blocker (2026-09-30)

The user kept the original VPS-native Claude runtime/authentication plus local Windows files/tools requirement and withdrew connection-name cleanup. The name-generation and migration edits were removed. The old menu hid a real gap: only Codex had an SSH catalog read, and the broker explicitly rejected Claude local-tool execution.

Implemented source now connects native CLI initialize metadata through account-owner broker runtime/models, the member SSH client, identity-bound controller cache and the production model menu. It sends no user prompt, projects only model metadata, rechecks permissions/generations, cleans the owned process and preserves independent execution readiness. Model names come from that remote account's CLI after deployment, not a hardcoded list or local account. Old brokers expose an explicit error. A named replaceable model catalog and approved synthetic plugin coverage accompany the change; persistence and compatibility reviews are in documents 36 and 37.

The full SSH execution objective is still blocked. The isolated installed CLI probe accepted model initialization but rejected the native remote-tools announcement outside a managed cloud worker. No accepted local Windows executor/file view has been implemented, and no acceptance receipt was forged. Authentication success, catalog readability and execution readiness remain separate states. The source does not enable Claude task submission or replace native tools with same-name workbench tools.

The final review also fixed catalog admission during account login/removal and CLI maintenance: metadata processes now use the existing active-runtime table and retain the maintenance fence if cleanup is unconfirmed. Synthetic tests exercise these races, revoked authentication and shutdown cleanup. Validation is scoped to this change in an isolated committed-base candidate; focused protocol/controller/plugin tests, typecheck, plugin/docs/preference gates and hidden UI results are recorded under ignored build/qa/claude-ssh. The native probe uses an empty synthetic profile and sends no model task. No real inference, remote SSH operation, deployment, active desktop restart, credential access or production dist replacement was performed. Other windows' uncommitted work is excluded. This entry records partial implementation and a concrete blocker, not a completed Claude H bridge.
<!-- claude-ssh-catalog-status-20260930:end -->

<!-- claude-official-mcp-status-20260930:start -->
## Claude SSH official MCP execution route (2026-09-30)

The selected architecture now has a source implementation: VPS account-owner native Claude stream-json loop and model networking, a session-bound SSH tool tunnel, and actual local official `claude mcp serve` file/command tools. The desktop production controller routes eligible Claude SSH sessions through the shared native stream runner, including model/effort selection, native approval and question replies, permission updates, explicit follow-up input, cancellation and unknown-result handling. A refreshed old broker remains unavailable rather than silently falling back to local authentication or model execution.

The owner performs native initialize/MCP-status preflight before admitting a user prompt; native login material stays in its account profile. Session/account generation, private endpoint tokens, local command lifetime, remote cleanup confirmation and no-replay input fencing are implemented. Native remote Agent orchestration remains enabled. Local MCP tools are an explicit subset: foreground file/command operations; local model-capable tools, scheduled work and background Bash are not exposed. This is not a managed-cloud-worker registration or full Codex-executor equivalence. Remote native transcript forks and native plugin/skill parity are not newly certified.

Evidence completed: source/type checks, synthetic owner/SSH/controller lifecycle tests and approved synthetic ZIP plugin extension tests; real local official tools read/wrote/edited/searched fixture files, executed Bash and PowerShell commands in the actual local cwd and terminated the owned waiting process; production owner CLI arguments completed isolated native MCP metadata handshake. All model endpoints in those native probes were closed loopback, with synthetic credentials and no model inputs. Test profiles and generated evidence remain in ignored QA directories.

Delivery boundary: build an isolated candidate and commit only this logical change; do not replace the active desktop, deploy the broker, push or publish. No actual Claude model requests or real SSH operations are part of this acceptance. The user's real-model test and any separately authorized deployment are still required before claiming end-to-end VPS execution. Historical catalog-only and managed-worker refusal records remain evidence for their earlier scope.
<!-- claude-official-mcp-status-20260930:end -->

<!-- claude-local-resources-20260930:start -->
## Claude local images, memory and skills (2026-09-30 follow-up)

The official MCP bridge now has verified native Read image conversion and session-scoped local resource discovery. It exposes current repository memory paths, native enabled state, instruction/rule paths, personal/project/plugin skills and legacy command files. Full skill text, argument/path substitutions and actual local support-file paths reach the MCP response. Supported dynamic shell commands require a separate explicit tool call, run in official local Bash, and feed verified output back into a subsequent skill load. Standard MCP prompts expose user-invocable entries. Native VPS Agent/AskUserQuestion ownership is unchanged.

Evidence is synthetic protocol plus real local official-tool execution only. `scripts/probe-claude-local-context.mjs` verifies PNG byte content, synthetic native memory and index read/edit/write/readback, skill arguments/support script output, prompt retrieval, legacy commands, Bash/PowerShell, nonzero exit handling and rejection of local model endpoints. Tests cover resource freshness, scope, invocation policy, plan-mode denial, no replay, cleanup and approved plugin activation/disable/re-enable/failure recovery. Build, type, plugin contract, public-doc and UI-preference checks run in an isolated candidate so another window's unfinished work and the active desktop build are excluded.

Remaining boundaries: this change is not a deployment or a real Claude task. Live model image understanding, future memory recall, native frontend slash-command selection and custom native subagent availability/inheritance still require user acceptance. It does not enable remote automatic memory, recreate arbitrary native hooks or plugin UI, or add persistent local background shell jobs. Unsupported lifecycle/substitution forms produce explicit errors. Existing native UI commands such as login/settings are not local-device tool calls. The plugin/API contract and exact supported resource behavior are in document 36.
<!-- claude-local-resources-20260930:end -->

<!-- claude-local-async-20260930:start -->
## Claude local asynchronous commands and PowerShell skills (2026-09-30)

The bridge now provides `StartLocalCommand`, `LocalTaskOutput`, `ListLocalTasks`, and `StopLocalTask`. Each task owns a private official local `claude mcp serve` process and invokes its native foreground Bash or PowerShell tool; the workbench waits outside the tool call and returns a bounded receipt. This supplies asynchronous local command work without pretending that the installed CLI's native `run_in_background` output/status protocol is available.

Dynamic skill commands now preserve the native `shell` frontmatter value. `shell: powershell` routes to the official local PowerShell tool, while the default and `shell: bash` routes use Bash. Exact command matching, permission gates, no-replay behavior, and read-back remain in force.

The bound model effort is also available to skill text through `${CLAUDE_EFFORT}` for the five supported native effort labels. Other session- or plugin-specific `${CLAUDE_*}` values remain fail-closed because the local MCP process does not own the native VPS session identity or plugin data directory.

Synthetic unit tests and the production gateway probe pass. The probe used a synthetic PowerShell command and no model input. Native incremental background output, persistent task receipts after session cleanup, hooks, and arbitrary native lifecycle metadata remain explicit boundaries.
<!-- claude-local-async-20260930:end -->

<!-- runtime-mcp-repair-20261001:start -->
## Runtime response, disclosure and Claude MCP repairs (2026-10-01 JST)

The repair covers three separate boundaries: converted native API responses ignored a non-streaming request and returned SSE; disclosure preference notifications triggered unrelated conversation rerenders; the installed remote account service lacked the later Claude model-catalog/session routes. The gateway behavior predates the most recent Claude bridge work, and the preference issue originated in the earlier persistence change; the available evidence does not attribute every failure to the latest edits.

Converted response mode now follows the native caller, Anthropic tool blocks are sequential after validation, known protocol diagnostics preserve safe codes, and retry notices recover only on matching native progress. Disclosure consumers retain their stable persisted choices while observing their own effective preference. The adopted MCP work now handles roots/ping, peer request-ID collisions, supported version negotiation and object structuredContent without breaking legacy text results. The setup bundle's missing claude_session.py inventory entry is repaired; previously the Python inventory rejected the desktop's new bundle as INVALID_BUNDLE.

Isolated candidate evidence: 1603/1603 full tests passed, including response-mode combinations, native stream/tool transport, account catalog/owner lifecycle, controller/plugin registration and UI preference storage. The updated Claude plugin integration additionally passed 5/5. Official local CLI probes passed image-byte delivery, scoped memory discovery/read/edit/write/readback, complete skill and legacy-command loading, PowerShell skill commands, asynchronous command receipts, failure preservation and no local model route. Native metadata initialize/mcp_status confirmed the official local MCP connection without user/model input. The Linux setup regression passed 10 checks against temporary real files and synthetic OS/service commands. Four installed-CLI protocol pairs also passed synthetic parallel-tool round trips. The 14-case installed-CLI termination and approved plugin lifecycle test also passed. Typecheck/build, check:plugins, check:docs and check:ui-preferences passed; the reviewed public declaration/surface snapshot required no refresh. These tests do not send real model requests.

Hidden Electron, using 228 synthetic activities and large tool outputs, measured 912 activity-classifier invocations per disclosure toggle before the scoped subscription and zero afterward. Full process restart and approved preference override disable/reenable restored the same choices. The fixture did not reproduce the reported multi-second pause consistently, so this establishes removal of redundant work, not a claimed seconds-to-milliseconds foreground speedup.

Read-only SSH inspection reproduced the unsupported catalog request and confirmed that the running older broker lacks the model route and Claude session module. A reviewed four-file update bundle is prepared locally with before/after hashes and rollback sources; remote update and service restart require separate authorization. No real account credentials, private remote configuration or conversation database are included in public evidence. Current running-desktop replacement, production SSH model availability after update, real-model behavior and foreground acceptance remain distinct from source, isolated build and synthetic tests. The acceptance artifacts remain in ignored build/qa/runtime-repair-20261001.
<!-- runtime-mcp-repair-20261001:end -->

## SSH 配置管理交付（2026-10-01）

SSH 管理员页的 CLI 页签改名为“配置管理”，保留旧页签标识与偏好。Codex CLI、Claude Code CLI、工作台远端配置在同一区域分别管理；新增工作台配置安装、更新、卸载的只读预览、一次确认、内容版本、错误回读和插件注册目录。仅更新程序及自身服务，保留已有账号、登录、CLI 和工作空间；程序备份、双运行时维护锁、未知结果不重试、失败回退与损坏记录保留已接入。

第三行提供默认关闭的自动更新开关，远端保存并回读策略，不建立本机镜像。桌面新版本携带较新的配置 revision 和摘要时，运行中的工作台在 60 秒维护周期内检查，只在远端空闲时更新；旧客户端不能降级，已卸载或停用的服务不会被自动装回或启动。失败/未知目标的尝试记录持久保存，自动执行不重放；显式新预览可以恢复。构建校验远端包清单与 ASCII，发布时须随远端程序变化递增配置 revision。真实用户桌面未自动切换，线上策略未改动。

更新回执后清空旧 SSH 模型/能力缓存，重新读取账号元数据；下一次选择器刷新从实际原生 CLI 获取模型，Claude MCP 沿用已修复的官方本机工具链。配置维护不发送用户模型消息，不执行登录或额度兑换。远端源码、注释、固定错误和日志逐文件核对为 ASCII，中文仅由桌面本地化；用户原始内容不转写。

隔离验收：全套 Node 回归 1627/1627；随后新增的连接身份竞争和退出回执保护连同配置专项共 12/12，通过的 Linux 文件/合成服务生命周期 20/20、批准插件与隐藏 Electron 配置界面 8/8、远端资源界面 13/13。此前读取的 18 个旧版公开程序文件完成离线迁移回放，保留合成服务身份并补齐缺失模块。类型、构建、插件契约、公开文档和 UI 偏好门禁通过。测试位置包括 tests/remote-configuration.test.ts、scripts/test-remote-configuration.py、scripts/test-remote-configuration-ui.mjs。本轮未替用户部署远端或发送真实模型请求；隐藏桌面与合成服务不等同线上验收，其他窗口未提交改动不计入通过范围。

Claude 使用边界复查仍保留：官方原生登录、订阅凭据不进独立翻译、MCP 网关不提供模型推理端点、最终失败不自动续投、不轮换账号绕过限制、不兑换额度或由 peer 消息自主开启回合。这是代码层的工程结论，不能证明官方风控不会触发；第三方提供方的上游来源及账号使用政策仍须分别判断。


<!-- claude-mcp-hardening-20261001:start -->
## Claude MCP reliability and result delivery (2026-10-01 JST)

The five reviewed areas are implemented in the local bridge: byte-based wire/result limits and per-exchange output accounting; safe typed errors; owned foreground command processes with a serialized native file lane; bounded result files/range retrieval and separate async execution/delivery outcomes; and paginated catalog refresh plus bounded HTTP session lifecycle. Plugin contracts, production registration and compatibility behavior are recorded in document 36. There are no new UI controls or persistent user preferences.

The first focused run caught a completion-publication race during asynchronous result storage. The implementation now publishes terminal state only after delivery and owned cleanup; the regression passes. The current shared checkout passed 1644 Node tests with four workers, zero failures/skips. Plugin contracts, public docs, UI preference inventory and TypeScript checks passed. Renderer and host compile into an isolated QA candidate; the existing font-resolution and bundle-size advisories remain. This shared-checkout run does not include other windows' unfinished changes in this logical delivery. The independent scoped snapshot ran 1640 tests: 1639 passed initially and its contract-gate test detected only JSON key ordering introduced while assembling the isolated snapshot. A semantic comparison confirmed identical declarations; regenerating the ordering and rerunning that one test passed. The scoped snapshot also passed all four gates and the full production build.

Installed official CLI evidence: the local context probe passed real image reads, instruction/memory discovery, native read/edit/write/readback, skill command approval, prompts, both foreground shells and async receipts. The synthetic native roundtrip probe passed three loopback upstream exchanges for JSON/INI/log output handles, range reads and actual image blocks. It also cancelled a real owned command PID, verified its termination, and confirmed that a parallel and a later file read still worked. These are synthetic model exchanges, not live model requests; no provider billing inference is made from MCP structured/text fields.

Process isolation here is cancellation/cleanup ownership, not network isolation. Local Bash/PowerShell still can connect outward and expose the local egress IP. Neither environment/proxy settings, prompts nor output bounds enforce an egress boundary. No remote service was updated, no active desktop was switched/restarted, and no real provider request was made. Live model acceptance remains paused pending the separate local-tool network-risk work and user notification; the previously authorized single request remains unused.
<!-- claude-mcp-hardening-20261001:end -->

<!-- imported-workspace-claude-boundary-20261001:start -->
## Imported workspaces are ready for administrator-managed Claude (2026-10-01 JST)

Imported workspaces become active and read the administrator-owned public account catalog, whose authority ID, authority generation and workspace ID must match the member binding. After explicit import confirmation, missing local Claude tools use the existing official native installer; installed tools are reused without updating or migrating them. The controller then reads the remote model catalog and execution capability into the production selector. Native login, selected account and remote configuration remain administrator-owned. No local Claude login or hand-written MCP configuration is required.

Import returns an additive preparation receipt. Unavailable service, missing assigned account, local installation failure, unsupported remote bridge or a changed connection remain visibly not ready. The member connection stays saved; explicit `studio/prepare` retries preparation without re-enrolling or consuming another invitation. Concurrent preparations share one operation; ordinary workspace selection never installs software. Existing `studio/connect` paths refresh their catalog. Readiness discovery starts no model task and does not update the VPS.

The Claude MCP bridge keeps model-facing management metadata generic. `roots/list` uses `project`; workbench-owned context, skill and prompt envelopes remove authority/device IDs, fingerprints, host/IP/SSH fields, workspace/account references, usernames, connection objects and member/device lists, including common case/underscore/hyphen aliases. Cyclic, excessively deep or custom-serializer metadata is rejected rather than returned unexamined. Task-required actual paths, user-authored file contents, command output, skill bodies and native results are preserved. This prevents automatic management-metadata disclosure, not inference from user content or local network egress.

Final task-only candidate: **1658/1658** full tests passed with zero failures/skips in a serial run using the explicitly selected installed Codex 0.155.1. Focused controller/context/MCP tests passed **52/52**. TypeScript, plugin contracts (334 declarations, 302 methods), public docs, UI-preference inventory and production build passed; existing font-resolution and bundle-size advisories remain. Six hidden Electron cases passed with approved disposable host/renderer plugins: no preview side effects, retained membership after preparation failure, explicit recovery into the real model selector, mounted/later surface replacement and cleanup, narrow dark controls, and full process restart without replay. Light/error and dark/narrow screenshots were inspected. No new display preference or profile migration was introduced.

Earlier shared-checkout and concurrent candidate runs exposed isolated native configuration failures, including an absent legacy CLI path, an incompatible older CLI and a transient failed configuration read. The final two native test files passed 27/27 independently, followed by the complete serial pass; no unrelated native configuration implementation or assertion was weakened. QA evidence and the tested source snapshot remain under ignored `build/qa/workspace-boundary/`. Other windows' unfinished changes are excluded from this candidate and commit. No real model request, actual dependency installation, remote configuration update, native-login credential transfer, active desktop replacement, push or release was performed. Deployment and live provider acceptance remain separate.
<!-- imported-workspace-claude-boundary-20261001:end -->

<!-- session-send-recovery-status-20261001:start -->
## Native second-turn recovery and Claude model controls (2026-10-01 JST)

The second SSH Claude send was reproduced with the production native runner and a synthetic transport. The observer had included the initially unassigned native session ID in its authority identity; allocation during the first turn invalidated that observer, and its rejected cleanup could block the next connection or model lane. Initial allocation is now allowed once, while subsequent thread replacement and account/runtime/authority changes remain fenced. Retiring an observer detaches listeners and consumes its previous failure before a newly validated connection is attached. Session model changes also settle completed native work before admission.

SSH Claude model controls now consume the same detailed native catalog as the model picker, display its model name, and expose its supported reasoning efforts. Existing-chat runtime changes resolve a ready target on the current source and restore saved model lanes while retaining visible history and the current draft. Native context still belongs to each runtime lane; the existing handoff does not promise lossless context migration. Catalog values retain `[1m]` variants without inventing absent choices or assuming unsuffixed models have a smaller window. Explicit numeric capacity or a returned `[1m]` suffix supplies the displayed capacity. Fast appears only when native metadata declares support, is saved through the existing service-tier selection, and reaches local/SSH Claude launch as session-local `fastMode` settings. Remote configuration revision 2 carries the additive metadata/selection support; older brokers expose no Fast tier until explicitly updated.

Ordinary sends durably capture their exact original preview before dispatch. Confirmed unsent or failed inputs return to an empty editor; newer typing/references are preserved, with explicit recovery merging the saved original. Unknown outcomes remain explicit, and restart never resends them. Attachment, skill and annotation references stay in the backup; attachment cleanup retains recovery and queued-input references. Successful sends remove pending backups, and exact-ID dismissal cannot delete another backup. Queue/steering retain their existing owners. Corrupt recovery data preserves the original state file and fails visibly. Plugin call/register/replace paths, the `composer.recovery` service, three named renderer surfaces, migration/error semantics and UI persistence owners are recorded in documents 36 and 37; the API v1 snapshot was deliberately reviewed and updated.

Validation in a task-only candidate: **1667/1667** full tests and **28/28** focused Claude/recovery tests passed with no failures or skips. TypeScript, plugin contracts (**336 declarations, 303 host methods**), public documentation (**46 files, 0 findings**), UI preferences (**42 keys, 43 hooks, 40 nodes**), production build and remote bundle digest passed. Existing font-resolution and bundle-size advisories remain. **10 hidden Electron cases** passed on the built application with approved disposable plugins: model names/efforts, original restoration, newer-draft merge, same-chat model/runtime switches, 1M/Fast selection and lane restoration, current/later named-surface replacement with cleanup, and full process restart without replay. Light/dark screenshots at a narrow desktop size were inspected. Restoring the previous controller and observer in a bounded experiment caused the two-turn regression test to fail; the final implementation passed.

Evidence remains in ignored `build/qa/` directories and is excluded from release inputs. The source candidate excludes other windows' unfinished edits. No real model request, credential inspection, SSH deployment, remote configuration update, active user desktop restart or production build replacement was performed. Synthetic protocol, approved plugin lifecycle and hidden desktop evidence establish this source behavior; live provider acceptance and deployment remain separate.
<!-- session-send-recovery-status-20261001:end -->

<!-- native-send-preparation-20261001:start -->
## Native message send preparation (2026-10-01 JST)

Existing idle chats prepare the selected native transport on entry; draft preparation also overlaps startup with translation/preview. Local Claude/Codex and SSH Claude reuse a prepared transport for the explicit send. SSH Codex reuses the prepared session connection while retaining quota admission at send. Cold local/Claude sends overlap context discovery and startup, and Codex public bundled-model metadata is cached by executable revision instead of launching the metadata reader on every send. Pending input appears from the durable original-input recovery record before native startup completes, with an explicit waiting-for-receipt label; no acceptance is fabricated or persisted.

Owned speculative transports expire after two minutes and are discarded when model, permission or connection identity changes. Preparation sends no user input/model turn and creates no memory job. Cancellation, failed initialization and unknown receipts retain the no-replay behavior. Plugin API and persistence reviews are recorded in documents 36 and 37; public snapshot review is additive.

Validation uses controlled native transport fixtures for all four routes, including a 160 ms startup barrier moved ahead of explicit send. Millisecond warm-path writes in that fixture prove scheduling only, not live model/VPS timing. Native event/termination, submission recovery, controller/bridge, metadata and approved plugin lifecycle tests accompany hidden isolated Electron pending/accepted rendering and process-restart checks. No real user desktop, live model turn, VPS deployment or release package is part of this change. A new unbound chat and expired/changed connections still incur cold preparation; network and model first-token latency remain outside this optimization.
Validated: full suite 1684/1684 with the installed native Codex executable explicitly selected for the isolated skill-control fixture; typecheck, plugin contracts, public docs and UI preference checks pass. The hidden Electron pending-input screenshot was visually inspected. Final targeted lifecycle regressions pass. Other windows' staged/unstaged changes are excluded from this commit and are not independently certified by this record.
<!-- native-send-preparation-20261001:end -->
# Interaction responsiveness and transport follow-up (2026-10-01)

<!-- interaction-latency-20261001:start -->
The composer clears at dispatch and accepts new input before native receipt. Rejection restores an untouched draft only; later typing survives. Native observation batches semantic writes, avoids core no-op thinking-frame writes and full-state snapshots, and retains audit counts with a bounded publication window. Background React updates yield to interaction, and unchanged native theme values are not reassigned. Running progress distinguishes recent event receipt from five minutes without visible message/tool progress; speed is labelled as the last reported measurement.

Core MCP exchanges now explicitly close HTTP connections while preserving logical MCP session IDs, authorization, concurrent requests and no-replay behavior. This mitigates forwarded idle-socket reuse; the historical connection reset was not reproduced, so its exact cause remains unconfirmed. Incoming thinking metadata and a live remote process do not prove useful model progress. No remote changes, model retries or forced stops were performed.

Validation: full workspace suite 1696/1696, typecheck, plugin contracts, public docs and UI preference checks passed. A real approved synthetic plugin verifies observation policy call/register/replace and disable/reenable on production consumers. A sustained 200-frame private-delta test preserves all receipt counts with at most four persistence updates and no per-frame state snapshots. Hidden Electron validates delayed submit, rejection restoration, newer drafts, streaming input, long-wait labels and full restart; final 20 input fill/read measurements were 5–15 ms in that synthetic profile. These are source/protocol/isolated desktop results, not foreground upgrade, real model throughput or proof that a remote long-running request recovered. Scope excludes concurrent attachment/media edits. See document 36 and document 37 for interface, compatibility and persistence review.
<!-- interaction-latency-20261001:end -->

<!-- live-message-actions-20261001:start -->
## Live message actions repair (2026-10-01)

Image preview previously rejected every SSH-hosted session even when Claude read the image through the bound local-device MCP tool. The reader now admits only this verified local execution route and retains rejection for genuine remote paths. Manual translation previously disabled the last assistant message until the whole running turn ended. It now accepts the current public text snapshot; changed-source completion discards stale output and releases pending status. Automatic intermediate-translation preference is not changed by manual use.

Validation locations: activity image and translation-module regressions; hidden Electron `scripts/test-live-message-actions-ui.mjs` with a real approved synthetic plugin, production image reader, viewer, last running commentary, disable/reenable and full restart. Plugin interfaces and persistence inventory are reviewed in documents 36 and 37. Existing parallel media/attachment edits are excluded from this change. No remote deployment or live model request is part of acceptance.
<!-- live-message-actions-20261001:end -->


<!-- runtime-usage-20261001:start -->
## Claude readable completion statistics (2026-10-01 JST)

Replaces the generic JSON statistics body with readable Chinese labels and units using the same native result record. Preserves separate uncached input/cache counters, zero and unknown values, historical JSON, native chronology and the existing disclosure preference. Adds the named runtime-usage renderer surface for approved multi-instance presentation replacement. Codex keeps the existing metrics footer; the earlier speculative Codex activity change is reversed. No extra model output, request or billing entry is generated.

Validation: isolated candidate typecheck, check:plugins, check:docs and check:ui-preferences passed. tests/usage-presentation.test.ts, tests/runtime-reading.test.ts and tests/session-metrics.test.ts passed 40/40. scripts/test-runtime-usage-ui.mjs passed native result rendering, approved plugin replacement for existing/later instances, disable/reenable and late cleanup, dark narrow layout, full process restart with saved disclosure, and absence of synthetic Codex statistics. Screenshots were visually reviewed; test artifacts remain in ignored build/qa. Real user desktop, exact Claude Desktop wording, paid model tasks and remote deployment are not claimed. Other windows' account, chat-tool and translation edits are outside this change.
<!-- runtime-usage-20261001:end -->

<!-- chat-events-20261001:start -->
## 聊天事件与原生适配诊断（2026-10-01）

已实现：单条聊天交互独立显示，多条相邻聊天交互按聊天语义分组；查看／发送／创建聊天从明确参数或创建回执解析目标，点击通过 navigation/open 跳转会话，不展开工具 JSON。目标不存在时留在当前会话并提示。两家运行时共用识别、分组及导航契约，子会话阅读复用同一 ToolActivity。content/tool_reference 分类为已观察的工具引用元数据；旧 unknown 回执在载入时重分类，不重放工具。诊断复制改用宿主 clipboard/write，等待成功回执并显示失败重试。

插件与持久性：api.activities.chat/registerChat 与 chat-event 多实例 surface 进入实际分组／渲染路径，停用恢复；旧披露键保留，无新可调 UI 或持久格式。文档 36、37 与契约快照同步。代码审查覆盖活动目标、分组边界、桌面导航、剪贴板、原生分类；没有新增仅核心可用的选项目录。

验证：42 项聚焦协议／活动／偏好测试通过；隐藏生产 Electron 的 Codex 与 Claude 合成事件均验证单条呈现、多条分组、查看／发送／创建跳转、键盘操作及缺失目标。真实批准插件验证注册、失败回退、多实例、停用重启用及失效句柄；诊断复制经本机宿主剪贴板回读并注入失败恢复。偏好验收覆盖 228 条活动、完整进程重启、插件 override 停用恢复。typecheck、check:plugins、check:docs、check:ui-preferences 通过。仅本轮增量进入本地提交；并行工作不纳入本轮交付。未操作真实用户桌面，未执行真实模型任务、SSH 出网或远端部署。
<!-- chat-events-20261001:end -->


## 2026-10-01 Claude SSH session fork completion

Removed the local-only Claude fork restriction for native-owner SSH sessions. The controller now resolves the recorded assistant UUID, the SSH bootstrap forwards lineage, and the owner validates source ownership before launching a distinct native fork. Child resumes use their own identity; old brokers cannot silently replace a branch with a blank session. Existing local Claude and Codex behavior is retained.

Evidence: isolated source/type/plugin/docs/preference checks and synthetic owner/transport/controller tests; an approved ZIP plugin invokes the production fork and continuation path with disable/reenable coverage. This is not remote deployment or real-model acceptance. No user profiles, credentials or real conversations are read.


### File reader tabs and adjacent close controls (2026-10-01)

The shared local/remote FileBrowser places close-all immediately beside the Files tab, with no far-right header close. Each file retains its own adjacent close; switching tabs preserves order, and closing one file keeps the remaining previews. Close-all and Escape clear previews and invalidate pending reads before exiting; retained connection readers reopen at their directory. Both Claude and Codex message readers use this implementation.

Scope review: existing file navigation call/register/replace paths and named reader surfaces are unchanged; document 36 records lifecycle and contract compatibility, and document 37 records the existing transient file-tab exclusion. Validation in an isolated HEAD-based candidate containing only this change: typecheck, check:plugins, check:docs, check:ui-preferences, isolated hidden Electron file-browser lifecycle and full file-resolution UI checks (including approved synthetic plugin activation and both runtime readers). This is source and isolated hidden-desktop evidence, not acceptance in the running user desktop, real remote SSH filesystem, model task or release package. Other windows' changes are excluded from this commit.

The shared working directory also contains unrelated in-progress account changes: its checks reported an account-catalog test type mismatch, a plugin snapshot mismatch and a missing accounts/set-enabled documentation entry. Those changes were not repaired or included here; the isolated candidate passes the four required gates.


<!-- runtime-switch-response:start -->
## 运行时切换响应与离线入口移除（2026-10-01）

修复：runtime/choice 不再强制刷新全部原生／SSH 模型目录，读取现有生产目录；手动刷新保留。切换时立即显示目标与切换状态，阻止重复切换、发送和模型／权限修改；失败恢复当前身份，离开草稿后丢弃迟到结果。Codex、Claude Code 和注册运行时复用同一路径。用户界面移除离线示例选项与固定样例入口；内部测试协议保留，新建／旧 demo 草稿需选择真实运行时才能发送，历史数据不删除。

接口审查覆盖 models.targets、runtime.native-provider、runtime/choice、runtime/select、session/model-target、现有状态事件及 composer-runtime/composer-model 挂载点；无新增核心专用选项目录，无公开签名或持久格式变化。文档 36、37 同步说明兼容与生命周期。隔离测试和隐藏 Electron 的合成数据不等于真实模型、SSH 出网或正在运行的用户桌面验收；其他窗口改动不在本轮范围内。
验证：隔离副本 typecheck、check:plugins、check:docs、check:ui-preferences 通过；32 项目录、运行时、插件与偏好测试通过。隐藏生产 Electron 验证两家切换、草稿保留、失败重试、新建聊天迟到保护、完整进程重启及批准插件注册／停用／重启用／后来实例。合成环境三次切换为 103–121 ms，未触发强制目录刷新；不代表真实 SSH 延迟。截图已检查。
<!-- runtime-switch-response:end -->

<!-- claude-card-controls-status-20261001:start -->
## Correct shared Claude quota cards, reset confirmation and remote enable scopes (2026-10-01)

Corrected the previous partial reuse: logged-in SSH cards no longer embed legacy native status/login-command/browser-login management. Local and remote cards now share quota summary, fixed 5h/Weekly rows, reset-card disclosure and usage summary. Remote Claude consumes persisted numeric official stream observations through the existing quota-read RPC; missing/expired windows remain unknown instead of disappearing or displaying invented percentages. No token/cookie/credential reader or background model request was introduced. The verified Claude native contract still has no reset-card enumeration/redemption; Codex card reads, preview, second confirmation, cancellation and idempotent uncertainty recovery are retained.

Account header switches now have independent broker-backed global and workspace scopes. Administrator disable denies every workspace; workspace disable affects only itself, and administrator reenable preserves workspace choices. Catalog selection, controller admission and native execution validate effective availability, generation and membership. Registry persistence uses optimistic revision checks. Existing assigned and authenticated accounts remain visible for management when disabled.

Validation uses a task-only candidate with protocol tests, approved ZIP service activation/interception/recovery and hidden Electron using real local/remote components. The UI fixture checks actual quota values, absent legacy controls, both switches, no fabricated unknown values, reset cancellation and exactly one confirmed redemption, login dialogs, themes/narrow layout and full process restart. The candidate passed 151 focused tests, all 12 hidden desktop checks, typecheck, plugin contracts (344 declarations, 309 methods), public documentation, UI preferences and production build. Screenshots of actual shared components were visually inspected. Existing font and chunk-size build advisories remain. No real user account, live remote login, credentials, running desktop replacement or deployment was used. Updated remote source and bundle metadata require separate authorized deployment; synthetic quota values are not measurements of a real account.
<!-- claude-card-controls-status-20261001:end -->

## 2026-10-01: Member workspace export lifetime

Added five export durations: 1h (new-export default), 6h, 12h, 1day and 7day. VPS issuance and redemption own the deadline; export/import devices no longer decide expiry using their clocks. A successful first grant consumes the file; original-key receipt recovery and existing authorized devices remain valid. Shared authorization paths cover both Codex and Claude members. Added the named duration surface and typed optional service/command parameter; document 36 records registration, replacement, compatibility and lifecycle. Document 37 records the transaction-state exclusion.

Validation is source/protocol and isolated hidden-desktop evidence using synthetic approved plugins, not real remote deployment, provider execution or the running user desktop. Passed 82 targeted regression tests (including the added HTTP boundary case), all four project gates and seven isolated hidden-desktop acceptance scenarios. Light/dark narrow-layout screenshots were reviewed. The historical pre-U70 studio fixture could not navigate its retired layout and is not counted as passing evidence; the new current-production export suite covers both active entry points. Full release build remains blocked by a pre-existing account-broker configuration digest mismatch in the HEAD baseline; no account-broker files are changed here. Hidden desktop acceptance uses a separate QA host bundle and is not release-build proof.

<!-- claude-active-quota:start -->
## Claude active quota read repair (2026-10-01)

The previous shared-card change exposed cached native rate-limit events only; it did not actively fetch subscription windows. Both local official inspection and SSH `accounts/usage` now request native `get_usage` after initialization without submitting a model turn. The parser handles 0–100 utilization and ISO reset times for five-hour and weekly windows. The remote response excludes session/behavior data, checks authorization again and cleans up its own metadata process. Unsupported, missing or malformed responses stay unavailable rather than fabricated or silently refreshed from stale receipts.

Plugin interface and UI preference review: documentation 36/37; no public signature or persistent choice changes. Existing global/workspace switches and reset-card view/administrator confirmation boundaries remain. The researched Claude interface has no reset-card capability; no redemption endpoint is invented. Source/protocol and approved plugin lifecycle tests are isolated from real profiles. Validation: 64 focused tests passed, including approved plugin activation/disable/re-enable; typecheck, plugin, public-doc and UI-preference gates plus production build passed. The existing hidden-desktop regression passed 12 checks for shared quota cards, scoped switches, modal cancellation, reset confirmation and preference restoration; its quota values are synthetic and not live-account evidence. An actual CLI 2.1.286 empty-profile probe returned successful `get_usage` with no available subscription, confirming protocol support without real account data. no remote deployment, real subscription read, real card consumption or foreground desktop replacement is claimed.
<!-- claude-active-quota:end -->
## 2026-10-01: SSH quota retention, allocation sources and model catalog discovery

Implemented cache-first official quota cards, persistent successful quota receipts, failure retention with original timestamps, and no unnecessary reload on card re-expansion. Claude account cards no longer render Codex reset-card controls; Codex redemption still requires the existing preview plus second confirmation and only administrators can redeem. The quota ledger now exposes allocation rows for administrator and workspace cards, marks the current workspace, keeps lender and repayment labels, shows negative overrun values while clamping progress bars at 0%, and distinguishes observed local token totals from the administrator's provider-wide windows.

SSH model selectors now actively discover a remote Claude catalog on first access, reuse the last verified list without another request, and preserve that list when a refresh fails. Catalogs are invalidated only by verified connection/account identity changes. Actual read-only VPS acceptance on 2026-10-01 returned `ready` quota windows, 12 Claude models from `runtime/models`, and `runtime/status` with `authenticated: true`, `execution: local-mcp-required`, version `2.1.286 (Claude Code)`. Source evidence is separate from the running desktop; no remote deployment or user credential was changed.

Validation: 103 focused tests, `npm run typecheck`, `npm run check:plugins`, `npm run check:docs`, `npm run check:ui-preferences`, plus read-only `build/qa/quota-live.ts` and `build/qa/quota-live-models.ts`. The 15-check hidden Electron suite covers shared cards, allocation rows, approved plugin replacement/restoration, narrow themes and complete process restart in a synthetic profile; screenshots were visually inspected. The isolated production build also passed. These checks do not establish deployed allocation behavior: the VPS quota service changes require a separate authorized deployment. Existing unrelated dirty files remain outside this change.

Workspace allocation now uses weekly quota only. Official account five-hour windows remain visible. Legacy fiveHourPercent fields and stored history remain readable but do not drive allocation accounting or admission; new administrator edits clear that legacy allocation. Confirmed weekly reset restores cycle shares, clears current reserve/overdraft usage and repays each original lender, carrying unpaid debt. Multiple account cards fill rows horizontally before wrapping; responsive wrapping adds no preference and retains existing disclosure keys. Existing named card/allocation surfaces remain the replacement interface.

<!-- desktop-updates-20261001:start -->
## Desktop installer and push-triggered updates (2026-10-01)

Implemented a stable Windows bootstrap and per-user one-click NSIS package named AgentWorkbench, including desktop and Start menu shortcuts. Pushes to main build the latest application and deploy a generic GitHub Pages feed; only the stable bootstrap uses a Release. Startup/five-minute checks download in the background; the lower-left action installs and restarts only on explicit click and refuses active or uncertain tasks. Local development disables public update checks. Approved backend registration and named UI replacement follow document 36; document 37 inventories transient state and existing profile ownership.

Local acceptance includes an approved synthetic ZIP backend, hidden production progress/ready/click/disable/reenable/restart UI, production packaging, bootstrap compilation and package/manifest hashing. A separately named QA build downloaded and installed 0.1.0, downloaded 0.1.1 through the actual updater, and launched the new executable. A subsequent full process restart confirmed 0.1.1 and the retained synthetic dark preference. Both shortcuts resolved to the new executable. The first auto-restart could not be reattached through the QA debugging port, so post-upgrade IPC verification used the subsequent restart. QA identity/feed/profile modifications are not production source. QA installations and both shortcuts were uninstalled after acceptance. No native runtime, real model task or remote deployment was used. Hosted CI/feed validation remains a separate publication gate; unsigned packages and offline readiness limits are documented in document 38.
<!-- desktop-updates-20261001:end -->

## Installation failure audit (2026-10-01)

The first public source and installer documentation commits were `17b93c5` and `fbcd9f9`. A reported Claude Code official-install failure was not diagnosable from the original UI: the child process discarded stderr and displayed a generic network/permission claim for every nonzero exit. The current device now reports an installed `claude.exe` 2.1.286, and the official script, release version and manifest endpoints returned HTTP 200 during this audit. Those observations do not prove the cause of the earlier failure. The local change classifies bounded native command output into fixed stage codes, avoids exposing raw diagnostics, and gives the online desktop bootstrap a stage-specific failure label. Desktop updater disposal now guards late events, cancels a download once its token is available and observes the cancelled download rejection; a production-backend regression covers disposal before the update response. Source tests and package checks are reported separately from the already published installer and running desktop. No push, release replacement or real native reinstall is included in this repair.

The published `0.1.2` Pages bootstrap and update manifest agree on filename, size and SHA-512, but this is transport integrity only. The independent plugin recovery workflow failed on the same commit after Windows process enumeration exceeded its ten-second timeout; the desktop update workflow still deployed. The update workflow now runs serial plugin contract tests and hidden recovery acceptance before packaging, while the process enumeration and guardian response deadlines accommodate bounded Windows startup under load. This gates future publication, not the already deployed `0.1.2`. The quota allocation preview also restores the legacy five-hour value with an explicit note that it is no longer used in current allocation. The native-skills test requires a compatible Codex executable; the local full-suite failure used a stale npm executable path, and the focused test passed with an isolated pinned executable. No real-account installation or foreground desktop replacement was performed.

2026-10-02 follow-up for the reported other-device Claude Code failure: the screenshot shows the default native installer failing with an unknown official-command result; the disabled npm option's Node tooltip is unrelated. The checked official PowerShell bootstrap still uses `claude.ai/install.ps1`, downloads a versioned executable, then calls `claude install`. The desktop now distinguishes a Git Bash prerequisite, proxy authentication, TLS/certificate failure and failure inside that final native setup step through bounded error codes; the selected native method visibly states that Node/npm is unnecessary. The same official command, no automatic npm fallback and the existing idle/maintenance protections remain. Isolated process and CLI tests cover both native channels, failure mapping and no-Node installation. The other user's original installer output and device state were not supplied, so this source change does not prove or repair that device's specific failure; it requires a new attempt on that device for exact diagnosis. No release, push, deployment, native reinstall or user profile change is included.

## Windows install location and managed data relocation (2026-10-02)

The Windows installer is now interactive (`oneClick: false`) and exposes a program-directory picker. Fresh installed builds derive an owner-specific `AgentWorkbenchData` sibling from the selected program location. Settings exposes the actual managed root and a typed `desktop.data-directory` service with choose/migrate/restart operations. The move runs only after active/uncertain sessions, CLI maintenance and renderer preference flushes are clear; it writes an external locator, copies and hashes managed data, updates known path fields, repairs verified Git worktrees (including a previously customized managed root), and resumes or stops from a recovery inventory after interruption. External project roots, message text, credential bytes, unrelated plugin data and unowned OS cache remain untouched. Profile-owned clipboard attachments are copied only after metadata and hash verification. Successfully completed moves remove the old managed root and verified legacy aliases. Corrupt locators, links, special files, conflicts, changed sources and unsupported repositories stop startup without opening an empty profile.

Codex's selected custom directory is an explicit pre-install program path. The official Windows variables `CODEX_HOME` and `CODEX_INSTALL_DIR` are passed only to native install/update/removal; runtime login, memory, skills and plugins keep their existing native environment. Existing Codex and Claude Code installations are not silently moved; Claude has no verified equivalent custom program-directory contract in this delivery.

The reported Codex 0.136.0 update-disabled screenshot came from another device; its exact executable path is unavailable. Reproduced fixes cover Windows Path casing and nested/hoisted npm layouts. Unowned PATH binaries retain update/removal protection and now offer an explicit separate native installation for both runtimes. Synthetic tests preserve the original binaries and prohibit automatic conversion. This does not claim the screenshot device has been repaired.

Validation: isolated source/protocol coverage includes relocation/CLI tests, 17 app-data tests, 6 hidden UI checks, real Electron cross-volume bootstrap/restart/locator checks, custom-root managed-worktree repair, approved ZIP service replacement and disable/reenable, full serial Node test suite **1795/1795, zero skipped**, typecheck, plugin contracts (359 declarations, 315 host methods), public docs, UI preferences, production build, Windows x64 NSIS package `0.1.3`, bootstrap compilation and an installed-package smoke run. The packaged ASAR excluded QA/build/profile files and preserved a dark preference across two real packaged launches. A separately identified QA installer used the exact production ASAR, installed with an explicit target directory, passed the same restart smoke and was uninstalled after verification. Interactive directory selection is enabled in the NSIS configuration; the automated installation used `/D`, not a visual wizard walkthrough. An earlier concurrent candidate run had two timing failures in native-memory readback and title cleanup; the focused recheck and final complete serial suite passed. The final package was built from an isolated candidate excluding unrelated uncommitted work. Evidence is isolated and local: no real profile, native login, model task, remote deployment, push or release replacement was performed.

<!-- streaming-media-repair-20261002:start -->
## Streaming interaction, viewed-image access and file-link repair (2026-10-02)

The reported Windows link failed because Markdown consumed separators before punctuation in a native drive path. The lexer now preserves the raw native destination for inline, image and reference links without rewriting message text or ordinary web links. Viewed images in managed task directories were incorrectly rejected by the profile credential guard; the display-only route now admits only the bound workspace image subtree and resolves relative paths from the activity/session directory. On-demand managed snapshots survive source deletion and process restart. Credentials, remote paths and path escapes remain protected. No image bytes are appended to messages, persistent state or automatic model input.

Streaming rendering now reuses equal IPC branches and stable Markdown work, caches message blocks/timelines, mounts collapsed activity bodies on demand and skips offscreen turn layout. Local Codex, local Claude, SSH Claude and SSH Codex public text writes use the existing registered batching policy, with completion barriers draining exact text in order. Rendering/queue changes do not add an outer continuation or alter native tool/input ownership. Plugin and UI-preference inventories, compatibility and lifecycle evidence are in documents 36 and 37; unchanged public signatures require no snapshot refresh.

The isolated long-conversation comparison measured editor fill/read median 176 ms and P95 223 ms before, versus median 48 ms and P95 76 ms in the final candidate. This is a synthetic paired profile measurement, not a real-model throughput guarantee. Approved synthetic plugins exercise policy consumption, local file HTML preview, Codex/Claude image preview, mounted/later surfaces, disable/reenable, image disclosure restart and snapshot reuse after deleting the original. Source and hidden desktop evidence remain separate from the running desktop, installation and remote deployment. Other windows' installation/update/profile changes are excluded from this delivery.
<!-- streaming-media-repair-20261002:end -->

## Windows packaged data root correction (2026-10-02)

The packaged default data root is now the short `%LOCALAPPDATA%\AgentWorkbench`, independent of the executable directory and without an owner hash. The bootstrap locator records the current default separately from an explicit user-selected directory. A locator created by the former generated `AgentWorkbenchData/<hash>` default is migrated once with the existing hash-verified recovery journal; custom locations remain untouched. This addresses the reported long path and prevents a normal same-drive install from being presented as an unexplained relocation.

Interface review: the existing `desktop/data-directory` commands, `desktop.data-directory` service and `data-directory-settings` surface remain the call/register/replace points; only the packaged default and bootstrap compatibility semantics changed. No new UI preference or provider catalog was added. Documents 36 and 37 record the typed `legacyDirectory`/`defaultDirectory` compatibility fields, failure behavior and persistence scope. Validation is covered by `tests/app-data-relocation.test.ts` and `tests/app-data.test.ts`; a real installed package still requires a newly built installer and is not inferred from source tests.

## Workspace quota attribution repair (2026-10-02)

Source repair separates account-wide quota from workspace entitlements: a mid-cycle baseline and later unassigned consumption no longer reduce every workspace proportionally. Exactly reconstructable legacy baseline deductions are credited once while debts remain intact; old later unassigned deductions without a complete attribution journal cannot be reconstructed exactly. Native account exhaustion remains a separate admission boundary. Member cards retrieve policy and workspace identity from quota/context rather than overwriting it with the account catalog login name. A legacy authority displays its policy with an explicit history-protocol warning.

Both Codex and Claude use existing numeric modelUsage receipts, verified account/host bindings and native producer scopes for idempotent historical totals. Pre-baseline receipts within the confirmed weekly window are recovered separately; enough aligned live samples permit a bounded estimated percentage, otherwise the card says pending calibration. Deleted sessions without retained binding evidence, ambiguous forks/model lanes, unknown account migrations and unrecorded native activity remain outside recovery. No real user database or raw chat was read. This is source/protocol and isolated UI validation, not a claim that a running remote authority has been updated or that every historical token can be assigned. Remote deployment and foreground acceptance remain unperformed.

Validation for this repair: 82 targeted protocol/unit checks passed across workspace-control, quota-coordinator, quota-allocation, account-usage and both Claude SSH/control suites. The isolated account-dialog run passed 16 checks, including approved ZIP activation/disable/reenable, pending history calibration, both native quota presentations and complete process restart. Plugin contract, UI preference, documentation and TypeScript checks passed. Existing unrelated observation/reading edits were not part of this change or its commit. The current remote daemon and actual account balances were not modified or claimed verified.

## Shared allocation endpoint follow-up (2026-10-02)

The subsequent advisory-accounting repair removes shared-ledger I/O and estimated allocation checks from core model admission for both SSH runtimes. Native identity/permission/provider enforcement remains. Begin reporting runs in the background; finish first persists numeric receipts independently of SSH, combines outstanding same-scope deltas and protects newer receipts from late acknowledgements. Member usage reads resample existing windows, and provider-query failures preserve numeric completion before returning a diagnostic. Three concurrent producers settle together; the first positive aligned sample automatically enables a bounded historical estimate. Token ratios remain estimates when model/cache mix differs or outside activity is unobserved. No manual calibration control or new preference was introduced. Protocol, actual local Linux UID/socket and approved-plugin/controller fixtures verify the source; live VPS deployment, foreground desktop replacement and real model acceptance are not claimed.

Validation: 129 targeted tests passed, with all 68 affected coordinator and native-controller tests repeated after removing the final accounting-only catalog lookup. Seven real local Linux socket checks passed, including provider failure and deduplicated recovery; the isolated account-dialog exercise passed 17 checks covering approved surface lifecycle, both providers and process restart. TypeScript, build, plugin-contract, UI-preference and public-document checks passed. Reviewed shared runtime paths, persistent numeric receipt ownership and service cleanup; no new core-only option list or selector was added. Unrelated observation/reading changes in the shared worktree were excluded from the commit and are not certified by these results. The compiled development output is not an installed-release or live-VPS update.

Removed quota explanatory footer blocks. Both native runtime paths now use a versioned common quota endpoint, with administrator reads forwarded to the same process used by members. Member cards retain all permitted workspace rows for the selected account; external updates invalidate the assumption that a local usage revision is a ledger revision. Account ID/generation isolation is verified for totals and windows. The new endpoint shares the existing registry and registry lock, uses separate runtime files and lifetime lock, and does not terminate old processes. Existing administrator discovery prepares it; member-only deployments and formal control installations require coordinated administrator maintenance. Source changes have not updated a live VPS. Per-space totals aggregate reported devices; unreported activity and individual device breakdown remain unavailable.

## Live quota and SSH acceptance follow-up (2026-10-02)

Live diagnosis found a second failure beyond the advisory-admission repair: an idle Claude five-hour window reports zero usage without a reset clock. The embedded native quota reader forwarded that incomplete window, causing the authority to reject the valid weekly observation as well. The reader now validates each window independently and omits unknown, expired or invalid clocks without inventing a reset. The regression executes the embedded Python source and production calculator, proving that an idle short window no longer prevents weekly calibration or completed numeric receipts; valid Codex windows remain supported.

The running development desktop was replaced from an isolated candidate excluding unrelated observation/reading edits. The workbench-owned remote quota calculator, service and embedded reader were backed up and updated; the native account broker, account configuration, workspace authorizations and shared ledger were preserved. Both existing member kernel identities passed catalog, runtime/model availability and quota context/read/official-observation checks. These member checks used the verified administrator SSH connection with a UID drop; they do not certify another member device's SSH key or installed desktop version.

Exactly one authorized real model submission traversed the running desktop's production draft/prepare and draft/submit backend routes, SSH bridge and native Claude execution. The reply matched the synthetic acceptance marker, the native model receipt identified claude-opus-5-5, and the turn completed with one model step, no child task and no retry event. The shared ledger's numeric increase matched the native token receipts, and both member identities read the same resulting total. Official weekly usage did not increase during this small task, so live conversion remains pending a positive aligned sample; automatic calibration and three-producer attribution were verified in isolated calculator tests, not fabricated from a zero increment. Temporary translation and memory-handoff pauses were restored and the existing draft recovery was retained.

Validation includes quota coordinator, native reader/calculator, workspace control, both native controller suites and the approved synthetic quota-plugin activation/disable/reenable lifecycle. TypeScript, compiled host, plugin contracts, public docs and UI preference checks passed. The running host hash matched the isolated candidate. No computer-use actions were used for this final backend acceptance. Private evidence remains under ignored build/qa/quota-repair-live. This is live Claude backend and shared-authority evidence, not final visual acceptance, another device installation, or an installed release. The configured remote catalog had no Codex account; no real Codex model task was authorized or sent. There was no push or publication.

## Local repair package and installer paths (2026-10-02 JST)

Publication follow-up: the public download entry now uses `/releases/latest` and describes versioned full installers, replacing the stale fixed bootstrap-tag link. The Pages updater and legacy bootstrap compatibility manifests keep their existing protocol, signatures, permissions and lifecycle. This download-link change adds no preference or adjustable UI state. Release publication and removal of superseded releases require explicit user authorization and separate hosted-artifact verification; source checks alone do not establish publication.

Filename clarification: both the NSIS package and newly compiled online bootstrap use `<version>.exe`. `scripts/build-bootstrap.ps1` reads and validates the repository package version instead of emitting the old fixed bootstrap name. This is a build-output change; the installer window text and application identity are unchanged. Existing published attachments require a separate authorized publication to change.

Filename verification: the existing local repair NSIS package reports version `0.1.5`, is named `0.1.5.exe`, and matches its feed SHA-512 before and after copying to the normal distribution directory. An isolated bootstrap compilation emits `0.1.0.exe` from the current source package version; an invalid version is rejected before compilation. TypeScript, plugin contracts, public documentation, UI preference checks and all seven desktop-update tests passed, including approved ZIP activation/disable/reenable. This checks filenames and build compatibility, not a new installed-profile or cross-device SSH acceptance.

Fresh per-user installers now default to the short `AgentWorkbenchApp` directory directly under LocalAppData, separate from the existing `AgentWorkbench` data root. Existing registered program paths, explicit `/D` and the directory picker remain supported. The per-user mode callback no longer recalculates the directory after initialization or when revisiting a chosen path. The NSIS artifact is named only `<version>.exe`; the update feed and new online bootstrap use that name. The feed also retains a verified old-name alias and `bootstrap.json` for previously distributed online bootstraps, while the new bootstrap reads `bootstrap-v2.json`. Local packages carry an explicit distribution marker and do not consume the public release feed; only CI publication candidates opt into it. This prevents an older published source tree with a larger release version from replacing an unpublished repair.

The reported empty configuration was reproduced as a running instance using a newly created deep profile while the original short profile and its external locator remained present. Installed binaries had been replaced by a different published package. Recovery preserved both profile trees, replaced only verified program binaries and checked actual userData, the settings surface and original configuration counts through the production API after process restart. No chat content or key material was inspected. Current short-root recovery is distinct from other devices' SSH authorization and intermittent network connectivity, which this installer change does not prove repaired.

Interface, lifecycle and persistence reviews are recorded in documents 36 and 37. Validation covers update eligibility, approved backend activation/disable/reenable, short-root bootstrap and the NSIS path macro; type, plugin, public-doc and UI preference gates are required. Candidate and package evidence stays in ignored local QA directories; no remote deployment, push or publication is included.

The isolated `0.1.5.exe` package installed locally with explicit `/D` to the short program directory. The installer exited successfully; the registered uninstaller and Start-menu shortcut point to that directory. Launching through the shortcut produced a responding main window, and Chromium used the original short profile. The profile state and UI preference file hashes matched their pre-install backups. `latest.yml` and the new bootstrap manifest name `0.1.5.exe`; the legacy bootstrap alias has the same SHA-256. This is one-device installed-package evidence, not another member device's SSH authorization or a published release.

## Reading scroll responsiveness (2026-10-02 JST)

Streaming output no longer fights a user's upward mouse-wheel gesture. The original reading pane records upward intent before the follow-up browser scroll event, so new public deltas leave the viewport where the user placed it; reaching the bottom restores normal follow behavior. Redundant bottom writes are skipped, and the conversation reading snapshot is deferred so urgent editor and control interactions can run while a long history is reconciled. Timeline overscroll is contained and browser anchoring is disabled for this pane.

Validation: `scripts/test-streaming-workspace-ui.mjs` passed the existing streaming/editor checks plus an isolated production Electron check that moves the original pane away from the bottom, dispatches an upward wheel event and verifies the scroll position remains stable while a second public stream runs. Plugin contract and UI preference reviews are recorded in documents 36 and 37; no new preference or plugin surface was introduced. This is source and isolated desktop evidence, not a foreground replacement, live provider throughput measurement or release-package acceptance.

## SSH metadata failure reporting (2026-10-02 JST)

Read-only live probes found intermittent SSH server-banner timeouts even with valid administrator and member identities. Workspace discovery previously reduced the failure to exit 255, and account listing misreported it as an unavailable or undeployed broker. Both paths now classify the transport failure into fixed redacted desktop diagnostics. Discovery, account catalog reads and Claude model catalog reads allow one additional attempt only for a confirmed pre-banner timeout, within the original deadline. Writes, login, device registration and model execution do not inherit this policy.

The production controller and approved-plugin lifecycle are covered by tests/ssh-read-plugin.test.ts; tests/ssh-read-only.test.ts verifies retry limits, cancellation, deadline preservation, redaction and mutation non-replay. Interface/persistence review appears in document 36. No connection, credential or UI-preference migration is added. Live probes verified an existing Claude account; the configured service had no Codex account, so synthetic cross-provider coverage must not be described as a real Codex task. Network availability remains distinct from desktop source correctness and publication.

## Workspace account selector recovery (2026-10-02 JST)

A new draft using an API model previously suppressed its workspace account selector, and Claude also required a preloaded native-owner catalog before rendering the control. Both native runtimes now retain the workspace account entry for a new draft, discover absent catalogs, and move to the explicitly selected SSH account while keeping draft text. Model controls now use the provider-specific full account reference instead of the Codex-only raw account ID. Existing sessions retain their original bound identity.

Explicit model refresh now reads workspace account metadata before enumerating models; accounts without a usable default remain visible with a selection explanation. Concurrent account refresh is coalesced, stale connection results are rejected, and passive renderer responses cannot overwrite the explicit refresh. Unavailable account cards recover on settings reentry. Plugin and preference reviews are in documents 36 and 37; verification uses disposable synthetic providers and profiles without production account requests, deployment or replacing the active desktop.

Validation result: the isolated task-only candidate passed typecheck, check:plugins, check:docs, check:ui-preferences and 77 focused protocol tests. The new production hidden-desktop exercise passed both provider account flows, source refresh, draft preservation, approved current/later account-surface replacement and full process restart; the existing model-switching desktop regression also passed for both providers. A narrow dark screenshot was reviewed. No real user profile, credential, remote deployment or model task was used.

## 2026-10-03 third-party completion boundary repair

A cross protocol Codex connection to a third party model previously added a synthetic completion tool and treated a successful text stop without that tool as `NATIVE_COMPLETION_REQUIRED`. That behavior returned valid provider answers to the composer as failed sends. The boundary now accepts the provider protocol's successful stop for automatic tool choice; only an explicitly required tool policy still requires a tool call. When a provider chooses the optional envelope after already streaming the same answer, the repeated text is collapsed and the final answer is emitted once. Real incomplete streams, invalid protocol frames, explicit tool policy violations and mixed completion/action calls remain errors. Translation was disabled in the reported session and no translation path was changed.

The affected public surface is `runtime.native-completion` (`NativeCompletionCodec.prepare`, `NativeCompletionBoundary.finish/push`, `NativeCompletionReceipt`) and the native gateway completion receipt. No new UI preference or persisted field was added. Validation covers normal text completion, repeated envelope text in Responses and Anthropic streams, distinct progress plus final envelope, explicit tool policy, provider compatibility and approved plugin lifecycle.

Validation: 30 focused tests passed. A task-only archived candidate passed typecheck, plugin contracts, public documentation and UI preference checks, plus 18 installed Codex/Claude CLI scenarios using synthetic providers (plain text, repeated envelope, tools, same-protocol and approved plugin enable/disable/reenable/removal). The complete suite ran 1,872 tests: 1,869 passed, two skipped and one native-skill fixture failed because the candidate lacked its default test executable path. Supplying the installed Codex executable made all 13 tests in that fixture pass; no source change was needed. No live third party credential, authenticated model task, desktop package or remote deployment was used. The exact private session history was not read; the screenshot error and reproducible code paths are the evidence boundary.


## Streaming workspace responsiveness (2026-10-03 JST)

The model-running workspace and conversation scroll repair reduces repeated work in the shared Codex/Claude renderer. Folded historical process bodies now unmount until opened. Reading defers a complete presentation snapshot, so a changed inline render callback no longer rebuilds history in the urgent input pass. Branch eligibility shares a completion/message index per immutable session snapshot; host operations still revalidate current state. Plugin DOM discoveries are batched by animation frame while registration/disposal stay synchronous. Scrolling dismisses the transient selection toolbar instead of repeatedly measuring selected text.

Locate-original and paired translation clicks open the original process through its existing persisted disclosure before resolving the DOM. The image log now renders thumbnails from the effective disclosure preference, fixing saved-open logs with missing thumbnails after restart. Named surfaces, registered activity classifiers and annotation actions keep their call/register/replace paths; mounted/later consumers, stacked replacements, attribute discovery, asynchronous cleanup and disable/reenable are covered by approved synthetic plugins. The interface and UI preference inventories are recorded in documents 36 and 37; no new option, preference schema or core-only extension branch was added.

The isolated 100-turn comparison used the same source base, synthetic formatted messages, public stream and 32 alternating wheel operations, run serially. An initial paired Codex run measured editor automation median/P95 147/173 ms before and 137/164 ms after; wheel automation P95 61/48 ms; frame interval P95 50/33.4 ms. An initial Claude candidate also completed the behavior checks with frame interval P95 33.4 ms; paired final runs are recorded below. Timings include automation and CPU profiling overhead, vary by run, and do not measure native input-to-photon latency or real provider throughput. Source/profile evidence must not be read as proof that every long chat is smooth.

Validation records use disposable production Electron instances and approved fixture ZIPs under ignored QA directories. No actual user chat/profile, credential, model task or SSH endpoint was used; no active desktop or installed package was replaced, and no push/publication/deployment occurred. Final checks and repeated measurements follow.

Final serial 100-turn runs (milliseconds; automation/profiling overhead included):

| Runtime | Editor median before / after | Editor P95 before / after | Wheel median before / after | Wheel P95 before / after | Frame interval P95 before / after |
| --- | --- | --- | --- | --- | --- |
| Codex | 142 / 137 | 164 / 164 | 40 / 35 | 50 / 62 | 33.4 / 33.4 |
| Claude | 146 / 128 | 187 / 152 | 38 / 36 | 63 / 46 | 33.4 / 33.4 |

The final Codex wheel tail was slower in this sample, and frame P95 did not improve in the repeated comparison. These measurements support reduced repeated work and modest input improvement, not a stable scroll-latency percentage or a claim that active-desktop stickiness is eliminated. No further repeated runs were selected to hide this variability.

Validation: 43 focused unit/protocol tests passed with no skips; both final runtime streaming fixtures passed all four behavior groups. Hidden desktop annotation (15), native event/plugin lifecycle (21), disclosure preference (3) and bilingual tracking/layout (10) checks passed with no renderer errors. The tracking regression exposed a stale first-focus handler after a narrow/wide view change; session/layout/tracking-mode changes now commit immediately while same-view streaming stays deferred. Reviewed light paired-reading and dark compact screenshots. TypeScript, plugin contracts (366 declarations / 317 host methods), public documentation and UI preference inventory (42 keys / 43 hooks / 39 nodes) passed. Source base and task file hashes are recorded in ignored QA scope metadata; concurrent changes were preserved.

## D001-D004: translation and full-access command acceptance (2026-10-03)

Mixed-language translations and credential-like examples no longer fail lexical admission. Unfinished Markdown code fences remain literal and can proceed through preview, including registered translation providers. Full-access API commands use the existing permission selection without an additional approval; default, read-only, plan and asynchronous permission rechecks remain. A named production `runtime.api.tools` service exposes command execution replacement with disable restoration. Contracts and migration semantics are in document 36; ordered progress for the authorized 134 items is in `defensive-ux-progress-20261003.md`.

Validation: 88 focused tests passed, including approved synthetic ZIP providers/executors, real local synthetic command execution, original-code round trips, approval denial, late permission changes and plugin disable/reenable. Typecheck, plugin contracts, public docs and UI preference checks passed. No new adjustable UI state, stored format or shipped default. No real model, SSH task, running desktop update or release is implied. Review found no additional defensive gate or core-only command implementation; cleanup and concurrent submission semantics remain.

## D005-D008: immediate reversible actions and useful diagnostics (2026-10-03)

Project archive/removal now executes directly and offers undo; permanent chat deletion retains confirmation. Explicit original-input previews no longer need a second language-specific confirmation flag, and automatic bypass submission remains disallowed. Chat creation validates direct-request quote provenance without Chinese/English intent regexes; its model contract still requires explicit user intent. Error formatting preserves lengthy diagnostics and authorization explanations while removing credential values, with operation-specific cancellation/timeout labels. The new project-action and error-formatting services are the actual production instances used by host calls; approved plugins can replace their named methods and restore on disable.

Validation: 51 focused tests, production build and typecheck, plugin contracts, public docs and preference gates passed. Hidden real-host acceptance exercised direct archive/remove, undo, approved plugin surfaces on mounted/later nodes, disable/reenable and full process restart; screenshot inspected locally. Source and synthetic desktop acceptance do not update the running user installation or establish remote/model acceptance. Ordered progress and remaining items are in `defensive-ux-progress-20261003.md`.

## D009-D016: file access, export and revision usability (2026-10-03)

Directory-name and legacy control-root fences are removed from owner file access, generated images and attachment save-as. Account export narrows its destination exclusion to actual managed credential files. Worktree roots can use custom data-directory locations while preserving Git overlap and snapshot integrity. File-backed official Skills expose the same export action as personal Skills; builtins without files remain honest about their available content. Codex has no arbitrary six-Skill selection cap and previews have no ten-revision cap; native Claude slash semantics, source hashes and one-send behavior remain.

Validation: 103 focused tests passed, including a fully approved synthetic extension through actual host consumers, output bytes, source preservation, twelve refinements, duplicate sends and extension restoration. Production build/typecheck, plugin contracts, docs and UI preference checks passed. Hidden real-host acceptance verified official ZIP contents, mounted/later export surfaces, disable/reenable and persisted settings after complete restart. No real accounts, remote tasks, running installation or release changed. Interface, compatibility and persistence review is documented in documents 36 and 37.

## D101-D107: recoverable probes and readable errors (2026-10-03)

Optional font failures no longer stay cached indefinitely. Discovery reports reasons, file reads retain their cause, and the fixed font protocol distinguishes HTTP failure classes. Login methods show availability causes with credential values redacted and expose explicit rediscovery without starting authorization. SSH read errors retain classified guidance plus useful redacted transport detail; both providers keep the same read-only handshake retry and mutation non-retry behavior. Bootstrap closing cancels pending transfer or hides its owner while an already launched installer completes; detailed errors remain available instead of only a stage label.

Validation: 44 focused tests, seven hidden synthetic UI behavior groups and a compiled C# probe passed. Approved extension tests cover actual discovery consumers, login cancellation, later font/login surfaces and disable/reenable. The UI fixture now initializes the production preference client/store and a complete synthetic host record; these changes repair fixture drift rather than changing account behavior. Type/plugin/docs/preference gates passed. The native bootstrap was compiled and tested without showing a window, making a network request or launching an installer; real model, remote SSH, active desktop and release evidence remain unclaimed.

## D017-D019: network paths and hardlinked reads (2026-10-03)

Ordinary UNC references and attachment paths now reach the existing filesystem path without blanket network-share rejection. Hardlinked files are readable by attachments, owner files, generated-image replay, shared text, Skill ZIP input/export and worktree snapshots. Content identity checks and shared-content mutation protection remain. Worktree restore creates independent byte copies without changing aliases outside the checkout. No new restriction, persisted format or UI preference is introduced.

Evidence includes pure UNC mapping (no network connection), local hardlink reads and changed-source rejection, approved plugin export lifecycle and archive/restore bytes. Existing local references, file ambiguity and owner boundaries remain tested. Source changes do not establish live SMB, remote SSH, active desktop or release acceptance. See documents 36 and the ordered progress ledger for scope.

## D020-D021: complete browsing and explicit search continuation (2026-10-03)

Local UTF-8 preview now pages large files, seeks distant line references without retaining preceding content, and loads directory entries beyond the former 1000 limit. Text copy traverses every page. Incomplete path search returns an expandable per-request budget and concrete candidates; the user can continue without ambiguity being silently resolved. The production files.browser registry supports typed reader additions and replacement, and the file-pagination surface supports each current/later control.

Validation covers byte-exact Unicode paging, changed-source refresh, 1005 directory entries, 300 plugin candidates, approved production reader lifecycle and the hidden real-host UI (real Monaco, full directory list, search continuation and preference restart). Existing permissions, source versions and duplicate-send state remain. Build/type/plugin/docs/preference gates accompany this change; no live model, SSH or foreground acceptance is implied.

## D022: attachments beyond the former fixed caps (2026-10-03)

Attachment count and size no longer fail at the previous global thresholds. Local file import and source verification stream hashes; native/API/preview/verification consumers only retain bytes they actually require, while full reads remain compatible. Claude PDF content stays inline and Codex ordinary files remain verified path references. Duplicate suppression, snapshot hashes and submission semantics remain.

Focused suites cover actual provider request shapes, source edits, hardlinks, managed snapshots, source paths, PDF/image bytes and approved plugin policy lifecycle. Hidden production Electron passed 17 behavior groups including eleven files, one 21 MiB file and a 53 MiB aggregate through actual drag/preload/IPC/composer. Type, plugin, docs and UI-preference gates accompany this change. This is source and isolated UI evidence, not a claim of unlimited protocol frames, live remote model acceptance or installed application update.

## D023: generated formats and large-image editing (2026-10-03)

Generated images use actual desktop decoding, preserve PNG/JPEG/WebP/GIF bytes and MIME/extensions, and allow approved plugin decoders in the production sink. The fixed generated-byte and annotation/copy pixel caps are removed. Native identity and source-version integrity remain; format-changing replays create no extra file. Existing PNG metadata is compatible. Hidden production tests verified >20 MiB input, JPEG display, WebP clipboard conversion, and 7000 x 6000 copy/annotation with the clipboard intercepted. Generated-image root/child and delivery-state UI checks passed. Source/build and isolated desktop evidence do not claim an installed update, live model or remote transport acceptance.

## D024: API local file streaming and binary access (2026-10-03)

Local API tools no longer reject files at 1,000,000 bytes or pages at 32000 characters. UTF-8 pages and base64 byte pages stream full-file verification, expose continuation and optionally bind the prior version. Binary writes use the existing exact approval and read-back flow; directories can continue past 1000 entries. Approved file readers extend/replace the actual production dispatch and restore on disable. All 55 focused tests passed, including owner boundaries, real synthetic filesystem writes and plugin lifecycle. No adjustable UI or persistent format changed; context budgets are independently tracked by D027. Source/protocol tests do not establish live model or remote acceptance.

## D025: commands complete independently of output volume (2026-10-03)

The API command runner removes its 16000-character, two-minute and 1 MB termination limits. Full stdout/stderr stream to local profile files, with typed result references and configurable inline previews. Optional explicit timeout and user stop retain owned-process cleanup and uncertain-result handling. Approved executor registrations and replacements reach the real runner; disabling an in-flight executor never starts another execution. Focused tests passed for large scripts/output, Unicode, cancellation and lifecycle; an isolated 122-second command checks the former deadline. Output paths remain available for subsequent file reads, and temporary command scripts are removed.

## D026: user-selected API turn budgets (2026-10-03)

The standalone API loop no longer fails at 64 calls. A compact per-session budget defaults to unlimited and persists after restart; an explicit positive choice pauses at a known request boundary with retained tool results and a visible next-step notice. Active turns freeze their budget, pending untransmitted steering remains unsent, and a new user instruction starts a new turn without replay. Approved policies and named surfaces support replacement and disable restoration through actual production consumers. Native Codex/Claude loops remain native-owned.

Focused model/turn-timing tests and hidden production UI cover more than 64 calls, policy lifecycle, stale writes, frozen configuration, restart and surface restoration. Build, typecheck, plugin contracts, docs and preference gates accompany the change. This does not update the installed desktop or establish live model/SSH acceptance.

## D027: context estimates schedule instead of blocking (2026-10-03)

Historical attachments no longer fail at 100 MiB, and summaries can process more than sixteen chunks or split a single large entry. Scheduling uses known model input capacity and an extensible approximate token estimator, calibrated by actual provider usage within the turn. Fixed byte-to-token comparisons and post-summary admission failures are removed; latest inputs remain intact for upstream acceptance. Original history, cancellation, failed-request non-replay and known tool results remain. Approved production estimators support lifecycle replacement. Protocol tests cover all three API formats plus 102 MiB verified file references; source evidence does not imply live model, native CLI, SSH or installed-desktop acceptance.

## D028: extensible manual reasoning choices (2026-10-03)

Model mappings accept custom reasoning names and lists beyond seven/twenty entries. The editor provides an Add field alongside standard suggestions, persists exact selected tokens and restores after restart. Saving requires no inference probe; explicit probe rejection/inconclusive results remain diagnostics. Registered suggestions enter the actual editor and saved model/native protocol paths, and named surfaces restore on extension disable. Unit/protocol and hidden production checks cover custom selection, all three API shapes, both native wire families, approved plugin lifecycle and process restart. No live model, native CLI, SSH, installed package or active user desktop was used.

## D029: endpoint addresses follow explicit configuration (2026-10-03)

HTTP and LAN/link-local addresses are accepted without extra hostname interception. Query/fragment-bearing addresses persist; request resources append to the pathname while preserving queries and omitting fragments on the wire. Translation, direct API, probes and both native gateway paths share a typed production endpoint registry, verified with an approved plugin and disable restoration. Existing independent credentials and login-web boundaries remain. All 78 focused tests passed; type/plugin/docs/preference gates apply. No external endpoint, real model, native CLI, live SSH or user installation was changed.


## D030 partial translation delivery (2026-10-03)

Readable partial translations now reach the existing input/answer preview and all output reading consumers with a visible incomplete indication. Three API response protocols and both native runtime completions propagate optional incomplete metadata. Original inputs remain available, missing/mismatched segments keep their own source, and automatic submission never consumes partial text; explicit confirmation retains once-only dispatch. No retries or new approval flow. The production output-reader service supports approved registration/replacement and disposal; docs 36/37 and contract declarations are synchronized. 135 focused source/protocol cases and type checks pass; isolated hidden production UI validates plugin lifecycle and restart. This is source and synthetic acceptance only, not an installed desktop upgrade, real model or remote deployment.


## D031 translation capacity delivery (2026-10-03)

Translation retains queued work beyond 64 requests, reads responses beyond 2 MB, preserves more than 512 associated fields, and follows model catalogs beyond ten pages/2000 entries. The actual queue exposes a typed scheduling registry with cleanup and production interception. Existing user budgets remain authoritative and accept larger explicit values; long deadlines preserve duration without timer overflow. The same settings and persistence contract remain. 119 translation tests and hidden production settings/restart coverage verify this change; docs 36/37 describe the public contracts. No real model or installed desktop update is included.


## D032 native transport capacity delivery (2026-10-03)

Removed artificial native model frame/output defaults, both SSH relay/owner input limits, gateway request 32 MiB and API JSON/SSE/tool-count/argument caps. Native JSONL now accumulates chunks without repeatedly copying an unfinished large frame. The production runtime.native-streams factory supports approved call/register/replace through actual local, SSH and translation process consumers. Explicit caller transport policies and data/permission/duplicate integrity remain. 214 focused cases and the full production build pass; bundle revision 6 records source migration only. No new UI state; no live SSH, real model, installed update or remote deployment.

## D033 discovered local tools (2026-10-03)

Claude local tools follow the actual native catalog, including new ordinary names and partial installations. A typed production selection registry reaches cached/new listings and real calls; approved plugin disable/reenable restores selection immediately. Native model/lifecycle ownership and action permissions remain. 25 focused synthetic cases pass; documentation and contract snapshot record the additive API. This has no UI preference change and does not claim live CLI, model, SSH or installed desktop acceptance.

## D034 local tool capacity delivery (2026-10-03)

Removed default Claude tool wire/result/store/catalog and pending-request ceilings, fixed host request timers and Read image/text size rejection. Existing full-result storage now accepts larger results/pages; occupied command slots queue instead of failing. A typed production policy registry supports explicit limits, scheduling and approved plugin restoration. Duplicate IDs, exact output, cancellation, native read/edit state and real permissions remain. All 29 focused synthetic tests pass; type/plugin/docs/preference gates apply. No UI preference change or live native/remote/installed desktop acceptance is claimed.

## D035 asynchronous command delivery (2026-10-03)

Local asynchronous commands retain arbitrary numbers of receipts and queue at the selected concurrency. Workbench command-duration/wait/length caps are removed; native timeout arguments remain exact and optional. Queued stop and late startup shutdown do not launch unwanted commands; duplicate request IDs keep once-only execution. Production approved policy and MCP consumers are verified, with 49 distinct focused cases across the relevant runs. Public queued state and remote source bundle revision 7 are documented. No new UI state or live deployment is included.

## D036 skill-source access, partial delivery (2026-10-03)

Skill source is readable even with native lifecycle declarations. Sequence arguments, pwsh and custom effort values are supported; actual resource loads consume a typed adapter registry with approved plugin restoration. Unknown declarations stay visible as unexecuted native requirements. 39 context/controller cases pass. Built-in hooks/isolation/background/inline-model execution is still outstanding; this is partial progress, not completion or native model acceptance. No UI persistence change applies.
