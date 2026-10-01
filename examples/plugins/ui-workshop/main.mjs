export function activate(api) {
  api.registerCommand('read-settings', () => api.storage.read());
}
