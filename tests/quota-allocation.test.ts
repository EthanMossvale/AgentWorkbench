import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile, readdir} from 'node:fs/promises';
import path from 'node:path';
import {allocatedPercent, allocationError, validateAccountQuotas} from '../packages/workspace-control/quotas';
import type {ManagedWorkspace} from '../packages/workspace-control/types';
import {localizeControlEffect} from '../packages/workspace-control/effect-labels';
import {workspaceSshScript} from '../packages/workspace-control/ssh-control';
import {quotaNativeSource} from '../packages/workspace-control/quota-native-source';
import {nativeQuotaWindows} from '../apps/desktop/host/quota-accounting';
import {parseQuotaLedger} from '../packages/account-usage/ledger';

test('client allocation validation matches per-account percentage units and defaults borrowing on', () => {
  assert.deepEqual(validateAccountQuotas({one:{weeklyPercent:33,fiveHourPercent:0}},['one']),{one:{weeklyPercent:33,fiveHourPercent:0,allowOverage:true}});
  assert.throws(()=>validateAccountQuotas({two:{weeklyPercent:33,fiveHourPercent:null}},['one']));
  for(const bad of [-1,101,NaN,Infinity,33.333,'33']) assert.throws(()=>validateAccountQuotas({one:{weeklyPercent:bad,fiveHourPercent:null}},['one']));
  const spaces=[['a','active',33],['b','suspended',33],['c','deleted',100]].map(([id,status,weeklyPercent])=>({id,status,accountQuotas:{one:{weeklyPercent,fiveHourPercent:10,allowOverage:true}}})) as unknown as ManagedWorkspace[];
  assert.equal(allocatedPercent(spaces,'one','weeklyPercent'),66);
  assert.equal(allocatedPercent(spaces,'two','weeklyPercent'),0);
  assert.equal(allocationError(spaces,'one',{weeklyPercent:34,fiveHourPercent:null,allowOverage:true}),undefined);
  assert.match(allocationError(spaces,'one',{weeklyPercent:34.01,fiveHourPercent:null,allowOverage:true})!,/上限/);
});

test('VPS source and fixed effects remain ASCII while the desktop localizes quota preview', async () => {
  for(const file of (await readdir('services/vps-workspace-control')).filter(file=>file.endsWith('.py'))) assert.doesNotMatch(await readFile(path.join('services/vps-workspace-control',file),'utf8'),/[^\x00-\x7f]/,file);
  assert.doesNotMatch(quotaNativeSource,/[^\x00-\x7f]/);
  assert.doesNotMatch(workspaceSshScript({protocol:1,method:'workspace/list',params:{}},'fixture.invalid',22),/[^\x00-\x7f]/);
  assert.match(localizeControlEffect('awb-effect:'+JSON.stringify({code:'quota.allocate',accountId:'one',weeklyPercent:33,fiveHourPercent:20,allowOverage:true})),/周额度 33%.*5 小时额度 20%.*允许超限/);
});

test('native windows stay separate and quota ledgers strip untrusted extra fields', () => {
  assert.deepEqual(nativeQuotaWindows({rateLimits:{primary:{windowDurationMins:300,usedPercent:12,resetsAt:2000000000},secondary:{windowDurationMins:10080,usedPercent:30,resetsAt:2000600000}}}).map(w=>w.window),['fiveHour','weekly']);
  assert.deepEqual(nativeQuotaWindows({rateLimitsByLimitId:{other:{primary:{windowDurationMins:300,usedPercent:12,resetsAt:2000000000}}}}),[]);
  const value=parseQuotaLedger({accountId:'one',mode:'estimated',coverage:'workbench-observed',windows:[],token:'private',workspaceNames:{a:'Alpha'}},'one');
  assert.equal('token' in value,false);assert.deepEqual(value.workspaceNames,{a:'Alpha'});
  assert.throws(()=>parseQuotaLedger({...value,accountId:'other'},'one'));
});
