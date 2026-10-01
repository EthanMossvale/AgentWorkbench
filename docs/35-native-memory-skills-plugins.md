# Native memory handoff, Skills and plugins

<!-- memory-ssh-receivers-20261001:start -->
## 2026-10-01 修复：SSH 默认模型接入本机记忆后台

此前接收方默认模型可选择 SSH，但内置后台执行器排除了所有带 `hostId` 的绑定，导致每次触发重复记录执行位置未接入。现将 Codex SSH 和 Claude Code SSH 接入各自已有原生执行器；原生模型在远端运行，档案收集、限定方向的读取/保存工具、引用文件和回执核验仍属于本设备。此变更不启用 VPS 自动记忆，也不将本设备的记忆镜像保存到 VPS。

每个接收方保留所选账号身份、模型、思考档位、权限和执行位置，创建独立临时会话；后台没有前台聊天上下文或聊天列表入口。已有本机账号/API 接收路径保留。审批、失败、取消和清理不确定均停止当前调度，不自动重投；关闭后台 Codex 会话只清理该会话，不关闭共用服务或其它聊天。SSH 连接及账号在启动和工具调用前重新核验，维护和连接移除须等待后台结束。

相同绑定、权限、模型和冻结档案的未支持任务去重，重启后仍有效；后来注册兼容执行器可在下一次明确触发时恢复。旧任务保留，不删除阻塞历史。旧受管副本修改/来源冲突是独立保护状态，此修复不覆盖冲突文件或伪造接收回执。协议及插件证据见文档 16、36；尚不代表真实用户积压已处理。
<!-- memory-ssh-receivers-20261001:end -->

<!-- memory-receiver:start -->
## 2026-09-30 修正：接收方分别归纳，工作台串行调度

本节取代下面“默认模型统一整理”中的双向单会话设计。Claude 来源由 Codex 原生后台会话接收，Codex 来源由 Claude Code 原生后台会话接收；每家使用在新任务选择器中为该运行时明确选过的默认模型及思考档位。一个来源模型可以通过两种运行时使用，但不因此合并接收规则。未配置的一方保持待收并显示提示，不能由另一方代写。

总控台冻结档案、串行调度、约束接收身份、检查权限和回执；接收模型检查本方规则及既有记忆，负责英文归纳与语义去重。宿主读取/存储工具只接受该会话已发放的方向，原生文件与生成索引保持原有所有权。第一方启动后失败或中断，不自动启动第二方；取消、停用或移除执行器同时取消剩余调度。每方一次原生会话仍可能包含多次工具与模型交互。

原生可读引用路线继续有效：短用户入口 → received/INDEX.md → 来源范围内的主题正文。此路线不等于官方自动记忆 ingestion，文件/哈希通过不证明归纳忠实或未来必定召回。无需把正文全部塞入 Claude 的启动摘要。旧回执保留；新调度不补改真实用户的历史资料。接口和兼容详见文档 36“接收方各自归纳的职责修正”，验收层级见文档 16。
<!-- memory-receiver:end -->

<!-- memory-consolidation:start -->
## 2026-09-30 修订：默认模型统一整理

此节取代本文历史“复用触发聊天模型、按接收运行时分别开后台会话”的默认调度说明。新的默认执行器取新任务选择器保存的目标、模型和思考档位，一个独立原生后台会话整理冻结的双向待收档案。相同未变化的工作不随新聊天反复提交；记忆页的“立即整理待收记忆”可明确重试一次。原文档案、来源范围、设备隔离、只读权限、取消/超时及失败不自动续投规则保留。旧插件不声明 consolidation mode 时继续使用旧批次协议。

不覆写两家原生生成的 MEMORY.md 摘要。有效用户级 AGENTS.override.md/AGENTS.md 或 CLAUDE.md 仅增加一条短引用，指向 received/INDEX.md，再按来源范围和主题读取正文。接收文件可被独立 CLI 发现；关闭自动记忆或交接开关不删除这些已有引用。目录超过 200 行不等于 Claude 启动索引超限。并发/链接/超限时拒绝盖章，UI 显示具体原因；失败可能保留未核验部分文件，不能把存在文件视作已接收。

