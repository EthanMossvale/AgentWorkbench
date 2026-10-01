import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {ProcessSupervisor} from '../services/remote-supervisor';

test('native memory completion closes owned tool descendants before the stdin owner can exit',async t=>{
  // The child intentionally inherits stdout, matching a native exec tool helper.
  // It exits on its own after five seconds so a failed assertion cannot leak it.
  const script=`const{spawn}=require('node:child_process');const child=spawn(process.execPath,['-e','setTimeout(()=>process.exit(0),5000)'],{stdio:['ignore',1,2],windowsHide:true});process.stdin.resume();process.stdin.on('end',()=>process.exit(0));child.once('spawn',()=>process.stdout.write(JSON.stringify({child:child.pid})+'\\n'));`;
  const runtime=new ProcessSupervisor({executable:process.execPath,args:['-e',script]});
  const ready=once(runtime,'frame');await runtime.start();await ready;t.after(()=>runtime.stop());
  const start=performance.now(),result=await runtime.stop('memory-task-completed');
  assert.equal(result.reason,'memory-task-completed');assert.equal(runtime.state,'closed');
  assert.ok(performance.now()-start<3000,'Cleanup waited for an orphaned tool to close inherited pipes');
});
