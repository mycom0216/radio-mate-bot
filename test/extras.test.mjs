import test from 'node:test';
import assert from 'node:assert/strict';
import {Store,Engine,defaults,validateSettings} from '../core.mjs';
import {Spoon} from '../spoon.mjs';
import {autoChatCandidate} from '../extras.mjs';
function fixture(){
  const store=new Store();store.create('a','A');let now=Date.parse('2026-11-16T00:00:00Z'),draw=0,count=0;
  store.transaction('a',r=>Object.assign(r.settings,{quizMinutes:5,quizExpChance:100,quizQuestions:[{id:'capital',question:'대한민국의 수도는 어디일까요?',answers:['서울','서울특별시']},{id:'week',question:'일주일은 모두 며칠일까요?',answers:['7','7일','칠일']}]}));
  const engine=new Engine(store,{now:()=>now,int:(min,max)=>Math.min(max,Math.max(min,draw))});
  const event=(message,user='u')=>({id:`extra-${++count}`,message,user:{id:user,nickname:'청취자'}});
  const say=(message,user='u')=>{now+=21000;return engine.handle('a',event(message,user));};
  return {store,engine,event,say,advance:ms=>now+=ms,draw:value=>draw=value};
}

test('custom quiz bank accepts aliases and preserves an already issued question',()=>{
  const f=fixture();f.say('!내정보 생성');
  f.store.transaction('a',r=>Object.assign(r.settings,{quiz:true,quizMinutes:1,quizQuestions:[{id:'dj',question:'방송 이름은?',answers:['라디오메이트','radio mate']}]}));
  assert.match(f.say('!퀴즈').text,/방송 이름/);
  f.store.transaction('a',r=>r.settings.quizQuestions=[{id:'new',question:'새 문제',answers:['새 정답']}]);
  assert.match(f.say('!정답 ＲＡＤＩＯ mate').text,/정답!/);
  assert.match(f.say('!퀴즈').text,/새 문제/);f.advance(60001);
  assert.match(f.say('!정답 새 정답').text,/시간이 지났/);f.store.db.close();
});
test('quiz bank validation rejects malformed or duplicated rows and game ON handles an empty bank',()=>{
  for(const bank of [[{id:'x',question:'문제',answers:[]}],[{id:'x',question:'',answers:['답']}],[{id:'x',question:'문제',answers:['답']},{id:'x',question:'중복',answers:['답']}]]){
    const s=defaults();s.quizQuestions=bank;assert.throws(()=>validateSettings(s),/퀴즈/);
  }
  const f=fixture();f.store.transaction('a',r=>{r.settings.quizQuestions=[];r.settings.quiz=false;});
  assert.match(f.say('!게임 on').text,/퀴즈는 문제/);
  assert.equal(f.store.load('a').settings.quiz,false);assert.equal(f.store.load('a').settings.fishing,true);f.store.db.close();
});
test('new settings safely default old backups and validate automatic chat rules',()=>{
  const s=defaults();delete s.rps;delete s.autoReplies;validateSettings(s);assert.equal(s.rps,false);assert.deepEqual(s.autoReplies,[]);
  s.autoChatEnabled=true;s.autoChatMessages=[];assert.throws(()=>validateSettings(s),/문구/);
  s.autoChatMessages=['안내'];s.autoReplies=[{id:'r',keyword:'안녕',match:'regex',text:'반가워요',enabled:true,cooldown:60}];assert.throws(()=>validateSettings(s),/키워드/);
});
test('mini games validate inputs and never change PT or EXP',()=>{
  const f=fixture();f.say('!내정보 생성');assert.match(f.say('!주사위').text,/꺼져/);
  f.store.transaction('a',r=>Object.assign(r.settings,{rps:true,dice:true,numberGuess:true}));
  f.draw(0);assert.match(f.say('!가위바위보 바위').text,/승리/);assert.match(f.say('!가위바위보 가위').text,/무승부/);assert.match(f.say('!가위바위보 보').text,/패배/);
  f.draw(6);assert.match(f.say('!주사위 6').text,/맞혔습니다/);assert.match(f.say('!주사위 7').text,/사용법/);
  const u=f.store.load('a').users.u;assert.equal(u.pt,0);assert.equal(u.exp,0);f.store.db.close();
});

