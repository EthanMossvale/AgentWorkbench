# Paseo 远端架构对照

> 功能与验证专题；事实仅适用于正文注明的版本、日期与验证层级。当前综合状态见 [文档 16](16-implementation-status.md)。 [文档导航](README.md)

核对日期：2026-09-26 JST。只读核对 `getpaseo/paseo` 提交 `8cd989529e2d86bb6d1c8a775bf695fa5970c997` 的文档与适配器源码，没有安装或运行 Paseo，没有复制其实现，也没有调用真实模型。

## 架构结论

两者都复用原生代理程序，但远端连接的含义不同。

| 项目 | Paseo | AgentWorkbench 当前方向与状态 |
|---|---|---|
| 界面连接 | 客户端通过 WebSocket、SSH 隧道或加密 relay 连接 daemon | 本机 Electron 通过 SSH 接入 VPS 成员身份 |
| CLI 和文件工具 | daemon 在哪台设备，CLI 默认就在该设备运行并操作其工作目录 | 目标为 VPS CLI/模型请求 + 本机工具/文件；真实完整 H 链仍未验收 |
| SSH | 隧道通向已运行的 daemon；不负责安装、启动远端服务 | 同时用于空间发现、环境采集、账号公开目录、设备登记；未来原生工具传输须独立验收 |
| Claude | Agent SDK `0.3.246`，指定已安装的 `claude` 可执行文件和 daemon 的 cwd | 原生 CLI stream-json 适配；没有照搬 SDK 登录或自建 Agent 循环 |
| Codex | 启动官方 `codex app-server`，stdio JSON-RPC | 也是 app-server 合同，但固定 `0.155.1`；另有本机 exec-server/deferred executor 跨设备基线，尚未接通主应用 |
| 环境 | 原生工具看到 daemon 所在的真实环境 | SSH 选择后自动采集远端允许字段；本机工具保留真实环境与结果，不宣称投影等于强隔离 |

所以，Paseo 可以证明“远程控制官方代理程序”是现实的产品架构；它不能证明我们的 Linux VPS → Windows 工具执行链已实现，也不能替代这条链的文件、进程、取消、身份和网络出口验证。

## 账号与风控事实

Paseo 的公开 Claude 文档说它使用用户已登录的 Claude CLI，消耗原计划额度；Codex 文档说可以使用 CLI 的 ChatGPT 登录或 API key。这些是项目方说明，不是厂商对该项目的批准或账户风控统计。此次检视的资料没有提供“从未被风控”的可验证证据。

Anthropic 当前官方说明允许平台托管原版 Claude Code，要求保留原生认证方式、每个最终用户用自己的凭据、直接向厂商结算；同时区分普通原生使用和开发者代用户中转订阅凭据的产品。不得由工作台收集、存储或中转 Claude.ai 会话 token。个人自己的 VPS、自己的文件和本机工具之间使用 SSH，没有在这些公开说明中被列为单独禁止的动作；这不构成特定账号不会被检查的保证。

OpenAI 官方将 app-server 明确定位为自有产品深度集成接口，涵盖认证、历史、审批和事件流。公开文档支持这一集成方向；不意味着任何凭据共享方式或调用模式均获豁免。

源码还有一处不能用来作合规证明的细节：该 Paseo 版本为 Codex initialize 指定保留 client name `codex_app_server_daemon`，注释说明目的是保留 CLI 的 usage originator。AgentWorkbench 继续使用自身的 `agent_workbench` clientInfo，不把这种标识处理当成免风控技术。

本轮采用的方案 2 是保留本机 PowerShell/Python/Blender 等真实工具能力，自动提供选定 VPS 的环境资料，不额外盘点宿主，也不改写工具结果伪造设备信息。工作台的环境说明不会承诺“任意本机脚本只能看到 VPS 信息”。

## 一手来源

- [Paseo architecture](https://github.com/getpaseo/paseo/blob/8cd989529e2d86bb6d1c8a775bf695fa5970c997/docs/architecture.md)：daemon、CLI 位置与客户端传输。
- [Paseo connectivity](https://github.com/getpaseo/paseo/blob/8cd989529e2d86bb6d1c8a775bf695fa5970c997/public-docs/connectivity.md)：SSH 仅连接已运行 daemon，cwd 是远端路径。
- [Paseo Claude provider](https://github.com/getpaseo/paseo/blob/8cd989529e2d86bb6d1c8a775bf695fa5970c997/packages/server/src/server/agent/providers/claude/agent.ts)：Agent SDK、`pathToClaudeCodeExecutable`、cwd 和权限选项。
- [Paseo Codex provider](https://github.com/getpaseo/paseo/blob/8cd989529e2d86bb6d1c8a775bf695fa5970c997/packages/server/src/server/agent/providers/codex-app-server-agent.ts)：`spawnAppServer`、JSON-RPC 与 clientInfo。
- [Paseo Claude 使用说明](https://github.com/getpaseo/paseo/blob/8cd989529e2d86bb6d1c8a775bf695fa5970c997/public-docs/claude-code.md)、[Codex 使用说明](https://github.com/getpaseo/paseo/blob/8cd989529e2d86bb6d1c8a775bf695fa5970c997/public-docs/codex.md)。
- [Anthropic legal and compliance](https://code.claude.com/docs/en/legal-and-compliance)：托管原版 Claude Code、用户自身认证和产品接入边界。
- [Anthropic Remote Control](https://code.claude.com/docs/en/remote-control)、[devcontainers](https://code.claude.com/docs/en/devcontainer)：远程控制和容器部署，不等于通用跨主机工具转发。
- [OpenAI Codex app-server](https://developers.openai.com/codex/app-server/)、[authentication](https://developers.openai.com/codex/auth/)：官方客户端集成与原生认证。

Paseo 顶层 LICENSE 在此提交为 Apache-2.0，第三方组件保留各自许可。本轮仅作架构参考；未来引入代码仍需逐文件核查。
