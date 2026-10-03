import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm,stat} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {AttachmentStore} from '../apps/desktop/host/attachments';
import {attachmentPrompt,apiAttachmentContent} from '../packages/attachments/input';
import {PluginRegistry} from '../packages/plugins-core';
import {encodeZip} from '../packages/native-resources/archive';

test('large native files stream verification, and API includes only transmitted media/text',async t=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'awb-attachment-channels-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const store=new AttachmentStore(path.join(root,'data'),undefined,[],undefined,{nativePaths:true});
 const inputs=[];for(let i=0;i<3;i++){const file=path.join(root,`large-${i}.txt`);await writeFile(file,'字'.repeat(8*1024*1024));inputs.push({filePath:file});}
 inputs.push({filePath:path.join(root,'sample.pdf')});await writeFile(inputs[3]!.filePath,'%PDF-1.7\nSynthetic');
 const items=await store.import(inputs);assert.equal(items.length,4);assert.ok(items.reduce((n,a)=>n+a.size,0)>50*1024*1024);assert.equal(items[0]!.storage,'source');
 const native=await store.payloads(items.map(a=>a.id),{channel:'native'});assert.ok(native.every(p=>p.dataOmitted&&p.data.length===0));assert.ok(!attachmentPrompt('Read files',native).includes('"text":""'));
 const api=await store.payloads(items.map(a=>a.id),{channel:'api'});assert.equal(api[0]!.data.length,0);assert.match(Buffer.from(api[3]!.data).toString(),/^%PDF/);
 for(const protocol of ['responses','chat-completions','anthropic-messages'] as const)assert.ok(JSON.stringify(apiAttachmentContent('Read',api,protocol)).includes(Buffer.from('%PDF-1.7\nSynthetic').toString('base64')));
 assert.equal((await stat(path.join(root,'data',items[0]!.id))).isDirectory(),true);
 await writeFile(inputs[0]!.filePath,'changed');await assert.rejects(store.payloads([items[0]!.id],{channel:'verify'}),/已变化/);
});

test('approved policy registration and method replacement change actual attachment consumers and restore on disable',async t=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'awb-payload-plugin-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const store=new AttachmentStore(path.join(root,'data'));const [item]=await store.import([{name:'note.txt',bytes:Buffer.from('Verified text')}]);
 const registry=new PluginRegistry(path.join(root,'plugins'));await registry.initialize();t.after(()=>registry.dispose());registry.services.register('actions.attachments',store);registry.services.register('attachments.payload-policies',store.payloadPolicies);
 const id='qa.payload',manifest={schemaVersion:1,apiVersion:1,id,name:'Payload fixture',version:'1.0.0',description:'Synthetic',capabilities:['host'],main:'main.mjs'};
 const source=`export function activate(api){api.onDispose(api.services.get('attachments.payload-policies').register({id:'plugin:'+api.id+'/metadata',includeData:()=>false}));api.services.intercept('actions.attachments','payloads',(next,ids)=>next(ids,{channel:'plugin:'+api.id+'/metadata'}));}`;
 const zip=path.join(root,'fixture.zip');await writeFile(zip,encodeZip([{name:'workbench.plugin.json',data:Buffer.from(JSON.stringify(manifest))},{name:'main.mjs',data:Buffer.from(source)}]));await registry.importZip(zip);const plugin=(await registry.list())[0]!;
 await registry.setEnabled(id,plugin.hash,true,true);assert.equal((await store.payloads([item!.id]))[0]!.dataOmitted,true);
 await registry.setEnabled(id,plugin.hash,false);assert.equal(Buffer.from((await store.payloads([item!.id]))[0]!.data).toString(),'Verified text');await assert.rejects(store.payloads([item!.id],{channel:'plugin:qa.payload/metadata'}),/UNAVAILABLE/);
 await registry.setEnabled(id,plugin.hash,true);assert.equal((await store.payloads([item!.id]))[0]!.dataOmitted,true);
});
