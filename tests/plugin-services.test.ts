import test from 'node:test';
import assert from 'node:assert/strict';
import { HostServiceRegistry } from '../packages/plugins-core/services';

test('service discovery includes prototype operations without reading getters or returning values', () => {
  class Core { secret='SYNTHETIC_PRIVATE_VALUE'; get dangerous(){throw Error('Getter executed');} read(n:number){return this.secret.length+n;} }
  const services=new HostServiceRegistry(),core=new Core();services.register('runtime.test',core);
  const list=services.list();assert.ok(list[0]!.members.includes('read'));assert.ok(list[0]!.members.includes('dangerous'));assert.ok(!JSON.stringify(list).includes(core.secret));
  assert.equal(services.get('runtime.test'),core);assert.throws(()=>services.register('runtime.test',{}),/already exists/);
});

test('wrappers affect existing references, preserve this, and unwind independently of disable order', () => {
  class Core { value=3; run(n:number){return this.value+n;} }
  const services=new HostServiceRegistry(),core=new Core();services.register('core',core);
  const a=services.intercept('core','run',(next,...args)=>Number(next(...args))*2);
  const b=services.intercept('core','run',(next,...args)=>Number(next(...args))+10);
  assert.equal(core.run(2),20);a();assert.equal(core.run(2),15);b();assert.equal(core.run(2),5);
  assert.equal(Object.hasOwn(core,'run'),false);
});

test('replacement stacks restore the core implementation and remove added members', () => {
  const services=new HostServiceRegistry(),core={run:()=>1};services.register('core',core);
  const a=services.override('core',{run:()=>2,added:true}),b=services.override('core',{run:()=>3});
  assert.equal(core.run(),3);a();assert.equal(core.run(),3);assert.equal('added' in core,false);b();b();assert.equal(core.run(),1);
});

test('failed multi-member installation rolls back and independent external changes are preserved', () => {
  const services=new HostServiceRegistry(),core={run:()=>1};services.register('core',core);
  Object.defineProperty(core,'fixed',{value:true,configurable:false});
  assert.throws(()=>services.override('core',{run:()=>2,fixed:false}),/cannot be overridden/);assert.equal(core.run(),1);
  const undo=services.override('core',{run:()=>2});core.run=()=>9;undo();assert.equal(core.run(),9);
  assert.throws(()=>services.override('core',JSON.parse('{"__proto__":{}}')),/Invalid service member/);
});

test('plugin scopes own cleanup and reject late registrations after deactivation', () => {
  const services=new HostServiceRegistry(),core={run:()=>1},cleanup:(()=>void)[]=[];let active=true;
  services.register('core',core);const api=services.scope(()=>{if(!active)throw Error('inactive');},release=>{cleanup.push(release);return release;});
  api.register('personal.extra',{run:()=>5});api.override('core',{run:()=>7});active=false;
  assert.throws(()=>api.register('late',{}),/inactive/);for(const release of cleanup.reverse())release();
  assert.equal(core.run(),1);assert.throws(()=>services.get('personal.extra'),/unavailable/);
});
