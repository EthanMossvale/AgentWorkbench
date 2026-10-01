/** All discovery data is metadata. Authentication material and private keys are never returned. */
export interface DiscoveredAccount { username: string; uid: number; home: string; shell: string; classification: 'ordinary-account-unmapped'; source: 'ssh-passwd'; observedAt: string }
export interface RuntimeAccountDetails { email?: string; name?: string; plan?: string; authMethod?: string; organization?: string }
export interface RuntimeAccountCatalogEntry { id: string; email?: string; name?: string; plan?: string; selected: boolean }
export interface RuntimeAccountStatus { status: 'authenticated' | 'unauthenticated' | 'configured' | 'unknown'; source?: string; selectedId?: string; details?: RuntimeAccountDetails; catalog?: RuntimeAccountCatalogEntry[] }
export interface RuntimeDiscovery {
  installed: 'yes' | 'no' | 'unknown'; path?: string; version?: string;
  config: { status: 'known' | 'absent' | 'unknown'; source?: string; values: Record<string, string | boolean | number> };
  account: RuntimeAccountStatus;
  nativeAccount?: RuntimeAccountStatus;
  warnings: string[];
}
export interface DiscoveredPublicKey { fingerprint: string; algorithm: string; comment?: string; source: string }
export interface DiscoveredWorkspace {
  id: string; name: string; username: string; uid: number; home: string; root: string;
  classification: 'known-device-workspace' | 'registered-workspace'; sources: string[];
  confidence: 'high' | 'conflict'; observedAt: string;
  ssh: { authorizedKeys: DiscoveredPublicKey[]; authorizationStatus: 'present' | 'absent' | 'unknown'; privateKeyStatus: 'not-inspected' };
  runtimes: { codex: RuntimeDiscovery; claude: RuntimeDiscovery }; warnings: string[];
}
export interface WorkspaceDiscovery {
  hostId: string; ownerId: string; generation: string; observedAt: string;
  effectiveUid: number; privilege: 'root' | 'user'; accounts: DiscoveredAccount[];
  registry: 'present-unread' | 'recognized' | 'absent-or-inaccessible'; publicKeyFingerprints: string[];
  workspaces: DiscoveredWorkspace[]; warnings: string[]; stateHash: string;
}
export const CODEX_CONFIG_FIELDS = ['model', 'model_provider', 'model_reasoning_effort', 'approval_policy', 'sandbox_mode', 'cli_auth_credentials_store', 'features.deferred_executor', 'memories.generate_memories', 'memories.use_memories'] as const;
export const CLAUDE_CONFIG_FIELDS = ['model', 'effortLevel', 'permissions.defaultMode'] as const;
