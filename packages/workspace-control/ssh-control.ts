import {quotaNativeSource} from './quota-native-source';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {runSsh,type SshRunner} from '../ssh-transport';

// Source travels on stdin, avoiding Windows command-line limits. It is executed
// in memory; no daemon, listener, package install, or SSH configuration changes.
const sources=()=>Object.fromEntries(['security','destruction','provisioner','quota_accounting','control','quota_service','ssh_entry'].map(name=>{
  const root=typeof __dirname==='string'?path.join(__dirname,'workspace-control'):path.resolve('services/vps-workspace-control');
  return [name,readFileSync(path.join(root,name+'.py'),'utf8')];
}));
export const workspaceSshScript=(request:unknown,hostname:string,port:number)=>{
  const payload=Buffer.from(JSON.stringify({request,connection:{hostname,port},sources:{...sources(),quota_native:quotaNativeSource}})).toString('base64');
  return `import sys,json,base64,types\npayload=json.loads(base64.b64decode('${payload}'))\nfor name,source in payload['sources'].items():\n module=types.ModuleType(name);sys.modules[name]=module;exec(compile(source,name+'.py','exec'),module.__dict__)\nsys.modules['ssh_entry'].main(payload['request'],payload['connection'],payload['sources'])\n`;
};
export const runWorkspaceSsh:SshRunner=async(host,_command,options)=>{
  const request=JSON.parse(options?.stdin??'{}');
  return runSsh(host,'exec python3 -',{...options,stdin:workspaceSshScript(request,host.hostname,host.port),timeoutMs:request.method==='workspace/apply'?915_000:90_000});
};
