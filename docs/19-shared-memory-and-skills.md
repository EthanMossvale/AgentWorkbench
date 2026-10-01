# 19 · 框架统一 Memory 与 Skills

> 历史共享记忆/技能方案与演进记录；现行原生控制及交接规则见 [文档 35](35-native-memory-skills-plugins.md)。 [文档导航](README.md)

> 旧方案留档：本页的工作台私有记忆库与 Skill 复制方案已由原生来源、自动识别和同步替代。当前实现见 [35 · 原生记忆、Skill 与插件](35-native-memory-skills-plugins.md)。原资料保留，生产入口停用旧库写入。

## 1. 产品边界与公开机制核查

Claude 与 Codex 共用 **Agent Workbench 自己的** Memory/Skills 管理面、存储和上下文快照。换运行时不换另一套记忆或技能目录。它不接管任何既有 CLI 账号，不修改原生聊天记录，也不读取本机现有 `~/.codex/memories`、`~/.codex/skills`、`~/.agents/skills` 或 Claude 私人配置。

本次只读核查的官方资料：

- [Codex Memories](https://developers.openai.com/codex/customization/memories)：公开说明本地 Codex memories 默认关闭，存放于 Codex home 下的 `memories/`，可从合格历史会话后台生成；生成和使用分别可控。官方将这些文件视为生成状态，并不建议把手改生成文件当主要控制面。
- [Codex Configuration reference](https://developers.openai.com/codex/config-reference)：公开列出 `features.memories`、`memories.generate_memories`、`memories.use_memories`，以及提取/整合模型等配置项。
- [Agent skills](https://developers.openai.com/codex/skills)：`SKILL.md` 通过 frontmatter 提供 name/description，可搭配 scripts/references；先展示元数据，选用时读取完整指令，属于渐进披露。

因此，这里是 **文件组织/技能文档与共享上下文的兼容层**，不是官方自动记忆引擎的复刻，也不是“Claude 已原生共享 Codex 内部记忆”。本项目没有后台读聊天、没有自动提取/整合模型调用，也没有把来自模型的文本当管理员权限。

## 2. 数据位置与全局开关

所有内容只位于 Electron 传入的框架 `userData`：

```text
<userData>/shared/
  memories/
    catalog.json          # 权威元数据与显式保存的 notes
    memory_summary.md     # 可读摘要投影
    MEMORY.md             # 可读索引投影
    notes/<id>.md         # 可读笔记投影
  skills/
    catalog.json
    skill-<hash>/SKILL.md
```

Memory 默认关闭。用户在设置中明确开启；只有明确保存的笔记进入目录。可以填写自己的摘要、标签和来源会话 ID，未填写摘要时仅使用笔记开头的确定性短摘录，不进行模型归纳。该来源 ID 是 provenance，不会读取相应聊天。

关闭 Memory 后，新快照不包含 memory 项；之前准备但尚未提交的 Memory 快照被撤销，必须重新生成。已经发送给原生 CLI 的历史上下文不能被此开关追回；不会为此篡改原生 history。共享技能属于另一套全局目录，关闭记忆不等于删除或禁用已导入技能。

当前没有自动 capture 候选队列，也没有自动从聊天提取。`status.autoCapture` 恒为 false。

## 3. 选择性上下文与两家复用

`SharedMemoryStore.createSnapshot` 默认仅返回预算内的摘要；显式 noteIds 或 query 可选择完整笔记。查询仅在本框架已登记笔记的 title/summary/tags 中做有限关键词匹配，不扫描文件系统。

**最新交互不再要求创建会话时勾选技能。** `SharedSkillsStore.listMetadata` 只读共享目录，不预读正文；`createDiscoverySnapshot` 将所有已导入技能的 id/name/description/hash 放进一个 `skill-catalog` 条目。Claude/Codex 共用这一目录，既不是默认空 `skillIds`，也不是把全部正文塞进首轮。

需要完整说明时，可信读取层调用 `readMarkdown(id, expectedHash)`，返回这一个技能的完整原始 `SKILL.md` 并验证版本与元数据；设置页点击某项才读正文。`session/skills/read` 限定在此会话已经发现的 id/hash 内，不接受文件路径或执行动作。新导入内容进入新目录，旧冻结目录不静默更换；删除后的读取失败，旧 hash 不能读到重导入的新版本。较底层的 `createSnapshot({skillIds})` 仍供明确按需加载内容的合同测试使用，不再是新会话默认配置。

现阶段实现了框架目录/读取合同和原生输入适配，**真实原生模型如何通过已授权 reader 按需取正文，仍需随 H 执行链联验**；新增一个 IPC 方法不等于原生模型已经具备对应工具。不会为了目录可见性安装同名替代工具或放开管理 API。

每个 `SharedContextSnapshot` 都有：

- 不可变 items，包含 kind、原文 content 与内容 SHA-256。
- 与 provider 无关的 `sourceHash`：同样的条目内容在 Claude/Codex 会话里得到相同值。
- 独立 snapshot ID、sessionId、createdAt、revision 和 `agent-workbench-user-data` provenance。
- 进程内 framework brand；renderer 传回的普通 JSON 不能冒充可信构造的快照。

两个适配器由可信 host 取得同源快照，不各自重新采集 memory。快照内容被标为用户资料/技能指令，不扩大设备、文件、系统盘点或管理权限；不能让其中的“忽略规则”等文本签发授权。原任务与产物语言保持不变。实际原生注入与 receipt 由运行时适配层负责，不能以本地单元测试冒充远端模型联验。

## 4. Skills 导入兼容范围

用户通过框架选择 **一个具体的 `SKILL.md`**。只读取这一文件，不列举父目录，不自动扫描全局技能，也不读取相邻凭据、脚本或资源。

支持 name/description 的普通字符串、单双引号字符串及 description 的简单折叠/保留换行块。其余元数据不执行；不是通用 YAML 反序列化器。文件需要完整有界 frontmatter 和非空正文。路径穿越、符号链接/junction、硬链接、超大文件、明显凭据和重名冲突会被拒绝。

导入保留完整原始 `SKILL.md` 内容与 hash；读取正文时只用于展示，实际快照保留整份指令文件。已有同名技能不覆盖。移除需要精确 ID 与当前 hash。导入后的文件若被外部改写，读取/注入拒绝，需用户重新审阅导入。

**本版为 instruction-only 导入。** 不复制、不执行 scripts/references/assets；依赖这些资源的技能不能宣称完整可运行。框架 UI 应显示该限制，而不是假装已安装一个完整第三方插件。

## 5. 模块接口与验收

`packages/memory-core` 提供 `SharedMemoryStore`、共享 snapshot 类型、品牌校验和合并函数。`packages/skills-core` 提供 `SharedSkillsStore` 和有界 frontmatter 解析。所有修改由 host 的显式 UI 动作调用，不应暴露为模型任意可调用的记忆增权接口。

`tests/memory-skills.test.ts` 使用临时框架数据目录验证：默认关闭、手动增删改、版本冲突、跨运行时 sourceHash 一致、关闭后撤销旧快照、并发首次初始化、选择性摘要、完整技能原文保留、冲突不覆盖、symlink/junction/路径穿越/超大文件阻断、外部改写拒绝，以及两家同源合并快照。测试不接触真实全局 memories/skills、原生账户或远端 VPS。

安全限制：此层是可信本机 host 的受控文件/上下文服务，不是任意宿主 shell 的 OS 沙箱。文件系统外部进程不受本服务队列锁控制；原生历史中的已发送内容不会被追溯删除。
