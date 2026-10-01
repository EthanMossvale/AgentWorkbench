export interface WorkspaceEnvironment { runtimes: ('codex' | 'claude')[]; defaultDirectory: string; env: Record<string, string> }
export interface AccountQuotaAllocation { weeklyPercent: number | null; fiveHourPercent: number | null; allowOverage: boolean }
export type AccountQuotaAllocations = Record<string, AccountQuotaAllocation>;
/** Legacy metadata is read for compatibility only; never converted to percentages. */
export interface WorkspaceBudget { period: 'month'; limit: number | null; unit: 'usd'; enforcement: 'unavailable' }
export interface WorkspaceDevice { id: string; label: string; fingerprint: string; publicKey: string; createdAt: string; status: 'active' | 'revoked' }
export interface WorkspaceInvitation { id: string; label: string; expiresAt: string; status: 'active' | 'redeemed' | 'revoked' | 'expired' }
export interface ManagedWorkspace {
  id: string; generation: string; revision: number; name: string; uid: number; username: string; root: string;
  environment: WorkspaceEnvironment; allowedAccountIds: string[]; accountQuotas?: AccountQuotaAllocations; budget?: WorkspaceBudget; nativeQuota: 'unknown';
  status: 'active' | 'suspended' | 'deleted'; devices: WorkspaceDevice[]; invites: WorkspaceInvitation[]; createdAt: string; updatedAt: string;
  controlState?:'ready'|'recovery-required';
  deletion?: {kind:'purged'|'ssh-retained';home:string;storageBytes:number};
}
export interface WorkspaceConnection { hostname: string; port: number; hostPublicKeys: string[] }
export interface SshOnlyMember {username:string;uid:number;home:string}
export interface StudioSnapshot { authorityId: string; generation: string; revision: number; workspaces: ManagedWorkspace[]; connection: WorkspaceConnection; enrollmentUrl: string; availability: 'ready' | 'unavailable'; reason?: string; transport?:'ssh';sshOnlyMembers?:SshOnlyMember[] }
export type StudioOperation = 'workspace/adopt' | 'workspace/create' | 'workspace/update' | 'workspace/suspend' | 'workspace/delete' | 'device/revoke' | 'invite/create' | 'invite/revoke';
export interface StudioPlanInput { expectedRevision: number; operation: StudioOperation; workspaceId?: string; values?: Record<string, unknown> }
export interface WorkspaceDestruction {mode:'destroy';username:string;uid:number;home:string;root:string;storageBytes:number}
export interface StudioPlan { planId: string; planHash: string; operation: StudioOperation; workspaceId?: string; expectedRevision: number; expiresAt: string; effects: string[]; deletion?:WorkspaceDestruction }
export interface WorkspaceInvite {
  schema: 'agent-workbench-invite'; version: 1; inviteId: string; token: string; expiresAt: string;
  authorityId: string; generation: string; workspaceId: string; workspaceGeneration: string; workspaceName: string;
  username: string; root: string; connection: WorkspaceConnection; enrollmentUrl: string;
}
export interface WorkspaceEnrollment {
  schema: 'agent-workbench-device'; version: 1; authorityId: string; generation: string; workspaceId: string;
  workspaceGeneration: string; workspaceName: string; username: string; root: string; deviceId: string;
  fingerprint: string; connection: WorkspaceConnection;
}
/** The host consumes invite once. Only inviteExportId may cross renderer IPC. */
export interface StudioApplyResult { operationId: string; state: 'applied' | 'failed' | 'uncertain'; revision: number; workspace?: ManagedWorkspace; effects: string[]; inviteExportId?: string }
export interface StudioWireApply extends Omit<StudioApplyResult, 'inviteExportId'> { invite?: WorkspaceInvite }
export interface WorkspaceImportPreview { previewId: string; workspaceName: string; username: string; hostname: string; port: number; expiresAt: string; authorityId: string; workspaceId: string; enrollmentUrl: string; resumeExistingDevice?: boolean; transport?: 'ssh' }
