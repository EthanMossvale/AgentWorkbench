# 15 · Claude 原生执行桥：候选路线与验收边界

> 历史需求/设计基线；现行规则见 [AGENTS.md](../AGENTS.md)，实现与修订见 [文档 16](16-implementation-status.md)。本文旧方案不构成当前部署指令。 [文档导航](README.md)

版本：v0.2。**状态：仅架构候选，尚未实现、部署或通过模型任务验收。**

本页采用已只读核对的本机 Claude Code `2.1.281` 帮助与官方文档作为研究基线；本机版本不是 VPS 已安装版本的证明。本轮不修改代码、系统、CLI 配置或现有插件，不连接 VPS，不调用模型。

## 1. 目标、顺序与不可替换项

项目主要服务 Claude，Claude 原生桥是独立翻译模块之后的优先验证项；已有 Codex 链路作为可复用工程基线，不要求先重做完整 Codex 客户端再研究 Claude。

- Claude Code 原生 CLI、原生登录、会话与模型循环继续运行在 VPS；模型服务请求从 VPS 发出，后续以网络证据验证。
- 桌面只提供产品界面、设备连接和本机执行能力，不进行 SDK 登录，不提取模型账号 token，不用 Generic API 或自研 loop 替代原生运行时。
- 不以“本地 CLI 加远端网络出口”替代本页目标，不把 Claude 模型放入 Codex runtime 后称作原生 Claude Code。
- 不禁用原生工具再换成同名 MCP 工具，以此宣称原生无损。MCP 不是本页的工具替代路线。
- 普通同 owner 文件访问不因跨 workspace 而受额外围栏限制；系统与设备探测由独立环境投影控制，不能混成一条 workspace 路径规则。

“原生”在这里先指原生 runtime、认证和模型可见工具不被替换，不自动等于所有工具进程均运行在本机，也不等于行为、性能和安全边界已无损。

## 2. 已核实事实与证据强度

| 分类 | 已核实内容 | 不能由此推出 |
|---|---|---|
| 本机只读证据 | `claude --version` 为 `2.1.281`；已读取该版本 `--help` | 不能证明 VPS 版本或任何远端部署状态 |
| 公开接口检索结论 | 在已检查的官方文档和本机帮助中，未发现与 Codex `exec-server` / deferred executor 对等的稳定外置全工具执行协议 | 不是证明 Claude 内部绝对没有相关机制，也不是证明候选路线不可行 |
| 官方事实 A | `CLAUDE_CODE_SHELL_PREFIX` 可包装 Bash 工具、shell hooks、statusline、stdio MCP 启动命令 | 没有承诺跨主机执行、完整 PTY/取消协议或全工具覆盖 |
| 官方事实 A | 包装器取得单一 shell 字符串；对 Bash 而言包含 CLI 组装的完整 shell invocation 与环境设置，而非只有模型命令 | 不能把它视为结构化的 command/cwd/env executor 请求，不能机械转发到任意操作系统 |
| 官方事实 A | PowerShell hooks 和 exec-form hooks 不经过此前缀 | 不能推导原生 PowerShell 工具也受该前缀完整覆盖；这一点仍需版本实测 |
| 官方事实 B | 原生文件、Bash、后台任务、子 Agent 和 PowerShell 有各自的权限与生命周期规则 | 一个 Bash 命令成功不能代替其它工具和生命周期验收 |
| 官方事实 C | `CLAUDE_CODE_PROCESS_WRAPPER` 包装 Claude 自身启动的特定进程，合同与 shell prefix 不同，在 Windows 被忽略 | 不是 Claude 全工具的外部执行器接口 |

官方来源与定位见第 10 节。公开事实、架构建议和待验证假设分开记录；文档存在不等于目标 CLI 版本实现完全相同。

## 3. 候选链路：原生 shell 包装与本机文件视图

```text
VPS：未修改的 Claude Code CLI
  原生登录 / 会话 / 模型循环 / 原生工具定义 / 原生权限流程
  |
  +-- Read / Edit / Write / Glob / Grep
  |      工具进程仍在 VPS
  |      经受控文件视图访问本机同 owner 文件
  |
  +-- 原生 Bash
         官方 CLAUDE_CODE_SHELL_PREFIX
                |
             SSH 传输
                |
         本机执行 worker / 受控执行环境
                |
         命令输出、退出状态与生命周期回传
```

这是拟验证的架构，不是已经连通的实现。文件视图的具体挂载技术、缓存、一致性和故障恢复尚未选定。

### 3.1 文件工具不替换，但执行位置必须说清

