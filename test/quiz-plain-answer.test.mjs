import test from 'node:test';
import assert from 'node:assert/strict';
import {Store,Engine} from '../core.mjs';
import {plainQuizAnswer} from '../quiz.mjs';

const T0=Date.parse('2026-11-20T03:00:00Z');
const NURSE={id:'nurse',question:'초성을 보고 단어를 맞혀보세요.',answers:['간호사','Nurse'],category:'직업',meaning:'환자를 돌보고 진료를 돕는 의료인'};
function quizRoom(settings={}){
 const store=new Store();store.create('room','방송');
 store.transaction('room',r=>Object.assign(r.settings,{quiz:true,quizQuestions:[NURSE],...settings}));
 let now=T0,sequence=0;const engine=new Engine(store,{now:()=>now,int:a=>a});
 const say=(message,{user='u1',nickname='민수',isDj=false,id}={})=>engine.handleAsync('room',{id:id||'q'+(++sequence),user:{id:user,nickname},message,isDj,delivery:true});
 const sharedRound=(patch={})=>store.transaction('room',r=>{r.autoQuizRound={...NURSE,key:'auto-1',reward:50,ticketReward:1,expChance:50,minutes:5,expiresAt:now+300000,...patch};});
 return {store,engine,say,sharedRound,advance:ms=>{now+=ms;},time:()=>now,load:()=>store.load('room')};
}

