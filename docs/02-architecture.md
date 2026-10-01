# 02 · 总体架构

> 历史需求/设计基线；现行规则见 [AGENTS.md](../AGENTS.md)，实现与修订见 [文档 16](16-implementation-status.md)。本文旧方案不构成当前部署指令。 [文档导航](README.md)

状态：设计草案 v0.2，非已实现系统。翻译先行、Claude主线、VPS环境保险与owner-wide文件访问为当前方向；事实依据见 [来源登记](07-research-sources.md)。

## 1. 先拆开五个维度

| 维度 | 例子 | 不应混淆 |
|---|---|---|
| ModelProvider | OpenAI、Anthropic、第三方 API、本地模型服务 | 供应商不是运行时 |
| AgentRuntime | Codex 原生、Claude Code 原生、Generic Harness | 运行时拥有 agent loop、工具规划和压缩语义 |
| RuntimeLocation | 本机、SSH 远端、未来容器/托管主机 | UI 所在电脑不一定运行模型客户端 |
| ExecutionTarget | 本机工作目录、远端工作空间、隔离执行环境 | 文件与命令在哪里执行必须明确 |
| EgressPolicy | 本机直出、指定 SSH 远端出口、运行时所在远端出口 | 模型请求出口不等于所有工具网络出口 |

另将原生认证 profile、RemoteEnvironmentProfile、FileAccessPolicy、InventoryPolicy 和审批策略分别绑定到实例。模型看到的环境投影不是执行位置；执行能力也不能由投影伪造。首个原生模式为 H，前置独立翻译模块使用 mock runtime 不构成 L/E/A 模式上线。

## 2. 工作模式

| 模式 | AgentRuntime 位置 | 文件/工具位置 | 模型请求出口 | 定位 |
|---|---|---|---|---|
| H | VPS 上两家原生 CLI | SSH 桥接的本机执行端，可含真实隔离环境 | VPS | 首个原生执行目标；Claude优先，CLI原生登录，独立验证 |
| L | 本地 | 本地 | 本地 | 后续扩展记录，非首期交付 |
| R | 远端 | 远端 | 远端 | 后续常规 SSH 工作空间，非 H 替代方案 |
| A | 本地或远端 Generic Harness | 所选执行端 | 所选有效出口 | 后排通用模型愿景，不继承原生 CLI 保证、不替代首期 |
| E | 本地 | 本地 | 指定远端出口 | 仅历史比较；暂不纳入实施、P0 实验或替代方案 |

禁止改变首期目标：H 的某项桥接尚未核实或未通过时，明确记录缺口、暂停相应能力并继续核实原生接口；不得改走 E、R、SDK 登录或默认 MCP 降级方案。改变路线必须由用户另行决定，不能在产品内当作已授权的自动回退。

## 3. 模块边界

```text
Desktop UI（项目、会话、账号、设置、审批、文件变化）
    |
Desktop Host（可信 IPC、设备密钥、URI 分发、连接生命周期）
    |
Input Translation Gate（用户自然语言；先独立交付）
    |       └─ 独立第三方翻译服务，不接触原生账号/权限
    |
Session Coordinator ---- Capability Registry ---- Account Metadata
    |                  （版本化原生契约）          （仅公开状态/引用）
    +---- RuntimeAdapter ---- SSH Connection ---- VPS Native CLI
    |       | CodexNative / ClaudeNative              |
    |       |                              各自原生登录、loop、历史、压缩
    |       |                                        |
    |       |                              Model Endpoint（VPS 出网）
    |       |
    +---- Native Tool Contract Bridge（SSH 双向手脚通道）
               |
         Local Execution Broker
               ├─ Owner File Service：同owner跨目录普通文件
               ├─ Environment Projection：来自VPS的版本化profile
               ├─ Isolated Executor：已物化的兼容执行环境
               └─ Host Worker：必要宿主能力，真实标记暴露边界

原生事件 → Public Text Projector → 原文 + 可选中文旁注/最终双栏
SSH只读采集 → RemoteEnvironmentProfile → 投影/已授权物化计划

独立管理通道：Admin Connection -> Host Control Plane
                             -> Workspace / DeviceGrant 管理
```

以上是首期 H 的逻辑职责。两家 CLI 都在 VPS 部署并使用各自原生认证；框架不做 SDK 登录、不读取或保存 token。手脚桥的目标是承接原生工具契约，而不是另造一套默认 MCP 工具名/schema 或重复 agent loop。某版本的公开接口是否覆盖完整委派仍须通过专门 gate，缺乏验证不等于已判定不可能。

Generic API / 自有 Harness 仅作为后排独立扩展，SDK 仅作为研究资料；二者均不进入首期执行链。Egress 组件在首期观测并验证 VPS 的出站行为，不负责把本地 CLI 代理为 E 模式。

