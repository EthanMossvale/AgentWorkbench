export function activate(api) {
  const mount = api.mountSurface('workspace-header', 'after');
  mount.root.dataset.testid = 'developer-api-panel';
  mount.root.style.cssText = 'padding:12px 20px;border-bottom:1px solid var(--border);font-size:13px';
  const text = document.createElement('span'); text.textContent = '开发接口示例';
  const refresh = document.createElement('button'); refresh.textContent = '读取服务';
  const notice = document.createElement('button'); notice.textContent = '发送事件';
  const status = document.createElement('span'); status.dataset.testid = 'developer-api-status';
  refresh.onclick = async () => { const result = await api.call('example/developer/status'); status.textContent = `服务 ${result.services.length} · 会话 ${result.sessions}`; };
  notice.onclick = () => { void api.command('notify', {message:'事件已收到'}); };
  api.onEvent(event => { if (event.type === 'plugin' && event.id === api.id && event.topic === 'notice') status.textContent = event.payload.message; });
  mount.root.append(text, ' ', refresh, ' ', notice, ' ', status);
  api.onDispose(() => { refresh.onclick = null; notice.onclick = null; });
}
