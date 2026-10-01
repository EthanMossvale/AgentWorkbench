import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
export async function configurationDigest(root){
 const folder=path.join(root,'services/vps-account-broker'),setup=await readFile(path.join(folder,'setup.py'),'utf8');
 const names=[...[...setup.match(/^FILES = \[(.+)\]/m)[1].matchAll(/'([^']+)'/g)].map(m=>m[1]),'agent-workbench-accounts.service'].sort(),files={};
 for(const name of names){const raw=(await readFile(path.join(folder,name),'utf8')).replaceAll('\r\n','\n');if(/[^\x00-\x7f]/.test(raw))throw Error('REMOTE_CONFIGURATION_NOT_ASCII: '+name);files[name]=createHash('sha256').update(raw).digest('hex');}
 return createHash('sha256').update(JSON.stringify(files)).digest('hex');
}
export async function checkConfigurationRelease(root){
 for(const name of ['configuration.py','configuration-known.json','configuration-release.json'])if(/[^\x00-\x7f]/.test(await readFile(path.join(root,'services/vps-account-broker',name),'utf8')))throw Error('REMOTE_CONFIGURATION_NOT_ASCII: '+name);
 const release=JSON.parse(await readFile(path.join(root,'services/vps-account-broker/configuration-release.json'),'utf8'));
 if(release.schemaVersion!==1||!Number.isSafeInteger(release.revision)||release.revision<1||release.sha256!==await configurationDigest(root))throw Error('REMOTE_CONFIGURATION_RELEASE_MISMATCH: Increment the configuration revision and update its source digest before publishing a changed remote bundle.');
 return release;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){const value=await checkConfigurationRelease(path.resolve(import.meta.dirname,'..'));console.log('PASS remote configuration release '+value.revision);}
