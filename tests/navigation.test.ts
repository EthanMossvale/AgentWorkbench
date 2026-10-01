import test from 'node:test';
import assert from 'node:assert/strict';
import { threadDeepLink,parseThreadDeepLink } from '../packages/navigation/index';
const id='12345678-1234-1234-1234-123456789abc';
test('stable deep links resolve only exact local thread identifiers',()=>{assert.equal(threadDeepLink(id),`agent-workbench://threads/${id}`);assert.equal(parseThreadDeepLink(threadDeepLink(id)),id);for(const bad of [`https://threads/${id}`,`agent-workbench://threads/${id}?prompt=execute`,`agent-workbench://threads/../${id}`,`agent-workbench://threads/${id}#ignored`,'agent-workbench://run/calc.exe','agent-workbench://threads/%2e%2e'])assert.equal(parseThreadDeepLink(bad),null);});