这是工作台原生可读文件适配，未声称提供官方跨厂商 ingestion API 或触发官方自动归纳。接口、可替换服务、权限、兼容、示例及测试详见文档 36 的“默认模型单会话记忆整理”；公开机制依据见文档 07，完成层级见文档 16。
<!-- memory-consolidation:end -->


> 功能与验证专题；事实仅适用于正文注明的版本、日期与验证层级。当前综合状态见 [文档 16](16-implementation-status.md)。 [文档导航](README.md)

## Local runtime maintenance and native plugin catalogs

Both runtimes default to their official native installers for a missing local installation. The Windows installer selector also offers npm explicitly; missing npm disables only that option. Choosing a method does not start installation, and an existing installation keeps its detected channel for checks, updates and removal. No implicit migration or fallback is performed. Native configuration homes and any existing installer path overrides are preserved.

Windows Codex native discovery retains the short official launcher at `%LOCALAPPDATA%\Programs\OpenAI\Codex\bin\codex.exe` while installation revisions use the resolved versioned target. Native version checks use the official release channel; npm checks use the package registry. Both runtimes' npm removal verifies the selected global prefix. Codex standalone removal validates its launcher/current junctions and release subtree, holds the native installation lock, unlinks the two owned junctions and removes only its release payload and auto-update marker. It retains the native home, memories, other package families, unrelated files and the harmless installation lock. Unexpected links or directory layouts disable managed removal. Official installers, including their checksum and path handling, remain responsible for actual downloads and installation.

CLI maintenance is serialized per runtime, not across both providers. Preferences use a separate short write queue, so disabling an automatic update is possible during version checks. Automatic updates require no running/uncertain workbench sessions or pending session operations; the condition is checked again immediately before execution. Task admission also observes the maintenance lock. External clients' own updaters remain independent.

Installed CLI cards expose an uninstall icon with a second confirmation and installation revision. Windows npm Codex removal validates `npm prefix -g` against the selected executable, then runs the native npm uninstall command. Windows native Claude removal targets only its launcher and native binary store; official launcher hard links can be unlinked without rewriting their targets. Configuration, login data, memories, skills, depot files and preferences remain untouched. Unknown installation channels cannot be blindly deleted. These CLI operations have simulated command/state acceptance, not a destructive test against the user's installation.

Native memory and skill compatibility follow actual installed capabilities: strict positive/negative Codex config-parser probes and Claude initialization metadata/difference checks. Local settings use the discovered installed CLI, independently of the pinned execution bridge. A disabled Codex parent plugin offers an explicit confirmation to enable it and the selected skill while retaining other per-skill exclusions. True policy/project overrides retain a visible limitation explanation.

The Plugins page includes native **Installed / Available** catalogs beside the existing workbench extensions. Records identify their runtime and marketplace. Codex uses native installed/list metadata and plugin/install; Claude uses native available JSON metadata and user-scope plugin install. If the official Claude marketplace is not registered, public catalog preview does not install or register anything; confirmed installation registers the official marketplace through Claude's native command first. Source and configuration revisions are checked, native state is re-read after each change, and partial failures never claim a successful installation. Native packages never become executable workbench host extensions. The workbench does not auto-accept declared install commands, headers helpers, extra authentication or policy bypasses.

Group switches affect the native plugin's skills/tools/other components and take effect in new sessions. Codex configuration writes use native compare-and-swap and preserve unrelated plugins; Claude writes the native enabledPlugins entry with a final raw-text revision check. Configured project/managed overrides remain bounded by the existing native control checks. Remote marketplace entitlements and every plugin's dependencies/authentication are not certified by local fixture installation acceptance.

## Device-local memory handoff (2026-09-27)

This revision replaces the former cross-runtime projection directories and permanent memory snapshots. Each runtime retains its own native memory. The local workbench keeps immutable source archives and a delivery journal under its own user-data directory; this depot is a transport queue, not a replacement retrieval or memory-generation engine.

