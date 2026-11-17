import test from 'node:test';
import assert from 'node:assert/strict';
import {Store,Engine} from '../core.mjs';
import {Spoon} from '../spoon.mjs';
import {Playback} from '../public/playback.mjs';
function fixture(){
  const store=new Store();store.create('a','A');let now=Date.parse('2026-11-16T00:00:00Z'),event=0;
  const engine=new Engine(store,{now:()=>now,int:(min)=>min});
  const say=(message,id='u',isDj=false)=>{now+=21000;return engine.handle('a',{id:`review-${++event}`,user:{id,nickname:'팬'},isDj,message});};
  say('!내정보 생성');return {store,engine,say,user:()=>store.load('a').users.u};
}
test('attendance and single lottery never overflow balances or partially consume a ticket',()=>{
  const f=fixture();f.store.transaction('a',r=>r.users.u.tickets=Number.MAX_SAFE_INTEGER);
  assert.match(f.say('!출석').text,/정수 범위/);assert.equal(f.user().tickets,Number.MAX_SAFE_INTEGER);assert.equal(f.user().attendance,'');
  f.store.transaction('a',r=>{r.users.u.tickets=1;r.users.u.exp=Number.MAX_SAFE_INTEGER;});
  assert.match(f.say('!복권 1 2 3').text,/정수 범위/);assert.equal(f.user().tickets,1);assert.equal(f.user().exp,Number.MAX_SAFE_INTEGER);f.store.db.close();
});
test('fishing and odd/even overflow roll back EXP, book, PT, limits and audit writes',()=>{
  const f=fixture();f.store.transaction('a',r=>{r.settings.fishing=true;r.settings.odd=true;r.settings.payout='fixed';r.users.u.pt=Number.MAX_SAFE_INTEGER;});
  assert.match(f.say('!낚시').text,/정수 범위/);let u=f.user();assert.equal(u.exp,0);assert.equal(u.daily.fishExp,0);assert.deepEqual(u.book,{});assert.equal(u.pt,Number.MAX_SAFE_INTEGER);
  assert.match(f.say('!홀 100').text,/정수 범위/);u=f.user();assert.equal(u.pt,Number.MAX_SAFE_INTEGER);assert.equal(u.daily.oddPt,0);
  assert.equal(f.store.logs('a').filter(l=>['fishing','pt-reward','odd-even'].includes(l.type)).length,0);f.store.db.close();
});
test('reserved object property names cannot impersonate an existing listener',()=>{
  const f=fixture();assert.match(f.say('!복권지급 @__proto__ 3','dj',true).text,/일치하는 청취자가 없습니다/);
  f.say('!내정보 생성','__proto__');f.say('!내정보 생성','constructor');
  const users=f.store.load('a').users;assert.equal(Object.hasOwn(users,'__proto__'),true);assert.equal(users.__proto__.tickets,0);assert.equal(users.constructor.id,'constructor');
  f.say('!복권지급 @__proto__ 3','dj',true);assert.equal(f.store.load('a').users.__proto__.tickets,3);assert.equal(f.user().tickets,0);f.store.db.close();
});
test('failed scheduled announcement remains due and advances only after a successful send',async()=>{
  const f=fixture(),spoon=new Spoon(f.store,f.engine,{});let success=false,calls=0;
  f.store.transaction('a',r=>{r.live=true;r.lastResponse=0;r.settings.introEnabled=false;r.settings.announcements=[{id:'n',enabled:true,minutes:1,text:'안내'}];});
  const due=Date.now()-61000;spoon.timers.set('a:n',due);spoon.send=async()=>{calls++;return success;};
  await spoon.tick();assert.equal(spoon.timers.get('a:n'),due);assert.equal(f.store.load('a').lastResponse,0);
  success=true;await spoon.tick();assert.equal(calls,2);assert.ok(spoon.timers.get('a:n')>due);await spoon.tick();assert.equal(calls,2);f.store.db.close();
});
test('an aborted old connection cannot overwrite a replacement connection state',async()=>{
  const f=fixture(),spoon=new Spoon(f.store,f.engine,{}),old=new AbortController();let finish;
  spoon.access=()=>new Promise(resolve=>finish=resolve);spoon.running.set('a',old);
  const pending=spoon.loop('a',old);spoon.stop('a');const current=new AbortController();spoon.running.set('a',current);spoon.status.set('a','방송 연결됨');f.store.transaction('a',r=>r.live=true);
  finish('not-sent');await pending;assert.equal(spoon.running.get('a'),current);assert.equal(f.store.load('a').live,true);assert.equal(spoon.status.get('a'),'방송 연결됨');f.store.db.close();
});
test('pause during a pending playback start cannot restart audio when the server responds',async()=>{
  let finish,loads=0;const p=new Playback({api:()=>new Promise(resolve=>finish=resolve),load:async()=>loads++,pause:()=>{},onRoom:()=>{},onStatus:()=>{}});
  const pending=p.start({current:null});p.stop();finish({room:{current:{id:'song',videoId:'M7lc1UVf-VE'}}});await pending;
  assert.equal(loads,0);assert.equal(p.running,false);
});
