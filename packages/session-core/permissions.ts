import { isPluginRuntime } from '../runtime-extensions/types';
import type { AppState, PermissionMode, RuntimeKind } from '../contracts/index.js';

const codexModes:readonly PermissionMode[]=Object.freeze(['default','read-only','full-access']);
const claudeModes:readonly PermissionMode[]=Object.freeze(['default','accept-edits','plan','full-access']);

/** Shared by the trusted host and renderer; contains no Node-only dependencies. */
export function permissionModesForRuntime(runtime:RuntimeKind):readonly PermissionMode[]{
  if(isPluginRuntime(runtime))return ['default','read-only','full-access','accept-edits','plan'];
  if(runtime==='claude')return claudeModes;
  if(runtime==='codex'||runtime==='demo'||runtime==='api')return codexModes;
  throw new Error('不支持的运行时。');
}

/** Only a missing legacy value uses the safe default; corrupt values never silently grant access. */
export function resolvePermissionMode(runtime:RuntimeKind,value:unknown):PermissionMode{
  const supported=permissionModesForRuntime(runtime);
  if(value===undefined)return 'default';
  if(typeof value!=='string'||(!supported.includes(value as PermissionMode)&&!(isPluginRuntime(runtime)&&isPluginRuntime(value))))throw new Error('权限模式无效或不适用于当前运行时。');
  return value as PermissionMode;
}

export const permissionScope = (projectId:string|null) => projectId === null ? 'projectless' : `project:${projectId}`;
export function rememberedPermission(state:Pick<AppState,'permissionPreferences'|'runtimeExtensions'>|null,projectId:string|null,runtime:RuntimeKind):PermissionMode {
  const value=resolvePermissionMode(runtime,state?.permissionPreferences?.[permissionScope(projectId)]?.[runtime]);
  const descriptor=state?.runtimeExtensions?.find(r=>r.id===runtime);
  return descriptor&&!descriptor.permissions.some(p=>p.value===value)?'default':value;
}
export function rememberPermission(state:AppState,projectId:string|null,runtime:RuntimeKind,mode:PermissionMode){
  const key=permissionScope(projectId);state.permissionPreferences??={};
  state.permissionPreferences[key]={...state.permissionPreferences[key],[runtime]:resolvePermissionMode(runtime,mode)};
}