1. A new installation starts disabled. Enabling shows a compact, one-time choice: existing Codex memories, existing Claude Code memories, or both. Unselected existing files form a baseline and are not silently uploaded on the next poll. Later additions and edits from either runtime are captured, including changes made outside the workbench. Re-enabling resumes capture.
2. Source discovery covers effective global instructions and native automatic-memory files, with original paths and scope. It excludes chats, credentials, intermediate raw memories, Skills and old workbench projections. Source archives retain the original text as evidence.
3. A pending foreign archive is attached only to the next explicit user task in the bound recipient runtime. Runtime, provider/model and execution location are separate. A third-party model hosted in Codex gets Codex instructions; one hosted in Claude Code gets Claude instructions. Both first uploads create two independent recipient queues, never a self-import.
4. The model receives an English, runtime-specific format/location guide. New native memory prose, summaries and index descriptions must be English. Paths, commands, identifiers, code and necessary quotations remain exact. The source language is not changed in the archived evidence.
5. Deduplication is required against existing native knowledge and the current batch, especially on a double initial upload. Exact existing knowledge can be acknowledged with native file evidence. Semantic duplicates and translated versions use an attributed native reference to existing knowledge rather than repeated prose. Conflicts retain provenance; timestamps alone do not resolve them.
6. The model uses the installation's supported native write route, re-reads native files/indexes, and writes a token-bound receipt. The workbench checks runtime, revision, scope, hashes, provenance and index reachability before recording completion. Pending ad-hoc notes, depot links and verbal claims do not count. Unsupported routes remain pending.
7. Partial receipts are supported. New source revisions require new receipts. Concurrent tasks cannot claim the same recipient queue in-process; completion/disconnect releases it. Interrupted work is retried only with another explicit user task. No background model, account rotation or autonomous continuation is started.
8. Receipts remove future reminders for that archive revision. Imported spans and index references carry provenance markers and do not echo. Subsequent native corrections to those spans, or independent unmarked additions, are outgoing changes. Removed/malformed provenance preserves the file and surfaces a repair error rather than guessing ownership.
9. Source removal produces a scoped withdrawal notice. It does not delete independent recipient memory. The receiving model records a native correction/reference after reviewing the imported material.

The journal has a generated device ID and a local host/home binding. It has no remote upload or cross-device synchronization path; sharing a VPS account does not merge device depots. Cloning an entire device identity is not a security guarantee this mechanism claims to solve.

## Native format and verification boundaries

Claude Code documents a short MEMORY.md index and topic Markdown files, loading the first 200 lines or 25KB at conversation start. The effective autoMemoryDirectory can change the location. The handoff guide requires discovering the active native store and retaining global/project scope.

Codex documents its memory directory as generated state. There is no verified universal external ingestion API in this implementation. The guide forbids blind replacement of generated indexes, preserves Codex's own conventions and leaves an archive pending when supported ingestion cannot be established. A translated update note is only an input to native consolidation, not proof of absorption.

A receipt proves the bounded local file/index checks implemented here. It does **not** prove semantic equivalence, English translation quality, enabled native background generation, future model recall, or that a remote account's memory store consumes the same local paths. Real runtime/store mapping and model acceptance remain separate validation. Claude H remains closed until its independent bridge acceptance exists. The Claude adapter has the same per-task hook and trusted controller factory; this does not claim a live desktop Claude executor was enabled.

All model-facing fixed text is English; UI is Chinese. Archives are untrusted reference data, not instructions that grant permissions. Read-only tasks get no import prompt. If the executor cannot access these real local files, it must leave them pending.

## Settings and original-file management

The page retains one automatic synchronization switch, a compact first-import choice, pending counts by recipient, last **verified handoff** time and the existing original-memory manager. Capturing an archive is not displayed as a successful import. There are no permanent direction/path/project controls.

The manager reads, edits and explicitly deletes discovered native originals through opaque IDs. Compare-and-swap revisions reject concurrent edits and retain the user's draft. Enabling capture archives the resulting edits; the next foreign-runtime task handles them. Empty effective global entry points remain in place to avoid activating a dormant fallback.

