import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {validateSettings,normalizeChannel,validateConfig} from '../src/core/config.js';
import {chooseChannel,isComplete,Scheduler} from '../src/core/scheduler.js';
import {Store,SessionVault} from '../src/core/store.js';

test('untrusted config rejects wrong domains and invalid intervals',()=>{
  assert.throws(()=>normalizeChannel({platform:'twitch',login:'https://evil.com/user'}));
  assert.throws(()=>normalizeChannel({platform:'kick',login:'../escape'}));
  assert.throws(()=>validateSettings({pollSeconds:1}));
  assert.throws(()=>validateConfig({channels:[{platform:'unknown',login:'test'}]}));
  assert.equal(normalizeChannel({platform:'twitch',login:'https://www.twitch.tv/Example'}).login,'example');
});
test('completion requires claimed evidence and game scope for reward names',()=>{
  const c={game:'Rust',rewardIds:['Skin']};
  assert.equal(isComplete(c,[{name:'Skin',progress:100,claimed:false,game:'Rust'}]),false);
  assert.equal(isComplete(c,[{name:'Skin',claimed:true}]),false);
  assert.equal(isComplete(c,[{name:'Skin',claimed:true,game:'Other'}]),false);
  assert.equal(isComplete(c,[{name:'Skin',claimed:true,game:'Rust'}]),true);
  assert.equal(isComplete({...c,campaignId:'round2'},[{name:'Skin',claimed:true,game:'Rust',campaignId:'round1'}]),false);
  assert.equal(isComplete({rewardIds:[]},[]),false);
});
test('rotation skips offline unknown and completed and rotates equally ranked channels',()=>{
  const a={id:'a',login:'a',enabled:true,live:true,priority:0,rewardIds:[]};
  const b={...a,id:'b',login:'b'};
  assert.equal(chooseChannel([a,b],[],a,100,1000,1,{}).id,'a');
  assert.equal(chooseChannel([a,b],[],a,100,60101,1,{a:100}).id,'b');
  assert.equal(chooseChannel([{...a,live:null},{...b,completed:true}],[],null,0,1000,1),null);
  assert.equal(chooseChannel([a,{...b,priority:5}],[],a,100,1000,1).id,'b');
});
test('config roundtrip strips runtime data, deduplicates and preserves scope',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'droppilot-test-'));
  try{const store=new Store(dir);const config=validateConfig({settings:{},channels:[{platform:'twitch',login:'test',campaignId:'round2'},{platform:'twitch',login:'test'}]});await store.write(config);const read=await store.read();assert.equal(read.channels.length,1);assert.equal(read.channels[0].campaignId,'round2');assert.equal(read.settings.headless,true);}finally{await fs.rm(dir,{recursive:true,force:true});}
});
test('vault refuses insecure plaintext backend and handles absent session',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'droppilot-vault-'));
  const crypto={isEncryptionAvailable:()=>true,getSelectedStorageBackend:()=> 'basic_text'};
  try{const vault=new SessionVault(dir,crypto);assert.equal(vault.available(),false);await assert.rejects(vault.write('twitch',{cookies:[]}));await assert.rejects(vault.read('../evil'));}finally{await fs.rm(dir,{recursive:true,force:true});}
});
test('scheduler continues live discovery when inventory is unsupported; stops cleanly',async()=>{
  const state={settings:{pollSeconds:30,inventorySeconds:60,rotationMinutes:30},inventory:{twitch:[],kick:[]},channels:[{id:'a',platform:'twitch',login:'a',enabled:true,priority:0,rewardIds:[]}]};
  let watched=0,closed=0;
  const scheduler=new Scheduler({getState:()=>state,browsers:{get:async()=>({}),save:async()=>{},closeAll:async()=>{closed++;}},adapterFactory:()=>({inventory:async()=>{throw new Error('unrecognized');},live:async()=>true,watch:async()=>{watched++;},close:async()=>{}}),emit:()=>{},log:()=>{}});
  scheduler.running=true;await scheduler.tick();assert.equal(watched,1);assert.equal(scheduler.active.twitch.id,'a');await scheduler.stop();assert.equal(scheduler.running,false);assert.equal(scheduler.active.twitch,null);assert.ok(closed>0);
});
test('scheduler retries a failed browser with a fresh adapter instead of reusing a dead context',async()=>{
  const state={settings:{pollSeconds:30,inventorySeconds:60,rotationMinutes:30},inventory:{twitch:[],kick:[]},channels:[{id:'a',platform:'twitch',login:'a',enabled:true,priority:0,rewardIds:[]}]};
  let attempts=0,closed=0;
  const scheduler=new Scheduler({getState:()=>state,browsers:{get:async()=>({}),save:async()=>{},close:async()=>{closed++;},closeAll:async()=>{}},adapterFactory:()=>{const attempt=++attempts;return {inventory:async()=>[],live:async()=>{if(attempt===1)throw new Error('browser disconnected');return true;},watch:async()=>{},close:async()=>{},dispose:async()=>{}};},emit:()=>{},log:()=>{}});
  scheduler.running=true;await scheduler.tick();assert.equal(scheduler.active.twitch,null);assert.equal(closed,1);await scheduler.tick();assert.equal(attempts,2);assert.equal(scheduler.active.twitch.id,'a');await scheduler.stop();
});
