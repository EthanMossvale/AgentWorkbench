# 09 · 仓库与模块地图

本页描述当前源码结构；不再使用初始 docs-only 阶段的目录规划代替实际仓库。功能完成度见 [实现记录](16-implementation-status.md)，全部文档见 [导航](README.md)。

## 源码目录

| 目录 | 职责 |
| --- | --- |
| `apps/desktop/host/` | Electron 主进程、IPC 分发、工作台控制器、原生资源与本机服务装配 |
| `apps/desktop/renderer/` | React 界面、项目/会话、设置、阅读和插件界面宿主 |
| `packages/contracts/` | 工作台状态、会话、模型、权限与桥接类型 |
| `packages/plugins-core/` | ZIP 扩展、批准、全功能方法分发、服务注册/替换及生命周期 |
| `packages/translation/` | 独立翻译、输入预览、取消、配置和提供方协议 |
| `packages/session-core/`、`packages/collaboration-core/` | 会话绑定、权限、侧栏、协作与公开运行活动 |
| `packages/native-interactions/` | 原生提问、审批与回执生命周期 |
| `packages/model-api/`、`packages/runtime-codex/`、`packages/runtime-claude/` | 模型来源与两家原生协议适配 |
| `packages/native-memory/`、`packages/native-skills/`、`packages/native-plugins/`、`packages/native-runtime/`、`packages/native-resources/` | 原生资源、CLI 维护、归档和配置管理 |
| `packages/memory-core/`、`packages/skills-core/` | 旧共享资料兼容与公共上下文工具；不代表另建记忆引擎 |
| `packages/attachments/`、`packages/navigation/` | 附件快照、路径与导航 |
| `packages/account-selection/`、`packages/account-usage/`、`packages/remote-account-catalog/`、`packages/remote-codex-auth/` | 账号选择、额度及远端原生账号操作 |
| `packages/ssh-transport/`、`packages/workspace-control/` | SSH 传输、成员身份、工作空间和控制协议 |
| `services/codex-bridge/`、`services/local-executor/`、`services/remote-supervisor/` | 原生执行桥、本机执行和远端监督 |
| `services/host-control/`、`services/owner-file-service/` | 管理控制与同 owner 普通文件访问 |
| `services/vps-account-broker/`、`services/vps-workspace-control/`、`services/vps-browser/` | 独立远端服务源码；存在源码不等于已部署 |
| `services/environment-profile/`、`services/environment-runtime/` | 历史环境方案及兼容代码；不得据目录存在恢复已取消的环境模拟 |
| `examples/plugins/` | 可独立打包的主题、宿主、完整界面及开发 API 示例 |
| `tests/`、`scripts/` | 单元/协议回归、构建、隔离桌面验证与文档检查 |
| `docs/` | 需求、公开研究来源、开发契约、历史设计和验收记录 |

## 仓库边界

`node_modules/`、`dist/`、`build/` 和运行数据是本地依赖、产物或证据，不作为源码提交。公开文档中的 `<project-root>`、`<user-home>`、`<private-reference>`、`<private-evidence>` 是占位符，不是仓库内真实目录或可直接执行路径。

## 变更入口

1. 功能要求与验收条件登记到 `requirements.json`，实施结果更新文档 16。
2. 新功能必须接入受支持的开发接口；宿主方法、服务替换、界面挂载及示例同步更新 [插件 API](36-workbench-plugin-api.md)。
3. 公开事实与原生版本证据维护到文档 07；新文档加入本目录导航。
4. 修改相关代码后运行相应测试；文档与接口目录执行 `npm run check:docs`。提交规则见根目录 `AGENTS.md`。
