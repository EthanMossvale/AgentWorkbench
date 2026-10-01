import type {AppState,SshHost} from '../../../packages/contracts';
import type {StudioApplyResult,SshOnlyMember} from '../../../packages/workspace-control/types';

export function retireSshOnlyConnections(state:AppState,admin:SshHost,members:SshOnlyMember[]){
 const names=new Set(members.map(member=>member.username));
 const removed=new Set(state.hosts.filter(host=>host.role==='workspace'&&host.ownerId===admin.ownerId&&host.hostname.toLowerCase()===admin.hostname.toLowerCase()&&host.port===admin.port&&names.has(host.username)).map(host=>host.id));
 state.hosts=state.hosts.filter(host=>!removed.has(host.id));
 state.profiles=state.profiles.filter(profile=>!removed.has(profile.hostId));
 for(const id of removed)if(state.accountCatalogs)delete state.accountCatalogs[id];
 if(state.activeWorkspaceId&&removed.has(state.activeWorkspaceId))delete state.activeWorkspaceId;
}

/** Remove only saved descriptors for a confirmed deleted space; keep keys/history. */
export function retireDeletedWorkspace(state:AppState,admin:SshHost,result:StudioApplyResult){
 const workspace=result.workspace;
 if(result.state!=='applied'||workspace?.status!=='deleted')return;
 const removed=new Set(state.hosts.filter(host=>host.role==='workspace'&&host.ownerId===admin.ownerId&&host.hostname.toLowerCase()===admin.hostname.toLowerCase()&&host.port===admin.port&&host.username===workspace.username&&(!host.remoteWorkspaceId||host.remoteWorkspaceId===workspace.id&&host.workspaceGeneration===workspace.generation)).map(host=>host.id));
 state.hosts=state.hosts.filter(host=>!removed.has(host.id));
 state.profiles=state.profiles.filter(profile=>!removed.has(profile.hostId));
 for(const id of removed)if(state.accountCatalogs)delete state.accountCatalogs[id];
 if(state.activeWorkspaceId&&removed.has(state.activeWorkspaceId))delete state.activeWorkspaceId;
}
