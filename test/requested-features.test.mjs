import test from 'node:test';
import assert from 'node:assert/strict';
import {Store,Engine,defaults} from '../core.mjs';
import {Spoon} from '../spoon.mjs';
import {emailAlias} from '../targets.mjs';
import {affinityScore} from '../public/affinity.mjs';
import {updateRequestedRules} from '../rules-update.mjs';
function fixture(){const store=new Store();store.create('r','R');let time=Date.parse('2026-11-18T00:00:00+09:00'),draw=0,seq=0;
 const engine=new Engine(store,{now:()=>time,int:(min,max)=>Math.max(min,Math.min(max,draw)),identityKey:'test-private-key'});
 const say=(message,user='u',name=user,id)=>engine.handle('r',{id:id||String(++seq),message,isDj:true,user:{id:user,nickname:name}});
 return {store,engine,say,setDraw:n=>draw=n,advance:ms=>time+=ms,snapshot:list=>engine.listenerSnapshot('r',list,time),load:()=>store.load('r'),close:()=>store.db.close()};}
test('daily attendance grants 20 once while listening grants at most 100 tickets independently',()=>{
 const f=fixture();try{f.say('!내정보');assert.match(f.say('!출석','u','u','attend').text,/20장/);assert.equal(f.say('!출석','u','u','attend').duplicate,true);assert.match(f.say('!출석').text,/이미/);
 f.store.transaction('r',r=>r.live=true);const list=[{id:'u',nickname:'u'}];f.snapshot(list);for(let i=0;i<505;i++){f.advance(60000);f.snapshot(list);}
 assert.equal(f.load().users.u.tickets,120);assert.equal(f.load().users.u.listenPaid,100);assert.equal(f.load().settings.listenMinutes,5);
 }finally{f.close();}
});
test('hourly chatting and listening increase affinity and select a different ranking than EXP',()=>{
 const f=fixture();try{f.say('!내정보');f.say('!내정보','v');f.store.transaction('r',r=>{r.live=true;r.users.v.exp=9999;});
 f.say('첫 채팅','u','u','chat');const score=affinityScore(f.load().users.u);assert.equal(score,5);f.say('첫 채팅','u','u','chat');f.say('또 채팅');assert.equal(affinityScore(f.load().users.u),5);
 f.advance(3600000);f.say('한 시간 뒤');assert.equal(affinityScore(f.load().users.u),10);
 const list=[{id:'u',nickname:'u'}];f.snapshot(list);f.advance(60000);f.snapshot(list);assert.equal(affinityScore(f.load().users.u),11);
 assert.match(f.say('!랭킹','dj').text,/1\. u /);assert.match(f.say('!경험치랭킹','dj').text,/1\. v /);
 }finally{f.close();}
});
test('quiz provides category initials and meaning, chooses EXP or tickets, and never pays twice',()=>{
 for(const ticket of [false,true]){const f=fixture();try{
  f.say('!내정보');f.store.transaction('r',r=>r.settings.quiz=true);
  const question=f.say('!퀴즈');assert.match(question.text,/ㅎㄱ \(힌트: 건물\)/);assert.ok(!question.text.includes('교육 기관'));
  f.setDraw(ticket?100:1);f.advance(1799000);const out=f.say('!정답 학교','u','u','solve');assert.match(out.text,/정답!/);assert.match(out.text,/뜻:.*교육 기관/);
  assert.equal(f.load().users.u.exp,ticket?0:50);assert.equal(f.load().users.u.tickets,ticket?1:0);assert.equal(f.say('!정답 학교','u','u','solve').duplicate,true);
 }finally{f.close();}}
});
test('scheduler reveals expired answer and definition once without paying a reward',async()=>{
 const f=fixture();try{f.say('!내정보');f.store.transaction('r',r=>{r.settings.quiz=true;r.settings.introEnabled=false;});f.say('!퀴즈');
 f.store.transaction('r',r=>{r.live=true;r.users.u.quizRound.expiresAt=Date.now()-1;});const spoon=new Spoon(f.store,f.engine,{}),messages=[];spoon.sendDetailed=async(room,text)=>{messages.push(text);return {kind:'sent'};};
 await spoon.tick();await spoon.tick();assert.equal(messages.length,1);assert.match(messages[0],/정답: 학교/);assert.match(messages[0],/교육 기관/);assert.equal(f.load().users.u.quizRound,undefined);assert.equal(f.load().users.u.tickets,0);assert.equal(f.load().users.u.exp,0);
 }finally{f.close();}
});
test('private email aliases are scoped hashes and account aliases support ticket lookup',()=>{
 const f=fixture();try{f.say('!내정보');const hash=emailAlias('Fan@example.test',f.engine.identityKey,'r');assert.notEqual(hash,emailAlias('Fan@example.test',f.engine.identityKey,'other'));
 f.store.transaction('r',r=>{r.users.u.emailAlias=hash;r.users.u.accountAlias='spoon_id';});
 assert.match(f.say('!복권지급 fan@example.test 3','dj').text,/3장 지급/);assert.match(f.say('!복권지급 @spoon_id 2','dj').text,/2장 지급/);assert.equal(f.load().users.u.tickets,5);
 assert.match(f.say('!복권지급 unknown@example.test 3','dj').text,/연결된 이메일/);assert.ok(!JSON.stringify(f.load()).includes('fan@example.test'));
 }finally{f.close();}
});
test('rule migration preserves custom quiz banks and changes defaults only once',()=>{
 const room={settings:defaults()};room.settings.listenDailyCap=12;room.settings.quizQuestions=Array.from({length:100},(_,i)=>({id:'custom-'+i,question:'문제',answers:['답']}));
 assert.equal(updateRequestedRules(room),true);assert.equal(room.settings.listenDailyCap,100);assert.equal(room.settings.quizMinutes,30);assert.equal(room.settings.quizQuestions.length,100);assert.equal(room.settings.quizQuestions[0].id,'custom-0');
 room.settings.listenDailyCap=7;assert.equal(updateRequestedRules(room),false);assert.equal(room.settings.listenDailyCap,7);
});
test('chat playback resolves a title and records its request without any browser player',async()=>{
 const f=fixture();try{f.say('!신청곡 탑현 - 나에게 그대만이');f.engine.searchSong=async title=>{assert.match(title,/탑현/);return 'pg25CSvNrEE';};
 const out=await f.engine.handleAsync('r',{id:'remote-play',message:'!재생',isDj:true,user:{id:'u',nickname:'u'}});assert.match(out.text,/pg25CSvNrEE/);assert.equal(f.load().current.videoId,'pg25CSvNrEE');assert.equal(f.load().playbackState,'requested');
 f.say('!멈춤');assert.equal(f.load().playbackState,'paused');assert.equal(f.load().playbackControl.action,'pause');
 }finally{f.close();}
});
test('word-quiz migration replaces untouched legacy defaults but preserves edited questions',()=>{
 const room={rulesVersion:3,settings:{...defaults(),quizQuestions:[{id:'capital',question:'대한민국의 수도는 어디일까요?',answers:['서울','서울특별시']},{id:'week',question:'DJ가 직접 바꾼 문제',answers:['내 답']}]}};
 assert.equal(updateRequestedRules(room),true);assert.ok(!room.settings.quizQuestions.some(q=>q.id==='capital'));assert.equal(room.settings.quizQuestions.find(q=>q.id==='week').question,'DJ가 직접 바꾼 문제');assert.ok(room.settings.quizQuestions.some(q=>q.id==='word-school'));
});
