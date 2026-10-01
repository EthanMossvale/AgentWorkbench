import path from 'node:path';
import type {AppState} from '../../../packages/contracts';
import type {ActivityImageRequest,ActivityImagesService} from '../../../packages/attachments/activity-images';
import type {AttachmentView} from '../../../packages/attachments/types';
import type {AttachmentStore} from './attachments';

export class ActivityImageReader implements ActivityImagesService {
  private pending=new Map<string,Promise<AttachmentView[]>>();
  constructor(private snapshot:()=>AppState,private update:(change:(state:AppState)=>void)=>Promise<unknown>,private attachments:AttachmentStore){}
  read(input:ActivityImageRequest):Promise<AttachmentView[]> {
    if(!input||typeof input.sessionId!=='string'||!input.sessionId||typeof input.activityId!=='string'||!input.activityId)return Promise.reject(Error('ACTIVITY_IMAGE_REQUEST_INVALID'));
    const key=JSON.stringify([input.sessionId,input.activityId]),existing=this.pending.get(key);
    if(existing)return existing;
    const result=this.load(input).finally(()=>{if(this.pending.get(key)===result)this.pending.delete(key);});
    this.pending.set(key,result);return result;
  }
  private source(input:ActivityImageRequest,state=this.snapshot()) {
    const session=state.sessions.find(value=>value.id===input.sessionId),activity=session?.activities?.find(value=>value.id===input.activityId);
    if(!session||!activity||activity.category!=='image'||activity.runtime!==session.binding.runtime)throw Error('ACTIVITY_IMAGE_NOT_FOUND');
    // A remote path is not evidence that the same path on this device is its image.
    const localMcp=session.binding.runtime==='claude'&&session.binding.accountRuntime==='native-owner'&&session.binding.executionId==='local-device'&&activity.toolName==='mcp__local_device__Read';
    if((session.binding.hostId||session.binding.egress==='vps')&&!localMcp)throw Error('ACTIVITY_IMAGE_REMOTE_UNAVAILABLE');
    const raw=activity.imagePaths??(activity.runtime==='codex'&&activity.input?[activity.input]:[]);
    const cwd=activity.cwd??session.projectPath;
    if(!raw.length||raw.length>10||raw.some(value=>typeof value!=='string'||value.length>4096||!value||/[\x00-\x1f]/.test(value)))throw Error('ACTIVITY_IMAGE_SOURCE_UNAVAILABLE');
    const paths=raw.map(value=>path.isAbsolute(value)?value:cwd&&path.isAbsolute(cwd)?path.resolve(cwd,value):value);
    if(paths.some(value=>!path.isAbsolute(value)))throw Error('ACTIVITY_IMAGE_SOURCE_UNAVAILABLE');
    return {activity,paths,workspaceRoot:session.projectPath??'',key:JSON.stringify([session.binding,session.projectPath,cwd,paths])};
  }
  private async load(input:ActivityImageRequest):Promise<AttachmentView[]> {
    const source=this.source(input);
    if(source.activity.viewedAttachments?.length){
      const views=await this.attachments.views(source.activity.viewedAttachments.map(item=>item.id));
      if(this.source(input).key!==source.key)throw Error('ACTIVITY_IMAGE_CHANGED');
      return views;
    }
    const views=await this.attachments.importViewedImages(source.paths,source.workspaceRoot);
    if(views.some(item=>!item.mime.startsWith('image/')))throw Error('ACTIVITY_IMAGE_SOURCE_UNAVAILABLE');
    await this.update(state=>{
      const current=this.source(input,state);if(current.key!==source.key)throw Error('ACTIVITY_IMAGE_CHANGED');
      current.activity.viewedAttachments=views.map(({preview,...item})=>item);
    });
    return views;
  }
}
