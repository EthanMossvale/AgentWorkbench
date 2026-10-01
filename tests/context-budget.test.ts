import test from 'node:test';
import assert from 'node:assert/strict';
import { ModelConnections } from '../apps/desktop/host/model-connections';

const service = () => new ModelConnections({
  snapshot: () => { throw Error('Unexpected state access'); },
  update: async () => { throw Error('Unexpected mutation'); },
  busy: () => { throw Error('Unexpected session access'); },
}, {} as never, async () => { throw Error('Unexpected network request'); });

test('public context-budget interface computes known and unknown budgets without credentials or side effects', async () => {
  const models = service();
  assert.deepEqual(await models.call('model-api/context-budget', { contextWindow: 258400 }), { window: 258400, compactAt: 232560, percent: 90, trigger: 'native' });
  assert.deepEqual(await models.call('model-api/context-budget', { contextWindow: 32001 }), { window: 32001, compactAt: 28800, percent: 90, trigger: 'native' });
  assert.deepEqual(await models.call('model-api/context-budget', {}), { window: null, compactAt: null, percent: 90, trigger: 'native' });
});
test('context-budget interface rejects invalid capacities and recovers after an invalid request', async () => {
  const models = service();
  for (const contextWindow of [null, '258400', 0, -1, 1.5, Infinity, NaN, 100000001]) {
    await assert.rejects(models.call('model-api/context-budget', { contextWindow }), /MODEL_CONTEXT_WINDOW_INVALID/);
  }
  assert.deepEqual(await models.call('model-api/context-budget', { contextWindow: 100000000 }), { window: 100000000, compactAt: 90000000, percent: 90, trigger: 'native' });
});
