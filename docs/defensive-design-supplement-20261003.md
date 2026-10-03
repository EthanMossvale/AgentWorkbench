# 防御性设计补充人工审阅（2026-10-03）

这是旧总览未单列行为的补充，按必要性从低到高排列。编号延续 D101 起，但编号不是必要性顺序。每项均待审批，建议不代表批准。

本表不是完整审计完成声明。源码位置总台账还包含待核实候选；不得把语法命中数当成独立防御设计数。定位及复现方法见[逐点台账说明](defensive-design-point-ledger-20261003.md)。

| 编号 | 设计与现状 | 判断与影响 | 源码 |
| --- | --- | --- | --- |
| D101 | **字体发现异常永久缓存为不可用**。发现异常被转换为 undefined 并缓存，除非显式 refresh，否则后续沿用失败结果。 | 建议取消失败结果缓存，并展示可重试原因。 可恢复临时读取失败；成功资源缓存仍可保留。 | [apps/desktop/host/claude-reference-font.ts:32](../apps/desktop/host/claude-reference-font.ts#L32) |
| D102 | **字体读取错误统一变成不可用**。文件不存在、格式错误、权限失败等都转成同一错误。 | 建议改成具体诊断，取消整段错误信息覆盖。 需要字段级脱敏，不能将无效字体当作有效内容返回。 | [apps/desktop/host/claude-reference-font.ts:44](../apps/desktop/host/claude-reference-font.ts#L44) |
| D103 | **字体协议异常一律返回 404**。解析或读取失败统一返回 404，无原始故障区别。 | 建议区分不存在、格式不支持和读取故障。 只改变诊断语义，不扩大协议可读路径。 | [apps/desktop/host/claude-reference-font.ts:62](../apps/desktop/host/claude-reference-font.ts#L62) |
| D104 | **安装过程中禁止关闭窗口**。从清单下载到安装子进程退出，窗口关闭被直接取消。 | 建议替换为明确取消下载或说明安装进程仍在运行。 不能只删判断：关闭后下载和安装子进程的归属必须明确。 | [scripts/installer/Bootstrap.cs:25](../scripts/installer/Bootstrap.cs#L25) |
| D105 | **安装器失败只保留阶段名**。网络、格式、校验、启动和退出失败都隐藏异常细节。 | 建议保留具体错误与诊断记录。 不改变失败即停止安装的行为。 | [scripts/installer/Bootstrap.cs:66](../scripts/installer/Bootstrap.cs#L66) |
| D106 | **登录方式探测抛错统一标成不可用**。availability 抛错时丢弃异常，界面只能看到通用不可用原因。 | 建议保留诊断并允许用户主动重新探测。 不能据此绕过提供方真实的不可用状态。 | [packages/model-management/access-registry.ts:43](../packages/model-management/access-registry.ts#L43) |
| D107 | **SSH 诊断只跨界传递固定文本**。SshReadError 只提供固定诊断文本和码。 | 建议补充经字段脱敏的底层原因，取消整段信息屏蔽。 不能把账号、令牌或任意原始日志直接展示。 | [packages/ssh-transport/read-only.ts:8](../packages/ssh-transport/read-only.ts#L8) |
| D108 | **字体 CSS 扫描仅取前 1000 个**。按名称排序后只读取前 1000 个 CSS 文件。 | 建议取消硬截断或分页继续。 安装包资源增多时可能发现不到实际字体。 | [apps/desktop/host/claude-reference-font.ts:18](../apps/desktop/host/claude-reference-font.ts#L18) |
| D109 | **字体 CSS 单文件超过 4 MiB 跳过**。超阈值直接跳过 CSS。 | 建议流式解析或可配置，避免静默跳过。 放宽会增加解析量；与字体文件大小不是同一限制。 | [apps/desktop/host/claude-reference-font.ts:20](../apps/desktop/host/claude-reference-font.ts#L20) |
| D110 | **字体 CSS 总读取超过 20 MiB 中止**。累计大小超限后停止后续文件扫描。 | 建议提供继续扫描或按真实资源索引查找。 要单独说明扫描未完成，不应等同于未安装。 | [apps/desktop/host/claude-reference-font.ts:20](../apps/desktop/host/claude-reference-font.ts#L20) |
| D111 | **字体资源最多 5 MiB**。发现与读取都拒绝超过 5 MiB 的字体。 | 建议阈值可配置；真实格式校验独立保留。 可能影响内存占用，不应删除 WOFF2 结构识别来放宽大小。 | [apps/desktop/host/claude-reference-font.ts:6](../apps/desktop/host/claude-reference-font.ts#L6) |
| D112 | **字体仅匹配固定 CSS 家族与资产路径**。仅识别 anthropic-serif 及 /assets/v1/ 下受限名称的 woff2 路径。 | 建议按实际 CSS URL 与字体声明解析，减少布局变动造成的失效。 需要支持解析，不能只去掉正则后把任意字符串当文件名。 | [apps/desktop/host/claude-reference-font.ts:24](../apps/desktop/host/claude-reference-font.ts#L24) |
| D113 | **字体发现只支持 Windows Appx**。其它系统直接返回；Windows 只从 Get-AppxPackage 查 Claude。 | 建议扩展实际安装渠道发现；这属于兼容性缺口而非权限。 没有字体资源的环境仍需说明不可用。 | [apps/desktop/host/claude-reference-font.ts:49](../apps/desktop/host/claude-reference-font.ts#L49) |
| D114 | **字体定位子进程 8 秒及 64 KiB 限额**。PowerShell 探测超时或输出过量会失败，发现层会隐藏错误。 | 建议分别设置可调超时与明确溢出诊断。 不应无限挂起探测；错误可恢复性与阈值分开审批。 | [apps/desktop/host/claude-reference-font.ts:51](../apps/desktop/host/claude-reference-font.ts#L51) |
| D115 | **安装器拒绝 HTTP 重定向**。更新源返回重定向时不能继续下载。 | 建议支持已声明的更新源迁移，或明确报告重定向目标。 不能在未核实来源时把校验和下载一起绕过。 | [scripts/installer/Bootstrap.cs:33](../scripts/installer/Bootstrap.cs#L33) |
| D116 | **安装器网络请求 20 分钟超时**。HttpClient 设置 20 分钟超时；流读取阶段仍取决于具体 API 行为。 | 建议可配置且提供取消；不要把它误报为整个安装事务的统一超时。 慢速网络会受影响，需分别验证头部与流读取超时。 | [scripts/installer/Bootstrap.cs:34](../scripts/installer/Bootstrap.cs#L34) |
| D117 | **安装清单 16384 字符限制**。清单完整下载成字符串之后才检查字符数，不是下载字节上限。 | 建议根据结构和实际字段校验，取消无必要字符限制。 扩大清单不应同时放宽包完整性校验。 | [scripts/installer/Bootstrap.cs:36](../scripts/installer/Bootstrap.cs#L36) |
| D118 | **安装包只接受三段纯数字文件名**。文件名仅接受数字.数字.数字.exe，不支持预发布后缀等。 | 建议将版本兼容性与路径合法性分开，支持正式定义的版本命名。 拒绝路径穿越仍需保留，不能无条件拼接任意清单路径。 | [scripts/installer/Bootstrap.cs:40](../scripts/installer/Bootstrap.cs#L40) |
| D119 | **安装包最多 800 MiB**。安装清单声明大小大于 800 MiB 即拒绝。 | 建议按磁盘空间和实际发布包处理，放宽固定上限。 真实接收大小与清单一致的检查另行保留。 | [scripts/installer/Bootstrap.cs:40](../scripts/installer/Bootstrap.cs#L40) |
| D120 | **登录扩展名称与说明长度限制**。显示名限制 100 字符，说明限制 500 字符，并拒绝控制字符。 | 建议将显示长度和标识符合法性拆开，文本改为展示裁剪。 控制字符和稳定 ID 要单独评估，不能把整行条件全删。 | [packages/model-management/access-registry.ts:30](../packages/model-management/access-registry.ts#L30) |
| D121 | **只读 SSH 握手超时只重试一次**。仅首轮未收到握手 banner 且期限剩余超过 500ms 时，等待 250ms 后重试一次。 | 建议保留有限只读重试；不得推广到写入或模型任务。 它证明尚未发远端命令，删除重试会降低临时网络故障恢复能力。 | [packages/ssh-transport/read-only.ts:22](../packages/ssh-transport/read-only.ts#L22) |
| D122 | **只读 SSH 重试共用原期限**。默认 30 秒，并将剩余时间传入每次 runner，不为重试重置时钟。 | 建议保留共用期限；默认值可另批为可配置。 避免重试无限延长调用；当前调用方可设置 timeoutMs。 | [packages/ssh-transport/read-only.ts:13](../packages/ssh-transport/read-only.ts#L13) |
| D123 | **字体魔数与最小大小核验**。字体至少 48 字节且必须含 WOFF2 魔数；这不是完整字体解码校验。 | 建议保留真实类型识别；支持新格式时补解码适配。 删除后可能给字体渲染器返回任意非字体数据。 | [apps/desktop/host/claude-reference-font.ts:42](../apps/desktop/host/claude-reference-font.ts#L42) |
| D124 | **字体协议仅暴露两个资源**。仅接受固定 host 与两个路径，并拒绝端口、查询、片段和认证字段。 | 建议保留资源协议范围；新增资源用明确注册入口。 这是专用资源读取契约，不能当作普通文件浏览的目录黑名单。 | [apps/desktop/host/claude-reference-font.ts:59](../apps/desktop/host/claude-reference-font.ts#L59) |
| D125 | **托盘失败后允许窗口关闭退出**。托盘初始化失败会清理残留实例；关闭窗口不再隐藏到不可用托盘。 | 建议保留降级；补充错误展示可另批。 取消此降级可能让窗口隐藏后无法恢复。 | [apps/desktop/host/tray.ts:30](../apps/desktop/host/tray.ts#L30) |
| D126 | **退出清理只运行一次**。重复 before-quit 事件不会再次调用 dispose。 | 建议保留幂等保护。 避免重复取消任务或重复清理资源。 | [apps/desktop/host/tray.ts:36](../apps/desktop/host/tray.ts#L36) |
| D127 | **退出清理失败后仍退出**。dispose 拒绝后仍进入 finally 并退出；远端清理不被冒认为确认成功。 | 建议保留可退出性，并保留未确认清理的诊断。 改成硬阻止退出会造成用户无法关闭；不能清除未知执行状态。 | [apps/desktop/host/tray.ts:39](../apps/desktop/host/tray.ts#L39) |
| D128 | **安装器拒绝并行安装**。同一窗口安装尚在进行时忽略再次触发。 | 建议保留防重复安装。 不同于禁止关窗口，是防止两个安装过程同时写入。 | [scripts/installer/Bootstrap.cs:28](../scripts/installer/Bootstrap.cs#L28) |
| D129 | **安装下载逐段核对总大小**。超出清单大小立即停止，结束时也检查实际大小一致。 | 建议保留数据完整性检查。 取消后可能启动截断或与清单不一致的文件。 | [scripts/installer/Bootstrap.cs:50](../scripts/installer/Bootstrap.cs#L50) |
| D130 | **安装包 SHA-512 校验**。哈希与清单不一致即停止；清单也要求摘要解码为 64 字节。 | 建议保留完整性核验；不将其宣称为清单的独立数字签名。 只能证明与所读清单一致，不能单独证明发行者身份。 | [scripts/installer/Bootstrap.cs:58](../scripts/installer/Bootstrap.cs#L58) |
| D131 | **登录扩展停用后取消迟到的登录句柄**。插件等待 start 返回期间已停用时，取消新返回的句柄且拒绝发布。 | 建议保留失效生命周期约束。 否则停用插件仍可能在后台继续登录。 | [packages/model-management/access-registry.ts:55](../packages/model-management/access-registry.ts#L55) |
| D132 | **登录取消过程只执行一次**。对同一个句柄重复取消共用同一 Promise。 | 建议保留防重复取消。 避免调用底层取消多次及终态竞争。 | [packages/model-management/access-registry.ts:57](../packages/model-management/access-registry.ts#L57) |
| D133 | **取消登录后清除一次性 URL 和 code**。取消或失败后移除 URL、userCode 与交互标志，任务进入终态。 | 建议保留过期登录信息清理。 否则界面可能让用户继续使用已经失效的登录入口。 | [packages/model-management/access-registry.ts:57](../packages/model-management/access-registry.ts#L57) |
| D134 | **导入解析完成后再次检查扩展存活**。异步解析期间扩展被卸载时拒绝采用结果，并返回可供后续检查的存活断言。 | 建议保留迟到结果保护。 避免未批准/已停用解析器的结果继续写入账号。 | [packages/model-management/access-registry.ts:63](../packages/model-management/access-registry.ts#L63) |
