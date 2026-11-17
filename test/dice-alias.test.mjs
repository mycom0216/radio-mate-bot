import test from 'node:test';
import assert from 'node:assert/strict';
import {Store,Engine} from '../core.mjs';
test('automatic dice alias rolls once, keeps PT and EXP, and still obeys permissions and cooldown',()=>{
 const store=new Store();try{
  store.create('dice','검증');let now=Date.now(),n=0;const engine=new Engine(store,{now:()=>now,int:min=>min});
  const say=(message,dj=false)=>engine.handle('dice',{id:`dice-${++n}`,user:{id:'u',nickname:'검증'},isDj:dj,message});
  say('!내정보 생성');say('!게임 on',true);now+=21000;
  assert.match(say('!주사위 자동').text,/주사위: 1/);assert.equal(say('!주사위 자동').suppressed,'cooldown');
  const user=store.load('dice').users.u;assert.equal(user.pt,0);assert.equal(user.exp,0);
  now+=21000;say('!게임 off',true);now+=21000;assert.match(say('!주사위 자동').text,/꺼져 있습니다/);
 }finally{store.db.close();}
});
