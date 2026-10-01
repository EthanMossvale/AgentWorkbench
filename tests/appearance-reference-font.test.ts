import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,mkdir,writeFile,rm,symlink } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { ClaudeReferenceFont,referenceFontResponse } from '../apps/desktop/host/claude-reference-font';
import { defaultAppearance,resolveAppearance } from '../packages/appearance';
import { PluginRegistry } from '../packages/plugins-core';
import { encodeZip } from '../packages/native-resources/archive';

test('Claude is the default reading choice and existing explicit choices are never replaced',()=>{
  assert.equal(defaultAppearance().contentFont,'claude');assert.equal(resolveAppearance({...defaultAppearance(),contentFont:'local:Arial'}).contentFont,'local:Arial');assert.equal(resolveAppearance({...defaultAppearance(),contentFont:'serif'}).contentFont,'serif');
});
test('optional Claude resources fail closed without downloading or fabricating an available font',async()=>{
  const fonts=new ClaudeReferenceFont(async()=>undefined);assert.equal((await fonts.status()).available,false);await assert.rejects(fonts.read('normal'),/REFERENCE_UNAVAILABLE/);assert.equal((await referenceFontResponse('awb-font://claude/serif',fonts)).status,404);
});
test('local font references discover only bounded declared WOFF2 files and support refresh',async()=>{
  const directory=await mkdtemp(path.join(os.tmpdir(),'awb-font-reference-')),assets=path.join(directory,'assets/v1');await mkdir(assets,{recursive:true});
  try{
    const bytes=Buffer.alloc(64);bytes.write('wOF2');await writeFile(path.join(assets,'normal.woff2'),bytes);await writeFile(path.join(assets,'italic.woff2'),bytes);
    const css='@font-face{font-family:anthropic-serif;src:url(/assets/v1/normal.woff2);font-style:normal}@font-face{font-family:"anthropic-serif";src:url("/assets/v1/italic.woff2");font-style:italic}';await writeFile(path.join(assets,'font.css'),css);
    const fonts=new ClaudeReferenceFont(async()=>directory);assert.deepEqual(await fonts.status(),{available:true,italicAvailable:true,source:'installed-claude',family:'Anthropic Serif'});assert.deepEqual(Buffer.from(await fonts.read('normal')),bytes);
    const response=await referenceFontResponse('awb-font://claude/serif-italic',fonts);assert.equal(response.status,200);assert.equal(response.headers.get('content-type'),'font/woff2');assert.deepEqual(Buffer.from(await response.arrayBuffer()),bytes);
    for(const url of ['https://claude/serif','awb-font://other/serif','awb-font://claude/serif?file=private','awb-font://claude/private','awb-font://user@claude/serif','awb-font://claude:123/serif','awb-font://claude/%2e%2e/private'])assert.equal((await referenceFontResponse(url,fonts)).status,404);
    await writeFile(path.join(assets,'normal.woff2'),'Invalid font');await assert.rejects(fonts.read('normal'),/REFERENCE_UNAVAILABLE/);assert.equal((await fonts.status(true)).available,false);
    await writeFile(path.join(assets,'normal.woff2'),bytes);assert.equal((await fonts.status(true)).available,true);
    await rm(path.join(assets,'normal.woff2'));await assert.rejects(fonts.read('normal'),/^Error: APPEARANCE_REFERENCE_UNAVAILABLE$/);assert.equal((await referenceFontResponse('awb-font://claude/serif',fonts)).status,404);
  }finally{await rm(directory,{recursive:true,force:true});}
});
test('font metadata cannot redirect the protocol outside the installed resource directory',async()=>{
  const directory=await mkdtemp(path.join(os.tmpdir(),'awb-font-boundary-')),root=path.join(directory,'app'),assets=path.join(root,'assets/v1');await mkdir(assets,{recursive:true});
  try{
    const bytes=Buffer.alloc(64);bytes.write('wOF2');await writeFile(path.join(directory,'outside.woff2'),bytes);
    await writeFile(path.join(assets,'font.css'),'@font-face{font-family:anthropic-serif;src:url(/assets/v1/../../outside.woff2);font-style:normal}');assert.equal((await new ClaudeReferenceFont(async()=>root).status()).available,false);
    await writeFile(path.join(assets,'font.css'),'@font-face{font-family:anthropic-serif;src:url(https://example.test/font.woff2);font-style:normal}');assert.equal((await new ClaudeReferenceFont(async()=>root).status()).available,false);
    const linked=path.join(directory,'linked-app');await mkdir(path.join(linked,'assets'),{recursive:true});await symlink(directory,path.join(linked,'assets/v1'),'junction');await writeFile(path.join(directory,'font.css'),'@font-face{font-family:anthropic-serif;src:url(/assets/v1/outside.woff2);font-style:normal}');assert.equal((await new ClaudeReferenceFont(async()=>linked).status()).available,false);
  }finally{await rm(directory,{recursive:true,force:true});}
});

test('approved font service overrides reach the actual resource response and disable restores fallback',async()=>{
  const directory=await mkdtemp(path.join(os.tmpdir(),'awb-font-plugin-')),plugins=new PluginRegistry(path.join(directory,'plugins'));
  const fonts=new ClaudeReferenceFont(async()=>undefined);await plugins.initialize();plugins.services.register('appearance.reference-fonts',fonts,{version:1});
  try{
    const manifest={schemaVersion:1,apiVersion:1,id:'test.font-reference',name:'Font reference test',version:'1.0.0',description:'Isolated local reference service check',capabilities:['host'],main:'main.mjs'};
    const main=`export function activate(api){api.services.override('appearance.reference-fonts',{status:async()=>({available:true,italicAvailable:false,source:'installed-claude',family:'Anthropic Serif'}),read:async()=>new Uint8Array([119,79,70,50])});}`;
    const zip=path.join(directory,'fixture.zip');await writeFile(zip,encodeZip([{name:'workbench.plugin.json',data:Buffer.from(JSON.stringify(manifest))},{name:'main.mjs',data:Buffer.from(main)}]));await plugins.importZip(zip);const record=(await plugins.list())[0]!;
    assert.equal((await referenceFontResponse('awb-font://claude/serif',fonts)).status,404);
    await plugins.setEnabled(record.manifest.id,record.hash,true,true);assert.equal((await fonts.status()).available,true);
    const response=await referenceFontResponse('awb-font://claude/serif',fonts);assert.equal(response.status,200);assert.equal(Buffer.from(await response.arrayBuffer()).toString(),'wOF2');
    await plugins.disableAll();assert.equal((await fonts.status()).available,false);assert.equal((await referenceFontResponse('awb-font://claude/serif',fonts)).status,404);
  }finally{await plugins.dispose();await rm(directory,{recursive:true,force:true});}
});
