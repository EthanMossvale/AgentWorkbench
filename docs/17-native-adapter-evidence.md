# 17 · 原生适配器实现与验证证据

> 功能与验证专题；事实仅适用于正文注明的版本、日期与验证层级。当前综合状态见 [文档 16](16-implementation-status.md)。 [文档导航](README.md)

实现批次：原生适配器与两家共享上下文。实现范围为本仓库内的 TypeScript 模块和合成子进程协议测试。**没有连接或部署 VPS，没有读取真实 token / 私钥，没有启动 Codex 或 Claude 模型任务，没有调用 SDK 登录，也没有修改已有插件。**

## 本轮实现

| 模块 | 实现 | 证据层级 |
|---|---|---|
| `services/remote-supervisor` | 无 shell 子进程监督、严格 UTF-8 JSONL、帧/总输出上限、超时退出、断线事件、进程组或 Windows taskkill 树清理；SSH stdio 使用独立最小环境 | 合成子进程合同测试；真实 VPS 后台/PTY 树清理仍未验收 |
| `packages/runtime-codex` | initialize → initialized；请求/响应 ID 关联；原生通知和审批；thread/start / read / resume；turn/start / interrupt；超时与断线标为不确定，不自动重放 | 合成 Codex 形状子进程往返测试，不是启动官方 CLI |
| `packages/runtime-codex` | 严格固定 `0.155.1` deferred executor 参数；`environment/add` 使用 environmentId / execServerUrl / connectTimeoutMs；thread/turn 使用 environments | 历史源只读核对 + 参数合同测试；未把新版 Code Mode / dynamic tools 混作相同接口 |
| `services/local-executor` | 官方 exec-server 参数构造、回环监听、独立 CODEX_HOME、OS 环境白名单、显式授权 gate | 参数及拒绝测试；本轮没有真实启动 exec-server / 隧道 |
| `packages/runtime-claude` | `--print --input-format stream-json --output-format stream-json` 公开事件适配；exact UUID resume；原始事件保留；公开文本/签名隔离；CLI 仍管理原生认证与 loop | 合成 Claude 形状子进程测试；不宣称真实官方进程或全工具桥通过 |
| `packages/runtime-claude` | SHELL_PREFIX 完整 invocation 作为单一 shell 参数；仅同 OS、同 POSIX 命名空间、已验证文件视图/helper/分类可构造候选 | 纯构造/拒绝测试；未安装 wrapper，未选定/实现文件视图 |
| `packages/session-core` | 不可变 runtime/provider/account/execution/egress 绑定；单写 lease、递增 fence、撤销；提交 ledger 与未知提交拒绝重放 | 进程内合同测试；未提供跨进程持久化分布式 lease |
| `packages/session-core/shared-context` | 接收本项目 store 品牌化、同 session 的不可变 memory+skills 快照；两家首条实际输入采用相同可见引用；来源 hash 与提交 receipt | 合成 Codex/Claude 子进程证实完全相同的输入上下文来源；真实 H 仍禁用 |

## 原始事件与签名

每个 NativeFrame 同时保留原始 JSON 文本、含换行符的原始 bytes（base64）、SHA-256 审计摘要和不可变解析对象。原始 signature 字段及原始帧均不重写。SHA-256 是本地完整性摘要，**不是新增的厂商签名，也不证明原始厂商签名有效**。

Codex reasoning / Claude thinking 或 signature_delta 仅保存在原始事件中，不转换成公开显示文本，不送翻译。公开 agent/text delta 与 final/result 独立规范化。未来持久化原始事件须另加权限和保留策略；当前模块不会扫描或导入真实聊天数据库。

## 默认失败关闭及缺口

