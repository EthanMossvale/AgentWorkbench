import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,rmSync,cpSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {finishPendingRelocation,readDataLocation,relocateAppData,relocateLegacyRuntimeData,relocateClipboardData,saveDataLocation,validateDataDestination} from '../packages/app-data/relocation';

const fixture=()=>{const root=mkdtempSync(path.join(os.tmpdir(),'awb-relocate-')),source=path.join(root,'old'),target=path.join(root,'new'),locator=path.join(root,'location.json');mkdirSync(source);return {root,source,target,locator,close:()=>rmSync(root,{recursive:true,force:true})};};
test('profile-owned clipboard bytes move with references while unrelated cache remains',()=>{const f=fixture();try{
 const id='00000000-0000-4000-8000-000000000001',temp=path.join(f.root,'clipboard'),file=path.join(temp,id,'file-paste.txt'),metadata=path.join(f.source,'attachments',id,'metadata.json');
 mkdirSync(path.dirname(file),{recursive:true});writeFileSync(file,'clipboard');mkdirSync(path.dirname(metadata),{recursive:true});
 writeFileSync(metadata,JSON.stringify({id,storage:'clipboard',path:file,size:9,sha256:createHash('sha256').update('clipboard').digest('hex')}));
 writeFileSync(path.join(f.source,'state.json'),JSON.stringify({attachments:[{id,path:file}]}));writeFileSync(path.join(temp,'unrelated'),'keep');
 relocateClipboardData(f.source,temp);const moved=path.join(f.source,'clipboard-temp',id,'file-paste.txt');
 assert.equal(readFileSync(moved,'utf8'),'clipboard');assert.equal(existsSync(path.dirname(file)),false);assert.equal(readFileSync(path.join(temp,'unrelated'),'utf8'),'keep');
 assert.equal(JSON.parse(readFileSync(metadata,'utf8')).path,moved);assert.equal(JSON.parse(readFileSync(path.join(f.source,'state.json'),'utf8')).attachments[0].path,moved);
}finally{f.close();}});
test('managed paths move, external project paths remain, and old root disappears',()=>{const f=fixture();try{
 const external=path.join(f.root,'external');mkdirSync(external);writeFileSync(path.join(external,'keep'),'external');
 mkdirSync(path.join(f.source,'native-claude','workspaces','session'),{recursive:true});writeFileSync(path.join(f.source,'native-claude','workspaces','session','a'),'workspace');
 writeFileSync(path.join(f.source,'state.json'),JSON.stringify({version:1,projects:[{path:external}],sessions:[{projectPath:path.join(f.source,'native-claude','workspaces','session')},{projectPath:external}]}));
 relocateAppData(f.source,f.target,()=>saveDataLocation(f.locator,{version:1,directory:f.target}));
 const state=JSON.parse(readFileSync(path.join(f.target,'state.json'),'utf8'));
 assert.equal(state.sessions[0].projectPath,path.join(f.target,'native-claude','workspaces','session'));
 assert.equal(state.sessions[1].projectPath,external);assert.equal(state.projects[0].path,external);
 assert.equal(readFileSync(path.join(f.target,'native-claude','workspaces','session','a'),'utf8'),'workspace');
 assert.equal(existsSync(f.source),false);assert.equal(readDataLocation(f.locator)?.directory,f.target);
}finally{f.close();}});

test('cleanup resumes after partial deletion but never deletes changed files or an unverified target',()=>{const f=fixture();try{
 writeFileSync(path.join(f.source,'a'),'a');writeFileSync(path.join(f.source,'b'),'b');
 const backup=path.join(f.root,'backup');cpSync(f.source,backup,{recursive:true});relocateAppData(f.source,f.target);
 cpSync(backup,f.source,{recursive:true});rmSync(path.join(f.source,'a'));
 finishPendingRelocation(f.source,f.target);assert.equal(existsSync(f.source),false);
 cpSync(backup,f.source,{recursive:true});writeFileSync(path.join(f.source,'b'),'changed');
 assert.throws(()=>finishPendingRelocation(f.source,f.target),/COPY_INVALID/);assert.equal(readFileSync(path.join(f.source,'b'),'utf8'),'changed');
 writeFileSync(path.join(f.source,'b'),'b');writeFileSync(path.join(f.target,'b'),'damaged');
 assert.throws(()=>finishPendingRelocation(f.source,f.target),/COPY_INVALID/);assert.equal(readFileSync(path.join(f.source,'a'),'utf8'),'a');
}finally{f.close();}});

