# 近期功能的第三方插件适配审计（2026-09-29 UTC）

## 范围与结论

冻结范围为 `42daed7`、`38288f7`、`4def00f`、`8fee0f2`、`6832920`、`5b7756d`、`46717ec`、`3cc4b95`、`a5d72d9`、`0a47b40`、`49229d7`、`43d4165` 共 12 个已提交变更，覆盖近期界面、原生计划、远端管理、记忆、翻译、插件恢复、模型账号、侧栏和外观。其他窗口之后提交的问答等工作可成为本次集成基础，但不因此视作逐项审计通过；尚未提交的图片/附件工作不纳入本次提交。

上一版把样式覆盖当成主题预设适配，漏掉了“注册后出现在选择器并进入实际渲染”。主题注册已在 `43d4165` 修复，本轮再次核查时还发现字体目录和公开 UI 定位存在相同风险。本轮补实现与验证，不仅加强文字约定。用户给定参考要求紧凑主题菜单；预设常驻卡片网格已纠正为单行分组菜单。

## 逐项覆盖与处理

| 变更 | 调用、扩展与替换的实际路径 | 本轮结论与证据入口 |
| --- | --- | --- |
| `43d4165` 主题与代码着色 | `api.themes` 注册目录 → ThemePresets/useAppearance；`api.syntax` → 实际正文/预览 | 注册、保留选择、停用恢复已贯通；本次菜单变更继续使用同一目录，真实批准 ZIP 回归 |
| `49229d7` 字体与外观 | `appearance/get/set/fonts`、`appearance.reference-fonts`；字体覆盖原来没有贡献目录 | **补齐 `api.fonts`**，UI/正文/代码三个选择器和渲染共同订阅；保留缺失 ID、失败清理，见 appearance-fonts 与 appearance UI 测试 |
| `0a47b40` 侧栏手动排序 | `session/reorder` → `sidebar.order.reorder/observe` → StateStore；sidebar surface | 已有服务替换；一小时门限是内置策略而非要求第三方修改源码。既有边界测试和本轮批准 ZIP 实测 |
| `a5d72d9` 本机账号、模型与用量 | `models/accounts/*`、`models/usage`、`models/pricing/save` → 真实 models.accounts 服务；已有动态 runtime/model-target 目录 | 账号凭据仍属于原生渠道，不能靠新增 provider 标签伪造官方认证；第三方运行时沿用注册适配器。补 model-accounts/model-usage 具名 surface；模型测试和批准 ZIP 路径 |
| `3cc4b95` 兼容和恢复 | services 版本、requires、recovery API、独立恢复进程；已有失败隔离 | 不另建恢复入口；扩充门禁遗漏的公开 surface / coreSettingsTabs 值和近期数据类型，仍需行为验收 |
| `46717ec` 翻译临时开关 | `translation/quick-toggle` → 串行配置与真实 translation 服务 → composer 可见性 | 保留原生取消代次与设置合并；补 translation-toggle 具名 surface。翻译测试及批准 ZIP 保存/停用回读 |
| `5b7756d` 记忆回执、进程收尾 | native.memory 的 verifyHandoff、native.memory-background.registerExecutor → 后台真实调度；ProcessSupervisor | 已有执行器注册与释放，新增任务/回执字段可选；memory-background、memory-receipts、memory-process-cleanup 行为回归。不是另开模型回合的授权 |
| `6832920` 远端 CLI 诊断 | remote-cli/list/plan/apply → actions.remote-cli；ReleaseIssue 可选投影 | 原调用/服务替换已贯通；补 remote-cli-row 具名多实例定位。诊断投影、维护控制器和批准 ZIP 合成适配器验证 |
| `8fee0f2` 连接分栏与文件即时交互 | remote-files/* → actions.remote-resources；缓存仅 renderer 目录元数据；已有 observeSurfaces | 原 `.connection-layout` 可替换，补 connection-layout/remote-files 稳定名称，真实 FileBrowser 生命周期测试改走具名入口；不提供绕过远端 revision 的写缓存 |
| `4def00f` 远端会话保留详情与日志 | remote-storage/inspect/logs、remote-cli/configure → actions.session-storage/remote-cli-policies | 调用、日志服务替换存在；补 session-retention 具名入口、批准 ZIP 真实路由停用恢复验证；不会为扩展 UI 自动启动清理 |
| `38288f7` 原生计划与翻译 | session/plan、plan/translate、session/plan/respond、session/collaboration → NativePlanFlow；plan-reader/plan-review surface | 已有细粒度宿主方法、translation 服务及具名视图；计划权限由实际原生运行时决定，不把任意自定义字符串当成可执行模式。plan-review/planning-modes 回归 |
| `42daed7` 连接页文案与紧凑布局 | 原账号、用量、CLI、浏览器宿主接口及 connections 设置替换 | 无新增业务选项或持久格式；此次新增连接及 CLI 等具名入口消除对私有层级的依赖，旧参数不变 |

## 开发规则与边界

[AGENTS.md](../AGENTS.md) 增加“每次变更的插件适配完成门槛”：实施前盘点调用/注册/替换三种需求，消费端共用目录，不接受 CSS、内部函数或完整 Node 权限作为单独证据；同一逻辑变更补接口、兼容/迁移、失败与停用恢复测试、开发文档和覆盖矩阵。纯样式/性能优化也须评估接口影响，不以“小改动”豁免。

[文档 36](36-workbench-plugin-api.md) 是本轮新增入口、类型、返回值、事件、错误、权限、生命周期、示例和迁移的契约。旧任意 DOM 选择器仍允许使用，但不能据此承诺私有 DOM 永远不变。契约门禁新增公开常量与近期类型，不是对所有内部服务语义或第三方组合的自动证明。

验证采用临时 StateStore、合成适配器、实际 ZIP 批准生命周期和独立隐藏 Electron；没有读取真实账号凭据、私钥或原生聊天数据库，不操作在用客户端，不连接 VPS，也不安装示例插件到用户环境。正式构建、完整回归和 UI 结果以 [本轮实现记录](16-implementation-status.md) 为准；远端发布诊断的真实网络行为、真实模型记忆质量和生产部署不在本次复验范围。