Migration retires only hash-verified old workbench projection files and managed link blocks, retaining unrelated user text. Independently edited copies cause a conflict and are preserved. Old enabled preferences still require the new first-import choice. Turning synchronization off stops capture/delivery without deleting native memory or changing native enablement settings.

## 本机原生记忆控制与 CLI 管理（2026-09-27 后续修订）

交接开关与原生记忆开关是不同控制。记忆页直接重新读取本机原生用户配置，不持久化另一份启停镜像。Codex 使用安装的 CLI 的 `config/read` / `config/batchWrite`，校验原生配置版本及原文 revision；主开关同时调整 `features.memories`、`memories.generate_memories`、`memories.use_memories`。第二项控制 `memories.disable_on_external_context`，不是读写分离开关；仅在安装协议支持时可改。Claude Code 修改 `settings.json` 的 `autoMemoryEnabled`，保留其余键并在替换前再次检查 revision，保存后回读。关闭自动记忆不等于关闭 CLAUDE.md 项目指令。

默认沿用本机原生 Home，也尊重已存在的 `CODEX_HOME` / `CLAUDE_CONFIG_DIR`，不迁移到工作台目录。面板聚焦及定时刷新反映外部修改；同一配置来源的其他客户端会读取这些原生值，以新会话为生效保证。当前覆盖检测包含 Codex 原生配置层、Claude 环境变量/项目文件/系统 managed-settings.json；尚未完整解析 Claude MDM、Windows 注册表、server-managed 或所有启动参数，因此不宣称展示了任意会话的最终有效设置。Claude Desktop Chat、Cowork 和 3P 的额外设置不能据此当成 CLI 同名设置；桌面记忆开关数量未通过设置页视觉验收。

安装状态决定页面：两家皆无显示 CLI 管理入口，若已有原文/历史仍保留管理入口；仅一家显示其原生记忆与原文管理；两家齐备才显示双向交接。缺少运行时暂停捕获/发放，不清空已保存偏好、档案或队列。接收方本机自动记忆关闭或无法读取时不发放交接。远端工作台的启动参数关闭自动记忆，不修改独立远端配置；远端原生进程与本机记忆映射仍保留原有验收边界。

设置的「运行时 CLI」展示安装版本、可执行文件、官方检查结果以及安装/更新操作。Windows Codex 使用官方 npm 全局安装（需要已有 Node.js/npm）；Claude 使用官方 PowerShell 安装器，已识别的 native 安装用 `claude update`。不改配置 Home 或登录，不把已有未知安装渠道转换成另一个渠道。工作台自动更新默认关闭，仅运行且任务空闲时每日检查，不自动补装缺少的 CLI，不接管 Claude 自身的 updater。失败保留错误；超时停止本次进程树，退出状态未知时禁止本进程重复启动安装。此页不更新或替换固定版本 Codex 执行桥。

隔离验证使用已安装的真实 CLI 读取版本和 Codex 配置 API，原生 Home 为临时目录；安装/更新命令仅用注入执行器验证，未实际安装、升级、登录或调用模型。后台离屏 Electron QA 不移动鼠标、输入系统键盘或操作用户窗口。

## 原生 Skill 列表

直接发现 Codex / Claude 的个人、项目、系统以及受支持的官方插件缓存目录，按真实路径去重，原文件不复制到工作台。页面上方为「官方」「个人」文字标签；项目 Skill 归入个人侧，原提供方与项目来源仍可在提示及详情中查看。

行内依次为原生图标或通用图标、显示标题与一行短描述、提供方与官方/个人标签（如「Codex · 个人」「Claude Code · 官方」）、开关、导出按钮。长文用省略号，完整内容点击后按需读取；无来源下拉框。列表不追加“内置”标签；官方页仅查看和开关，不显示导入或导出；个人页提供ZIP导入、导出，导出在开关右边。包装形式在详情中解释。同名冲突保留提示，工作台附加目录不是原生权限边界。

