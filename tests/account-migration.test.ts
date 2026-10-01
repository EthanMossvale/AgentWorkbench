import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {migrationManifest,verifyMigrationReceipt,adoptMigration,LegacyMigrationClient} from '../packages/remote-account-catalog/migration';
import {CODEX_REMOTE_BRIDGE} from '../services/codex-bridge/remote';
import {USAGE_REMOTE} from '../packages/account-usage/remote';
import {quotaNativeSource} from '../packages/workspace-control/quota-native-source';
import {REMOTE_CATALOG_COMMAND} from '../packages/remote-account-catalog';
import {StateStore,SecretStore} from '../apps/desktop/host/store';
import {WorkbenchController} from '../apps/desktop/host/controller';
import type {Session,SshHost} from '../packages/contracts';

const host:SshHost={id:'fixture',name:'Fixture',hostname:'fixture.invalid',port:22,username:'member',role:'workspace',identityFile:path.resolve('fixture-key'),knownHostsFile:path.resolve('fixture-hosts'),ownerId:'owner',workspaceGeneration:'g'};
const original='vps-account:old-authority/old-generation/codex/account/ag';
const target='vps-account:native-authority/native-generation/codex/account/ag';
const session=():Session=>({id:'00000000-0000-4000-8000-000000000001',title:'Original',createdAt:'2026-09-26T00:00:00Z',projectId:null,projectPath:'C:\\Fixture',group:'',pinned:false,archived:false,status:'uncertain',binding:{runtime:'codex',provider:'openai',accountRef:original,hostId:host.id,executionId:'local-device',egress:'vps',nativeSessionId:'00000000-0000-4000-8000-000000000002'},messages:[{id:'one',role:'user',original:'Preserved draft',submitted:'Preserved input',timestamp:'2026-09-26T00:00:00Z',demo:false}],nativeTurnId:'original-turn'});
const receipt=(s=session())=>({migrationId:'a'.repeat(64),sessionId:s.id,previousAccountRef:original,accountRef:target,threadId:s.binding.nativeSessionId!,turnId:s.nativeTurnId!,uncertain:true,environmentId:'local-device',cwd:s.projectPath!});

test('migration manifests contain only public bindings, and adoption preserves original history and uncertainty',()=>{
 const s=session(),before=structuredClone(s),manifest=migrationManifest(s,host);
 assert.equal(JSON.stringify(manifest).includes('Preserved'),false);
 s.nativeEnvironmentReceipt={threadId:s.binding.nativeSessionId!,environmentId:'local-device',cwd:s.projectPath!,runtimeVersion:'0.155.1',accountRef:original};
 adoptMigration(s,host,receipt(s));
 assert.deepEqual(s.messages,before.messages);assert.equal(s.binding.nativeSessionId,before.binding.nativeSessionId);assert.equal(s.nativeTurnId,before.nativeTurnId);assert.equal(s.status,'uncertain');assert.equal(s.binding.accountRuntime,'native-owner');assert.equal(s.binding.accountRef,target);assert.equal(s.nativeEnvironmentReceipt.accountRef,target);assert.equal(s.accountMigration?.previousAccountRef,original);
 assert.throws(()=>adoptMigration(s,host,receipt()),/旧 Codex/);
});

test('migration cannot change the account generation, thread, turn, device, directory or unresolved state',()=>{
 const s=session();
 for(const changed of [{accountRef:target+'-other'},{previousAccountRef:'other'},{threadId:'other'},{turnId:null},{uncertain:false},{environmentId:'other'},{cwd:'C:\\Other'},{sessionId:'other'}])assert.throws(()=>verifyMigrationReceipt({...receipt(),...changed},s,host));
 assert.deepEqual(s,session());
});

test('missing history identifiers and running legacy tasks cannot be turned into fresh conversations',()=>{
 const s=session();s.status='running';assert.throws(()=>migrationManifest(s,host));s.status='idle';delete s.binding.nativeSessionId;assert.throws(()=>migrationManifest(s,host),/原线程编号/);
});

test('member migration client uses only the owner receipt RPC and strips extra returned fields',async()=>{
 const calls:any[]=[];
 const client=new LegacyMigrationClient(async(_h,_cmd,options)=>{calls.push(JSON.parse(options!.stdin!));return {exitCode:0,signal:null,stderr:'',stdout:JSON.stringify({ok:true,value:{...receipt(),access_token:'must-not-escape'}})};});
 const value=await client.resolve(host,session());assert.deepEqual(value,receipt());assert.deepEqual(calls,[{protocol:1,method:'migration/resolve',params:{sessionId:session().id,accountRef:original}}]);
});

test('all executable remote paths omit credential brokering and default catalog has no legacy fallback',async()=>{
 for(const source of [CODEX_REMOTE_BRIDGE,USAGE_REMOTE,quotaNativeSource])for(const prohibited of ['chatgptAuthTokens',"'method':'tokens'",'cli_auth_credentials_store="ephemeral"','/run/codex-device-auth'])assert.ok(!source.includes(prohibited),prohibited);
 const encoded=REMOTE_CATALOG_COMMAND.match(/b64decode\('([^']+)'\)/)![1]!;
 const script=Buffer.from(encoded,'base64').toString();assert.ok(!script.includes("source is None and"));
 const bridge=await readFile('services/codex-bridge/connection.ts','utf8');assert.ok(!bridge.includes('CODEX_REMOTE_BRIDGE'));assert.match(bridge,/accountRuntime!=='native-owner'/);
});

test('controller adopts only a verified receipt, preserves messages across restart, and never submits a turn',async()=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'awb-migration-'));let controller:WorkbenchController|undefined;
 try{
  const store=new StateStore(directory);await store.load();const s=session();await store.update(state=>{state.hosts=[host];state.sessions=[s];});let copied='',resolves=0;
  controller=new WorkbenchController(store,new SecretStore(directory,{isEncryptionAvailable:()=>false,encryptString:()=>Buffer.alloc(0),decryptString:()=>''} as any),{pickDirectory:async()=>null,openPath:async()=>{},copy:v=>{copied=v;},nativeCapabilities:()=>[],accountMigration:{resolve:async()=>{resolves++;return receipt();}}},()=>{});
  await controller.call('session/migration-manifest',{sessionId:s.id});assert.equal(JSON.parse(copied).threadId,s.binding.nativeSessionId);assert.ok(!copied.includes('Preserved'));
  await controller.call('session/migrate-native',{sessionId:s.id});assert.equal(resolves,1);assert.equal(store.snapshot().sessions[0]!.binding.accountRef,target);assert.equal(store.snapshot().sessions[0]!.status,'uncertain');
  const restored=new StateStore(directory);await restored.load();assert.deepEqual(restored.snapshot().sessions[0]!.messages,s.messages);assert.equal(restored.snapshot().sessions[0]!.accountMigration?.previousAccountRef,original);
 }finally{await controller?.dispose();await rm(directory,{recursive:true,force:true});}
});
