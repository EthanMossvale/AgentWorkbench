# 防御性设计源码审计与逐项审批（2026-10-03）

排序：必要性从低到高。共 **100 个审批项**，建议优先移除/取消硬拦截 16 项，建议放宽/可配置/补适配 49 项，建议保留 35 项。全部状态均为 **待审批**，建议不是批准。

审计起始基线：`b1e0e8d14f551a8d66c7db5ea284da48e77e7602`。读取当前工作区源码，包括开始时已存在的未提交 UI 改动；仓库存在并行变动，文件哈希以本次扫描快照为准。未改变任何产品运行逻辑、权限或设置，未连接 VPS、读取真实用户聊天/凭据，未做删除。

范围：478 个产品源码文件、42,342 行（apps/packages/services 中受版本控制的 TS/TSX/Python/HTML）；补扫 195 个开发/安装脚本、18,985 行。排除依赖、构建产物、测试资料和外部原生 CLI 内部实现。产品关键词/控制分支命中 5,195 行，脚本命中 1,326 行；命中数不是防御设计数。

方法：全目录静态扫描，人工阅读主要阻断入口、下游实现及错误语义，按可独立决策的行为归并。通用类型检查、局部 catch/fallback、UI busy/disabled 等归并在基础保护项，逐行自动命中另附本地证据索引。没有完成每个分支的动态可达性验证，不把旧适配器中的限制当作所有路径都启用，也不保证静态搜索穷尽全部隐式防御。纯样式尺寸和普通业务选择不算防御限制。

审批方法：回复 `D001 移除；D003 改提醒；D017 保留`。也可批量批准编号范围，但带“补适配”的项不能只删除判断。已确认保留的权限、完整性、防重复仍维持，除非你逐项另作决定。

本清单记录设计必要性的工程判断，不用“安全”作为默认保留理由。对于混合检查，明确区分可移除限制和应独立审批的真实权限/数据保护。上轮已移除的附件导入/预览目录黑名单不列为现存限制；另存为、生成图和 API 文件工具里的同类检查仍单独列出。

## 优先审批：建议移除或取消硬拦截

