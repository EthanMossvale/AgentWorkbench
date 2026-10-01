import type {SshHost} from '../../packages/contracts';
import {runSsh,type SshRunner} from '../../packages/ssh-transport';
/** Verify the SSH login identity only. No OS/package/hardware inventory. */
export async function verifyWorkspaceMember(host:SshHost,runner:SshRunner=runSsh){
 if(host.role!=='workspace'||host.username==='root')throw Error('请选择成员工作空间。');
 const result=await runner(host,'id -un && id -u',{timeoutMs:15000,maxOutputBytes:1024});
 const [username,uid,...extra]=result.stdout.trim().split(/\r?\n/);
 if(result.exitCode!==0||username!==host.username||!uid||!/^\d+$/.test(uid)||Number(uid)<1000||extra.length)throw Error('SSH 成员身份未能核实。');
 return {username,uid:Number(uid)};
}
