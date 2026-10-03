import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import {mkdtemp,mkdir,writeFile,rm,symlink,unlink} from 'node:fs/promises';
import {NativeSkillsService,skillMetadata} from '../packages/native-skills';
import {NativeResources} from '../apps/desktop/host/native-resources';
import {LocalClaudeContext} from '../services/claude-bridge/local-context';
import {encodeZip} from '../packages/native-resources/archive';

const put=async(file:string,data:string|Buffer)=>{await mkdir(path.dirname(file),{recursive:true});await writeFile(file,data);};
const markdown=(name:string,body='Fixture instructions')=>'---\nname: '+name+'\ndescription: Fixture\n---\n'+body;
async function fixture(t:{after:(fn:()=>Promise<void>)=>void}){
 const root=await mkdtemp(path.join(os.tmpdir(),'awb-cap-')),home=path.join(root,'home'),data=path.join(root,'data'),cwd=path.join(home,'project'),codexHome=path.join(home,'.codex'),claudeHome=path.join(home,'.claude');
 await mkdir(cwd,{recursive:true});const cleanups:(()=>Promise<unknown>)[]=[];t.after(async()=>{for(const cleanup of cleanups.reverse())await cleanup();await rm(root,{recursive:true,force:true});});
 const options={home,codexHome,claudeHome,projects:()=>[cwd],executable:async()=>undefined};
 const skills=new NativeSkillsService(data,options);await skills.initialize();
 const context=new LocalClaudeContext({cwd,directory:root,executable:path.join(root,'unused-claude'),env:{USERPROFILE:home,HOME:home,CLAUDE_CONFIG_DIR:claudeHome},signal:new AbortController().signal});cleanups.push(()=>context.close());
 return {root,home,data,cwd,codexHome,claudeHome,skills,context,options,cleanups,link:async(source:string,dest:string)=>{await symlink(source,dest,process.platform==='win32'?'junction':'dir');cleanups.push(()=>unlink(dest));}};
}
test('native and Claude catalogs discover deep, hidden and large skills without directory or file-count ceilings',async t=>{
 const f=await fixture(t),root=path.join(f.claudeHome,'skills'),deep=path.join(root,'.nested',...Array(12).fill('d'),'deep');
 await put(path.join(deep,'SKILL.md'),markdown('deep','大'.repeat(100000)));
 await put(path.join(deep,'references','nested','SKILL.md'),markdown('support-only'));
 await Promise.all(Array.from({length:5005},(_,i)=>mkdir(path.join(root,'empty'+i),{recursive:true})));
 await Promise.all(Array.from({length:520},(_,i)=>put(path.join(root,'s'+i,'SKILL.md'),markdown('s'+i))));
 await f.link(root,path.join(root,'loop'));await put(path.join(f.codexHome,'skills',...Array(11).fill('d'),'codex','SKILL.md'),markdown('codex'));
 const scan=await f.skills.scan();assert.equal(scan.skills.length,522);assert.deepEqual(scan.errors,[]);assert.ok(!scan.skills.some(s=>s.name==='support-only'));
 const catalog=await f.context.discover();assert.equal(catalog.skills.length,521);assert.ok(!catalog.warnings.some(w=>w.includes('DISCOVERY_LIMIT')));
 const skill=catalog.skills.find(s=>s.name==='deep')!;const plan=await f.context.loadSkill({id:skill.id,hash:skill.hash});assert.equal(plan.instructions,'大'.repeat(100000));
});
test('all project ancestors participate and long metadata remains exact',async t=>{
 const f=await fixture(t),cwd=path.join(f.cwd,...Array(70).fill('d'));await mkdir(cwd,{recursive:true});
 const name='n'.repeat(300),description='d'.repeat(40000),source='---\nname: '+name+'\ndescription: '+description+'\n---\nBody';
 assert.deepEqual(skillMetadata(source,'folder'),{name,description,userInvocable:true,dynamic:false});
 await put(path.join(f.cwd,'.claude','skills','ancestor','SKILL.md'),source);
 const skills=new NativeSkillsService(f.data,{...f.options,projects:()=>[cwd]});await skills.initialize();assert.equal((await skills.scan()).skills[0]!.name,name);
 const catalog=await f.context.discover(cwd);assert.equal(catalog.skills[0]!.description,description);
});
test('approved native skill extension consumes full sources through host read and restores on disable',async t=>{
 const f=await fixture(t),source=markdown('large','Exact body\n'+'文'.repeat(100000));
 const skillDir=path.join(f.codexHome,'skills','large');await put(path.join(skillDir,'SKILL.md'),source);
 const display='Display'.repeat(500),description='Description'.repeat(7000);await put(path.join(skillDir,'agents','openai.yaml'),'interface:\n  display_name: '+display+'\n  short_description: '+description+'\n');
 const host=new NativeResources(f.data,{openZip:async()=>null,saveZip:async()=>null},()=>[f.cwd],()=>{},f.home);host.cli.locate=async()=>undefined;await host.initialize();f.cleanups.push(()=>host.dispose());
 host.plugins.services.register('native.skills',host.skills,{version:1});
 const id='qa.skill-capacity',code="export function activate(api){api.services.intercept('native.skills','readMarkdown',async(next,...args)=>({...await next(...args),warning:'Extension read full source'}));api.registerCommand('read',p=>api.services.get('native.skills').readMarkdown(p.id,p.hash));}";
 const file=path.join(f.root,'plugin.zip');await writeFile(file,encodeZip([{name:'workbench.plugin.json',data:Buffer.from(JSON.stringify({schemaVersion:1,apiVersion:1,id,name:'Capacity fixture',version:'1.0.0',description:'Synthetic',capabilities:['host'],main:'main.mjs'}))},{name:'main.mjs',data:Buffer.from(code)}]));
 await host.plugins.importZip(file);const hash=(await host.plugins.list())[0]!.hash;await host.plugins.setEnabled(id,hash,true,true);
 const skill=(await host.skills.scan()).skills[0]!;assert.equal(skill.displayName,display);assert.equal(skill.shortDescription,description);
 const request={id:skill.id,hash:skill.hash},result=await host.call('native-skills/read',request) as any;assert.equal(result.markdown,source);assert.equal(result.warning,'Extension read full source');assert.equal((await host.plugins.command(id,'read',request) as any).markdown,source);
 const plan=await host.skills.planLinks({runtime:'claude',action:'connect',skills:[request]});assert.equal((await host.skills.applyLinks(plan.id)).items[0]!.status,'created');f.cleanups.push(()=>unlink(path.join(f.claudeHome,'skills','large')));
 await host.plugins.setEnabled(id,hash,false);assert.equal((await host.call('native-skills/read',request) as any).warning,undefined);
 await host.plugins.setEnabled(id,hash,true);assert.equal((await host.call('native-skills/read',request) as any).warning,'Extension read full source');
 await put(skill.path,source+'changed');await assert.rejects(host.call('native-skills/read',request),/changed/);
});
