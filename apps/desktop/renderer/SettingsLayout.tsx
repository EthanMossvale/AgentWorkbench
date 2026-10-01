import {FollowUpSettings} from './FollowUps';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { pluginSettings, type SettingsPageId } from './plugin-settings';
import { PluginSettingsPage } from './PluginSettingsPage';
import type { Session } from '../../../packages/contracts';
import { recentProject, RECENT_PROJECT_ID } from '../../../packages/session-core/projects';
import { api } from './App';
import { Connections, Capabilities, Preferences, type PageProps } from './Pages';
import { Icon, Toggle } from './ui';
import './SettingsLayout.css';
import ShortcutSettings from './ShortcutSettings';
import RuntimeCliSettings from './RuntimeCliSettings';
import ModelApiSettings from './ModelApiSettings';
import AttachmentStorage from './AttachmentStorage';
import WorktreeSettings from './WorktreeSettings';

export type SettingsTab = SettingsPageId;
const sections: {label:string; items:{id:SettingsTab;label:string;icon:string;keywords?:string}[]}[] = [
  {label:'个人',items:[{id:'general',label:'常规',icon:'settings',keywords:'编辑器 跟进 排队 引导 Ctrl Enter'},{id:'appearance',label:'外观',icon:'sun',keywords:'主题 皮肤 深色 浅色 字体 字号 代码 数字 动态 颜色'},{id:'shortcuts',label:'键盘快捷键',icon:'desktop'},{id:'privacy',label:'数据与隐私',icon:'shield'}]},
  {label:'工作流',items:[{id:'plugins',label:'插件',icon:'globe',keywords:'双语 翻译 模型 API 扩展 背景'},{id:'memory',label:'记忆',icon:'document'},{id:'skills',label:'技能',icon:'sparkle',keywords:'Skill 官方 个人 共享'}]},
  {label:'连接与运行',items:[{id:'runtimes',label:'运行时 CLI',icon:'terminal',keywords:'Codex Claude 安装 更新 版本'},{id:'models',label:'模型',icon:'sparkle',keywords:'第三方 API 官方 账号 Codex Claude 额度 用量 模型'},{id:'connections',label:'连接与环境',icon:'link',keywords:'SSH VPS 工作空间 账号'},{id:'worktrees',label:'工作树',icon:'branch',keywords:'Git worktree 分支 目录'},{id:'capabilities',label:'能力与验收',icon:'shield'}]},
  {label:'已归档',items:[{id:'archive',label:'归档会话',icon:'archive'}]},
  {label:'应用',items:[{id:'about',label:'关于',icon:'desktop'}]},
];