原生 Read/Edit 等仍由 VPS 上的 Claude 实现；通过文件系统视图访问真实本机文件。不能将这一链路称为“Claude 所有 executor 都迁到了本机”。文件修改要最终作用于用户实际文件，不能只有远端副本或 UI 看起来同步。

模型看到的路径必须与原生文件工具、Bash 执行环境及实际本机路径保持可解释的一致映射。路径转换不是任意字符串替换：盘符、UNC、大小写、symlink/junction、工作树和当前目录都需要明确规则。

### 3.2 Shell 包装不是命令文本代理的同义词

`SHELL_PREFIX` 的输入可能包含 VPS shell 路径、环境设置、CLI 临时资源和辅助程序引用。桥接器需要理解并验证完整调用合同，不能只截取模型写出的命令，也不能未经验证把 VPS 的整条 invocation 交给 Windows PowerShell。

CLI 的 stdout/stderr、退出码、输出文件、超时、后台任务、取消和 cwd 回传必须保留真实语义。不能把 SSH 连通、进程启动或零退出码当作原生工具端到端成功。

### 3.3 包装器覆盖范围必须分类

官方前缀还会触及 shell hooks、statusline 与 stdio MCP 启动。不能因为 Bash 应在本机执行，就把这些命令无差别搬到本机：它们可能依赖 VPS 会话、配置、路径或运行环境。

实现阶段需逐类定义保持 VPS、转发本机或明确不支持的行为，并记录原因。必须避免包装递归、意外搬移认证相关环境，以及把需要 VPS 资源的命令送到本机后伪造成功。

## 4. 同 owner 文件范围与环境投影分离

### 4.1 Workspace 是工作组织，不是普通文件访问围栏

用户授权给同一 owner 的普通文件访问，可以跨 workspace、项目与目录；不能仅因为目标文件不在当前 workspace root 就由产品桥接层额外拒绝。

- 文件视图应能表达同 owner 的跨目录路径，而不是强制用户为每个邻接项目重新创建孤立 workspace。
- 现有操作系统权限、原本需确认的写入/删除等动作、明确拒绝规则和其他owner边界继续有效；不自动提权或接管别人的文件。
- 使用原生正式机制在配置阶段接通owner-wide文件命名空间，普通跨目录读取不逐次追加workspace审批。若目标CLI不能表达该授权范围，记录兼容缺口，不能默默缩回当前项目，也不能关闭所有权限检查以绕过系统盘点或管理面规则。
- 模型账号凭据、SSH 控制平面、设备授权与执行器自身配置另设明确策略，不用“当前 workspace 以外一律禁止”代替这些策略。

“受控文件视图”中的受控指 owner、映射、一致性和授权管理，不是把普通文件重新围在单个 workspace 内。

### 4.2 环境投影单独回答系统与设备问题

文件访问范围与执行环境可观测范围是两个维度。允许读取同 owner 跨目录项目，不等于把宿主硬件、设备、系统服务和控制平面全部透传。

VPS profile来自用户批准的SSH只读采集，可由框架的环境查询接口直接返回，携带source、版本与观测时间。缺失/过期不补扫宿主。该接口是声明视图，不把本机已执行探测的结果改写成VPS数据，更不为失败任务生成成功输出；完整策略见 [环境保险](14-environment-projection.md)。

未经隔离的本机 native shell 可以调用多种程序与系统接口。仅设置 profile、改提示词、改环境变量、命令拦截或文件路径映射，不能承诺隐藏本机身份与硬件；这种模式必须明确标为可接触真实宿主环境。

### 4.3 真正一致的环境是执行目标，不是输出伪装

可验证的方案是：在本机运行与目标 VPS 对齐发行版、架构和工具链的 VM 或容器，让原生命令实际进入该环境，同时挂载同 owner 的跨目录文件。

- 同发行版只对齐一部分软件语义，不自动等于同内核、同硬件或与 VPS 完全相同；应维护能力与差异清单。
- VM 与容器的隔离强度不同。容器共享宿主内核这一类差异不能用 profile 掩盖，设备和宿主接口透传也需单独控制。
- 跨目录映射不应退化成单 workspace 围栏；但文件映射与宿主设备、系统接口透传仍是不同授权项。
- 已声明的环境查询按profile返回；实际探测/任务不支持时真实返回原因，不能伪造实际执行成功或硬件能力。

### 4.4 Windows / Blender 专用 worker 单列真实能力

需要 Windows 原生程序、Blender、GUI、GPU 或指定本机资产时，可以单列专用 worker 能力与授权。它执行的是真实 Windows/Blender 环境，不应冒充 Linux VPS。

