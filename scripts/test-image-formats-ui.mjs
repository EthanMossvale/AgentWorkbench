import {_electron as electron} from 'playwright';
import electronPath from 'electron';
import {mkdir,writeFile,readFile,readdir} from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {encodeZip} from '../packages/native-resources/archive.ts';
const root=process.cwd(),output=path.join(root,'build/qa/image-formats-'+Date.now()),workspace=path.join(output,'workspace'),profile=path.join(output,'profile');
await mkdir(workspace,{recursive:true});
const env={...process.env,AGENT_WORKBENCH_TEST_DATA:profile,AGENT_WORKBENCH_TEST_HIDDEN:'1'};delete env.ELECTRON_RUN_AS_NODE;
let app,page;const errors=[],checks=[];
const call=(method,payload={})=>page.evaluate(({method,payload})=>window.workbench.call(method,payload),{method,payload});
try{
 app=await electron.launch({executablePath:electronPath,args:[root],cwd:root,env,timeout:45000});page=await app.firstWindow();page.setDefaultTimeout(20000);page.on('pageerror',e=>errors.push(e.message));await page.waitForFunction(()=>!!window.workbench);assert.equal(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].isVisible()),false);
 await app.evaluate(({clipboard,dialog},output)=>{globalThis.__copiedImages=0;clipboard.write=async()=>{globalThis.__copiedImages++;};dialog.showSaveDialog=async()=>({canceled:false,filePath:output+'/marked.png'});},output);
 const generated=await page.evaluate(()=>{
   const canvas=document.createElement('canvas');canvas.width=320;canvas.height=180;const c=canvas.getContext('2d');c.fillStyle='#589b98';c.fillRect(0,0,320,180);
   const results={};for(const type of ['png','jpeg','webp'])results[type]=canvas.toDataURL('image/'+type).split(',')[1];
   canvas.width=7000;canvas.height=6000;c.fillStyle='#b5d8d5';c.fillRect(0,0,7000,6000);results.large=canvas.toDataURL().split(',')[1];canvas.width=1;canvas.height=1;return results;
 });
 generated.gif='R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
 const inputs={};for(const [type,encoded] of Object.entries(generated)){inputs[type]=path.join(output,type+'.input');await writeFile(inputs[type],Buffer.from(encoded,'base64'));}
 inputs.oversize=path.join(output,'oversize.input');await writeFile(inputs.oversize,Buffer.concat([Buffer.from(generated.png,'base64'),Buffer.alloc(21*1024*1024)]));
 inputs.invalid=path.join(output,'invalid.input');await writeFile(inputs.invalid,Buffer.from(generated.png,'base64').subarray(0,30));
 const id='qa.image-formats',manifest={schemaVersion:1,apiVersion:1,id,name:'Image formats fixture',version:'1.0.0',description:'Synthetic only',capabilities:['host'],main:'main.mjs'};
 const main=`import {readFile} from 'node:fs/promises';import {nativeImage} from 'electron';export function activate(api){const images=api.services.get('images.generated');api.registerCommand('generate',async p=>images.receive({sessionId:'fixture',threadId:'fixture',turnId:'fixture',itemId:p.item,projectPath:p.root,result:(await readFile(p.file)).toString('base64')}));api.registerCommand('jpeg-decoder',()=>{api.onDispose(images.registerDecoder({id:'plugin:'+api.id+'/jpeg',decode:bytes=>{if(bytes[0]!==255||bytes[1]!==216)return;const image=nativeImage.createFromBuffer(Buffer.from(bytes));if(image.isEmpty())throw Error('Invalid JPEG');return {mime:'image/jpeg',extension:'jpeg',...image.getSize()};}}));});api.registerCommand('seed',p=>api.services.get('workbench.state').update(state=>{const s=state.sessions.find(s=>s.id===p.id);s.messages=[{id:'u',role:'user',original:'Synthetic image formats',attachments:p.files,timestamp:'2026-10-03T00:00:00Z',demo:true}];}));}`;
 const zip=path.join(output,'fixture.zip');await writeFile(zip,encodeZip([{name:'workbench.plugin.json',data:Buffer.from(JSON.stringify(manifest))},{name:'main.mjs',data:Buffer.from(main)}]));await call('extensions/import',{filePath:zip});const record=(await call('extensions/list')).find(p=>p.manifest.id===id);const toggle=enabled=>call('extensions/toggle',{id,hash:record.hash,enabled,...(enabled?{approveHost:true}:{})});await toggle(true);const activated=(await call('extensions/list')).find(p=>p.manifest.id===id);assert.equal(activated.enabled,true,JSON.stringify(activated));
 const generate=(type,item=type)=>call('extensions/command',{id,name:'generate',payload:{root:workspace,file:inputs[type],item}});
 const png=await generate('png'),jpeg=await generate('jpeg'),webp=await generate('webp'),gif=await generate('gif'),large=await generate('large'),oversize=await generate('oversize');
 for(const [type,attachment] of [['png',png],['jpeg',jpeg],['webp',webp],['gif',gif],['large',large],['oversize',oversize]])assert.deepEqual(await readFile(attachment.path),await readFile(inputs[type]));
 assert.ok(jpeg.path.endsWith('.jpg'));assert.equal(jpeg.mime,'image/jpeg');assert.ok(webp.path.endsWith('.webp'));assert.ok(gif.path.endsWith('.gif'));await call('attachments/copy-image',{id:webp.id});assert.equal(await app.evaluate(()=>globalThis.__copiedImages),1);assert.ok(oversize.size>20*1024*1024);await assert.rejects(generate('invalid'),/FORMAT_INVALID/);
 const before=await readdir(path.join(workspace,'generated_images'));await assert.rejects(generate('jpeg','png'),/RECORD_CHANGED/);assert.deepEqual(await readdir(path.join(workspace,'generated_images')),before);
 checks.push('real native/Chromium PNG/JPEG/WebP/GIF decode and WebP clipboard conversion, original bytes and extensions, >20 MiB and corrupt/replayed source integrity');
 await call('extensions/command',{id,name:'jpeg-decoder'});assert.ok((await generate('jpeg','plugin-jpeg')).path.endsWith('.jpeg'));await toggle(false);await toggle(true);assert.ok((await generate('jpeg','restored-jpeg')).path.endsWith('.jpg'));
 checks.push('approved decoder registration reaches the sink and disable restores core decoding');
 const session=await call('session/create',{runtime:'demo'});await call('extensions/command',{id,name:'seed',payload:{id:session.id,files:[jpeg,large]}});await page.getByTestId('sidebar-session-'+session.id).locator('.session-select').click();
 await page.getByRole('button',{name:'查看附件 '+jpeg.name,exact:true}).click();await page.locator('.attachment-full-image').waitFor();assert.equal(await page.locator('.attachment-full-image').evaluate(img=>img.complete&&img.naturalWidth===320),true);await page.getByRole('button',{name:'关闭图片预览',exact:true}).click();
 await page.getByRole('button',{name:'查看附件 '+large.name,exact:true}).click();await page.waitForFunction(()=>document.querySelector('.attachment-full-image')?.naturalWidth===7000);
 await call('attachments/copy-image',{id:large.id});assert.equal(await app.evaluate(()=>globalThis.__copiedImages),2);
 await page.getByRole('button',{name:'标注图片',exact:true}).click();const box=await page.locator('.image-annotation').boundingBox();await page.mouse.move(box.x+box.width*.4,box.y+box.height*.4);await page.mouse.down();await page.mouse.move(box.x+box.width*.6,box.y+box.height*.6,{steps:6});await page.mouse.up();
 await page.getByRole('button',{name:/保存标注|保存副本|另存/}).first().click();await page.getByRole('status').filter({hasText:'标注副本已保存'}).waitFor();await page.screenshot({path:path.join(output,'large-annotation.png')});
 assert.ok((await readFile(path.join(output,'marked.png'))).length>0);checks.push('actual JPEG viewer and 42-megapixel image copy/annotation without touching system clipboard');assert.deepEqual(errors,[]);console.log(JSON.stringify({passed:true,checks,output}));
}catch(error){await page?.screenshot({path:path.join(output,'failure.png')}).catch(()=>{});throw error;}
finally{await app?.close();await writeFile(path.join(output,'result.json'),JSON.stringify({checks,errors},null,2));}
