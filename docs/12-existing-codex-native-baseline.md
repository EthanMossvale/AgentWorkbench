# 12 · 已有 Codex 原生链路：复用基线

> 历史需求/设计基线；现行规则见 [AGENTS.md](../AGENTS.md)，实现与修订见 [文档 16](16-implementation-status.md)。本文旧方案不构成当前部署指令。 [文档导航](README.md)

日期：2026-09-24。由用户给出的既有任务定位，只读核对源码与历史验证记录。**没有修改旧插件、运行模型测试、连接 VPS 或把旧代码复制进新仓库。**

## 1. 结论修正

Codex 的 H 模式不是从零设想，已有原生执行器实现及真实模型驱动本机执行的历史通过记录。

因此 Codex 首项任务改为 **拆出复用模块 → 固定版本复现 → 独立客户端适配 → 工具覆盖/兼容回归**，难度从“未知原生入口的 5/5”调整为“已有基础的迁移与回归 4/5”。Claude 仍需独立核对，不能从 Codex 的成功推导其接口相同。

## 2. 实际实现链

```text
VPS 官方 Codex app-server（既有代码固定 0.155.1）
    features.deferred_executor=true
    environment/add(execServerUrl)
    thread/turn 参数 environments 选择本机 cwd
             |
      SSH 反向隧道 + 每次连接的鉴权入口
             |
Windows 官方 codex exec-server
             |
      本机原生命令 / 文件 / 工作目录
```

这一链路直接使用官方执行服务，不是给模型换一套自定义 MCP 命令来伪装工具。桥接本身仍有启动、鉴权、环境选择、路径和会话适配代码，因此“原生执行器”不意味着完全没有自建中间层。

### 已读取的源码

| 现有文件 | 本轮看到的实现 | 新项目处理 |
|---|---|---|
| `windows/helper.mjs:47–52` | 清理执行器不需要的模型 key/proxy 环境，独立 CODEX_HOME，启动官方 `exec-server` | 作为 Local Executor Supervisor 的第一候选 |
| `windows/helper.mjs:55–87` | 本机回环 gate、随机连接凭证、SSH `-R` 到远端回环入口 | 抽离为可复用传输；补齐授权/lease/并发/恢复验收 |
| `remote/device_server.py:80–88` | `environment/add` 指向 `execServerUrl`，随后查询环境 | 保存既有原生协议基线，目标版本重新验证 |
| `remote/device_server.py:150–175` | thread/start、resume、fork、turn/start 选择 execution environments / cwd | 抽离 session 与 execution binding；不固化本机项目路径 |
| `remote/device_server.py:202–208` | 启动官方 0.155.1 app-server，并开启 deferred executor | 固定历史对照版本；升级另做协议迁移测试 |
| `verify_native.mjs:23,38–44` | 真实 turn/start 与 commandExecution 监听、本机哨兵/主机信息验证 | 迁移测试意图，重新脱敏和生成独立测试环境 |

所有路径相对于 `<private-reference>/codex-device-workspaces`。上表是当前只读源码证据，不等于本轮启动过其中任一进程。

## 3. 历史验收证据

`VERIFICATION.json:3–10` 记录日期为 2026-09-22、官方 Codex 版本 0.155.1，记录了 pc1 / pc2 身份的真实 Windows 执行通过、pc1 workspace-write 通过，同时明确实际测试物理设备为 1 台。

`verification-device1.json:25` / `verification-device2.json:24` 的历史真实回合记录位于 **2026-09-23 02:51–02:55 JST**，完成状态无错误，保存的摘要包含 Windows 哨兵、系统/主机信息。时间与日期应按原记录区分，不能只看总表日期。

证据强度与边界：

- 可以说：已有实现链，且有真实模型驱动本机执行的历史通过记录；不只是 UI 或文件面板协议测试。
- 不可以说：两台物理设备已验收；记录中的两个身份不等于两台实际机器。
- 保存的回合是 summary 视图，没有完整原生 commandExecution 原始事件归档；测试源码确有监听，但不能把源码存在当当前重跑成功。
- 当前完成态不证明所有工具、子 Agent、hooks、图像、取消、恢复与最新 CLI 版本都通过。
- Win32 内嵌助手/悬浮层测试只证明显示层，与原生执行工具链分别记录。

## 4. 应复用与应剥离

应优先复用设计与接口经验：官方本机执行服务监督、SSH 回环传输、环境注册、稳定项目/执行绑定、Windows 路径兼容和已有原生测试用例。

应剥离旧宿主耦合：Codex 桌面启动入口替换、插件开关轮询、内嵌 Win32 账号助手、固定设备编号、固定远端路径/版本、特定客户端的文件面板补丁。新产品拥有自己的窗口和进程入口，不需要继续依附这些 UI 扩展点。

不能把当前硬编码 0.155.1 当长期支持策略。新项目需冻结可复现组合，再对新版 schema 与执行接口做差异测试；现有 exec-server/environment 接口与当前文档 Code Mode host 不先假设等价。

## 5. 认证与执行分开看

旧方案另有 VPS 账号 broker（`remote/device_server.py:34,65–71`），并通过 Codex 官方 `chatgptAuthTokens` 接入 app-server；这仍发生在远端，**不等同于在本地框架使用 SDK 登录，也不能因此称执行链非原生**。

新项目的首期原则仍是 VPS 原生登录，桌面不提取或持有模型 token。默认设计采用 CLI 管理的远端 profile；旧远端 broker 是否保留、如何隔离与刷新是单独的 Codex 专属决策，不能直接套用到 Claude，也不能为了接管旧环境强制清空原生账号或重新授权。

这部分只做架构分解，不改变既有账号管理或凭据。若后续保留远端凭据服务，应明确它与本机 UI/执行器的信任边界，并单独维护决策记录。

## 6. 下一轮最小验证范围

v0.2说明：以下是Codex分支内部的验证顺序，不是项目总体排期；总体先独立翻译，再Claude主线与环境保险，最后迁移Codex链，见 [路线图](06-validation-and-roadmap.md)。

1. 在独立测试配置中复现已通过的原生 Windows 命令/文件用例，不触碰现有运行任务。
2. 证明新的自有 UI 可以直接驱动同一原生链，不依赖官方桌面私有窗口入口。
3. 补齐原生补丁、PTY、图像、子 Agent、权限、断线/取消/恢复与路径绑定。
4. 对用户现有 1 管理员 + 3 用户级环境做只读发现适配设计；实际接入另行授权。
5. Claude 基于更新后的原生 CLI 单独确认工具宿主/协议，不把 Codex 成果当跨家证明。