test('plainQuizAnswer accepts only the answer itself, in the ways people really type it',()=>{
 const now=T0,room={settings:{quiz:true,quiet:false},users:{},autoQuizRound:{answers:['간호사','Nurse'],expiresAt:now+1000}};
 const answer=text=>plainQuizAnswer(room,undefined,text,now);
 for(const text of ['간호사','간호 사','  간호사  ','간호사요','간호사입니다.','간호사예요!','간호사?','간호사~','간호사ㅋㅋ','정답 간호사','정답은 간호사','정답은 간호사예요!','정답: 간호사','"간호사"','(간호사)','답은 간호사'])assert.equal(answer(text),'간호사',text);
 for(const text of ['NURSE','ｎｕｒｓｅ','nurse!','정답 nurse'])assert.equal(answer(text),'Nurse',text); // 저장된 표기를 돌려줌
 for(const text of ['의사','간호','간호사 아닌가요','간호사 맞죠 ㅋㅋ 아닌가','안녕하세요','','   ','정답','!정답 간호사','오늘 간호사 선생님 만났어요'])assert.equal(answer(text),null,JSON.stringify(text));
 assert.equal(plainQuizAnswer(room,undefined,12345,now),null);
 assert.equal(plainQuizAnswer(room,undefined,'간호사',now+1000),null,'제한시간이 지난 문제');
 assert.equal(plainQuizAnswer({...room,settings:{quiz:false}},undefined,'간호사',now),null,'퀴즈가 꺼져 있음');
 assert.equal(plainQuizAnswer({...room,settings:{quiz:true,quiet:true}},undefined,'간호사',now),null,'조용 모드');
 assert.equal(plainQuizAnswer({...room,autoQuizRound:undefined},undefined,'간호사',now),null,'진행 중인 문제 없음');
 // 개인 문제가 있으면 개인 문제가 우선합니다.
 const personal={quizRound:{answers:['병원'],expiresAt:now+1000}};
 assert.equal(plainQuizAnswer(room,personal,'병원',now),'병원');assert.equal(plainQuizAnswer(room,personal,'간호사',now),null);
});
test('a personal quiz is answered with the answer alone, without !정답, even right after another reply',async()=>{
 const t=quizRoom();
 await t.say('!내정보 생성');t.advance(25000);
 const question=await t.say('!퀴즈');
 assert.match(question.text,/초성: ㄱㅎㅅ/);assert.match(question.text,/답만 입력하세요/);assert.ok(!question.text.includes('!정답 답안'));
 t.advance(1000); // 방금 봇이 답했고 개인 대기시간도 지나지 않았지만 정답은 놓치지 않음
 assert.equal((await t.say('의사')).text,null);               // 틀린 말에는 반응하지 않음
 assert.equal((await t.say('안녕하세요')).text,null);          // 일반 대화에도 반응하지 않음
 assert.ok(t.load().users.u1.quizRound,'틀린 말로 문제가 끝나지 않음');
 const solved=await t.say('간호사');
 assert.match(solved.text,/^민수님 정답! 간호사 · \+50 EXP/);assert.match(solved.text,/뜻: 환자를 돌보고/);
 assert.equal(t.load().users.u1.exp,50);assert.equal(t.load().users.u1.quizRound,undefined);
 t.advance(30000);assert.equal((await t.say('간호사')).text,null);   // 이미 끝난 문제는 오류 문구 없이 조용히
 assert.equal(t.load().users.u1.exp,50);
});
test('the explicit !정답 command keeps working and its wrong-answer hint explains the new way',async()=>{
 const t=quizRoom();
 await t.say('!내정보 생성');t.advance(25000);await t.say('!퀴즈');t.advance(25000);
 const wrong=await t.say('!정답 의사');assert.match(wrong.text,/아쉬워요! 정답: ㄱㅎㅅ/);assert.match(wrong.text,/답만 입력하세요/);
 t.advance(25000);assert.match((await t.say('!정답 간호사')).text,/정답!/);
 t.advance(25000);const usage=await t.say('!퀴즈 안녕');assert.match(usage.text,/답만 입력/);
});
test('everyone can answer the shared auto quiz in plain chat; only the first correct answer wins',async()=>{
 const t=quizRoom();t.sharedRound();
 t.store.transaction('room',r=>{r.lastResponse=t.time();}); // 방금 문제를 낸 직후에도 빠른 정답을 놓치지 않음
 assert.equal((await t.say('ㅋㅋㅋ',{user:'u9',nickname:'빠른사람'})).text,null);
 assert.equal((await t.say('이거 뭐지',{user:'u9',nickname:'빠른사람'})).text,null);
 assert.equal((await t.say('의사',{user:'u9',nickname:'빠른사람'})).text,null);
 const won=await t.say('간호사요!',{user:'u9',nickname:'빠른사람'});
 assert.match(won.text,/^빠른사람님 정답! 간호사 · \+50 EXP/);
 assert.equal(t.load().users.u9.exp,50);assert.equal(t.load().autoQuizRound,undefined,'정답자가 나오면 문제가 끝남');
 assert.equal((await t.say('간호사',{user:'u8',nickname:'늦은사람'})).text,null); // 늦은 정답은 조용히
 assert.equal(t.load().users.u8,undefined);
 // 정답이 거의 동시에 들어와 이미 끝난 문제가 되었다면 안에서 한 번 더 확인해 오류 문구 없이 넘어갑니다.
 const racing=quizRoom();racing.sharedRound();
 const event={id:'race-1',user:{id:'u7',nickname:'동시'},message:'간호사',isDj:false,delivery:true};
 racing.store.transaction('room',r=>{delete r.autoQuizRound;});
 const closed=racing.engine.handle('room',event,{plainQuiz:true,followup:true});
 assert.equal(closed.text,null);assert.equal(closed.suppressed,'quiz-closed');
 assert.equal(racing.engine.handle('room',event,{plainQuiz:true,followup:true}).duplicate,true);
});
test('the DJ, expired rounds, quiet mode and a disabled quiz never turn chat into answers',async()=>{
 const dj=quizRoom();dj.sharedRound();
 assert.equal((await dj.say('간호사',{user:'dj',nickname:'DJ',isDj:true})).text,null);
 assert.equal((await dj.say('간호사',{user:'room',nickname:'DJ'})).text,null);   // 방 ID가 곧 DJ 계정 ID
 assert.ok(dj.load().autoQuizRound,'DJ의 일반 채팅으로 문제가 끝나지 않음');
 dj.advance(2000);assert.match((await dj.say('!정답 간호사',{user:'dj',nickname:'DJ',isDj:true})).text,/정답!/); // DJ는 명령어로만 참여
 const late=quizRoom();late.sharedRound({expiresAt:late.time()+1000});late.advance(2000);
 assert.equal((await late.say('간호사')).text,null);assert.ok(late.load().autoQuizRound);
 const quiet=quizRoom({quiet:true});quiet.sharedRound();assert.equal((await quiet.say('간호사')).text,null);assert.ok(quiet.load().autoQuizRound);
 const off=quizRoom({quiz:false});off.sharedRound();assert.equal((await off.say('간호사')).text,null);
});
test('plain answers are not stolen by free talk, and a repeated event never pays twice',async()=>{
 const t=quizRoom();let ai=0;
 t.engine.lifestyle={resolveRegion:()=>null,converse:async()=>{ai++;return {text:'네, 들었어요!'};},answerParts:async()=>['x'],answer:async()=>'x'};
 assert.equal((await t.say('안녕하세요',{user:'u5',nickname:'수다쟁이'})).text,'네, 들었어요!');assert.equal(ai,1); // 수다 중(이어 말하기) 상태
 t.sharedRound();t.advance(10000);
 const solved=await t.say('간호사',{user:'u5',nickname:'수다쟁이',id:'same'});
 assert.match(solved.text,/수다쟁이님 정답!/);assert.equal(ai,1,'정답은 AI 대화로 넘어가지 않음');
 assert.equal((await t.say('간호사',{user:'u5',nickname:'수다쟁이',id:'same'})).duplicate,true);
 assert.equal(t.load().users.u5.exp,50);
});
