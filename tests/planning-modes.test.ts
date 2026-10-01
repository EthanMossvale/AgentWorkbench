import assert from 'node:assert/strict';
import test from 'node:test';
import { EventEmitter } from 'node:events';
import { ClaudeControlClient, claudeReportedPermission } from '../packages/runtime-claude/control';
import { codexCollaborationParams, resolveCollaborationMode } from '../packages/session-core/planning';
import { codexTurnPermissionParams } from '../packages/runtime-codex';
import { nativeProviderLaunch } from '../packages/model-api/native-launch';
import { PeerMcpSession } from '../packages/collaboration-core/mcp';
import { approvalFields, approvalPresentation, claudeApprovalResult } from '../packages/native-approvals';

test('Codex planning changes collaboration without changing approval or sandbox policy', () => {
  for (const permission of ['default','read-only','full-access'] as const) {
    const params = {...codexTurnPermissionParams(permission),...codexCollaborationParams('plan',{model:'fixture',effort:'high'})};
    assert.equal(params.collaborationMode?.mode,'plan');
    assert.deepEqual(params.collaborationMode?.settings,{model:'fixture',reasoning_effort:'high',developer_instructions:null});
    assert.equal(params.approvalPolicy,codexTurnPermissionParams(permission).approvalPolicy);
    assert.deepEqual(params.sandboxPolicy,codexTurnPermissionParams(permission).sandboxPolicy);
  }
  assert.equal(codexCollaborationParams('default',{model:'fixture'}).collaborationMode?.mode,'default');
  assert.throws(()=>resolveCollaborationMode('claude','plan'),/INVALID/);
  assert.throws(()=>resolveCollaborationMode('codex','full-access'),/INVALID/);
  assert.throws(()=>codexCollaborationParams('plan'),/MODEL_REQUIRED/);
});

test('Claude provider uses process-local manual approval during planning, with no native settings writes', () => {
  const launch=nativeProviderLaunch('claude',{id:'fixture',model:'custom',name:'Fixture',enabled:true},{baseUrl:'http://127.0.0.1:9',token:'synthetic'},'plan',undefined,{});
  assert.equal(launch.args[launch.args.indexOf('--permission-mode')+1],'plan');
  assert.deepEqual(JSON.parse(launch.args[launch.args.indexOf('--settings')+1]!),{permissions:{disableAutoMode:'disable'},useAutoModeDuringPlan:false});
  assert.ok(!launch.args.includes('--dangerously-skip-permissions'));
});

test('Claude permission update waits for matching native acknowledgement and rejects a denial', async () => {
  const transport:any=new EventEmitter(), writes:any[]=[];transport.write=async(value:any)=>{writes.push(value);};
  const client=new ClaudeControlClient(transport,200), first=client.permissions('plan');
  let settled=false;void first.then(()=>{settled=true;});await Promise.resolve();assert.equal(settled,false);
  transport.emit('frame',{value:{type:'control_response',response:{request_id:'other',subtype:'success',response:{mode:'plan'}}}});
  await Promise.resolve();assert.equal(settled,false);
  const sent=writes[0];assert.deepEqual(sent.request,{subtype:'set_permission_mode',mode:'plan'});
  transport.emit('frame',{value:{type:'control_response',response:{request_id:sent.request_id,subtype:'success',response:{mode:'plan'}}}});await first;
  const denied=client.permissions('default');transport.emit('frame',{value:{type:'control_response',response:{request_id:writes[1].request_id,subtype:'error',error:'Denied by native policy'}}});
  await assert.rejects(denied,/CONTROL_REJECTED/);assert.equal(writes.length,2);client.dispose();
});

test('Claude disconnect, timeout and mismatched readback never retry permission requests', async () => {
  for(const outcome of ['disconnect','timeout','mismatch']){
    const transport:any=new EventEmitter(),writes:any[]=[];transport.write=async(value:any)=>{writes.push(value);};const client=new ClaudeControlClient(transport,5);
    const promise=client.permissions('default');
    if(outcome==='disconnect')transport.emit('disconnect');
    if(outcome==='mismatch')transport.emit('frame',{value:{type:'control_response',response:{request_id:writes[0].request_id,subtype:'success',response:{mode:'plan'}}}});
    await assert.rejects(promise,/UNCONFIRMED|CLOSED/);assert.equal(writes.length,1);client.dispose();
  }
  assert.equal(claudeReportedPermission('acceptEdits'),'accept-edits');assert.equal(claudeReportedPermission('auto'),undefined);assert.equal(claudeReportedPermission('__proto__'),undefined);
});

test('plan approval shows native plan text and preserves approve/continue-planning semantics',()=>{
  const request={tool_name:'ExitPlanMode',input:{plan:'## Fixture\nInspect then implement.'}};
  const fields=approvalFields('claude',request,'plan','receipt');
  assert.equal(approvalPresentation({id:'request',kind:'plan',turnId:'turn',...fields}).plan,request.input.plan);
  assert.equal(fields.options?.find(x=>x.id==='decline')?.label,'继续规划');
  assert.deepEqual(claudeApprovalResult(request,'accept'),{behavior:'allow',updatedInput:request.input,updatedPermissions:[{type:'setMode',destination:'session',mode:'default'}]});
  assert.equal(claudeApprovalResult(request,'decline').behavior,'deny');
});

test('MCP advertises read-only metadata only for the known read-only host tools',async()=>{
  const names=['workbench_list_sessions','workbench_read_session','workbench_list_projects','workbench_list_model_targets','workbench_send_message','workbench_create_session','plugin_mutation'];
  const mcp=new PeerMcpSession({definitions:names.map(name=>({name,description:name,inputSchema:{type:'object'}}))} as any);
  await mcp.handle({jsonrpc:'2.0',id:1,method:'initialize'});await mcp.handle({jsonrpc:'2.0',method:'notifications/initialized'});
  const result=await mcp.handle({jsonrpc:'2.0',id:2,method:'tools/list'}) as any;
  assert.deepEqual(result.result.tools.filter((t:any)=>t.annotations?.readOnlyHint).map((t:any)=>t.name),names.slice(0,4));mcp.dispose();
});
