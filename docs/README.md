# 文档导航

本目录收录 AgentWorkbench 的需求、架构、开发接口、研究来源和验收记录。它不是纯粹的现行开发手册：早期方案、外部环境维护记录和历史验证快照也保留在这里，下面按用途区分。

[回复内交互展示](inline-visualizations-20260930.md)：展示协议、插件接线与隔离验收。

## 从哪里开始

1. [项目首页](../README.md)：运行方式与产品范围。
2. [项目协作规则](../AGENTS.md)：当前实施、权限、接口和提交要求。
3. [开发与验证](18-development-and-dependencies.md)、[仓库地图](09-repository-map.md)：源码入口与验证方式。
4. [需求登记表](requirements.json)、[实现与验收记录](16-implementation-status.md)：稳定需求编号、实现情况与未验证范围。
5. [UI preference persistence inventory](37-ui-state-persistence.md): adjustable nodes, transient exclusions, user-profile and release boundaries.
6. [工作台插件 API](36-workbench-plugin-api.md)：插件能调用、扩展和替换什么，以及接口契约和验证范围。

需求不是完成证明。实现状态按文档 16 中各条目的观测日期和范围阅读；同一功能的后续修订优先。历史记录中的“当前”“本次”仅指该条记录当时，不能自动解释为最新版本或现行部署状态。

[防御性设计旧总览](defensive-design-audit-20261003.md)：原 100 个归并主题，保留原编号，不代表完整清单。

[防御性设计逐点源码台账](defensive-design-point-ledger-20261003.md)：无条数上限的控制点扫描、文件覆盖、必要性初判及逐点审批方法。

[防御性设计补充人工审阅](defensive-design-supplement-20261003.md)：旧总览未单列行为的触发条件、影响及建议。

[134 项防御设计体验优化进度](defensive-ux-progress-20261003.md)：用户已授权的顺序、逐项实施结果和验证边界。

## 现行开发与功能专题

| 文档 | 内容 |
| --- | --- |
| [近期功能插件适配审计](plugin-feature-audit-20260929.md) | 十二个提交的生产扩展路径、字体注册与具名界面修复、逐次变更完成门槛 |
| [插件预开源审计](plugin-preopen-audit-20260929.md) | 兼容风险、独立恢复、安全模式、人工修复草稿、公开树与发行前缺口 |
| [07 · 研究来源](07-research-sources.md) | 官方来源、版本化协议证据、私有历史参考与未确认项 |
| [09 · 仓库地图](09-repository-map.md) | 实际模块目录及维护责任 |
| [13 · 翻译模块](13-translation-module.md) | 独立翻译、输入预览、公开输出与失败边界；包含设计演进 |
| [16 · 实现与验收](16-implementation-status.md) | 按日期保留的实现记录和分层验证结果 |
| [17 · 原生适配证据](17-native-adapter-evidence.md) | 固定版本协议与原生执行证据 |
| [18 · 开发环境](18-development-and-dependencies.md) | 安装、依赖、验证和文档检查 |
| [19 · 共享记忆与技能](19-shared-memory-and-skills.md) | 早期共享方案和迁移说明；现行原生方案见 35 |
| [20 · 远端认证](20-remote-authentication.md) | 原生认证边界；后续管理流程见远端管理专题 |
| [21 · 工作空间管理](21-workspace-administration.md) | SSH 接入、空间、设备、邀请和生命周期 |
| [22 · 原生协作研究](22-native-collaboration-research.md) | 两家运行时协作差异、版本证据与未验证项 |
| [23 · 远程方案比较](23-paseo-remote-comparison.md) | 公开项目比较，不引入其代码或部署依赖 |
| [24 · Codex 原生运行](24-codex-live-runtime.md) | 特定版本、绑定与测试范围内的原生执行记录 |
| [35 · 原生记忆、技能与插件](35-native-memory-skills-plugins.md) | 当前原生资源管理、记忆交接和本机控制 |
| [36 · 工作台插件 API](36-workbench-plugin-api.md) | ZIP 扩展契约、服务目录、覆盖矩阵与生命周期 |
| [账号与运行时边界](account-runtime-boundaries.md) | 原生账号、共享授权与执行绑定 |
| [订阅使用边界](claude-usage-safety-20260926.md) | 工程保护和未覆盖范围，不作账号风险保证 |
| [模型 API 连接](model-api-connections.md) | 模型来源、映射与原生运行时接入 |
| [原生交互](native-interactions-20260927.md) | 提问、审批、MCP 交互及官方升级适配 |
| [会话 UI 与模型窗口](conversation-ui-20260928.md) | 审批规则、分页、Markdown、手动恢复及实际模型容量 |
| [远端管理](remote-management-20260927.md) | 远端 CLI、账号、浏览器及部署边界 |
| [会话阅读与后台任务](runtime-reading-20260927.md) | 原生公开活动、子会话与后台任务阅读 |
| [聊天检索与来源标记](chat-tools-20260928.md) | 模型聊天目录、公开历史、协作来源与插件查询接口 |
| [会话控制](session-controls-20260927.md) | 模型、权限和文件预览控制 |
| [侧栏与附件](sidebar-and-attachments.md) | 项目排序、会话移动、附件与隐私范围 |
| [requirements.json](requirements.json) | 机器可读的需求与验收条件；不保存私有聊天标识 |