前置翻译服务是无工具权限的文本处理组件，不是上述 Generic Agent Harness。输入只翻译自然语言；原始事件、文件内容、审批和签名不可被翻译层或环境投影层改写。环境保险与跨目录文件访问是正交策略，详见 [环境设计](14-environment-projection.md)。

**Codex 不是从零设想。** 已有方案以本机官方 `codex exec-server`、SSH 反向隧道、VPS 官方 app-server 的 `features.deferred_executor`、`environment/add` / `execServerUrl` 和会话 `environments` 形成原生链。它是 Codex Adapter 的第一迁移候选；本轮已核对源码和历史通过记录，但没有重新执行真实任务。[L03，详见原生基线文档]

## 4. 职责与禁止事项

| 模块 | 负责 | 不负责 / 禁止 |
|---|---|---|
| Desktop UI | 展示事件、收集确认、主题/侧栏/路径操作 | 不直接持有令牌或任意 shell 权限 |
| Desktop Host | 校验 IPC、系统密钥库、文件对话框、设备身份 | 不把页面输出当受信代码 |
| Session Coordinator | 绑定、状态机、lease、事件序号、重连 | 不改写供应商内部推理或偷换账号 |
| RuntimeAdapter | VPS 原生 CLI 公开协议、版本化原生工具契约、事件/审批映射 | 不修改原生二进制，不以 SDK 接管认证或伪造功能 |
| Native Tool Contract Bridge | 经 SSH 传递已验证的原生工具请求、结果、流与取消 | 不以注册自定义 MCP 工具等同原生手脚迁移 |
| Execution Broker | 文件/盘点/执行分流、授权、目标、超时、幂等状态 | 不因跨workspace拦普通文件，不自主增权/改变执行位置 |
| Owner File Service | 同owner普通文件跨目录解析、OS权限、真实内容与版本 | 不开放其他租户/控制面，不暗改含主机信息的用户文件 |
| Profile Collector / Projector | SSH只读允许字段、版本快照、带来源的环境查询 | 不补扫本机，不伪造实际任务/硬件/账号身份 |
| Environment Materializer | 在已批准隔离环境/依赖策略内建立兼容用户态 | 不全局改本机，不以未隔离shell谎称强保证 |
| Translation Gate / Overlay | 用户自然语言翻译与只读译文，独立key/费用 | 无执行权限，不改原生历史或提取隐藏推理 |
| Egress Observer | VPS 出站类别、连通/失效状态与验收证据 | 不导入 E 模式，不改写业务 JSON、伪装客户端或承诺免风控 |
| Host Control Plane | 发现/接管/补齐/重建工作空间、授权设备、配额 | 不向普通 workspace 暴露管理 socket，不自动清理未知旧环境 |
| Account Metadata | 两家 VPS 原生 profile 引用、公开状态、刷新时间 | 不收集两家 token、不做 SDK 登录、凭据中介或跨用户账号池 |

## 5. 数据模型（设计名，不是既有 API）

- `Host`：稳定 ID、连接方式、主机密钥指纹、能力、健康状态。
- `Principal/Tenant`：人或组织的权限身份；与 SSH 用户名、模型账号区分。
- `Device` / `DeviceGrant`：设备公钥、workspace 授权、过期/撤销状态。
- `DiscoverySnapshot` / `ReconcilePlan`：只读发现的主机事实、归属置信度、目标状态与经批准的差异操作；重复执行不重复创建。
- `Workspace`：远端运行/管理与资源边界、owner、HOME、runtime；当前本机项目路径不是同owner文件权限围栏。
- `WorkspaceGeneration`：一次重建后的新环境代际；旧设备授权/任务不能仅凭相同用户名继承新环境权限。
- `Project`：用户的逻辑项目；可有多个带主机身份的 `ProjectLocation`。
- `ExecutionBinding`：device/host、真实OS/工作目录、工具能力、FileAccessPolicy引用、环境profile版本、隔离保证级别。
- `OwnerFileNamespace` / `FileAccessPolicy`：同owner已授权设备的可达普通文件；按OS权限/动作策略执行，不按workspace根拒绝。
- `RemoteEnvironmentProfile` / `InventoryPolicy`：允许采集的VPS字段、来源/时间/状态、模型环境查询与系统盘点权限。
- `ExecutionCapabilities`：实际shell、路径语义、Blender/GPU等必要能力；与环境模拟配置分开。
- `TranslationProfile` / `TranslationOverlay`：独立提供商/协议/模型/effort、原始事件哈希、译文与状态；不覆盖原生历史。
- `RuntimeInstance`：provider adapter、CLI 版本、配置指纹、原生 session store 所在位置。
- `AccountProfile`：owner、provider、认证种类、原生 runtime 内的 profile 引用、展示字段。不是全局 token 文件。
- `Session`：项目、原生 session ID、runtime、account、execution、egress、能力快照。
- `Turn` / `Event`：回合状态、单调序号、原始 provider 事件与 UI 投影。
- `ArtifactRef`：带 authority、OS、路径、版本/摘要、行号的文件引用。
- `Approval` / `Operation`：主体、目标、操作摘要、范围、截止时间、幂等 ID、执行状态。