### Claude 官方来源和真实原生开关（2026-09-26）

- 已安装 Claude 插件以 `installed_plugins.json` 为准，读取实际安装版本、作用域、marketplace 与 manifest 的技能路径。识别 `anthropics/skills`，以及 `anthropics/claude-plugins-official` 中官方 `./plugins/` 项；官方目录里的第三方 `external_plugins` 不自动当作 Anthropic 官方。根来源 marketplace 声明的技能子集优先，避免把整个仓库或旧缓存当作已安装内容。
- Claude Code 2.1.281 的自带技能通过本机 CLI 自动发现：临时干净 Home、无登录/模型回合，比较初始化元数据在 `disableBundledSkills` 开/关时的差异，并处理 doctor 例外。由原生返回名称和描述，不维护猜测的技能清单。固定命令不会混入；未知版本不假称已适配。当前实测 15 项，具体会话仍可能有原生功能条件。
- Codex 使用官方 `skills/config/write`。文件技能按路径，插件技能按原生命名空间名称保存，避免仅绑定一次缓存版本。配置读取采用 `smol-toml`，实际写入由原生接口完成，不用正则改写 TOML。缺少原生接口、配置无法解析或有已发现的项目覆盖时不能假称开关已生效。
- Claude 文件/自带技能写入 `skillOverrides` 的 `off` / `on`；文件技能用原生目录身份，已实测 frontmatter 别名也被阻止。插件不受 `skillOverrides` 管理，改写 `enabledPlugins`，界面先确认同插件的技能及其他组件会一起切换。保留不相关设置，拒绝链接配置和检测到的并发修改，保存后重新读取核实。
- 原生设置为状态来源；在其他客户端改动后刷新即可反映。旧工作台独有的关闭偏好不会自动批量改写用户配置，而是提示重新关闭以实际生效。
- 用户最终选择以**新会话生效**为保证，提示“已保存，新会话生效”；无需重启工作台，不主动重载已有会话，也不撤销已经进入上下文的正文。本机设置不扩展到独立 VPS 安装或会话启动参数覆盖。两家的局部热更新机制不作为本功能承诺。
- 自带技能没有独立 `SKILL.md`，不把说明拼成虚假的可安装 ZIP。按用户最终设计，所有官方技能均不提供导出；后端同样在打开保存对话框前拒绝。个人技能完整导出原始资源。

点击「导入 ZIP」直接打开 440 px 宽的紧凑导入弹窗，不再显示前置下拉菜单或下拉箭头。安装目标仅在弹窗内选择，初始显式选中左侧 Codex，可切换为 Claude Code；只有拖入 ZIP 或点击选择文件后才进入安装。顶部是可切换来源的左右文字标签，下方仅一个 176 px 高的虚线拖放区，带 ZIP 文件图标、「将 ZIP 拖到此处安装」与「或点击选择文件」。暖白/炭灰配色与阅读字体沿用当前主题，不使用两个大卡片，也不展示路径框。支持方向键、Escape、外部点击关闭和焦点返回；安装中禁止重复提交或切换目标。

拖入本机 ZIP 通过 Electron webUtils.getPathForFile 在 preload 中取得真实文件路径，再进入与文件选择器相同的后端校验/安装流程，不复制文件到工作台、不伪造文件路径或执行脚本。一次接收一个 ZIP；非 ZIP、多文件、损坏压缩包、缺少 SKILL.md 与同名安装等错误留在弹窗内供重试。取消文件选择保留弹窗，不发生安装；成功关闭弹窗并刷新个人列表。目录仍自动识别：Codex 使用个人 .agents/skills，Claude 使用其原生 Home 下的 skills。仅打开弹窗不会调用文件选择器或安装；导出的 ZIP 不携带强制安装目标，外部ZIP均进入所选个人目录，按实际位置重新生成来源标签。

导入和导出保留脚本、引用、可选的 agents/openai.yaml 与资源。拒绝路径穿越、链接资源、碰撞、超限和覆盖已有安装，不执行导入包。原生开关行为以上节为准，覆盖旧版仅过滤工作台目录的实现。

