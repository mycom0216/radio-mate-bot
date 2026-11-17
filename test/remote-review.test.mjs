import test from 'node:test';
import assert from 'node:assert/strict';
import {Store,Engine} from '../core.mjs';

test('finite stock sales invalidate stale settings, but failed and duplicate sales do not change revision',()=>{
 const store=new Store();try{
  store.create('review','검증');let now=Date.now(),n=0;const engine=new Engine(store,{now:()=>now});
  const event=message=>({id:`sale-${++n}`,user:{id:'qa',nickname:'검증'},message,isDj:true});
  engine.handle('review',{...event('!내정보 생성'),isDj:false});
  store.transaction('review',r=>{r.users.qa.pt=50000;r.settings.items[0].stock=1;r.settingsRevision=7;});
  const purchase=event('!아이템 구매 rare');assert.match(engine.handle('review',purchase).text,/구매 완료/);
  let r=store.load('review');assert.equal(r.settings.items[0].stock,0);assert.equal(r.settingsRevision,8);
  assert.equal(r.users.qa.pt,40000);assert.equal(engine.handle('review',purchase).duplicate,true);
  assert.match(engine.handle('review',event('!아이템 구매 rare')).text,/품절/);
  r=store.load('review');assert.equal(r.settingsRevision,8);assert.equal(r.users.qa.pt,40000);
  store.transaction('review',r=>r.settings.items[0].stock=null);
  assert.match(engine.handle('review',event('!아이템 구매 rare')).text,/구매 완료/);
  assert.equal(store.load('review').settingsRevision,8);
 }finally{store.db.close();}
});