test('only owned path fields and receipt locations are rewritten, never message text or plugin data',()=>{const f=fixture();try{
 const original=path.join(f.source,'workspaces','one');
 writeFileSync(path.join(f.source,'state.json'),JSON.stringify({sessions:[{projectPath:original,messages:[{text:original,attachments:[{path:original}]}]}]}));
 mkdirSync(path.join(f.source,'memory-exchange'));writeFileSync(path.join(f.source,'memory-exchange','ledger.json'),JSON.stringify({deliveries:[{receipt:path.join(f.source,'memory-exchange','receipts','id.json')}]}));
 writeFileSync(path.join(f.source,'plugin-user-data.json'),JSON.stringify({path:original}));
 relocateAppData(f.source,f.target);
 const saved=JSON.parse(readFileSync(path.join(f.target,'state.json'),'utf8'));
 assert.equal(saved.sessions[0].messages[0].text,original);assert.equal(saved.sessions[0].projectPath,path.join(f.target,'workspaces','one'));
 assert.equal(JSON.parse(readFileSync(path.join(f.target,'memory-exchange','ledger.json'),'utf8')).deliveries[0].receipt,path.join(f.target,'memory-exchange','receipts','id.json'));
 assert.equal(JSON.parse(readFileSync(path.join(f.target,'plugin-user-data.json'),'utf8')).path,original);
}finally{f.close();}});

test('uncommitted interrupted migration and corrupt locator are preserved and stop startup',()=>{const f=fixture();try{
 writeFileSync(path.join(f.source,'file'),'keep');cpSync(f.source,f.target,{recursive:true});
 assert.throws(()=>finishPendingRelocation(f.source,f.target),/RECOVERY_REQUIRED/);
 writeFileSync(f.locator,'{"version":2,"directory":false}');assert.throws(()=>readDataLocation(f.locator),/LOCATION_INVALID/);
 assert.equal(readFileSync(path.join(f.source,'file'),'utf8'),'keep');assert.equal(readFileSync(f.locator,'utf8'),'{"version":2,"directory":false}');
}finally{f.close();}});

test('conflicts and failed locator writes preserve the source',()=>{const f=fixture();try{
 writeFileSync(path.join(f.source,'file'),'original');mkdirSync(f.target);assert.throws(()=>validateDataDestination(f.source,f.target),/DESTINATION_CONFLICT/);
 rmSync(f.target,{recursive:true});assert.throws(()=>relocateAppData(f.source,f.target,()=>{throw Error('write failed');}),/MIGRATION_FAILED/);
 assert.equal(readFileSync(path.join(f.source,'file'),'utf8'),'original');assert.equal(existsSync(f.target),false);
}finally{f.close();}});

test('managed Git worktree is moved with repository metadata',()=>{const f=fixture();try{
 const repo=path.join(f.root,'repo'),tree=path.join(f.source,'worktrees','one');mkdirSync(repo);
 const git=(args:string[])=>execFileSync('git',['-C',repo,...args],{windowsHide:true,encoding:'utf8'});
 git(['init']);git(['config','user.email','test@example.invalid']);git(['config','user.name','Test']);writeFileSync(path.join(repo,'a'),'a');git(['add','a']);git(['commit','-m','initial']);mkdirSync(path.dirname(tree),{recursive:true});git(['worktree','add','--detach',tree]);
 writeFileSync(path.join(f.source,'worktree-state.json'),JSON.stringify({version:1,records:[{path:tree,cwd:tree,repositoryRoot:repo,status:'ready'}]}));
 relocateAppData(f.source,f.target);
 const moved=path.join(f.target,'worktrees','one'),saved=JSON.parse(readFileSync(path.join(f.target,'worktree-state.json'),'utf8'));
 assert.equal(saved.records[0].path,moved);assert.equal(execFileSync('git',['-C',moved,'rev-parse','--show-toplevel'],{encoding:'utf8'}).trim().replaceAll('\\','/').toLowerCase(),moved.replaceAll('\\','/').toLowerCase());assert.equal(existsSync(tree),false);
}finally{f.close();}});