test('quiz gives one EXP reward, announces level-up and cannot repeat a solved round',()=>{
  const f=fixture();f.say('!내정보 생성');assert.match(f.say('!퀴즈').text,/꺼져/);
  f.say('!게임 on');f.store.transaction('a',r=>{r.settings.levelStep=100;r.users.u.exp=60;});
  assert.match(f.say('!퀴즈').text,/수도/);assert.match(f.say('!퀴즈').text,/수도/);
  assert.match(f.say('!정답 부산').text,/아쉬워/);assert.equal(f.store.load('a').users.u.exp,60);
  f.advance(21000);const event=f.event('!정답 서 울');const out=f.engine.handle('a',event);
  assert.match(out.text,/정답!.*50 EXP/);assert.match(out.text,/레벨업! Lv.1 → Lv.2/);
  assert.equal(f.engine.handle('a',event).duplicate,true);assert.equal(f.store.load('a').users.u.exp,110);
  assert.match(f.say('!정답 서울').text,/진행 중인 문제/);assert.equal(f.store.load('a').users.u.exp,110);
  assert.match(f.say('!내정보').text,/다음 레벨까지 90 EXP/);
  assert.equal(f.store.logs('a').filter(l=>l.type==='minigame-quiz').length,1);
  assert.match(f.say('!퀴즈').text,/일주일/);f.store.db.close();
});
test('quiz has isolated rounds, expires, skips without EXP, and obeys quiet mode and DJ-only OFF',()=>{
  const f=fixture();f.say('!내정보 생성');f.say('!내정보 생성','v');f.say('!게임 on');
  f.say('!퀴즈');assert.match(f.say('!정답 서울','v').text,/진행 중인 문제/);
  assert.match(f.say('!게임 off').text,/DJ 전용/);assert.equal(f.store.load('a').settings.quiz,true);
  assert.match(f.say('!퀴즈 포기').text,/정답은 서울/);assert.equal(f.store.load('a').users.u.exp,0);
  f.say('!퀴즈');f.advance(300001);assert.match(f.say('!정답 7').text,/시간이 지났/);
  f.store.transaction('a',r=>r.settings.quiet=true);assert.equal(f.say('!퀴즈').text,null);
  assert.equal(f.store.load('a').users.u.exp,0);f.store.db.close();
});
test('quiz reward validates old settings and snapshots EXP for the current round',()=>{
  const s=defaults();delete s.quiz;delete s.quizExp;validateSettings(s);assert.equal(s.quiz,false);assert.equal(s.quizExp,50);
  for(const amount of [0,-1,.5,1000001]){s.quizExp=amount;assert.throws(()=>validateSettings(s),/퀴즈/);}
  const f=fixture();f.say('!내정보 생성');f.say('!게임 on');f.say('!퀴즈');
  f.store.transaction('a',r=>r.settings.quizExp=100);
  assert.match(f.say('!정답 서울').text,/50 EXP/);assert.equal(f.store.load('a').users.u.exp,50);
  f.say('!퀴즈');assert.match(f.say('!정답 7일').text,/100 EXP/);assert.equal(f.store.load('a').users.u.exp,150);
  assert.equal(f.store.load('a').users.u.pt,0);f.store.db.close();
});
test('number guessing keeps attempts, deduplicates events, finishes after 7 and supports reset',()=>{
  const f=fixture();f.say('!내정보 생성');f.store.transaction('a',r=>r.settings.numberGuess=true);f.draw(42);
  assert.match(f.say('!숫자맞히기 50').text,/작은/);f.advance(21000);const event=f.event('!숫자맞히기 20');f.engine.handle('a',event);f.engine.handle('a',event);assert.equal(f.store.load('a').users.u.numberGame.attempts,2);
  assert.match(f.say('!숫자맞히기 42').text,/정답/);assert.equal(f.store.load('a').users.u.numberGame,undefined);
  f.draw(100);for(let i=0;i<7;i++)f.say('!숫자맞히기 1');assert.equal(f.store.load('a').users.u.numberGame,undefined);
  f.say('!숫자맞히기 50');f.say('!숫자맞히기 초기화');assert.equal(f.store.load('a').users.u.numberGame,undefined);
  f.store.transaction('a',r=>r.settings.quiet=true);assert.equal(f.say('!숫자맞히기 10').text,null);f.store.db.close();
});
test('keyword replies normalize text, enforce cooldown and quiet mode, and preserve built-in commands',()=>{
  const f=fixture();f.store.transaction('a',r=>r.settings.autoReplies=[{id:'greet',keyword:'HELLO',match:'contains',text:'{name}님 환영합니다',enabled:true,cooldown:60},{id:'custom',keyword:'!안내',match:'exact',text:'설정한 안내입니다',enabled:true,cooldown:1}]);
  assert.equal(f.say('hello everyone','guest').text,'청취자님 환영합니다');assert.equal(Object.keys(f.store.load('a').users).length,0);
  assert.equal(f.say('ＨＥＬＬＯ','another').text,null);f.advance(60000);assert.ok(f.say('hello').text);
  assert.equal(f.say('!안내 더보기').text,null);assert.equal(f.say('!안내').text,'설정한 안내입니다');
  assert.match(f.say('!도움말').text,/내정보/);f.store.transaction('a',r=>r.settings.quiet=true);assert.equal(f.say('!안내').text,null);f.store.db.close();
});
test('weather placeholders in periodic chat are replaced at send time and skipped when the lookup fails',async()=>{
  const f=fixture(),spoon=new Spoon(f.store,f.engine,{}),messages=[],requests=[];let fail=false;
  f.engine.lifestyle={answer:async(request,context)=>{requests.push([request,context]);if(fail)throw Error('조회 실패');return '서울 오늘 브리핑';}};
  f.store.transaction('a',r=>{r.live=true;r.settings.introEnabled=false;Object.assign(r.settings,{autoChatEnabled:true,autoChatMinutes:1,autoChatMessages:['좋은 아침 {브리핑 서울}','{날씨 부산}','일반 안내']});});
  spoon.send=async(room,text)=>{messages.push(text);return true;};await spoon.tick();
  const due=()=>f.store.transaction('a',r=>{r.autoChat.dueAt=Date.now()-1;r.lastResponse=0;});
  due();await spoon.tick();assert.deepEqual(messages,['좋은 아침 서울 오늘 브리핑']);assert.deepEqual(requests[0],[{kind:'날씨',arg:'서울 브리핑'},{strict:true}]);
  fail=true;due();await spoon.tick();assert.equal(messages.length,1);assert.equal(f.store.load('a').autoChat.index,2); // {날씨 부산} 조회가 실패하면 보내지 않고 다음 순서로
  due();await spoon.tick();assert.equal(messages.at(-1),'일반 안내');assert.deepEqual(requests.at(-1)[0],{kind:'날씨',arg:'부산'});f.store.db.close();
});
test('periodic chat schedules sequential/random messages and retries without advancing on failure',async()=>{
  const f=fixture(),spoon=new Spoon(f.store,f.engine,{});let success=false,messages=[];
  f.store.transaction('a',r=>{r.live=true;r.settings.introEnabled=false;Object.assign(r.settings,{autoChatEnabled:true,autoChatMinutes:1,autoChatMessages:['첫 안내','둘째 안내']});});
  spoon.send=async(room,text)=>{messages.push(text);return success;};await spoon.tick();assert.equal(messages.length,0);
  f.store.transaction('a',r=>r.autoChat.dueAt=Date.now()-1);await spoon.tick();assert.deepEqual(messages,['첫 안내']);assert.equal(f.store.load('a').autoChat.index,0);
  success=true;await spoon.tick();assert.equal(f.store.load('a').autoChat.index,1);f.store.transaction('a',r=>r.autoChat.dueAt=Date.now()-1);
  f.store.transaction('a',r=>r.lastResponse=0);await spoon.tick();assert.equal(messages.at(-1),'둘째 안내');
  const r=f.store.load('a');r.settings.autoChatMode='random';autoChatCandidate(r,0,()=>1);r.autoChat.dueAt=0;assert.equal(autoChatCandidate(r,1,()=>1).text,'둘째 안내');f.store.db.close();
});
