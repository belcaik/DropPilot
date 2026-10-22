import test from 'node:test';
import assert from 'node:assert/strict';
import {isComplete} from '../src/core/scheduler.js';

const channel={platform:'twitch',game:'Rust',campaignTitle:'Rust Round',rewardIds:['Isles Backpack'],startsAt:'2026-10-01T00:00:00Z',endsAt:'2026-10-08T00:00:00Z'};
const claimed={source:'twitch-claimed-history',platform:'twitch',name:'Isles Backpack',claimed:true,game:null,campaignId:null,campaignTitle:null,claimedAtRange:['2026-10-03T00:00:00Z','2026-10-04T00:00:00Z']};

test('claimed Twitch history completes a named reward only with campaign-contained date evidence',()=>{
  assert.equal(isComplete(channel,[claimed]),true);
  assert.equal(isComplete({...channel,campaignId:'rust-round'},[claimed]),true);
  assert.equal(isComplete({...channel,rewardIds:['Isles Backpack','Another Skin']},[claimed]),false);
  assert.equal(isComplete(channel,[{...claimed,claimed:false}]),false);
  assert.equal(isComplete(channel,[{...claimed,name:'Other Backpack'}]),false);
});

test('history refuses missing, uncertain or conflicting campaign evidence',()=>{
  for(const range of [undefined,[],['invalid','invalid'],['2026-10-05T00:00:00Z','2026-10-04T00:00:00Z'],['2026-09-30T23:59:00Z','2026-10-04T00:00:00Z'],['2026-10-03T00:00:00Z','2026-10-08T00:01:00Z']])assert.equal(isComplete(channel,[{...claimed,claimedAtRange:range}]),false);
  assert.equal(isComplete({...channel,startsAt:null},[claimed]),false);
  assert.equal(isComplete({...channel,endsAt:null},[claimed]),false);
  assert.equal(isComplete(channel,[{...claimed,source:'other'}]),false);
  assert.equal(isComplete(channel,[{...claimed,platform:'kick'}]),false);
  assert.equal(isComplete({...channel,platform:'kick'},[claimed]),false);
  assert.equal(isComplete(channel,[{...claimed,game:'Other'}]),false);
  assert.equal(isComplete(channel,[{...claimed,campaignId:'other'}]),false);
  assert.equal(isComplete(channel,[{...claimed,campaignTitle:'Other'}]),false);
});

test('existing exact ID and game-scoped evidence still work',()=>{
  assert.equal(isComplete(channel,[{id:'Isles Backpack',claimed:true}]),true);
  assert.equal(isComplete(channel,[{name:'Isles Backpack',claimed:true,game:'Rust',campaignTitle:'Rust Round'}]),true);
  assert.equal(isComplete(channel,[{name:'Isles Backpack',claimed:true}]),false);
});
