import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import os from 'node:os';import path from 'node:path';
import {StateStore,SecretStore} from '../apps/desktop/host/store';
import {WorkbenchController} from '../apps/desktop/host/controller';
import {RemoteAccountCatalogService} from '../packages/remote-account-catalog';
import {AccountUsageService} from '../packages/account-usage';
import {usableSharedAccount,selectedSharedAccount} from '../packages/account-selection';
import {PluginRegistry} from '../packages/plugins-core';import {encodeZip} from '../packages/native-resources/archive';
import type {AccountCatalog,SshHost} from '../packages/contracts';

test('broker persists independent global/workspace switches and Claude quota; native authorization enforces both',()=>{
 const program=String.raw`
import sys,types,tempfile,copy,json
try: import fcntl
except ImportError: sys.modules['fcntl']=types.SimpleNamespace()
sys.path.insert(0,sys.argv[1])
from broker import AccountBroker,BrokerError
from runtime import NativeAccountRuntime,RuntimeErrorCode
from usage import observe_claude_usage,read_claude_usage
with tempfile.TemporaryDirectory() as folder:
    policy={'schemaVersion':1,'revision':0,'authorityId':'a','generation':'g','workspaces':[{'workspaceId':name,'uid':uid,'enabled':True,'allowedAccountIds':['account'],'runtimes':['claude']} for uid,name in [(1000,'one'),(1001,'two')]]}
    cfg={'authorityId':'a','generation':'g','ownerUid':2000,'root':folder,'workspacePolicyFile':'/fixture/policy'}
    def make():return AccountBroker(cfg,policy_reader=lambda _:copy.deepcopy(policy))
    broker=make();account=broker.registry.add('account',{'status':'authenticated'},provider='claude')
    def call(uid,enabled,revision=0,**extra):return broker.dispatch(uid,{'protocol':1,'method':'account/set-enabled','params':dict(authorityId='a',generation='g',accountId='account',accountGeneration=account['generation'],expectedRevision=revision,enabled=enabled,**extra)})
    def denied(fn):
        try:fn();assert False,'Expected rejection'
        except (BrokerError,RuntimeErrorCode):pass
    runtime=NativeAccountRuntime(broker,cfg)
    call(1000,False);runtime.authorize(1001,'account');denied(lambda:runtime.authorize(1000,'account'))
    call(0,False);denied(lambda:runtime.authorize(1001,'account'));denied(lambda:call(0,True))
    call(1001,True);denied(lambda:runtime.authorize(1001,'account'))
    denied(lambda:call(1000,True,1,workspaceId='two'))
    call(0,True,1);runtime.authorize(1001,'account');denied(lambda:runtime.authorize(1000,'account'))
    broker=make();runtime=NativeAccountRuntime(broker,cfg);denied(lambda:runtime.authorize(1000,'account'));runtime.authorize(1001,'account')
    assert broker.registry.catalog('one')['accounts'][0]['workspaceEnabled'] is False
    assert broker.registry.catalog('two')['accounts'][0]['workspaceEnabled'] is True
    runtime.process_factory=lambda _:(_ for _ in ()).throw(AssertionError('Quota read must not start a CLI/model'))
    assert read_claude_usage(runtime,account)['pools']=={}
    for kind,u in [('five_hour',.25),('seven_day',.4)]:observe_claude_usage(runtime,account,{'type':'rate_limit_event','rate_limit_info':{'rateLimitType':kind,'utilization':u,'resetsAt':runtime.broker.now()+900},'private':'must-not-persist'})
    read=read_claude_usage(runtime,account)
    assert read['pools']['claude']['primary']['usedPercent']==25 and read['pools']['claude']['secondary']['usedPercent']==40
    observe_claude_usage(runtime,account,{'type':'rate_limit_event','rate_limit_info':{'rateLimitType':'five_hour','utilization':float('nan')}})
    assert read_claude_usage(runtime,account)==read
    broker=make();runtime=NativeAccountRuntime(broker,cfg);assert read_claude_usage(runtime,account)==read
    assert read_claude_usage(runtime,dict(account,generation='new'))['pools']=={}
    from pathlib import Path
    assert 'must-not-persist' not in ''.join(p.read_text() for p in Path(folder).glob('claude-usage-*.json'))
    call(1000,True,1);runtime.authorize(1000,'account')
    denied(lambda:runtime.usage(1000,{'authorityId':'a','generation':'g','accountId':'account','accountGeneration':account['generation'],'action':'redeem','requestId':'x'}))
print('OK')
`;
 const result=spawnSync('python',['-c',program,path.resolve('services/vps-account-broker')],{encoding:'utf8'});assert.equal(result.status,0,result.stdout+result.stderr);assert.match(result.stdout,/OK/);
});

