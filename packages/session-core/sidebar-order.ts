import type { AppState, Project, Session } from '../contracts';
import { RECENT_PROJECT_ID, recentProject, projectSessionId } from './projects';

export function orderedProjects(state: Pick<AppState,'projects'|'recentProject'|'sidebarProjectOrder'>):Project[] {
  const all=[...(!state.recentProject?.hidden?[recentProject(state)]:[]),...state.projects];
  const order=state.sidebarProjectOrder??[];
  const rank=(id:string)=>{const i=order.indexOf(id);return i<0?order.length+all.findIndex(p=>p.id===id):i;};
  return all.sort((a,b)=>Number(!!b.pinned)-Number(!!a.pinned)||rank(a.id)-rank(b.id));
}
export function reorderProject(state:AppState,id:string,targetId:string,edge:'before'|'after') {
  const projects=orderedProjects(state),source=projects.find(p=>p.id===id),target=projects.find(p=>p.id===targetId);
  if(!source||!target)throw Error('项目不存在或已隐藏，请刷新后重试。');
  if(!!source.pinned!==!!target.pinned)throw Error('置顶项目与普通项目各自在所在区域内排序。');
  if(id===targetId)return;
  const order=projects.map(p=>p.id).filter(value=>value!==id),index=order.indexOf(targetId);
  order.splice(index+(edge==='after'?1:0),0,id);state.sidebarProjectOrder=order;
}
/** Sidebar membership changes never rebind native identity or the working directory. */
export function moveSessionProject(state:AppState,id:string,projectId:string) {
  const session=state.sessions.find(s=>s.id===id);if(!session)throw Error('会话不存在。');
  if(projectId!==RECENT_PROJECT_ID&&!state.projects.some(p=>p.id===projectId))throw Error('目标项目不存在。');
  if(session.archived)throw Error('请先恢复归档会话。');
  session.projectPath??=state.projects.find(p=>p.id===session.projectId)?.path;
  session.projectId=projectSessionId(projectId);session.group='';session.pinned=false;
  state.sidebarCollapsedProjectIds=state.sidebarCollapsedProjectIds?.filter(id=>id!==projectId);
  if(projectId===RECENT_PROJECT_ID&&state.recentProject)state.recentProject.hidden=false;
}

export const sessionNeedsAttention=(s:Session)=>!!s.errorMark||s.status==='uncertain'||s.status==='blocked'||!!s.nativeApprovals?.length||!!s.nativeInteractions?.some(i=>i.status==='pending');
export function compareSidebarSessions(a:Session,b:Session):number {
  const priority=(s:Session)=>sessionNeedsAttention(s)?0:s.status==='running'?1:s.unread?2:3;
  const activity=(s:Session)=>Math.max(Date.parse(s.messages.at(-1)?.timestamp??'')||0,Date.parse(s.createdAt)||0);
  return priority(a)-priority(b)||activity(b)-activity(a)||a.id.localeCompare(b.id);
}
