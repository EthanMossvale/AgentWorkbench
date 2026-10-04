import { hostname } from 'node:os';
import { randomUUID } from 'node:crypto';
import { writeFile,readFile,lstat } from 'node:fs/promises';
import type { SshHost } from '../../../packages/contracts';
import { RemoteWorkspaceControl, workspaceHostIdentity } from '../../../packages/workspace-control';
import { WorkspaceEnrollmentService } from '../../../packages/workspace-control/enrollment';
import type { StudioApplyResult, StudioPlanInput, StudioWireApply, WorkspaceInvite } from '../../../packages/workspace-control/types';
import {workspaceExportTtl} from '../../../packages/workspace-control/export-policy';
import {PortableWorkspaceService} from '../../../packages/workspace-control/portable';

export interface WorkspaceManagementOptions {
  directory: string;
  pickImport(): Promise<string | null>;
  pickExport(filename: string): Promise<string | null>;
  remote?: RemoteWorkspaceControl;
  enrollment?: WorkspaceEnrollmentService;
}
/** Additive import result; the saved SSH member never contains this transient receipt. */
export interface WorkspacePreparation {
  ready:boolean;
  reason?:'catalog'|'account'|'runtime'|'bridge'|'changed';
}
export interface PreparedWorkspaceHost extends SshHost { preparation:WorkspacePreparation }
/** Invitation secrets live only in this host service and the explicitly saved file. */
export class WorkspaceManagementService {
  private remote: RemoteWorkspaceControl;
  private enrollment: WorkspaceEnrollmentService;
  private exports = new Map<string, { identity: string; invite: WorkspaceInvite }>();
  private stopped = false;
  private portable:PortableWorkspaceService;
  private localOperations = new Map<string,Promise<unknown>>();
  constructor(private options: WorkspaceManagementOptions) { this.remote = options.remote ?? new RemoteWorkspaceControl(); this.enrollment = options.enrollment ?? new WorkspaceEnrollmentService({ directory: options.directory }); this.portable=new PortableWorkspaceService(options.directory); }
  async dispose() { this.stopped = true; await Promise.allSettled([...this.localOperations.values()]); await Promise.allSettled([this.remote.dispose(), this.enrollment.dispose(),this.portable.dispose()]); this.exports.clear(); }
  private assertOpen() { if (this.stopped) throw new Error('工作台正在退出，无法继续管理操作。'); }
  busy(host: SshHost) { return this.remote.busy(host)||this.localOperations.has(workspaceHostIdentity(host)); }
  private exclusive<T>(host:SshHost,action:()=>Promise<T>){this.assertOpen();const id=workspaceHostIdentity(host);if(this.busy(host))throw Error('此 VPS 有管理操作正在等待回执。');const operation=Promise.resolve().then(action);this.localOperations.set(id,operation);void operation.finally(()=>this.localOperations.delete(id)).catch(()=>{});return operation;}
  list(host: SshHost) { this.assertOpen(); return this.remote.list(host); }
  plan(host: SshHost, input: StudioPlanInput) { this.assertOpen(); return this.remote.plan(host, input); }
  private publicResult(host: SshHost, value: StudioWireApply): StudioApplyResult {
    this.assertOpen();
    const { invite } = value;
    const result:StudioApplyResult={ operationId: value.operationId, state: value.state, revision: value.revision, effects: value.effects, ...(value.workspace ? { workspace: value.workspace } : {}) };
    if (invite) {
      if (JSON.stringify(result).includes(invite.token)) throw new Error('管理回执包含不应公开的邀请内容；请查询操作结果。');
      const exportId = randomUUID();
      if (this.exports.size >= 128) throw new Error('待保存邀请过多，请先保存或撤销已有邀请。');
      this.exports.set(exportId, { identity: workspaceHostIdentity(host), invite });
      result.inviteExportId = exportId;
    }
    return result;
  }
  async apply(host: SshHost, planId: string, planHash: string) { this.assertOpen();if(this.localOperations.has(workspaceHostIdentity(host)))throw Error('此 VPS 有设备授权正在等待回执。'); return this.publicResult(host, await this.remote.apply(host, planId, planHash)); }
  async operation(host: SshHost, operationId: string) { this.assertOpen(); return this.publicResult(host, await this.remote.operation(host, operationId)); }
  async exportInvite(host: SshHost, exportId: string): Promise<{ saved: boolean; path?: string }> {
    this.assertOpen(); const saved = this.exports.get(exportId);
    if (!saved || saved.identity !== workspaceHostIdentity(host)) throw new Error('此邀请已过期或不属于当前管理员连接，请重新生成。');
    const filename = `${saved.invite.workspaceName.replace(/[^\p{L}\p{N}_.-]/gu, '_').slice(0, 60) || 'workspace'}.awworkspace`;
    const file = await this.options.pickExport(filename); if (!file) return { saved: false };
    this.assertOpen();
    await writeFile(file, JSON.stringify(saved.invite, null, 2), { mode: 0o600 });
    return { saved: true, path: file };
  }
  exportConnection(admin:SshHost,member:SshHost,ttlSeconds=3600){workspaceExportTtl(ttlSeconds);return this.exclusive(admin,async()=>{this.assertOpen();const file=await this.options.pickExport(member.username+'.awworkspace');this.assertOpen();return file?this.portable.export(admin,member,file,ttlSeconds):{saved:false};});}
  async exportManaged(host:SshHost,workspaceId:string,ttlSeconds=3600){
    workspaceExportTtl(ttlSeconds);
    this.assertOpen();const snapshot=await this.remote.list(host),workspace=snapshot.workspaces.find(item=>item.id===workspaceId);
    if(snapshot.availability!=='ready'||!workspace||workspace.status!=='active'||workspace.controlState==='recovery-required')throw Error('请先读取有效的工作空间。');
    return this.exportConnection(host,{...host,id:workspace.id,name:workspace.name,username:workspace.username,role:'workspace',authorityId:snapshot.authorityId,authorityGeneration:snapshot.generation,remoteWorkspaceId:workspace.id,workspaceGeneration:workspace.generation},ttlSeconds);
  }
  connect(host:SshHost,workspaceId:string){return this.exclusive(host,()=>this.connectOnce(host,workspaceId));}
  private async connectOnce(host:SshHost,workspaceId:string){
    this.assertOpen();const snapshot=await this.remote.list(host),workspace=snapshot.workspaces.find(item=>item.id===workspaceId);
    if(snapshot.availability!=='ready'||!workspace||workspace.status!=='active'||workspace.controlState==='recovery-required')throw Error('请先读取有效的工作空间。');
    const label=hostname();
    return this.portable.connectDirect(host,{...host,name:workspace.name+' · '+label,username:workspace.username,role:'workspace',authorityId:snapshot.authorityId,authorityGeneration:snapshot.generation,remoteWorkspaceId:workspace.id,workspaceGeneration:workspace.generation},label);
  }
  async importPreview() { this.assertOpen(); const file = await this.options.pickImport(); this.assertOpen();if(!file)return null;const info=await lstat(file);if(!info.isFile()||info.isSymbolicLink()||info.size>65536)throw new Error('工作空间邀请文件无效。');const value=JSON.parse(await readFile(file,'utf8'));return value?.schema==='agent-workbench-ssh-invite'?this.portable.preview(file):this.enrollment.preview(file); }
  import(previewId: string, label: string) { this.assertOpen(); return this.portable.has(previewId)?this.portable.import(previewId,label):this.enrollment.import(previewId, label); }
}
export type WorkspaceManagementActions = Pick<WorkspaceManagementService, 'list' | 'plan' | 'apply' | 'operation' | 'exportInvite' | 'importPreview' | 'import' | 'busy' | 'dispose'> & Partial<Pick<WorkspaceManagementService,'exportConnection'|'exportManaged'|'connect'>>;