test('disabled account remains in catalog but is never selected; quota read supports Claude without reset cards',async()=>{
 const host:SshHost={id:'h',name:'Fixture',hostname:'fixture.invalid',port:22,username:'root',role:'admin',identityFile:path.resolve('fixture-key'),knownHostsFile:path.resolve('fixture-hosts'),ownerId:'fixture',workspaceGeneration:'g'};
 const account={id:'account',generation:'identity',provider:'claude' as const,status:'authenticated' as const,observedAt:new Date().toISOString()};
 const catalog:AccountCatalog={source:'native-owner',availability:'ready',authorityId:'a',generation:'g',workspaceId:'one',revision:0,selectionRevision:0,selectedClaudeAccountId:'account',accounts:[account]};
 for(const fields of [{enabled:false},{workspaceEnabled:false}]){assert.equal(usableSharedAccount({...account,...fields}),false);assert.equal(selectedSharedAccount({...catalog,accounts:[{...account,...fields}]},'claude'),undefined);}
 const service=new AccountUsageService(os.tmpdir(),async()=>({exitCode:0,signal:null,stderr:'',stdout:JSON.stringify({ok:true,value:{observedAt:100,pools:{claude:{limitName:'Claude',primary:{usedPercent:25,windowDurationMins:300},secondary:{usedPercent:40,windowDurationMins:10080}}}}})}));
 const receipt=await service.read({...host,role:'workspace',username:'fixture'},catalog,'account');assert.equal(receipt.pools[0]?.primary?.usedPercent,25);assert.equal(receipt.observedAt,new Date(100000).toISOString());assert.equal(receipt.cardsSupported,false);await assert.rejects(service.prepare(host,catalog,'account','unused'),/不支持/);await assert.rejects(service.redeem({...host,role:'workspace',username:'fixture'},catalog,'11111111-1111-4111-8111-111111111111'),/确认无效/);await service.dispose();
});

