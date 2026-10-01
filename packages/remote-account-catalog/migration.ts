import type {Session,SshHost} from '../contracts';
import {runSsh,type SshRunner,validateSshHost} from '../ssh-transport';
import {NATIVE_OWNER_CLIENT} from './native-client';

const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
function accountParts(value:string){
 if(!value.startsWith('vps-account:'))throw Error('旧账号引用无法核实。');
 const parts=value.slice(12).split('/').map(decodeURIComponent);
 if(parts.length!==5||parts[2]!=='codex'||parts.some(p=>!/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(p)))throw Error('旧账号引用无法核实。');
 return parts;
}
export function migrationManifest(session:Session,host:SshHost){
 if(session.binding.runtime!=='codex'||session.binding.accountRuntime==='native-owner'||session.binding.hostId!==host.id||host.role!=='workspace'||session.status==='running'||!session.projectPath||!uuid.test(session.id)||session.binding.executionId!=='local-device')throw Error('仅可迁移已停止、绑定原账号和本机目录的旧 Codex 会话。');
 accountParts(session.binding.accountRef);
 if(session.messages.length&&!session.binding.nativeSessionId)throw Error('此会话缺少原线程编号，请先恢复原始回执；不会另开线程替代历史。');
 if(session.binding.nativeSessionId&&!uuid.test(session.binding.nativeSessionId))throw Error('原生线程编号无效。');
 return {version:1,sessionId:session.id,username:host.username,accountRef:session.binding.accountRef,threadId:session.binding.nativeSessionId??null,turnId:session.nativeTurnId??null,uncertain:session.status==='uncertain',environmentId:session.binding.executionId,cwd:session.projectPath};
}
export interface MigrationReceipt {migrationId:string;sessionId:string;previousAccountRef:string;accountRef:string;threadId:string|null;turnId:string|null;uncertain:boolean;environmentId:string;cwd:string;}
export function verifyMigrationReceipt(value:unknown,session:Session,host:SshHost):MigrationReceipt{
 const m=migrationManifest(session,host),r=value as MigrationReceipt;
 if(!r||typeof r!=='object'||typeof r.migrationId!=='string'||!/^[a-f0-9]{64}$/.test(r.migrationId)||r.previousAccountRef!==m.accountRef||r.sessionId!==m.sessionId||r.threadId!==m.threadId||r.turnId!==m.turnId||r.uncertain!==m.uncertain||r.environmentId!==m.environmentId||r.cwd!==m.cwd||typeof r.accountRef!=='string')throw Error('迁移回执与原会话不一致，原记录未改动。');
 const previous=accountParts(m.accountRef),next=accountParts(r.accountRef);
 if(next[3]!==previous[3]||next[4]!==previous[4])throw Error('迁移不能替换原账号或额度账本代次。');
 return {migrationId:r.migrationId,sessionId:r.sessionId,previousAccountRef:r.previousAccountRef,accountRef:r.accountRef,threadId:r.threadId,turnId:r.turnId,uncertain:r.uncertain,environmentId:r.environmentId,cwd:r.cwd};
}
export function adoptMigration(session:Session,host:SshHost,value:unknown){
 const receipt=verifyMigrationReceipt(value,session,host);
 // This is the sole explicit exception to ordinary immutable session binding.
 session.accountMigration={id:receipt.migrationId,previousAccountRef:receipt.previousAccountRef,migratedAt:new Date().toISOString()};
 session.binding.accountRef=receipt.accountRef;session.binding.accountRuntime='native-owner';
 if(session.nativeEnvironmentReceipt)session.nativeEnvironmentReceipt.accountRef=receipt.accountRef;
 session.nativeApprovals=[];delete session.nativeError;
 if(!receipt.uncertain)session.status='blocked';
 return receipt;
}
export class LegacyMigrationClient{
 constructor(private runner:SshRunner=runSsh){}
 async resolve(host:SshHost,session:Session){
  validateSshHost(host);migrationManifest(session,host);
  const script=NATIVE_OWNER_CLIENT+`\nimport sys\ntry:\n print(json.dumps(native_owner_request(json.loads(sys.stdin.buffer.readline(8193)))))\nexcept Exception:\n print('{"ok":false,"error":"MIGRATION_UNAVAILABLE"}')\n`;
  const command=`exec python3 -c "import base64;exec(base64.b64decode('${Buffer.from(script).toString('base64')}'))"`;
  const result=await this.runner(host,command,{stdin:JSON.stringify({protocol:1,method:'migration/resolve',params:{sessionId:session.id,accountRef:session.binding.accountRef}})+'\n',timeoutMs:25000,maxOutputBytes:16384});
  if(result.exitCode!==0)throw Error('原生账号服务不可用，迁移回执尚未核实。');
  const response=JSON.parse(result.stdout);
  if(response?.ok!==true)throw Error('管理员尚未完成此会话的原生账号与历史迁移，或空间授权已变化。原历史仍保留。');
  return verifyMigrationReceipt(response.value,session,host);
 }
}