| 编号 | 当前设计 | 判断 | 审批 |
| --- | --- | --- | --- |
| [D001](#d001) | 输入译文含汉字即拒绝 | 建议移除此启发式硬拦截；专名及混合语言不是失败证据。 | 待审批 |
| [D002](#d002) | 未闭合代码围栏拒绝翻译 | 建议移除拒绝，原样保留该段；不应因 Markdown 编辑状态阻断任务。 | 待审批 |
| [D003](#d003) | 凭据关键词拒绝翻译 | 建议改为可选择的提醒；正则会误判代码示例和测试数据。 | 待审批 |
| [D004](#d004) | 完整访问仍逐次审批 API 命令 | 建议移除 full-access 的重复审批，与用户选择一致。 | 待审批 |
| [D005](#d005) | 低影响侧栏操作二次确认 | 建议取消这些可逆操作的二次确认，提供撤销。 | 待审批 |
| [D006](#d006) | 新聊天授权靠自然语言正则 | 建议移除词法判官，改用明确的用户动作或授权字段；意图正则易误判。 | 待审批 |
| [D007](#d007) | 原稿发送额外语言门槛 | 建议让明确的“发送原稿”动作直接表达同意，取消重复门槛。 | 待审批 |
| [D008](#d008) | 错误详情整段隐藏 | 建议删除整段吞错和错误归因，改为字段级脱敏。 | 待审批 |
| [D009](#d009) | 普通本机文件按目录名拒绝 | 建议移除目录名推断权限，真实身份权限另保留。 | 待审批 |
| [D010](#d010) | 图片生成目录黑名单 | 建议移除目录分类；保留写入原子性与身份绑定。 | 待审批 |
| [D011](#d011) | 图片另存为目录黑名单 | 建议移除目录名硬拒绝；用户已选择保存目标。 | 待审批 |
| [D012](#d012) | 账号导出目的目录禁区 | 建议移除整目录禁区，精确保护源认证文件即可。 | 待审批 |
| [D013](#d013) | 工作树根目录控制区限制 | 建议取消固定目录特例，保留仓库递归嵌套检查。 | 待审批 |
| [D014](#d014) | 官方技能禁止导出 | 建议取消来源标签限制；无实际源文件的内置技能仍无法导出。 | 待审批 |
| [D015](#d015) | 技能选择固定数量 | 建议移除产品层固定数量；若原生仅支持单技能须补多技能传递。 | 待审批 |
| [D016](#d016) | 预览补充最多十次 | 建议移除人为次数上限。 | 待审批 |

## 建议放宽、可配置或补适配

| 编号 | 当前设计 | 判断 | 审批 |
| --- | --- | --- | --- |
| [D017](#d017) | 本机浏览拒绝网络共享 | 建议提供网络路径支持或用户选择，不能把共享当设备路径。 | 待审批 |
| [D018](#d018) | 附件拒绝网络和特殊路径 | 建议拆开：普通 UNC 可放宽，设备流需单独支持。 | 待审批 |
| [D019](#d019) | 硬链接一律拒绝 | 建议只读取消；写入/删除按所有权与目标身份处理。 | 待审批 |
| [D020](#d020) | 本机文件预览大小和列表截断 | 建议分页和流式读取替代硬拒绝。 | 待审批 |
| [D021](#d021) | 文件搜索与插件定位预算 | 建议可调预算与继续搜索；保留歧义选择。 | 待审批 |
| [D022](#d022) | 附件数量和大小 | 建议可配置或按通道能力限制。 | 待审批 |
| [D023](#d023) | 图片像素及生成格式限制 | 建议像素阈值可配置，格式限制需增加解码支持。 | 待审批 |
| [D024](#d024) | API 本机工具读取限制 | 建议支持流式和二进制工具，放宽固定值。 | 待审批 |
| [D025](#d025) | API 命令时长与输出限额 | 建议改成可配置和输出落盘，不应因输出多杀任务。 | 待审批 |
| [D026](#d026) | API 模型循环硬上限 | 建议用户预算或可继续状态替代固定中断。 | 待审批 |
| [D027](#d027) | 上下文与摘要预算 | 建议按真实模型窗口与用户预算配置。 | 待审批 |
| [D028](#d028) | 模型思考档位白名单与检测门槛 | 建议区分手工透传与自动检测，取消手工值的额外猜测。 | 待审批 |
| [D029](#d029) | 翻译端点 URL 限制 | 建议把非凭据 URL 约束改为明确配置选项。 | 待审批 |
| [D030](#d030) | 翻译输出严格结束语义 | 建议只放宽可展示的部分译文，不能自动提交不完整结果。 | 待审批 |
| [D031](#d031) | 翻译容量、队列和响应上限 | 用户设定预算保留；硬编码队列/响应阈值可配置。 | 待审批 |
| [D032](#d032) | 原生流帧和网关大小上限 | 建议按工具负载调整并支持流式大结果。 | 待审批 |
| [D033](#d033) | Claude 本机工具白名单 | 建议目录自动发现实际工具；模型调用能力保持显式授权。 | 待审批 |
| [D034](#d034) | Claude 工具预算 | 建议配置和分页落盘替代固定失败。 | 待审批 |
| [D035](#d035) | Claude 异步命令预算 | 建议按用户设置，保留 requestId 去重。 | 待审批 |
| [D036](#d036) | 技能语法不支持即拒绝 | 建议补适配或交给原生执行；不应简单删判断。 | 待审批 |
| [D037](#d037) | 技能目录和文本扫描限额 | 建议分页和可调预算。 | 待审批 |
| [D038](#d038) | ZIP 容量及格式限制 | 建议扩展常见格式与大包，路径穿越和 CRC 校验独立保留。 | 待审批 |
| [D039](#d039) | 资源链接一律禁改禁导出 | 建议按操作区分只读导出与有副作用写入。 | 待审批 |
| [D040](#d040) | 插件容量上限 | 建议可配置，不应以小固定值限制已批准插件。 | 待审批 |
| [D041](#d041) | 插件激活和清理超时 | 建议按插件声明/配置，超时与故障隔离分开。 | 待审批 |
| [D042](#d042) | 插件守护不可用即安全模式 | 建议优先局部隔离并允许明确继续；兜底恢复本身有用。 | 待审批 |
| [D043](#d043) | HTML 预览禁网络和越目录资源 | 建议用户授权网络/资源范围，默认隔离保留。 | 待审批 |
| [D044](#d044) | HTML 页面与状态限额 | 建议可调与资源缓存，尤其累计字节按请求计数会重复计费。 | 待审批 |
| [D045](#d045) | 外部链接和登录网址限制 | 普通协议建议按用户动作开放，登录来源验证保留。 | 待审批 |
| [D046](#d046) | SSH 不继承配置与代理 | 建议显式支持用户选用现有 SSH 配置，避免强制覆盖。 | 待审批 |
| [D047](#d047) | API 命令精简环境及无 profile | 建议可选择真实本机环境，保护凭据注入边界。 | 待审批 |
| [D048](#d048) | SSH 请求时间输出预算 | 建议流式结果与按操作配置。 | 待审批 |
| [D049](#d049) | 固定 Codex 执行器版本 | 建议能力协商替代补丁版本锁；不能未经适配宣称兼容。 | 待审批 |
| [D050](#d050) | 协作队列与待发送上限 | 建议分页清理和可配容量。 | 待审批 |
| [D051](#d051) | 账号与登录任务固定容量 | 建议配置并清理终态任务。 | 待审批 |
| [D052](#d052) | 邀请有效期固定五档 | 建议允许自定义有效期；过期失效本身保留。 | 待审批 |
| [D053](#d053) | 远端文件特殊根与链接拒绝 | 普通链接建议可解析；虚拟设备根需要明确专用读法。 | 待审批 |
| [D054](#d054) | 远端文件操作容量 | 建议分页与分块传输。 | 待审批 |
| [D055](#d055) | 远端低内存新任务拦截 | 建议告警和用户可调策略，避免固定压力值替用户决定。 | 待审批 |
| [D056](#d056) | 远端磁盘余量拦截 | 建议可配阈值；保留无法可靠持久化时的明确失败。 | 待审批 |
| [D057](#d057) | 后台记忆容量与超时 | 建议可配预算；保留已核验进度才继续。 | 待审批 |
| [D058](#d058) | 链接记忆不参与同步 | 建议按真实路径去重后只读采集，写入保护另行保留。 | 待审批 |
| [D059](#d059) | 记忆格式/英语与标记要求 | 格式一致性保留；语言检测和大小上限可单独放宽。 | 待审批 |
| [D060](#d060) | 工作树快照和归档容量 | 建议按磁盘能力流式归档、配置容量。 | 待审批 |
| [D061](#d061) | 工作树复杂索引/链接不支持 | 建议补真实可恢复支持，不能删判断假装已备份。 | 待审批 |
| [D062](#d062) | 数据迁移路径形态限制 | 允许空目标或普通链接需独立实现；重叠根禁用有必要。 | 待审批 |
| [D063](#d063) | 远端浏览器环境与单实例限制 | 环境兼容性可扩展；忙时不可强占同一 profile。 | 待审批 |
| [D064](#d064) | 远端保留期与日志容量 | 建议用户可配保留期和日志容量。 | 待审批 |
| [D065](#d065) | UI 偏好存储容量 | 容量可配置；类型和并发修订保留。 | 待审批 |

## 建议保留：权限、完整性、明确授权与防重复

| 编号 | 当前设计 | 判断 | 审批 |
| --- | --- | --- | --- |
| [D066](#d066) | 翻译外发同意 | 建议保留一次明确设置，避免重复弹窗。 | 待审批 |
| [D067](#d067) | 登录凭据不得当 API key | 建议保留真实凭据类型边界；误判应精确修复。 | 待审批 |
| [D068](#d068) | 插件完整包批准和哈希 | 建议保留，这是代码执行授权。 | 待审批 |
| [D069](#d069) | 插件命名空间/兼容/释放 | 建议保留所有权与生命周期；纯版本限制可适配。 | 待审批 |
| [D070](#d070) | 插件故障隔离和独立恢复入口 | 建议保留恢复能力，自动全局停用策略由 前述对应 单独审批。 | 待审批 |
| [D071](#d071) | 破坏性动作二次确认 | 建议保留；可逆记录移除已另列。 | 待审批 |
| [D072](#d072) | 维护与任务准入互斥 | 建议保留活动资源互斥；不同资源可缩小锁范围。 | 待审批 |
| [D073](#d073) | 安装卸载身份/渠道核验 | 建议保留，扩展渠道通过明确适配。 | 待审批 |
| [D074](#d074) | 未知结果人工恢复 | 建议保留结果语义；恢复交互可简化。 | 待审批 |
| [D075](#d075) | 部分协议结果不执行工具 | 建议保留；兼容新事件需适配而非忽略。 | 待审批 |
| [D076](#d076) | 外层失败不自动续投 | 建议保留防重复收费/执行；用户手动重试可用。 | 待审批 |
| [D077](#d077) | 账号限流认证账单阻断 | 建议保留身份与可用性阻断，误报须修状态。 | 待审批 |
| [D078](#d078) | 真实本机与远端来源区分 | 建议保留来源证明，补远端传输而非映射错设备。 | 待审批 |
| [D079](#d079) | 浏览器与 IPC 隔离 | 建议保留，这是 renderer 到本机权限边界。 | 待审批 |
| [D080](#d080) | 本地网关认证及方法路由 | 建议保留；请求大小单列。 | 待审批 |
| [D081](#d081) | 文件真实 owner 与 grant | 建议保留，符合你已明确的权限范围。 | 待审批 |
| [D082](#d082) | 只读/计划模式执行边界 | 建议保留用户明确选择的权限语义。 | 待审批 |
| [D083](#d083) | 原生审批绑定真实请求 | 建议保留，展示层无需再叠同义审批。 | 待审批 |
| [D084](#d084) | SSH 主机密钥和成员身份 | 建议保留；不继承配置是独立 前述对应 项。 | 待审批 |
| [D085](#d085) | 远端 root/租户/账号授权 | 建议保留，这是多租户权限核心。 | 待审批 |
| [D086](#d086) | 邀请签名/代次/过期/单次兑换 | 建议保留；有效期菜单 前述对应 可单独放宽。 | 待审批 |
| [D087](#d087) | 额度归属与配给核验 | 建议保留用户设定的配给；UI阈值与策略可独立修改。 | 待审批 |
| [D088](#d088) | 密钥安全存储与日志脱敏 | 建议保留；前述对应 仅移除粗糙吞错。 | 待审批 |
| [D089](#d089) | 归档完整回读后才删除 | 建议保留，容量限制可另改。 | 待审批 |
| [D090](#d090) | 原文件与并发写入保护 | 建议保留，符合数据完整性要求。 | 待审批 |
| [D091](#d091) | 配置修订比较和损坏文件保留 | 建议保留；不要以默认值掩盖损坏。 | 待审批 |
| [D092](#d092) | 异步迟到结果不发布 | 建议保留，可减少不必要取消范围。 | 待审批 |
| [D093](#d093) | 发送、工具、peer 与创建幂等 | 建议保留，符合防重复发送要求。 | 待审批 |
| [D094](#d094) | 队列绑定与不自动唤醒任务 | 建议保留用户发送授权和一次性处理。 | 待审批 |
| [D095](#d095) | 记忆范围、收据与防回流 | 建议保留完整性与来源，不以哈希冒充语义正确。 | 待审批 |
| [D096](#d096) | 进程取消和清理回执 | 建议保留；时长上限可另改。 | 待审批 |
| [D097](#d097) | 压缩包路径与 CRC 完整性 | 建议保留；容量和格式能力已另列。 | 待审批 |
| [D098](#d098) | 远端部署和删除目标核验 | 建议保留，适配平台限制单独改。 | 待审批 |
| [D099](#d099) | 公共 schema/输入与生命周期校验 | 建议保留结构合法性；具体字数和枚举是否必要应随对应项审。 | 待审批 |
| [D100](#d100) | 仓库检查与测试防误交付 | 建议保留开发门槛；它们不是用户运行时弹窗。 | 待审批 |

## 逐项证据与移除影响

<a id="d001"></a>
### D001 · 输入译文含汉字即拒绝

- 当前行为：输入译文正文仍有任意汉字就中止提交。
- 我的判断：建议移除此启发式硬拦截；专名及混合语言不是失败证据。
- 移除/改变后的影响：允许用户审阅后发送混合语言译文；不改预览版本检查。
- 源码：[packages/translation/provider.ts:141](../packages/translation/provider.ts#L141)
- 用户审批：**待审批**（移除 / 保留 / 改为可配置 / 修改方案）。

<a id="d002"></a>
### D002 · 未闭合代码围栏拒绝翻译

- 当前行为：代码围栏不完整或无法定位保护区就拒绝翻译。
- 我的判断：建议移除拒绝，原样保留该段；不应因 Markdown 编辑状态阻断任务。
- 移除/改变后的影响：需要调整保护器以保留原文，而非删掉代码保护。
- 源码：[packages/translation/protection.ts:18](../packages/translation/protection.ts#L18)
- 用户审批：**待审批**（移除 / 保留 / 改为可配置 / 修改方案）。

<a id="d003"></a>
### D003 · 凭据关键词拒绝翻译

- 当前行为：password、secret、API key 模式或私钥标记命中即禁止外发。
- 我的判断：建议改为可选择的提醒；正则会误判代码示例和测试数据。
- 移除/改变后的影响：可能发送真实敏感文本；实际凭据库权限是另一项。
- 源码：[packages/translation/protection.ts:7](../packages/translation/protection.ts#L7)
- 用户审批：**待审批**（移除 / 保留 / 改为可配置 / 修改方案）。

<a id="d004"></a>
### D004 · 完整访问仍逐次审批 API 命令

- 当前行为：run_command 无论 full-access 与否都调用 approve；文件写入却允许 full-access 跳过。
- 我的判断：建议移除 full-access 的重复审批，与用户选择一致。
- 移除/改变后的影响：default 模式审批及只读模式禁止执行可单独保留。
- 源码：[apps/desktop/host/api-local-tools.ts:35](../apps/desktop/host/api-local-tools.ts#L35)
- 用户审批：**待审批**（移除 / 保留 / 改为可配置 / 修改方案）。

<a id="d005"></a>
### D005 · 低影响侧栏操作二次确认

- 当前行为：归档项目会话、移除项目记录须 confirm=true；磁盘文件不删除。
- 我的判断：建议取消这些可逆操作的二次确认，提供撤销。
- 移除/改变后的影响：永久删除会话不在本项内。
- 源码：[apps/desktop/host/controller.ts:825](../apps/desktop/host/controller.ts#L825)
- 用户审批：**待审批**（移除 / 保留 / 改为可配置 / 修改方案）。

<a id="d006"></a>
### D006 · 新聊天授权靠自然语言正则

- 当前行为：必须引用最新用户文本，匹配中英文新建意图，命中否定词则拒绝。
- 我的判断：建议移除词法判官，改用明确的用户动作或授权字段；意图正则易误判。
- 移除/改变后的影响：仍需保留跨 owner 权限与创建幂等性。
- 源码：[packages/collaboration-core/session-tools.ts:16](../packages/collaboration-core/session-tools.ts#L16)
- 用户审批：**待审批**（移除 / 保留 / 改为可配置 / 修改方案）。

<a id="d007"></a>
### D007 · 原稿发送额外语言门槛

- 当前行为：翻译开启时中文原稿 bypass 需要 confirmOriginal，注释也单独检查。
- 我的判断：建议让明确的“发送原稿”动作直接表达同意，取消重复门槛。
- 移除/改变后的影响：不应因此默认自动发送翻译失败的原稿。
- 源码：[apps/desktop/host/controller.ts:1087](../apps/desktop/host/controller.ts#L1087)
- 用户审批：**待审批**（移除 / 保留 / 改为可配置 / 修改方案）。

<a id="d008"></a>
### D008 · 错误详情整段隐藏

- 当前行为：错误含 authorization 等词或超过 400 字就换成泛化失败；AbortError 一律说翻译取消。
- 我的判断：建议删除整段吞错和错误归因，改为字段级脱敏。
- 移除/改变后的影响：需保留实际 token、私钥脱敏。
- 源码：[apps/desktop/host/controller.ts:1743](../apps/desktop/host/controller.ts#L1743)
- 用户审批：**待审批**（移除 / 保留 / 改为可配置 / 修改方案）。

<a id="d009"></a>
### D009 · 普通本机文件按目录名拒绝

- 当前行为：API 文件工具拒绝 .ssh/.codex/.claude 及 controlPaths，独立于 OS 可读权限。
- 我的判断：建议移除目录名推断权限，真实身份权限另保留。
- 移除/改变后的影响：此前仅附件路径已解除；这里仍存在。
- 源码：[services/owner-file-service/index.ts:26](../services/owner-file-service/index.ts#L26)
- 用户审批：**待审批**（移除 / 保留 / 改为可配置 / 修改方案）。

<a id="d010"></a>
### D010 · 图片生成目录黑名单

- 当前行为：生成图工作区仍按敏感目录名和控制根判断，托管目录需要例外回调。
- 我的判断：建议移除目录分类；保留写入原子性与身份绑定。
- 移除/改变后的影响：生成图路径限制与已修复的预览限制不是同一处。
- 源码：[apps/desktop/host/generated-images.ts:33](../apps/desktop/host/generated-images.ts#L33)
- 用户审批：**待审批**（移除 / 保留 / 改为可配置 / 修改方案）。

<a id="d011"></a>
### D011 · 图片另存为目录黑名单

- 当前行为：另存为拒绝 credentialPath 与控制目录。
- 我的判断：建议移除目录名硬拒绝；用户已选择保存目标。
- 移除/改变后的影响：原附件覆盖与链接目标校验独立保留。
- 源码：[apps/desktop/host/attachments.ts:73](../apps/desktop/host/attachments.ts#L73)
- 用户审批：**待审批**（移除 / 保留 / 改为可配置 / 修改方案）。

<a id="d012"></a>
### D012 · 账号导出目的目录禁区

- 当前行为：导出目标在当前账号 home 内直接拒绝。
- 我的判断：建议移除整目录禁区，精确保护源认证文件即可。
- 移除/改变后的影响：需防止直接覆盖正在使用的认证源。
- 源码：[apps/desktop/host/account-export.ts:101](../apps/desktop/host/account-export.ts#L101)
- 用户审批：**待审批**（移除 / 保留 / 改为可配置 / 修改方案）。

<a id="d013"></a>
### D013 · 工作树根目录控制区限制

- 当前行为：自选 worktree 根目录在控制目录内但不是固定子目录就拒绝。
- 我的判断：建议取消固定目录特例，保留仓库递归嵌套检查。
- 移除/改变后的影响：需要继续准确记录受管根和归档目标。
- 源码：[packages/worktrees/index.ts:73](../packages/worktrees/index.ts#L73)
- 用户审批：**待审批**（移除 / 保留 / 改为可配置 / 修改方案）。

<a id="d014"></a>
### D014 · 官方技能禁止导出

- 当前行为：带官方来源的技能即不能导出，即使存在真实 SKILL.md。
- 我的判断：建议取消来源标签限制；无实际源文件的内置技能仍无法导出。
- 移除/改变后的影响：许可证义务不会因能导出消失。
- 源码：[packages/native-skills/index.ts:158](../packages/native-skills/index.ts#L158)
- 用户审批：**待审批**（移除 / 保留 / 改为可配置 / 修改方案）。

<a id="d015"></a>
### D015 · 技能选择固定数量

- 当前行为：总选择最多 6 项，包含 Claude 时最多 1 项。
- 我的判断：建议移除产品层固定数量；若原生仅支持单技能须补多技能传递。
- 移除/改变后的影响：不能仅删判断而遗漏后续技能。
- 源码：[packages/native-skills/invocation.ts:37](../packages/native-skills/invocation.ts#L37)
- 用户审批：**待审批**（移除 / 保留 / 改为可配置 / 修改方案）。

<a id="d016"></a>
### D016 · 预览补充最多十次

- 当前行为：同一预览修订累计十次后必须返回原稿。
- 我的判断：建议移除人为次数上限。
- 移除/改变后的影响：仍保留旧预览作废和单次提交。
- 源码：[packages/translation/gate.ts:29](../packages/translation/gate.ts#L29)
- 用户审批：**待审批**（移除 / 保留 / 改为可配置 / 修改方案）。

<a id="d017"></a>
### D017 · 本机浏览拒绝网络共享

- 当前行为：UNC 和 // 路径在解析前后都拒绝。
- 我的判断：建议提供网络路径支持或用户选择，不能把共享当设备路径。
- 移除/改变后的影响：支持后会产生网络文件访问；OS 认证仍有效。
- 源码：[apps/desktop/host/file-browser.ts:10](../apps/desktop/host/file-browser.ts#L10)
- 用户审批：**待审批**（移除 / 保留 / 改为可配置 / 修改方案）。

<a id="d018"></a>
### D018 · 附件拒绝网络和特殊路径

- 当前行为：Windows UNC、设备路径、备用数据流由同一 specialPath 判断拒绝。
- 我的判断：建议拆开：普通 UNC 可放宽，设备流需单独支持。
- 移除/改变后的影响：不能一并开放无限设备流读取。
- 源码：[apps/desktop/host/attachments.ts:10](../apps/desktop/host/attachments.ts#L10)
- 用户审批：**待审批**（移除 / 保留 / 改为可配置 / 修改方案）。

<a id="d019"></a>
### D019 · 硬链接一律拒绝

- 当前行为：附件、owner 文件、生成图、归档等即使只读也拒绝 nlink>1。
- 我的判断：建议只读取消；写入/删除按所有权与目标身份处理。
- 移除/改变后的影响：硬链接共享同一内容，写入会影响所有链接名。
- 源码：[apps/desktop/host/attachments.ts:100](../apps/desktop/host/attachments.ts#L100)；[services/owner-file-service/index.ts:76](../services/owner-file-service/index.ts#L76)；[packages/worktrees/archive.ts:20](../packages/worktrees/archive.ts#L20)
- 用户审批：**待审批**（移除 / 保留 / 改为可配置 / 修改方案）。

<a id="d020"></a>
### D020 · 本机文件预览大小和列表截断

- 当前行为：只预览 1 MiB UTF-8 文本，目录只列 1000 项。
- 我的判断：建议分页和流式读取替代硬拒绝。
- 移除/改变后的影响：无上限一次加载会占用内存并卡 UI。
- 源码：[apps/desktop/host/file-browser.ts:23](../apps/desktop/host/file-browser.ts#L23)
- 用户审批：**待审批**（移除 / 保留 / 改为可配置 / 修改方案）。

<a id="d021"></a>
### D021 · 文件搜索与插件定位预算

- 当前行为：目录、条目、耗时有界；插件候选最多 256、2 秒。
- 我的判断：建议可调预算与继续搜索；保留歧义选择。
- 移除/改变后的影响：去掉全部界限会使递归搜索或扩展长期挂起。
- 源码：[apps/desktop/host/file-navigation.ts:41](../apps/desktop/host/file-navigation.ts#L41)
- 用户审批：**待审批**（移除 / 保留 / 改为可配置 / 修改方案）。

<a id="d022"></a>
### D022 · 附件数量和大小

- 当前行为：10 个、单个 20 MiB、总计 50 MiB；主进程和存储重复校验。
- 我的判断：建议可配置或按通道能力限制。
- 移除/改变后的影响：发送协议、内存和历史负担需同步评估。
- 源码：[packages/attachments/types.ts:10](../packages/attachments/types.ts#L10)；[apps/desktop/host/main.ts:239](../apps/desktop/host/main.ts#L239)
- 用户审批：**待审批**（移除 / 保留 / 改为可配置 / 修改方案）。

<a id="d023"></a>
### D023 · 图片像素及生成格式限制

- 当前行为：剪贴板复制最大四千万像素；生成图只接受限定大小 PNG。
- 我的判断：建议像素阈值可配置，格式限制需增加解码支持。
- 移除/改变后的影响：不能删格式校验后把 JPEG 当 PNG 保存。
- 源码：[apps/desktop/host/main.ts:121](../apps/desktop/host/main.ts#L121)；[apps/desktop/host/generated-images.ts:32](../apps/desktop/host/generated-images.ts#L32)
- 用户审批：**待审批**（移除 / 保留 / 改为可配置 / 修改方案）。

<a id="d024"></a>
### D024 · API 本机工具读取限制

- 当前行为：文件服务在 API 路径最多 1,000,000 字节；分片读取最多 32000 字符；仅 UTF-8。
- 我的判断：建议支持流式和二进制工具，放宽固定值。
- 移除/改变后的影响：这是实际能力缺口，不仅一个判断。
- 源码：[apps/desktop/host/api-local-tools.ts:24](../apps/desktop/host/api-local-tools.ts#L24)
- 用户审批：**待审批**（移除 / 保留 / 改为可配置 / 修改方案）。

<a id="d025"></a>
### D025 · API 命令时长与输出限额

- 当前行为：命令最多 16000 字符、120 秒、输出 1,000,000 字节，超出会终止进程。
- 我的判断：建议改成可配置和输出落盘，不应因输出多杀任务。
- 移除/改变后的影响：保留用户停止及进程归属清理。
- 源码：[apps/desktop/host/api-local-tools.ts:65](../apps/desktop/host/api-local-tools.ts#L65)
- 用户审批：**待审批**（移除 / 保留 / 改为可配置 / 修改方案）。

<a id="d026"></a>
### D026 · API 模型循环硬上限

- 当前行为：一个回合最多 64 次模型调用。
- 我的判断：建议用户预算或可继续状态替代固定中断。
- 移除/改变后的影响：完全无限循环可持续计费。
- 源码：[apps/desktop/host/api-runner.ts:146](../apps/desktop/host/api-runner.ts#L146)
- 用户审批：**待审批**（移除 / 保留 / 改为可配置 / 修改方案）。

<a id="d027"></a>
### D027 · 上下文与摘要预算

- 当前行为：历史附件累计 100 MiB；摘要最多 16 请求；压缩后仍超预算拒绝。
- 我的判断：建议按真实模型窗口与用户预算配置。
- 移除/改变后的影响：取消预算不增加模型真实上下文能力。
- 源码：[apps/desktop/host/api-runner.ts:83](../apps/desktop/host/api-runner.ts#L83)；[packages/model-api/provider.ts:86](../packages/model-api/provider.ts#L86)
- 用户审批：**待审批**（移除 / 保留 / 改为可配置 / 修改方案）。

<a id="d028"></a>
### D028 · 模型思考档位白名单与检测门槛

- 当前行为：档位格式、列表和确认状态限制；候选档位保存前必须检测并取得推理同意。
- 我的判断：建议区分手工透传与自动检测，取消手工值的额外猜测。
- 移除/改变后的影响：未知参数可能被上游拒绝；检测本身仍会产生费用。
- 源码：[packages/model-api/config.ts:39](../packages/model-api/config.ts#L39)；[apps/desktop/host/model-connections.ts:78](../apps/desktop/host/model-connections.ts#L78)
- 用户审批：**待审批**（移除 / 保留 / 改为可配置 / 修改方案）。

<a id="d029"></a>
### D029 · 翻译端点 URL 限制

- 当前行为：仅 HTTPS，明确 loopback 可 HTTP；禁 query/hash、用户信息和链路本地地址。
- 我的判断：建议把非凭据 URL 约束改为明确配置选项。
- 移除/改变后的影响：HTTP 会明文传输；地址内凭据应单独处理。
- 源码：[packages/translation/config.ts:17](../packages/translation/config.ts#L17)
- 用户审批：**待审批**（移除 / 保留 / 改为可配置 / 修改方案）。

<a id="d030"></a>
### D030 · 翻译输出严格结束语义

- 当前行为：拒绝非完整终态、工具请求、空文本；分段 ID 必须完全一致。
- 我的判断：建议只放宽可展示的部分译文，不能自动提交不完整结果。
- 移除/改变后的影响：误用部分译文可能丢失指令。
- 源码：[packages/translation/provider.ts:85](../packages/translation/provider.ts#L85)
- 用户审批：**待审批**（移除 / 保留 / 改为可配置 / 修改方案）。

<a id="d031"></a>
### D031 · 翻译容量、队列和响应上限

- 当前行为：用户字符/调用/超时预算；队列并发 2、等待 64；响应 2 MB；分段最多 512。
- 我的判断：用户设定预算保留；硬编码队列/响应阈值可配置。
- 移除/改变后的影响：改变排队、资源占用及费用。
- 源码：[packages/translation/queue.ts:5](../packages/translation/queue.ts#L5)；[packages/translation/provider.ts:40](../packages/translation/provider.ts#L40)
- 用户审批：**待审批**（移除 / 保留 / 改为可配置 / 修改方案）。

<a id="d032"></a>
### D032 · 原生流帧和网关大小上限

- 当前行为：本地网关请求 32 MiB、API 流 32 MB；远端普通帧 8 MiB、原生帧 48 MiB。
- 我的判断：建议按工具负载调整并支持流式大结果。
- 移除/改变后的影响：移除所有限制会允许持续内存增长。
- 源码：[packages/model-api/native-gateway.ts:36](../packages/model-api/native-gateway.ts#L36)；[packages/model-api/provider.ts:229](../packages/model-api/provider.ts#L229)；[services/vps-account-broker/runtime.py:22](../services/vps-account-broker/runtime.py#L22)
- 用户审批：**待审批**（移除 / 保留 / 改为可配置 / 修改方案）。

<a id="d033"></a>
### D033 · Claude 本机工具白名单

- 当前行为：仅公开 Read/Write/Edit/Glob/Grep/Bash 等固定工具，不允许 sampling/auth。
- 我的判断：建议目录自动发现实际工具；模型调用能力保持显式授权。
- 移除/改变后的影响：扩展工具面；不能把本机工具宿主变成隐式模型执行器。
- 源码：[services/claude-bridge/tools.ts:11](../services/claude-bridge/tools.ts#L11)
- 用户审批：**待审批**（移除 / 保留 / 改为可配置 / 修改方案）。

<a id="d034"></a>
### D034 · Claude 工具预算

- 当前行为：帧 16 MiB、结果 8 MiB、内联 1 MiB、缓存 256 MiB、32 页/512 工具、并发 4。
- 我的判断：建议配置和分页落盘替代固定失败。
- 移除/改变后的影响：协议体积和内存负担增加。
- 源码：[services/claude-bridge/policy.ts:7](../services/claude-bridge/policy.ts#L7)
- 用户审批：**待审批**（移除 / 保留 / 改为可配置 / 修改方案）。

<a id="d035"></a>
### D035 · Claude 异步命令预算

- 当前行为：最多 128 记录、同时 4 项、最长 600000 ms，单次等待 30000 ms。
- 我的判断：建议按用户设置，保留 requestId 去重。
- 移除/改变后的影响：无限任务会消耗进程资源。
- 源码：[services/claude-bridge/local-tasks.ts:54](../services/claude-bridge/local-tasks.ts#L54)
- 用户审批：**待审批**（移除 / 保留 / 改为可配置 / 修改方案）。

<a id="d036"></a>
### D036 · 技能语法不支持即拒绝

- 当前行为：hooks/isolation/background、部分变量、shell、动态语法、inline model 等被拒绝。
- 我的判断：建议补适配或交给原生执行；不应简单删判断。
- 移除/改变后的影响：直接放行会忽略技能要求，行为错误。
- 源码：[services/claude-bridge/local-context.ts:130](../services/claude-bridge/local-context.ts#L130)
- 用户审批：**待审批**（移除 / 保留 / 改为可配置 / 修改方案）。

<a id="d037"></a>
### D037 · 技能目录和文本扫描限额

- 当前行为：原生技能扫描深度 8、5000 目录；SKILL.md 256 KiB；本机上下文另有扫描预算。
- 我的判断：建议分页和可调预算。
- 移除/改变后的影响：大技能库可能拖慢扫描。
- 源码：[packages/native-skills/index.ts:93](../packages/native-skills/index.ts#L93)；[services/claude-bridge/local-context.ts:41](../services/claude-bridge/local-context.ts#L41)
- 用户审批：**待审批**（移除 / 保留 / 改为可配置 / 修改方案）。

<a id="d038"></a>
### D038 · ZIP 容量及格式限制

- 当前行为：64 MiB、4096 项；不支持 ZIP64、分卷、加密和链接资源。
- 我的判断：建议扩展常见格式与大包，路径穿越和 CRC 校验独立保留。
- 移除/改变后的影响：需换用支持相应格式的解析实现。
- 源码：[packages/native-resources/archive.ts:8](../packages/native-resources/archive.ts#L8)
- 用户审批：**待审批**（移除 / 保留 / 改为可配置 / 修改方案）。

<a id="d039"></a>
### D039 · 资源链接一律禁改禁导出

- 当前行为：noLinks 对路径祖先、符号链接和硬链接拒绝。
- 我的判断：建议按操作区分只读导出与有副作用写入。
- 移除/改变后的影响：导出可能引入链接指向内容；写入应保留目标校验。
- 源码：[packages/native-resources/files.ts:19](../packages/native-resources/files.ts#L19)
- 用户审批：**待审批**（移除 / 保留 / 改为可配置 / 修改方案）。

<a id="d040"></a>
### D040 · 插件容量上限

- 当前行为：renderer 2 MiB、资源 4 MiB、context 单个 24000/总 64000 字符、存储 1 MiB。
- 我的判断：建议可配置，不应以小固定值限制已批准插件。
- 移除/改变后的影响：资源成本和上下文占用增长。
- 源码：[packages/plugins-core/index.ts:213](../packages/plugins-core/index.ts#L213)；[packages/plugins-core/storage.ts:6](../packages/plugins-core/storage.ts#L6)
- 用户审批：**待审批**（移除 / 保留 / 改为可配置 / 修改方案）。

<a id="d041"></a>
### D041 · 插件激活和清理超时

- 当前行为：默认激活 10 秒、清理 1 秒，失败进入恢复记录。
- 我的判断：建议按插件声明/配置，超时与故障隔离分开。
- 移除/改变后的影响：过短误杀，完全取消则可能卡住启停。
- 源码：[packages/plugins-core/index.ts:48](../packages/plugins-core/index.ts#L48)
- 用户审批：**待审批**（移除 / 保留 / 改为可配置 / 修改方案）。

<a id="d042"></a>
### D042 · 插件守护不可用即安全模式

- 当前行为：恢复守护启动失败、恢复状态错误等会全局禁用插件。
- 我的判断：建议优先局部隔离并允许明确继续；兜底恢复本身有用。
- 移除/改变后的影响：继续可能再次导致插件启动挂起。
- 源码：[apps/desktop/host/main.ts:72](../apps/desktop/host/main.ts#L72)；[packages/plugins-core/recovery.ts:52](../packages/plugins-core/recovery.ts#L52)
- 用户审批：**待审批**（移除 / 保留 / 改为可配置 / 修改方案）。

<a id="d043"></a>
### D043 · HTML 预览禁网络和越目录资源

- 当前行为：CSP 禁 connect/frame/form；资源仅同根、扩展名白名单；iframe sandbox。
- 我的判断：建议用户授权网络/资源范围，默认隔离保留。
- 移除/改变后的影响：模型 HTML 可主动访问网络或其它内容。
- 源码：[apps/desktop/host/html-preview.ts:9](../apps/desktop/host/html-preview.ts#L9)；[apps/desktop/renderer/InlineVisualization.tsx:67](../apps/desktop/renderer/InlineVisualization.tsx#L67)
- 用户审批：**待审批**（移除 / 保留 / 改为可配置 / 修改方案）。

<a id="d044"></a>
### D044 · HTML 页面与状态限额

- 当前行为：HTML 1 MiB、资产单个 5/累计 20 MiB、普通页 24/内联页 128；状态 16 KiB、渲染 10 秒。
- 我的判断：建议可调与资源缓存，尤其累计字节按请求计数会重复计费。
- 移除/改变后的影响：取消全部限额可能耗尽内存。
- 源码：[apps/desktop/host/html-preview.ts:45](../apps/desktop/host/html-preview.ts#L45)；[packages/visualizations/index.ts:52](../packages/visualizations/index.ts#L52)
- 用户审批：**待审批**（移除 / 保留 / 改为可配置 / 修改方案）。

<a id="d045"></a>
### D045 · 外部链接和登录网址限制

- 当前行为：普通链接仅 HTTP(S)；账号打开仅官方登录 URL；禁止新窗口导航。
- 我的判断：普通协议建议按用户动作开放，登录来源验证保留。
- 移除/改变后的影响：自定义协议会唤起本机程序。
- 源码：[apps/desktop/host/main.ts:137](../apps/desktop/host/main.ts#L137)；[apps/desktop/host/main.ts:145](../apps/desktop/host/main.ts#L145)
- 用户审批：**待审批**（移除 / 保留 / 改为可配置 / 修改方案）。

<a id="d046"></a>
### D046 · SSH 不继承配置与代理

- 当前行为：使用空配置，禁 ProxyJump/ProxyCommand/Agent、密码、交互认证、连接复用及环境。
- 我的判断：建议显式支持用户选用现有 SSH 配置，避免强制覆盖。
- 移除/改变后的影响：连接路由和身份可能随用户配置变化，需展示实际解析结果。
- 源码：[packages/ssh-transport/index.ts:38](../packages/ssh-transport/index.ts#L38)；[packages/ssh-transport/index.ts:17](../packages/ssh-transport/index.ts#L17)
- 用户审批：**待审批**（移除 / 保留 / 改为可配置 / 修改方案）。

<a id="d047"></a>
### D047 · API 命令精简环境及无 profile

- 当前行为：本机 API 命令复用 SSH 环境白名单，PowerShell -NoProfile。
- 我的判断：建议可选择真实本机环境，保护凭据注入边界。
- 移除/改变后的影响：工具可能读取继承的环境变量；缺失环境也会造成误失败。
- 源码：[apps/desktop/host/api-local-tools.ts:56](../apps/desktop/host/api-local-tools.ts#L56)
- 用户审批：**待审批**（移除 / 保留 / 改为可配置 / 修改方案）。

<a id="d048"></a>
### D048 · SSH 请求时间输出预算

- 当前行为：默认 30 秒/1 MiB；最多 24 小时/64 MiB，超限杀 SSH 进程。
- 我的判断：建议流式结果与按操作配置。
- 移除/改变后的影响：本机 SSH 结束不等于远端副作用未发生。
- 源码：[packages/ssh-transport/index.ts:63](../packages/ssh-transport/index.ts#L63)
- 用户审批：**待审批**（移除 / 保留 / 改为可配置 / 修改方案）。

<a id="d049"></a>
### D049 · 固定 Codex 执行器版本

- 当前行为：旧 deferred bridge 固定 0.155.1；新版本直接拒绝。
- 我的判断：建议能力协商替代补丁版本锁；不能未经适配宣称兼容。
- 移除/改变后的影响：仅影响该旧桥，不等于所有 Codex 路径都锁版。
- 源码：[packages/runtime-codex/index.ts:235](../packages/runtime-codex/index.ts#L235)；[services/local-executor/index.ts:15](../services/local-executor/index.ts#L15)
- 用户审批：**待审批**（移除 / 保留 / 改为可配置 / 修改方案）。

<a id="d050"></a>
### D050 · 协作队列与待发送上限

- 当前行为：peer 总 10000、目标待收 256、分页 100；follow-up 队列 100，等待 60 秒。
- 我的判断：建议分页清理和可配容量。
- 移除/改变后的影响：去掉幂等/owner 验证不是本项。
- 源码：[packages/collaboration-core/inbox.ts:48](../packages/collaboration-core/inbox.ts#L48)；[apps/desktop/host/follow-ups.ts:27](../apps/desktop/host/follow-ups.ts#L27)
- 用户审批：**待审批**（移除 / 保留 / 改为可配置 / 修改方案）。

<a id="d051"></a>
### D051 · 账号与登录任务固定容量

- 当前行为：本机账号 100、登录任务 200、导入最多 100；格式长度上限。
- 我的判断：建议配置并清理终态任务。
- 移除/改变后的影响：必须保留账号类型/身份校验。
- 源码：[apps/desktop/host/local-model-accounts.ts:69](../apps/desktop/host/local-model-accounts.ts#L69)；[apps/desktop/host/local-model-accounts.ts:173](../apps/desktop/host/local-model-accounts.ts#L173)
- 用户审批：**待审批**（移除 / 保留 / 改为可配置 / 修改方案）。

<a id="d052"></a>
### D052 · 邀请有效期固定五档

- 当前行为：只接受 1h/6h/12h/1day/7day。
- 我的判断：建议允许自定义有效期；过期失效本身保留。
- 移除/改变后的影响：改变授权暴露时长。
- 源码：[packages/workspace-control/export-policy.ts:2](../packages/workspace-control/export-policy.ts#L2)
- 用户审批：**待审批**（移除 / 保留 / 改为可配置 / 修改方案）。

<a id="d053"></a>
### D053 · 远端文件特殊根与链接拒绝

- 当前行为：管理员文件入口拒绝 proc/sys/dev/run，不跟随祖先符号链接。
- 我的判断：普通链接建议可解析；虚拟设备根需要明确专用读法。
- 移除/改变后的影响：虚拟文件可能无界阻塞或触发系统行为。
- 源码：[services/vps-account-broker/remote_files.py:26](../services/vps-account-broker/remote_files.py#L26)
- 用户审批：**待审批**（移除 / 保留 / 改为可配置 / 修改方案）。

<a id="d054"></a>
### D054 · 远端文件操作容量

- 当前行为：上传下载等 LIMIT 32 MiB；目录 1000 项；路径/文本限额。
- 我的判断：建议分页与分块传输。
- 移除/改变后的影响：不等于放宽管理员身份要求。
- 源码：[services/vps-account-broker/remote_files.py:13](../services/vps-account-broker/remote_files.py#L13)
- 用户审批：**待审批**（移除 / 保留 / 改为可配置 / 修改方案）。

<a id="d055"></a>
### D055 · 远端低内存新任务拦截

- 当前行为：启用 autoMemory 后内存压力阻止准入，并回收符合条件的闲置进程。
- 我的判断：建议告警和用户可调策略，避免固定压力值替用户决定。
- 移除/改变后的影响：可能遭 OS OOM；仅源码审计未检查实际启用状态。
- 源码：[services/vps-account-broker/runtime_maintenance.py:202](../services/vps-account-broker/runtime_maintenance.py#L202)；[services/vps-account-broker/resources.py:96](../services/vps-account-broker/resources.py#L96)
- 用户审批：**待审批**（移除 / 保留 / 改为可配置 / 修改方案）。

<a id="d056"></a>
### D056 · 远端磁盘余量拦截

- 当前行为：磁盘 headroom 不满足时拒绝任务、归档或恢复。
- 我的判断：建议可配阈值；保留无法可靠持久化时的明确失败。
- 移除/改变后的影响：磁盘耗尽可能使回执无法写入。
- 源码：[services/vps-account-broker/runtime_maintenance.py:207](../services/vps-account-broker/runtime_maintenance.py#L207)；[services/vps-account-broker/resources.py:102](../services/vps-account-broker/resources.py#L102)
- 用户审批：**待审批**（移除 / 保留 / 改为可配置 / 修改方案）。

<a id="d057"></a>
### D057 · 后台记忆容量与超时

- 当前行为：扫描 1500 项/32 MiB/深度7；后台 10/30 分钟，分批和核验次数有界。
- 我的判断：建议可配预算；保留已核验进度才继续。
- 移除/改变后的影响：可能增加后台费用或耗时。
- 源码：[packages/native-memory/sources.ts:39](../packages/native-memory/sources.ts#L39)；[packages/native-memory/background.ts:173](../packages/native-memory/background.ts#L173)
- 用户审批：**待审批**（移除 / 保留 / 改为可配置 / 修改方案）。

<a id="d058"></a>
### D058 · 链接记忆不参与同步

- 当前行为：扫描遇到符号链接记忆直接拒绝。
- 我的判断：建议按真实路径去重后只读采集，写入保护另行保留。
- 移除/改变后的影响：需防循环和跨来源重复采集。
- 源码：[packages/native-memory/sources.ts:49](../packages/native-memory/sources.ts#L49)
- 用户审批：**待审批**（移除 / 保留 / 改为可配置 / 修改方案）。

<a id="d059"></a>
### D059 · 记忆格式/英语与标记要求

- 当前行为：收件契约限制批次格式、标题/正文与受管标记，未知原生格式不写。
- 我的判断：格式一致性保留；语言检测和大小上限可单独放宽。
- 移除/改变后的影响：删校验可能无法被原生记忆正确读取。
- 源码：[packages/native-memory/consolidation.ts:25](../packages/native-memory/consolidation.ts#L25)；[packages/native-memory/protocol.ts:21](../packages/native-memory/protocol.ts#L21)
- 用户审批：**待审批**（移除 / 保留 / 改为可配置 / 修改方案）。

<a id="d060"></a>
### D060 · 工作树快照和归档容量

- 当前行为：未跟踪单文件32 MiB/总128 MiB/10000项；归档256 MiB/30000项。
- 我的判断：建议按磁盘能力流式归档、配置容量。
- 移除/改变后的影响：大二进制项目目前容易被拒绝。
- 源码：[packages/worktrees/index.ts:98](../packages/worktrees/index.ts#L98)；[packages/worktrees/archive.ts:9](../packages/worktrees/archive.ts#L9)
- 用户审批：**待审批**（移除 / 保留 / 改为可配置 / 修改方案）。

<a id="d061"></a>
### D061 · 工作树复杂索引/链接不支持

- 当前行为：子模块、未合并索引、特殊索引标志、链接等会拒绝归档。
- 我的判断：建议补真实可恢复支持，不能删判断假装已备份。
- 移除/改变后的影响：否则归档恢复可能丢状态。
- 源码：[packages/worktrees/index.ts:146](../packages/worktrees/index.ts#L146)
- 用户审批：**待审批**（移除 / 保留 / 改为可配置 / 修改方案）。

<a id="d062"></a>
### D062 · 数据迁移路径形态限制

- 当前行为：禁止已有目标、重叠根、链接祖先、部分仓库布置；Windows 限盘符路径。
- 我的判断：允许空目标或普通链接需独立实现；重叠根禁用有必要。
- 移除/改变后的影响：直接删除判断可能递归拷贝或覆盖数据。
- 源码：[packages/app-data/relocation.ts:35](../packages/app-data/relocation.ts#L35)
- 用户审批：**待审批**（移除 / 保留 / 改为可配置 / 修改方案）。

<a id="d063"></a>
### D063 · 远端浏览器环境与单实例限制

- 当前行为：要求固定 root 管理入口、已有组件、隔离身份；端口占用不替换；共享 profile 忙则拒绝。
- 我的判断：环境兼容性可扩展；忙时不可强占同一 profile。
- 移除/改变后的影响：需要支持多端口/实例而非杀掉占用进程。
- 源码：[services/vps-browser/remote_browser.py:179](../services/vps-browser/remote_browser.py#L179)；[services/vps-browser/configure_browser_root.py:37](../services/vps-browser/configure_browser_root.py#L37)
- 用户审批：**待审批**（移除 / 保留 / 改为可配置 / 修改方案）。

<a id="d064"></a>
### D064 · 远端保留期与日志容量

- 当前行为：闲置策略 1–8760 小时；日志最多2000条/30天/4 MiB；归档条目和容量有限。
- 我的判断：建议用户可配保留期和日志容量。
- 移除/改变后的影响：改变存储与审计历史；不删除归档校验。
- 源码：[packages/remote-account-catalog/retention-types.ts:3](../packages/remote-account-catalog/retention-types.ts#L3)；[packages/remote-account-catalog/retention-journal.ts:7](../packages/remote-account-catalog/retention-journal.ts#L7)
- 用户审批：**待审批**（移除 / 保留 / 改为可配置 / 修改方案）。

<a id="d065"></a>
### D065 · UI 偏好存储容量

- 当前行为：4 MiB/5000 key，值类型、版本与作用域校验。
- 我的判断：容量可配置；类型和并发修订保留。
- 移除/改变后的影响：无限私有 UI 状态会膨胀用户配置。
- 源码：[packages/ui-preferences/store.ts:44](../packages/ui-preferences/store.ts#L44)
- 用户审批：**待审批**（移除 / 保留 / 改为可配置 / 修改方案）。

<a id="d066"></a>
### D066 · 翻译外发同意

- 当前行为：没有 consent 不调用独立翻译服务。
- 我的判断：建议保留一次明确设置，避免重复弹窗。
- 移除/改变后的影响：移除会在用户未选择时向第三方发送文本。
- 源码：[packages/translation/provider.ts:127](../packages/translation/provider.ts#L127)
- 用户审批：**待审批**（移除 / 保留 / 改为可配置 / 修改方案）。

<a id="d067"></a>
### D067 · 登录凭据不得当 API key

- 当前行为：识别 Claude 登录 token/Cookie/认证文件和网页端点并拒绝独立 API 使用。
- 我的判断：建议保留真实凭据类型边界；误判应精确修复。
- 移除/改变后的影响：避免将登录身份发送给不匹配端点。
- 源码：[packages/translation/credentials.ts:2](../packages/translation/credentials.ts#L2)
- 用户审批：**待审批**（移除 / 保留 / 改为可配置 / 修改方案）。

<a id="d068"></a>
### D068 · 插件完整包批准和哈希

- 当前行为：执行插件代码前要求对当前包批准，包变化重新核验。
- 我的判断：建议保留，这是代码执行授权。
- 移除/改变后的影响：移除后导入或替换包可无确认执行本机代码。
- 源码：[packages/plugins-core/index.ts:149](../packages/plugins-core/index.ts#L149)
- 用户审批：**待审批**（移除 / 保留 / 改为可配置 / 修改方案）。

<a id="d069"></a>
### D069 · 插件命名空间/兼容/释放

- 当前行为：重复注册、非法服务成员、能力声明、失效 handle、next 多次调用被拒绝。
- 我的判断：建议保留所有权与生命周期；纯版本限制可适配。
- 移除/改变后的影响：移除会产生冲突、残留覆盖或重复副作用。
- 源码：[packages/plugins-core/services.ts:46](../packages/plugins-core/services.ts#L46)；[packages/plugins-core/index.ts:230](../packages/plugins-core/index.ts#L230)
- 用户审批：**待审批**（移除 / 保留 / 改为可配置 / 修改方案）。

<a id="d070"></a>
### D070 · 插件故障隔离和独立恢复入口

- 当前行为：异常启停记录、独立守护、恢复草稿及安全模式恢复。
- 我的判断：建议保留恢复能力，自动全局停用策略由 前述对应 单独审批。
- 移除/改变后的影响：失去后故障插件可让工作台无法启动。
- 源码：[packages/plugins-core/recovery.ts:78](../packages/plugins-core/recovery.ts#L78)；[apps/desktop/host/plugin-recovery-guardian.ts:13](../apps/desktop/host/plugin-recovery-guardian.ts#L13)
- 用户审批：**待审批**（移除 / 保留 / 改为可配置 / 修改方案）。

<a id="d071"></a>
### D071 · 破坏性动作二次确认

- 当前行为：永久删除聊天、卸载CLI、删除远端空间/profile、账号退出/重置卡兑换需要确认。
- 我的判断：建议保留；可逆记录移除已另列。
- 移除/改变后的影响：误点可丢记录、停止共享使用或消费额度。
- 源码：[apps/desktop/host/controller.ts:927](../apps/desktop/host/controller.ts#L927)；[apps/desktop/host/local-model-accounts.ts:163](../apps/desktop/host/local-model-accounts.ts#L163)；[services/vps-workspace-control/destruction.py:125](../services/vps-workspace-control/destruction.py#L125)
- 用户审批：**待审批**（移除 / 保留 / 改为可配置 / 修改方案）。

<a id="d072"></a>
### D072 · 维护与任务准入互斥

- 当前行为：运行中、预览待提交或结果未知时不更新CLI/桌面、不搬数据、不删除绑定。
- 我的判断：建议保留活动资源互斥；不同资源可缩小锁范围。
- 移除/改变后的影响：中途替换程序或身份可能破坏任务和回执。
- 源码：[packages/native-runtime/cli.ts:169](../packages/native-runtime/cli.ts#L169)；[packages/desktop-updates/index.ts:69](../packages/desktop-updates/index.ts#L69)；[packages/app-data/service.ts:33](../packages/app-data/service.ts#L33)
- 用户审批：**待审批**（移除 / 保留 / 改为可配置 / 修改方案）。

<a id="d073"></a>
### D073 · 安装卸载身份/渠道核验

- 当前行为：官方原生与 npm 渠道不混用；版本、路径、链接和受管身份核验，不删除配置。
- 我的判断：建议保留，扩展渠道通过明确适配。
- 移除/改变后的影响：误删其它安装或用户资料。
- 源码：[packages/native-runtime/native-install.ts:16](../packages/native-runtime/native-install.ts#L16)；[services/vps-account-broker/native_install.py:30](../services/vps-account-broker/native_install.py#L30)
- 用户审批：**待审批**（移除 / 保留 / 改为可配置 / 修改方案）。

<a id="d074"></a>
### D074 · 未知结果人工恢复

- 当前行为：uncertain 阻止新发送，明确核对后恢复；不把历史未知改成成功。
- 我的判断：建议保留结果语义；恢复交互可简化。
- 移除/改变后的影响：盲目恢复/重试可能重复执行。
- 源码：[apps/desktop/host/controller.ts:355](../apps/desktop/host/controller.ts#L355)；[packages/session-core/recovery.ts:1](../packages/session-core/recovery.ts#L1)
- 用户审批：**待审批**（移除 / 保留 / 改为可配置 / 修改方案）。

<a id="d075"></a>
### D075 · 部分协议结果不执行工具

- 当前行为：结束回执、工具参数顺序/完整性不满足时中止，不执行半截参数。
- 我的判断：建议保留；兼容新事件需适配而非忽略。
- 移除/改变后的影响：可能执行错误或重复工具调用。
- 源码：[packages/model-api/provider.ts:189](../packages/model-api/provider.ts#L189)；[packages/model-api/native-completion.ts:7](../packages/model-api/native-completion.ts#L7)
- 用户审批：**待审批**（移除 / 保留 / 改为可配置 / 修改方案）。

<a id="d076"></a>
### D076 · 外层失败不自动续投

- 当前行为：Claude 终态失败、API断流、未知清理等不自动重发、不换账号。
- 我的判断：建议保留防重复收费/执行；用户手动重试可用。
- 移除/改变后的影响：删除会重新发送已被上游处理的任务。
- 源码：[apps/desktop/host/api-runner.ts:138](../apps/desktop/host/api-runner.ts#L138)；[packages/runtime-claude/retry.ts:18](../packages/runtime-claude/retry.ts#L18)
- 用户审批：**待审批**（移除 / 保留 / 改为可配置 / 修改方案）。

<a id="d077"></a>
### D077 · 账号限流认证账单阻断

- 当前行为：远端共享账号状态阻止准入，核对回执后解除，不静默换号。
- 我的判断：建议保留身份与可用性阻断，误报须修状态。
- 移除/改变后的影响：取消后会持续撞认证/计费/限流失败。
- 源码：[services/vps-account-broker/runtime.py:1074](../services/vps-account-broker/runtime.py#L1074)
- 用户审批：**待审批**（移除 / 保留 / 改为可配置 / 修改方案）。

<a id="d078"></a>
### D078 · 真实本机与远端来源区分

- 当前行为：远端图路径不能当本机路径；仅已核实 local-device MCP 路径例外。
- 我的判断：建议保留来源证明，补远端传输而非映射错设备。
- 移除/改变后的影响：同名路径可能显示错误内容。
- 源码：[apps/desktop/host/activity-images.ts:21](../apps/desktop/host/activity-images.ts#L21)
- 用户审批：**待审批**（移除 / 保留 / 改为可配置 / 修改方案）。

<a id="d079"></a>
### D079 · 浏览器与 IPC 隔离

- 当前行为：sandbox/contextIsolation、无 renderer Node；IPC 只接受主窗口主 frame 和指定 URL。
- 我的判断：建议保留，这是 renderer 到本机权限边界。
- 移除/改变后的影响：页面内容可能直接获得主进程能力。
- 源码：[apps/desktop/host/main.ts:79](../apps/desktop/host/main.ts#L79)；[apps/desktop/host/main.ts:234](../apps/desktop/host/main.ts#L234)
- 用户审批：**待审批**（移除 / 保留 / 改为可配置 / 修改方案）。

<a id="d080"></a>
### D080 · 本地网关认证及方法路由

- 当前行为：网关 token、session 生命周期、指定模型路由；MCP-only 不提供模型凭据。
- 我的判断：建议保留；请求大小单列。
- 移除/改变后的影响：本机其它进程/页面可能调用模型或工具。
- 源码：[packages/model-api/native-gateway.ts:20](../packages/model-api/native-gateway.ts#L20)；[services/claude-bridge/index.ts:97](../services/claude-bridge/index.ts#L97)
- 用户审批：**待审批**（移除 / 保留 / 改为可配置 / 修改方案）。

<a id="d081"></a>
### D081 · 文件真实 owner 与 grant

- 当前行为：OS owner/ACL、owner/device/generation、过期/撤销和读写授权校验。
- 我的判断：建议保留，符合你已明确的权限范围。
- 移除/改变后的影响：删除后可跨身份访问或复用已撤销授权。
- 源码：[services/owner-file-service/index.ts:60](../services/owner-file-service/index.ts#L60)；[services/owner-file-service/windows-owner.ts:7](../services/owner-file-service/windows-owner.ts#L7)
- 用户审批：**待审批**（移除 / 保留 / 改为可配置 / 修改方案）。

<a id="d082"></a>
### D082 · 只读/计划模式执行边界

- 当前行为：readonly/plan 不允许修改和命令；执行前再次读取最新权限。
- 我的判断：建议保留用户明确选择的权限语义。
- 移除/改变后的影响：只读模式变成可写。
- 源码：[apps/desktop/host/api-local-tools.ts:36](../apps/desktop/host/api-local-tools.ts#L36)；[packages/session-core/permissions.ts:8](../packages/session-core/permissions.ts#L8)
- 用户审批：**待审批**（移除 / 保留 / 改为可配置 / 修改方案）。

<a id="d083"></a>
### D083 · 原生审批绑定真实请求

- 当前行为：审批 request/receipt 与会话、回合、选项对应；过期不可复用。
- 我的判断：建议保留，展示层无需再叠同义审批。
- 移除/改变后的影响：批准可能错投其它命令或会话。
- 源码：[packages/native-approvals/index.ts:3](../packages/native-approvals/index.ts#L3)；[apps/desktop/host/native-provider.ts:16](../apps/desktop/host/native-provider.ts#L16)
- 用户审批：**待审批**（移除 / 保留 / 改为可配置 / 修改方案）。

<a id="d084"></a>
### D084 · SSH 主机密钥和成员身份

- 当前行为：显式 known_hosts、StrictHostKeyChecking、成员验证和连接代次。
- 我的判断：建议保留；不继承配置是独立 前述对应 项。
- 移除/改变后的影响：可能连接错主机或以错身份执行。
- 源码：[packages/ssh-transport/index.ts:43](../packages/ssh-transport/index.ts#L43)；[services/host-control/verify-member.ts:4](../services/host-control/verify-member.ts#L4)
- 用户审批：**待审批**（移除 / 保留 / 改为可配置 / 修改方案）。

<a id="d085"></a>
### D085 · 远端 root/租户/账号授权

- 当前行为：SO_PEERCRED、UID、workspace/account generation、账号分配、root 管理与成员工作分离。
- 我的判断：建议保留，这是多租户权限核心。
- 移除/改变后的影响：可跨用户/账号操作或越权管理系统。
- 源码：[services/vps-account-broker/broker.py:708](../services/vps-account-broker/broker.py#L708)；[services/vps-account-broker/runtime.py:730](../services/vps-account-broker/runtime.py#L730)；[services/vps-workspace-control/ssh_entry.py:37](../services/vps-workspace-control/ssh_entry.py#L37)
- 用户审批：**待审批**（移除 / 保留 / 改为可配置 / 修改方案）。

<a id="d086"></a>
### D086 · 邀请签名/代次/过期/单次兑换

- 当前行为：导入邀请验证目标、签名、主机与代次，失效和重复兑换拒绝。
- 我的判断：建议保留；有效期菜单 前述对应 可单独放宽。
- 移除/改变后的影响：伪造或过期邀请仍可授予新设备访问。
- 源码：[packages/workspace-control/enrollment.ts:15](../packages/workspace-control/enrollment.ts#L15)；[services/vps-workspace-control/control.py:106](../services/vps-workspace-control/control.py#L106)
- 用户审批：**待审批**（移除 / 保留 / 改为可配置 / 修改方案）。

<a id="d087"></a>
### D087 · 额度归属与配给核验

- 当前行为：账号/工作空间归属、周期、账本修订、周/五小时配给及超额策略。
- 我的判断：建议保留用户设定的配给；UI阈值与策略可独立修改。
- 移除/改变后的影响：可错误扣费/重复计费或跨租户耗用。
- 源码：[services/vps-workspace-control/quota_service.py:37](../services/vps-workspace-control/quota_service.py#L37)；[services/vps-workspace-control/quota_accounting.py:143](../services/vps-workspace-control/quota_accounting.py#L143)
- 用户审批：**待审批**（移除 / 保留 / 改为可配置 / 修改方案）。

<a id="d088"></a>
### D088 · 密钥安全存储与日志脱敏

- 当前行为：OS secure storage 不可用时不明文保存；私钥/Bearer/query 凭据脱敏。
- 我的判断：建议保留；前述对应 仅移除粗糙吞错。
- 移除/改变后的影响：密钥可能明文落盘或进入日志。
- 源码：[apps/desktop/host/main.ts:77](../apps/desktop/host/main.ts#L77)；[packages/ssh-transport/index.ts:53](../packages/ssh-transport/index.ts#L53)
- 用户审批：**待审批**（移除 / 保留 / 改为可配置 / 修改方案）。

<a id="d089"></a>
### D089 · 归档完整回读后才删除

- 当前行为：工作树及远端历史先复制、哈希校验、租约、归属核实再删除；恢复不覆盖冲突。
- 我的判断：建议保留，容量限制可另改。
- 移除/改变后的影响：产生不可恢复的数据丢失。
- 源码：[packages/worktrees/archive.ts:43](../packages/worktrees/archive.ts#L43)；[services/vps-account-broker/session_storage.py:361](../services/vps-account-broker/session_storage.py#L361)
- 用户审批：**待审批**（移除 / 保留 / 改为可配置 / 修改方案）。

<a id="d090"></a>
### D090 · 原文件与并发写入保护

- 当前行为：hash/version、文件句柄身份、mtime/ctime、原子替换、写入锁与回读。
- 我的判断：建议保留，符合数据完整性要求。
- 移除/改变后的影响：丢更新、错写链接目标或将变化内容当原始快照。
- 源码：[services/owner-file-service/index.ts:109](../services/owner-file-service/index.ts#L109)；[apps/desktop/host/attachments.ts:71](../apps/desktop/host/attachments.ts#L71)；[packages/native-resources/files.ts:29](../packages/native-resources/files.ts#L29)
- 用户审批：**待审批**（移除 / 保留 / 改为可配置 / 修改方案）。

<a id="d091"></a>
### D091 · 配置修订比较和损坏文件保留

- 当前行为：设置/插件/记忆/偏好保存使用版本比较，损坏文件不直接覆盖。
- 我的判断：建议保留；不要以默认值掩盖损坏。
- 移除/改变后的影响：后保存的旧界面可覆盖新修改。
- 源码：[packages/ui-preferences/store.ts:40](../packages/ui-preferences/store.ts#L40)；[packages/plugins-core/storage.ts:47](../packages/plugins-core/storage.ts#L47)；[packages/native-memory/manage.ts:34](../packages/native-memory/manage.ts#L34)
- 用户审批：**待审批**（移除 / 保留 / 改为可配置 / 修改方案）。

<a id="d092"></a>
### D092 · 异步迟到结果不发布

- 当前行为：binding/revision/epoch/取消信号变化后丢弃旧返回，卸载后不得写回。
- 我的判断：建议保留，可减少不必要取消范围。
- 移除/改变后的影响：旧请求污染新会话/设置。
- 源码：[packages/translation/policy.ts:5](../packages/translation/policy.ts#L5)；[apps/desktop/host/activity-images.ts:34](../apps/desktop/host/activity-images.ts#L34)；[packages/runtime-extensions/index.ts:35](../packages/runtime-extensions/index.ts#L35)
- 用户审批：**待审批**（移除 / 保留 / 改为可配置 / 修改方案）。

<a id="d093"></a>
### D093 · 发送、工具、peer 与创建幂等

- 当前行为：草稿 sourceHash、operationId、同参数复用、冲突拒绝、先持久化再派发。
- 我的判断：建议保留，符合防重复发送要求。
- 移除/改变后的影响：重复任务、重复命令、重复聊天或消息。
- 源码：[packages/translation/gate.ts:7](../packages/translation/gate.ts#L7)；[apps/desktop/host/api-runner.ts:133](../apps/desktop/host/api-runner.ts#L133)；[packages/collaboration-core/inbox.ts:45](../packages/collaboration-core/inbox.ts#L45)；[apps/desktop/host/chat-session-tools.ts:57](../apps/desktop/host/chat-session-tools.ts#L57)
- 用户审批：**待审批**（移除 / 保留 / 改为可配置 / 修改方案）。

<a id="d094"></a>
### D094 · 队列绑定与不自动唤醒任务

- 当前行为：follow-up 绑定原会话/回合，peer 消息不直接启动模型，失败暂停队列。
- 我的判断：建议保留用户发送授权和一次性处理。
- 移除/改变后的影响：后台消息可能自主消耗模型或投递错会话。
- 源码：[apps/desktop/host/follow-ups.ts:52](../apps/desktop/host/follow-ups.ts#L52)；[packages/collaboration-core/native-inbox.ts:5](../packages/collaboration-core/native-inbox.ts#L5)
- 用户审批：**待审批**（移除 / 保留 / 改为可配置 / 修改方案）。

<a id="d095"></a>
### D095 · 记忆范围、收据与防回流

- 当前行为：来源标记、冻结批次、hash 回读、无进展停止，前台不注入后台交接。
- 我的判断：建议保留完整性与来源，不以哈希冒充语义正确。
- 移除/改变后的影响：重复吸收、跨来源混淆或误记已完成。
- 源码：[packages/native-memory/exchange.ts:161](../packages/native-memory/exchange.ts#L161)；[packages/native-memory/background.ts:201](../packages/native-memory/background.ts#L201)
- 用户审批：**待审批**（移除 / 保留 / 改为可配置 / 修改方案）。

<a id="d096"></a>
### D096 · 进程取消和清理回执

- 当前行为：终止仅针对拥有的进程，清理未确认保持 unknown，停止后不冒称未执行。
- 我的判断：建议保留；时长上限可另改。
- 移除/改变后的影响：误杀其他进程或重复执行未结束任务。
- 源码：[packages/native-runtime/process.ts:9](../packages/native-runtime/process.ts#L9)；[services/claude-bridge/isolation.ts:18](../services/claude-bridge/isolation.ts#L18)；[services/vps-account-broker/native_worker.py:95](../services/vps-account-broker/native_worker.py#L95)
- 用户审批：**待审批**（移除 / 保留 / 改为可配置 / 修改方案）。

<a id="d097"></a>
### D097 · 压缩包路径与 CRC 完整性

- 当前行为：阻止 ../、绝对路径、重复条目/碰撞、CRC 不符、导入目标覆盖。
- 我的判断：建议保留；容量和格式能力已另列。
- 移除/改变后的影响：压缩包可写到包外或覆盖文件。
- 源码：[packages/native-resources/archive.ts:44](../packages/native-resources/archive.ts#L44)；[packages/native-resources/files.ts:11](../packages/native-resources/files.ts#L11)
- 用户审批：**待审批**（移除 / 保留 / 改为可配置 / 修改方案）。

<a id="d098"></a>
### D098 · 远端部署和删除目标核验

- 当前行为：root 控制程序/目录权限、签名/校验、删除计划与实际发现一致，不跨挂载误删。
- 我的判断：建议保留，适配平台限制单独改。
- 移除/改变后的影响：执行被替换程序或删除错误系统资源。
- 源码：[services/vps-workspace-control/destruction.py:71](../services/vps-workspace-control/destruction.py#L71)；[services/vps-account-broker/setup.py:38](../services/vps-account-broker/setup.py#L38)
- 用户审批：**待审批**（移除 / 保留 / 改为可配置 / 修改方案）。

<a id="d099"></a>
### D099 · 公共 schema/输入与生命周期校验

- 当前行为：非法类型、未知 method、NUL、非法 ID、注册冲突、已关闭对象拒绝调用。
- 我的判断：建议保留结构合法性；具体字数和枚举是否必要应随对应项审。
- 移除/改变后的影响：运行时异常、路径/命令注入或隐蔽数据损坏。
- 源码：[apps/desktop/host/validation.ts:4](../apps/desktop/host/validation.ts#L4)；[packages/plugins-core/services.ts:21](../packages/plugins-core/services.ts#L21)
- 用户审批：**待审批**（移除 / 保留 / 改为可配置 / 修改方案）。

<a id="d100"></a>
### D100 · 仓库检查与测试防误交付

- 当前行为：插件契约快照、公开文档隐私、UI偏好扫描、测试隔离、安装目录保护。
- 我的判断：建议保留开发门槛；它们不是用户运行时弹窗。
- 移除/改变后的影响：失去自动发现破坏契约、泄露资料和打包用户数据的机会。
- 源码：[scripts/check-plugin-contracts.mjs:1](../scripts/check-plugin-contracts.mjs#L1)；[scripts/check-public-docs.mjs:1](../scripts/check-public-docs.mjs#L1)；[scripts/check-ui-preferences.mjs:1](../scripts/check-ui-preferences.mjs#L1)；[scripts/installer/paths.nsh:1](../scripts/installer/paths.nsh#L1)
- 用户审批：**待审批**（移除 / 保留 / 改为可配置 / 修改方案）。

## 验证边界

本次只新增审计文档及文档索引，不涉及公开 API、事件、存储结构、界面控件或默认行为变更，因此无需新增插件或 UI 偏好契约。未执行模型任务、远端操作或产品行为验收。源码链接已核实存在且对应行匹配；文档公开检查用于检查报告本身，不作为产品修复证明。

本地补充证据位于 `build/qa/defensive-audit/`（不提交）：`inventory.json` 含文件路径、行数、SHA-256 和命中行；`evidence.html` 可检索全部命中；`items.json` 含审批项及定位。关键词结果包含正常业务异常，不能直接按命中批量删除。
