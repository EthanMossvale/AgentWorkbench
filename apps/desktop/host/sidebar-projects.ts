import {randomUUID} from 'node:crypto';
import type {AppState,Project,Session} from '../../../packages/contracts';
import {recentProject,RECENT_PROJECT_ID,projectSessionId} from '../../../packages/session-core/projects';

interface Hooks {update(change:(state:AppState)=>void):Promise<AppState>;assertIdle(session:Session):void}
/** Undo receipts belong to this host process; project and session results use StateStore. */
export class SidebarProjects {
  private receipts=new Map<string,(state:AppState)=>void>();
  constructor(private hooks:Hooks){}
  async archive(id:string){
    let ids:string[]=[];
    const state=await this.hooks.update(s=>{
      if(id!==RECENT_PROJECT_ID&&!s.projects.some(p=>p.id===id))throw Error('项目不存在。');
      const sessions=s.sessions.filter(v=>v.projectId===projectSessionId(id)&&!v.archived);
      for(const session of sessions)this.hooks.assertIdle(session);
      ids=sessions.map(v=>v.id);for(const session of sessions)session.archived=true;
    });
    const sidebarUndoId=randomUUID();this.receipts.set(sidebarUndoId,s=>{for(const session of s.sessions)if(ids.includes(session.id)&&session.projectId===projectSessionId(id))session.archived=false;});
    return {...state,sidebarUndoId};
  }
  async remove(id:string){
    let project:Project|undefined,index=0,recent:AppState['recentProject'];
    let sessions:{id:string;projectPath:string|undefined;detachedPath:string}[]=[];
    const state=await this.hooks.update(s=>{
      if(id===RECENT_PROJECT_ID){recent=structuredClone(s.recentProject);const p=recentProject(s);s.recentProject={name:p.name,paths:p.paths!,pinned:!!p.pinned,hidden:true};return;}
      index=s.projects.findIndex(p=>p.id===id);project=structuredClone(s.projects[index]);if(!project)throw Error('项目不存在。');
      for(const session of s.sessions)if(session.projectId===id){sessions.push({id:session.id,projectPath:session.projectPath,detachedPath:session.projectPath??project.path});session.projectPath??=project.path;session.projectId=null;}
      s.projects.splice(index,1);
    });
    const sidebarUndoId=randomUUID();this.receipts.set(sidebarUndoId,s=>{
      if(id===RECENT_PROJECT_ID){if(s.recentProject?.hidden)s.recentProject={...s.recentProject,hidden:recent?.hidden??false};return;}
      if(!s.projects.some(p=>p.id===id))s.projects.splice(index,0,project!);
      for(const before of sessions){const current=s.sessions.find(v=>v.id===before.id);if(current?.projectId===null&&current.projectPath===before.detachedPath){current.projectId=id;current.projectPath=before.projectPath;}}
    });
    return {...state,sidebarUndoId};
  }
  async undo(id:string){const restore=this.receipts.get(id);if(!restore)throw Error('撤销记录已使用或工作台已重启。');const state=await this.hooks.update(restore);this.receipts.delete(id);return state;}
  dispose(){this.receipts.clear();}
}