- Host/UI 应继续禁止缺少完整证据的真实 H 提交。bridge evidence 必须与 runtime version、host、execution binding 精确对应。`contract-tested` 不满足 `verified` gate。
- Codex 新链需独立验证原生 auth、远端 runtime、认证隧道、executor link、environment binding、owner-wide 文件访问、取消和模型出网。旧插件历史模型通过记录不是本仓库当前验收。
- Claude 文件视图、wrapper 分类、helper/临时资源、同 owner 跨目录、PowerShell、PTY、子 Agent、hooks、后台任务、模型出网均未通过实机验收；H 保持 `unverified`。
- `CLAUDE_CODE_SHELL_PREFIX` 覆盖 Bash、shell hooks、statusline、stdio MCP，因此不能把任意前缀输入默认当 Bash。本模块拒绝未知类别，不转发 hooks/statusline/MCP，也不会把 Linux Bash 机械翻译成 PowerShell。
- Claude print 构造使用 `--permission-prompts none`，保留原生审批规则并拒绝无人处理的审批；不注入 MCP 权限工具，不默认绕过权限。若收到尚未核实的 host control request，关闭传输，不伪造允许。
- Claude cancel 当前终止本机 SSH/子进程监督；这不能单独证明远端 CLI、后台工具以及本机 worker 树都终止，所以真实 H cancellation gate 仍未通过。
- Ledger/lease 为内存状态，适用于单一受控 host 进程；若启用 crash recovery 或多 host，必须先做持久化原子 fencing 和原生 read/reconciliation。未知 turn 不用相同或新 ID 偷偷重发。
- 已知 RPC error 也保守保留提交不确定状态，避免误判是否发生副作用。没有自动模型重试、账号轮换、本地 runtime fallback 或通用 harness fallback。

## 本轮测试

运行：`npm exec tsc -- --noEmit`，`npm exec tsx -- --test tests/native-runtime.test.ts`。

最后一次本模块验证：TypeScript 全仓库类型检查通过；原生适配器测试 **18/18 通过**，无失败、无跳过。全仓库 build / 桌面验收由父任务另行汇总，不能从本表推断。

测试覆盖：严格 UTF-8 和原始签名；Codex 初始化/线程/回合/审批/中断；历史环境绑定和 resume 拒绝错 cwd；timeout/断线零重试；不可变账号/执行绑定；lease 过期与 fence；未知提交不重放；Claude 公开事件/签名隔离与 ack/result；Claude H gate；shell 跨 OS/资源缺口拒绝；local executor 环境无模型凭据；非法帧/超大帧/进程寿命限制。

测试 fixture 是 `node -e` 启动的本仓库自行编写的合成协议子进程，不是第三方官方 CLI，也不请求模型。Fixture 中 `verified` 字段只满足单元测试输入，不能作为生产 H 证据注册。父任务汇总中记录本次实际通过数量与全仓库最终构建结果。

## 只读核对的原生合同来源

1. OpenAI 官方 App Server 文档，本批次获取：`https://developers.openai.com/codex/app-server`。使用 initialize / initialized、消息 ID、thread/turn、审批请求、原生通知和生成目标版本 schema 的规则。文档为当前公开表面，不能替代 `0.155.1` 的历史 deferred 合同。
2. 既有插件 `<private-reference>/codex-device-workspaces\windows\helper.mjs:47–87` 与 `remote/device_server.py` 的 environment / execution_target / main 段，只读核对 exec-server、回环 gate/反向隧道、environment/add 与 environments 形状。本轮独立实现，没有复制旧插件源码或引入其许可证未审查代码。
3. Anthropic 官方 `https://code.claude.com/docs/en/cli-reference.md`，本批次获取：print、stream-json、partial messages、replay user messages、resume、permission-prompts 的公开参数。
4. Anthropic 官方 `https://code.claude.com/docs/en/env-vars.md`，本批次获取：SHELL_PREFIX 的单一完整 invocation 参数、覆盖范围及 PowerShell/exec-form hook 例外。

当前实现基线不宣称跨厂商无损迁移、通用额度或“满血原生”。H 验证与显示层/协议测试保持分开。

## 统一 memory + skills 的原生接入边界

两家 adapter 的构造器末尾接收 `SharedContextOptions { snapshot?, receipt? }`。Snapshot 只能由本项目 `memory-core` / `skills-core` 产生；使用 `isFrameworkSnapshot` 检查对象身份品牌，检查 session provenance，再保留原有深冻结对象。Renderer 序列化的伪造/克隆对象不能作为可信快照进入原生 adapter。