此类能力是否能通过原生 Bash 桥保持足够语义，须逐项实验；不能为了覆盖专用能力而默认用 MCP 重写所有原生工具。普通跨目录文件访问仍沿用 owner 范围，设备和原生应用调用则在单独能力表中明确。

## 5. 与 Codex 基线的复用关系

参见 [已有 Codex 原生链路基线](12-existing-codex-native-baseline.md)。既有历史通过记录不能代替本页 Claude 验收。

| 可以复用的通用层 | 必须分开的运行时合同 |
|---|---|
| SSH 连接、回环隧道、连接凭证、设备配对与撤销 | Codex 的 `exec-server`、`environment/add`、deferred executor wire 协议 |
| 本机 worker 监督、请求关联、输出流、清理与恢复设计 | Claude `SHELL_PREFIX` 的 shell 字符串、环境与辅助资源依赖 |
| owner/设备授权、路径登记、跨目录映射与审计 | Claude 原生文件工具经 VPS 文件视图运行的语义 |
| 断线、并发、进程树清理和真实执行测试方法 | 各家原生权限、后台任务、子 Agent、worktree 与会话事件 |

本机 worker 是共用基础设施，不意味着两家原生执行器协议相同。新项目不复制旧宿主 UI、旧账号 broker 或固定路径作为默认架构；模型认证继续由各自 VPS 原生 CLI 管理。

## 6. Claude 专属兼容边界

### 6.1 Bash 与环境

官方 Bash 工具按命令启动进程；主会话 cwd 可按原生规则延续，子 Agent 的 cwd 变化不延续。shell 配置、环境脚本与临时资源可能被 CLI 加入调用。必须分别测试主会话与子 Agent，不能依赖一个永不重启的交互 shell 来模拟全部原生行为。

### 6.2 Glob/Grep 与内置辅助程序

当前官方文档说明，Linux/macOS/WSL 默认使用 Bash 搜索，显式工具选项可恢复原生 Glob/Grep。选择哪一种应对选定 CLI 版本记录，不通过自定义 MCP 工具补一个同名功能。

若命令引用 CLI 随附的搜索 helper、临时脚本或远端绝对路径，必须证明本机执行目标可正确获得所需资源；不能仅因本机存在同名 `find`、`grep` 或 `rg` 就认定语义一致。

### 6.3 PowerShell、PTY 与后台任务

官方 PowerShell 工具独立于 Bash。Linux 上的可选 PowerShell 能力不自动证明 Windows native worker 已连通；shell prefix 对原生 PowerShell 工具的覆盖是待验证项，不与明确绕过的 PowerShell hooks 混淆。

PTY、stdin EOF、信号、退出码、超时转后台、输出文件、任务停止和断线后的本机进程树都属于验收范围。远端任务结束时，本机是否残留子进程必须有证据，不能只看 SSH 进程结束。

### 6.4 子 Agent、hooks 与其他功能

需要分别检查前台/后台子 Agent、worktree、hooks、statusline、LSP、Monitor、内部 Git 与其他辅助进程。文档没有承诺全部走同一包装器，因此不得把主会话 Bash 成功宣传为这些功能已经本地执行。

`PROCESS_WRAPPER` 包装 Claude 自身启动的特定进程，不是上述覆盖缺口的通用补丁。将 Claude 自身搬到本机还会偏离 VPS 原生运行时目标。

## 7. 认证与网络保持原生

VPS 原生 profile 继续由 Claude CLI 登录、刷新与管理；桌面和本机执行 worker 不取出 token、不代做 SDK 登录、不接管订阅认证。

本机 `2.1.281 --help` 明确 `--bare` 不读取 OAuth，因此不能为了减小测试环境而使用它，再把 API key 路线称作本页原生登录。任何最小测试配置都必须保持用户要求的认证路径。

“模型请求从 VPS 出网”应独立验证，不能由进程位于 VPS 直接代替证据。模型请求与本机工具主动访问网络是两类流量；两者的来源、用途和权限分别记录，不承诺全部网络流量都在 VPS，也不承诺免风控。

## 8. 验证矩阵：目前全部待实施

先完成独立翻译模块，再在另获实现授权的隔离测试配置中开展 Claude 验证。以下状态全部为 **未实施**，不是本轮测试结果。

