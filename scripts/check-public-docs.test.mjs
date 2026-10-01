import test from 'node:test';
import assert from 'node:assert/strict';
import { extractMethods, privacyIssues } from './check-public-docs.mjs';

test('privacy checks reject identifying paths, records and non-example endpoints without echoing values',()=>{
  for(const input of ['C:\\Users\\synthetic-person\\project','/home/synthetic-member/workspace','12345678-1234-1234-1234-123456789abc','203.1.2.3','someone@private.invalid','"sourceThread": "private"']){
    const findings=privacyIssues(input);assert.ok(findings.length);assert.ok(findings.every(item=>Object.keys(item).join(',')==='kind,line'));
  }
});
test('public placeholders, loopback, reserved examples, package versions and public hashes remain usable',()=>{
  assert.deepEqual(privacyIssues('<user-home> /home/<username>/workspace 127.0.0.1 192.0.2.10 198.51.100.20 203.0.113.1 a@example.com 2.1.283 abcdef0123456789'),[]);
});
test('method coverage follows switch, comparison and delegated array branches, excluding comments and other fields',()=>{
  assert.deepEqual(extractMethods(`// method === 'fake/comment'
    if (method !== 'model-api/save') fail();
    if (request.method === 'desktop/info') return {};
    switch(method){case 'session/create': break;}
    if (['legacy/write','legacy/delete'].includes(method)) throw Error();
    if (value === 'not/a-method') return;
    switch(other){case 'also/not-a-method': break;}`),['desktop/info','legacy/delete','legacy/write','model-api/save','session/create']);
});
