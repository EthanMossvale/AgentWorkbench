# 10 · 本机 Claude 更新与重新核对

> 历史外部环境维护记录；不属于工作台功能交付，也不是重复维护该设备的授权。路径已用占位符代替。 [文档导航](README.md)

日期：2026-09-24。此项由用户在规划过程中另行明确授权，不属于框架实现，也不是 VPS 部署。

## 1. 更新结果

| 组件 | 更新前 | 更新后 | 核验 |
|---|---|---|---|
| Claude Code CLI | 2.1.168 | **2.1.281** | `claude --version`、文件版本、官方 SHA-256、有效 Anthropic 签名 |
| Claude Desktop | Appx 1.24012.11.0 | **产品 2.7032.0 / Appx 2.7032.0.0** | 包身份、产品版本、有效 Anthropic 签名、PackageStatus=Ok |
| CoworkVMService | Running / Auto，旧包路径 | **Running / Auto，新包路径** | 更新后重新查询服务状态与二进制路径 |

CLI 仍位于 `<user-home>/.local/bin/claude.exe`。桌面包身份仍为 `Claude`，publisher 与原包一致，注册位置更新到 `Claude_2.7032.0.0_x64__pzs8sxrjxfjjc`。

这是安装与配置层验证；没有发起模型任务、重新登录、打开既有会话或做桌面视觉/交互验收。没有更新远端 VPS 中的任何组件。

## 2. 最新版本的来源

官方 CLI latest 指针返回 `2.1.281`，读取该版本 manifest 后获取 Windows x64 包和 SHA-256。

官方桌面 MSIX latest 入口在 2026-09-24 返回 307，指向发布目录 `2.7032.0`；包 manifest 实际身份版本为 `2.7032.0.0`。同时检查到 WinGet 当时仍列出 `1.44121.2`，因此没有把 WinGet 候选当作最新版本。

来源入口见 [S21](07-research-sources.md#5-本机软件更新来源)。

| 文件 | SHA-256 | 信任依据 |
|---|---|---|
| Claude CLI 2.1.281 x64 | `39be063c2512b43347fe7b0ab18c46f1596141701c9c5fc895ddfca9a051067c` | 与官方 manifest 匹配，安装后二进制再次匹配；Authenticode=Valid |
| Claude Desktop 2.7032.0 MSIX | `f11b7d5dc5c969f19248cf598f23d35c552311a0ed703e106542c057c4016827` | 官方 latest 指向该包；Authenticode=Valid；哈希为本轮记录，不冒充独立官方摘要 |

## 3. 更新中遇到的问题与处理

1. 原生 `claude update` 找到 2.1.281，但下载出现 socket connection closed。重新读取版本确认仍是 2.1.168，没有盲目假定成功。
2. 按官方安装脚本公开的分发路径下载版本固定的原生二进制，验证 manifest 校验和与 Anthropic 签名，再运行该官方二进制自己的 `install 2.1.281`。安装成功后再次读取实际 CLI 版本与哈希。
3. 桌面首次就地更新报 `0x80073D02`。诊断显示不是前台窗口，而是旧包内的 `cowork-svc.exe` / `CoworkVMService` 占用。
4. 确认没有正在运行的依赖服务后，只正常停止这一目标服务，没有修改启动类型；再次就地安装 MSIX，并在 finally 路径恢复服务。
5. 更新后服务指向新版本包，状态恢复 Running，启动模式仍 Auto。没有更改系统代理、SSH、VPS 或其他后台服务。

## 4. 配置与凭据保留

对正式安装前后的目标文件做字节摘要比对，未打印内容：

- `.claude/settings.json`：一致。
- `.claude/.credentials.json`：一致。
- `.claude.json`：由官方程序执行了正常配置迁移，因此不是字节一致。

官方自动备份 `.claude/backups/.claude.json.backup.<timestamp>` 的摘要与安装前快照完全匹配。仅比较差异字段名，不输出项目路径或敏感值：变化涉及迁移版本、auto-mode 引导标记、routine watermark，以及项目 onboarding 字段。项目数量与标识集合不变。

未注销账号、清空用户数据、重装认证或修改用户 settings。桌面使用相同包身份就地升级，未执行卸载/清数据；桌面 UI 的登录状态尚未另行验证，不据此声称所有会话逐一验收通过。

临时缓存与旧 CLI 回退副本位于：

`<private-evidence>/claude-update/`

其中包含旧 CLI 2.1.168 副本和此次官方安装包，均不进入项目 Git。桌面旧版本回退未执行，也不声称保留了可直接一键回退的旧 MSIX。

## 5. 更新后的实际 CLI 帮助核对

通过 `claude --help` 与 `claude auth --help` 读取，无模型请求：

| 已观察到的入口 | 对本框架设计的意义 | 不能推导的结论 |
|---|---|---|
| `--autocompact <auto\|tokens>` | 可研究原生压缩设置，帮助展示参数范围为 100k–1M | 不证明所有账号/模型拥有 1M 窗口 |
| `--bg`、attach/logs/stop/respawn | 可研究原生后台会话监督与恢复 | 不等于跨主机工具自动迁移 |
| `--permission-prompts host\|none` | 原生 headless 权限交互有宿主接口 | 授权回复不是工具执行器替换 |
| `--restricted` | 有受限工具/目录策略入口，可纳入权限研究 | 不代表任意 shell 的完整隔离 |
| `--safe-mode` | 可隔离定制项做诊断，同时保留正常认证机制 | 不等于未来默认工作模式 |
| stream-json、resume/fork、tools、remote-control | 结构化进程适配和会话生命周期入口仍存在 | 不直接证明 H 全工具透明委派 |
| `auth login/logout/status` | 使用原生认证与公开状态命令 | 不需要框架 SDK 登录或提取凭据 |

特别注意：`--bare` 的帮助说明其认证路径与普通原生订阅不同，因此不能为了“简化测试”把它当本项目首期原生登录基准。

## 6. 更新后的架构结论

用户确定的方向保持不变：**VPS 运行并原生登录两家 CLI；SSH 桥接本机手脚；模型请求在 VPS 发出。**

新版本明确改善了压缩设置、后台会话和权限接口的研究基础。当前证据尚未完成全工具执行宿主的分离验证，所以将“公开原生工具契约 + 本机执行桥”列为第一技术实验；不据旧版本直接否定，也不据新版参数直接宣布已经无损支持。
