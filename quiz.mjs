// Each listener has an independent round; a solved round cannot pay twice.
const questions=[
  ['capital','대한민국의 수도는 어디일까요?',['서울','서울특별시']],
  ['week','일주일은 모두 며칠일까요?',['7','7일','칠일']],
  ['planet','우리가 살고 있는 행성의 이름은?',['지구']],
  ['triangle','삼각형의 변은 몇 개일까요?',['3','3개','세개']],
  ['hour','한 시간은 몇 분일까요?',['60','60분','육십분']],
  ['rainbow','흔히 무지개를 몇 가지 색으로 표현할까요?',['7','7가지','7색','일곱가지']],
  ['seasons','봄 다음에 오는 계절은 무엇일까요?',['여름']],
  ['hangeul','한글을 창제한 조선의 왕은 누구일까요?',['세종','세종대왕']],
  ['sum','12와 8을 더하면 얼마일까요?',['20','이십']],
  ['freeze','표준 대기압에서 순수한 물이 어는 온도는 섭씨 몇 도일까요?',['0','0도','영도']],
].map(([id,question,answers])=>({id,question,answers}));
export const defaultQuizQuestions=()=>structuredClone(questions);
const normalize=text=>String(text).normalize('NFKC').replace(/\s+/gu,'').toLocaleLowerCase('ko-KR');
export function playQuiz(engine,r,u,cmd,arg,now,fail){
  if(!['퀴즈','정답'].includes(cmd))return null;
  if(!r.settings.quiz)fail('퀴즈가 꺼져 있습니다. !게임 on으로 켜거나 게임 설정에서 활성화하세요.');
  if(cmd==='퀴즈'&&arg&&arg!=='포기')fail('사용법: !퀴즈 / !정답 답안 / !퀴즈 포기');
  let round=u.quizRound;
  if(round&&now>=round.expiresAt){delete u.quizRound;round=null;}
  if(cmd==='퀴즈'&&arg==='포기'){
    if(!round)fail('진행 중인 문제가 없습니다. !퀴즈로 문제를 받아 주세요.');
    delete u.quizRound;return `정답은 ${round.answers[0]}! !퀴즈로 다음 문제에 도전해 보세요.`;
  }
  if(cmd==='퀴즈'){
    if(!round){
      u.quizSeen=Array.isArray(u.quizSeen)?u.quizSeen:[];
      const bank=r.settings.quizQuestions||questions;
      let pool=bank.filter(q=>!u.quizSeen.includes(q.id));
      if(!pool.length){u.quizSeen=[];pool=bank;}
      if(!pool.length)fail('등록된 퀴즈가 없습니다. DJ에게 문제 등록을 요청해 주세요.');
      const selected=pool[engine.int(0,pool.length-1)];u.quizSeen.push(selected.id);
      round=u.quizRound={...selected,reward:r.settings.quizExp,expiresAt:now+(r.settings.quizMinutes||5)*60000};
    }
    return `${u.name}님 퀴즈! ${round.question}\n!정답 답안 으로 입력하세요. 정답 +${round.reward} EXP · 남은 시간 ${Math.ceil((round.expiresAt-now)/60000)}분 · !퀴즈 포기`;
  }
  if(!arg.trim())fail('사용법: !정답 답안 (먼저 !퀴즈로 문제를 받아 주세요.)');
  if(!round)fail('진행 중인 문제가 없거나 시간이 지났습니다. !퀴즈로 새 문제를 받아 주세요.');
  if(!round.answers.some(answer=>normalize(answer)===normalize(arg)))return `${u.name}님, 아쉬워요! 다시 생각해 보세요. !정답 답안 / !퀴즈 포기`;
  const next=u.exp+round.reward;
  if(!Number.isSafeInteger(next))fail('경험치가 처리 가능한 범위를 초과해 지급하지 않았습니다.');
  const previousLevel=Math.floor(u.exp/r.settings.levelStep)+1,level=Math.floor(next/r.settings.levelStep)+1;
  u.exp=next;delete u.quizRound;
  engine.store.log(r.id,u.id,'minigame-quiz',{questionId:round.id,exp:round.reward,totalExp:next,level},now);
  return `${u.name}님 정답! ${round.answers[0]} · +${round.reward} EXP\n누적 ${next.toLocaleString('ko-KR')} EXP · ${level>previousLevel?`레벨업! Lv.${previousLevel} → Lv.${level}`:`Lv.${level} · 다음 레벨까지 ${(r.settings.levelStep-next%r.settings.levelStep).toLocaleString('ko-KR')} EXP`}\n!퀴즈로 다음 문제에 도전하세요.`;
}
