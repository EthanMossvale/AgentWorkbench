import type { PluginServiceInfo } from './services';

/** Optional declarations are additive to SDK v1. Undeclared legacy code is unchecked. */
export interface PluginRequirements {
  host?: { min: string; before?: string };
  services?: { id: string; version: number; members: string[] }[];
}
export interface CompatibilityIssue {
  code: 'HOST_VERSION_UNSUPPORTED' | 'SERVICE_UNAVAILABLE' | 'SERVICE_CONTRACT_UNSUPPORTED' | 'SERVICE_MEMBER_UNAVAILABLE';
  service?: string; member?: string; expected?: number; actual?: number; repairable: boolean;
}
export interface PluginCompatibility { status: 'unchecked' | 'compatible' | 'blocked'; issues: CompatibilityIssue[] }
const versionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const idPattern = /^[a-z][a-z0-9./-]{0,119}$/;
export const validMember = (name: unknown): name is string => typeof name === 'string' && /^[a-zA-Z_$][\w$]{0,119}$/.test(name) && !['__proto__','constructor','prototype'].includes(name);
const compare = (a: string, b: string) => {
  const left=a.split('.').map(Number),right=b.split('.').map(Number);
  for(let i=0;i<3;i++)if(left[i]!==right[i])return left[i]!<right[i]!?-1:1;
  return 0;
};
export function validateRequirements(value: unknown): asserts value is PluginRequirements | undefined {
  if(value===undefined)return;
  const v=value as PluginRequirements;
  if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).some(k=>!['host','services'].includes(k)))throw Error('PLUGIN_REQUIREMENTS_INVALID');
  if(v.host!==undefined&&(!v.host||typeof v.host!=='object'||Array.isArray(v.host)||Object.keys(v.host).some(k=>!['min','before'].includes(k))||!versionPattern.test(v.host.min)||v.host.before!==undefined&&(!versionPattern.test(v.host.before)||compare(v.host.min,v.host.before)>=0)))throw Error('PLUGIN_REQUIREMENTS_INVALID');
  if(v.services!==undefined&&(!Array.isArray(v.services)||v.services.length>64||v.services.some(s=>!s||!idPattern.test(s.id)||!Number.isSafeInteger(s.version)||s.version<1||!Array.isArray(s.members)||s.members.length>100||s.members.some(m=>!validMember(m)))||new Set(v.services.map(s=>s.id)).size!==v.services.length))throw Error('PLUGIN_REQUIREMENTS_INVALID');
}
export function checkCompatibility(requirements: PluginRequirements | undefined, hostVersion: string, services: PluginServiceInfo[]): PluginCompatibility {
  if(!requirements)return {status:'unchecked',issues:[]};
  validateRequirements(requirements);
  const issues:CompatibilityIssue[]=[];
  if(requirements.host&&(!versionPattern.test(hostVersion)||compare(hostVersion,requirements.host.min)<0||requirements.host.before&&compare(hostVersion,requirements.host.before)>=0))issues.push({code:'HOST_VERSION_UNSUPPORTED',repairable:false});
  for(const required of requirements.services??[]) {
    const service=services.find(s=>s.id===required.id);
    if(!service){issues.push({code:'SERVICE_UNAVAILABLE',service:required.id,repairable:false});continue;}
    if(service.contractVersion!==required.version){
      const adapter=service.compatibility?.find(a=>a.version===required.version);
      issues.push({code:'SERVICE_CONTRACT_UNSUPPORTED',service:required.id,expected:required.version,actual:service.contractVersion,repairable:!!adapter&&required.members.every(m=>adapter.members.includes(m))});
      continue;
    }
    for(const member of required.members)if(!service.members.includes(member))issues.push({code:'SERVICE_MEMBER_UNAVAILABLE',service:required.id,member,repairable:false});
  }
  return {status:issues.length?'blocked':'compatible',issues};
}
