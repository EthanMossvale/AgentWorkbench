export async function activate(api) {
  api.addStyle(`
    [data-plugin-surface="example.shell-workspace"] { position:fixed; inset:0; padding:64px 8vw;
      overflow:auto; background:#f2ece3; color:#302d28; font:16px/1.7 system-ui; }
    [data-plugin-surface="example.shell-workspace"] button { padding:9px 18px; border:1px solid #b9afa1;
      border-radius:8px; background:#fffcf7; color:#302d28; cursor:pointer; }
    [data-plugin-surface="example.shell-workspace"] h1 { font-weight:500; font-size:36px; }
  `);
  const heading = document.createElement('h1'); heading.textContent = '专注工作台';
  const description = document.createElement('p'); description.textContent = '这是一个插件提供的完整界面。';
  const summary = document.createElement('p');
  const count = await api.command('summary'); summary.textContent = `${count.projects} 个项目 · ${count.sessions} 个会话`;
  const theme = document.createElement('p'); theme.dataset.testid = 'plugin-shell-theme';
  const display = state => { theme.textContent = `当前外观：${state.theme}`; };
  display(await api.call('state/get')); api.onState(display);
  const exit = document.createElement('button'); exit.textContent = '停用插件并恢复工作台';
  exit.addEventListener('click', () => { void api.call('extensions/disable-all'); });
  const recovery = document.createElement('p'); recovery.textContent = '也可使用 Ctrl + Alt + Shift + P，或原生帮助菜单恢复。';
  api.root.append(heading, description, summary, theme, exit, recovery);
  api.replaceShell();
}
