# 18 · 开发环境、依赖与验证

[文档导航](README.md) · [项目规则](../AGENTS.md) · [插件开发](36-workbench-plugin-api.md)

## 环境与安装

Windows 为当前桌面开发基线；使用 Node.js 24、系统 OpenSSH 和仓库固定的 npm lockfile。Electron、React、TypeScript、Vite、esbuild 等具体版本以 `package.json` 与 `package-lock.json` 为准，不把历史安装记录当作最新发布版本。

在项目根目录执行：

```powershell
npm ci
npm run setup:electron
npm run build
npm start
```

`setup:electron` 使用对应包的官方安装流程或已校验的本地 Electron 内容，不修改系统代理、TLS 或已有原生客户端配置。开发者可使用 `Start-Dev.cmd --check` 仅构建。共享仓库协作时使用独立输出目录验证，避免覆盖其他任务正在使用的 `dist`。

## 检查入口

| 命令 | 验证内容 |
| --- | --- |
| `npm run check:docs` | 文档导航、本地文件链接、常见隐私模式、JSON 和宿主方法目录漂移 |
| `npm run typecheck` | TypeScript 静态检查 |
| `npm test` | 单元与协议测试；部分原生配置测试需要相应 CLI 测试二进制 |
| `npm run build` | 类型检查及 renderer/main/preload 构建 |
| `npm run test:desktop` | 独立 Electron 桌面自动化 |
| `npm run check` | 文档、测试、构建、桌面与依赖审计的组合入口 |

原生资源与插件界面专项：

```powershell
$env:AGENT_WORKBENCH_TEST_HIDDEN = '1'
# 按测试环境设置 AGENT_WORKBENCH_TEST_CODEX_EXECUTABLE；勿使用真实用户配置。
node --import tsx scripts/test-native-resources-ui.mjs
```

测试使用临时 Home、合成数据和独立应用数据目录。涉及已有二进制时应显式核对测试版本；缺少测试运行时不能通过降低断言来假称验收通过。具体测试环境和失败原因写入文档 16，`build/qa/` 日志和截图保持本地。

## 验证层级

单元、合成协议、隔离 Electron、真实 CLI、真实模型、远端部署、网络出口分别记录。离线提供方或本地合成上游可以证明协议与生命周期，不能证明真实账号、所有供应商、所有远端设备或生产部署。

修改插件机制需覆盖导入后不执行、完整包批准、请求/服务替换、新接口、事件、局部与完整界面、版本变化、停用/失败清理及恢复。实例目录为 `examples/plugins/`，主回归为 `tests/plugin-api.test.ts`、`tests/plugin-services.test.ts` 和两个 plugin UI 检查脚本。

## 依赖与许可

项目保持 `private: true`，尚未选定发行许可证。依赖以 lockfile 的完整性与包内 LICENSE/NOTICE 为依据；版本更新后重新检查许可，不把历史研究自动延伸到新版本。构建所需第三方依赖、独立下载的 CLI/浏览器和参考项目源码应分别记录。

公开来源与既有许可核对见 [研究来源](07-research-sources.md)。发布前需为实际分发内容生成适当通知；不复制未审查的参考代码，不自动推送、发布或部署。

## 文档维护

所有功能变更同步提供开发接口并更新文档 36；新增宿主方法遗漏目录会被 `check:docs` 检出。该检查是辅助防线，不是完整秘密扫描、图片审查、Git 历史清理或第三方网页实时核验的替代品。新图片需人工检查；真实路径、账号、会话标识和私有来源用明确占位符替换，验证结论与日期保持真实。
