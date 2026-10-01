export async function activate(api) {
  const background=await api.assetUrl('assets/grid.svg');
  api.addStyle(`
    :root { --accent:#9b6539; --accent-hover:#80502a; --accent-soft:#ead8c7; }
    body { background:#e9e2d7 !important; }
    .desktop-frame { background-image:url("${background}") !important; background-size:160px 160px; }
    .sidebar { background:rgba(220,213,201,.88) !important; }
    .workspace { background:rgba(247,242,232,.72) !important; }
    .composer-area { border:1px solid #baa78e; border-radius:22px; }
    .native-message { border-left:3px solid #b08761; padding-left:18px; }
    .runtime-studio-toolbar { display:flex;align-items:center;gap:12px;padding:12px 20px;background:#ede2d2;color:#473727;border-bottom:1px solid #c8b89f; }
    .runtime-studio-toolbar strong { margin-right:auto; }
    .runtime-studio-shell { position:fixed;inset:0;z-index:1000;padding:60px 8vw;overflow:auto;background:#e8dfce;color:#41392e;font:16px/1.7 system-ui; }
    .runtime-studio-shell button { margin:12px 12px 0 0; }
  `);
  const surface=api.mountSurface('workspace-header','replace');
  surface.root.className='runtime-studio-toolbar';surface.root.dataset.testid='runtime-studio-toolbar';
  const label=document.createElement('strong');label.textContent='Studio · 插件工作区';
  const density=document.createElement('button');density.textContent='紧凑阅读';density.className='button secondary';density.dataset.testid='studio-density';
  const theme=document.createElement('button');theme.textContent='切换配色';theme.className='button secondary';theme.dataset.testid='studio-theme';
  const shell=document.createElement('button');shell.textContent='重构主界面';shell.className='button secondary';shell.dataset.testid='studio-shell';
  surface.root.append(label,density,theme,shell);
  let releaseDensity,releasePalette;
  api.listen(density,'click',()=>{if(releaseDensity){releaseDensity();releaseDensity=undefined;}else releaseDensity=api.addStyle('.native-message{font-size:13px!important;line-height:1.5!important}.original-messages{gap:10px!important}');density.textContent=releaseDensity?'标准阅读':'紧凑阅读';});
  api.listen(theme,'click',()=>{if(releasePalette){releasePalette();releasePalette=undefined;}else releasePalette=api.addStyle(':root{--accent:#436b64;--accent-hover:#355851}.runtime-studio-toolbar{background:#d7e6df!important}');});
  api.listen(shell,'click',()=>{
    const panel=document.createElement('main');panel.className='runtime-studio-shell';panel.dataset.testid='studio-full-shell';
    const title=document.createElement('h1');title.textContent='完全由一个插件提供的工作台';
    const status=document.createElement('p');status.textContent='开发示例：此界面的布局、按钮和行为均来自插件。';
    const inspect=document.createElement('button');inspect.className='button secondary';inspect.textContent='读取运行时';
    const back=document.createElement('button');back.className='button secondary';back.textContent='返回常规界面';
    panel.append(title,status,inspect,back);api.root.append(panel);const restore=api.replaceShell();
    const releaseInspect=api.listen(inspect,'click',()=>{void api.call('runtime/catalog').then(runtimes=>{if(!api.signal.aborted)status.textContent=`已注册运行时：${runtimes.map(r=>r.name).join('、')}`;});});
    const releaseBack=api.listen(back,'click',()=>{restore();panel.remove();releaseInspect();releaseBack();});
  });
  api.onState(state=>{label.textContent=`Studio · ${state.sessions.length} 个会话`;});
}
