import type { AppState, Session, NativeModelSelection } from '../contracts';
import type { ModelTarget } from '../model-api/types';
import { rememberedPermission } from '../session-core/permissions';
import type { MemoryTaskBinding } from './background';
import type { MemoryRuntime } from './protocol';
export interface MemoryDefaultChoice {targetId:string;selection?:NativeModelSelection}
export interface MemoryDefaultService {
  resolve(context?:Pick<Session,'projectId'|'projectPath'|'permissionMode'>,recipient?:MemoryRuntime):Promise<MemoryTaskBinding>;
}
export function rememberMemoryDefault(state:AppState){
  const runtime=state.lastSelectedRuntime;
  if((runtime==='codex'||runtime==='claude')&&state.lastModelTargetId){
    state.nativeMemoryDefaults??={};state.nativeMemoryDefaults[runtime]={targetId:state.lastModelTargetId,selection:state.lastModelSelection?structuredClone(state.lastModelSelection):undefined};
  }
}

/** Resolve the same stable target selected for new tasks, never the triggering chat's model. */
export function defaultMemoryTarget(state:AppState,targets:ModelTarget[],context?:Pick<Session,'projectId'|'projectPath'|'permissionMode'>,recipient?:MemoryRuntime):MemoryTaskBinding {
  const runtime=recipient??state.lastSelectedRuntime;
  const choice=runtime===state.lastSelectedRuntime?{targetId:state.lastModelTargetId,selection:state.lastModelSelection}:state.nativeMemoryDefaults?.[runtime as MemoryRuntime];
  const target=targets.find(t=>t.id===choice?.targetId&&t.runtime===runtime);
  if(!target?.ready)throw Error('MEMORY_BACKGROUND_DEFAULT_UNAVAILABLE');
  const selection=choice?.selection??target.selection;
  if(!selection?.model||target.selection&&selection.model!==target.selection.model)throw Error('MEMORY_BACKGROUND_DEFAULT_UNAVAILABLE');
  const permission=rememberedPermission(state,context?.projectId??null,target.runtime);
  const restricted=context?.permissionMode==='read-only'||context?.permissionMode==='plan';
  return {binding:structuredClone(target.binding),modelSelection:structuredClone(selection),permissionMode:restricted?'read-only':permission,projectPath:context?.projectPath};
}