- 同一共享存储、同一选择，产生相同内容 `sourceHash`，不因 provider、session ID 或创建时间重写内容。显式选定的 SKILL.md 同样进入这一快照，不建立另一套 Claude memory/skills 系统。
- 首条真实提交仍使用各家公开原生输入：Codex `turn/start.input[].text`，Claude stream-json `user.message.content`。用户任务原文保留在最前；仅附加带来源 hash 的独立 JSON 引用块，不篡改原生认证、二进制、配置、会话库、thinking 或工具结果。
- 引用块明确 memory / skill 是不可信参考资料，不是 system 指令或新增权限；当前用户任务、交付物语言和动作授权优先。来源中的标签样式内容在 JSON 字符串中转义，不允许闭合外层引用块。
- Memory 关闭时不注入 memory；没有显式 skill 选择时也不注入 skill。关闭 memory 不会覆盖用户单独显式选择 skill 的意图。
- Adapter 创建时捕获快照，后续全局开关、memory 编辑或 skill 选择不修改已运行会话。换快照须新建会话。第二条原生输入不重复附加首条上下文。
- 关闭 memory、删除 note/skill 会撤销未提交快照和已生成但未提交的预览；首条写出前再次检查当前授权，重新开启也不复活旧预览。已发送的原生历史不会因关闭开关被改写：若持有匹配的原始 receipt，恢复只允许保留已知品牌的历史来源并发送本轮原任务，绝不重新注入被撤销内容。没有 receipt 或伪造/克隆的来源对象仍拒绝。
- `SubmissionLedger` 保留 `contextSnapshotId` / `contextSourceHash`；`SharedContextReceipt` 另记原始首次提交 ID 与完整实际输入 hash。写出前先占用 receipt；写出结果不确定不重新注入或重放。
- 恢复既有 native session 且启用了 context 时，必须携带同一冻结快照和原始 receipt，缺失则拒绝；不能凭新快照的相似内容假定原生历史一致。跨进程持久化与可信快照重建仍需 host 独立实现，本批次没有伪装成已经完成 crash recovery。
- 当前 shared skills store 是显式 SKILL.md 指令资料接入，不自动运行导入包的脚本或收集引用资产；此项不等于所有 Codex skill 插件能力已在 Claude 原生工具链实测。

新增测试使用全新临时 user-data 目录和合成 note / SKILL.md，不读取本机真实既有记忆、skills、私有聊天或任何凭据。验证包含禁用原样输入、伪造对象拒绝、来源 hash 跨 session 一致、标签注入隔离、冻结/receipt/resume、两家子进程首条输入相同，以及 memory 关闭但显式 skills 独立生效。

## Codex 多目录 Project 与深度链接：只读公开语义

以下是官方当前文档的公开行为，用于新产品设计参考，不代表本批次操作或验证过 Codex 本体 UI：

1. 官方 Projects 文档 `https://developers.openai.com/codex/projects`：Edit project → Add folder 可添加多个本地目录。Primary folder 决定新 chat 默认 cwd、默认 Git 操作及 AGENTS.md / skills / config.toml 自动发现；secondary folders 可搜索、读、编辑，但不自动发现这些 project 文件。PR/worktree 操作针对 primary repository；新 worktree chat 保留附加目录。Remote project 当前仅支持一个目录。Project/worktree 负责组织，实际访问权限由 sandbox 执行。
2. 官方 Commands 文档 `https://developers.openai.com/codex/reference/commands` → Deep links：`codex://threads/<thread-id>` 打开对应本地 chat；`codex://threads/new` 新建本地 chat；`codex://new?...` 至少需要 prompt/path/originUrl 之一。
3. New-link 的 `prompt` 只预填 composer，不自动发送；`path` 是一个绝对本地目录；`originUrl` 在已知 workspace roots 中按 Git remote URL 匹配，存在 path 时先解析 path。查询值必须编码。
4. 当前公开 deep-link 参数没有多目录数组或 secondary-folder 列表；因此不能声称一条官方深度链接能重建整个多目录 Project。打开既有 chat 的导航也不等于授权修改该任务、迁移运行时或提供该任务完整内容。

本批次未自动控制 Codex 本体窗口、创建/打开 deep link、扫描 native chats 数据库，亦未尝试未公开 URI 参数。新的 Agent Workbench 如实现自有多目录项目，须保持自身存储和权限模型，而非靠修改 Codex 私有数据库实现。
