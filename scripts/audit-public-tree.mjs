import {execFileSync} from 'node:child_process';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

// Local repository evidence only. Never print matching credential bytes or read user profiles.
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const output=path.resolve(process.env.AWB_AUDIT_OUTPUT??path.join(root,'build/qa/public-audit'));
await mkdir(output,{recursive:true});
const git=args=>execFileSync('git',args,{cwd:root,encoding:'utf8',windowsHide:true,maxBuffer:64*1024*1024});
const patterns=[
  ['private-key',/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g],
  ['credential-shaped',/\b(?:sk-(?:ant-[a-z]+\d*-)?[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|AKIA[A-Z0-9]{16})\b/g],
  ['personal-home',/(?:[A-Z]:[\\/](?:Users|Documents and Settings)[\\/](?!Public\b|Default\b|Example\b)[^\\/\s"'<>]+|\/home\/(?!user\b|example\b|<)[^/\s"'<>]+)/gi],
  ['private-address',/\b(?:10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})\b/g],
];
const inspect=text=>patterns.flatMap(([kind,pattern])=>[...text.matchAll(pattern)].map(match=>({kind,line:text.slice(0,match.index).split('\n').length})));
const files=git(['ls-files','-z']).split('\0').filter(Boolean),working=[];
for(const file of files){let bytes;try{bytes=await readFile(path.join(root,file));}catch{continue;}if(bytes.includes(0)||bytes.length>10*1024*1024)continue;for(const issue of inspect(bytes.toString('utf8')))working.push({file,...issue});}
const objects=git(['rev-list','--objects','--all']).trim().split('\n').filter(Boolean).map(line=>({hash:line.split(' ')[0],file:line.slice(line.indexOf(' ')+1)}));
// Feed batches over stdin; object IDs and matched values never enter shell commands.
const metadata=execFileSync('git',['cat-file','--batch-check=%(objectname) %(objecttype) %(objectsize)'],{cwd:root,input:objects.map(o=>o.hash).join('\n')+'\n',encoding:'utf8',windowsHide:true,maxBuffer:16*1024*1024}).trim().split('\n');
const blobs=metadata.flatMap((line,index)=>{const [hash,type,size]=line.split(' ');return type==='blob'?[{hash,size:Number(size),file:objects[index].file}]:[];});
const history=[],skipped=[];let textBlobs=0;
for(let offset=0;offset<blobs.length;offset+=64){
  const batch=blobs.slice(offset,offset+64).filter(blob=>{if(blob.size>10*1024*1024){skipped.push({hash:blob.hash,file:blob.file,reason:'size'});return false;}return true;});if(!batch.length)continue;
  const bytes=execFileSync('git',['cat-file','--batch'],{cwd:root,input:batch.map(b=>b.hash).join('\n')+'\n',windowsHide:true,maxBuffer:128*1024*1024});let cursor=0;
  for(const blob of batch){cursor=bytes.indexOf(10,cursor)+1;const body=bytes.subarray(cursor,cursor+blob.size);cursor+=blob.size+1;if(body.includes(0))continue;textBlobs++;for(const issue of inspect(body.toString('utf8')))history.push({hash:blob.hash,file:blob.file,...issue});}
}
const lock=JSON.parse(await readFile(path.join(root,'package-lock.json'),'utf8'));
const licenses=Object.entries(lock.packages??{}).filter(([name])=>name).map(([location,p])=>({name:p.name??location.split('node_modules/').at(-1),version:p.version,license:p.license??'UNDECLARED',development:!!p.dev}));
const report={at:new Date().toISOString(),head:git(['rev-parse','HEAD']).trim(),scope:'Tracked working files and every reachable local Git blob; redacted regex candidates, not a proof of absence. No credentials, profile files, remote configuration or user databases are opened.',files:files.length,blobs:blobs.length,textBlobs,skipped,working,history,licenses};
await writeFile(path.join(output,'public-tree.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify({files:files.length,blobs:blobs.length,textBlobs,skipped:skipped.length,workingCandidates:working.length,historyCandidates:history.length,packages:licenses.length,licenseKinds:[...new Set(licenses.map(p=>p.license))],output:path.join(output,'public-tree.json')}));
