# 07 · 研究、来源与证据边界

## Claude bridge source review (2026-10-04)

The installed official Claude MCP tool process was exercised with a disposable home and model traffic directed to an unreachable loopback endpoint. This verifies actual Read/Edit envelopes, native foreground PowerShell and background-command output; it does not establish live remote model or Agent behavior. The bridge implements explicit support for local synchronous command hooks and reports other configured hook types/events as unavailable, rather than claiming complete native hook equivalence. Core load hints are delivered as `anthropic/alwaysLoad` metadata; model obedience is a separate layer.


## ZIP compatibility dependency (2026-10-03)

The published @zip.js/zip.js 2.23.0 package metadata, README, index.d.ts and full LICENSE were reviewed. Primary sources: https://registry.npmjs.org/@zip.js/zip.js/2.23.0 and https://github.com/gildas-lormeau/zip.js. The package uses BSD-3-Clause; the pinned dependency is installed normally, and scripts/build-host.mjs includes its unmodified license in renderer/licenses/zip-js.txt. No project license is inferred. Package declarations document ZIP64, AES/ZipCrypto, split readers and integrity options. Production uses no-worker native compression streams and explicit CRC/local-filename verification. Independent fixtures verify the implemented formats, internal-link materialization and native import consumers; this does not establish every proprietary ZIP extension or arbitrary physical capacity. The web reader returned no usable body, so the published package was inspected locally. No third-party source was copied into application files.

## Compatible provider request review (2026-10-03)

