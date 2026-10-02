import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,realpathSync,existsSync,rmSync} from 'node:fs';
import os from 'node:os';import path from 'node:path';
import {initializeAppData,prepareAppData} from '../packages/app-data';
import {saveDataLocation} from '../packages/app-data/relocation';
const fixture=()=>{const root=mkdtempSync(path.join(os.tmpdir(),'awb-data-')),home=path.join(root,'home'),legacy=path.join(home,'AppData','Roaming','AgentWorkbench');mkdirSync(legacy,{recursive:true});return {root,home,legacy,close:()=>rmSync(root,{recursive:true,force:true})};};
test('data migration moves opaque stores and old sibling worktrees while preserving legacy path aliases',()=>{const f=fixture();try{
 const opaque=Buffer.from([0,255,19,22,31]);writeFileSync(path.join(f.legacy,'opaque.bin'),opaque);mkdirSync(f.legacy+'-worktrees');writeFileSync(path.join(f.legacy+'-worktrees','fixture.txt'),'unchanged');
 const result=prepareAppData(f.home,f.legacy);assert.equal(result.directory,path.join(f.home,'.agentworkbench'));assert.equal(result.migrated,true);assert.deepEqual(readFileSync(path.join(result.directory,'opaque.bin')),opaque);assert.equal(realpathSync(f.legacy),realpathSync(result.directory));assert.equal(readFileSync(path.join(result.directory,'worktrees','fixture.txt'),'utf8'),'unchanged');assert.equal(realpathSync(f.legacy+'-worktrees'),realpathSync(path.join(result.directory,'worktrees')));
 assert.equal(prepareAppData(f.home,f.legacy).migrated,false);
}finally{f.close();}});
test('conflicting destinations never merge or overwrite data and late failures roll back the first move',()=>{const f=fixture();try{
 writeFileSync(path.join(f.legacy,'old.bin'),'old');const dest=path.join(f.home,'.agentworkbench');mkdirSync(dest);writeFileSync(path.join(dest,'new.bin'),'new');assert.throws(()=>prepareAppData(f.home,f.legacy),/DESTINATION_CONFLICT/);assert.equal(readFileSync(path.join(f.legacy,'old.bin'),'utf8'),'old');assert.equal(readFileSync(path.join(dest,'new.bin'),'utf8'),'new');
 rmSync(dest,{recursive:true});mkdirSync(path.join(f.legacy,'worktrees'));writeFileSync(path.join(f.legacy,'worktrees','a'),'a');mkdirSync(f.legacy+'-worktrees');writeFileSync(path.join(f.legacy+'-worktrees','b'),'b');assert.throws(()=>prepareAppData(f.home,f.legacy),/DESTINATION_CONFLICT/);assert.equal(existsSync(dest),false);assert.equal(readFileSync(path.join(f.legacy,'old.bin'),'utf8'),'old');
}finally{f.close();}});
test('first start and explicit developer home use an absolute dedicated directory',()=>{const f=fixture();try{
 rmSync(f.legacy,{recursive:true});const custom=path.join(f.home,'custom');assert.equal(prepareAppData(f.home,f.legacy,custom).directory,custom);assert.ok(existsSync(custom));assert.throws(()=>prepareAppData(f.home,f.legacy,'relative'),/PATH_INVALID/);assert.throws(()=>prepareAppData(f.home,f.legacy,f.home),/PATH_INVALID/);
}finally{f.close();}});

test('overlapping custom roots are rejected without moving opaque data',()=>{const f=fixture();try{writeFileSync(path.join(f.legacy,'opaque'),'kept');for(const target of [path.join(f.legacy,'nested'),path.dirname(f.legacy),f.legacy+'-attachments'])assert.throws(()=>prepareAppData(f.home,f.legacy,target),/PATH_OVERLAP/);assert.equal(readFileSync(path.join(f.legacy,'opaque'),'utf8'),'kept');}finally{f.close();}});

test('installed startup preserves the selected directory across subsequent launches',()=>{const f=fixture();try{
 const chosen=path.join(f.root,'chosen'),installed={directory:path.join(f.root,'default'),locator:path.join(f.root,'location.json')};mkdirSync(chosen);writeFileSync(path.join(chosen,'payload'),'kept');saveDataLocation(installed.locator,{version:1,directory:chosen});
 const host={getPath:(name:'home'|'userData'|'temp')=>name==='home'?f.home:name==='temp'?f.root:f.legacy,setPath:()=>{},requestSingleInstanceLock:()=>true,releaseSingleInstanceLock:()=>{}};
 assert.equal(initializeAppData(host,undefined,installed)?.directory,chosen);
 assert.equal(initializeAppData(host,undefined,installed)?.directory,chosen);
 assert.equal(existsSync(installed.directory),false);
}finally{f.close();}});
