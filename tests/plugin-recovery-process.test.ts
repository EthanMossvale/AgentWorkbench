import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {ownedProcessTree,stopOwnedWorkbench} from '../apps/desktop/host/plugin-recovery-process';
test('recovery checks creation identity, stops its process tree and tolerates already exited children',async()=>{
  const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore',windowsHide:true});
  const sibling=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore',windowsHide:true});
  try{
    await Promise.all([new Promise<void>(resolve=>child.once('spawn',resolve)),new Promise<void>(resolve=>sibling.once('spawn',resolve))]);
    const tree=await ownedProcessTree(child.pid!,process.pid),root=tree.find(p=>p.pid===child.pid)!;assert.ok(root);assert.ok(!tree.some(p=>p.pid===sibling.pid||p.pid===process.pid));
    await assert.rejects(stopOwnedWorkbench(child.pid!,process.pid,'different-creation-identity'),/PLUGIN_PARENT_IDENTITY_CHANGED/);
    assert.doesNotThrow(()=>process.kill(child.pid!,0));
    await stopOwnedWorkbench(child.pid!,process.pid,root.started);assert.doesNotThrow(()=>process.kill(sibling.pid!,0));
    await stopOwnedWorkbench(child.pid!,process.pid,root.started);
  }finally{child.kill();sibling.kill();}
});