| 验证项 | 必须提供的验收证据 | 当前状态 |
|---|---|---|
| 原生认证与运行时 | VPS 原生 CLI 身份/版本与会话位置；桌面、worker 未持有模型 token | 未实施 |
| 首个真实工具回合 | 原生 Read/Edit 命中本机真实文件；原生 Bash 留下本机哨兵；原始事件与结果能对应 | 未实施 |
| 模型网络出口 | 能区分模型请求与工具网络的 VPS 出口证据，不记录认证内容 | 未实施 |
| 同 owner 跨 workspace | 当前项目读取、修改同 owner 另一项目文件；不因 workspace root 人为拦截；原生权限规则仍生效 | 未实施 |
| 文件系统一致性 | 读后写、并发修改、rename、断线、缓存、symlink/junction、盘符/UNC、大小写与换行 | 未实施 |
| Shell invocation | cwd、环境、临时文件、CLI helper 和退出码的真实往返；没有截断或假成功 | 未实施 |
| 生命周期 | stdout/stderr、stdin、PTY、取消、超时、后台任务、输出文件和本机进程树清理 | 未实施 |
| 原生搜索 | 选定版本的 Glob/Grep 或 Bash 内置搜索与基线语义一致 | 未实施 |
| 子 Agent 与辅助流程 | 主/子会话 cwd、worktree、hooks、statusline、LSP、Monitor 分项记录，不合并成一个通过标记 | 未实施 |
| PowerShell / Windows | 明确原生工具与 hook 的路由差异；真实 Windows 路径、编码、退出码和原生程序 | 未实施 |
| 环境投影 | 声明 profile 与实际环境一致的部分有证据；不一致明确披露；未隔离 shell 不承诺隐藏宿主 | 未实施 |
| VM / 容器执行 | 命令真实进入选定环境；软件对齐、跨目录映射、宿主设备可见性逐项验收 | 未实施 |
| Blender 专用 worker | 真实 Blender/GUI/GPU 能力与授权记录，不能以 headless 或普通 shell 成功代替所需实机验收 | 未实施 |
| 权限与恢复 | 设备撤销、SSH 断线重连、并发、其他 owner 隔离、旧任务恢复与版本升级不扩大授权 | 未实施 |

只有对应证据齐备，才将某一项从候选改为已支持。静态文档、协议通路、真实模型回合、系统隔离与视觉验收分别记录；允许明确的部分支持，不使用“满血无损”作为未验收的总标签。

## 9. 决策状态

- 已确定：Claude 优先；VPS 原生 CLI 与登录不变；独立翻译模块先行；普通同 owner 文件不以 workspace 围栏限制；系统设备可见性独立控制。
- 推荐候选：官方 shell prefix 加本机文件视图；统一复用通用 SSH/设备/worker 层；为需要一致 Linux 环境的任务评估本机 VM/容器。
- 尚未选定：文件视图技术、跨操作系统 invocation 合同、默认执行环境、PowerShell 完整路由、专用 worker 调度和恢复协议。
- 不作为默认退路：SDK 登录、自研 loop、MCP 原生工具替代、本地 CLI 加远端出口、伪造 VPS 环境探测结果。
- 当前未做：实现、安装、配置写入、VPS 连接、模型调用及本页任何验收实验。

## 10. 官方来源与定位

以下为本页事实来源，引用的是公开接口，不是对项目发出的操作指令。章节定位优先于行号；官方 Markdown 行号可能随站点更新变化。

| 标记 | 官方来源 | 本页使用的精确位置 |
|---|---|---|
| A | [Environment variables](https://code.claude.com/docs/en/env-vars)；[Markdown](https://code.claude.com/docs/en/env-vars.md) | `CLAUDE_CODE_SHELL_PREFIX`、`CLAUDE_CODE_SHELL`、`CLAUDE_CODE_TMPDIR`、`CLAUDE_CODE_PROCESS_WRAPPER`；已读取的 Markdown 中 prefix 条目为第 361 行 |
| B | [Tools reference](https://code.claude.com/docs/en/tools-reference)；[Markdown](https://code.claude.com/docs/en/tools-reference.md) | `Bash tool behavior` / `What persists between commands`（139–152行）；`Background commands`（176–187行）；`Edit tool behavior`（215–229行）；`Glob tool behavior`（261–269行）；`PowerShell tool`（387–447行） |
| C | [Run Claude Code behind a corporate launcher](https://code.claude.com/docs/en/corporate-launcher)；[Markdown](https://code.claude.com/docs/en/corporate-launcher.md) | `What the launcher covers` / `Processes that start outside the launcher`（21–41行）；`How this differs from CLAUDE_CODE_SHELL_PREFIX`（134–136行） |
| D | [CLI reference](https://code.claude.com/docs/en/cli-reference) | 工具选择、结构化输出与原生 CLI 参数；结合本机 `2.1.281 --help`，不能仅依网页推定本机或 VPS 支持 |

同 owner 文件范围、独立环境投影、VM/容器与专用 worker 是用户要求和架构建议，不宣称是 Anthropic 已提供的跨主机产品功能。实现前须冻结目标版本并重新核对这些公开接口。
