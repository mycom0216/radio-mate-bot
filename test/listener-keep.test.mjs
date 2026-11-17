import test from 'node:test';
import assert from 'node:assert/strict';
import {Store,Engine} from '../core.mjs';
import {keepExpiryLabel} from '../public/song-utils.mjs';

function fixture(t,start=Date.now()){
 const store=new Store();t.after(()=>store.db.close());store.create('room','방송');store.create('other','다른 방송');
 let now=start,seq=0;const engine=new Engine(store,{now:()=>now});
 const say=(message,user='listener',room='room')=>engine.handle(room,{id:'keep-'+(++seq),message,isDj:false,user:{id:user,nickname:'청취자 '+user}});
 return {store,engine,say,get now(){return now;},advance:ms=>now+=ms};
}

test('listener can query keeps without first creating a profile or having DJ permissions',t=>{
 const f=fixture(t);const result=f.say('!킵');assert.match(result.text,/보관 중인 킵이 없습니다/);
 const user=f.store.load('room').users.listener;assert.ok(user);assert.equal(user.name,'청취자 listener');assert.deepEqual(user.keeps,[]);assert.equal(user.tickets,0);assert.equal(user.exp,0);
});

test('listener keep list groups their own rewards without exposing other listeners or rooms',t=>{
 const f=fixture(t);f.say('!킵');f.say('!킵','listener','other');
 f.store.transaction('room',r=>{r.users.listener.keeps=['신청곡 우선권','신청곡 우선권'];r.users.secret={...r.users.listener,id:'secret',keeps:['다른 사람 비밀 보상']};});
 f.store.transaction('other',r=>r.users.listener.keeps=['다른 방송 보상']);
 f.advance(300000);const result=f.say('!킵');assert.match(result.text,/신청곡 우선권 ×2/);assert.ok(!result.text.includes('비밀'));assert.ok(!result.text.includes('다른 방송'));
 assert.deepEqual(f.store.load('room').users.listener.keeps,['신청곡 우선권','신청곡 우선권']);
});

