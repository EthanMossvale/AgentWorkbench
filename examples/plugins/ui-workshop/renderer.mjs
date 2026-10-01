export async function activate(api) {
  let saved = await api.storage.read(), removeStyle;
  const apply = () => {
    removeStyle?.();
    const color = saved.values.accent === 'plum' ? '#775a79' : '#386c62';
    removeStyle = api.addStyle(`:root{--accent:${color}}[data-plugin-settings^="plugin:example.ui-workshop"]>p:first-child{color:var(--muted);margin-bottom:24px}.workshop-actions{display:flex;gap:12px;align-items:center;flex-wrap:wrap}.workshop-actions label{display:flex;gap:12px;align-items:center;white-space:nowrap;flex:0 0 auto}.workshop-actions select{width:auto}.workshop-actions button{padding:8px 12px;border:1px solid var(--line);border-radius:8px;background:var(--surface);color:var(--text);cursor:pointer}.workshop-actions button:hover{background:var(--hover)}.workshop-message{color:var(--muted);margin-top:18px}[data-workshop-row]{padding:0 12px 6px;text-align:right}[data-workshop-row] button{background:none;border:0;color:var(--muted);font-size:11px}`);
  };
  apply();
  api.onEvent(event => {
    if (event.type === 'plugin' && event.id === api.id && event.topic === 'storage.changed') {
      void api.storage.read().then(value => { if (!api.signal.aborted) { saved = value; apply(); } }).catch(() => {});
    }
  });
  const page = api.settings.register({
    id: 'skin', label: '示例皮肤配置', keywords: '配色 示例 界面', order: 10,
    async render({root,signal}) {
      const snapshot = await api.storage.read();
      if (signal.aborted) return;
      root.innerHTML = '<p>演示插件配置与批准的代码包分别保存。</p><div class="workshop-actions"><label>强调色 <select data-testid="workshop-color"><option value="green">松绿</option><option value="plum">灰紫</option></select></label><button data-testid="workshop-save">保存配置</button><button data-testid="workshop-host">从宿主回读</button></div><p class="workshop-message" role="status"></p>';
      const choice = root.querySelector('select'), status = root.querySelector('[role=status]');
      choice.value = snapshot.values.accent === 'plum' ? 'plum' : 'green';
      let current = snapshot;
      root.querySelector('[data-testid=workshop-save]').addEventListener('click', async event => {
        event.target.disabled = true;
        try { current = await api.storage.write(current.revision,{...current.values,accent:choice.value}); if(!signal.aborted) status.textContent = '配置已保存'; }
        catch { if(!signal.aborted) status.textContent = '保存失败；配置可能已在别处更新，请重新打开本页。'; }
        finally { if(!signal.aborted) event.target.disabled = false; }
      },{signal});
      root.querySelector('[data-testid=workshop-host]').addEventListener('click', async () => {
        try { const value = await api.command('read-settings'); if(!signal.aborted) status.textContent = `宿主配置：${value.values.accent ?? 'green'}`; }
        catch { if(!signal.aborted) status.textContent = '宿主不可用'; }
      },{signal});
    },
  });
  api.settings.register({
    id:'appearance',replaces:'appearance',label:'外观 · 开发示例',keywords:'主题 皮肤',
    render({root,signal}) {
      root.innerHTML='<p>这个内置页面由插件完整替换，停用后恢复。</p><div class="workshop-actions"><button data-theme="light">浅色</button><button data-theme="dark">深色</button><button data-testid="workshop-open">打开皮肤配置</button></div>';
      for(const button of root.querySelectorAll('[data-theme]')) button.addEventListener('click',()=>{void api.call('theme/set',{theme:button.dataset.theme}).catch(()=>{});},{signal});
      root.querySelector('[data-testid=workshop-open]').addEventListener('click',()=>page.open(),{signal});
    },
  });
  api.observeSurfaces('.sidebar .session-row[data-session-id]','after',({root,target,signal})=>{
    root.dataset.workshopRow=target.dataset.sessionId;
    const button=document.createElement('button');button.textContent='查看任务标题';root.append(button);
    button.addEventListener('click',async()=>{
      try { const state=await api.call('state/get'),session=state.sessions.find(item=>item.id===target.dataset.sessionId);if(!signal.aborted)button.textContent=session?.title??'任务已移除'; }
      catch { if(!signal.aborted)button.textContent='读取失败'; }
    },{signal});
  });
}
