import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,linkSync,lstatSync} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {restrictPrivatePath,privateAclFailure} from '../packages/ssh-transport/private-files';
import {relocateAppData} from '../packages/app-data/relocation';
const fixture=()=>mkdtempSync(path.join(os.tmpdir(),'awb-key-acl-'));
const keygen=path.join(process.env.SystemRoot||'C:/Windows','System32/OpenSSH/ssh-keygen.exe');
const run=(exe:string,args:string[])=>execFileSync(exe,args,{windowsHide:true,stdio:'pipe',encoding:'utf8'});
test('managed private files reject hard links and directories',()=>{const root=fixture();try{const file=path.join(root,'key');writeFileSync(file,'synthetic');linkSync(file,path.join(root,'alias'));assert.throws(()=>restrictPrivatePath(file,'file'),/SSH_PRIVATE_PATH_INVALID/);assert.throws(()=>restrictPrivatePath(root,'file'),/SSH_PRIVATE_PATH_INVALID/);}finally{rmSync(root,{recursive:true,force:true});}});
test('private ACL failures keep the local reason instead of a bare code',()=>{
 assert.equal(privateAclFailure({status:1,stderr:'noise\r\nAWB_ACL_ERROR System.UnauthorizedAccessException: Attempted to perform an unauthorized operation.\r\n'}),'System.UnauthorizedAccessException: Attempted to perform an unauthorized operation.');
 assert.equal(privateAclFailure({status:1,stderr:'\n  Set-Acl : denied\n'}),'Set-Acl : denied');
 assert.match(privateAclFailure({code:'ETIMEDOUT',signal:'SIGTERM'}),/did not finish within 60s/);
 assert.match(privateAclFailure({code:'EACCES'}),/could not start \(EACCES\)/);
 assert.equal(privateAclFailure({status:3,stderr:''}),'PowerShell exited with code 3.');
});
test('Windows OpenSSH accepts repaired explicit ACLs and keys after real profile copies',{skip:process.platform!=='win32'},()=>{const root=fixture();try{
 const source=path.join(root,'source'),target=path.join(root,'target');mkdirSync(source);const device=path.join(source,'workspace-devices','fixture');mkdirSync(device,{recursive:true});restrictPrivatePath(device,'directory');const key=path.join(device,'device-key');run(keygen,['-q','-t','ed25519','-N','','-C','','-f',key]);
 const publicKey=readFileSync(key+'.pub','utf8').trim(),icacls=path.join(process.env.SystemRoot!,'System32/icacls.exe');run(icacls,[key,'/grant:r','*S-1-1-0:R']);assert.throws(()=>run(keygen,['-y','-f',key]));
 restrictPrivatePath(key,'file');assert.equal(run(keygen,['-y','-f',key]).trim(),publicKey);
 writeFileSync(path.join(device,'known_hosts'),'synthetic pins');writeFileSync(path.join(source,'state.json'),JSON.stringify({hosts:[{identityFile:key,knownHostsFile:path.join(device,'known_hosts')}]}));relocateAppData(source,target);
 const migrated=JSON.parse(readFileSync(path.join(target,'state.json'),'utf8')).hosts[0];assert.equal(run(keygen,['-y','-f',migrated.identityFile]).trim(),publicKey);assert.equal(readFileSync(migrated.knownHostsFile,'utf8'),'synthetic pins');assert.ok(lstatSync(target).isDirectory());
}finally{rmSync(root,{recursive:true,force:true});}});
