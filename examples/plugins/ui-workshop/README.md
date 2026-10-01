# 界面扩展开发示例

仅供开发文档和源码参考，不预装、不自动启用、不安装到实际用户工作台。自动验收只在临时数据目录导入此包。

- `settings.register` 添加可搜索的配置页，并通过 `replaces` 替换内置外观页；导航、卸载、失败和异步清理由宿主管理。
- `observeSurfaces` 为侧栏每条任务添加独立操作；新任务、移除任务和页面重建触发生命周期，事件监听由每个实例的 `signal` 释放。
- `storage.read/write` 在 host 和 renderer 共享当前插件的非敏感 JSON 配置，保存使用修订比较，冲突需重新读取。停用与升级保留配置，导出代码 ZIP 不携带配置。
- 全局 CSS 和宿主调用仍可用于整体配色与功能修改；这里只演示接口组合，不是产品默认皮肤。

契约与错误见 [插件开发接口](../../../docs/36-workbench-plugin-api.md)。离线桌面验证：`node --import tsx scripts/test-plugin-extensibility.mjs`。
