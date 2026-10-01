import test from 'node:test';
import assert from 'node:assert/strict';
import { createPreviewController, previewEnter } from '../apps/desktop/renderer/preview-controller';

test('preview Enter confirms; IME, repeat and modifier Enter never confirm',()=>{
  assert.equal(previewEnter({key:'Enter'}),'confirm');assert.equal(previewEnter({key:'Escape'}),undefined);
  for(const extra of [{repeat:true},{isComposing:true},{keyCode:229},{shiftKey:true},{ctrlKey:true},{altKey:true},{metaKey:true}])assert.equal(previewEnter({key:'Enter',...extra}),'ignore');
});
test('preview developer actions reject stale and repeated submissions and release listeners',()=>{
  const controller=createPreviewController(),events:unknown[]=[];let confirmed=0,edited=0;
  const off=controller.subscribe(view=>events.push(view));
  const close=controller.register({view:{id:'one',kind:'draft',title:'Preview',content:['source','translation'],canConfirm:true,canEdit:true},confirm:()=>confirmed++,edit:()=>edited++});
  const view=controller.get()!;view.title='external edit';assert.equal(controller.get()!.title,'Preview');
  assert.throws(()=>controller.confirm('wrong'),/PREVIEW_STALE/);controller.confirm('one');assert.equal(confirmed,1);
  assert.throws(()=>controller.confirm('one'),/PREVIEW_BUSY/);close();assert.throws(()=>controller.confirm('one'),/PREVIEW_STALE/);
  const other=controller.register({view:{id:'two',kind:'answer',title:'Answer',content:[],canConfirm:true,canEdit:true},confirm:()=>confirmed++,edit:()=>edited++});
  controller.edit('two');assert.equal(edited,1);off();const count=events.length;other();assert.equal(events.length,count);assert.equal(controller.get(),null);
});
test('an invalidated preview can still return to edit until an action starts',()=>{
  const controller=createPreviewController();let edited=0;
  controller.register({view:{id:'invalid',kind:'draft',title:'Preview',content:[],canConfirm:false,canEdit:true},confirm:()=>assert.fail('must not submit'),edit:()=>edited++});
  assert.throws(()=>controller.confirm('invalid'),/PREVIEW_BUSY/);
  controller.edit('invalid');assert.equal(edited,1);assert.throws(()=>controller.edit('invalid'),/PREVIEW_BUSY/);
});