The public [DeepSeek Chat Completions reference](https://api-docs.deepseek.com/api/create-chat-completion) was fetched read-only. It documents system/user/assistant/tool message variants and states that thinking mode rejects required or named tool selection; automatic selection is supported. Its effort documentation lists none/low/high/max and compatibility aliases minimal/medium/xhigh. These are provider-specific public facts, not a universal compatibility promise or proof of a screenshot's exact rejected parameter. No third-party implementation code was copied.

Independent source findings: the workbench mapper passed Responses developer roles through to Chat and represented text-only assistant content as arrays. Its completion layer also replaced normal selection with required/any. The repair uses compatible system instruction placement and text strings, preserves typed media and explicit native tool choices, and defaults completion selection to auto while retaining final-answer validation. Protocol fixtures and isolated installed-CLI tests verify these transformations. They do not establish successful authenticated inference against the user's service or justify silently translating unsupported effort names.

<!-- claude-context-receipt-20261001:start -->
## Native context size and sidebar tool distinction (2026-10-01)

Rechecked [Claude model configuration](https://code.claude.com/docs/en/model-config.md) through its public Markdown response. It states that on the Anthropic API Fable 5.1/5, Sonnet 5 and later, and Opus 4.7 and later use a native 1M window; Opus/Sonnet 4.6 use conditional `[1m]` variants. Native configuration can disable 1M or alter compaction budgets. Therefore lack of a `[1m]` picker row does not prove lack of 1M capacity, and model-name inference cannot establish the effective runtime budget. This repair displays explicit directory capacity or the root runtime's modelUsage contextWindow receipt; it does not add speculative model variants.

Project implementation audit: the workbench already defines 10 session/project/model collaboration tools, but the SSH Claude transport previously exposed only its local file/context/task tool server. Native Claude Agent is a subagent operation, not the workbench's independent sidebar-chat operation. Synthetic production-controller and authenticated HTTP MCP tests verify the repaired composition and existing authorization/idempotency checks. They do not prove a live provider request, deployed remote version, or active user desktop acceptance.
<!-- claude-context-receipt-20261001:end -->


<!-- native-tool-image-token-audit-20261001:start -->
## Native rich tool-output references (verified 2026-10-01 JST)

- OpenAI Chat Completions reference: `https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create`. The fetched schema declares tool-message content as a string or text-part array, while user image parts use `image_url`. The local mapper completes the pending tool-result batch before an attributed user image message.
- OpenAI function-calling guide: `https://developers.openai.com/api/docs/guides/function-calling`. Responses supports image/file tool outputs. The official SDK schema at `https://raw.githubusercontent.com/openai/openai-node/master/src/resources/responses/responses.ts` also declares `ResponseInputText | ResponseInputImage | ResponseInputFile` output parts.
- Anthropic documentation and official SDK schema: `https://platform.claude.com/docs/en/agents-and-tools/tool-use/implement-tool-use` and `https://raw.githubusercontent.com/anthropics/anthropic-sdk-typescript/main/src/resources/messages/messages.ts`. `ToolResultBlockParam.content` accepts structured image content, which must not be discarded by text-only extraction.
- OpenAI Codex CLI reference: https://learn.chatgpt.com/docs/developer-commands?surface=cli documents explicit --image attachments and /mention file references; it does not specify a universal automatic large-text-to-TXT threshold. The workbench 100,000-byte rule is an independent compatibility choice.

These references establish protocol shapes, not arbitrary third-party model compatibility/pricing. Acceptance uses synthetic offline requests and approved plugin lifecycle tests; no live visual reasoning, billing reconciliation or cross-client savings benchmark is implied. Reference schemas were inspected without copying or vendoring third-party implementation code.
<!-- native-tool-image-token-audit-20261001:end -->

<!-- ui-release-sources:start -->
## Desktop distribution and update references (2026-09-30 JST)

- [Anthropic: Deploy Claude Desktop for Windows](https://support.claude.com/en/articles/12622703-deploy-claude-desktop-for-windows): the public download installer and x64/Arm64 MSIX deployment are documented. The app checks roughly every four hours and applies updates automatically by default; managed deployments can disable its updater and distribute approved packages themselves.
- [OpenAI: Windows desktop deployment](https://learn.chatgpt.com/docs/enterprise/windows-deployment): the former Codex enterprise deployment entry currently redirects to this ChatGPT desktop document. It documents a web installer, Microsoft Store/Intune distribution and offline architecture-specific MSIX packages, plus automatic updates. The documented offline downloads are Store-signed MSIX packages; standalone MSI and non-Store EXE packages are not offered. This redirect is not independent evidence of every historical Codex build's updater implementation.
- [OpenAI: Manage app updates](https://learn.chatgpt.com/docs/enterprise/manage-app-updates): built-in updates are enabled by default; enterprise policy may disable them, while Store/MDM updates remain separate. This policy does not manage Codex CLI or IDE extension updates.

These are public distribution and behavior facts, not source-code evidence for either company's private updater library or wire protocol. AgentWorkbench has not selected or implemented an installer, update feed, signing pipeline, or rollout channel in this change. Its release artifacts must exclude local preferences and test profiles; upgrade preservation still requires future package-level acceptance.
<!-- ui-release-sources:end -->

<!-- memory-receiver:start -->
## 2026-09-30 接收职责修正及证据解释

下节官方文档来源保持有效，但其中“一个原生后台会话处理两家”的工作台工程选择已被修正，不能视为官方推荐方式。当前实现使用两个独立接收方原生会话并串行调度；这是本项目的职责划分，不声称复刻官方私有后台实现。未引入第三方源码或新增外部许可证依赖。

原生加载自己的指令、提供接收方指南及限制宿主存储目标，解决的是任务归属和文件访问范围；仍不能保证模型一定忠实归纳、完整去重或遵守全部语义。旧单会话验证只证明当时的结构化存储和文件发现，不证明两家分别执行了各自的记忆规则。更新后的安装 CLI 验证也使用隔离 home 与回环模拟推理；真实模型语义质量、真实积压完成和账号风控结果须独立验收。
<!-- memory-receiver:end -->

<!-- memory-consolidation:start -->
## 原生记忆生成与按需读取（2026-09-30 JST 核对）

- [OpenAI · Codex Memories](https://developers.openai.com/codex/customization/memories)：公开说明后台提取、归纳、空闲与额度条件，区分 extract_model 与 consolidation_model。Codex 生成的记忆由原生系统维护；不能把改写其生成索引作为已执行官方归纳的证据。
- [Anthropic · Claude Code Memory](https://code.claude.com/docs/en/memory)：Auto Memory 启用后会主动选择有用事实保存，不以用户先说“记住”为必要条件。项目目录内 MEMORY.md 是启动索引，前 200 行或 25 KB 进入上下文；主题文件按需读取。用户级 CLAUDE.md 与自动记忆是不同入口。
- [OpenAI · AGENTS.md](https://developers.openai.com/codex/guides/agents-md)：用户级 AGENTS.override.md/AGENTS.md 的优先级与原生指令发现路径。该公开入口支持本项目的短引用适配，不能据此宣称它是官方跨厂商记忆导入接口。
- [Anthropic · Legal and compliance](https://code.claude.com/docs/en/legal-and-compliance)：官方 CLI 使用仍受适用账户、认证和服务政策约束；没有公开可据以保证账号安全的固定请求频率。运行时标签不等于请求供应商，需看实际绑定。

公开事实与工程选择分开：两家的自动记忆不是同一种调度方式，不能说 Claude 只有被明确要求才写入，也不能依据上述说明断言每次必开独立后台 Agent。工作台采用默认模型的一个原生后台会话，参考两家“短入口、按需读主题”的组织方法；程序生成路径、来源标记、回读哈希与回执，模型决定英文摘要和语义去重。用户级入口指向范围明确的引用，关闭自动记忆不自动删除已有引用。

本次核对使用官方公开文档；未取得足够官方源代码证据，未照搬第三方实现或引入其代码/许可证。CLI 协议验收使用隔离目录和模拟推理，证明本机文件/工具/启动发现链路，不证明真实模型一定召回或远端/真实账号风控结果。一个原生会话可有多个 HTTP/工具交换，合并会话只减少重复启动与重复工作。
<!-- memory-consolidation:end -->


<!-- subagent-terminology:start -->
## Subagent 英文术语（2026-09-30 JST）

- OpenAI 官方 [Codex Subagents](https://developers.openai.com/codex/subagents/) 使用 subagent / subagents 表示专门受派任务的代理。
- Anthropic 官方 [Create custom subagents](https://code.claude.com/docs/en/sub-agents) 同样使用 subagents。
- 工作台界面按本次用户要求统一采用首字母大写的 Subagent，其余说明仍为中文。该变更仅涉及术语与插件挂载点，不据此声称新增或改变原生并发、层级、模型和生命周期能力。
<!-- subagent-terminology:end -->

## 问答请求生命周期复核（2026-09-29 UTC；U107）

- OpenAI 官方 [Codex app-server 文档](https://developers.openai.com/codex/app-server)：`item/tool/requestUserInput` 回应后发出 `serverRequest/resolved`；请求在 turn 开始、完成或中断时被清除也发出该通知。此为公开协议事实，不能据此推定所有客户端界面自动具备待回答管理。
- Anthropic 官方 [处理用户输入](https://platform.claude.com/docs/en/agent-sdk/user-input)：`AskUserQuestion` 由 permission callback 处理，等待返回；拒绝结果为 `behavior:'deny'` 并给出 message。这里只引用原生输入／拒绝边界，不以 SDK 替换现有 CLI 登录或执行链。
- 本项目实现与验证：Codex 保留原问题 ID，忽略原生问题映射为空 answers；Claude 映射 deny。`tests/native-interactions.test.ts`、`tests/interaction-flow.test.ts`、`tests/question-inbox.test.ts` 核验合成协议；`scripts/test-question-inbox-ui.mjs` 验证真实控件。消息附带异步问题的收起／忽略属于工作台展示状态，明确区分于仍待响应的原生请求。本轮未宣称所有原生能力已全面对齐，未进行真实模型或远端验收。


<!-- local-model-management:start -->
## 本机官方账号与模型统计来源（2026-09-29 UTC；U115）

- **官方公开事实**：[Codex app-server](https://developers.openai.com/codex/app-server/) 本日抓取，声明管理式 `account/login/start` 的浏览器和设备代码方式、`account/read`、`model/list`、额度读取/事件，以及 `rateLimitResetCredits` 和 `account/rateLimitResetCredit/consume`。兑换使用调用方幂等键，可指定 `creditId`；结果区分 `reset/alreadyRedeemed/nothingToReset/noCredit`。卡片数组和计数可能缺失，不能等同于零。消费后须读取真实额度。文档包含 `account/usage/read`，本轮未接入账号全历史导入。
- **官方公开事实**：[Claude CLI](https://code.claude.com/docs/en/cli-reference) 和 [authentication](https://code.claude.com/docs/en/authentication) 记载 `auth login`、SSO、Console 与 JSON `auth status`，退出登录状态可返回退出码 1。[statusline](https://code.claude.com/docs/en/statusline) 记载独立可缺省的 5h/7day 使用百分比与重置时间，通常收到原生响应后才有数据；[costs](https://code.claude.com/docs/en/costs) 的 `/usage`、`/usage-credits` 不足以证明存在可枚举/兑换重置卡的公开接口。当前未核实 Claude 直接重置卡通道，不断言永远不存在，不抓取网页登录私有端点。
- **登录隔离补充核实**：重新读取上述 Claude 认证文档及 [WIF 配置目录](https://platform.claude.com/docs/en/manage-claude/wif-reference#configuration-directory)：`CLAUDE_CONFIG_DIR` 隔离订阅/API Key 登录，但不单独隔离无 API Key Console 登录；后者需独立 `ANTHROPIC_CONFIG_DIR`。认证文档明确浏览器无法回调时原生提示粘贴授权码。隔离临时目录只读执行本机 `claude auth login --help` 与 `codex login --help`，确认 Claude 订阅默认、`--sso`、`--console` 和 Codex `--device-auth`；没有启动实际登录。界面按厂商提供独立方式，仅原生提示后接受一次临时码，不读取令牌。
- **参考价格**：[OpenAI pricing](https://developers.openai.com/api/docs/pricing) 和 [Claude pricing](https://platform.claude.com/docs/en/about-claude/pricing) 本日抓取。不同上下文、服务档位、地区与缓存保存时间价格不同。本项目仅按精确 ID 存储有日期的标准参考价，展示假设，允许逐来源覆盖；未知模型不自动套别名，不将订阅额度换算成官方月度美元配给。
- **项目设计与证据边界**：本机多账号使用独立原生配置目录和官方进程，不复制第三方项目代码，不读取原生凭据。三列起步的响应式卡片、模型去重及先模型后账号是本项目交互设计。测试使用合成账号/额度/用量、进程协议夹具和隐藏独立 Electron；没有真实官方登录、付费模型、重置卡消费、VPS 部署或网络风控验收。运行时自带配置仍受官方行为约束，工程隔离不能声明免封。
<!-- local-model-management:end -->

<!-- cli-release-identity:start -->
## 远端 CLI 官方入口与请求标识核对（2026-09-29 UTC）

实际读取 [OpenAI Codex CLI](https://developers.openai.com/codex/cli/)（重定向到 learn.chatgpt.com）和 [Claude Code setup](https://code.claude.com/docs/en/setup.md)，并只读获取官方 [Codex 安装入口](https://chatgpt.com/codex/install.sh)、[Claude 安装入口](https://claude.ai/install.sh)。入口分别重定向到 releases.openai.com 与 downloads.claude.ai；既有工作台发布元数据和清单来源与这些安装器的公开来源一致。本轮没有复制第三方安装器实现。

本机同地址 A/B 请求复现：Python-urllib/3.12 标识读取 Codex latest、Codex 安装脚本、Claude 安装脚本均收到 HTTP 403；声明 AgentWorkbench 自身标识时均为 HTTP 200。修复后的完整 Linux x86_64 发布选择流程，在本机 Windows 只读 HTTP 条件下解析 Codex 0.159.0、Claude Code 2.1.284，并核实大小、摘要及安装脚本摘要。这是该次请求条件下的实测，不是厂商永久封禁某种客户端的公开政策，也不证明用户 VPS 存在同一原因。

本机错误归因检查确认旧实现把 HTTP 拒绝、超时与发布字段异常统一映射为“检查 VPS 出网”。现按实际失败类别及请求阶段回传，不降低 TLS、校验或确认要求。原生安装仍走官方脚本；本次未实际运行官方安装器、登录原生账号、读取用户配置或连接真实 VPS。公开记录不包含私人主机与身份；本机验收材料保留在忽略目录 build/qa/cli-release-fix。
<!-- cli-release-identity:end -->

<!-- browser-control:start -->
## 独立远端浏览器控制依据（2026-09-28 JST）

用户提供的本机独立浏览器脚本只作为启动、恢复连接、明确关闭与保留配置的交互参考，没有执行脚本或读取真实浏览器资料。实际实现复用仓库 services/vps-browser/remote_browser.py 的所属进程识别、manager.lock、Chrome/Xvnc/noVNC 控制；没有引入第三方代码。新增本机 SSH 通道使用既有严格主机校验和回环转发，HTTP 页面与 WebSocket RFB 握手共同核验操控通道。单实例限制、退出工作台保留远端浏览器属于本项目行为约定，不是对远端其他用户或其他软件的全机进程限制。

验收区分本机合成 HTTP/WebSocket、Linux 进程和配置夹具、隐藏 Electron 与真实 VPS；不将前几项表述为已部署或真实远端浏览器验证。开发契约与测试见文档 36。

同日核对 OpenAI 官方 [Browser](https://learn.chatgpt.com/docs/browser)：桌面应用包含内置浏览器，并向 Codex 提供浏览器 Computer Use；Codex CLI 和 IDE 扩展不自带此浏览器界面。[Computer use](https://developers.openai.com/api/docs/guides/tools-computer-use) 则说明自建集成须提供执行环境和工具结果。以上是厂商公开能力边界；本工作台当前实现是 VPS Chrome 加本机默认浏览器中的 noVNC 操控页，Claude 登录入口也使用外部默认浏览器，不据此宣称已嵌入厂商浏览器。
<!-- browser-control:end -->

<!-- planning-modes-20260928:start -->
## 计划模式、分类器与目标入口依据（2026-09-28 JST）

本轮实际获取官方 [Codex App Server](https://developers.openai.com/codex/app-server)、[Codex app features](https://developers.openai.com/codex/app/features)、[Claude permission modes](https://code.claude.com/docs/en/permission-modes) 和 [Claude CLI reference](https://code.claude.com/docs/en/cli-reference)。Codex collaborationMode 是独立于 sandbox/approvalPolicy 的模式参数，developer_instructions:null 采用内建模式指引；Claude plan 属于 permission-mode。Claude 官方说明计划期间默认可能使用安全分类器，关闭 useAutoModeDuringPlan 后，非内建只读命令改走审批。将第三方连接限定为原生人工审批是本项目兼容策略，不是厂商对第三方模型的兼容认证。

安装版 Codex 0.155.1 的 app-server generate-ts --experimental 现场生成 schema，确认 CollaborationMode、Settings、TurnStartParams；未复制生成的第三方实现到源码。Claude Code 2.1.283 在临时配置目录、合成本机上游下验证 set_permission_mode 成功／失败回执、system.permissionMode、ExitPlanMode 批准／拒绝和 MCP 首次批准。控制协议按此安装版本的实测记录，不扩大早期 SSH Claude H 验收范围。Codex 原生输出的 Plan Mode／Default 指引到达合成上游，权限参数保持独立。

进一步核实：Codex 官方 App Server 文档区分 item/plan/delta、最终 plan item 和 turn/plan/updated 进度清单；最终 plan 文本可能与增量拼接不同，应以完成项为准。安装版 CLI 将合成模型返回的 proposed_plan 内容转成真实 plan 项，工作台在其完成回合后提供用户决策。按计划执行是客户端明确发送 default 协作回合，不伪造原生权限批准 RPC；此结论不声称复刻闭源桌面端的全部私有界面。

Claude 现行 permission-modes 的 Review and approve a plan 明确保留执行权限选择：手动审批，以及按可用性显示 auto／auto-accept edits／bypass 选项；批准退出计划，拒绝留在计划。安装版在隔离合成上游中验证原生 updatedPermissions=[{type:setMode,destination:session,mode:default或acceptEdits或bypassPermissions}] 均收到对应 system.permissionMode。工作台第三方连接没有宣称自动分类器兼容，提供已验证的手动审批、自动接受编辑和完整访问；“自动接受编辑”不冒充 auto 分类器。原生计划全文进入独立翻译只作显示叠加。

另外确认 Codex schema 提供 thread/goal/set、thread/goal/get、thread/goal/clear，Claude 初始化目录含 goal 命令；这只证明原生能力入口存在。工作台尚无对应命令派发与目标胶囊，不声明已经实现，也没有新增外层无限继续或自动恢复任务。

证据分层：纯协议／单元、安装版 CLI 配合合成上游、隐藏隔离 Electron 与人工截图检查。未读取实际用户聊天或凭据，未调用真实模型，未修改活动客户端或远端部署；用户截图中的当次完整传输没有读取，不能把本轮复现当成其全部失败原因的追溯证明。
<!-- planning-modes-20260928:end -->

<!-- remote-maintenance:start -->
## VPS 资源与会话副本回收依据（2026-09-28 JST）

资源数字取 Linux /proc/meminfo 的 MemTotal/MemAvailable 和 statvfs 的实际文件系统容量；已用内存为 total-available。进程回收依据本项目登记的原生句柄、进程身份及既有终止守卫，浏览器和其他后台服务不参与。低内存阈值、连续采样、冷却期、磁盘余量和控制回路探测是项目设计，不是 Linux 或厂商给出的无 OOM 保证。

格式依据既有原生事件与隔离 CLI 产生的测试文件；Codex session_meta/history_base/子线程依赖独立处理，Claude 按原生会话文件及关联目录处理。源码、Linux 临时目录故障验证、实际 CLI 合成上游恢复、隐藏 Electron 与真实 VPS 联验分别计量。下方图片接收节“尚未迁移原生历史”是此前阶段边界，由本轮归档实现补充；没有替用户部署远端。

只回收可核验的工作台会话组，不删除凭据、原生数据库／索引、日志和其他软件数据，不承诺 VPS 总储存永不增长。恢复原始字节后再原生 resume；未知元数据、损坏清单、并发变化及空间不足拒绝继续删除。没有引入或复制第三方实现。接口和测试位置见文档 36。
<!-- remote-maintenance:end -->

<!-- session-feedback:start -->
## 原生流式正文与任务计时依据（2026-09-28 JST）

本轮通过 HTTPS 实际获取官方 [Responses streaming guide](https://developers.openai.com/api/docs/guides/streaming-responses) 和 [Claude Messages streaming](https://platform.claude.com/docs/en/build-with-claude/streaming)。Responses 的文本 delta 与完成事件分开；Messages 使用 message_start、内容块增量、message_delta 与 message_stop，最终 usage 为累计计数。这里只按公开事件格式转换，不复制第三方实现。

本仓库源码核对发现跨协议转发先 collectStream 完整聚合，随后才输出 nativeWireEvents；Claude 宿主也遗漏了原生文本增量消费。这些是本地实现问题，不是“两家 CLI 天生不能流式输出”的公开事实。修复后由 scripts/test-native-streaming.mjs 使用实际安装 CLI、隔离原生目录及合成 SSE，锁住上游完成帧验证首段公开文字已到工作台，再确认最终文本与完成耗时。此证据不包含真实商业模型、真实 VPS 或所有供应方的流行为。

任务计时采用本机观察到的执行准入和终态回执；包含启动、工具及等待，不冒充模型纯推理时长。原生公开状态与隐藏推理正文分开，缺失起止时间或最终回执保持未知。具体接口、错误与扩展范围见文档 36。
<!-- session-feedback:end -->

<!-- session-idle:start -->
## 原生会话闲置时钟与恢复证据（2026-09-28 JST）

依据 OpenAI 官方 [App Server](https://developers.openai.com/codex/app-server) 的原生事件协议以及本机固定桥接基线导出的 schema，闲置时钟取可信模型输出、推理增量、工具工作与回合生命周期事件，不取账户查询、线程列表、窗口阅读、连接状态或健康探测。Claude 流事件依据其 [CLI reference](https://code.claude.com/docs/en/cli-reference) 与实际安装版的合成回环任务核验；两家的事件分类分开实现，不用厂商名称猜测其他运行时格式。

`scripts/test-native-session-retention.mjs` 使用实际 Codex 0.155.1 与 Claude Code 2.1.283、全新临时目录和合成回环上游：先生成原生历史，经本机归档服务确认后删除测试目录中的原生会话文件，再从本机恢复，最后重新启动原生进程并继续原线程。Codex 的图片上下文和 Claude 的原生 Read 工具结果均进入恢复后的模型请求；工作台可见消息未被粘贴成替代上下文。四项检查通过。这是本机原生格式和注入文件传输的验证，不是实际 SSH/VPS 或真实商业模型验证，亦不证明任意版本、任意附加组件都可无损恢复。

补充工程证据：本机归档调度有传输量、候选数和时间限额，取消／停止接通真实控制器与原生连接准备路径；Linux 合成文件故障覆盖部分删除、服务重启、丢回执、上传残片和超过 1,000 个候选的轮转。属于本仓库恢复协议的实测，不属于原生厂商对任意版本上下文恢复的保证。
<!-- session-idle:end -->

<!-- generated-images:start -->
## Codex 原生图片结果与保存边界（2026-09-28 JST）

本轮实际取得 OpenAI 官方 [App Server 文档](https://developers.openai.com/codex/app-server)，并核对当前已验收桥接基线 `rust-v0.155.1` 的公开源文件：[图片事件类型](https://github.com/openai/codex/blob/rust-v0.155.1/codex-rs/ext/items/src/image_generation.rs)、[生图工具及保存过程](https://github.com/openai/codex/blob/rust-v0.155.1/codex-rs/ext/image-generation/src/tool.rs)、[App Server 扩展注册](https://github.com/openai/codex/blob/rust-v0.155.1/codex-rs/app-server/src/extensions.rs)、[原生集成测试](https://github.com/openai/codex/blob/rust-v0.155.1/codex-rs/app-server/tests/suite/v2/imagegen_extension.rs)。网页搜索工具未返回正文；来源通过 HTTPS 直接获取，缓存位于忽略目录 `build/qa/codex-image-audit/`。仅核对合同和行为，没有复制第三方实现或安装依赖。

公开源码表明：完成事件包含 `result`、可选 `savedPath`、提示与失败状态；原生测试断言 result 为标准 Base64 PNG。生图工具虽包含 executor 写入分支，当前 App Server 注册器却固定传入原生 Codex home 作为保存根，因此不能由该分支推断当前 SSH 桥自动把图片写到本机。保存发生在完成事件之前，且图片可进入原生历史。本轮使用实际安装的 Codex 0.155.1、独立临时原生目录、合成 ChatGPT 登录和回环合成上游再次观察到了该行为。

实现判断：工作台可自动接收完成事件、将结果保存到本机工作区，并在校验及持久状态确认后通过所属连接清理确切远端 PNG；这不等于从未落盘，也不消除原生历史中的图片数据。原生工具发现及调用链已有隔离实测，真实账号能力、真实模型自行选择工具、实际 SSH/VPS 联验仍待相应授权与验收；合成上游按测试脚本返回工具调用，不能用它证明真实模型决策。接口和限制见文档 36。

本项目当前 SSH 路径仍把原生账号目录留在远端：`services/vps-account-broker/runtime.py` 设置账号的 `CODEX_HOME`，`packages/runtime-codex/index.ts` 创建持久线程并通过原生 thread/read、thread/resume 恢复。本机执行文件与命令不改变这个会话存储位置；本轮没有改为临时线程或迁移、删除原生历史。这是代码行为核对，不是已部署 VPS 的存储盘点。
<!-- generated-images:end -->


## DSH 档位声明与工作台无推理识别（2026-09-28 JST）

本机安装物只读观察：DSH Desktop 0.10.0，@deepseek-ai/dsh-llm-pi-ai 与 dsh-client-ui-settings-models 0.1.7-rc.2。resolveModelReasoning 读取每个模型的 reasoningEfforts 配置，未声明时继承对应提供方的已安装目录；getSupportedThinkingLevels 由本地模型能力与映射生成列表。设置页的 ModelReasoningEffortsField 保存声明，选择器从宿主目录读取同一模型的 reasoning.efforts。它们不是通过逐档生成响应证明参数生效。

discoverModels 优先读取已安装提供方目录；未知提供方按明确配置执行 GET /models。所观察版本的远端 readListing 主要提取模型身份、名称与容量，不证明每个第三方端点都会返回档位。DSH DeepSeek 专用适配器另有自己的声明集合，不能把它当作所有兼容 API 的能力。因此同一个 API 地址也不能推导所有模型共用相同档位。

本项目采用声明、已保存证据和手动配置分开的原则，不引入 DSH 或 pi-ai 依赖、不复制第三方实现，也不按模型名字猜支持。上述两个包声明 MIT；本次仅查看安装代码和包元数据，没有读取用户配置、凭据或聊天库，没有操作 DSH 客户端。当前实现行为以本机版本为限，不冒充永久官方契约。工作台普通读取/保存只允许目录请求，真实推理验证须另有显式授权；验证和选择不应互相阻塞。

## Claude 本机分支与缓存计数（2026-09-28 JST）

- 公开来源：[Claude Code CLI reference](https://code.claude.com/docs/en/cli-reference.md) 说明 --resume、--fork-session 和 --session-id。仅凭这些参数列表不证明工作台已按任意历史消息正确分支。
- 本机能力证据：安装版 Claude Code 2.1.283 实际接受 --resume-session-at ASSISTANT_UUID 与上述分支参数组合。scripts/test-claude-fork.mjs 在临时原生 Home 中以原生 Read 产生合成工具结果，核验指定回复边界、排除后续回合、源记录摘要不变、新线程身份、重启与另一目录续聊。--resume-session-at 的精确组合行为依据这项实测，不冒称前述公开 CLI 页面已逐项描述。
- 公开来源：[DeepSeek Context Caching](https://api-docs.deepseek.com/guides/kv_cache) 将 prompt_cache_hit_tokens 和 prompt_cache_miss_tokens 区分为输入命中与未命中；未命中不能作为 Anthropic 风格缓存创建计数。
- 公开来源：[Anthropic prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching) 区分 cache_creation_input_tokens、cache_read_input_tokens 与未缓存 input_tokens；全部输入为三者之和。本项目统一 inputTokens 包含缓存，转换时避免重复累加。

以上页面本日抓取核对，未复制第三方实现。独立配置的 deepseek-flash 经实际 Claude CLI 完成六项本机分支验收；这是该本机模型 API 路径的真实模型证据，不证明 SSH、订阅登录路径、所有版本或所有提供方均已通过。测试只使用合成任务及隔离原生目录，不读取现有用户聊天历史；配置和验收资料不进入公开仓库。

## 运行时斜杠菜单与手动压缩（2026-09-28 JST）

- 公开来源：[OpenAI app-server](https://developers.openai.com/codex/app-server)；本日读取 thread/compact/start、标准 turn/item 完成通知、skills/list 与原生 skill 输入合同。Codex 原生控制命令必须使用对应协议方法，不能假设把任意终端斜杠字符串发送给模型就会执行。
- 公开来源：[Claude Code commands](https://code.claude.com/docs/en/commands)、[headless](https://code.claude.com/docs/en/headless)。内置命令与 bundled skills 不同；部分命令只存在于终端界面，headless 能力须单独核验。工作台展示已接入的控制，技能仍由各自运行时原生展开。
- 本机实现证据：安装的 Codex 0.155.1 与 Claude Code 2.1.283，在临时原生目录、合成 loopback 上游中分别执行手动压缩并继续原会话。Codex 使用 thread/compact/start，Claude 使用独立 /compact stream-json 消息，均观察原生完成事件。未调用真实付费模型，未宣称摘要质量、全部命令覆盖或远端桥支持。
- 项目选择：菜单随当前绑定运行时和目标刷新；目录读取不消费模型调用，过期目录不可执行。来源缓存、原生会话持久化和上游请求缓存分别处理；切换后的可见历史交接不承诺跨运行时缓存命中。


## 附件位置与工作树清理复核（2026-09-28 JST）

本机安装物只读观察：Codex Windows 26.924.1866.0 的桌面层分别处理粘贴图临时写入、已有本机文件路径和 Codex Home/attachments 托管副本；不是“所有附件都存 Temp”，也不是 CLI 自动替桌面实现文件选择、图片查看或缓存界面。图片持久化函数使用系统 tmpdir、随机文件名和独占写入；拖入文件存在读取原路径的分支，Blob/远端上传走托管附件分支。此为特定安装版本的实现观察，不是官方永久兼容契约。没有读取用户聊天库、登录资料，未复制第三方实现代码到项目。

Claude Code 2.1.283 安装物中观察到 image-cache / paste-cache 清理及图片字节处理逻辑；尚未以真实终端粘贴任务证明其所有输入场景的当前落盘位置，不将兼容清理代码当作所有附件写入路径的证明。工作台当前采用已核对的本机输入来源分流；不修改或清理任一家原生缓存。

工作树产品行为参考官方 Codex App worktrees 文档（https://developers.openai.com/codex/app/worktrees）：保留数量、保护活跃/置顶任务和可恢复清理作为设计参考。本项目自己的归档格式、256 MiB/30000 条目、默认关闭与七天附件清理是独立实现选择，不能冒称官方参数或官方更新会自动继承。本轮证据为本机合成 Git/附件、协议测试和隐藏桌面，未执行真实付费模型/SSH 或原生客户端的删除操作。


## 模型思考参数与探测边界（2026-09-28 JST）

- 公开来源：[OpenAI Reasoning models](https://developers.openai.com/api/docs/guides/reasoning)。本日读取官方页面，核对 Responses 的 reasoning.effort、Chat Completions 的 reasoning_effort，以及支持值依模型而异的边界。不能据此宣称第三方网关或任意 Claude 模型支持同一组值。
- 项目选择：按用户指定候选分别检测 light、low、medium、high、xhigh、max、ultra，使用基线与无效值对照；Messages 沿用现有 output_config.effort 适配。此为工作台兼容性探测协议，不是官方自动能力枚举，也不保证可识别所有忽略参数的代理。
- 证据层级：三种协议与真实 loopback HTTP 保存由合成上游验证；UI 用隐藏离屏 Electron。未使用真实提供方凭据或模型额度，未验证任意商业网关的实际思考质量。参数通过只表示被接受；工作台 UI 不会由官方运行时升级自动生成。

> 版本化研究来源；公开资料、私有历史参考与待验证结论分开。私有材料不随仓库分发，不应视作公开可复现证据。 [文档导航](README.md)

## 会话 UI、授权规则与模型窗口（2026-09-28 JST）

本轮通过官方 HTTPS 原文核对，不把参考页面视作用户操作授权：

- OpenAI Codex app-server：https://developers.openai.com/codex/app-server.md ，以及本机 0.155.1 生成的 CommandExecutionApprovalDecision/RequestApprovalParams。基础、会话和结构化 exec/network 决策具有不同形状，应精确回复原生提供值。
- OpenAI 配置参考：https://developers.openai.com/codex/config-reference.md ，声明 model_context_window、model_auto_compact_token_limit 和 model_catalog_json。官方实现 https://github.com/openai/codex/blob/main/codex-rs/models-manager/src/model_info.rs 明确展示配置受 max_context_window 限制；本机实测未知名称仍为 258400 的可用预算。通过安装版本 debug models --bundled 和进程专用目录纠正模型元数据后，1M 映射报告 950000。公开 main 源码是核对依据，实际 CLI 探测才是本轮版本证据。
- Claude 权限：https://code.claude.com/docs/en/permissions.md 、https://code.claude.com/docs/en/agent-sdk/permissions.md 与官方 SDK types.py：https://github.com/anthropics/claude-agent-sdk-python/blob/main/src/claude_agent_sdk/types.py 。permission_suggestions 与 updatedPermissions 保留原规则/目的地；不推断所有请求都提供保存选项。
- Claude 模型配置：https://code.claude.com/docs/en/model-config.md#correct-the-window-for-a-gateway-or-custom-model-id 与 https://code.claude.com/docs/en/env-vars.md 。MAX_CONTEXT 对未知自定义名、[1m] 和已识别 Claude 名称的行为不同；AUTO_COMPACT_WINDOW 仍受模型容量约束。工作台采用进程窗口变量及必要的网关内部别名保持原生主动压缩，上游模型 ID 不改写；这是本项目实现策略，不声称官方宿主使用同一策略。
- Marked 官方 LICENSE：https://github.com/markedjs/marked/blob/master/LICENSE 。添加 Marked 18.0.14 前已核对完整 MIT/Markdown 再分发条款；构建复制依赖 LICENSE。未复制其他客户端 UI 代码，未替项目选择许可证。

本轮新增证据：真实安装 Codex 0.155.1 和 Claude Code 2.1.283 + 合成本机上游，7 项审批/恢复/窗口探测通过；隐藏 Electron 真实组件 + 合成宿主桥 9 项通过。没有真实付费模型、实际 1M 文本、大上下文语义质量或远端部署证据。历史 400 没有保留错误正文，不能从修复的工具顺序缺陷反推那一次的准确原因。详见 [会话 UI 专题](conversation-ui-20260928.md)。

后续自动预算与压缩复核（2026-09-28 JST）：重新读取上述 Claude 官方模型配置与环境变量原文。公开事实：AUTO_COMPACT_WINDOW 参数为 100K..1M，有效窗口受模型容量约束；MAX_CONTEXT 对未知自定义模型可保持主动压缩；百分比覆盖只能降低支持场景阈值；DISABLE_COMPACT / DISABLE_AUTO_COMPACT / CLAUDE_CODE_DISABLE_UNKNOWN_MODEL_WINDOW_ENFORCEMENT 的范围不同。2.1.283 合成实验显示，未知模型路径的百分比覆盖与较低 AUTO_COMPACT_WINDOW 单独设置不足以保证比例阈值；工作台此前改用 95% 请求预算作为 MAX_CONTEXT，保留完整上游容量；同日后续用户将默认预算明确调整为 90%，两家原生机制不变。这是项目策略，原生仍可能提前预留。

Codex 0.155.1 官方版本源码核对：

- https://github.com/openai/codex/blob/rust-v0.155.1/codex-rs/protocol/src/openai_models.rs ：ModelInfo.auto_compact_token_limit 将配置值限制为不超过已解析容量的 90%；usable_context_window 默认保留 5% 余量。可用窗口不等于自动压缩阈值，也不能据 UI 的四舍五入数值反推真实模型容量。
- https://github.com/openai/codex/blob/rust-v0.155.1/codex-rs/model-provider/src/provider.rs 与 https://github.com/openai/codex/blob/rust-v0.155.1/codex-rs/core/src/session/turn.rs ：provider 能力决定远端压缩或本地摘要请求路径。
- https://github.com/openai/codex/blob/rust-v0.155.1/codex-rs/core/src/compact.rs ：普通摘要请求使用 turn_context.model_info；模型切换相关回退不是“总是另选固定小模型”的证据。官方服务内部实现及不同版本可能另有策略，本次未验证其内部模型大小。
- https://developers.openai.com/api/docs/guides/compaction ：官方 API 压缩接口资料作为背景，不能证明某个第三方 Chat Completions 服务提供专用压缩模型或接口。

此前 95% 预算实验的证据边界（当前默认值已改为 90%）：保留两家原生更保守的触发与停用行为。19 项实际 CLI/合成上游检查核对小窗口、非整档窗口、摘要继续和精确同模型路由；Codex 89% 对照不触发、90% 触发，Claude 94% 已触发。任意数值 1050000 只用于夹具，不是特定模型容量声明。没有复制第三方实现代码、调用付费模型或证明真实长文本摘要质量；旧 CC Switch 场景根因仍不能反推。

## U99 原生安装默认与 npm 可选（2026-09-27 后续）

只读核对官方说明与安装器，未执行用户环境的安装或渠道迁移：

- `https://learn.chatgpt.com/docs/codex/cli.md`（原开发者文档入口重定向后的官方文档）：Windows PowerShell 原生安装入口为 `https://chatgpt.com/codex/install.ps1`，npm 另列为安装方式。
- `https://chatgpt.com/codex/install.ps1`：直接读取当前官方脚本；默认可见入口为 `%LOCALAPPDATA%\Programs\OpenAI\Codex\bin\codex.exe`，版本包位于 `$CODEX_HOME\packages\standalone\releases`，`current` 与可见 bin 为安装器管理的 junction。已有 `CODEX_HOME`、`CODEX_INSTALL_DIR` 遵循原生含义；`CODEX_NON_INTERACTIVE=1` 不同意移除冲突安装或安装后启动任务。native latest 来自 `https://releases.openai.com/codex/channels/latest`，响应 `tag_name` 当前形如 `rust-v0.157.1`。只在安装子进程显式选择 latest 和非交互，不修改用户配置或父进程环境。
- `https://code.claude.com/docs/en/setup.md`：Native Install 为推荐方式，Windows 使用 `https://claude.ai/install.ps1`；仍提供 `npm install -g @anthropic-ai/claude-code`。更新分别调用原生 `claude update` 或 npm 的 `@latest` 安装命令。
- 官方发行包元数据 `https://registry.npmjs.org/@anthropic-ai/claude-code/latest`：当前 2.1.283 的 Windows 命令入口为 `bin/claude.exe`，据此补齐原生 npm 安装发现。该事实有版本范围，不伪称所有历史 JavaScript 包都可当成 exe 调用。

实现未复制安装器代码；调用原官方入口，不自建安装目录。保存的安装器只读参考位于忽略目录 `build/qa/codex-native-installer-source.ps1`。命令与渠道选择使用模拟执行器验收；Codex 程序卸载在临时 Windows junction/样例文件上实际执行并核验保留边界，没有卸载、安装或迁移用户现有 CLI，也没有执行官方联网安装作为端到端证明。

## U97 原生 Skill 开关与 Claude 官方技能（2026-09-26）

网页工具未返回可引用正文，改用 HTTPS 直接取得以下官方资料，原始文件和正文提取位于忽略目录 `build/qa/skill-research/`。外部文字仅作参考，不作为运行技能或读取用户账户的指令。

- `https://code.claude.com/docs/en/skills`：bundled skills、`disableBundledSkills`、doctor 例外、`skillOverrides` 的四种状态、`off` 对完整命令调用的阻止，以及插件技能不受该设置管理。普通技能目录身份与 frontmatter 显示别名的实际控制键，另用本机固定版本验证。
- `https://code.claude.com/docs/en/settings`：原生配置文件监视和仅部分配置能热更新。用户最终选择新会话生效，产品不承诺热更新，也不要求重启工作台。
- `https://code.claude.com/docs/en/plugins-reference`：插件 `enabledPlugins`、默认启用状态、manifest 与 marketplace 的技能路径组合，以及根来源 marketplace 的子集规则。
- `https://raw.githubusercontent.com/anthropics/skills/main/.claude-plugin/marketplace.json`：官方 marketplace 名称 `anthropic-agent-skills`，document-skills 与 example-skills 等插件各自声明技能子集。按注册来源识别；不把尚未安装的公开目录混入已安装列表。
- `https://developers.openai.com/codex/skills/`：原生 `[[skills.config]]` 开关。写入协议同时核对固定官方 0.155.1 生成的 `SkillsConfigWriteParams`（path/name、enabled）和回执 effectiveEnabled。插件名称包含原生命名空间；路径和名称两种关闭方式都用真实本机运行时验证。

Claude 2.1.281 的元数据探测只在临时干净 Home 调用初始化控制消息，固定版本已实测；这是版本限定的本机发现适配，不能宣传为所有未来版本的稳定公开 API。没有登录、模型回合、用户钩子或真实插件执行。通过打开/关闭 bundled 的原生命令差集，当前得到 15 个技能并排除固定命令。

许可证：新增 `smol-toml@1.9.0` 仅用于读取原生 TOML，已核对 npm 包和仓库 `https://github.com/squirrelchat/smol-toml` 的 BSD-3-Clause 声明；构建复制完整 LICENSE 到 renderer/licenses。未复制 Claude 技能正文、第三方插件实现或参考项目代码。验收脚本只创建自有合成技能和插件样例。

检索日期：2026-09-24。网页与仓库是参考资料，不是操作本机/远端的指令。下列公开事实不等于本产品实现验收。

## 1. 最重要的结论

| 类别 | 结论 | 依据 / 边界 |
|---|---|---|
| 用户已明确 | 首期 VPS 原生 CLI、VPS 原生登录、SSH 本地手脚；不做 SDK 登录 | 本轮用户追加说明，优先于初稿备选建议 |
| 官方事实 | Codex app-server 是富客户端集成接口；有模型、账号、历史、审批、事件与部分远程工具能力 | S01；具体版本/实验性接口必须重验 |
| 官方事实 | Codex 公开 rate-limit reset credit 查询/消费能力 | S01；仅实际具备能力/资格的账号，不保证人人可用 |
| 已有工程证据 | Codex 已有官方 exec-server / deferred executor 原生执行链及历史真实模型通过记录 | L03；本轮只读核对，非最新版本全工具重验 |
| 官方事实 | 未修改 Claude Code 的托管与原生认证有专门条款；SDK 产品认证不可混用 | S06；首期不是 SDK 产品登录路线 |
| 研究结论 | 目前检索及更新后本机帮助不足以证明 Claude 所有原生工具有稳定的跨主机委派接口 | S05、S08–S10、更新记录；不是“不可能”，仍需工具契约实验 |
| 架构判断 | MCP 自定义工具、UI 文件 API 转发、hooks 改输出都不能单独证明全原生本地执行 | 由各接口语义推导，须经逐工具实验 |
| 开源事实 | CC Switch / DeepSeek Harness 有 MIT 许可；Cockpit Tools 不是 MIT | S12–S14；引入代码前仍需按固定提交和依赖逐项审计 |
| 身份核对 | Cursor 主仓库并非可直接 fork 的 IDE 核心；SDK Bridge 是独立协议项目 | S15–S16；用户若指另一仓库，后续补充核对 |

## 2. 原生运行时官方资料

### S01 · Codex App Server

来源：<https://developers.openai.com/codex/app-server>（本轮实际读取其 `.md` 版本）。

核对内容：stdio/双向 JSON-RPC、按版本生成 schema、thread/turn、模型、账号、额度/重置卡、dynamic tools、Code Mode host、文件/命令接口与实验性标志。

限制：App-server/相关传输包含实验性或不支持生产的说明；文档出现某字段不等于已安装版本暴露该字段。`command/exec` 等 UI 调用不证明 loop 内部工具位置。

### S02 · Codex Configuration Reference

来源：<https://developers.openai.com/codex/config-reference>。

核对内容：context/auto-compaction、service tier、shell/tool 开关、网络代理作用范围。特别注意命令沙箱网络策略不覆盖所有托管工具/连接器流量。

### S03 · Codex Authentication

来源：<https://developers.openai.com/codex/auth>。

核对内容：原生认证、设备码/浏览器回调、SSH 回调转发与自定义 provider 认证区分。不据此设计跨用户订阅池。

### S04 · Codex Speed

来源：<https://developers.openai.com/codex/speed>。

核对内容：Fast 是模型/账号相关能力，费用/额度行为依实际模式变化。文档不固定某个模型或倍率作为本产品永久默认。

### S05 · Claude Code CLI Reference

来源：<https://code.claude.com/docs/en/cli-reference>。

核对内容：结构化输入输出、工具列表、resume/fork、认证命令与模型设置。更新后 `claude --help` 是本机安装能力的第二份证据，而不是远端版本证明。

### S06 · Claude Code Legal and Compliance

来源：<https://code.claude.com/docs/en/legal-and-compliance>。

核对内容：托管未修改 CLI、保留原生认证、终端用户自行认证/计费、订阅凭据与第三方 SDK 产品边界。此处为工程约束整理，不提供法律结论；商用与再分发前重审。

### S07–S08 · Agent SDK Overview / Hosting（仅作对照研究）

来源：<https://code.claude.com/docs/en/agent-sdk/overview>、<https://code.claude.com/docs/en/agent-sdk/hosting>。

用途：理解 runtime、子进程、工具执行环境与会话状态的边界。**不意味着本项目采用 SDK 登录或以 SDK 替代 VPS 原生 CLI。**

### S09 · Claude Remote Control

来源：<https://code.claude.com/docs/en/remote-control>。

核对内容：远程控制既有运行主机的会话，与将原生工具执行宿主移至另一台本机不是一个需求。

### S10 · Claude Hooks

来源：<https://code.claude.com/docs/en/hooks>。

核对内容：工具前后事件、参数/结果处理时机；事后结果改写不等于事前取消远端副作用。

### S11 · Claude Model / Fast / Statusline

来源：<https://code.claude.com/docs/en/model-config>、<https://code.claude.com/docs/en/fast-mode>、<https://code.claude.com/docs/en/statusline>。

核对内容：模型/effort/Fast 区分、状态栏可见的额度字段。TUI 状态栏有字段不能推导 headless 协议一定同样可读；未取得的额度显示 unknown。

## 3. 用户指定开源参考的身份与许可

| ID | 项目 / 固定检索提交 | 可借鉴 | 不直接承诺 |
|---|---|---|---|
| S12 | `farion1231/cc-switch` · `f8788719a19be6cdef39151b1c0607b4608fa10a` · MIT | provider 配置、账号管理、桌面信息架构 | 管理工具不等于 agent loop |
| S13 | `deepseek-ai/deepseek-harness` · `46a7f68b0922371ce7144b668b90e377d8e799f4` · MIT | 插件边界、会话事件、Electron/Web/Headless 分层 | 采用其 loop 不等于保留两家原生 CLI 语义 |
| S14 | `jlcodes99/cockpit-tools` · `79870647b7d3403da037cd0064bccb5092822743` · CC-BY-NC-SA-4.0 声明 | 账号页、额度、实例管理的交互研究 | 有非商业限制，不按 MIT 复制/商用 |
| S15 | `cursor/cursor` · `654b1b4775ca67aef473bd31a14c8c04a1abde2d` | 产品与交互参考 | README 是下载/反馈入口；未确立核心开源授权 |
| S16 | `cursor/sdk-bridge` · `9a15af18d82cadd1f9cb9e8f6df3778b0daf8b23` · MIT | 外部进程/协议桥的设计参考 | 不是 Cursor IDE 核心，也不因此加入首期支持 |

固定提交证据：

- S12：[LICENSE](https://github.com/farion1231/cc-switch/blob/f8788719a19be6cdef39151b1c0607b4608fa10a/LICENSE)、[README](https://github.com/farion1231/cc-switch/blob/f8788719a19be6cdef39151b1c0607b4608fa10a/README.md)。
- S13：[LICENSE](https://github.com/deepseek-ai/deepseek-harness/blob/46a7f68b0922371ce7144b668b90e377d8e799f4/LICENSE)、[Architecture](https://github.com/deepseek-ai/deepseek-harness/blob/46a7f68b0922371ce7144b668b90e377d8e799f4/docs/architecture.md)。
- S14：[README](https://github.com/jlcodes99/cockpit-tools/blob/79870647b7d3403da037cd0064bccb5092822743/README.md)、[Cargo metadata](https://github.com/jlcodes99/cockpit-tools/blob/79870647b7d3403da037cd0064bccb5092822743/src-tauri/Cargo.toml)。
- S15：[README](https://github.com/cursor/cursor/blob/654b1b4775ca67aef473bd31a14c8c04a1abde2d/README.md)。
- S16：[README](https://github.com/cursor/sdk-bridge/blob/9a15af18d82cadd1f9cb9e8f6df3778b0daf8b23/README.md)、[LICENSE](https://github.com/cursor/sdk-bridge/blob/9a15af18d82cadd1f9cb9e8f6df3778b0daf8b23/LICENSE)。

本轮没有复制上述项目的代码/品牌资产。项目自身许可证尚未决定；公开可读不自动等于允许任意复用。

## 4. 安全与桌面来源

- S17 · [Electron Security](https://www.electronjs.org/docs/latest/tutorial/security)：renderer、IPC、外链与不可信内容隔离。
- S18 · [OpenSSH sshd_config](https://man.openbsd.org/sshd_config)、[ssh_config](https://man.openbsd.org/ssh_config)、[sshd](https://man.openbsd.org/sshd.8)：授权文件、转发、host key、撤销边界。
- S19 · [Docker Security](https://docs.docker.com/engine/security/)：daemon 权限、挂载和容器边界。
- S20 · [Linux cgroup v2](https://docs.kernel.org/admin-guide/cgroup-v2.html)：资源限制；不等同磁盘容量配额。

## 5. 本机软件更新来源

S21 · 官方 [Claude Code Setup](https://code.claude.com/docs/en/setup)、[Windows 安装脚本](https://claude.ai/install.ps1)、[Claude Desktop 下载](https://claude.com/download)、[Windows 部署说明](https://support.claude.com/en/articles/12622703-deploy-claude-desktop-for-windows)。

官方 CLI latest 指针：<https://downloads.claude.ai/claude-code-releases/latest>。

官方桌面 x64 MSIX latest 指针：<https://claude.ai/api/desktop/win32/x64/msix/latest/redirect>。

此次实际目标、安装包签名/校验和安装后版本记在 [更新记录](10-local-claude-update.md)。不能用 WinGet 缓存候选或发布目录版本代替安装后的 Appx 身份版本。

## 6. v0.2 环境与翻译的官方资料

### S22 · Claude Shell Prefix 与进程包装

来源：<https://code.claude.com/docs/en/env-vars>、<https://code.claude.com/docs/en/corporate-launcher>。

核对位置：`CLAUDE_CODE_SHELL_PREFIX`、`CLAUDE_CODE_PROCESS_WRAPPER`及corporate launcher的覆盖范围。Shell prefix可包装原生Bash及部分shell辅助命令；它不是Codex外置执行器，process wrapper也不是全工具委派协议。具体Windows/PowerShell例外及版本验收见 [15](15-claude-native-bridge.md)。

### S23 · Claude Tools Reference

来源：<https://code.claude.com/docs/en/tools-reference>，并结合 S05 CLI reference。

核对位置：Bash/cwd、后台命令、Edit、Glob/Grep、PowerShell。由此提出shell包装+文件视图候选；挂载本机文件不等于原生文件工具进程已迁到本机。

### S24 · 安全与执行隔离

来源：<https://code.claude.com/docs/en/security>、<https://code.claude.com/docs/en/sandboxing>，参照S19容器边界。

用途：支撑权限与真实隔离的边界。VPS profile、owner-wide文件面、Inventory分层与保证标签是本项目设计；官方文档不等于这些新模块已经实现。

### S25 · 可公开推理与签名

来源：<https://platform.claude.com/docs/en/build-with-claude/thinking>、<https://developers.openai.com/api/docs/guides/reasoning>。

用途：只处理实际公开可读文本，保护签名/不透明块，译文作为UI旁注。摘要不等于完整隐藏推理，不能为翻译而重构未公开内容。

### S26 · 模型目录与能力

来源：<https://platform.claude.com/docs/en/api/models/list>、<https://developers.openai.com/api/reference/resources/models/methods/list>。

用途：模型列表、能力字段与effort分开验证。某家官方返回能力不代表第三方兼容站实现；目录成功不能证明任意生成协议或强度档位可用。第三方翻译的实际endpoint/privacy在选定服务商后另行登记。

### S27 · 会话权限模式与固定版本参数（2026-09-25 JST 核对）

来源：官方 [Codex app-server 文档](https://developers.openai.com/codex/app-server.md)，并以 OpenAI 官方仓库 `rust-v0.155.1` 的 [ThreadStartParams](https://github.com/openai/codex/blob/rust-v0.155.1/codex-rs/app-server-protocol/schema/typescript/v2/ThreadStartParams.ts)、[ThreadResumeParams](https://github.com/openai/codex/blob/rust-v0.155.1/codex-rs/app-server-protocol/schema/typescript/v2/ThreadResumeParams.ts)、[TurnStartParams](https://github.com/openai/codex/blob/rust-v0.155.1/codex-rs/app-server-protocol/schema/typescript/v2/TurnStartParams.ts)、[AskForApproval](https://github.com/openai/codex/blob/rust-v0.155.1/codex-rs/app-server-protocol/schema/typescript/v2/AskForApproval.ts)、[SandboxMode](https://github.com/openai/codex/blob/rust-v0.155.1/codex-rs/app-server-protocol/schema/typescript/v2/SandboxMode.ts)、[SandboxPolicy](https://github.com/openai/codex/blob/rust-v0.155.1/codex-rs/app-server-protocol/schema/typescript/v2/SandboxPolicy.ts) 核实当前适配器实际使用的拼写。官方 [Claude permissions](https://code.claude.com/docs/en/permissions.md)、[CLI reference](https://code.claude.com/docs/en/cli-reference.md) 核实原生模式与 print 审批行为。仅读取文本，未读取图片、真实凭据或发起模型/SSH任务。

公开事实：Codex 固定版本的 thread start/resume 使用 `sandbox` 与 `approvalPolicy`，turn start 使用 `sandboxPolicy` 与 `approvalPolicy`；其字符串形式与最新网页示例并不全部相同。Claude 的 `--permission-mode` 接受 default、acceptEdits、plan 和 bypassPermissions；`--permission-prompts none` 在 print 模式下拒绝无人处理的权限询问。托管策略和原生版本仍可进一步限制模式。

本项目设计：Codex 的“默认权限”明确映射为 on-request + read-only，写操作需原生批准；“只读”为 never + read-only；“完全访问”为 never + danger-full-access。turn 对应 readOnly（networkAccess=false）或 dangerFullAccess。默认不沿用潜在宽权限的原生配置，也不按 cwd 新增 owner 文件围栏。Claude 依次映射 default、accept-edits、plan、full-access 到上述四种原生模式，保留无人审批拒绝。Claude 模式是 CLI 启动参数；未来已验收的桥应在确认回合结束后用明确会话 ID 恢复新进程来应用改变，不假造未公开的运行中控制消息。

实现证据边界：模式可在桌面保存，旧会话缺省为 default，运行时不支持的值拒绝；翻译、修订、提交与保存期间禁止并发改权限。合成协议测试验证 native 参数和回合边界，不等于真实原生权限、owner隔离或 H 链验收。两家真实 H 入口仍保持原有阻止状态。

### S28 · 远端登录入口与用户浏览器选择

来源：OpenAI 官方 [Codex authentication](https://developers.openai.com/codex/auth/)、Anthropic 官方 [Claude Code authentication](https://code.claude.com/docs/en/authentication)。本轮实际打开官方页面，同时在已授权 VPS 工作空间只读执行 `codex login --help` 与 `claude auth login --help`；未执行登录、获取 token 或启动模型。

官方资料支持 Codex 的设备代码授权与 Claude 原生账号登录。用户先选择 Claude 使用 VPS 原浏览器并回传实时画面，随后明确缩小本轮范围：只制作 Codex 设备授权，Claude 以后手动登录，工作台只扫描账号。浏览器画面仅保留为未来方向，不能作为已完成能力或账号风险保证。当前 Claude 网页账号不接入 Claude Code，详见 `20-remote-authentication.md`。

## 7. 已有本地工程证据（只读）

L01：本轮读取 `<private-reference>/codex-device-workspaces/README.md` 与插件 manifest。README 描述远端模型请求、本机执行、Windows 路径及 metadata 转发、设备/账号绑定，也记录宿主 UI/PiP 等待验收项。

解释：这是现有插件文档，不是本轮实机重验。它说明 H 方向已有经验，但不能据此声称两家通用桥接或新产品已完成。本轮未改其代码、读取私钥或访问会话数据库。

L02：本轮读取 `<private-reference>/codex-vps-setup/README.md`。它是既有登录/隔离记录；不把其中旧版本、账号状态、完成度视为本轮 VPS 现状。

L03：私有历史实施记录帮助定位既有工程 `<private-reference>/codex-device-workspaces`；本轮又只读核对 helper / device_server / verify_native 源码和历史验证记录。

当前任务中的原生 Win32 子窗口记录是 UI 证据；Codex 原生执行证据来自 exec-server / deferred executor 源码链以及 2026-09-23 JST 的真实 Windows 执行记录，两者分开。范围、模块和未验证项见 [基线](12-existing-codex-native-baseline.md)。

历史记忆只用于避免重犯侵入原生系统、同名会话定位、路径归属和未验收先宣称成功等问题；未将历史主机地址或账号身份复制到新项目。

## 8. 未确认事项

2026-09-26 补充：用户给出的 [Paseo](https://paseo.sh/) 已按固定提交核对 daemon/SSH、Claude Agent SDK 与 Codex app-server 实现，并对照两家官方认证说明。详细来源、执行位置差异和账号边界见 [23 · Paseo 远端架构对照](23-paseo-remote-comparison.md)。开源项目可用不等于官方风控豁免；不据此伪造设备或客户端标识。

- 更新后的 Claude 原生 CLI 是否能够满足 H 的完整工具委派，仍需公开接口与隔离实验；已确认本机版本/参数，不等于 VPS 已更新或桥接已验收。
- 两家的选定版本能否保留全部原生 shell/文件/图像/子 Agent/hooks/恢复能力并在本地执行。
- Claude 远端 headless 模式下可稳定读取哪些账号/额度字段。
- 用户所谓 Cursor 开源框架是否具体指另一个仓库。
- 最终商业模式、再分发权限、发行平台与强租户隔离要求。
- VPS profile/环境物化与owner-wide文件面能否覆盖所需原生工具而不暴露未授权宿主信息；仅投影不等于强隔离。
- 第三方翻译服务的具体协议/模型/effort、隐私、费用和语义质量；当前没有真实调用或账号配置。


### 翻译请求参数追加核对 · 2026-09-25

- OpenAI Chat Completions：`https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create` — `reasoning_effort`；Responses：`https://developers.openai.com/api/reference/resources/responses/methods/create` — `reasoning.effort`。档位是协议候选，具体模型不一定支持全部。
- Anthropic 模型目录：`https://platform.claude.com/docs/en/api/models/list` — `/v1/models`、`after_id`、`has_more`、`last_id`。
- Anthropic 思考：`https://platform.claude.com/docs/en/build-with-claude/extended-thinking`、`.../adaptive-thinking`、`.../effort` — `thinking.type=adaptive` / `output_config.effort`，手动 `budget_tokens` 至少1024且在本模块无工具调用场景小于max_tokens。

以上使用官方网页正文只读抓取核对；尚未对用户选择的第三方服务作真实模型调用。模块只输出请求档位，不能把兼容目录、手工确认或200响应当服务端实际采用的证明。

### Codex 0.155.1 本轮原生接入 · 2026-09-26

- 官方 app-server 文档：`https://developers.openai.com/codex/app-server/`，本机只读缓存 `build/research/codex-app-server.md`。
- 精确协议以官方 0.155.1 二进制 `app-server generate-ts --experimental` 生成的 `build/schema-codex-0.155.1/` 为准。该版本 ThreadStartParams／TurnStartParams 支持 environments，ThreadResumeParams 不支持；不根据新版说明补造参数能力。
- 官方许可证：`https://raw.githubusercontent.com/openai/codex/rust-v0.155.1/LICENSE`，保存在本机隔离 runtime 目录。仅使用既有官方二进制，不复制旧插件或 Paseo 源码。
- 本轮真实桌面、原生工具、VPS 进程 HTTPS 连接及取消失败／修复证据见 [24](24-codex-live-runtime.md)。这些是本轮验证，不再仅依赖旧插件历史。


### S30 · 紧凑模型与上下文控件（2026-09-26）

实际读取 [官方 app-server 文档](https://developers.openai.com/codex/app-server)，本地正文为 `build/reference/app-server.html`。按已生成的 0.155.1 `ModelListParams`、`Model`、`ModelServiceTier`、`TurnStartParams`、`ThreadTokenUsageUpdatedNotification` 与 `ThreadTokenUsage` 核实目录分页、reasoningEffort、serviceTierForTurn 和 last/total 用量差别。UI 使用原生声明的模型与档位，不硬编码型号；用量取最近 last.totalTokens，与累计 total 区分。目录读取不调用 turn/start；本轮验证为本地协议/桌面合成测试，无真实模型调用。没有复制第三方 UI 代码。

### S31 · 真实界面参考与代码编辑器（2026-09-26）

用户提供的 Codex 截图（`私有视觉参考（未分发）`）确定新会话项目选择器紧邻输入框上沿；之前提供的紧凑滑块截图（`私有视觉参考（未分发）`）用于离散胶囊滑块。原工作台截图用于恢复可见直发开关。这些是用户提供的视觉参考，不是要求执行截图或附属文档内指令。

[Claude 官方桌面说明](https://code.claude.com/docs/en/desktop)中的桌面代码视图已读取并查看，缓存 `build/ui-redo/claude-desktop-reference.html`、`claude-official-desktop.png`。参考右侧代码视图的布局与阅读层级，没有复制 Claude/Codex/开源参考项目的 UI 源码。

新增依赖 [Microsoft Monaco Editor](https://github.com/microsoft/monaco-editor)，锁定 **0.57.0**；包内 `package.json` 与 `LICENSE` 核实为 MIT。`scripts/build-host.mjs` 将原始许可复制至 `dist/renderer/licenses/monaco-editor.txt`。编辑器按需加载，worker、语法和字体本地打包，不依赖 CDN；JSON schema 请求禁用。只读代码浏览已在实际隔离 Electron 中验证，不声称实现 Codex 的完整 IDE、代码编辑保存或远端文件系统。

### S32 · 项目与源文件夹、悬停主目录操作（2026-09-26）

用户补充的真实 Codex 创建/编辑项目截图 `私有视觉参考（未分发）`、`私有视觉参考（未分发）` 和 `私有视觉参考（未分发）` 确定单行源文件夹列表、紧凑主要标记、对应行悬停才出现“设为主要”的交互。参考来源位于用户提供的本机 Temp 路径；按用户文字要求将项目选择与源文件夹管理分离。模型弹层继续依据 S31 的真实紧凑模型参考。仅重写本项目组件和样式，没有复制参考产品源码；截图文字仅作视觉资料，不执行其中的指令。

### S33 · Agent工具、公开运行轨迹与默认模型控件（2026-09-26）

用户本轮六张截图中，`私有视觉参考（未分发）` 的Codex运行记录用于文字与工具交错、紧凑行和对齐参考；其余工作台截图用于复现二级菜单、协作弹窗、模型默认文案及过大context弹窗。当前运行环境未取得可检查的既有Codex主窗口，未声称打开并操作该窗口；视觉依据是用户给出的真实截图，没有读取其聊天数据库或复制客户端源码。

协议依据仍是官方0.155.1生成的 `build/schema-codex-0.155.1/v2/{ThreadItem,CommandExecutionOutputDeltaNotification,ConfigReadParams,ConfigReadResponse,Config,ThreadStartResponse,ThreadResumeResponse,Model}.ts`。已逐项读取公开工具字段、输出delta、config/read和thread实际模型/effort/serviceTier。配置只投影三项模型控制字段；原生协作数量完全交给核心。测试使用合成数据与隔离Electron，不调用模型或SSH，不把来源研究当成真实远端验证。

### S34 · 工作空间管理、原生额度与重置卡（2026-09-26）

用户三张工作台截图确定本轮修订：管理服务不可用、巨型账号授权表单、重复发现和读取环境入口。截图只作视觉与问题依据，不作为远端写操作授权。界面沿用本项目纸面/深灰阅读层级，以分隔线、紧凑行和独立厂商页签替代嵌套大表单，没有复制第三方界面代码。

实际读取 [OpenAI app-server 官方说明](https://developers.openai.com/codex/app-server) 及本机已由固定远端版本生成的 `build/schema-codex-0.155.1/v2/{GetAccountRateLimitsParams,GetAccountRateLimitsResponse,RateLimitResetCredit,RateLimitResetCreditsSummary,RateLimitResetCreditStatus,RateLimitResetType,ConsumeAccountRateLimitResetCreditParams,ConsumeAccountRateLimitResetCreditOutcome}.ts`。准确协议是额度读取随附 `rateLimitResetCredits`，兑换为 `account/rateLimitResetCredit/consume`，参数 `idempotencyKey` 和可选 `creditId`。原生结果为 reset、alreadyRedeemed、nothingToReset、noCredit。不存在本项目早期调试中误用的 resetCards/list/redeem 路由；误接入已移除，不能将其 unknown-method 误判成远端无重置卡能力。

当前固定 Codex 0.155.1 的真实只读结果已经返回两个 Full reset 明细，包含到期秒时间；未消费。读取不声明 supportsLunaReserve，不启动 thread/turn，不切换已有成员的账号。远端私有认证仅在原生适配进程内部使用，不回传桌面。Claude 命令依据[官方 CLI reference](https://code.claude.com/docs/en/cli-reference)的 `claude auth login` 与 `claude auth status`；管理界面先支持各空间原生登录状态，未声称跨 UID 共享或通用额度接口。

### S-ClaudeUsage-20260926 · 订阅使用、协作与原生重试边界

2026-09-26 实际读取 Anthropic 官方 [Legal and compliance](https://code.claude.com/docs/en/legal-and-compliance)、[Consumer Terms](https://www.anthropic.com/legal/consumer-terms)、[Run Claude Code programmatically](https://code.claude.com/docs/en/headless)；原文、时间及 SHA256 见 `build/compliance/2026-09-26/manifest.json`。

公开事实：Pro/Max 额度以普通个人使用为前提；官方文档提供原生子 Agent 与 CLI 程序化接口，也公开 `system/api_retry` 的 attempt/max_retries/retry_delay_ms/error_status/error 字段。不能由程序化执行直接推导违规，也不能由原生 CLI 推导无限订阅使用许可。原生自行重试与工作台额外重启/补发须分开。

本项目工程决策：已知订阅凭据防误用、参与会话版本等待、当前 Claude 传输最终失败锁定与非空任务要求。没有 SDK 依赖，没有改变原生子 Agent 容量或重试预算。令牌前缀检查只识别已知格式，不证明第三方网关上游授权；锁定当前传输不等于跨进程账号冷却服务。完整边界见 [本轮审查](claude-usage-safety-20260926.md)。


### 用户参考：CodexQuotaGuard 的额度标定与共享账本（2026-09-26）

用户提供 [visaokc/CodexQuotaGuard](https://github.com/visaokc/CodexQuotaGuard)。实际只读取得版本 `035e092d43cd5be941687b0815ec9a9caaf09773`，缓存为 `build/reference/CodexQuotaGuard`；读取 `quota_guard/token_budget.py`、`quota_estimation.py`、`pool_accounting.py`、`shared_quota.py`、`shared_policy.py`、`meter.py`。借鉴同期 token/百分比增量经验标定、至少 2pp 再发布估算、缺失样本保留未知的思路，不把它当成官方固定汇率。

根目录未找到项目 LICENSE；第三方 notices 不能替代本项目源码许可。本次独立实现算法，没有复制源码、价格表或模型费率。用户要求的逐账号/窗口隔离、余额最多者优先、偿还原出借方由本项目独立实现，不照搬参考项目的比例/跨账号池策略。参考代码不证明当前 VPS 已部署或所有客户端可信计费。


### 账号入口、原生认证与多空间核查（2026-09-26）

用户追问同一账号分给三个空间是否应共用一个原生运行入口。按 OpenAI Docs 检索并实际打开 [App Server](https://developers.openai.com/codex/app-server/)、[Authentication](https://developers.openai.com/codex/auth)，及 Claude 官方 [Legal and compliance](https://code.claude.com/docs/en/legal-and-compliance)、[Authentication](https://code.claude.com/docs/en/authentication)、[Remote Control](https://code.claude.com/docs/en/remote-control)。区分共享可执行文件、由原生运行时持有登录、独立会话和实际使用者；不把减少 OS 进程数当作降低风控的官方保证。没有复制 CLI 或登录资料，没有部署账号运行服务。具体建议和当前复选框缺口见 `account-runtime-boundaries.md`，未将建议标成已验收能力。

后续实现复核（同日）：新账号入口已在本地实现，实际状态见 U81，不再是纯提案。再次读取固定版本生成的 `build/schema-codex-0.155.1/v2/Thread.ts` 与 `ThreadStartedNotification.ts`，以原生 `parentThreadId` 识别可能早于 spawn 完成回执的子线程；不根据模型正文或未知外来线程认定归属。本轮后续在线文档请求未返回可核验正文，不把空返回视为条款或风控规则的最新核实。本地代码保护不证明官方风控阈值或真实模型链已验收。


### U82：固定版本历史迁移依据（2026-09-26）

本轮 web 搜索/打开官方 App Server 页面仍未返回可核验正文；随后直接取得 OpenAI 官方固定标签 `rust-v0.155.1` 的 `codex-rs/protocol/src/protocol.rs`，来源 `https://raw.githubusercontent.com/openai/codex/rust-v0.155.1/codex-rs/protocol/src/protocol.rs`，本地只读参考为 `build/reference/codex-protocol-0.155.1.rs`。仅核对格式，不复制第三方实现代码。实际读取 SessionMeta、SessionMetaLine、SessionSource、HistoryPosition、ThreadHistoryMode 与原生消息/回合事件字段：parent_thread_id 是正式父线程字段；history_base.thread_id 表示物理 rollout ID，历史回退后可不同于逻辑线程 ID。迁移因此区分物理文件与逻辑线程，并要求完整前缀和明确根版本。

原生恢复 API 依据本地生成的 `build/schema-codex-0.155.1/v2/ThreadResumeParams.ts`：path 被标为 unstable；history 标注云用途且不应使用。实现仅在管理员已核对的所有者回执中注入 path，不接受成员自选路径或人工拼接 history。`v2/Account.ts` 的 ChatGPT 类型只公开 email/planType，不暴露可核对旧 fingerprint 的账号 ID，因此原账号确认是明确的管理员操作，不冒充无人工步骤的可靠身份匹配。

独立验证 `scripts/test-codex-history-offline.py` 使用现有官方 Windows 0.155.1 二进制、隔离 HOME/CODEX_HOME、无账号和无凭据的合成历史，测试 provider 只指向关闭的回环端口。确认原线程与原生用户/助手历史可恢复、原文件前缀保留；没有登录或 turn/start 请求。它不替代 Linux/VPS 的真实账号迁移、模型/H 或出网验收，也没有更新任何真实 CLI/服务。

### U83–U85：文件交互参考与原生修改格式（2026-09-26）

交互依据是用户本轮提供的四张 Codex 桌面截图（项目根切换、顶部打开菜单、链接菜单、已编辑文件卡片），不是对所有当前 Codex 平台功能的概括。菜单与视觉独立实现，没有复制 Codex 界面代码。保持本项目的暖白、炭灰与文学阅读风格。

协议核对使用本地官方固定版本生成的 `build/schema-codex-0.155.1/v2/FileUpdateChange.ts`、`PatchChangeKind.ts`、`PatchApplyStatus.ts`，并直接取得 OpenAI 官方固定标签 `rust-v0.155.1` 的 `codex-rs/app-server-protocol/src/protocol/item_builders.rs`（`https://raw.githubusercontent.com/openai/codex/rust-v0.155.1/codex-rs/app-server-protocol/src/protocol/item_builders.rs`），本地只读参考为 `build/reference/codex-item-builders-0.155.1.rs`。实际核对 `convert_patch_changes`／`format_file_change_diff`：add 与 delete 的 diff 是完整内容，update 是 unified diff，重命名使用 `move_path`。这一区分用于避免把新增文件漏记为零或把正文中的加减号错算为差异。仅核对字段与语义，没有复制第三方实现代码。网页检索工具未返回正文；以上事实依据成功取得的固定标签源码及已有生成类型，不声称核实了“今早最新版”的完整变更日志。


### U93 · 官方共享 CLI 安装来源与只读部署诊断（2026-09-26）

网页检索工具未返回可核验正文，随后通过 HTTPS 实际取得官方 Codex CLI 文档 `https://developers.openai.com/codex/cli`、Claude 安装文档 `https://code.claude.com/docs/en/setup.md`。固定版本来源为 OpenAI 官方发布元数据 `https://api.github.com/repos/openai/codex/releases/tags/rust-v0.155.1`（两种 Linux musl 架构 tar.gz 的资产 SHA256/大小）和 Anthropic 官方 `https://downloads.claude.ai/claude-code-releases/2.1.281/manifest.json`（Linux x64/arm64、glibc/musl 的校验值/大小）。本地参考分别为 `build/reference/codex-cli-install.html`、`claude-setup.md`、`codex-0.155.1-linux-assets.json`、`claude-2.1.281-manifest.json`。不跟随 latest 指针，不根据较新文档放宽现有适配器版本；运行时架构支持与实测范围分别记录，实际下载执行仅测试了本机 Linux x64 两家固定包的 `--version`。

许可证单独核对：实际取得 OpenAI 固定标签的 `https://raw.githubusercontent.com/openai/codex/rust-v0.155.1/LICENSE`（Apache 2.0）与 `https://code.claude.com/docs/en/legal-and-compliance.md`。Claude 使用受其相应商业或消费者条款约束，不作为开源代码复制到本项目。代码只实现独立下载/校验/安装流程；未复制官方安装脚本、未将第三方二进制打包提交，未声明第三方账号共享或产品再分发获得额外许可。参考保存于 `build/reference/codex-0.155.1-LICENSE`、`claude-legal-install.md`。

真实 VPS 检查只执行了命令位置、路径所有权和只读准备预览。管理员 SSH 可用；root Codex 的实际目标经过私有目录，且二进制和直接父目录归成员所有，属于不适合复用的共享安装，不应显示为“整机没安装”。Claude 仅能确认在检查的已知位置未发现。该证据不能替代统一服务部署、原生登录、模型与 H 验收。


### U95 · 聊天分支协议与交互依据（2026-09-26）

交互参考为用户本轮两张截图：侧栏「分支 → 创建聊天分支」和回复下方「分支到新聊天」。保留本项目既有阅读式视觉；独立实现菜单、历史边界、来源导航和持久化，没有复制参考产品代码。

网页工具本轮仍未返回可核验正文，随后通过 HTTPS 实际取得官方 App Server 页面 `https://developers.openai.com/codex/app-server`，核对原生 `thread/fork` 创建新线程及 `thread/rollback` 已弃用的说明。执行字段以现有官方固定版本生成的 `build/schema-codex-0.155.1/v2/ThreadForkParams.ts`、`ThreadForkResponse.ts`、`Thread.ts`、`ThreadTurnsListParams.ts` 为准：`lastTurnId` 包含指定已结束回合，`beforeTurnId` 排除指定回合及以后内容，两者互斥；`deferGoalContinuation` 推迟目标自动续跑，`forkedFromId` 标识来源。分支请求不使用 path/history 重建，不切换 provider，不调用源线程 rollback。

独立脚本 `scripts/test-session-fork-native.py` 使用已有官方 Windows 0.155.1 二进制与合成历史验证两个截断方向、完整分支、独立 ID、来源不变和真实进程重启恢复。HOME/CODEX_HOME 隔离、没有账号，provider 限于关闭的回环端口；未发送登录或模型回合。此证据只证明该固定版本的离线历史语义，不代替 VPS 账号服务部署、Claude 能力、真实模型、H 或出网验收。

## 原生记忆与 Skill 补充核查（2026-09-26）

Skill 导入弹窗后续视觉参考：实际通过浏览器查看 https://www.shadcn.io/blocks/file-upload-paste-url 及其 https://www.shadcn.io/view/file-upload/paste-url 预览，确认细标签切换、单一虚线拖放区域、图标与两行提示的结构。shadcn.io 为第三方组件站点，不是官方 shadcn/ui 项目；仅参考界面结构，未复制其实现或付费资源。本项目独立实现紧凑弹窗与拖放通道。Electron 路径接口依据仓库已安装版本的 node_modules/electron/electron.d.ts 中 webUtils.getPathForFile 的官方声明，并用隔离 Electron 的真实磁盘文件拖放验证；浏览器内构造的无磁盘 File 不当作本机文件。

- OpenAI Memories： https://developers.openai.com/codex/customization/memories 。Codex Home 中的记忆是生成状态；不将手改生成索引作为同步控制面。
- OpenAI Skills： https://developers.openai.com/codex/skills 。原生技能发现目录、同名并存与基于路径的原生开关。
- Claude Memory： https://code.claude.com/docs/en/memory 。项目记忆、autoMemoryDirectory、MEMORY.md 索引及首轮加载限制。
- Claude Skills： https://code.claude.com/docs/en/skills 。SKILL.md、原生个人/项目目录和运行时特有动态能力。

调查结论是两家 Markdown 可读，不能据此宣称 Claude 接管 Codex 的自动提取整合协议。最新产品修订采用一个开关控制双向增量适配；公开事实、产品设计和本地验收见 docs/35-native-memory-skills-plugins.md。

同日再次取得官方正文：Codex 文档区分 extract_model 与 consolidation_model，并说明后台等待空闲及额度门槛；Claude 文档区分全局用户 CLAUDE.md 与按仓库的自动记忆，指出记忆由 Claude 决定写入并跳过 CLAUDE.md 已有内容。未发现可直接调用的跨厂商语义去重函数。工作台只实现内容指纹、来源身份和防回流，不将它冒充原生 Agent 的语义整理。用户无需先启动 Claude，原生全局文件可以直接建立。

Skill 显示字段同时由本机只读验证：原生 agents/openai.yaml 的 interface.display_name、short_description 与 icon_small / icon_large。示例中的短描述比 SKILL.md 的完整描述更短；工作台按原字段显示，不复制原生文件、不改变模型发现元数据。

### Skill 可选展示字段与 CC Switch 分发（2026-09-26）

本轮通过网页工具实际打开 OpenAI https://developers.openai.com/codex/skills （重定向到 https://learn.chatgpt.com/docs/build-skills ）与 Claude https://code.claude.com/docs/en/skills 。OpenAI 明列 agents/openai.yaml 为可选 appearance / dependencies 元数据；Claude 的推荐描述来源为 SKILL.md frontmatter.description，没有要求该 OpenAI 展示文件。Claude 的动态命令、变量与 fork 属于额外运行时行为，不能将共享目录本身当作格式转换。

同时读取 CC Switch 上游 main 的 https://github.com/farion1231/cc-switch/blob/main/src-tauri/src/services/skill.rs 及 raw 正文。get_ssot_dir 支持 ~/.cc-switch/skills 或 ~/.agents/skills；get_app_skills_dir 定位各应用技能目录；sync_to_app_dir 在 Auto 模式尝试 symlink，失败回退 copy，已有普通目标目录沿用复制；parse_skill_metadata_static 读取 SKILL.md 名称与描述。所核对的同步链路仅分发原目录，没有生成 OpenAI 展示字段或转换 Claude 运行语法。此结论针对读取的上游源码，不代表已经检测用户本机 CC Switch 版本。仅作实现核查，未复制第三方代码、未修改 CC Switch 配置。


## Device-local memory handoff research (2026-09-27)

### CLI maintenance and native plugin catalog follow-up

Official setup reference refreshed through HTTPS: `https://code.claude.com/docs/en/setup.md`. Windows native Claude uninstallation removes only `~/.local/bin/claude.exe` and `~/.local/share/claude`; optional configuration deletion is a separate operation and is not implemented here. Native installation defaults to the latest release; later updates retain the configured release channel. Codex Windows npm removal uses `npm uninstall -g @openai/codex`, after checking that the active npm global prefix owns the selected installation. Unknown install channels remain unsupported, not guessed.

Installed executable evidence: Codex **0.157.1** `app-server --help` exposes `--strict-config`. An isolated parser probe accepts `memories.disable_on_external_context` and rejects a deliberately unknown memory key. Claude Code **2.1.283** passes initialization metadata shape checks and the bundled-enabled/disabled difference, yielding 15 bundled skills. These capability checks replace the accidental old patch-version gates; the separately verified legacy 0.155.1 fallback remains explicit. Metadata process trees are terminated after confirmed responses, including background helpers, so disposable profiles do not wait on inherited pipes.

Codex 0.157.1 generated experimental protocol schemas (`app-server generate-json-schema --experimental`) define `plugin/installed`, `plugin/list`, `plugin/install`, configuration layers and versioned `config/batchWrite`. Installed discovery and available catalogs are combined, while partial catalog failure preserves native installed evidence. Claude 2.1.283 native help confirms `plugin list --available --json`, `plugin install <id> --scope user --json` and `plugin marketplace add`. Its install help explicitly reserves extra confirmation for command sources / headers helpers; the workbench never adds `-y` or a command-acceptance hash automatically. Claude's unregistered official marketplace is previewed from the public `anthropics/claude-plugins-official` marketplace manifest, and registered through the native CLI only after an install confirmation. Already configured markets stay native. No third-party implementation source was copied.

Evidence is version-specific: the isolated native acceptance script installs locally generated fixture packages through both actual native runtimes and confirms discovery and group switches. This does not certify every remote marketplace, subscription entitlement, plugin-specific authentication, dependency, managed policy or native command-confirmation flow. Real user CLI installation/update/removal are covered by command and state simulations, not actual mutations. No real model turn, production native configuration write or VPS change occurred.

### Local CLI management and native memory controls follow-up

Primary sources fetched through HTTPS: `https://developers.openai.com/codex/cli/`, `https://developers.openai.com/codex/config-reference/`, `https://code.claude.com/docs/en/setup.md`, `https://code.claude.com/docs/en/memory.md`, `https://code.claude.com/docs/en/settings-reference.md`, `https://code.claude.com/docs/en/managed-settings.md`, and `https://code.claude.com/docs/en/server-managed-settings.md`. The web tool returned no usable page body in the follow-up, so its empty result is not cited as verification. Claude documents `/memory` writing `autoMemoryEnabled` to user settings, plus environment, project and managed precedence. An auto-memory toggle does not disable CLAUDE.md instructions. Managed sources include MDM/registry/server policies beyond the currently implemented local file checks; their complete precedence is not certified by this panel.

Version-specific local evidence: installed Codex 0.155.1 configuration RPC and desktop application code distinguish the main memory switch from allowing memory generated from tool-assisted chats. The main switch sets the memories feature, generation and use together; the tool-chat setting writes `memories.disable_on_external_context`, replacing the legacy spelling. Native config versions are semantic, so the workbench also checks the raw text revision. Isolated real-CLI tests cover writes, read-back, trusted project overrides and concurrent-change rejection; no model turn or real-user configuration mutation is required.

User-requested CC Switch inspection: upstream `farion1231/cc-switch` commit `1ee2fdc3a791f1e73476c631c7ab7ce8fac0638f`, `src-tauri/src/claude_desktop_config.rs` and `docs/user-manual/zh/2-providers/2.6-claude-desktop.md`; official Desktop configuration source `https://claude.com/docs/third-party/claude-desktop/configuration.md`. CC Switch distinguishes CLI `~/.claude/settings.json` from Desktop deployment mode and `configLibrary` profiles. Only configuration semantics were inspected; no third-party implementation was copied into production.

Authorized temporary native Desktop experiment: four previously absent, exclusively created user files supplied a fake Gateway key and closed loopback endpoint; a full restart of Claude Desktop 2.7032.0.0 reached the third-party home page (Gateway shown). After the user stopped input automation, verification used read-only window text. The memory settings page was not reached, so neither its layout nor the total number of Desktop memory switches is certified. All four owned files/fields were cleaned, and a fresh restart was observed at the original official login entry. The pre-existing packaged-app configuration, CLI settings, actual credentials and account/chat databases were not inspected or changed. The temporary API did not make a successful inference request.

Installation/update design uses official installers and existing native directories. Checks and command selection are tested; actual installation/upgrading, generic alternate install channels and remote deployment are not covered by this turn. Remote automatic-memory disablement is source-only. These facts do not establish local-memory recall by a remote agent or a universally shared Desktop/CLI configuration.

Public facts, refreshed from the official sources above in this turn: Claude Code uses a short MEMORY.md index and topic files, with a 200-line / 25KB startup read limit and an effective autoMemoryDirectory setting. Codex describes its memories as generated state and advises against manual edits as the primary control surface. These facts do not establish a universal cross-runtime import API.

Product design: runtime-bound, device-local immutable archives; explicit first-source choice; receiver-side semantic deduplication during an existing user task; English destination prose; token-bound file/index receipts. Hashes prove bytes, not semantic equivalence, translation quality, native background consolidation or future recall. The depot never chooses routing from a model name, provider or API URL. Third-party models receive an explicit host-runtime format guide.

Verification: temporary native homes and synthetic protocol adapters only. Real Claude H remains unverified. Codex generated-memory external ingestion and remote-runtime/local-store mapping are not certified by file/index tests. Unsupported routes remain pending; no extra model turns, real credentials or VPS mutations were used. See docs/35-native-memory-skills-plugins.md and docs/16-implementation-status.md.

## 原生记忆开关语义复核与插件接口审查（2026-09-27）

公开事实，已通过 HTTPS 读取官方正文：

- `https://developers.openai.com/codex/config-reference/`：`memories.generate_memories` 控制新线程是否成为记忆生成输入；`memories.use_memories` 控制未来会话是否注入已有记忆；`memories.disable_on_external_context` 排除使用 MCP、网页搜索或工具搜索的线程。该项默认 false，旧别名为 `no_memories_if_mcp_or_web_search`。这不是所有本地工具操作的通用排除开关，也不是启用记忆的第二个总开关。
- `https://code.claude.com/docs/en/memory.md` 与 `https://code.claude.com/docs/en/settings-reference.md`：Claude Code 公开 `autoMemoryEnabled`、自动记忆目录与 CLAUDE.md 加载相关设置；本轮未找到与 Codex 外部工具聊天来源过滤等价的独立开关。不能把它说成“Claude 所有记忆设置只有一个”，也不能把 CLI 说明扩展为 Claude Desktop / Cowork 设置已核实。

产品映射：Codex 页面保留两个独立配置入口，移除缩进和父项关闭时的禁用；原生覆盖也分别判断。来源偏好不会启用生成或读取，记忆关闭时依然可以预先保存。当前统一记忆开关仍同时设置原生 feature/generate/use 三项；原生已有读取与生成差异继续提示。Claude 页面只呈现已核实的自动记忆布尔开关，不虚构工具来源控制。

实现事实：工作台原有插件 API 只有有限的声明式外观与宿主中间件；本轮新增核心服务调用、状态事件及经整包批准的 renderer bundle/界面替换入口。此为本项目实现和设计，不是两家原生插件能力。接口、信任边界、示例和恢复方式见 `36-workbench-plugin-api.md`。web 工具未返回可用页面正文，本轮官方核实使用上述页面的实际 HTTPS 响应，不把空 web 返回当引用证据。


## Model API connections and context ownership (2026-09-28 JST)

Primary sources fetched over HTTPS with HTTP 200 and inspected in this turn:

- OpenAI Models list: `https://developers.openai.com/api/reference/resources/models/methods/list`. The standard directory exposes model identity/owner/availability, not a universal reasoning-effort or context-window catalog. Unknown metadata must remain unknown.
- OpenAI function calling and streaming: `https://developers.openai.com/api/docs/guides/function-calling`, `https://developers.openai.com/api/docs/guides/streaming-responses`. Protocol-owned function call IDs and matching results are preserved, with completed-stream receipts before tool dispatch.
- OpenAI compaction: `https://developers.openai.com/api/docs/guides/compaction`. Responses offers opt-in `context_management` with `compact_threshold` and encrypted compaction items. This is protocol-specific, not a universal model setting or a portable cross-provider state.
- Anthropic Models: `https://platform.claude.com/docs/en/api/models/list`. Actual metadata includes nullable `max_input_tokens`, `max_tokens`, capability details, and pagination. Reported effort support can be nested by effort name.
- Anthropic effort and tools: `https://platform.claude.com/docs/en/build-with-claude/effort`, `https://platform.claude.com/docs/en/build-with-claude/tool-use/implement-tool-use`. Effort is mapped to `output_config.effort`; adaptive thinking is enabled only when explicitly reported. Tool results match the original tool-use ID.

Design, not an upstream fact: this workbench's generic API runner uses bounded public-transcript summarization with an 80%/output-reserve budget and conservative byte estimates. SSH keeps native compaction. Manual capability overrides are explicit; no name-based lookup, provider switching, hidden-state conversion or generic SDK login is introduced. No reference-project code or dependency was copied, so no third-party implementation license was adopted.

The web tool returned no usable page body; actual HTTPS responses were saved under ignored `build/qa/model-api/source-*.html`. Verification is synthetic protocol plus isolated Electron and local-file evidence, not live paid-model or SSH-model acceptance. See `model-api-connections.md`.


## Sidebar interactions and attachment inputs (2026-09-28 JST)

Verified native fact: the existing repository Codex 0.155.1 executable generated `build/qa/drag-attachments/codex-schema/v2/UserInput.ts` using `app-server generate-ts`. Its union contains `image` with `url` and `localImage` with `path`. The workbench uses image data URLs because local desktop paths are not remote filesystem paths. The existing supervisor/native-owner transport and VPS broker all impose an 8 MiB frame limit; the local 5 MiB image budget is a workbench preflight design, not an upstream model limit. No CLI installation, native login or model turn was used for schema discovery.

Primary HTTPS sources returned HTTP 200 and their input examples were inspected:

- `https://developers.openai.com/api/docs/guides/images-vision`: Responses image parts use `input_image` and `image_url`; base64 image inputs are documented.
- `https://developers.openai.com/api/docs/guides/pdf-files`: file-data input is supported for PDFs in both Responses and Chat Completions; non-PDF file input support differs by protocol. The implementation sends UTF-8 text as reference text rather than assuming universal binary support.
- `https://platform.claude.com/docs/en/build-with-claude/vision`: base64 image sources carry `media_type` and `data`.
- `https://platform.claude.com/docs/en/build-with-claude/pdf-support`: PDF document sources use base64 with `application/pdf`.

The web tool returned no usable body; inspected HTTPS responses are retained under ignored `build/qa/drag-attachments/source-*.html`. These public protocol examples do not prove support by every model or compatible third-party endpoint. Native image inputs, API requests, immutable-file boundaries and desktop interactions are tested with synthetic transports. Real paid-model/SSH image comprehension remains unverified.

Sidebar hover cards, five-row defaults, attention/running/unread/recency sorting, persistent folding and manual project order are workbench design decisions based on the user's screenshots and direct requests, not claims about undocumented Codex internals. No reference-project code or new dependency was copied.

## Model API settings simplification and directory diagnostics (2026-09-28 JST)

Primary reference inspected through HTTPS: `https://www.electronjs.org/docs/latest/api/net`, specifically the net.fetch section. Electron documents that net.fetch uses Chromium's network stack, while Node fetch uses Node's HTTP stack. The production translation and model API paths both currently use Node fetch; this change does not introduce a fallback or silently alter proxy configuration.

Local evidence is separate from that public fact: unauthenticated GET probes to the user-provided public model-directory endpoint returned ECONNRESET in Node and isolated Electron Node, ERR_CONNECTION_CLOSED in isolated Chromium, and a TLS handshake failure from Windows curl. No HTTP response or authentication result was observed. These probes do not establish that the key is invalid, nor that earlier successful translation used the same network conditions. No real key or private translation configuration was inspected.

Design choices: key presence determines authentication; omission preserves a saved scoped credential, explicit empty input clears it. Tools are provided by default with existing authorization and approval gates. Reported output limits take precedence over the internal fallback. Read-only model-directory failures have stage-specific sanitized diagnostics; task POST failures keep uncertain-result handling and never trigger automatic replay. A directory 404 can coexist with a valid manually mapped inference endpoint.

No external implementation code or new dependency was introduced. The web tool returned no usable source body; the official net.fetch paragraph was inspected via Invoke-WebRequest. Synthetic request parity and error cases, plus isolated hidden Electron evidence, are recorded in `build/qa/model-api-redesign`.


## SSH onboarding and workspace authorization (2026-09-27 UTC)

Primary references fetched over HTTPS with HTTP 200 and inspected:

- `https://man.openbsd.org/ssh_config`: Hostname, Port, User and IdentityFile are distinct connection settings. Port defaults to 22; User selects the remote login identity. The workbench reads only an explicit literal subset of the configuration and never evaluates executable directives.
- `https://learn.microsoft.com/en-us/windows-server/administration/openssh/openssh_keymanagement`: private keys are authentication credentials and should remain protected; the server associates a public key with the requested login user. Local file access control and remote account privileges are different concerns.

Repository design: selecting a key does not copy it until connection confirmation. The copied file preserves bytes; Windows grants the current SID full control within a new non-inheriting private directory, and POSIX mode is 0600. This does not change the key's remote account or permissions. Workspace export is a one-use bootstrap capability, not a file backup or export of an existing administrator key. Managed capabilities bind to the original workspace identity. Suspension retains device grants for exact-key restoration; revocation/deletion prevents restoration. Completed-import replay is rejected; only an unconfirmed exact-key registration is recoverable.

Validation is separated: synthetic SSH runners, temporary real filesystem fixtures in local WSL, and hidden isolated Electron UI. No live VPS update or real SSH/model acceptance occurred. Direct key-copy tests compare source and destination bytes; they do not infer remote privilege changes from local ACLs. The web tool returned no usable body, so inspected official HTTPS responses are retained under ignored `build/qa/ssh/source-*.html`. No external implementation code or dependency was introduced.


## SSH file drop and optional server identity records (2026-09-27 UTC)

Official references inspected via HTTPS (the web search tool returned no usable body):

- `https://man.openbsd.org/ssh.1`: the client stores server host public keys in `~/.ssh/known_hosts` to identify hosts. This is distinct from the user's private authentication key and does not itself authorize a login.
- `https://www.electronjs.org/docs/latest/api/web-utils`: `webUtils.getPathForFile` resolves an OS-backed File to a filesystem path; a browser-created File has no corresponding path. The workbench uses the isolated preload bridge, not renderer key bytes, for dropped files.

Design: one click/drop area detects a supported private-key header or reads the existing safe literal SSH configuration subset. Selection neither installs the key nor connects; confirmed connection retains the prior copy and explicit fingerprint-verification flow. `known_hosts` is an optional reuse path for already trusted records; first-time users can omit it. No verification bypass, external implementation code, or new dependency was added.

Sources and isolated validation evidence: ignored `build/qa/ssh-drop/`. Synthetic key/config fixtures were used; no real private key, VPS deployment, model task, or active-user-client operation was involved.


## Running conversation controls and permission boundary (2026-09-27 UTC)

- Official OpenAI App Server documentation: `https://developers.openai.com/codex/app-server` was retrieved directly over HTTPS after web-tool calls returned no usable content. It documents `turn/steer` as adding input to an in-flight turn.
- Official OpenAI CLI slash commands: `https://developers.openai.com/codex/cli/slash-commands` describes the permissions menu; the existence of a menu is not evidence of current-turn sandbox mutation.
- The repository's official Codex **0.155.1** generated `ThreadSettingsUpdateParams.ts` explicitly scopes approval-policy/sandbox overrides to subsequent turns. `TurnSettingsUpdateParams.ts` does not expose either field. The real isolated runtime rejects `approvalPolicy` in `turn/settings/update`; a successful `thread/settings/update` leaves both following tool steps in that running turn on the old approval policy. See the reproducible probe and limitations in `session-controls-20260927.md`.
- Official source inspected as reference only: `https://github.com/openai/codex` TUI `app/thread_settings.rs` and app-server tests `thread_settings_update.rs` / `turn_settings_update.rs`. The TUI uses the thread-settings RPC; these files were not copied into shipped source.
- Claude permissions reference: `https://code.claude.com/docs/en/agent-sdk/permissions` describes a runtime `setPermissionMode` control. This does not establish that our unverified Claude H bridge implements it, nor authorize replacing the native authentication/execution direction with an SDK.

Implemented design: immediate API executor permission rechecks, explicit native steer, per-scope preferences, public-message translation, evidence-only memory tooltips, and a local sandboxed HTML preview. The user's superseding clarification requires forwarding Codex permission selections through `thread/settings/update` immediately while a turn runs, then saving the selection and preference only after native acknowledgement. Downstream enforcement timing belongs to the CLI and is not a reason to block the selector; the workbench neither restarts the turn nor rewrites its initial settings snapshot. The unverified Claude H boundary is unchanged. No upstream implementation code or dependencies were incorporated. Native probe reports, generated schema, source reference copies and hidden Electron evidence remain ignored QA artifacts under `build/qa/session-controls/`; the forwarding change has separate synthetic controller and protocol evidence under `build/qa/native-permission-forwarding/`.


## Remote native CLI and browser authorization (2026-09-27 UTC)

Primary HTTPS sources inspected; cached copies are under ignored build/qa/remote-cli. Web-tool reads returned no usable body, so official pages/scripts were read directly over HTTPS without opening a browser or authorization page:

- https://developers.openai.com/codex/cli and https://developers.openai.com/codex/auth describe native CLI installation and device authorization. Official installer: https://chatgpt.com/codex/install.sh; current-channel metadata: https://releases.openai.com/codex/channels/latest. Release selection is dynamic at preview/apply, not hardcoded to an observed version.
- https://code.claude.com/docs/en/setup and https://claude.ai/install.sh provide the official native installer. Latest/version manifests are under https://downloads.claude.ai/claude-code-releases/. Native installer scripts were inspected, not executed against a real environment in this task.
- https://code.claude.com/docs/en/authentication.md explicitly describes the normal browser callback and the Paste code here if prompted fallback when the browser cannot reach the CLI callback, including SSH/WSL/container cases. The fallback is an authorization code, not an API key. This public description does not prove our deployed flow works; only synthetic callbacks were exercised.
- Google Chrome official RPM/signing key: https://dl.google.com/linux/direct/google-chrome-stable_current_x86_64.rpm and https://dl.google.com/linux/linux_signing_key.pub. Stable version preview uses the official versionhistory.googleapis.com endpoint. Production design verifies RPM signature, architecture and reviewed version before extraction.
- noVNC v1.6.0: https://github.com/novnc/noVNC/tree/v1.6.0 (MPL-2.0 plus included permissive component licenses); websockify v0.13.0: https://github.com/novnc/websockify/tree/v0.13.0 (LGPL-3.0). Their codeload archives and included license files were inspected and hashed; hashes and provenance are in remote-management-20260927.md. They are separate remote programs, never loaded into the workbench extension host.
- https://man7.org/linux/man-pages/man2/PR_SET_PDEATHSIG.2const.html states that credential changes clear the parent-death signal and that the setting survives ordinary exec. The integration sets it after dropping UID and checks the parent race; only direct-child crash cleanup was simulated. The reference is cached in build/qa/remote-management/parent-lifetime-reference.html.

Repository choices: reuse the user's remote-browser scripts with explicit profile selection; bounded SSH supervision; no local OAuth URL, cookie or credential transfer; native status confirmation; conditional code forwarding; cleanup receipts; full reviewed DNF transaction; per-provider CLI maintenance leases. Tests must never use the user's real Claude browser login state or real authorization. No external implementation code was copied beyond the explicitly supplied user-owned scripts; downloaded third-party binaries/archives are not committed. Live VPS deployment, native-installer execution, actual Claude OAuth and Claude H remain separate and unperformed.

## Native VPS runtime versus subscription API proxies (2026-09-27 UTC)

Scope: public primary-source review and local source inspection only. Web search/open tools returned no usable content; primary pages were fetched directly over HTTPS. No real credentials, private configuration, chat databases, VPS sessions, model calls, or active client UI were accessed. This is an architecture and published-policy comparison, not a measurement of account-enforcement probability or a certification of a live deployment.

### Verified public facts

1. OpenAI App Server: `https://developers.openai.com/codex/app-server.md` describes integrating Codex into one's own product, including authentication, conversations, approvals and events. It documents remote connections, managed ChatGPT authentication and a distinct experimental external-token mode. Clients should identify themselves truthfully through `clientInfo.name`. Current experimental features do not retrospectively validate the repository's pinned 0.155.1 deferred-executor contract.
2. OpenAI authentication: `https://developers.openai.com/codex/auth.md` supports ChatGPT subscription sign-in and separately billed API-key sign-in, describes remote/headless device-code login, and directs programmatic workflows such as CI/CD toward API-key authentication. Remote hosting alone is therefore not evidence that a client is a subscription-to-API proxy.
3. Anthropic terms and credential boundary: `https://code.claude.com/docs/en/legal-and-compliance.md` distinguishes hosting unmodified Claude Code, with each end user authenticating through its native flow under their own agreement, from third-party collection/intermediation of Claude.ai credentials or routing end-user requests through Free/Pro/Max credentials. Offering hosted Claude Code requires the stated Commercial Terms and hosting conditions. Pro/Max advertised limits assume ordinary individual usage; using an official binary is not an unlimited-use entitlement.
4. Claude programmatic operation: `https://code.claude.com/docs/en/headless.md` documents the official CLI's `-p` and structured output. `https://code.claude.com/docs/en/authentication.md` describes SSH/container callback cases and authentication precedence. Programmatic invocation does not by itself establish prohibited proxying; changing provider/credential settings can change which upstream receives the request.
5. CLIProxyAPI primary source, pinned at `4a2c81864f31f39308e946c4c65e72147855da6e`: `https://github.com/router-for-me/CLIProxyAPI/blob/4a2c81864f31f39308e946c4c65e72147855da6e/internal/runtime/executor/codex_executor_execute.go` constructs requests to the Codex backend and sends them through its own HTTP client; the sibling `claude_executor_execute.go` translates payloads and creates/sends HTTP requests. These inspected paths are not a subprocess invoking the official CLI to perform inference.
6. Assuming the user's "SubAPI" means Sub2API: `https://github.com/Wei-Shaw/sub2api/blob/a3eb7ef302961cba716dc78b39b93b60c467db0e/backend/internal/service/openai_gateway_forward.go` obtains account tokens and constructs upstream HTTP requests. Its README describes subscription-quota distribution and explicitly warns about provider terms and account-ban risk. This does not establish that every installation uses subscription credentials; API-key gateways must be assessed separately. No claim is made about a different product with a similar name.

### Local implementation evidence and limitations

- `services/vps-account-broker/runtime.py` launches the Codex binary with `app-server --listen stdio://`; `services/codex-bridge/connection.ts` connects the local official executor. The local RPC client identifies itself as Agent Workbench. This separates the control/tool channel from vendor-facing inference. Provided the selected provider and network path remain native, the official runtime owns inference request construction; this is not a claim of byte-identical traffic or official Desktop identity.
- The same VPS launch path explicitly rejects Claude execution with `CLAUDE_LOCAL_EXECUTOR_UNVERIFIED`. The Claude adapter's planned stream-JSON invocation is not proof of complete remote-runtime/local-tool acceptance. `docs/24-codex-live-runtime.md` contains historical, binding-specific Codex acceptance; later server cleanup/redeployment records and current source cannot establish today's deployed state without a new inspection.
- At review time, separate uncommitted `packages/model-api/native-launch.ts` and `native-gateway.ts` files implement a native CLI with a custom provider/loopback HTTP gateway. That route forwards inference through the configured upstream and must not inherit the direct native-subscription route's characterization merely because its agent loop is native. Its actual upstream credentials and authorization were not inspected. This observation does not certify or modify that in-progress work.

### Assessment and remaining uncertainty

The meaningful distinction is who constructs and authenticates vendor requests, who uses whose entitlement, and which actual upstream is selected. A control connection to an official runtime, an ordinary encrypted network tunnel, an API-key gateway, and a subscription-to-API converter are different mechanisms. A VPS address alone cannot classify them. Native remote operation removes the need to reimplement the subscription protocol, but does not make account sharing, resale, policy violations or restriction circumvention acceptable.

Engineering recommendation: retain native user-owned sign-in, honest client/environment identity, explicit tasks and native limits; do not add account rotation or outer automatic resubmission to evade a restriction. Use supported API/commercial authentication for product/API-service workloads as required by the relevant provider. These are design recommendations, not published anti-ban thresholds.

No inspected primary source provides a comparative ban rate, a safe VPS/IP/concurrency threshold, or an immunity guarantee for this workbench. Differences in HTTP/TLS implementation alone do not prove that they caused an enforcement event. A successful model call or prior network observation also cannot prove continuing account safety. Live provider selection, current deployment and Claude H acceptance remain separate, unperformed checks.

### Concurrent third-party and official VPS sessions (2026-09-27 UTC)

Public references rechecked directly over HTTPS: `https://developers.openai.com/codex/config-reference.md` documents per-provider `base_url`, `env_key` and `requires_openai_auth`; `https://code.claude.com/docs/en/authentication.md` documents credential/provider precedence. These explain why the effective process configuration matters; neither establishes how a vendor correlates account-risk signals.

Current source inspection: controller dispatch uses each session's `modelConnectionId`; `NativeProviderRunner` rejects a VPS `hostId` and non-`direct-api` binding. Each active third-party session creates its own gateway and child process. `nativeProviderLaunch` copies the parent environment, removes recognized inherited model credentials, and applies provider overrides to that child only. It does not rewrite native configuration files. The VPS broker separately constructs an allowlisted environment and account-specific native home. Coexistence in one desktop UI does not itself reroute an official VPS session through a third-party gateway.

Targeted existing tests passed **3/3** using synthetic credentials and a local gateway with a mock upstream: per-process provider configuration/unchanged parent environment, distinct native/API versus SSH bindings, and rejection of foreign gateway credentials/origins. No actual provider, VPS, real credential or model request was used. This is not simultaneous production-route acceptance, a full native-profile/telemetry isolation audit, or a vendor risk-classification guarantee.

Exceptions to the narrow conclusion: giving a gateway the same official account credentials exposes that account to the gateway's usage; global/shared configuration changes or an implementation defect can change the effective route. Account-level restrictions can affect otherwise separate sessions of that account. Shared project files, memory or explicit collaboration may affect model context without changing the network/authentication path. Review actual credential ownership and deployed routing separately; no claim is made that vendors cannot correlate other signals.


## U101 correction: providers inside native runtimes (2026-09-28 JST)

This entry supersedes the earlier independent generic API runner design for the production desktop. No cc-switch, DSH, Cursor or other implementation code was copied and no third-party dependency was added.

Public references checked for this revision:

- OpenAI Codex configuration reference: https://developers.openai.com/codex/config-reference/ — custom model providers, per-invocation overrides and known model context windows.
- OpenAI subagents: https://developers.openai.com/codex/subagents/ and https://developers.openai.com/codex/multi-agent — distinguishes Work's Ultra proactive delegation behavior from local Codex's explicit-request/AGENTS.md behavior. This is not a common Codex CLI/Claude Code effort gate.
- Claude Code gateway configuration: https://code.claude.com/docs/en/llm-gateway — custom gateway endpoint and credentials. Routing non-Claude models through Claude Code is a project compatibility implementation, not official universal-model support.
- Claude Code subagents: https://code.claude.com/docs/en/sub-agents — configured subagents can be delegated automatically; effort and user instructions are not a shared universal Ultra-only unlock.
- Claude Code settings: https://code.claude.com/docs/en/settings — native settings remain native; the workbench uses process-local provider settings.

Local primary evidence: the installed Codex 0.155.1 `app-server generate-json-schema` declares ReasoningEffort as a nonempty string (not a fixed old enum); the selected upstream effort is passed unchanged to turn/start and the upstream gateway. Claude Code 2.1.283 `--help` reports low/medium/high/xhigh/max and host permission prompts. Its native stdio permission callback was validated by denying then approving an edit to a synthetic file. Unsupported Claude effort names are preserved as exact upstream request settings; they are not silently mapped to a different native CLI enum or interpreted as delegation permission.

Repository design: each explicit task runs or resumes the chosen native CLI using a random, authenticated, session-scoped loopback provider endpoint. The host retains original provider secrets, validates enabled source/model on use, and does not rewrite native configs or add an outer agent loop. Native local tools, permissions and child policy remain native. Workbench cross-source child tools require direct user authorization. Responses namespaces/custom tool names are restored after Chat conversion. Same-protocol opaque state and compatible compaction/counting endpoints are forwarded; incompatible native operations fail explicitly. Cross-protocol streaming is currently buffered to a completed upstream response. Hosted Responses web search is disabled only for Chat/Messages providers because there is no equivalent wire operation; this is not a claim of universal feature parity.

Actual installed CLIs and hidden Electron were tested solely with temporary homes and synthetic loopback providers. No paid upstream call, live SSH inference, complete long-context compaction, arbitrary private protocol, real native config change or VPS deployment was performed. Earlier ApiRunner tests remain legacy compatibility evidence, not acceptance for the corrected native-provider execution path. Artifacts are ignored under `build/qa/native-provider/`.

### Native child presentation and translation placement (2026-09-27 UTC)

Primary documentation rechecked: https://developers.openai.com/codex/subagents/ (redirects to https://learn.chatgpt.com/docs/agent-configuration/subagents) describes opening agent threads from main-thread activity and distinguishing Active/Done views. https://code.claude.com/docs/en/sub-agents describes native task rows, opening a task transcript, foreground/background scheduling and independent child context. These are references for task identity, status and navigation, not a mandate to copy either interface or a universal Ultra gate.

Local primary evidence from installed Claude Code 2.1.283: a synthetic Agent request that omitted background mode still returned task_started with is_backgrounded=true and a tool_use_result with isAsync=true. Completion arrived later as task_notification with a public summary. The implementation follows those actual receipts, retains the process until observed children finish and exposes the received summary without claiming an unreceived full transcript. Foreground-requested and background-requested cases, real native tools, exact resume and native edit approval were validated using temporary homes and a synthetic loopback provider. No real user transcript/database or native credential was inspected; a bounded inspection of a test-created synthetic transcript was used only to distinguish public stream coverage from archive coverage.

Repository design: one right-side reader for files and children; translations move beneath their owning main-thread messages while occupied. An optional persistent inline style is available in the translation plugin. Child tasks and replies are translated only after a per-message user action, with exact-source and configuration checks. UI fixtures exercise full public messages/tool details when present; they are not evidence that every native transport emits every detail. No external implementation code was copied.


## U107: native interaction protocols and optional translation (2026-09-27 UTC)

Primary public references fetched directly over HTTPS for this audit:

- OpenAI Codex app-server: https://developers.openai.com/codex/app-server.md — bidirectional JSON-RPC, version-specific TypeScript/JSON schema generation, user-input requests, approvals, elicitation and native item/plan events. The live document redirects within OpenAI's documentation domain family. A protocol endpoint is not the official desktop UI.
- OpenAI Codex configuration schema: https://developers.openai.com/codex/config-schema.json — feature flags are runtime configuration; availability is not evidence that a feature is enabled in every launch.
- Anthropic user-input handling: https://code.claude.com/docs/en/agent-sdk/user-input — AskUserQuestion uses the native permission callback; the host must obtain answers and return updated input using original question identities. The public SDK semantics were cross-checked against actual CLI stdio behavior, not substituted for a new SDK login.
- Anthropic permissions: https://code.claude.com/docs/en/agent-sdk/permissions.md — native approval evaluation and control callback behavior; generic permission approval alone does not collect human answers.

Local primary evidence:

- Codex 0.155.1 generated ServerRequest, user-input, elicitation, permission, current-time, plan and ThreadItem schemas in the ignored build/schema-codex-0.155.1 directory. Schema methods include current/legacy approvals, questions, elicitation, permissions, dynamic tools, external-token refresh, attestation and current time; these have distinct response shapes.
- In an isolated native home, Codex 0.155.1 lists default_mode_request_user_input as under development and false. A real synthetic Default-mode request advertised the question tool but returned an unavailable-mode response until the flag was enabled. The workbench now enables that feature only in its owned process launch. The deferred-executor version gate remains 0.155.1.
- Actual Codex 0.155.1 and Claude Code 2.1.283 ran question/decline loops against synthetic localhost providers. Installed native Codex 0.157.1 passed a separate two-case probe; the desktop-bundled path is 0.155.1 and was not mislabeled as 0.157.1. No claim is made about the globally newest release.
- Hidden Electron used actual CLIs and synthetic translation/model endpoints. It verified question/option overlays, multi-select plus custom answers, same-request reply, original Chinese when translation is disabled, preview/edit behavior, the shared auto-submit preference, and cancellation when disabling translation in flight. No real user client or authenticated transcript was inspected.

Project design: normalization and display preserve native question/option identities. Free-text Chinese answers use the existing independently configured translation module and its policy, consent, budget and cancellation gates. Segment batching protects each field's paths/code and rejects missing or moved tokens; it does not prove semantic translation accuracy. The module-off path makes no question/answer translation requests. Replies are bound to session plus a new host receipt and are consumed once; unknown native writes are never retried as a new task.

Remaining gaps are explicit in docs/native-interactions-20260927.md: advanced elicitation schemas/verification, new filesystem entry/glob grants, structured approval amendments, full terminal slash-command UI, external token/attestation callbacks, and unverified remote/child lifecycle cases. Native engine improvements can flow through compatible protocols; new client-facing methods and experiments still require probing and integration. This is a project compatibility conclusion, not a vendor promise of automatic UI updates or production support for every transport. No third-party implementation code or new dependency was copied. No VPS deployment or Claude H acceptance is implied.

## Native reading and background lifecycle (2026-09-27 UTC)

Fetched primary references: https://developers.openai.com/codex/app-server, https://platform.claude.com/docs/en/agent-sdk/typescript, and https://code.claude.com/docs/en/sub-agents. The Codex 0.155.1 locally generated ThreadItem and notification schemas were checked alongside these pages. The 19 item variants, compaction lifecycle, native retry metadata, hooks, tool progress, model reroutes and Claude task/result messages are mapped in `runtime-reading-20260927.md`.

Observed fact: isolated Codex 0.155.1 and Claude Code 2.1.283 accepted a second explicit parent task on the same owned process/native thread while a synthetic upstream held a background child response. Releasing the child produced its native completion; explicit stop preserved uncertain history. This is local CLI protocol evidence, not a paid provider or SSH execution claim. Claude's official foreground/background distinction remains intact. Collapsing completed process groups and rendering clickable lifecycle pills are workbench presentation choices; neither vendor's proprietary desktop rendering algorithm is claimed to be reproduced exactly.


## Workbench chat discovery and source attribution (2026-09-28 JST)

Primary sources: https://developers.openai.com/codex/app-server (client thread list/read APIs), https://platform.claude.com/docs/en/agent-sdk/sessions (session enumeration/read utilities), and https://code.claude.com/docs/en/cross-session-messaging (native ListAgents/SendMessage). These native facilities are distinct from a model-visible, cross-runtime workbench directory. No private client database or unverified inbox protocol was read or copied.

Project implementation: bound dynamic tools / MCP expose same-owner catalog and public-history projections, preserving user-authored titles as reference data. Peer provenance is stamped by the host, retained after rename/removal, and displayed separately from user inputs. Installed Codex 0.155.1 and Claude Code 2.1.283 exercised these tools through disposable native homes and synthetic loopback responses; this is not paid-upstream or SSH deployment evidence. API, boundaries and tests: `chat-tools-20260928.md`.


## 输入菜单与原生技能加载核对（2026-09-28 JST）

- [OpenAI Skills](https://developers.openai.com/codex/skills/)：官方说明以名称/描述发现技能、使用时才加载正文，并提供显式技能调用。公开文档不等于自建宿主已经实现相应输入界面。
- [OpenAI desktop commands](https://developers.openai.com/codex/app/commands/)：桌面命令及入口有宿主与功能可用性条件；不能将桌面专属入口推断为 CLI 自动提供的 UI。
- [Claude Code skills](https://code.claude.com/docs/en/skills)：支持 /skill-name，正文按需加载，user-invocable: false 不进入用户菜单。
- [Claude Code desktop](https://code.claude.com/docs/en/desktop)：官方桌面加号包含文件、技能、连接器与插件。工作台当前菜单只挂接已实现的操作；连接设置不等于完整连接器产品、插件管理不等于运行任意插件命令。

以上为本轮抓取官方页面核对的公开事实。实现采用原生调用标识和 Codex skill 输入对象；真实运行时、临时 Home、合成 loopback 模型的协议证据单独记录，不据此宣称真实模型语义或所有原生桌面功能均验收。

### 2026-09-28 JST · 工作树行为参考

- 官方来源：[Codex / ChatGPT desktop Worktrees](https://developers.openai.com/codex/app/worktrees)，本日读取公开页面。公开说明包含 Git 独立 checkout、detached HEAD、当前修改复制、可配置根目录，以及由桌面应用负责的工作树管理。
- 本项目实现选择：聊天分叉可选原目录或本机新工作树；保留来源及序号；默认不 fetch、不运行仓库 hooks、不自动删除工作树。原生 CLI 升级本身不会生成工作台这些 UI、Git 管理与插件接口。
- 未交付范围：官方产品的自动清理/可恢复快照和 Local/Worktree 交接不等于本项目已实现；验证分层见实现记录。

## 个人技能原生目录接入（2026-09-28 JST）

- 公开事实：[OpenAI Skills](https://developers.openai.com/codex/skills/) 本日读取页面，确认用户级 .agents/skills 与符号链接扫描支持；名称/描述用于发现，正文按调用加载。
- 公开事实：[Claude Code Skills](https://code.claude.com/docs/en/skills) 本日读取页面，确认个人 .claude/skills、项目范围及 /skill-name 原生调用。本文不将 Claude 专属工具、动态展开或插件包装宣称为跨运行时通用格式。
- 实现选择：工作台对个人独立技能解析最终真实目录，两家各自直接连接同一源；Windows 使用无需提权的目录 junction，其他平台使用目录符号链接。不复制技能、不改 CC Switch 数据库、不加模型上下文目录；外部管理器是否显示其开关不作承诺。只撤销工作台创建且文件系统身份仍吻合的链接。
- 图形资源：OpenAI/Claude SVG 来自 [Simple Icons 13.21.0](https://github.com/simple-icons/simple-icons/tree/13.21.0/icons)，引入前核实 CC0 1.0，原始图形、许可与来源记录位于 renderer/assets/runtime-brands。许可不授予商标权，不意味着项目获得厂商背书；没有复制 CC Switch 应用代码。
- 证据分层：临时原生 Home、实际安装 CLI 和合成 loopback 响应验证两向链接后的技能正文加载。Windows 文件系统/本机原生协议证据不替代付费模型效果、任意技能内容兼容性、其他操作系统或未来版本验收。


## 子 Agent 模型与跨会话宿主能力（2026-09-28 JST）

- 官方公开事实：[OpenAI subagents](https://developers.openai.com/codex/subagents) 本日抓取页面：未配置子模型和 effort 时继承父 Agent；显式模型/effort、agents 默认及 Agent 配置文件会影响解析顺序。因此不能将“Codex 子 Agent 永远相同模型”写成规则。
- 官方公开事实：[Claude Code subagents](https://code.claude.com/docs/en/sub-agents) 本日抓取页面：调用级 model、Agent 定义、环境默认及父会话参与选择；模型可按任务选择，也可继承，effort 默认继承会话但定义可覆盖。当前文档已说明 Explore 在 v2.1.198 起改为继承规则，不能沿用“Explore 永远 Haiku”的旧描述。
- 官方公开事实：[Claude Code cross-session messaging](https://code.claude.com/docs/en/cross-session-messaging) 公开 ListAgents/SendMessage；[OpenAI app-server](https://developers.openai.com/codex/app-server) 提供线程生命周期接口。这些原生能力不自动注册本工作台项目目录和独立聊天创建工具；本次通过已有宿主工具通道接入，不扫描外部客户端私有聊天数据。
- 官方公开事实：[Claude Code fast mode](https://code.claude.com/docs/en/fast-mode) 将 Fast 与 effort 分为两个维度。工作台实现选择是逐字段记录公开协议配置、请求或 API 映射；未知时不按相同模型推定 Fast。
- 本机程序生成的公开 app-server JSON schema 将 Thread.model/reasoningEffort 标为配置或最近持久化值，明确不是每回合执行遥测；协作项的同名参数是请求值。生成物仅用于忽略目录中的核对，没有复制第三方实现代码。

实现与验收边界见文档 16 和文档 36。模拟子参数、真实 CLI 对合成服务的调用、商业模型是否采用参数、桌面视觉及远端部署分别记录；模型的自我描述不是身份凭证。


## 回合末端操作与运行中历史分支（2026-09-28 JST）

- 官方公开事实：[OpenAI app worktrees](https://developers.openai.com/codex/app/worktrees/) 本日重新抓取全文。工作树依赖 Git 仓库，可从所选分支建立独立检出，默认 detached HEAD；选择带本地修改的起点时可带入未提交修改。这是宿主与 Git 的工作目录管理，不是模型自行获得新权限。
- 本项目实现：本机 Git 工作树服务已经存在。本次修复工作台按整场会话运行状态禁止历史回复分支的限制；新工作树复制创建时的当前文件状态，聊天历史截止选定的已完成回复。它不是所选消息当时的历史文件快照，不替源目录初始化 Git 或创建首个提交。
- 证据边界：上述官方页面没有证明任意提供方、版本或连接可在活动回合中分支。本项目通过已记录的 Codex 回合或 Claude 消息回执保留原生边界；源码、合成协议、真实临时 Git 仓库及隐藏桌面验收分别记录，不声称真实付费模型或远端任务已验收。
- 视觉实现：停止按钮采用项目现有纸色、墨色与居中方块的圆形设计；没有复制 Claude 客户端代码、资源或品牌图形，也不宣称是其精确复刻。
- 记忆来源：Codex 正文的显式引用与 Claude 成功的结构化原生记忆读取是不同证据。模型说“查了记忆”、工具命令包含记忆路径或最终答案正确，均不能证明返回了引用标签；缺少原始回复时不能仅凭截图断言哪一层遗漏。


## Cross-protocol incremental transport review (2026-09-28 JST)

- Official protocol sources fetched for this review: [OpenAI Responses streaming events](https://developers.openai.com/api/reference/resources/responses/streaming-events) and [Anthropic Messages streaming](https://docs.anthropic.com/en/api/messages-streaming). The public contracts distinguish item/block start, text or tool-argument deltas, item/block completion, and response/message completion. A partial tool argument is not a successful completed tool call.
- Project implementation choices: forward public text and representable tool arguments incrementally; keep private reasoning, signatures and opaque protocol-specific items out of cross-protocol public text. Preserve same-protocol bytes. Validate complete calls before releasing completion events; do not invent a successful receipt after truncation, invalid JSON or cancellation.
- Performance evidence is local and synthetic: sequential paired replay against the previous implementation, installed native CLIs with isolated homes and a side-effect-free fixture tool, and bounded slow-reader/cancellation tests. These do not establish paid-model inference throughput, remote network performance, or universal cross-provider feature compatibility. No third-party implementation code was copied or vendored.

## 本机字体与外观参考（2026-09-30 JST；U116）

- 官方 API 资料：[Microsoft InstalledFontCollection](https://learn.microsoft.com/en-us/dotnet/api/system.drawing.text.installedfontcollection?view=windowsdesktop-9.0)，本日重新读取。工作台在 Windows 使用该系统能力获取字体家族目录，只返回名称，不打包或下载第三方字体文件。
- 本项目源码事实：此前全局界面默认使用 Segoe UI 系列与微软雅黑回退，多个阅读和设置区域使用 Georgia/中日韩衬线回退，用量总计还单独指定 Georgia。不能将这种混合排版称为一套已经核实的 Claude Code 同款字体。
- 用户后续明确选择 Claude 桌面阅读字体。只读核对本机已安装 Claude Desktop 2.7032.0 静态资源：默认回复样式指向 `anthropic-serif`，WOFF2 name table 为 `Anthropic Serif Variable Text`，版权标记为 2025–2026 Anthropic PBC；中文简体回退含 `Microsoft YaHei` 与 `Noto Sans CJK SC`。这不是文档网站字体，也不是终端 Claude Code 的字体。未发现再分发许可，本项目只作可选本机资源引用，不复制或捆绑字体。该证据来自已安装资源，不冒称公开网页已复现。
- 用户提供的其他产品外观截图仅用于参考模式、字体选择和分组布局；截图显示某字体可选，不足以证明它由该产品内置分发。此次可搜索目录来自本机系统，字体许可与字符覆盖仍由实际字体决定。
- Windows 实际字体家族枚举与隐藏 Electron 字体切换已验证；其他平台当前返回 unavailable 并保留默认组合，不冒称跨平台枚举已完成。未读取或修改其他客户端配置。

<!-- image-viewer-glass:start -->
## 图片与附件本机交互核验（2026-09-30 JST）

- **已安装依赖事实**：仓库锁定的 Electron 44.4.5 类型声明 `node_modules/electron/electron.d.ts` 的 `ClipboardItem`、`Clipboard.write` 与 `NativeImage` 契约，支持将解码图片重新编码为 PNG Blob 后异步写入剪贴板。实现等待写入完成，不使用不存在的 `clipboard.writeImage`。此处依据本次安装版本，未外推为所有 Electron 版本均兼容。
- **本地行为证据**：`scripts/test-media-integration.mjs` 在隔离隐藏应用中经过真实 IPC、原图读取和原生编码，比较原尺寸像素；剪贴板写入、默认应用打开与文件定位替换成观测适配器，不操作用户剪贴板、不启动外部程序。第三方应用粘贴及真实默认应用打开仍未实测。
- **设计实现**：毛玻璃层级、独立图片控件和右键菜单按项目主题实现，参考用户给出的交互方向，没有复制第三方界面源码或引入新库。默认 42% 底色不透明度与 20 px 模糊属于本产品视觉选择，不作为平台事实。
- **协议与范围**：既有 Codex 0.155.1 官方 ThreadItem 协议研究中的 `imageView.path` 与 `imageGeneration` 分流保持；Claude 看图仅从 `Read` 的显式 image 结果块识别。新测试在合成原生帧上验证，不宣称新一次真实 CLI 模型任务或远端图片传输已通过。看图折叠与缩略图样式属于本机 renderer 呈现，不是 CLI 控制窗口布局。
<!-- image-viewer-glass:end -->

<!-- session-feedback-following-20260930:start -->
## 回合结束信号与显示折叠（2026-09-30 JST）

- 官方公开事实：[OpenAI Codex App Server](https://developers.openai.com/codex/app-server) 本日读取说明 turn/completed 携带回合最终状态；agentMessage.phase 可为 commentary 或 final_answer。item/completed 只结束单个项目，不能独自证明整个回合已结束。
- 官方公开事实：[Claude Agent SDK streaming output](https://platform.claude.com/docs/en/agent-sdk/streaming-output) 本日读取区分 StreamEvent、AssistantMessage 和最终 ResultMessage；消息块结束后可能继续执行工具或后续模型步骤。该资料用于核对事件语义，没有改用 SDK 替换本项目的原生 CLI 执行器。
- 本项目源码事实：原生适配器把两家结束回执转为会话状态、消息阶段与回合计时。计时固定、过程折叠、文件卡片位置以及错误历史由本机 renderer/状态层实现，不是 CLI 自动操作工作台 DOM，也不等同于模型上下文压缩。Codex 桌面截图是用户提供的交互参考，不能推断其私有实现。
- 本地合成行为证据：scripts/test-session-feedback-ui.mjs 与相关单元测试核验两家展示路径、部分用量、失败历史和新回合时钟。没有本次真实付费模型或远端出网验证。
<!-- session-feedback-following-20260930:end -->


<!-- structured-memory-citations:start -->
## Codex 结构化记忆引用核验（2026-09-29 UTC）

- 本机协议事实：已安装 codex-cli 0.155.1 生成的 app-server schema 中，agentMessage 除 text 外有可空 memoryCitation；其 entries 包含 path、note、lineStart、lineEnd，threadIds 是独立数组。核对 ItemCompletedNotification 与历史 ThreadItem 定义，没有复制第三方实现代码。
- 运行行为证据：scripts/test-memory-citations-ui.mjs 让该 CLI 使用隔离原生目录连接本机合成响应服务。上游返回显式引用标签；工作台收到的最终正文已没有标签，而 memoryCitation 的条目经接收器进入 Message.memoryReferences，真实隐藏 Electron 显示底部图标、标题与路径。三个合成请求不执行模型工具、不访问付费模型或真实记忆。
- 来源边界：本次官方网页检索没有取得可用正文，以上结论来自安装版协议生成物和实际本机实验，不声称重新核对了线上最新协议。用户截图没有附原始事件；该实验确认可复现漏接路径，不证明已逐条审计截图对应的真实历史。已被旧版本丢弃且原文没有标签的引用不能凭答案内容补造。
<!-- structured-memory-citations:end -->

<!-- account-export-sources:start -->
## 单账号 JSON 导出格式（2026-09-29 UTC）

本轮只核对公开协议／字段，独立编写序列化实现；未引入或复制第三方实现代码。工作台导出是用户明确触发的本机单账号操作，不发起远端请求，不证明导出的登录当前有效。

- [OpenAI Codex Authentication](https://developers.openai.com/codex/auth/)：原生认证可使用 auth.json 或操作系统凭据存储。本功能仅支持指定工作台账号的原生文件，缺失时不回退读取默认目录／钥匙串。
- [OpenAI AuthDotJson 声明](https://github.com/openai/codex/blob/main/codex-rs/login/src/auth/storage.rs)：核对 auth_mode、OPENAI_API_KEY、tokens、last_refresh、agent_identity 等原生字段；官方格式保留原对象，不把其他格式标成官方登录证明。
- [sub2api 数据导入／导出声明](https://github.com/Wei-Shaw/sub2api/blob/a60a29549f488a854966aaec9541abbe006cac22/backend/internal/handler/admin/account_data.go) 与 [Codex 凭据映射](https://github.com/Wei-Shaw/sub2api/blob/a60a29549f488a854966aaec9541abbe006cac22/backend/internal/handler/admin/account_codex_import.go)：核对 sub2api-data、version:1、accounts／credentials、平台名及 Agent Identity 字段。许可证为 LGPL-3.0；仅参考协议结构，未复用实现。
- [CLIProxyAPI CodexTokenStorage](https://github.com/router-for-me/CLIProxyAPI/blob/a270e7b9e57aaecd8f82555f44c2108518ad2330/internal/auth/codex/token.go) 与 [ClaudeTokenStorage](https://github.com/router-for-me/CLIProxyAPI/blob/a270e7b9e57aaecd8f82555f44c2108518ad2330/internal/auth/claude/token.go)：核对单对象 type、access_token、refresh_token、id_token、expired、last_refresh 等字段。许可证为 MIT；仅参考协议结构，未复用实现。

Claude 官方文件仅按本机独立目录中的既有 .credentials.json 原结构保留；转换使用 claudeAiOauth 的已有字段，不宣称支持所有系统钥匙串、Console 身份、网页登录资料或未来未验证格式。API key／Agent Identity 不兼容 cpa OAuth 时明确拒绝。合成格式与桌面测试不能替代真实 sub2api／cpa 服务导入或登录验收；本次未接触真实令牌、消费者服务或远端环境。
<!-- account-export-sources:end -->

<!-- codex-account-access-sources:start -->
## Codex 接入与账号身份展示依据（2026-09-29 UTC）

- [OpenAI Codex Authentication](https://developers.openai.com/codex/auth/)：浏览器 OAuth、设备码及原生凭据存储的公开依据；实际安装版 Codex 0.155.1 的 app-server schema 另行核对 account/login/start、cancel、account/read 和 model/list。未将界面启动当作授权完成。
- [Cockpit Tools](https://github.com/jlcodes99/cockpit-tools)：按用户指定核对官方客户端/OAuth/设备码交互及导入格式。公开 README 声明 CC BY-NC-SA 4.0；本轮仅参考行为和协议字段，独立编写实现，未复制其代码或资源。重点阅读 src-tauri/src/modules/codex_temp_login.rs、process_codex_windows_launch.rs、codex_account_import.rs、src/utils/codexExportFormats.ts 与 crates/cockpit-core/src/modules/codex_oauth.rs。
- [OpenAI 原生认证结构](https://github.com/openai/codex/blob/main/codex-rs/login/src/auth/storage.rs)、[access-token 适配](https://github.com/openai/codex/blob/main/codex-rs/login/src/auth/access_token.rs)、[Agent Identity](https://github.com/openai/codex/blob/main/codex-rs/login/src/auth/agent_identity.rs) 与 [PAT](https://github.com/openai/codex/blob/main/codex-rs/login/src/auth/personal_access_token.rs)：原始令牌字节保留，不构造伪 JWT；原生回读是可用性边界。仅导入用户主动提交的内容，不读取已有默认客户端凭据。
- [原生 OAuth callback server](https://github.com/openai/codex/blob/main/codex-rs/login/src/server.rs)：公开源码在默认端口占用时可能发取消请求。工作台在启动前进行占用检查并串行化自己的 OAuth/desktop 登录；拒绝已占用端口，不主动取消其他客户端。

隔离验证使用全新原生目录和独立浏览器 profile：真实官方 OAuth 页打开，真实设备码签发，Windows 官方桌面端独立启动并按所属进程取消；设备页出现站点验证。未完成真实账号授权，未发真实模型任务，未测试真实 Sub2API/CPA 服务。格式/轮换/回调、认证后建卡、名称和邮箱分离及插件生命周期另以合成凭据、真实 loopback 和隐藏 Electron 验证。SSH 登录仍使用原有流程，本轮无远端部署。
<!-- codex-account-access-sources:end -->


<!-- file-review-capsule-20260930:start -->
## Claude Desktop 文件差异交互参考（2026-09-30 JST）

- 官方文档：https://code.claude.com/docs/en/desktop#review-changes-with-diff-view 。说明点击增删统计打开差异视图，左列文件、右侧查看修改；Review code 是另外向 Claude 请求代码审查的功能，不能等同于静态查看差异。
- 本机安装版本 Claude Desktop 2.7032.0.0 的静态资源只读核对：存在差异显示方式、word wrap、并排最小宽度和文件增删统计相关结构。该证据来自安装包静态资源，不是活动窗口的视觉验收，也不证明所有运行时/连接方式行为相同；不读取聊天库、账号或配置，不操作在用客户端。
- 本项目独立实现文件列表、合并/并排差异、行号及运行中统计入口，仅参考交互；未复制第三方源代码、字体或资源。当前数据来源是已确认原生工具补丁的回合记录，不宣称等价于 Claude 的 Git 净差异、自动代码审查、编辑或撤销。
<!-- file-review-capsule-20260930:end -->


<!-- native-event-audit:start -->
## Native event protocol inventory (2026-09-29 UTC)

- OpenAI official app-server documentation: https://developers.openai.com/codex/app-server (currently redirects to https://learn.chatgpt.com/codex/app-server). Public facts: JSONL RPC notifications and requests, single initialization handshake, item lifecycle and native turn completion. Local Codex 0.155.1 generated experimental JSON schemas supply the 82 notification / 11 request / 19 item discriminator baseline; newer documentation is not silently substituted for it.
- Anthropic official TypeScript reference: https://code.claude.com/docs/en/agent-sdk/typescript and streaming guide: https://code.claude.com/docs/en/agent-sdk/streaming-output. The old platform.claude.com TypeScript URL redirected to the SDK overview during this audit, so the actual topic page was fetched instead. Public facts include system/status, compact_boundary, task_updated, background_tasks_changed, permission_denied, conversation_reset and SDK-only/opt-in boundaries.
- Publisher declaration package @anthropic-ai/claude-agent-sdk 0.3.285 was inspected separately from installed Claude Code 2.1.284 to enumerate public SDKMessage variants. The package license states Anthropic PBC all rights reserved and refers to its legal agreements. No vendor implementation or declaration code was copied into project source; the committed fixture records discriminator facts only. SDK declaration presence does not establish installed CLI emission or the workbench launcher opting into a capability.
- Project design: bounded metadata-only compatibility receipts, explicit unsupported control replies, typed host presentation extensions and no automatic semantic execution of unknown events. These are workbench choices, not claims of automatic future vendor compatibility. See [event audit](native-event-audit-20260929.md).

- 2026-09-30 补充只读核验：实际安装 Claude Code 2.1.284 的原生输出 schema 包含 SDKMessage 之外的 command_lifecycle 和九个 system subtype；本次独立清单合计 12 类会话 envelope、37 类 system subtype。SDK 0.3.285 同一声明明确 status 为 compacting/requesting/null，background_tasks_changed 为完整替换、ambient 不计活动。前一轮仅按导出 SDKMessage 计数不足，已纠正；没有复制厂商实现代码或把内部 schema 当成公开稳定承诺。
- 原生 command_lifecycle.completed 不是任务 result；空后台快照可能早于 task_notification，session_state_changed.idle 表示原生排空。TaskStop 的类型化 task_id/task_type 结果可核对目标；仅凭工具无 is_error 或文本不能结束任务。code_change_published/vcs_state_changed 是未核验提示，不授权工作台执行认证访问；cloud worker / realtime 未被当前启动器启用。独立隔离合成上游验证与真实模型/用户桌面验证分开记账。
<!-- native-event-audit:end -->

<!-- session-native-preview:start -->
## 会话原生标题协议核对（2026-09-29 UTC）

- Codex App Server 官方入口：<https://developers.openai.com/codex/app-server>。本轮直接用本机已安装的 Codex CLI 0.155.1 在隔离配置目录生成 TypeScript 协议，命令为 `codex app-server generate-ts --out <isolated-output>`；不读取用户登录或聊天库、不发送模型请求。
- 该安装版本的生成协议中，`Thread` 有 `name: string | null`，`thread/name/updated` 对应 `{threadId:string,threadName?:string}`。工作台只消费这些实际原生值；`preview` 不是自动总结标题的证据。协议支持通知不证明每个运行时/会话都会主动发出，也不证明标题固定使用英文。
- Claude 当前接入为 print/stream-json；公开 CLI 参考入口为 <https://code.claude.com/docs/en/cli-reference>。本轮未核实到当前接入可消费的自动标题事件，因此不增加猜测字段、私有历史读取或额外命名请求，保留首条消息截取。用户观察到的 Claude Desktop 命名行为不作为所有 Claude CLI 会话的能力证明。
- 设计约束来自用户本轮澄清：仅在原生提供时采用；标题按实际语言显示，正文悬停优先已有译文并设上限。合成协议、已批准插件与隐藏桌面验证见 `docs/16-implementation-status.md`，不替代真实模型自动命名验证。
<!-- session-native-preview:end -->

<!-- session-hover-repair:start -->
## 会话命名能力补充核对（2026-09-30）

- OpenAI 官方 App Server 文档实际重定向至 <https://learn.chatgpt.com/docs/app-server>。公开说明 `thread/name/set` 设置名称并发出 `thread/name/updated`，配合已核验的本机 0.155.1 生成协议，证明原生名称与通知存在；没有据此证明每次调用都会自动命名。
- Anthropic CLI 参考 <https://code.claude.com/docs/en/cli-reference.md> 说明 `--name` 与 `/rename`；TypeScript 参考 <https://code.claude.com/docs/en/agent-sdk/typescript.md> 的 `SDKSessionInfo` 说明 `summary`、`customTitle`、`firstPrompt`，并提供精确会话 ID 的 `getSessionInfo`。这些是原生命名/元数据能力的证据，不能表述为 Claude 没有标题能力。
- 该 TypeScript 参考的 `session_title` 出现在 `UserPromptSubmitHookInput` 和 `SessionStartHookInput`，不能把 hook 输入猜作当前 CLI stdout 标题通知。`summary` 的显示来源可含用户命名、提示或自动摘要，不证明每次都是模型总结，也不保证英文。当前工作台 print/stream-json 是否主动返回自动标题仍须按接入方式核实。
- 本轮资料核对及隔离 CLI `--help` 不调用模型、不读取真实用户会话；悬停修复本身不改变模型执行/认证，标题仍按实际文本显示。
<!-- session-hover-repair:end -->

<!-- claude-native-title:start -->
## Claude 原生标题元数据读取依据（2026-09-30）

- 公开能力：Anthropic CLI 参考 <https://code.claude.com/docs/en/cli-reference.md> 提供 `--name`、`/rename`；TypeScript SDK 参考 <https://code.claude.com/docs/en/agent-sdk/typescript.md> 提供精确会话 `getSessionInfo(sessionId,{dir})` 和 `SDKSessionInfo`。其中 summary 可来自自定义标题、自动摘要或用户提示；不能把所有 summary 都称为模型生成标题，亦不能据此保证英文。
- 本机格式核对：仅在忽略 QA 目录检查官方 npm 包 `@anthropic-ai/claude-agent-sdk` 0.3.285（来源 <https://registry.npmjs.org/@anthropic-ai/claude-agent-sdk>；包 integrity 为 `sha512-e98yZH3cWjQ2nSXGxOcx5BrEqG9Y0+CoSoVIN1BaypxT7yGVShdhhH8ROYcJZWqjgiTFyTaN56JQSPJAjarOSg==`）。确认原生会话 metadata 的明确 `customTitle` / `aiTitle` 字段、UUID 子目录的 `custom-title.json` 及项目目录键约定。格式事实不等同于永续稳定的公共 API；未知/较长哈希路径采用保守回退。
- 独立合成验证：临时 `CLAUDE_CONFIG_DIR`、项目目录与固定虚构 UUID 下只写合成 metadata，再调用上述官方包的 `getSessionInfo`；`aiTitle: "Synthetic native AI title"` 被官方 helper 读为 summary/customTitle。同一合成格式被工作台独立 reader 接收。该证明仅覆盖已有标题解释，不代表真实 print/stream-json 自动产出、任何账号可用性或标题生成频率。
- 许可证先审：该包 LICENSE 声明 Anthropic 保留所有权利并受其法律协议约束。产品没有复制 SDK 实现、加入依赖或嵌入 vendor 代码；依据格式事实独立实现有限本机只读适配。下载包只留在忽略的研究目录，不发布。本项目许可证状态未被改变。
- 实现选择：精确读取已绑定原生 UUID 的少量首尾记录及 sidecar，只返回明确标题；不接受 message/firstPrompt/压缩 summary/hook 输入作为替代，不枚举用户历史，不写原生存储、不触发额外模型 turn。读取的字节可能包含消息，提取结果仅为标题和身份元数据。SSH 和未知存储布局继续现有 fallback。
- 仍未证明：当前 CLI print/stream-json 是否在每次任务后自动生成标题；hook `session_title` 不是 stdout 标题事件的证据。工作台只在原生已有明确标题时同步，且保留原语言和手动改名。合成原生传输、批准插件与隐藏桌面证据见文档 16、36；未读取真实会话、令牌或活动客户端数据。
<!-- claude-native-title:end -->

<!-- remote-login-osc8-source-20260930:start -->
## Claude 登录终端超链接观察（2026-09-30）

- 本机只读核验 Claude Code 2.1.284 的版本和已安装二进制静态文本：`auth login` 的地址输出调用终端超链接格式化，TTY 路径可使用 OSC 8 与 BEL 终止；`NO_COLOR` 不等同于取消该超链接包装。这是特定安装版本的实现观察，不是公开、永久不变的输出协议承诺，也不证明截图远端安装的精确版本。
- 工作台旧解析器仅移除 CSI 颜色序列，URL 匹配会吞入 BEL 及随后显示地址；真实远端地址校验器拒绝控制字符。另有 PTY 分段读取被误当作 URL 完成的问题。采用独立编写的合成输出复现，不复制或发布官方实现代码、不新增第三方依赖。
- 模拟 CLI 只生成虚构授权地址，浏览器替身调用产品的地址校验器后只访问临时 loopback callback；不请求官方登录页，不读取真实账号、Cookie、令牌或会话数据。BEL/ST、纯文本、分段、去重和清理结果见 `scripts/test-remote-browser-login.py` 与文档 16。
<!-- remote-login-osc8-source-20260930:end -->

<!-- follow-up-handling-20260930:start -->
## 运行中输入与排队的原生依据（2026-09-30）

- Claude 官方 [Interactive mode](https://code.claude.com/docs/en/interactive-mode) 与 [Streaming input](https://platform.claude.com/docs/en/agent-sdk/streaming-vs-single-mode) 本轮通过 HTTPS 读取。交互终端的 Enter 输入可在工具调用完成时进入当前回合，也可能等待正在生成的回复结束。终端 Ctrl+Enter/send-now 是另一种语义，文档标明 2.1.275+，2.1.281+ 可将符合条件的任务后台化，否则中断。不能由终端快捷键直接推断 print/stream-json 的行为，也不把该终端中断快捷键映射为本工作台的 Ctrl+Enter；本工作台按用户要求对排队/引导取反。
- 独立本机验证：使用已安装 Claude Code 2.1.284、隔离原生目录和 loopback 合成推理，向正在处理的 stream-json 会话写入带 UUID 的第二/第三条 user 输入。原生 user echo 逐条确认接收，消息进入后续模型请求，无需停止进程。输入在一个受控 MCP 工具仍等待时送达，工具结束后的首个推理请求包含该输入，只有一个 result，证明这一接入可在同一原生回合中途接收。
- 边界：首次工具实验在写 stdin 后立刻释放工具，出现两个 result；保留该观察，说明写入完成不保证赶上原生接收节点。为验证“工具期间已送达”的情形，受控工具继续等待 500ms 后释放，得到上述同回合证据。正在等待回复时的两条输入也分别得到原生接收并完成；工作台须等所有已提交输入的回执，不可在前一 result 就终止所属进程。该等待不注入产品运行逻辑，不是可承诺的接收时延。
- Codex 本轮使用隔离 Codex 0.155.1、app-server turn/steer 和 expectedTurnId 核对连续两条运行中输入、成功回执与过期拒绝。重新读取官方 app-server 地址时 HTTP 403，未把本次请求写成成功资料抓取；既有官方协议依据保留，新增结论以指定安装版本的真实 CLI 加合成推理为准。
- 测试位置：`scripts/test-follow-ups-native.mjs`、`tests/native-follow-ups.test.ts`。无官方账号调用、付费模型、真实聊天库读取、活动客户端操作或远端部署。没有复制第三方实现或新增 SDK 依赖。实现建议为统一 queue/steer 意图、保留适配器能力与接收时机差异，未知/失败不自动续投。
<!-- follow-up-handling-20260930:end -->


<!-- native-completion-observation-20260930:start -->
## 本机原生完成边界观察（2026-09-30）

来源为实际安装的原生 CLI、隔离 profile 与合成上游；脚本为 scripts/test-native-termination.mjs、scripts/test-native-stream-tools.mjs。两家 CLI 均消费普通结束回执；显式完成封套是工作台的适配设计，不是官方新增工具。Codex 的有限重连可能再次请求无效响应，Claude 对不同错误/流也有自身处理；工作台不增加外层继续循环。具体请求数与工具执行证据、真实模型语义质量分别记录。

未获得证明所有官方或第三方模型长任务可靠性的外部证据，未做官方账号推理对照。本机协议验收不作为官方兼容承诺、远端出网证明或付费模型完成率结论。
<!-- native-completion-observation-20260930:end -->
<!-- inline-visualizations-source-20260930:start -->
## 回复内交互展示的参考边界（2026-09-30）

用户提供的原生客户端截图展示了回复内可切换的设计方案。当前本机已安装的 Visualize 1.0.41 技能说明可只读观察到 `visualize` HTML 路径引用、可选 wide 模式及 `window.openai.widgetState/setWidgetState` 约定；这属于安装版本的兼容参考，不是所有客户端、账户或 CLI 都支持的永久公共 API 保证。未读取原生私有聊天库，未复制该技能的脚本、样式实现或 vendor 代码。公开检索未建立完整内部协议，不能据此宣称与 Codex 展示栈完全相同。

本次独立编写解析、opaque-origin 页面封装和状态桥，使用仓库现有 React/Marked/Electron，不增加第三方依赖，不改变项目许可证。网络/CDN、自动 follow-up、宿主文件/系统 API 和任意模型上下文状态投递均未复刻；具体实现、默认值和证据层级见交互展示记录及文档 36。
<!-- inline-visualizations-source-20260930:end -->


### Translation native invocation verification (2026-09-30)

- OpenAI App Server: https://developers.openai.com/codex/app-server ; configuration schema: https://developers.openai.com/codex/config-schema.json . Public documentation describes thread/turn admission, ephemeral threads and configuration. Installed Codex 0.159.0 generated protocol schemas and installed Claude Code 2.1.284 `--help` were checked separately for the invoked native controls. These facts do not establish subscription entitlement or model quality.
- `scripts/test-translation-native.mjs` drives the production translation runner through installed CLIs and a loopback synthetic upstream. Its Codex test explicitly substitutes a fixture provider at `thread/start`; production selects the native OpenAI account provider. Both tested runtimes sent one request with zero advertised tools and returned input/output/cache usage. The fixture uses isolated profile directories and no real account, token or paid model request. This is native protocol/configuration evidence, not official-account billing or internet egress acceptance.


<!-- model-cost-lower-bound-20260930:start -->
## 模型价格与缓存写入回执（2026-09-30 JST）

- 官方公开事实：[OpenAI List models](https://developers.openai.com/api/reference/resources/models/methods/list) 的模型目录只声明 ID、创建时间、所有者、对象类型和可选停用日期，没有模型单价字段。[Responses create](https://developers.openai.com/api/reference/resources/responses/methods/create) 的 usage 提供 token 计数，input_tokens_details 区分 cached_tokens 与 cache_write_tokens，不是美元账单。
- 本日实际抓取 [OpenAI API pricing](https://developers.openai.com/api/docs/pricing)，短上下文 Standard 的 gpt-6-astra 仍为输入 10、缓存读取 1、缓存写入 12.5、输出 50 USD / 百万 tokens，与现有参考表一致。未更改价格或把第三方别名猜成官方模型。参考表不等于代理实际收费或订阅配额；第三方如另有价格接口，须按其文档单独适配，不能假设兼容 /models 就包含单价。
- 工程选择：公开价格与已保存自定义价格仍优先按既有规则读取；缺失缓存写入不能清空其他可计价部分。每条回执独立计算保守下界，未知缓存分类使用可能类别中的最低单价，再汇总；输入包含缓存且只计一次。下界不是补造的完整费用，不回填历史未知计数。未引入外部代码或新依赖。
<!-- model-cost-lower-bound-20260930:end -->

<!-- browser-auth-url-sources-20260930:start -->
## Claude 远端浏览器授权的版本观察（2026-09-30）

本次经已存在的 SSH 管理连接只读检查一份 root 所有、不可被普通用户改写的已安装 Linux Claude Code 2.1.285 程序文件。未读取远端账号配置、进程参数/环境、凭据或聊天库；没有执行 `auth login`，没有请求真实授权页或修改远端文件。没有活跃 CLI 可据以证明该文件是某个正在进行的登录任务所选择的程序，故结论限于这份已安装程序。

静态观察到的公开入口常量为 `https://claude.com/cai/oauth/authorize`（订阅）、`https://platform.claude.com/oauth/authorize`（Console）、`https://platform.claude.com/oauth/code/callback`（手动回调）。该版本原生 OAuth 方法分别构造手动与自动 URL，通常向调用方提供手动 URL，再调用浏览器打开自动 URL；不是所有输出 URL 都意味着 localhost 自动回调。没有复制第三方实现、引入第三方代码或新增依赖。它是指定安装版本的行为证据，不是永久公开 API 保证。

工作台现有源码将远端 CLI 的 `BROWSER` 设为 `/bin/true`，读取其终端输出的 URL，再交给远端 Chrome。因此当前集成保留原生手动授权码路径；本机只展示远端 noVNC，临时码交回远端 CLI。合成 CLI 的自动 loopback 测试只证明工作台协议可以处理该合成情形，不能证明真实 CLI 已走自动回调。本轮尝试读取官方 authentication 文档未取得可用正文，不据此补造官方文档结论。

工程修复在现有严格校验中新增确切订阅域名/路径，并限制准备阶段期限。未来 CLI 入口变化仍需重新核实；不自动接受未知网址、不更换账号、不代替原生令牌交换、不增加失败后的重投。真实账号授权与最终远端登录成功仍需独立验收。
<!-- browser-auth-url-sources-20260930:end -->

<!-- claude-ssh-catalog-sources-20260930:start -->
## Claude SSH catalog and native forwarding probe (2026-09-30)

Official references read on this date: [environment variables](https://code.claude.com/docs/en/env-vars.md), [CLI reference](https://code.claude.com/docs/en/cli-reference.md), [Remote Control](https://code.claude.com/docs/en/remote-control.md), and the official documentation index. The web reader returned no body; the same official Markdown pages were read with an HTTP client. Shell prefix wraps assembled shell invocations and several helper-command categories; that does not establish a complete cross-OS file/tool executor. Remote Control documents control of a running native session, which by itself does not establish this product's VPS-runtime/local-Windows-tool direction. No third-party implementation or dependency was copied.

Local evidence: scripts/probe-claude-ssh-capability.mjs starts the installed, unmodified Claude Code 2.1.284 in a disposable home with synthetic credentials, closed-loopback upstream/proxy and nonessential traffic disabled. It sends only initialize and remote_tools_announce control messages, never a user prompt. Initialize returns native model metadata. The latter request returns remote_tools_disabled: not_managed_cloud_worker. This is a version-specific local observation, not a statement about every future version, the deployed VPS binary, account entitlement, network egress or a successful external executor. No cloud identity, feature-gate override or local credential import was attempted.

The new broker catalog path is independently tested with injected processes and public synthetic account metadata. Successful catalog initialization does not satisfy H execution evidence. The existing same-OS shell-prefix candidate and proposed file view also remain insufficient evidence for the requested Windows native execution direction.
<!-- claude-ssh-catalog-sources-20260930:end -->

<!-- claude-official-mcp-sources-20260930:start -->
## Claude official MCP tool route (verified 2026-09-30)

- Official Claude Code MCP documentation, [Use Claude Code as an MCP server](https://code.claude.com/docs/en/mcp): documents `claude mcp serve`, official stdio tools and caller responsibility for permissions. This is an official tool interface, not evidence of a Codex-style external executor or lossless feature parity.
- Official [environment variable reference](https://code.claude.com/docs/en/env-vars): documents `CLAUDE_CODE_DISABLE_BACKGROUND_TASKS`. Applied only to the local tool-server process for foreground command lifetime; VPS native Agent orchestration is not disabled.
- Official [CLI reference](https://code.claude.com/docs/en/cli-reference): stream JSON, permission modes, explicit tools, strict MCP configuration and setting-source controls. No model/API proxy or new account-login mechanism is derived from these options.

Project evidence: unmodified local Claude Code 2.1.284 served real fixture Read/Write/Edit/Glob/Grep/Bash/PowerShell calls and terminated an owned long-running command on cancellation. A second isolated native process using the production owner launch arguments completed initialize and MCP-status metadata controls against the local endpoint. Both used isolated synthetic Claude configurations and closed-loopback model endpoints; no user prompt, Claude inference, real SSH or VPS deployment occurred. Synthetic tests separately verify owner authorization, transport fencing, controller lifecycle and approved plugin extension paths. Actual remote native login/model execution/network egress remains a user acceptance boundary. The internal `not_managed_cloud_worker` path is not enabled or spoofed by this implementation.
<!-- claude-official-mcp-sources-20260930:end -->

<!-- claude-local-resources-20260930:start -->
## Claude local resource bridge review (2026-09-30)

Official sources: [MCP server mode, image content and prompts](https://code.claude.com/docs/en/mcp), [skills and command files](https://code.claude.com/docs/en/skills), [native memory locations and controls](https://code.claude.com/docs/en/memory), [CLI options](https://code.claude.com/docs/en/cli-reference), and [native subagents](https://code.claude.com/docs/en/sub-agents). These are public capability references, not evidence that a particular account or live remote session passed.

Observed locally with official Claude Code 2.1.284 and synthetic files: MCP Read encoded an image envelope inside a text block; raw native Skill returned success without its instruction body. Therefore merely exposing the original tool names was insufficient. The bridge now adapts verified Read envelopes and explicitly provides workbench resource-discovery/skill-loading tools plus standard MCP prompts. Official file and command execution still uses `claude mcp serve`. This is a workbench adaptation, not an official claim of full native-runtime equivalence across machines.

Public facts: MCP carries image blocks and prompts; native skills may use argument/path substitution, dynamic shell commands and fork context; native memory is machine-local and may use an explicit directory. Implementation choices: scoped local discovery and native file access, explicit dynamic-command approval and no implicit remote auto-memory engine. As of 2026-10-03, unsupported lifecycle declarations no longer prevent resource reading: original source and unexecuted native requirements are returned, with a registered syntax adapter entry. Built-in lifecycle execution remains incomplete. Still unverified: real VPS model selection of tools, actual child-agent MCP inheritance, image understanding, user prompt selection in the native frontend and live memory recall. No model requests or SSH were used for these acceptance probes.
<!-- claude-local-resources-20260930:end -->

<!-- claude-local-async-20260930:start -->
## Claude local asynchronous command review (2026-09-30)

The installed official Claude Code 2.1.284 exposes `TaskStop` in the local MCP catalog, but did not expose a verified `TaskOutput` contract during the control-only probe. A background Bash call returned a task identifier without a usable output path or unsolicited completion notification. The bridge therefore keeps native `run_in_background` disabled and adds an explicit adapter: each `StartLocalCommand` receipt owns a separate official local `claude mcp serve` process, runs a foreground native Bash or PowerShell command, and supports bounded polling and stopping through `LocalTaskOutput` and `StopLocalTask`. This is an official-tool execution path with workbench scheduling, not a claim that vendor-native background semantics were reproduced.

The same review confirmed the documented `shell: powershell` skill frontmatter behavior locally. Dynamic skill commands now carry their shell choice through the resource plan and dispatch to the matching official local tool. The production probe exercised image conversion, memory read/edit/write/readback, skill output, PowerShell routing, asynchronous task output, cleanup, and the absence of a local model route without sending a Claude prompt or opening SSH.
<!-- claude-local-async-20260930:end -->

<!-- claude-model-options-20261001:start -->
## Claude context variants and Fast metadata (2026-10-01)

Official sources read: [model configuration](https://code.claude.com/docs/en/model-config.md), [Fast mode](https://code.claude.com/docs/en/fast-mode.md), and the published `@anthropic-ai/claude-agent-sdk` `ModelInfo` declaration. The web reader returned no body; the official Markdown and published package declarations were read using an HTTP client. No SDK implementation or third-party code was copied.

The model configuration documents `[1m]` model values such as `opus[1m]` and `sonnet[1m]`. This does not imply every model has two variants: some models already have a 1M context window by default. ModelInfo declares `value`, `displayName`, supported effort levels and `supportsFastMode`; the reviewed declaration does not guarantee a numeric context-window field. The workbench retains returned model values without collapsing suffixes or fabricating additional rows. It projects a valid numeric capacity when present, otherwise only the documented `[1m]` suffix establishes 1,000,000 tokens. An unsuffixed model with no capacity metadata remains unknown until native usage provides a receipt.

Fast is a capability/selection on the same model. The documented noninteractive route is a session launch setting such as `claude -p --settings '{"fastMode":true}'`. The workbench derives the switch from `supportsFastMode === true`, never from a model-name allowlist, and passes explicit true/false per launch without modifying native user settings. Account entitlement, organizational restrictions, availability and extra usage charges remain controlled by Claude. A requested Fast preference is not proof of effective speed or billing. Tests cover metadata projection, launch arguments, stale/invalid capability rejection and preference restoration with synthetic accounts; they do not establish real-model or deployed-VPS acceptance.
<!-- claude-model-options-20261001:end -->

<!-- runtime-usage-20261001:start -->
## Claude result statistics (verified 2026-10-01 JST)

Official source: https://platform.claude.com/docs/en/agent-sdk/typescript (SDKResultMessage). Result envelopes document duration_ms, duration_api_ms, num_turns and usage. These are native runtime metadata, not assistant-authored response text. Repository normalization already preserves a numeric allowlist as a usage activity. The readable Chinese labels are a workbench presentation decision; the exact current Claude Desktop wording/layout has not been directly verified. No claim of identical Desktop UI is made. Codex repository tokenUsage/updated observations feed the existing metrics footer and do not establish an equivalent assistant output.
<!-- runtime-usage-20261001:end -->

<!-- claude-active-quota:start -->
## Claude native active quota query (2026-10-01)

Source: [official package version 0.3.286](https://registry.npmjs.org/@anthropic-ai/claude-agent-sdk/0.3.286), published `sdk.d.ts` (`SDKControlGetUsageRequest`, `SDKControlGetUsageResponse`) and the request emitted by `sdk.mjs`. The native stream-json control request is `get_usage` with `skip_behaviors: true`; it does not submit a user prompt. The response declares `rate_limits_available`, `rate_limits.five_hour` / `seven_day`, percentage `utilization` (0–100), and ISO `resets_at`. This differs from a `rate_limit_event` fraction (0–1). The API is explicitly experimental; unsupported installed CLIs must fail visibly rather than invent percentages. The declaration has no reset-card read or redemption contract. This is package/protocol evidence, not a successful live subscription query, a minimum CLI version claim or a deployment receipt. A separate empty-profile CLI 2.1.286 probe successfully completed `initialize` and `get_usage` with `rate_limits_available:false`, `rate_limits:null` and no behaviors; no real credentials, transcripts or model messages were used. No third-party implementation was copied or SDK dependency introduced; installed official CLI retains authentication ownership.
<!-- claude-active-quota:end -->
## SSH quota retention and model discovery (2026-10-01)

Observed source behavior: the authenticated VPS native broker returns Claude `runtime/models` in about 1.4 seconds with 12 model entries, and `runtime/status` reports `authenticated: true`, `installed: true`, `execution: local-mcp-required`, version `2.1.286 (Claude Code)`. The same read-only probe returned native quota windows with `availability: ready`. This is live protocol evidence for the current test host, not a deployment or a universal version guarantee.

Design boundary: quota receipts are cached only after a successful native parse; transient refresh failures retain the prior receipt and timestamp. Claude has no native reset-card read/redeem contract in the verified interface, so the Claude card omits that row. Workbench allocation and borrowing values are estimates from observed token deltas and preserve the original lender across refresh cycles.

Workspace allocation now uses weekly quota only. Official account five-hour windows remain visible. Legacy fiveHourPercent fields and stored history remain readable but do not drive allocation accounting or admission; new administrator edits clear that legacy allocation. Confirmed weekly reset restores cycle shares, clears current reserve/overdraft usage and repays each original lender, carrying unpaid debt. Multiple account cards fill rows horizontally before wrapping; responsive wrapping adds no preference and retains existing disclosure keys. Existing named card/allocation surfaces remain the replacement interface.

## Desktop distribution research (2026-10-01)

- [OpenAI desktop update management](https://learn.chatgpt.com/docs/enterprise/manage-app-updates), fetched: documents ChatGPT desktop built-in updates and external Store/MDM channels. This page does not establish Codex installer internals; no proprietary updater code is copied.
- [Claude desktop installation](https://support.claude.com/en/articles/10065433-installing-claude-desktop), fetched: official platform installation guidance, not a public implementation contract for its updater.
- [GitHub Pages limits](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits), fetched: 1 GB deployed site and 100 GB/month soft bandwidth limit; Actions-driven deployments have distinct build-rate behavior.
- electron-builder 26.15.3 and electron-updater 6.8.9 were checked through their npm package manifests (MIT). Their installed NSIS updater source was inspected for explicit quit/install, caching, checksum handling and disabled install-on-quit behavior. These open-source components are dependencies; AgentWorkbench does not claim to reproduce a vendor desktop's private update implementation.

## Windows CLI program paths (2026-10-02)

The official [Codex Windows installer](https://chatgpt.com/codex/install.ps1) was fetched without execution. Its path resolution reads CODEX_HOME for packages/standalone and CODEX_INSTALL_DIR for the visible bin junction. These are installer-source observations, not a promise that moving an existing native profile is supported. The [Codex CLI page](https://developers.openai.com/codex/cli/) was also fetched; it does not itself establish a safe profile-migration contract. AgentWorkbench passes these variables only to explicit install/update/removal operations and preserves the original runtime environment for login, skills and memory. The prior audit found no equivalent custom program-directory parameter in Claude's Windows installer; this delivery does not claim Claude profile migration or universal native update support. No installer source was copied into the product.

## Workspace quota attribution reference (2026-10-02)

Follow-up inspection at the same commit also covered `quota_guard/live_reporting.py`: incomplete peer checkpoints can yield a display-only provisional fit, while confirmed attribution and borrowing remain separate. Its meter supplies model/cache-sensitive relative weights; those weights are not an official subscription conversion. The workbench repair independently removes ledger availability from model admission and resamples official windows after completion/read. It retains explicitly estimated raw-token attribution and does not claim to reproduce the reference's weighted meter or exact multi-user billing. No source was copied.

Reference: https://github.com/visaokc/CodexQuotaGuard at commit 035e092d43cd5be941687b0815ec9a9caaf09773. Reviewed quota_guard/meter.py (numeric cumulative deltas, durable cursor/outbox), quota_guard/ledger.py (window boundaries, attributed versus unassigned use), and the repository README and third-party notices. The inspected tree had no root license grant for application source; no implementation was copied or vendored. This is behavioral research, not an official provider quota specification. Its scanner explicitly establishes an initial high-water mark rather than attributing arbitrary old logs; its weighted allocation is an estimate, not an official per-device bill. The workbench independently recovers its already-bound numeric receipts, preserves account generations and excludes unknown bindings. Raw token ratios and API prices do not prove fixed subscription quota conversion. No actual user history, credentials or remote private configuration was inspected during this repair.

## Model provider presets (2026-10-04)

Public facts used for the shipped provider presets. Checked from this device on 2026-10-04.

- [OpenCode Go documentation](https://opencode.ai/docs/go/): base URL `https://opencode.ai/zen/go/v1` with per-model endpoints (`chat/completions`, `messages`, `responses`). Clients must send a stable `x-opencode-session` per conversation and their own user agent. A live request without the header returned 400 `MissingSessionID`; with it, Chat Completions and Messages returned 200.
- [OpenCode Zen documentation](https://opencode.ai/docs/zen/): base URL `https://opencode.ai/zen/v1` and a per-model endpoint table. Gemini models use a separate `models/gemini` route that the workbench does not support. Free models returned 403 `FreeTierError` outside OpenCode clients.
- Address probes without credentials (401 means the path exists; 200 means a public model list): DeepSeek `api.deepseek.com/models`, OpenAI `api.openai.com/v1/models`, Anthropic `api.anthropic.com/v1/models`, OpenRouter `openrouter.ai/api/v1/models` (200), Moonshot `api.moonshot.ai/v1` and `api.moonshot.cn/v1`, Z.ai `api.z.ai/api/paas/v4` and `api.z.ai/api/coding/paas/v4`, Zhipu `open.bigmodel.cn/api/paas/v4` and `open.bigmodel.cn/api/coding/paas/v4`, MiniMax `api.minimax.io/v1` and `api.minimaxi.com/v1`, DashScope `dashscope-intl.aliyuncs.com/compatible-mode/v1` and `dashscope.aliyuncs.com/compatible-mode/v1`. These probes do not show that chat requests or specific models work.
- The provider list in another desktop client was used only as a reference for which services to cover. No code or data was copied from it.
