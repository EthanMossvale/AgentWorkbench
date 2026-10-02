import { createHash, randomUUID } from 'node:crypto';
import type { SshHost } from '../../packages/contracts/index';
import { runSsh, validateSshHost, type SshRunner } from '../../packages/ssh-transport/index';
import {readOnlySsh} from '../../packages/ssh-transport/read-only';
import { DISCOVERY_COMMAND } from './discovery-script';
import { parseWorkspaceDiscovery } from './discovery-parser';
import type { WorkspaceDiscovery } from './discovery-types';
export { DISCOVERY_COMMAND } from './discovery-script';
export { parseWorkspaceDiscovery } from './discovery-parser';
export type { DiscoveredAccount, DiscoveredPublicKey, DiscoveredWorkspace, RuntimeDiscovery, RuntimeAccountStatus, RuntimeAccountDetails, RuntimeAccountCatalogEntry, WorkspaceDiscovery } from './discovery-types';

export async function discoverWorkspaces(host: SshHost, options: { runner?: SshRunner; now?: Date; signal?: AbortSignal } = {}): Promise<WorkspaceDiscovery> {
  validateSshHost(host);
  const observedAt = (options.now ?? new Date()).toISOString();
  const result = await readOnlySsh(host, DISCOVERY_COMMAND, { timeoutMs: 50_000, maxOutputBytes: 512 * 1024, signal: options.signal },options.runner);
  return parseWorkspaceDiscovery(result.stdout, host, observedAt);
}

export interface ReconcileAction { kind: 'adopt-account' | 'register-workspace'; username: string; workspaceId: string; ownerId: string }
export interface ReconcilePlan { id: string; hostId: string; ownerId: string; generation: string; expectedStateHash: string; actions: ReconcileAction[]; bindingHash: string; expiresAt: string }
export interface DesiredWorkspace { workspaceId: string; username: string; ownerId: string; alreadyRegistered?: boolean }
const connectionHash = (host: SshHost) => createHash('sha256').update(JSON.stringify({ hostname: host.hostname.toLowerCase(), port: host.port, username: host.username, identityFile: host.identityFile, knownHostsFile: host.knownHostsFile })).digest('hex');
interface VerifiedAdmin { token: string; hostId: string; ownerId: string; generation: string; connectionHash: string; expiresAt: number }
/** Host-only authority. Remote role metadata never grants administrator capability. */
export class HostControlService {
  private readonly admins = new Map<string, VerifiedAdmin>();
  private readonly plans = new Map<string, ReconcilePlan>();
  private readonly confirmations = new Set<string>();
  private readonly operations = new Map<string, { status: 'running' | 'complete' | 'uncertain'; completedSteps: number }>();
  private readonly locks = new Set<string>();
  constructor(private readonly runner: SshRunner = runSsh, private readonly now: () => number = Date.now) {}
  async verifyAdmin(host: SshHost): Promise<string> {
    validateSshHost(host);
    const result = await this.runner(host, 'id -u', { timeoutMs: 10_000, maxOutputBytes: 1024 });
    if (result.exitCode !== 0 || result.stdout.trim() !== '0') throw new Error('A renderer role is not authority: remote effective UID 0 was not verified.');
    const token = randomUUID(); this.admins.set(token, { token, hostId: host.id, ownerId: host.ownerId, generation: host.workspaceGeneration, connectionHash: connectionHash(host), expiresAt: this.now() + 5 * 60_000 }); return token;
  }
  private authorize(host: SshHost, token: string): void {
    const grant = this.admins.get(token);
    validateSshHost(host);
    if (!grant || grant.hostId !== host.id || grant.ownerId !== host.ownerId || grant.generation !== host.workspaceGeneration || grant.connectionHash !== connectionHash(host) || grant.expiresAt <= this.now()) throw new Error('Administrative authority is missing, expired or from a changed connection/revoked generation.');
  }
  plan(host: SshHost, token: string, discovery: WorkspaceDiscovery, desired: DesiredWorkspace[]): ReconcilePlan {
    this.authorize(host, token);
    if (discovery.hostId !== host.id || discovery.ownerId !== host.ownerId || discovery.generation !== host.workspaceGeneration || discovery.effectiveUid !== 0) throw new Error('Discovery binding does not match the verified administrative host.');
    const actions: ReconcileAction[] = [];
    const unique = new Set<string>();
    for (const item of desired) {
      if (unique.has(item.workspaceId)) throw new Error('Duplicate desired workspace ID.'); unique.add(item.workspaceId);
      if (!item.workspaceId || item.ownerId !== host.ownerId || !discovery.accounts.some(account => account.username === item.username)) throw new Error('Explicit ownership and an existing discovered account are required; account creation is not automatic.');
      if (!item.alreadyRegistered) actions.push({ kind: 'adopt-account', username: item.username, workspaceId: item.workspaceId, ownerId: item.ownerId });
    }
    const base = { id: randomUUID(), hostId: host.id, ownerId: host.ownerId, generation: host.workspaceGeneration, expectedStateHash: discovery.stateHash, actions, expiresAt: new Date(this.now() + 5 * 60_000).toISOString() };
    const plan = { ...base, bindingHash: createHash('sha256').update(JSON.stringify(base)).digest('hex') };
    this.plans.set(plan.id, structuredClone(plan)); return structuredClone(plan);
  }
  confirm(planId: string, bindingHash: string): void {
    const plan = this.plans.get(planId);
    if (!plan || plan.bindingHash !== bindingHash || Date.parse(plan.expiresAt) <= this.now()) throw new Error('Confirmation must match a current immutable plan.');
    this.confirmations.add(planId);
  }
  revokeGeneration(hostId: string, generation: string): void { for (const [token, admin] of this.admins) if (admin.hostId === hostId && admin.generation === generation) this.admins.delete(token); }
  async execute(host: SshHost, token: string, planId: string, bindingHash: string, currentState: () => Promise<string>, apply: (action: ReconcileAction, operationId: string) => Promise<void>): Promise<{ status: 'complete'; completedSteps: number }> {
    this.authorize(host, token);
    const plan = this.plans.get(planId);
    if (!plan || plan.bindingHash !== bindingHash || !this.confirmations.has(planId) || plan.hostId !== host.id || plan.generation !== host.workspaceGeneration || Date.parse(plan.expiresAt) <= this.now()) throw new Error('An exact confirmed plan is required.');
    const prior = this.operations.get(planId);
    if (prior?.status === 'complete') return { status: 'complete', completedSteps: prior.completedSteps };
    if (prior) throw new Error('Operation is running or uncertain; inspect state instead of replaying side effects.');
    if (this.locks.has(host.id)) throw new Error('Another management operation holds the host lock.');
    this.locks.add(host.id);
    let completedSteps = 0;
    try {
      if (await currentState() !== plan.expectedStateHash) throw new Error('The discovered state changed; refresh and confirm a new plan.');
      this.operations.set(planId, { status: 'running', completedSteps });
      for (const [index, action] of plan.actions.entries()) { this.authorize(host, token); await apply(structuredClone(action), `${plan.id}:${index}`); completedSteps++; this.operations.set(planId, { status: 'running', completedSteps }); }
      this.operations.set(planId, { status: 'complete', completedSteps }); return { status: 'complete', completedSteps };
    } catch (error) { if (this.operations.has(planId)) this.operations.set(planId, { status: 'uncertain', completedSteps }); throw error; }
    finally { this.locks.delete(host.id); }
  }
}
