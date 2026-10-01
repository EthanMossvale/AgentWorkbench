import {test} from 'node:test';
import assert from 'node:assert/strict';
import {RemoteDirectoryCache} from '../apps/desktop/renderer/remote-directory-cache';
import type {RemoteFileView} from '../packages/remote-account-catalog/resources';
import {connectionPaneSizes,defaultConnectionPanes} from '../apps/desktop/renderer/connection-panes';
const directory=(path:string,children:string[]=[]):RemoteFileView=>({path,parent:'/',kind:'directory',revision:'a'.repeat(64),entries:children.map(name=>({name,path:(path==='/'?'':path)+'/'+name,directory:true}))});
const tick=()=>new Promise<void>(resolve=>setImmediate(resolve));
const deferred=()=>{let resolve!:(v:RemoteFileView)=>void,reject!:(e:unknown)=>void;const promise=new Promise<RemoteFileView>((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};

test('directory cache deduplicates reads, never retains text and separates connection lifetimes',async()=>{
  let calls=0;const remote=deferred();const cache=new RemoteDirectoryCache(async()=>{calls++;return remote.promise;});
  const a=cache.read('/home'),b=cache.read('/home/');remote.resolve(directory('/home'));await Promise.all([a,b]);assert.equal(calls,1);
  await cache.read('/home');assert.equal(calls,1);
  const other=new RemoteDirectoryCache(async path=>({path,parent:'/',kind:'text',content:'not cached',revision:'b'.repeat(64)}));
  await other.read('/home');assert.equal(other.peek('/home'),undefined);assert.equal(cache.peek('/home')?.kind,'directory');
  cache.dispose();assert.equal(cache.peek('/home'),undefined);await assert.rejects(cache.read('/home'),/DISPOSED/);
});

test('stale listings return immediately, publish a refresh and surface failure without discarding the last listing',async()=>{
  let now=0,next=deferred(),calls=0;const events:unknown[]=[];
  const cache=new RemoteDirectoryCache(async path=>{calls++;return calls===1?directory(path):next.promise;},{now:()=>now});cache.setActive(true);cache.subscribe((...event)=>events.push(event));
  await cache.read('/home');now=31_000;
  assert.equal((await cache.read('/home')).kind,'directory');assert.equal(calls,2);next.resolve(directory('/home',['updated']));await tick();assert.equal(cache.peek('/home')?.entries?.[0]?.name,'updated');
  cache.setActive(false);now=62_000;next=deferred();cache.setActive(true);await cache.read('/home');next.reject(Error('Disconnected'));await tick();assert.equal(cache.peek('/home')?.entries?.[0]?.name,'updated');assert.ok(events.some((event:any)=>event[2]?.message==='Disconnected'));
  now=400_000;assert.equal(cache.peek('/home'),undefined);cache.dispose();
});

test('prefetch is shallow and bounded, reserves foreground capacity and stops queued work on hide',async()=>{
  const calls:string[]=[],waits=new Map<string,ReturnType<typeof deferred>>();
  const cache=new RemoteDirectoryCache(async path=>{calls.push(path);if(path==='/')return directory('/',Array.from({length:30},(_,i)=>'dir'+i));const pending=deferred();waits.set(path,pending);return pending.promise;});
  cache.setActive(true);await cache.read('/');assert.deepEqual(calls,['/','/dir0']);
  const user=cache.read('/chosen');assert.deepEqual(calls,['/','/dir0','/chosen']);
  cache.setActive(false);waits.get('/dir0')!.resolve(directory('/dir0',['not-recursively-read']));waits.get('/chosen')!.resolve(directory('/chosen'));await user;await tick();assert.equal(calls.length,3);
  cache.dispose();
});

test('invalidating during an in-flight read cannot repopulate the cache or delete a newer job',async()=>{
  const old=deferred(),fresh=deferred();let calls=0;
  const cache=new RemoteDirectoryCache(()=>++calls===1?old.promise:fresh.promise);
  const a=cache.read('/home');const rejected=assert.rejects(a,/INVALIDATED/);cache.invalidate();const b=cache.read('/home');
  old.resolve(directory('/home',['old']));await rejected;fresh.resolve(directory('/home',['new']));await b;assert.equal(cache.peek('/home')?.entries?.[0]?.name,'new');cache.dispose();
});

test('entry count and byte budgets evict metadata; oversized listings are returned without retaining them',async()=>{
  const cache=new RemoteDirectoryCache(async path=>directory(path),{maxEntries:2,maxBytes:4096});
  await cache.read('/one');await cache.read('/two');cache.peek('/one');await cache.read('/three');assert.equal(cache.peek('/two'),undefined);assert.ok(cache.peek('/one'));
  const tiny=new RemoteDirectoryCache(async path=>directory(path),{maxBytes:1});assert.equal((await tiny.read('/')).kind,'directory');assert.equal(tiny.peek('/'),undefined);
  assert.throws(()=>new RemoteDirectoryCache(async path=>directory(path),{maxEntries:0}),/OPTIONS_INVALID/);cache.dispose();tiny.dispose();
});

test('special filesystem directories and files are excluded from automatic directory prefetch',async()=>{
  const calls:string[]=[];const cache=new RemoteDirectoryCache(async path=>{calls.push(path);return {...directory(path,['proc','sys','dev','run']),entries:[...directory(path,['proc','sys','dev','run']).entries!,{name:'file',path:'/file',directory:false}]};});
  cache.setActive(true);await cache.read('/');await tick();assert.deepEqual(calls,['/']);cache.dispose();
});

test('a directory replaced by a file no longer has a cached directory listing',async()=>{
  let replaced=false;
  const cache=new RemoteDirectoryCache(async path=>replaced?{path,parent:'/',kind:'text',content:'new file',revision:'b'.repeat(64)}:directory(path));
  await cache.read('/changing');replaced=true;assert.equal((await cache.fresh('/changing')).kind,'text');assert.equal(cache.peek('/changing'),undefined);cache.dispose();
});

test('wide open layout sends all added width to files; closed layout grows proportionally',()=>{
  const small=connectionPaneSizes(1000,true,defaultConnectionPanes),large=connectionPaneSizes(1400,true,defaultConnectionPanes);
  assert.equal(large.navigation,small.navigation);assert.equal(large.details,small.details);assert.equal(large.files-small.files,400);
  const closed=connectionPaneSizes(1000,false,defaultConnectionPanes),closedWide=connectionPaneSizes(1200,false,defaultConnectionPanes);assert.ok(closedWide.navigation>closed.navigation);assert.ok(closedWide.details>closed.details);
  assert.equal(connectionPaneSizes(850,true,defaultConnectionPanes).sideBySide,false);assert.equal(connectionPaneSizes(500,true,defaultConnectionPanes).stacked,true);
  for(let width=860;width<1600;width+=7){const panes=connectionPaneSizes(width,true,{navigation:600,details:1200,navigationRatio:.9});assert.ok(panes.details>=300);assert.ok(panes.files>=280);assert.equal(panes.navigation+panes.details+panes.files+32,width);}
});
