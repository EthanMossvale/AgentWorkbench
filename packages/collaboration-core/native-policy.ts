export interface NativeAgentPolicy {
  readonly mode: 'native';
}

export const DEFAULT_NATIVE_AGENT_POLICY: Readonly<NativeAgentPolicy> = Object.freeze({ mode: 'native' });
export const NATIVE_AGENT_POLICY_VERSIONS = Object.freeze({ codex: '0.155.1', claude: '2.1.281' });

/** Ignore legacy persisted workbench overrides; capacity and models belong to the native runtime. */
export function validateNativeAgentPolicy(value: unknown = undefined): Readonly<NativeAgentPolicy> {
  if (value === undefined) return DEFAULT_NATIVE_AGENT_POLICY;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Native agent policy must be an object.');
  const input = value as Record<string, unknown>;
  if (Object.keys(input).some(key => !['mode', 'maxConcurrentChildren', 'maxDepth', 'model'].includes(key))) throw new Error('Unknown native agent policy field.');
  return DEFAULT_NATIVE_AGENT_POLICY;
}

export interface NativeAgentPolicyPlan {
  runtime: 'codex' | 'claude';
  version: string;
  policy: Readonly<NativeAgentPolicy>;
  args: readonly string[];
  /** Native admission controls are not a host-enforced global token/concurrency budget. */
  strictGlobalLimit: false;
  limitations: readonly string[];
}

export function buildNativeAgentPolicyPlan(runtime: 'codex' | 'claude', version: string, value: unknown = undefined): NativeAgentPolicyPlan {
  if (runtime !== 'codex' && runtime !== 'claude') throw new Error('Unsupported native agent runtime.');
  if (version !== NATIVE_AGENT_POLICY_VERSIONS[runtime]) throw new Error('Native agent policy requires the verified pinned runtime version.');
  const policy = validateNativeAgentPolicy(value);
  const args: string[] = [];
  let limitations: string[];
  limitations = ['Child capacity, depth and model selection are managed by the native runtime.'];
  return Object.freeze({ runtime, version, policy, args: Object.freeze(args), strictGlobalLimit: false, limitations: Object.freeze(limitations) });
}
