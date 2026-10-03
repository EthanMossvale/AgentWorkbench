import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {ProcessSupervisor,decodeNativeFrame} from '../services/remote-supervisor';
import {openOfficialClaudeTools,claudeLocalToolCatalog} from '../services/claude-bridge/tools';
import {PluginRegistry} from '../packages/plugins-core';
import {encodeZip} from '../packages/native-resources/archive';

test('approved catalog selection reaches native listing, calls and later refresh and restores on disable',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'awb-tool-catalog-')),plugins=new PluginRegistry(path.join(dir,'plugins'));await plugins.initialize();plugins.services.register('runtime.claude-tool-catalog',claudeLocalToolCatalog,{version:1});
 let catalog=['FutureRead','WebFetch','Agent','Skill'],process!:ProcessSupervisor;const calls:string[]=[];
 class Fixture extends ProcessSupervisor {
  override async start(){this.state='running';}
  frame(value:unknown){this.emit('frame',decodeNativeFrame(Buffer.from(JSON.stringify(value)+'\n')));}
  override async write(value:any){if(value.id===undefined)return;if(value.method==='tools/call')calls.push(value.params.name);this.frame({jsonrpc:'2.0',id:value.id,result:value.method==='tools/list'?{tools:catalog.map(name=>({name,inputSchema:{type:'object'}}))}:value.method==='tools/call'?{content:[{type:'text',text:value.params.name}]}:{protocolVersion:'2024-11-05'}});}
  override async stop(reason='fixture'){this.state='closed';const result={reason,code:0,signal:null};this.emit('disconnect',result);return result;}
 }
 const tools=await openOfficialClaudeTools({directory:path.join(dir,'process'),executable:'synthetic',cwd:dir,env:{},signal:new AbortController().signal},spec=>process=new Fixture(spec));
 const id='qa.tool-catalog',manifest={schemaVersion:1,apiVersion:1,id,name:'Catalog fixture',version:'1.0.0',description:'Synthetic only',capabilities:['host'],main:'main.mjs'},code=`export function activate(api){const catalog=api.services.get('runtime.claude-tool-catalog');api.onDispose(catalog.register({id:'plugin:'+api.id+'/catalog',select:tools=>tools.filter(t=>t.name==='FutureRead'||t.name==='NewTool')}));api.services.intercept('runtime.claude-tool-catalog','select',(next,tools)=>next(tools).map(tool=>({...tool,description:'Registered catalog'})));}`;
 try{
  assert.deepEqual(tools.definitions.map(t=>t.name),['FutureRead','WebFetch']);await tools.call('FutureRead',{});await assert.rejects(tools.call('Agent',{}),/FORBIDDEN/);
  const file=path.join(dir,'fixture.zip');await writeFile(file,encodeZip([{name:'workbench.plugin.json',data:Buffer.from(JSON.stringify(manifest))},{name:'main.mjs',data:Buffer.from(code)}]));await plugins.importZip(file);const hash=(await plugins.list())[0]!.hash;await plugins.setEnabled(id,hash,true,true);
  assert.deepEqual((await tools.listTools!()).map(t=>t.name),['FutureRead']);assert.equal(tools.definitions[0]!.description,'Registered catalog');await assert.rejects(tools.call('WebFetch',{}),/FORBIDDEN/);
  catalog=['NewTool','WebSearch'];(process as Fixture).frame({jsonrpc:'2.0',method:'notifications/tools/list_changed'});assert.deepEqual((await tools.listTools!()).map(t=>t.name),['NewTool']);await tools.call('NewTool',{});
  await plugins.setEnabled(id,hash,false);assert.deepEqual((await tools.listTools!()).map(t=>t.name),['NewTool','WebSearch']);await tools.call('WebSearch',{});await plugins.setEnabled(id,hash,true);assert.deepEqual(tools.definitions.map(t=>t.name),['NewTool']);assert.deepEqual(calls,['FutureRead','NewTool','WebSearch']);
 }finally{await tools.close();await plugins.dispose();await rm(dir,{recursive:true,force:true});}
});