test('listener keep lookup preserves paging and response cooldown without granting rewards',t=>{
 const f=fixture(t);f.say('!킵');f.store.transaction('room',r=>r.users.listener.keeps=Array.from({length:12},(_,i)=>'매우 긴 청취자 보상 이름 '+i));
 assert.equal(f.say('!킵').suppressed,'cooldown');f.advance(300000);
 const first=f.say('!킵');assert.match(first.text,/다음: !킵 2/);f.advance(300000);
 assert.match(f.say('!킵 2').text,/보유 킵 2\//);assert.equal(f.store.load('room').users.listener.keeps.length,12);
});

test('listener consumes one grouped keep and immediately moves it to completion history',t=>{
 const f=fixture(t);f.say('!킵');f.store.transaction('room',r=>{r.settings.cooldown=300;r.users.listener.keeps=['우선권','우선권','인사'];});
 f.advance(3100);assert.match(f.say('!킵 사용 1').text,/사용 완료: 우선권.*남은 수량 1개/);
 let user=f.store.load('room').users.listener;assert.deepEqual(user.keeps,['우선권','인사']);assert.equal(user.keepHistory[0].kind,'used');assert.equal(user.keepHistory[0].actor,'listener');
 f.advance(3100);assert.match(f.say('!킵 완료').text,/우선권/);
 f.advance(3100);assert.match(f.say('!킵 사용 인사').text,/사용 완료: 인사/);assert.deepEqual(f.store.load('room').users.listener.keeps,['우선권']);
});

test('cancel latest use restores one keep and cannot restore the same completion twice',t=>{
 const f=fixture(t);f.say('!킵');f.store.transaction('room',r=>r.users.listener.keeps=['보상']);
 f.advance(3100);f.say('!킵 사용 1');f.advance(3100);assert.match(f.say('!킵 취소').text,/사용 취소: 보상/);
 let user=f.store.load('room').users.listener;assert.deepEqual(user.keeps,['보상']);assert.equal(user.keepHistory[0].kind,'cancelled');
 f.advance(3100);assert.match(f.say('!킵 취소').text,/취소할 사용 완료 내역이 없습니다/);assert.deepEqual(f.store.load('room').users.listener.keeps,['보상']);
 f.advance(3100);assert.match(f.say('!킵 완료').text,/사용 완료한 킵이 없습니다/);
});

test('cancel targets completion numbering or exact name and never changes another listener',t=>{
 const f=fixture(t);f.say('!킵');f.store.transaction('room',r=>{r.users.listener.keeps=['첫 보상','둘째 보상'];r.users.other={...r.users.listener,id:'other',keeps:['타인 보상']};});
 f.advance(3100);f.say('!킵 사용 1');f.advance(3100);f.say('!킵 사용 1');f.advance(3100);
 assert.match(f.say('!킵 취소 2').text,/사용 취소: 첫 보상/);f.advance(3100);assert.match(f.say('!킵 취소 둘째 보상').text,/사용 취소: 둘째 보상/);
 assert.deepEqual(f.store.load('room').users.listener.keeps,['첫 보상','둘째 보상']);assert.deepEqual(f.store.load('room').users.other.keeps,['타인 보상']);
 f.advance(3100);assert.match(f.say('!킵 사용 @other 1').text,/찾을 수 없습니다/);
});

test('duplicate use and cancellation events are idempotent and stale monthly history cannot be restored',t=>{
 const f=fixture(t);f.say('!킵');f.store.transaction('room',r=>r.users.listener.keeps=['보상']);f.advance(3100);
 const event={id:'same-use',message:'!킵 사용 1',user:{id:'listener',nickname:'청취자'}};
 f.engine.handle('room',event);assert.equal(f.engine.handle('room',event).duplicate,true);assert.equal(f.store.load('room').users.listener.keepHistory.length,1);
 f.advance(3100);const cancel={...event,id:'same-cancel',message:'!킵 취소'};f.engine.handle('room',cancel);assert.equal(f.engine.handle('room',cancel).duplicate,true);assert.deepEqual(f.store.load('room').users.listener.keeps,['보상']);
 f.advance(3100);f.say('!킵 사용 1');f.advance(32*86400000);assert.match(f.say('!킵 취소').text,/지난달 사용 내역/);assert.deepEqual(f.store.load('room').users.listener.keeps,[]);
});

test('keeps remain valid until Korean month end and reset at midnight, including leap February and year rollover',t=>{
 for(const [last,expected,next]of [
  ['2026-11-30T23:59:59+09:00','2026-11-30','2026-12-31'],
  ['2028-02-29T23:59:59+09:00','2028-02-29','2028-03-31'],
  ['2026-12-31T23:59:59+09:00','2026-12-31','2027-01-31']
 ]){
  const f=fixture(t,Date.parse(last));f.store.transaction('room',r=>r.settings.responseGap=0);f.say('!킵');
  f.store.transaction('room',r=>{r.users.listener.keeps=['월말 보상'];r.users.listener.exp=123;});
  f.advance(0);let result=f.say('!킵'); // cooldown does not change the still-valid reward
  assert.deepEqual(f.store.load('room').users.listener.keeps,['월말 보상']);assert.match(keepExpiryLabel(Date.parse(last)),new RegExp(expected));
  f.advance(1000);result=f.say('!킵');assert.match(result.text,/보관 중인 킵이 없습니다/);assert.ok(result.text.includes(next));
  const user=f.store.load('room').users.listener;assert.deepEqual(user.keeps,[]);assert.equal(user.exp,123);
 }
});

test('listener can use and cancel after the global response gap without waiting for the game cooldown',t=>{
 const f=fixture(t);f.say('!내정보');f.store.transaction('room',r=>{r.settings.cooldown=300;r.users.listener.keeps=['보상'];});
 f.advance(3100);assert.match(f.say('!킵').text,/1\. 보상/);
 f.advance(3100);assert.match(f.say('!킵 사용 1').text,/사용 완료/);
 f.advance(3100);assert.match(f.say('!킵 취소').text,/사용 취소/);assert.deepEqual(f.store.load('room').users.listener.keeps,['보상']);
});
