import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,link,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {AttachmentStore} from '../apps/desktop/host/attachments';
import {SharedDataRoot,readExplicitSkillFile} from '../packages/memory-core/storage';
import {encodeZip,readArchive,collectDirectory} from '../packages/native-resources/archive';

test('ordinary hardlinks support attachment reads, shared text and ZIP input/export',async t=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'awb-hardlinks-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const source=path.join(root,'source.txt'),alias=path.join(root,'alias.txt');await writeFile(source,'shared fixture');await link(source,alias);
 const attachments=new AttachmentStore(path.join(root,'attachments'),undefined,[],undefined,{nativePaths:true});
 const [item]=await attachments.import([{filePath:alias}]);assert.equal(Buffer.from((await attachments.payloads([item!.id]))[0]!.data).toString(),'shared fixture');
 await writeFile(source,'edited fixture');await assert.rejects(attachments.payloads([item!.id]),/已变化/);
 const shared=new SharedDataRoot(root,'memories');await shared.initialize();await link(source,shared.resolve('entry.md'));assert.equal(await shared.read('entry.md'),'edited fixture');
 const skill=path.join(root,'skill');await mkdir(skill);await link(source,path.join(skill,'SKILL.md'));assert.equal(await readExplicitSkillFile(path.join(skill,'SKILL.md')),'edited fixture');
 const entries=await collectDirectory(skill);assert.equal(entries[0]!.data.toString(),'edited fixture');
 const zip=path.join(root,'skill.zip'),zipAlias=path.join(root,'alias.zip');await writeFile(zip,encodeZip(entries));await link(zip,zipAlias);assert.deepEqual(await readArchive(zipAlias),entries);
});