test('approved plugin intercepts production catalog enable command; disable/re-enable releases replacement',async()=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'awb-account-switch-')),store=new StateStore(directory);await store.load();
 const host:SshHost={id:'h',name:'Fixture',hostname:'fixture.invalid',port:22,username:'root',role:'admin',identityFile:path.resolve('fixture-key'),knownHostsFile:path.resolve('fixture-hosts'),ownerId:'fixture',workspaceGeneration:'g'};
 const catalog:AccountCatalog={source:'native-owner',availability:'ready',authorityId:'a',generation:'g',workspaceId:'administrator',revision:0,selectionRevision:0,accounts:[{id:'account',generation:'identity',provider:'claude',status:'authenticated',observedAt:new Date().toISOString(),enabled:true,accessRevision:0}]};
 await store.update(s=>{s.hosts=[host];s.accountCatalogs={h:catalog};});let mutations=0;
 const service=new RemoteAccountCatalogService({runner:async(_host,_command,options)=>{const req=JSON.parse(options!.stdin!);if(req.method==='account/set-enabled'){mutations++;assert.equal(req.params.accountGeneration,'identity');catalog.accounts[0]!.enabled=req.params.enabled;catalog.accounts[0]!.accessRevision!++;}return {exitCode:0,signal:null,stderr:'',stdout:JSON.stringify({ok:true,value:catalog})};}});
 const quota=new AccountUsageService(directory,async()=>({exitCode:0,signal:null,stderr:'',stdout:JSON.stringify({ok:true,value:{pools:{claude:{primary:{usedPercent:12.5,windowDurationMins:300}}}}})}));
 const controller=new WorkbenchController(store,new SecretStore(directory,{encrypt:()=>{throw Error('No secrets');},decrypt:()=>''}),{pickDirectory:async()=>null,openPath:async()=>{},copy:()=>{},nativeCapabilities:()=>[],accountCatalog:service,accountUsage:quota},()=>{});
 const plugins=new PluginRegistry(path.join(directory,'plugins'));await plugins.initialize();for(const [id,s] of Object.entries(controller.developmentServices()))if(s)plugins.services.register(id,s,{version:1});plugins.connectHost(r=>controller.call(r.method,r.payload));
 const manifest={schemaVersion:1,apiVersion:1,id:'test.account-switch',name:'Switch fixture',version:'1.0.0',description:'Synthetic lifecycle',capabilities:['host'],main:'main.mjs'};
 const source="export function activate(api){let hits=0;api.onDispose(api.services.intercept('accounts.catalog','setEnabled',(next,...args)=>{hits++;return next(...args);}));api.onDispose(api.services.intercept('actions.account-usage','read',async(next,...args)=>({...await next(...args),reason:'plugin quota receipt'})));api.registerCommand('quota',p=>api.call('accounts/usage',p));api.registerCommand('hits',()=>hits);api.registerCommand('toggle',p=>api.call('accounts/set-enabled',p));}";
 const zip=path.join(directory,'plugin.zip');await writeFile(zip,encodeZip([{name:'workbench.plugin.json',data:Buffer.from(JSON.stringify(manifest))},{name:'main.mjs',data:Buffer.from(source)}]));await plugins.importZip(zip);const record=(await plugins.list())[0]!;
 try{await plugins.setEnabled(manifest.id,record.hash,true,true);const receipt=await plugins.command(manifest.id,'quota',{id:'h',accountId:'account'}) as any;assert.equal(receipt.pools[0].primary.usedPercent,12.5);assert.equal(receipt.reason,'plugin quota receipt');await plugins.command(manifest.id,'toggle',{id:'h',accountId:'account',accountGeneration:'identity',enabled:false,expectedRevision:0});assert.equal(await plugins.command(manifest.id,'hits',{}),1);assert.equal(store.snapshot().accountCatalogs!.h!.accounts[0]!.enabled,false);await plugins.setEnabled(manifest.id,record.hash,false);assert.equal((await controller.call('accounts/usage',{id:'h',accountId:'account'}) as any).reason,undefined);await controller.call('accounts/set-enabled',{id:'h',accountId:'account',accountGeneration:'identity',enabled:true,expectedRevision:1});assert.equal(mutations,2);await plugins.setEnabled(manifest.id,record.hash,true);assert.equal((await plugins.command(manifest.id,'quota',{id:'h',accountId:'account'}) as any).reason,'plugin quota receipt');await plugins.command(manifest.id,'toggle',{id:'h',accountId:'account',accountGeneration:'identity',enabled:false,expectedRevision:2});assert.equal(await plugins.command(manifest.id,'hits',{}),1);}
 finally{await plugins.dispose();await controller.dispose();await rm(directory,{recursive:true,force:true});}
});


test('desktop default catalog service receives enable calls without an injected HostActions catalog',async()=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'awb-default-catalog-')),store=new StateStore(directory);await store.load();
 const host:SshHost={id:'h',name:'Fixture',hostname:'fixture.invalid',port:22,username:'root',role:'admin',identityFile:path.resolve('fixture-key'),knownHostsFile:path.resolve('fixture-hosts'),ownerId:'fixture',workspaceGeneration:'g'};
 const catalog:AccountCatalog={source:'native-owner',availability:'ready',authorityId:'a',generation:'g',workspaceId:'administrator',revision:0,selectionRevision:0,accounts:[{id:'account',generation:'identity',provider:'claude',status:'authenticated',observedAt:new Date().toISOString()}]};
 await store.update(s=>{s.hosts=[host];s.accountCatalogs={h:catalog};});
 const controller=new WorkbenchController(store,new SecretStore(directory,{encrypt:()=>{throw Error('No secrets');},decrypt:()=>''}),{pickDirectory:async()=>null,openPath:async()=>{},copy:()=>{},nativeCapabilities:()=>[]},()=>{});
 const service=controller.developmentServices()['accounts.catalog'] as RemoteAccountCatalogService;let changed=false;assert.equal(typeof service.setEnabled,'function');
 service.setEnabled=async(_host,input)=>{changed=true;catalog.accounts[0]!.enabled=input.enabled;return catalog;};service.list=async()=>catalog;
 try{await controller.call('accounts/set-enabled',{id:'h',accountId:'account',accountGeneration:'identity',enabled:false,expectedRevision:0});assert.equal(changed,true);assert.equal(store.snapshot().accountCatalogs!.h!.accounts[0]!.enabled,false);}finally{await controller.dispose();await rm(directory,{recursive:true,force:true});}
});