### Claude 描述与跨应用软链接

agents/openai.yaml 不是通用 Skill 必需文件。展示优先读取其中的可选字段；不存在时以 SKILL.md 的原生 name / description 兜底，合并展示用空白并由界面单行省略，完整元数据仍交给模型。无图标时用通用图标，不偷偷生成展示文件，也不调用模型编写摘要。标题、短描述、图标均不决定技能执行能力。

已核对 CC Switch 的 get_ssot_dir、sync_to_app_dir 与 parse_skill_metadata_static：统一源目录加各应用目录 symlink / copy，解析 SKILL.md 的名称和描述；该同步链路不生成 openai.yaml，也不转换 Claude 专属语法。工作台能读取已存在的原生技能目录链接，按实际目标去重、保留两方来源；本轮没有新增一键建立跨应用软链接功能。软链接只解决文件共享，Claude 动态命令、变量、context: fork 等仍有运行时差异。来源见 docs/07-research-sources.md。

## 插件协议 v1

设置左侧的「插件」包含内置双语工作流。初始折叠，右侧开关直接控制既有翻译模块；展开后使用原有翻译配置。已有端点、凭据和翻译策略沿用原存储。收起的插件行高约 70 px，减少上下留白；下方说明在插件列表之后的普通布局流中，新增插件时自动排在最后一个插件下面，不固定覆盖内容。

第三方插件导入到 `<userData>/plugins/<id>`，默认关闭，整包导出为 ZIP。插件清单为 `workbench.plugin.json`：

```json
{
  "schemaVersion": 1,
  "apiVersion": 1,
  "id": "personal.reading-theme",
  "name": "阅读主题",
  "version": "1.0.0",
  "description": "温暖配色和按需上下文",
  "capabilities": ["context", "theme"],
  "contributes": {
    "context": "Prefer precise, verified explanations.",
    "theme": {
      "variables": { "--accent": "#a86143", "--surface": "#fffaf3" },
      "background": "assets/background.png",
      "opacity": 0.12
    }
  }
}
```

颜色支持工作台使用的受限 CSS 变量和值；背景是包内 PNG/JPEG/WebP（最大 4 MiB），转为本地 data URL，不加载远程资源。关闭插件移除对应贡献并恢复基础主题。多个已开启插件按名称排序，后应用的同名变量覆盖之前值。

需要深入扩展时声明 `"capabilities": ["host", "context"]` 与 `"main": "main.mjs"`。入口导出 `activate(api)`：

```js
export function activate(api) {
  api.onContext(({ runtime }) => `Active native runtime: ${runtime}.`);
  api.registerCommand('describe', () => ({ version: 1 }));
  api.useHost(async (request, next) => {
    // Modify or replace a host request, or wrap the existing implementation.
    if (request.method === 'personal/example') return { handled: true };
    return next(request);
  });
  api.onDispose(() => { /* release owned subscriptions and timers */ });
}
```

- `onContext` 返回附加上下文，以独立来源和哈希进入会话；不篡改用户任务，不授予模型新权限。
- `registerCommand` 通过 `extensions/command` 和精确插件 ID / 命令名调用；不同插件名称空间独立。
- `useHost` 是宿主 IPC 请求中间件，可调整、包装或替换底层请求行为。`next` 至多调用一次，防止重复提交。资源管理控制面始终保留原生路径，保证用户能停用插件。
- `onDispose` 管理生命周期。停用或代码版本变化时解除注册并调用清理；下一会话不包含旧贡献。

**宿主代码插件拥有 Node 进程权限，不是沙箱。** 启用前在界面明确批准当前完整包的哈希；文件变化后需要重新审阅，不能沿用旧版本授权。声明式外观插件不需要宿主代码权限。插件扩展不代表本工作台已经支持任意 DSH、Codex 或 Claude 插件格式的直接加载。

示例目录：`examples/plugins/reading-theme`、`examples/plugins/host-extension`。将目录内容打包为 ZIP 后即可从插件页导入。不要把凭据放入分发包。

