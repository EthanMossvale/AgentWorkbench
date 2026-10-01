# 回复内交互展示（2026-09-30；U120）

## 实现前接口与状态审查

现有消息经 `MessageText` / `MarkdownContent` 渲染，HTML 仅在文件侧栏通过 `html/preview` 展示。本次增加明确的回复标记解析、隔离 HTML 展示和有界状态桥，不将普通 HTML 或代码示例变成可执行页面。

| 影响面 | 调用已有能力 | 注册新增实现 | 替换与释放 |
| --- | --- | --- | --- |
| 回复展示 | `api.visualizations.parse`、`read`、`render` | 带插件命名空间的 `registerRenderer` | 同一渲染器目录供实际控件选择；`replaces` 分层替换；句柄释放恢复 |
| 文件读取 / 页面创建 | `visualizations/read`、`visualizations/render`、`visualizations/release` | renderer 注册表消费读取结果 | 生产 `files.html-preview` 服务；精确页面释放 |
| 页面和工具条 | `visualization`、`visualization-toolbar` 具名 surface | 多实例 `observeSurfaces` | 既有异步清理、停用恢复约定 |
| 状态 / 选择 | `uiPreferences.get/set/reset` | 新增 `visualization.*` 明确键；插件具名 renderer | 偏好 override；缺失 renderer 保留选择并回退 |
| 运行时说明 | 英文展示契约随本次启动绑定 | 插件运行时可采用同一文本协议 | 不更改原生账户配置、不自动执行或续投 |

计划保存 renderer 选择、源码/预览模式和 iframe 主动提交的 JSON 快照；作用域为会话与引用路径。布局测量、loading、失败、重载次数、悬停和焦点为 transient 状态。页面内容仍属于原 HTML 文件；控件不调用状态桥时不能推断或保存其私有 JavaScript 变量。

## 验证记录

已实现共享 Markdown 展示标记、文件读取、隔离页面、主题切换、原文/译文/子会话消费，以及带修订检查的控件状态持久化。扩展目录贯通真实选择器和异步渲染，不安装示例到用户环境。模型说明通过本机两家原生启动、API 及既有 Codex SSH 桥提供，用户原消息不改写。

初始独立候选基于已提交基线，通过全套 1,443 项测试、零失败/跳过；全套使用仓库已核验 Codex 0.155.1 作为原生技能配置夹具。直接改用本机 Codex 0.159.0 跑全套时，既有 native-resources 技能配置写入测试报告 `NATIVE_CONFIG_REJECTED`；该不同版本的原生技能配置兼容问题不归本次展示修复，也未修改原生安装/配置。最初的能力说明过长触发小窗口 API 摘要回归，已改为 API 精简说明并通过原回归，未放松预算保护。

展示专项使用实际安装 Codex 0.159.0 和 Claude Code 2.1.284、临时原生目录、合成上游，8 个核心/批准插件/停用/重启用场景通过，确认英文说明进入实际原生请求且展示标记完整经过回复和生产 tokenizer。没有付费推理或真实用户聊天库读取。

隐藏生产 Electron 检查实际主回复/译文及两家子会话、鼠标/键盘、进程重启、源码模式、主题与窄屏、沙箱边界、真实批准 ZIP 注册/选择/替换、多实例、非后进先出释放、激活失败、异步迟到及包移除。截图只含合成数据，人工复核深浅色与窄屏。Playwright 父页点击不能正确路由隐藏窗口 iframe 的输入，改用 iframe 自己的 Chromium 输入通道，核验 `isTrusted` 点击与键盘 Enter；没有用直接调用按钮函数替代最终输入验收。

测试脚本：`scripts/test-visualizations-native.mjs`、`scripts/test-visualizations-ui.mjs`；定向单元/协议测试：`tests/visualizations.test.ts`、既有 Markdown/HTML/UI preferences 和 API 小上下文回归。类型、插件契约、公开文档、UI 偏好门禁均纳入同一变更。隔离构建不夹带用户配置；无新的依赖或许可证选择。

最终集成候选对齐已提交基线 `2b479bf`，保留此前合入的账号、运行中跟进和跨协议完成修复。全套 **1,480/1,480** 通过、零跳过；原生展示专项 **8/8**；重建后的隐藏生产 Electron **18/18**、无 renderer 错误。类型检查、插件契约（257 声明、291 宿主方法）、公开文档（46 文本文件、零发现）和偏好清单（41 键、42 hooks、39 原生节点）均通过。快照逐项审查仅增加展示声明、4 个命令和2个具名 surface，未移除旧声明或入口。其他窗口未提交的 surface 和文档改动保持独立，不列入上述验收范围。

集成时原生合成响应改用新基线要求的显式完成封套，仍核验一次请求、完整展示标记与零工具执行；没有放松产品完成条件。第一次并行回归在既有 native-resources 的进程清理处出现 `CLI_PROCESS_STATE_UNKNOWN`；该文件单独 13/13，随后独立运行全套 1,480/1,480 通过。保留失败日志，不将一次重跑推断为任意并发负载下的稳定性证明。

证据留在忽略的 `build/qa/visualizations` 和 `build/qa/visualizations-native`。这不证明前台用户桌面、实际安装升级、真实上游模型生成质量、远端部署或 Codex 全套可视化协议完全等价。活动客户端与正式 dist 未被覆盖或重启；现有页面依赖 CDN 时需要生成自包含内容。
