import {randomUUID} from 'node:crypto';
// Each listener has an independent round; a solved round cannot pay twice.
const questions=[
  ['word-school','학교','건물','학생들이 배우고 생활하는 교육 기관'],
  ['word-highschool','고등학생','학생','고등학교에 다니는 학생'],
  ['word-developer','개발자','직업','소프트웨어나 제품 등을 설계하고 만드는 사람'],
  ['word-library','도서관','건물','책과 자료를 모아 읽거나 빌릴 수 있게 한 곳'],
  ['word-firefighter','소방관','직업','화재를 진압하고 사람을 구조하는 일을 하는 사람'],
  ['word-student','대학생','학생','대학교에 다니는 학생'],
  ['word-nurse','간호사','직업','환자를 돌보고 진료를 돕는 의료인'],
  ['word-hospital','병원','건물','환자를 진찰하고 치료하는 의료 기관'],
  ['word-elementary','초등학생','학생','초등학교에 다니는 학생'],
  ['word-radio','라디오','방송','전파나 인터넷을 통해 소리를 전하는 방송 또는 수신 장치'],
].map(([id,answer,category,meaning])=>({id,question:'초성을 보고 단어를 맞혀보세요.',answers:[answer],category,meaning}));
export const defaultQuizQuestions=()=>structuredClone(questions);
const normalize=text=>String(text).normalize('NFKC').replace(/\s+/gu,'').toLocaleLowerCase('ko-KR');
// 지금 풀 수 있는 문제: 개인 문제가 먼저, 없으면 모두 함께 푸는 자동 퀴즈입니다. 퀴즈가 꺼져 있거나 조용 모드이거나 시간이 지났으면 null입니다.
export function activeQuizRound(r,u,now){
  if(!r?.settings?.quiz||r.settings.quiet)return null;
  const round=u?.quizRound||r.autoQuizRound;
  return round&&now<round.expiresAt?round:null;
}
// 명령어(!정답) 없이 입력한 말이 지금 풀 수 있는 문제의 정답과 같을 때만 그 정답(저장된 표기)을 돌려줍니다.
// "간호사"처럼 그냥 입력해도, "!간호사"처럼 느낌표만 붙여도 됩니다(진짜 명령어와 겹치는지는 호출하는 쪽이 가립니다).
// 틀린 말이나 일반 대화는 null이라 아무 반응도 하지 않습니다(자동 퀴즈 중 모든 채팅에 "오답"이 달리지 않게).
// "정답 간호사"·"정답은 간호사"·"간호사요"·"간호사입니다!"처럼 말끝만 다른 대답도 같은 답으로 봅니다.
export function plainQuizAnswer(r,u,message,now){
  const round=activeQuizRound(r,u,now);
  if(!round||typeof message!=='string')return null;
  const raw=message.normalize('NFC').trim().replace(/^[!！]\s*/u,'');
  const bare=raw.replace(/^["'“‘(\[]+|["'”’)\]]+$/gu,'').replace(/^(?:정답은|정답이|정답:|정답|답은|답이|답:|답)\s*/u,'').replace(/[\s?？!！.~〜…,，♡♥ㅋㅎㅠㅜ]+$/u,'');
  const plain=bare.replace(/(?:이?에요|입니다|이요|이야|이다|예요|요|야)$/u,'');
  const typed=[raw,bare,plain].map(normalize).filter(Boolean);
  return round.answers.find(answer=>typed.includes(normalize(answer)))??null;
}
export function quizHint(answer){
  return [...String(answer).normalize('NFC')].map(char=>{
    const code=char.codePointAt(0)-0xac00;
    if(code>=0&&code<11172)return 'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ'[Math.floor(code/588)];
    return /[\p{L}\p{N}]/u.test(char)?'○':char;
  }).join('');
}
const clip=(text,length=200)=>[...String(text)].slice(0,length).join('');
const meaning=round=>round.meaning||'이 문제의 뜻은 DJ가 아직 등록하지 않았습니다.';
const autoDelay=r=>(r.settings.autoQuizMinutes||10)*60000;
const autoMinutes=r=>Math.min(5,r.settings.quizMinutes||30);
const autoSignature=r=>JSON.stringify([r.settings.autoQuizMinutes,autoMinutes(r),r.settings.quizExp,r.settings.quizTickets,r.settings.quizExpChance,r.settings.quizQuestions]);
function finishAutoQuiz(engine,room,now){
 const round=room.autoQuizRound;
 delete room.autoQuizRound;
 room.autoQuizDueAt=now+autoDelay(room);
 const answer=round.answers[0];
 const hint=clip(quizHint(answer),30);
 const category=clip(round.category||'단어',20);
 engine.store.log(room.id,'system','quiz-timeout',{questionId:round.id,automatic:true},now);
 return {key:`auto-quiz-timeout:${round.key}`,text:clip(`⏰ 자동 퀴즈 종료! 정답자가 없어요.\n힌트: ${hint} (${category})\n정답: ${answer}\n뜻: ${meaning(round)}`)};
}
function roundText(round,label='모두 함께 자동 퀴즈!'){
 const prefix=`${label} 초성: ${clip(quizHint(round.answers[0]),30)} (힌트: ${clip(round.category||'단어',20)})\n`;
 const suffix=`\n정답만 입력하세요(! 붙여도 돼요) · ${round.minutes||30}분 제한 · 선착순 1명 EXP 또는 복권!`;
 return prefix+clip(round.question,Math.max(0,200-[...prefix+suffix].length))+suffix;
}
// Prepare before sending, activate only after Spoon confirms delivery.
export function autoQuizCandidate(engine,r,now){
 if(!r.live||!r.settings.quiz||!r.settings.autoQuizEnabled){delete r.autoQuizDueAt;delete r.autoQuizPending;delete r.autoQuizRound;return null;}
 if(r.settings.quiet||r.autoQuizRound)return null;
 const signature=autoSignature(r);
 if(r.autoQuizSignature!==signature){r.autoQuizSignature=signature;delete r.autoQuizPending;r.autoQuizDueAt??=now+autoDelay(r);}
 if(r.autoQuizPending)return now>=r.autoQuizPending.retryAt?r.autoQuizPending:null;
 r.autoQuizDueAt??=now+autoDelay(r);
 if(now<r.autoQuizDueAt||Object.values(r.users).some(u=>u.quizRound))return null;
 const bank=r.settings.quizQuestions||[];if(!bank.length)return null;
 r.autoQuizSeen=Array.isArray(r.autoQuizSeen)?r.autoQuizSeen:[];
 let pool=bank.filter(q=>!r.autoQuizSeen.includes(q.id));if(!pool.length){r.autoQuizSeen=[];pool=bank;}
 const selected=pool[engine.int(0,pool.length-1)];
 const round={...selected,key:randomUUID(),reward:r.settings.quizExp,ticketReward:r.settings.quizTickets||1,expChance:r.settings.quizExpChance??50,minutes:autoMinutes(r)};
 return r.autoQuizPending={key:round.key,round,text:roundText(round),signature,retryAt:now};
}
export function autoQuizDelivered(engine,r,candidate,kind,now){
 if(r.autoQuizPending?.key!==candidate.key)return;
 if(!r.live||r.settings.quiet||!r.settings.quiz||!r.settings.autoQuizEnabled||autoSignature(r)!==candidate.signature){delete r.autoQuizPending;return;}
 if(kind==='sent'){
  r.autoQuizRound={...candidate.round,expiresAt:now+candidate.round.minutes*60000};
  (r.autoQuizSeen??=[]).push(candidate.round.id);delete r.autoQuizDueAt;delete r.autoQuizPending;
  r.lastResponse=now;engine.store.log(r.id,'system','auto-quiz',{questionId:candidate.round.id},now);
 }else if(kind==='retry'||kind==='deferred'){r.autoQuizPending.retryAt=now+15000;}
 else{delete r.autoQuizPending;r.autoQuizDueAt=now+autoDelay(r);engine.store.log(r.id,'system','auto-quiz-send-failed',{kind},now);}
}
export function expireQuizRounds(engine,room,now){
 const expired=[];
 if(room.autoQuizRound&&now>=room.autoQuizRound.expiresAt){
  expired.push(finishAutoQuiz(engine,room,now));
 }
 for(const user of Object.values(room.users)){
  const round=user.quizRound;if(!round||now<round.expiresAt)continue;
  delete user.quizRound;
  expired.push({key:`quiz-timeout:${user.id}:${round.key||round.expiresAt}`,text:clip(`${user.name}님 퀴즈 시간이 지났습니다. 정답: ${round.answers[0]}\n뜻: ${meaning(round)}\n!퀴즈로 다시 도전하세요.`)});
  engine.store.log(room.id,user.id,'quiz-timeout',{questionId:round.id},now);
 }
 return expired;
}
export function playQuiz(engine,r,u,cmd,arg,now,fail){
  if(!['퀴즈','정답'].includes(cmd))return null;
  if(!r.settings.quiz)fail('퀴즈가 꺼져 있습니다. !게임 on으로 켜거나 게임 설정에서 활성화하세요.');
  if(cmd==='퀴즈'&&arg&&arg!=='포기')fail('사용법: !퀴즈 → 정답만 입력 / !포기');
  if(cmd==='퀴즈'&&r.autoQuizPending&&!u.quizRound)return '자동 퀴즈를 전송 중입니다. 문제가 나오면 정답만 입력해 참여하세요.';
  const shared=r.autoQuizRound;
  let round=u.quizRound||shared;
  if(shared&&!u.quizRound&&now>=shared.expiresAt){
    return finishAutoQuiz(engine,r,now).text;
  }
  if(shared&&!u.quizRound&&cmd==='퀴즈')return arg==='포기'?'함께 푸는 자동 퀴즈입니다. 정답만 입력해 참여하세요. 중지는 DJ가 !자동퀴즈 off를 입력하세요.':roundText(shared);
  if(round&&now>=round.expiresAt){delete u.quizRound;return clip(`${u.name}님 퀴즈 시간이 지났습니다. 정답: ${round.answers[0]}\n뜻: ${meaning(round)}\n!퀴즈로 새 문제를 받아주세요.`);}
  if(cmd==='퀴즈'&&arg==='포기'){
    if(!round)fail('진행 중인 문제가 없습니다. !퀴즈로 문제를 받아 주세요.');
    delete u.quizRound;return clip(`정답은 ${round.answers[0]}! 뜻: ${meaning(round)}\n!퀴즈로 다음 문제에 도전해 보세요.`);
  }
  if(cmd==='퀴즈'){
    if(!round){
      u.quizSeen=Array.isArray(u.quizSeen)?u.quizSeen:[];
      const bank=r.settings.quizQuestions||questions;
      let pool=bank.filter(q=>!u.quizSeen.includes(q.id));
      if(!pool.length){u.quizSeen=[];pool=bank;}
      if(!pool.length)fail('등록된 퀴즈가 없습니다. DJ에게 문제 등록을 요청해 주세요.');
      const selected=pool[engine.int(0,pool.length-1)];u.quizSeen.push(selected.id);
      round=u.quizRound={...selected,key:randomUUID(),reward:r.settings.quizExp,ticketReward:r.settings.quizTickets||1,expChance:r.settings.quizExpChance??50,expiresAt:now+Math.min(30,r.settings.quizMinutes||30)*60000};
    }
    const prefix=`${clip(u.name,12)}님 퀴즈! 초성: ${clip(quizHint(round.answers[0]),30)} (힌트: ${clip(round.category||'단어',20)})\n`;
    const suffix=`\n정답만 입력하세요(! 붙여도 돼요) · ${Math.ceil((round.expiresAt-now)/60000)}분 · EXP ${round.expChance??100}% / 복권 ${100-(round.expChance??100)}% · !포기`;
    return prefix+clip(round.question,Math.max(0,200-[...prefix+suffix].length))+suffix;
  }
  if(!arg.trim())fail('사용법: 정답만 입력하세요(! 붙여도 돼요). 먼저 !퀴즈로 문제를 받아 주세요.');
  if(!round)fail('진행 중인 문제가 없거나 시간이 지났습니다. !퀴즈로 새 문제를 받아 주세요.');
  if(!round.answers.some(answer=>normalize(answer)===normalize(arg)))return `${u.name}님, 아쉬워요! 정답: ${quizHint(round.answers[0])} (초성) · 정답만 입력하세요 / !포기`;
  const expReward=engine.int(1,100)<=(round.expChance??100),reward=expReward?round.reward:0,tickets=expReward?0:(round.ticketReward||1);
  const next=u.exp+reward;
  if(!Number.isSafeInteger(next))fail('경험치가 처리 가능한 범위를 초과해 지급하지 않았습니다.');
  if(!Number.isSafeInteger(u.tickets+tickets))fail('복권 보유량이 처리 가능한 범위를 초과합니다.');
  const previousLevel=Math.floor(u.exp/r.settings.levelStep)+1,level=Math.floor(next/r.settings.levelStep)+1;
  u.exp=next;u.tickets+=tickets;if(tickets)u.ticketRevision=(u.ticketRevision||0)+1;
  if(round===shared){delete r.autoQuizRound;r.autoQuizDueAt=now+autoDelay(r);}else delete u.quizRound;
  engine.store.log(r.id,u.id,'minigame-quiz',{questionId:round.id,exp:reward,tickets,totalExp:next,level},now);
  return clip(`${u.name}님 정답! ${round.answers[0]} · ${expReward?'+'+reward+' EXP':'복권 '+tickets+'장 지급'}\n뜻: ${meaning(round)}\n누적 ${next.toLocaleString('ko-KR')} EXP · ${level>previousLevel?`레벨업! Lv.${previousLevel} → Lv.${level}`:`Lv.${level} · 다음 레벨까지 ${(r.settings.levelStep-next%r.settings.levelStep).toLocaleString('ko-KR')} EXP`}`);
}
