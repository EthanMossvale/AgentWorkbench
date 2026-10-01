import { Component, type ReactNode } from 'react';
import type { RecoverySnapshot } from '../../../packages/plugins-core/recovery';

export function startBootHealth(){
  const bridge=window.workbench;if(!bridge)return;
  const pulse=()=>{void bridge.call('plugin-recovery/pulse').catch(()=>{});};
  pulse();const timer=window.setInterval(pulse,1000);
  const language=()=>{void bridge.call('plugin-recovery/ui-language',{language:document.documentElement.lang||'zh-CN'}).catch(()=>{});};
  language();const observer=new MutationObserver(language);observer.observe(document.documentElement,{attributes:true,attributeFilter:['lang']});
  window.addEventListener('pagehide',()=>{window.clearInterval(timer);observer.disconnect();},{once:true});
  void bridge.call<RecoverySnapshot>('plugin-recovery/status').then(status=>{
    if(!status.safeMode)return;
    const banner=document.createElement('aside');banner.setAttribute('role','status');banner.dataset.pluginRecovery='safe-mode';
    Object.assign(banner.style,{position:'fixed',right:'16px',bottom:'12px',zIndex:'2147483647',padding:'8px 12px',background:'var(--panel,#faf9f6)',color:'var(--text,#302e2b)',border:'1px solid var(--border,#b8b1a7)',borderRadius:'7px',fontSize:'13px'});
    banner.append(document.createTextNode('安全模式 · 第三方工作台插件已暂停 '));
    const button=document.createElement('button');button.textContent='查看诊断 / 退出安全模式';button.onclick=()=>{void bridge.call('plugin-recovery/show');};banner.append(button);document.body.append(banner);
  }).catch(()=>{});
}
export class PluginBootBoundary extends Component<{children:ReactNode},{failed:boolean}>{
  state={failed:false};
  static getDerivedStateFromError(){return {failed:true};}
  componentDidCatch(){void window.workbench?.call('plugin-recovery/core-failed').catch(()=>{});}
  render(){return this.state.failed?<main role="alert" style={{padding:40}}><h1>工作台界面加载失败</h1><p>请打开独立诊断窗口查看原因，或使用安全模式重新进入。</p><button onClick={()=>{void window.workbench?.call('plugin-recovery/show');}}>打开插件诊断</button></main>:this.props.children;}
}
