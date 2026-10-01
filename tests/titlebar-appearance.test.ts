import test from 'node:test';
import assert from 'node:assert/strict';
import { validateTitlebarAppearance } from '../packages/appearance';

test('native titlebar accepts only a complete opaque palette, with no window geometry or CSS injection',()=>{
  assert.deepEqual(validateTitlebarAppearance({color:'#aBcDEF',symbolColor:'#012345'}),{color:'#abcdef',symbolColor:'#012345'});
  for(const value of [null,[],{},'red',{color:'#abcdef'},{color:'#abcdef',symbolColor:'red'},{color:'#fff',symbolColor:'#123456'},
    {color:'#abcdef00',symbolColor:'#123456'},{color:'var(--side)',symbolColor:'#123456'},
    {color:'#abcdef',symbolColor:'#123456',height:1000},{color:'#abcdef;background:red',symbolColor:'#123456'}]){
    assert.throws(()=>validateTitlebarAppearance(value),/APPEARANCE_INVALID_TITLEBAR/);
  }
});