会话标题只是展示字段，不能用同名标题定位数据库记录。目录、账号、项目、主机、设备和会话 ID 不能共用一个“workspace”概念。

## 6. 状态所有权

原生 runtime 保有原生历史、压缩、工具状态与恢复语义；我们存关联 ID、产品元数据、必要事件镜像与本地执行审计。不要直接改写官方私有数据库或把转录文本当成可恢复快照。

另外保存用户中文原稿与实际提交的英文版本，译文按原始事件/哈希关联。原生会话权威内容是实际提交/返回的数据，显示译文不回灌resume/compaction。环境profile失效返回unknown/stale，不回落采集真实宿主隐私。

本地 SQLite 可保存产品元数据和事件索引；正文/附件采用可迁移的独立存储。首期两家模型凭据均由 VPS 上各自原生 CLI 登录流程保存和管理，框架不收集、导出或代存 token，不进 SQLite、前端状态、日志或 Git。SSH 设备密钥属于连接授权，与模型账号凭据分开。

远端 runtime 持有任务生命周期。首期 H 失去本地 worker 后暂停所需工具，不得将操作重新路由到 VPS 同名路径，也不得在本机启动替代 CLI 或转为本机模型出口。未来 R 模式的纯远端任务生命周期另行定义。

每个 session 一个写入 lease，显式接管带 fencing token。每个 project location 另设写入策略：串行或独立 Git worktree，不能只锁会话却放任不同会话改同一目录。已执行而未收到回执的命令保持“不确定”，不能盲目重发。

## 7. 路径是能力引用，不是字符串链接

路径内部至少携带 `authority + platform + absolutePath + projectId + optional line/column`。用户只看到易读路径，但复制、预览、定位、打开均通过 authority 选择正确工具。

Windows `<project-root>` 与 Linux `/work/repo` 不做猜测转换。`/<local-path>` 仅在明确 Windows 来源时作为兼容格式处理，普通 Unix 路径保持原样。UNC、空格、中文、符号链接、大小写、越界路径和断开连接都进入测试矩阵。

UI 路径元数据不能单独承担安全验证；文件服务验证真实路径、owner/device归属、OS权限与操作授权，但不把当前workspace根作为拒绝边界。跨项目普通读取不重复审批；其他租户、框架密钥及管理面仍隔离。远端路径“在文件管理器显示”不能无说明地打开本机同名位置。

## 8. 技术栈建议（尚未锁定版本）

建议先评估 **Electron + TypeScript + React** 桌面与 TypeScript 适配/编排层：便于流式会话界面、IPC、PTY 和 Web 组件迭代。原生 CLI 是独立受监督进程；底层 worker 若后续有可靠性/分发需求，可独立使用 Rust/Go，而不是首日把全栈写成多语言。

备选 **Tauri + Rust + Web UI**：若团队偏好 Rust、包体和权限边界更重要，可在 P0 后比较。当前不因参考软件选型而复制其整套技术栈，尚未安装任一开发依赖。

Electron 候选必须落实隔离 renderer、禁用页面 Node 权限、沙箱、受限 IPC、导航/外链校验、严格 CSP；模型输出、Markdown、HTML 预览都是不可信内容。[S17]

第一版 SSH 优先用系统 OpenSSH 或经审计库，协议类型不要泄漏到 UI。原生 app-server 可先由远端 supervisor 包装 stdio，经 SSH 传输；使用实验 WebSocket 时只允许回环/SSH 隧道并验证认证，不向公网裸露接口。[S01]

版本迁移补充：优先复用已经运行过的原生链路，不能把旧版 `exec-server/environment/add` 与新版 Code Mode host 的名称拼成未经验证的协议。独立桌面直接连接自己的 adapter，不需要复用旧插件替换 Codex 桌面启动入口的安装方式。

## 9. 未来多 Agent 的预留

从一开始让事件带 `agentId`、`originSessionId`、`messageId` 和作者类型，但不提前实现群聊。未来讨论组是多个独立 session 的协调层，而非把多个模型塞进同一原生 session。

讨论消息默认不授予工具权限；每个成员有预算、可见上下文和执行授权。共享仓库写入由显式调度/worktree 协调，防循环、成本上限、人工接管与隐私边界先于自动“多 Agent 协作”。
