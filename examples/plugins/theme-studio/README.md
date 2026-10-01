# Theme preset example

This example registers one light and one dark palette through `api.themes.register`.
It appears in Settings → Appearance only after the user imports and approves this complete package. It is not preinstalled or automatically enabled.

Package `workbench.plugin.json` and `renderer.mjs` at the root of a ZIP, then use the workbench plugin import flow. The executable renderer declares the existing `host` capability; the package approval applies only to the workbench plugin, not to native Codex or Claude plugins.

Each handle has a namespaced ID such as `plugin:example.theme-studio/lagoon` and an idempotent `dispose()` method. Registration does not select a theme or change fonts. The standard appearance picker saves the selected light/dark IDs, independently, through `appearance/set`. To select explicitly from a plugin, first read `appearance/get`, then send the current `revision` and a patch such as `{lightPreset: handle.id}`. Do this only in response to the user's action.

Disabled, removed, failed or upgraded renderer code releases its registrations. A missing selected preset falls back to the built-in preset for that mode without erasing the saved ID. Enabling the same ID again restores it. Keep preset IDs stable across compatible updates.

`base` can reference a built-in preset of the same mode. UI and syntax colors accept only six-digit hex values. Partial color overrides inherit the base; they do not overwrite interface, reading or code font preferences. See `docs/36-workbench-plugin-api.md` for the complete contract, errors and verification.
