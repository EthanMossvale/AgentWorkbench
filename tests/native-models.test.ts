import test from 'node:test';
import assert from 'node:assert/strict';
import {parseModels,parseContextUsage,validateModelSelection,applyNativeModelDefaults,parseEffectiveModel} from '../packages/runtime-codex/models';
test('native models expose only discovered effort and speed capabilities',()=>{
 const models=parseModels({data:[{id:'one',model:'one',displayName:'One',isDefault:true,supportedReasoningEfforts:[{reasoningEffort:'low'},{reasoningEffort:'high'},{reasoningEffort:'high'}],defaultReasoningEffort:'low',serviceTiers:[{id:'priority',name:'Fast',description:'Provider description'}]},{id:'hidden',model:'hidden',hidden:true},{id:null}]});
 assert.equal(models.length,1);assert.deepEqual(models[0]?.efforts,['low','high']);
 assert.deepEqual(validateModelSelection({model:'one',effort:'high',serviceTier:'priority'},models),{model:'one',effort:'high',serviceTier:'priority'});
 for(const selection of [{model:'other'},{model:'one',effort:'ultra'},{model:'one',serviceTier:'invented'}])assert.throws(()=>validateModelSelection(selection,models));
});
test('context usage uses the latest native token report rather than cumulative billing usage',()=>{
 const value={last:{totalTokens:12000},total:{totalTokens:550000},modelContextWindow:100000};
 assert.deepEqual(parseContextUsage(value,'now','turn'),{used:12000,total:550000,capacity:100000,updatedAt:'now',turnId:'turn'});
 assert.equal(parseContextUsage({...value,modelContextWindow:null},'now')?.capacity,null);
 assert.equal(parseContextUsage({...value,last:{totalTokens:-1}},'now'),undefined);
});
test('effective remote config overrides catalog defaults without exposing unrelated native config',()=>{
 const models=parseModels({data:[{id:'one',model:'one',isDefault:true,defaultReasoningEffort:'low'},{id:'two',model:'two',defaultReasoningEffort:'medium'}]});
 const defaults=applyNativeModelDefaults(models,{config:{model:'two',model_reasoning_effort:'high',service_tier:'priority',developer_instructions:'private'}});
 assert.equal(defaults.find(model=>model.isDefault)?.model,'two');assert.equal(defaults[1]!.defaultEffort,'high');assert.equal(defaults[1]!.defaultServiceTier,'priority');
 assert.doesNotMatch(JSON.stringify(defaults),/private|developer_instructions/);
 assert.deepEqual(parseEffectiveModel({model:'two',reasoningEffort:'high',serviceTier:null,thread:{private:'hidden'}}),{model:'two',effort:'high',serviceTier:'default'});
 assert.equal(parseEffectiveModel({thread:{}}),undefined);
});
