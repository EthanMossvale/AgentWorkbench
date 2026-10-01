# Runtime and skin plugin example

Zip this directory with `workbench.plugin.json` at the archive root, import it in the workbench plugin page, and approve the complete package. No source changes or additional packages are required.

The plugin registers `plugin:example.echo`. The normal runtime selector, model selector, permission selector, composer, messages, approval view, recovery action, and session forks use its adapter. This is an offline contract example; it is not evidence of compatibility with any third-party CLI or model.

Send text normally. Include `[approval]` to exercise an approval receipt. Choose the compact model to shorten replies. The saved checkpoint counts completed turns. Recovery inspects that checkpoint without replaying input. Disabling the plugin keeps its conversations and blocks further submissions until the same owner returns.

The same package loads a bundled SVG background, changes colors and spacing, replaces the workspace header, and adds working palette/density controls. All styling, listeners and mounts are released on disable. The developer can also replace other named surfaces, target any CSS selector, or replace the complete shell through the existing renderer API.

See `docs/36-workbench-plugin-api.md` in the source repository for the versioned contracts, lifecycle, error behavior and acceptance evidence.
