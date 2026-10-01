import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
test('inherited and newly added user requirements remain explicit and traceable',async()=>{
 const data=JSON.parse(await readFile(new URL('../docs/requirements.json',import.meta.url),'utf8'));
 assert.equal(data.source,'Project requirement register; private conversation identifiers omitted');
 assert.equal('sourceThread' in data,false,'Public requirements do not retain private conversation identifiers.');
 assert.deepEqual(data.requirements.slice(0,19).map((r:any)=>r.id),Array.from({length:19},(_,i)=>`U${i+1}`));
 for(const id of ['U54','U55','U56','U57','U58','U59','U60','U61','U62','U63','U64','U65','U69'])assert.ok(data.implementationTurnAdditions.some((r:any)=>r.id===id));
 const ids=[...data.requirements,...data.implementationTurnAdditions].map((r:any)=>r.id);assert.equal(new Set(ids).size,ids.length,'Requirement IDs remain unique as parallel work adds requirements.');
 for(const item of data.requirements){assert.ok(item.requirement&&item.module&&item.stage&&item.acceptance);}
 assert.match(data.parallelism,/each main task may run at most one sub-agent concurrently/);
});
