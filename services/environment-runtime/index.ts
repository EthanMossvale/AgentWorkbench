import { createHash } from 'node:crypto';
import type { EnvironmentProfile } from '../../packages/contracts/index';
import { projectEnvironment } from '../environment-profile/index';

export interface MaterializationPolicy { approvedImages: string[]; approvedDependencies: string[]; isolation: 'vm' | 'container'; image: string; dependencies: string[] }
export interface MaterializationPlan { id: string; profileId: string; hostId: string; ownerId: string; status: 'requires-explicit-confirmation'; isolation: 'vm' | 'container'; image: string; dependencies: string[]; projectedFields: Record<string, string>; differences: string[]; forbiddenHostChanges: string[] }
/** Planning only. Does not install images, create VMs, alter OS settings or claim isolation is active. */
export function planMaterialization(profile: EnvironmentProfile, policy: MaterializationPolicy): MaterializationPlan {
  const projected = projectEnvironment(profile, { hostId: profile.hostId, ownerId: profile.ownerId });
  if (projected.freshness !== 'current') throw new Error('Materialization requires a current remote profile.');
  if (!policy.approvedImages.includes(policy.image) || policy.dependencies.some(item => !policy.approvedDependencies.includes(item))) throw new Error('Image/dependency policy does not authorize the requested plan.');
  if (policy.isolation !== 'vm' && policy.isolation !== 'container') throw new Error('Only a declared VM or container plan is supported.');
  const body = { profileId: profile.id, hostId: profile.hostId, ownerId: profile.ownerId, status: 'requires-explicit-confirmation' as const, isolation: policy.isolation, image: policy.image, dependencies: [...new Set(policy.dependencies)], projectedFields: Object.fromEntries(Object.entries(profile.fields).filter(([, field]) => field.status === 'known' && field.value !== null).map(([key, field]) => [key, field.value!])), differences: ['CPU, kernel, machine identity, public IP and GPU are not cloned.', policy.isolation === 'container' ? 'Containers share the host kernel and are not VM-equivalent isolation.' : 'VM provisioning and tool-boundary acceptance have not been executed.'], forbiddenHostChanges: ['global timezone', 'global locale', 'system accounts', 'network configuration', 'SSH configuration', 'native authentication'] };
  return { id: createHash('sha256').update(JSON.stringify(body)).digest('hex'), ...body };
}