## 验证范围

`tests/memory-handoff.test.ts` 使用隔离临时 Home 验证首次单边/双边导入、未选基线、来源范围、回执核验、精确/语义重复证据、索引首轮限制、部分完成、修订与重启、并发领取、停用/只读、防回流与原生后续修正、撤回、设备绑定、篡改/链接拒绝、旧版迁移以及原文 CAS 保护。`tests/native-collaboration.test.ts` 另验证两家续接会话的逐任务 hook、第三方 provider/model 路由、子线程完成隔离、失败门禁与无自主续投。

`tests/native-resources.test.ts` 保留 Skill、插件和冻结快照回归；原生记忆不再作为永久共享快照注入。`scripts/test-native-resources-ui.mjs` 构建隔离 Electron，实际操作首次来源选择、待接收状态、原文管理、Skill 和插件界面，并检查窄屏截图。没有修改真实原生 Home、登录凭据、生产 dist 或 VPS；真实模型/吸收与 Claude H 验收仍独立待办。

## 插件分区与平级记忆偏好（2026-09-27）

插件页面上方改为“工作台插件 / 运行时插件”标签，默认工作台侧；双语工作流只有插件行上的一个总开关，展开直接进入配置。ZIP 导入、工作台插件开发说明仅在工作台标签显示；原生插件保留自己的已安装/可安装标签与说明。

扩展协议新增完整界面入口、宿主服务调用、状态订阅及恢复入口，详见 [工作台插件接口](36-workbench-plugin-api.md)。此前“颜色与背景”只是声明式主题边界，不能用它代表本轮新增的完整代码界面扩展能力。

Codex 的记忆开关与工具聊天来源偏好平级展示，来源偏好可以在记忆关闭时独立保存；它不会自行打开记忆。高优先级覆盖也分别判断。Claude Code 的自动记忆开关维持 `autoMemoryEnabled`，官方未公布对应的工具来源过滤开关；仍有目录和 CLAUDE.md 等其它设置，不能称为只有一个记忆相关配置。

## 记忆标签、历史档案与插件拖入（2026-09-27 后续修订）

「查看与管理记忆」分为 Codex、Claude Code、工作台三个标签。前两栏按原生文件的归属运行时展示，已核验交接的文件另外标注来源运行时；文件可含多批来源，不假定一份档案对应一个独立原生文件。原文编辑、删除确认及并发 revision 保护保持不变。列表定时/聚焦更新元数据，不替换正在编辑的草稿。

工作台栏保留全部历史档案，包括待接收、处理中、回执待核验、已接收、被后续版本替代和来源撤回记录。详情只读展示原文证据、来源范围、修订、存档及核验时间；撤回事件仍可查看之前的来源原文。没有档案删除或改写入口。

核验成功时，在本设备账本内保存原生落盘文件和索引的证据摘要，同时适用于 stored 和 already_present。历史接收状态与当前文件状态分开：Agent 后续改写正文、修改/移除标记或移除文件，均不会清除档案或撤销已接收事实；另示「接收后有变动」「接收文件当前不可用」。这类变动不等同于语义丢失，也不能自动证明仍有相同知识。旧 stored 记录可沿用账本内已有片段关联；未保留足够证据的旧记录显示未核实，不凭现在的标记伪造来源。原生路径不可读时历史仍可查看。原文档案读取校验哈希与链接边界，不能由前端提交任意路径。

插件导入复用 Skill 的紧凑拖放视觉与交互，但不显示运行时选择区域。打开弹窗不立即调用文件选择器；虚线区支持点击和真实单个 ZIP 拖入。取消留在弹窗，格式/多文件/同名错误可原位修正，导入后默认关闭，代码权限的整包批准仍在启用时进行。

运行时 CLI 页改用平整行式布局、既有阅读字体和细分隔线。原生/npm 是文字单选项，路径、命令及检查时间收进「安装详情」；正在处理、检查结果和错误仍可直接看见。选择安装方式不触发安装，原有渠道检查、独立互斥、自动更新和二次卸载确认未改。