test('registered worktrees at a custom root join the new drive without moving their external repository',()=>{const f=fixture();try{
 const repo=path.join(f.root,'repository'),tree=path.join(f.root,'custom-trees','one');mkdirSync(repo);
 const git=(args:string[])=>execFileSync('git',['-C',repo,...args],{windowsHide:true,encoding:'utf8'});
 git(['init']);git(['config','user.email','test@example.invalid']);git(['config','user.name','Test']);writeFileSync(path.join(repo,'a'),'original');git(['add','a']);git(['commit','-m','initial']);mkdirSync(path.dirname(tree),{recursive:true});git(['worktree','add','--detach',tree]);
 writeFileSync(path.join(tree,'untracked'),'keep');writeFileSync(path.join(f.source,'worktree-state.json'),JSON.stringify({version:1,root:path.dirname(tree),records:[{id:'one',path:tree,cwd:tree,repositoryRoot:repo,status:'ready'}]}));writeFileSync(path.join(f.source,'state.json'),JSON.stringify({projects:[{path:repo}],sessions:[{projectPath:tree}]}));
 relocateAppData(f.source,f.target);
 const saved=JSON.parse(readFileSync(path.join(f.target,'worktree-state.json'),'utf8')),moved=saved.records[0].path;
 assert.equal(saved.root,path.join(f.target,'worktrees'));assert.equal(existsSync(tree),false);assert.equal(readFileSync(path.join(moved,'untracked'),'utf8'),'keep');assert.equal(readFileSync(path.join(repo,'a'),'utf8'),'original');
 assert.equal(JSON.parse(readFileSync(path.join(f.target,'state.json'),'utf8')).sessions[0].projectPath,moved);assert.equal(execFileSync('git',['-C',moved,'rev-parse','HEAD'],{encoding:'utf8'}),git(['rev-parse','HEAD']));
}finally{f.close();}});

test('pending relocation removes only an unchanged source and can finish after cleanup',()=>{const f=fixture();try{
 writeFileSync(path.join(f.source,'state.json'),JSON.stringify({projectPath:path.join(f.source,'workspaces','one')}));
 relocateAppData(f.source,f.target);
 mkdirSync(f.source);writeFileSync(path.join(f.source,'different'),'changed');
 assert.throws(()=>finishPendingRelocation(f.source,f.target),/APP_DATA_COPY_INVALID/);
 rmSync(f.source,{recursive:true});finishPendingRelocation(f.source,f.target);
 assert.equal(existsSync(f.source),false);
}finally{f.close();}});

test('legacy managed workspace is copied, state is rewritten, and conflicts retain source',()=>{const f=fixture();try{
 const home=path.join(f.root,'home'),old=path.join(home,'.agent-workbench','workspaces');mkdirSync(path.join(old,'one'),{recursive:true});mkdirSync(f.target);
 writeFileSync(path.join(old,'one','file'),'content');writeFileSync(path.join(f.target,'state.json'),JSON.stringify({sessions:[{projectPath:path.join(old,'one')}]}));
 relocateLegacyRuntimeData(home,f.target);
 assert.equal(existsSync(old),false);
 assert.equal(JSON.parse(readFileSync(path.join(f.target,'state.json'),'utf8')).sessions[0].projectPath,path.join(f.target,'workspaces','one'));
 mkdirSync(path.join(old,'one'),{recursive:true});writeFileSync(path.join(old,'one','file'),'different');
 assert.throws(()=>relocateLegacyRuntimeData(home,f.target),/APP_DATA_LEGACY_MIGRATION_FAILED/);
 assert.equal(readFileSync(path.join(old,'one','file'),'utf8'),'different');
}finally{f.close();}});