export default function SettingsLayout({state,refresh,report,notify,tab,onTab,onBack,onSelect,onUpdate,onDelete}:PageProps&{
  tab:SettingsTab;onTab:(value:SettingsTab)=>void;onBack:()=>void;onSelect:(id:string)=>void;
  onUpdate:(id:string,patch:Partial<Session>)=>void;onDelete:(session:Session)=>void;
}) {
  const [search,setSearch]=useState('');
  const [archiveSearch,setArchiveSearch]=useState('');
  const [version,setVersion]=useState('');
  const [recentVisible,setRecentVisible]=useState(!state.recentProject?.hidden);
  const [savingVisibility,setSavingVisibility]=useState(false);
  const contributions = useSyncExternalStore(pluginSettings.subscribe,pluginSettings.getSnapshot);
  const replacement = contributions.find(page=>page.id===tab);
  const effectiveTab=pluginSettings.has(tab)?tab:'general';
  useEffect(()=>setRecentVisible(!state.recentProject?.hidden),[state.recentProject?.hidden]);
  const changeRecentVisibility=async(value:boolean)=>{
    if(savingVisibility)return;setRecentVisible(value);setSavingVisibility(true);
    try{await api('project/update',{id:RECENT_PROJECT_ID,hidden:!value});await refresh();}
    catch(error){setRecentVisible(!state.recentProject?.hidden);report(error);}
    finally{setSavingVisibility(false);}
  };
  useEffect(()=>{if(effectiveTab==='about')void api<{version:string}>('desktop/info').then(value=>setVersion(value.version)).catch(report);},[tab]);
  const recent=recentProject(state);
  const custom = contributions.filter(page=>!page.definition.replaces).map(page=>({id:page.id,label:page.definition.label,icon:'globe',keywords:page.definition.keywords}));
  const allSections = [...sections.map(section=>({...section,items:section.items.map(item=>{const page=contributions.find(page=>page.id===item.id);return page?{...item,label:page.definition.label,keywords:page.definition.keywords}:item;})})),...(custom.length?[{label:'扩展',items:custom}]:[])];
  const visible=allSections.map(section=>({...section,items:section.items.filter(item=>`${item.label} ${item.keywords??''}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()))})).filter(section=>section.items.length);
  const title=allSections.flatMap(section=>section.items).find(item=>item.id===tab)?.label;
  const archived=state.sessions.filter(session=>session.archived&&`${session.title} ${state.projects.find(project=>project.id===session.projectId)?.name??recent.name}`.toLocaleLowerCase().includes(archiveSearch.trim().toLocaleLowerCase())).sort((a,b)=>Date.parse(b.messages.at(-1)?.timestamp??b.createdAt)-Date.parse(a.messages.at(-1)?.timestamp??a.createdAt));
  return <section className="settings-layout" data-testid="settings-layout">
    <aside className="settings-navigation">
      <header><button className="icon-button settings-back" data-testid="nav-workspace" aria-label="返回工作台" onClick={onBack}><Icon name="chevron" size={17}/></button><h1>设置</h1></header>
      <label className="settings-search"><Icon name="search" size={15}/><input placeholder="搜索设置" aria-label="搜索设置" value={search} onChange={event=>setSearch(event.target.value)}/>{search&&<button className="icon-button" aria-label="清除设置搜索" onClick={()=>setSearch('')}><Icon name="close" size={13}/></button>}</label>
      <nav aria-label="设置分类">{visible.map(section=><section key={section.label}><h2>{section.label}</h2>{section.items.map(item=><button key={item.id} data-testid={item.id==='connections'?'nav-connections':item.id==='capabilities'?'nav-capabilities':item.id==='archive'?'sidebar-archive':`settings-${item.id}`} aria-current={effectiveTab===item.id?'page':undefined} onClick={()=>onTab(item.id)}><Icon name={item.icon} size={16}/><span data-testid={item.id==='skills'?'shared-skills-link':undefined}>{item.label}</span></button>)}</section>)}{!visible.length&&<p className="settings-search-empty">没有匹配的设置</p>}</nav>
    </aside>
    <div className={`settings-content ${effectiveTab==='connections'?'wide-settings':''}`}>
      {(replacement||!['connections','capabilities'].includes(tab))&&<h1 className="settings-content-title">{title}</h1>}
      {replacement?<PluginSettingsPage entry={replacement} state={state}/>:<>
      {effectiveTab==='general'&&<><FollowUpSettings state={state}/><section className="settings-section general-settings"><h2>工作台</h2><div className="settings-card"><Toggle label="在侧栏显示最近会话" description="作为内置项目管理；移除后也可在这里重新显示。" checked={recentVisible} onChange={value=>void changeRecentVisibility(value)}/><div className="settings-action-row"><span><strong>模型</strong><small>管理 API、官方账号与各模型用量。</small></span><button data-testid="general-model-api" onClick={()=>onTab('models')}>管理<Icon name="chevron" size={14}/></button></div><div className="settings-action-row"><span><strong>连接与环境</strong><small>管理 SSH、工作空间和原生账号。</small></span><button onClick={()=>onTab('connections')}>管理<Icon name="chevron" size={14}/></button></div><div className="settings-action-row"><span><strong>归档会话</strong><small>查找、打开或恢复已归档的会话。</small></span><button onClick={()=>onTab('archive')}>查看<Icon name="chevron" size={14}/></button></div></div><h2>窗口</h2><div className="settings-card"><div className="settings-action-row"><span><strong>关闭后继续在托盘运行</strong><small>可从文件菜单或托盘菜单退出应用。</small></span><span className="settings-static-value">已启用</span></div></div></section></>}
      <Preferences state={state} refresh={refresh} report={report} notify={notify} tab={tab} onManageRuntimes={()=>onTab('runtimes')}/>
      {effectiveTab==='runtimes'&&<RuntimeCliSettings notify={notify}/>}
      {effectiveTab==='models'&&<ModelApiSettings state={state} refresh={refresh} notify={notify}/>}
      {effectiveTab==='privacy'&&<AttachmentStorage/>}
      {effectiveTab==='worktrees'&&<WorktreeSettings state={state} onSelect={onSelect}/>}
      {effectiveTab==='connections'&&<Connections state={state} refresh={refresh} report={report} notify={notify}/>}
      {effectiveTab==='capabilities'&&<Capabilities report={report}/>}
      {effectiveTab==='shortcuts'&&<ShortcutSettings/>}
      {effectiveTab==='archive'&&<section className="settings-section archive-settings" data-testid="archived-sessions"><label className="archive-search"><Icon name="search" size={16}/><input aria-label="搜索归档会话" placeholder="搜索会话或项目" value={archiveSearch} onChange={event=>setArchiveSearch(event.target.value)}/></label><div className="archived-chat-list">{archived.map(session=><article key={session.id} data-session-id={session.id} data-testid={`archived-session-${session.id}`}><button className="archived-chat-open" onClick={()=>onSelect(session.id)}><strong>{session.title}</strong><small>{state.projects.find(project=>project.id===session.projectId)?.name??recent.name} · {new Date(session.messages.at(-1)?.timestamp??session.createdAt).toLocaleDateString('zh-CN')}</small></button><button className="archive-restore" aria-label={`恢复会话 ${session.title}`} onClick={()=>onUpdate(session.id,{archived:false})}>恢复</button><button className="icon-button" aria-label={`删除会话 ${session.title}`} onClick={()=>onDelete(session)}><Icon name="trash" size={16}/></button></article>)}</div>{!archived.length&&<p className="settings-empty">{archiveSearch?'没有匹配的归档会话':'没有已归档的会话'}</p>}</section>}
      {effectiveTab==='about'&&<section className="settings-section about-workbench"><h2>Agent Workbench</h2><p>独立的双语桌面工作台</p><small>{version?`版本 ${version}`:'正在读取版本…'}</small></section>}
      </>}
    </div>
  </section>;
}