## 未来方案（尚未开发）

| 文档 | 规划范围 |
| --- | --- |
| [37 · 内置协作插件](37-agent-team-collaboration-plugin.md) | 项目持久团队、用户控制的团队会话、决策者管理下属会话、单聊委托、角色隔离及双策划与验收交付闭环；仅愿景和初步设计，不代表已实现 |

## 历史基线与参考记录

以下文档保留决策来由，不应按其旧完成状态或旧方案直接部署：

| 文档 | 历史范围 |
| --- | --- |
| [01 · 产品与优先级](01-product-and-priorities.md) | v0.2 需求与阶段排序 |
| [02 · 架构](02-architecture.md) | 初始模块、执行模式与信任边界 |
| [03 · 运行时与模型](03-runtime-and-models.md) | 初始接入策略与能力研究 |
| [04 · SSH 与安全](04-ssh-and-security.md) | 初始 SSH、授权和隔离设计 |
| [05 · UX 与设置](05-ux-and-settings.md) | 初始交互方向；具体后续修订见功能专题 |
| [06 · 验证路线图](06-validation-and-roadmap.md) | 初始实验计划，不能替代已执行结果 |
| [08 · 决策记录](08-decisions-and-open-questions.md) | 初始决策及待定项，包含已被后续要求覆盖的方案 |
| [10 · Claude 环境维护记录](10-local-claude-update.md) | 历史测试设备的独立软件维护，不是工作台功能交付 |
| [11 · 工作空间发现](11-workspace-discovery.md) | 存量接入设计，现行实现见 21 |
| [12 · 既有 Codex 基线](12-existing-codex-native-baseline.md) | 仓库外实现的历史证据，不随本仓库分发 |
| [14 · 环境投影](14-environment-projection.md) | 已于 2026-09-26 取消的方案，仅供追溯 |
| [15 · Claude 桥候选](15-claude-native-bridge.md) | 候选方案与实验门槛，不是已完成承诺 |
| [控件视觉参考](assets/model-control-reference.png) | 裁剪的第三方界面参考，不表示工作台支持其中型号或全部能力 |

编号保留历史引用，不因中间编号空缺而重排。仓库内的 Markdown 和 JSON 是可维护源码；`build/qa/`、`build/reference/` 等路径是本地生成证据的位置，不属于公开仓库附件。

## 公开文档维护

- 新增或修改功能必须提供可调用、可扩展、可替换的开发接口，并同步更新文档 36 的参数、返回、事件、错误、权限、生命周期、兼容性、覆盖矩阵和验证入口。不能仅把缺口记入文档作为完成，也不能以 UI 按钮或内部函数存在代替插件支持。
- 新文档加入本页；引用仓库文件使用相对链接。保留版本、日期、需求编号及验证层级，避免未加日期的“最新”“全部通过”。
- 示例使用 `<project-root>`、`<user-home>`、`<private-evidence>` 等明确占位符。占位符不可直接执行；可运行示例应使用运行时环境变量或合成测试目录。
- 不提交账号、地址、主机/设备身份、公钥指纹、私有聊天 ID、个人绝对路径、凭据、Cookie、完整聊天或未经检查的截图。公开 URL 的来源信息和发布二进制摘要可以保留；私有参考注明未分发，不伪造公开来源。
- 执行 `npm run check:docs`，再审查差异与新增图片。该检查覆盖文档导航、本地链接、常见隐私模式和宿主方法目录漂移，不能证明不存在全部形式的敏感信息，也不验证第三方网页当前内容。
- 当前文档与 Git 历史分别检查。既有 4 个本地分支的历史已于 2026-09-28 按明确授权完成脱敏和旧对象清理，详细范围见 [实现记录](16-implementation-status.md)。新提交、二进制、图片和实际发行包仍须继续审查；未经新授权，不再次重写历史或推送。


<!-- native-event-audit:start -->
- [原生事件接收、处理与未知事件兼容审计](native-event-audit-20260929.md)
<!-- native-event-audit:end -->

- [38 · Desktop distribution](38-desktop-distribution.md): push-triggered Pages update feed, stable bootstrap, package trust and verification.
