import { mkdir } from 'node:fs/promises';
import { dirname, isAbsolute, resolve } from 'node:path';
import type { Capability } from '../../packages/contracts/index.js';
import { CODEX_DEFERRED_BASELINE } from '../../packages/runtime-codex/index.js';
import { buildSshEnvironment } from '../../packages/ssh-transport/index.js';
import { createNativeProcess, ProcessSupervisor, type ProcessSpec } from '../remote-supervisor/index.js';

export interface LocalCodexExecutorConfig {
  executable: string; version: string; cwd: string; isolatedCodexHome: string; port: number;
  authorized: boolean;
}

export function buildLocalExecutorSpec(config: LocalCodexExecutorConfig, baseEnvironment: NodeJS.ProcessEnv = process.env): ProcessSpec {
  if (!config.authorized) throw new Error('Explicit local executor authorization is required');
  for (const path of [config.executable, config.cwd, config.isolatedCodexHome]) if (!isAbsolute(path) || /[\0\r\n]/.test(path)) throw new Error('Executor paths must be explicit absolute paths');
  if (!Number.isInteger(config.port) || config.port < 1024 || config.port > 65535) throw new Error('Executor port must be an explicit non-privileged loopback port');
  const env = buildSshEnvironment(baseEnvironment);
  env.CODEX_HOME = resolve(config.isolatedCodexHome);
  // Use the real local environment without injecting Workbench account secrets.
  // 0.155.1 accepts --exit-on-stdin-close only with remote registration, not a loopback listener.
  return { executable: config.executable, args: ['exec-server', '--listen', `ws://127.0.0.1:${config.port}`], cwd: config.cwd, env, outputMode: 'opaque' };
}

/** This supervisor is not exposed as a renderer start endpoint. No auto-launch or tunnels. */
export class LocalExecutorSupervisor {
  private process?: ProcessSupervisor;
  diagnostic = '';
  constructor(readonly config: LocalCodexExecutorConfig) {}
  async start(): Promise<void> {
    if (this.process) throw new Error('Executor is already started; explicit new connection required');
    const spec = buildLocalExecutorSpec(this.config);
    await mkdir(dirname(this.config.isolatedCodexHome), { recursive: true });
    // Refuse pre-existing profiles rather than ever reusing a user's authenticated CODEX_HOME.
    await mkdir(this.config.isolatedCodexHome, { recursive: false });
    this.process = createNativeProcess(spec);
    this.process.on('diagnostic',value=>{this.diagnostic=(this.diagnostic+String(value)).slice(-4096);});
    this.process.on('fault',error=>{this.diagnostic=String(error);});
    await this.process.start();
    // Process spawn is NOT endpoint readiness and never marks an H capability verified.
  }
  async disconnect(): Promise<void> { if (this.process) await this.process.stop('executor-disconnect'); }
  get state(): string { return this.process?.state ?? 'new'; }
}

export function getLocalExecutorCapabilities(): Capability[] {
  return [{ id: 'local-executor-contract', label: '本机执行器监督', status: 'contract-tested', detail: '独立 CODEX_HOME、回环监听、无模型凭据环境及参数拒绝测试；未启动真实 exec-server、隧道或模型任务。' }];
}
