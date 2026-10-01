import test from 'node:test';
import assert from 'node:assert/strict';
import type {SshHost} from '../packages/contracts';
import {initialState} from '../apps/desktop/host/store';
import {retireSshOnlyConnections} from '../apps/desktop/host/workspace-connections';

test('retired SSH identities remove only matching workspace descriptors and preserve history',()=>{
 const state=initialState();
 const admin:SshHost={id:'admin',name:'Admin',hostname:'fixture.invalid',port:2222,username:'root',role:'admin',identityFile:'C:/fixture/key',knownHostsFile:'C:/fixture/known',ownerId:'owner',workspaceGeneration:'g'};
 const member:SshHost={...admin,id:'old',name:'Old workspace',username:'legacy',role:'workspace'};
 state.hosts=[admin,member,{...member,id:'new',username:'fresh'},{...member,id:'other-server',hostname:'other.invalid'},{...member,id:'other-owner',ownerId:'someone-else'},{...member,id:'other-port',port:22}];
 state.activeWorkspaceId='old';
 const sessions=structuredClone(state.sessions);
 retireSshOnlyConnections(state,admin,[{username:'legacy',uid:1000,home:'/home/legacy'}]);
 assert.deepEqual(state.hosts.map(h=>h.id),['admin','new','other-server','other-owner','other-port']);
 assert.equal(state.activeWorkspaceId,undefined);assert.deepEqual(state.sessions,sessions);
 assert.equal(state.hosts[0]?.identityFile,admin.identityFile);
});
