import test from 'node:test';
import assert from 'node:assert/strict';
import {Store,Engine,defaults,validateSettings} from '../core.mjs';
import {Spoon} from '../spoon.mjs';
import {autoQuizCandidate,autoQuizDelivered,expireQuizRounds} from '../quiz.mjs';

function fixture(){
 const store=new Store();store.create('r','자동 퀴즈');let now=Date.now(),seq=0;
 const engine=new Engine(store,{now:()=>now,int:min=>min});
 const say=(message,user='dj',isDj=true)=>engine.handle('r',{id:'auto-'+(++seq),message,isDj,user:{id:user,nickname:user}});
 store.transaction('r',r=>{r.live=true;r.settings.quiz=true;r.settings.autoQuizEnabled=true;r.settings.responseGap=0;r.settings.cooldown=0;r.settings.introEnabled=false;});
 const prepare=()=>{let candidate;store.transaction('r',r=>{candidate=autoQuizCandidate(engine,r,now);});return candidate;};
 return {store,engine,say,prepare,get now(){return now;},advance:ms=>now+=ms,load:()=>store.load('r'),deliver:(candidate,kind='sent')=>store.transaction('r',r=>autoQuizDelivered(engine,r,candidate,kind,now)),close:()=>store.db.close()};
}

test('automatic quiz waits for its interval, first answer wins once and next round avoids repeat',()=>{
 const f=fixture();try{
  assert.equal(f.prepare(),null);f.advance(600000);const question=f.prepare();assert.match(question.text,/ㅎㄱ \(힌트: 건물\)/);
  assert.equal(f.load().autoQuizRound,undefined);f.deliver(question);assert.ok(f.load().autoQuizRound);
  assert.equal(f.prepare(),null);assert.match(f.say('!퀴즈').text,/모두 함께/);
  const won=f.say('!정답 학교','new-listener',false);assert.match(won.text,/정답!.*50 EXP/);assert.equal(f.load().users['new-listener'].exp,50);
  f.say('!내정보','second-listener',false);
  assert.match(f.say('!정답 학교','second-listener',false).text,/진행 중인 문제가 없/);assert.equal(f.load().users['new-listener'].exp,50);assert.equal(f.load().users['second-listener'].exp,0);
  assert.equal(f.prepare(),null);f.advance(600000);assert.notEqual(f.prepare().round.id,question.round.id);
 }finally{f.close();}
});

test('automatic quiz timeout reveals answer and meaning once without granting reward',()=>{
 const f=fixture();try{
  f.say('!자동퀴즈 on 1');const q=f.prepare();f.deliver(q);f.advance(30*60000);
  let expired;f.store.transaction('r',r=>expired=expireQuizRounds(f.engine,r,f.now));
  assert.equal(expired.length,1);assert.match(expired[0].text,/정답: 학교/);assert.match(expired[0].text,/뜻:.*교육 기관/);
  f.store.transaction('r',r=>expired=expireQuizRounds(f.engine,r,f.now));assert.equal(expired.length,0);
  assert.equal(f.load().autoQuizRound,undefined);assert.equal(f.prepare(),null);
 }finally{f.close();}
});

test('DJ config, quiet/offline modes and personal rounds prevent unsolicited or overlapping quizzes',()=>{
 const f=fixture();try{
  assert.match(f.say('!자동퀴즈 on 2','listener',false).text,/DJ 전용/);
  assert.match(f.say('!자동퀴즈 on 0').text,/1~1440/);
  f.say('!퀴즈');f.say('!자동퀴즈 on 1');assert.equal(f.prepare(),null);
  f.say('!퀴즈 포기');f.store.transaction('r',r=>r.settings.quiet=true);assert.equal(f.prepare(),null);
  f.store.transaction('r',r=>r.settings.quiet=false);const q=f.prepare();assert.ok(q);
  f.say('!자동퀴즈 off');f.deliver(q);assert.equal(f.load().autoQuizRound,undefined);
  f.say('!자동퀴즈 on 2');f.store.transaction('r',r=>r.live=false);assert.equal(f.prepare(),null);
  assert.equal(f.load().autoQuizPending,undefined);
 }finally{f.close();}
});

test('failed/deferred delivery never starts a round and settings changes invalidate in-flight delivery',()=>{
 const f=fixture();try{
  f.say('!자동퀴즈 on 1');let q=f.prepare();f.deliver(q,'deferred');assert.equal(f.load().autoQuizRound,undefined);assert.equal(f.prepare(),null);
  f.advance(15000);assert.equal(f.prepare().key,q.key);f.deliver(q,'ambiguous');assert.equal(f.load().autoQuizRound,undefined);assert.equal(f.prepare(),null);
  f.advance(60000);q=f.prepare();f.store.transaction('r',r=>r.settings.quizExp=999);f.deliver(q);assert.equal(f.load().autoQuizRound,undefined);
 }finally{f.close();}
});

test('actual Spoon scheduler sends one automatic question and persists the active shared round',async()=>{
 const f=fixture();try{
  f.say('!자동퀴즈 on 1');f.store.transaction('r',r=>r.autoQuizDueAt=Date.now()-1);
  const spoon=new Spoon(f.store,f.engine,{}),messages=[];
  spoon.sendDetailed=async(room,text)=>{messages.push(text);return {kind:'sent'};};
  await spoon.tick();await spoon.tick();assert.equal(messages.length,1);assert.match(messages[0],/모두 함께 자동 퀴즈/);
  assert.ok(f.load().autoQuizRound);assert.equal(f.load().autoQuizPending,undefined);
 }finally{f.close();}
});

test('automatic quiz settings reject invalid intervals and preserve backwards compatible defaults',()=>{
 const settings=defaults();delete settings.autoQuizEnabled;delete settings.autoQuizMinutes;
 validateSettings(settings);assert.equal(settings.autoQuizEnabled,false);assert.equal(settings.autoQuizMinutes,10);
 for(const value of [0,1441,1.5,'10'])assert.throws(()=>validateSettings({...settings,autoQuizMinutes:value}),/1~1440/);
 assert.throws(()=>validateSettings({...settings,autoQuizEnabled:'yes'}),/ON\/OFF/);
});
