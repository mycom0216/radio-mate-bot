import test from 'node:test';
import assert from 'node:assert/strict';
import {Store,Engine} from '../core.mjs';

function fixture(t){
 const store=new Store();t.after(()=>store.db.close());store.create('r','R');let now=Date.now(),seq=0;
 const engine=new Engine(store,{now:()=>now}),say=(message,user='u',id)=>{now+=3100;return engine.handle('r',{id:id||'shop-'+(++seq),message,isDj:false,user:{id:user,nickname:user}});};
 say('!내정보');store.transaction('r',r=>{r.users.u.pt=100000;r.settings.cooldown=300;});
 return {store,engine,say,load:()=>store.load('r')};
}
test('shop shows prices and purchase instructions, and supports ID, number and full name purchases',t=>{
 const f=fixture(t);assert.match(f.say('!아이템 상점').text,/구매: !구매/);
 assert.match(f.say('!구매 rare').text,/구매 완료.*10,000 PT 차감/);
 assert.match(f.say('!아이템 구매 2').text,/잔액 70,000 PT/);
 assert.match(f.say('!구매 홀 확률 UP').text,/사용: !아이템 사용 odd/);
 const u=f.load().users.u;assert.equal(u.pt,20000);assert.deepEqual(u.bag,{rare:1,exp:1,odd:1});
});
test('purchase shortages and duplicate delivery do not charge twice or create free items',t=>{
 const f=fixture(t);f.say('!구매 odd','u','same-purchase');assert.equal(f.say('!구매 odd','u','same-purchase').duplicate,true);
 assert.equal(f.load().users.u.pt,50000);assert.equal(f.load().users.u.bag.odd,1);
 f.store.transaction('r',r=>r.users.u.pt=1);assert.match(f.say('!구매 exp').text,/필요 20,000 PT \/ 보유 1 PT/);assert.equal(f.load().users.u.pt,1);assert.equal(f.load().users.u.bag.exp,undefined);
 assert.match(f.say('!구매 rare','new-user').text,/포인트가 부족/);
});
test('limited stock stays atomic across listeners and purchased items can be used after the response gap',t=>{
 const f=fixture(t);f.say('!내정보','v');f.store.transaction('r',r=>{r.users.v.pt=100000;r.settings.items[0].stock=1;r.settings.fishing=true;});
 assert.match(f.say('!구매 1').text,/구매 완료/);assert.match(f.say('!구매 rare','v').text,/품절/);assert.equal(f.load().users.v.pt,100000);
 assert.match(f.say('!아이템 사용 희귀 물고기 확률 UP').text,/20분 적용/);assert.equal(f.load().users.u.bag.rare,0);assert.ok(f.load().users.u.buffs.rare);
});
test('ambiguous item names and extra arguments never purchase a different product',t=>{
 const f=fixture(t);f.store.transaction('r',r=>{r.settings.items[0].name='같은 이름';r.settings.items[1].name='같은 이름';});
 assert.match(f.say('!구매 같은 이름').text,/하나만 정확히/);assert.match(f.say('!구매 rare 2').text,/하나만 정확히/);
 assert.equal(f.load().users.u.pt,100000);assert.deepEqual(f.load().users.u.bag,{});
});
