import {defaultQuizQuestions} from './quiz.mjs';
export function extraDefaults(){return {affinityNotices:true,listenRewards:true,listenMinutes:5,listenTickets:1,listenDailyCap:100,rps:false,dice:false,numberGuess:false,quiz:false,autoQuizEnabled:false,autoQuizMinutes:10,quizExp:50,quizTickets:1,quizExpChance:50,quizMinutes:30,quizQuestions:defaultQuizQuestions(),autoReplies:[],autoChatEnabled:false,autoChatMode:'sequential',autoChatMinutes:10,autoChatMessages:['방송에 오신 여러분, 반갑습니다! 명령어는 !도움말로 확인하세요.'],chatMode:'all',chatTalk:'quiet',chatAllApplied:true,chatDjCall:true,chatDjAll:true,chatName:'메이트',chatPersona:''};}
export function normalizeExtras(settings){
  // 이 기능이 생기기 전에 저장된 방은 한 번만 '모든 채팅에 대답'으로 바꿉니다. (이후에 DJ가 고른 방식은 그대로 유지)
  if(settings.chatAllApplied===undefined){if(settings.chatMode===undefined||settings.chatMode==='auto')settings.chatMode='all';settings.chatAllApplied=true;}
  const d=extraDefaults();for(const [key,value]of Object.entries(d))if(settings[key]===undefined)settings[key]=value;return settings;}
export function validateExtras(s){
  normalizeExtras(s);
  if(!Number.isInteger(s.quizExpChance)||s.quizExpChance<0||s.quizExpChance>100||!Number.isSafeInteger(s.quizTickets)||s.quizTickets<1||s.quizTickets>100)throw Error('퀴즈 EXP 확률은 0~100%, 복권 보상은 1~100장으로 설정하세요.');
  if(typeof s.listenRewards!=='boolean'||!Number.isInteger(s.listenMinutes)||s.listenMinutes<1||s.listenMinutes>120||!Number.isInteger(s.listenTickets)||s.listenTickets<1||s.listenTickets>100||!Number.isInteger(s.listenDailyCap)||s.listenDailyCap<1||s.listenDailyCap>1000)throw Error('청취 보상은 간격 1~120분, 복권 1~100장, 일일 한도 1~1000장으로 설정하세요.');
  for(const key of ['rps','dice','numberGuess','quiz','autoQuizEnabled','autoChatEnabled','affinityNotices'])if(typeof s[key]!=='boolean')throw Error('미니게임·자동채팅 ON/OFF 값을 확인하세요.');
  if(!Number.isSafeInteger(s.quizExp)||s.quizExp<1||s.quizExp>1000000)throw Error('퀴즈 정답 경험치는 1~1,000,000 EXP 정수로 입력하세요.');
  if(!Number.isInteger(s.autoQuizMinutes)||s.autoQuizMinutes<1||s.autoQuizMinutes>1440)throw Error('자동 퀴즈 간격은 1~1440분으로 입력하세요.');
  if(!Number.isSafeInteger(s.quizMinutes)||s.quizMinutes<1||s.quizMinutes>30)throw Error('퀴즈 제한시간은 1~30분으로 입력하세요.');
  if(!Array.isArray(s.quizQuestions)||s.quizQuestions.length>100||s.quiz&&!s.quizQuestions.length)throw Error('퀴즈는 최대 100문제이며 사용하려면 한 문제 이상 등록하세요.');
  const questionIds=new Set();for(const q of s.quizQuestions){
    if(!q||typeof q.id!=='string'||!/^[\w-]{1,64}$/.test(q.id)||questionIds.has(q.id)||typeof q.question!=='string'||!q.question.trim()||q.question.length>200||!Array.isArray(q.answers)||!q.answers.length||q.answers.length>10||q.answers.some(a=>typeof a!=='string'||!a.trim()||a.length>80))throw Error('퀴즈 문제는 1~200자, 정답은 각 1~80자·최대 10개로 입력하세요.');
    questionIds.add(q.id);
    for(const [field,max]of [['category',40],['meaning',200]])if(q[field]!==undefined&&(typeof q[field]!=='string'||q[field].length>max))throw Error('퀴즈 힌트·뜻의 입력 길이를 확인하세요.');
  }
  if(!['sequential','random'].includes(s.autoChatMode)||!Number.isInteger(s.autoChatMinutes)||s.autoChatMinutes<1||s.autoChatMinutes>1440)throw Error('자동채팅 방식·간격(1~1440분)을 확인하세요.');
  if(!Array.isArray(s.autoChatMessages)||s.autoChatMessages.length>30||s.autoChatMessages.some(t=>typeof t!=='string'||!t.trim()||t.length>200)||s.autoChatEnabled&&!s.autoChatMessages.length)throw Error('자동채팅 문구는 각 1~200자, 최대 30개로 등록하세요.');
  // 명령어 없는 대화: off=끄기 · call=이름을 부르거나 이어 말할 때만 · auto=인사·질문·날씨·맛집에도 먼저 대답
  if(typeof s.chatName==='string')s.chatName=s.chatName.trim();
  if(!['off','call','auto','all'].includes(s.chatMode))throw Error('대화 방식은 끄기·부르면 대답·자유 대화·모든 채팅에 대답 중에서 선택하세요.');
  if(!['quiet','normal','lively'].includes(s.chatTalk))throw Error('수다 정도는 조용히·보통·활발 중에서 선택하세요.');
  if(typeof s.chatAllApplied!=='boolean')throw Error('대화 방식 이전 설정 값이 올바르지 않습니다.');
  if(typeof s.chatDjCall!=='boolean')throw Error('DJ가 봇 이름을 부르면 대답하는 설정은 켬/끔이어야 합니다.');
  if(typeof s.chatDjAll!=='boolean')throw Error('DJ 본인의 모든 채팅에 대답하는 설정은 켬/끔이어야 합니다.');
  if(typeof s.chatName!=='string'||!/^[^\s@!"'`<>]{2,12}$/u.test(s.chatName))throw Error('봇 이름은 공백 없이 2~12자로 입력하세요.');
  if(typeof s.chatPersona!=='string'||[...s.chatPersona].length>200)throw Error('말투·분위기 설명은 200자 이하로 입력하세요.');
  if(!Array.isArray(s.autoReplies)||s.autoReplies.length>30)throw Error('키워드 응답은 최대 30개입니다.');
  const ids=new Set();for(const rule of s.autoReplies){if(typeof rule.id!=='string'||!/^[\w-]{1,64}$/.test(rule.id)||ids.has(rule.id)||typeof rule.keyword!=='string'||!rule.keyword.trim()||rule.keyword.length>50||typeof rule.text!=='string'||!rule.text.trim()||rule.text.length>200||!['exact','contains'].includes(rule.match)||typeof rule.enabled!=='boolean'||!Number.isInteger(rule.cooldown)||rule.cooldown<1||rule.cooldown>3600)throw Error('키워드·응답 문구·대기시간(1~3600초)을 확인하세요.');ids.add(rule.id);}
}
const normal=value=>String(value).normalize('NFKC').trim().toLocaleLowerCase('ko-KR');
// DJ가 만든 키워드 규칙에 걸리는 말인지만 검사합니다(대기시간·기록 변경 없음). 걸리면 자동 대화는 끼어들지 않고 키워드 응답이 우선합니다.
export function keywordMatches(settings,message){
  const text=normal(message);
  return (settings.autoReplies||[]).some(rule=>rule.enabled&&(rule.match==='exact'?text===normal(rule.keyword):text.includes(normal(rule.keyword))));
}
export function keywordReply(r,event,now){
  const s=r.settings;if(s.quiet||!event.user?.id||now-r.lastResponse<s.responseGap*1000)return {text:null};
  const message=normal(event.message);
  for(const rule of s.autoReplies){
    if(!rule.enabled)continue;const key=normal(rule.keyword);if(!(rule.match==='exact'?message===key:message.includes(key)))continue;
    const last=r.autoReplyTimes&&Object.hasOwn(r.autoReplyTimes,rule.id)?r.autoReplyTimes[rule.id]:undefined;
    if(last!==undefined&&now-last<rule.cooldown*1000)continue;
    r.autoReplyTimes??={};Object.defineProperty(r.autoReplyTimes,rule.id,{value:now,enumerable:true,writable:true,configurable:true});r.lastResponse=now;
    return {text:rule.text.replaceAll('{name}',event.user.nickname||'청취자'),ruleId:rule.id};
  }return {text:null};
}
export function autoChatCandidate(r,now,int){
  const s=r.settings;if(!s.autoChatEnabled||!s.autoChatMessages.length)return null;
  const signature=JSON.stringify([s.autoChatMinutes,s.autoChatMode,s.autoChatMessages]);
  if(r.autoChat?.signature!==signature)r.autoChat={signature,dueAt:now+s.autoChatMinutes*60000,index:0};
  if(now<r.autoChat.dueAt)return null;
  const index=s.autoChatMode==='random'?int(0,s.autoChatMessages.length-1):r.autoChat.index%s.autoChatMessages.length;
  return {text:s.autoChatMessages[index],index,signature};
}
export function playMiniGame(engine,r,u,cmd,arg,now,fail){
  const key=({'가위바위보':'rps','주사위':'dice','숫자맞히기':'numberGuess'})[cmd];if(!key)return null;
  if(!r.settings[key])fail(`${cmd} 게임이 꺼져 있습니다. !게임 on으로 켜거나 게임 설정에서 활성화하세요.`);
  let text,result;
  if(key==='rps'){
    const choices=['가위','바위','보'];if(!choices.includes(arg))fail('사용법: !가위바위보 가위/바위/보');
    const bot=choices[engine.int(0,2)],outcome=arg===bot?'무승부':({'가위':'보','바위':'가위','보':'바위'})[arg]===bot?'승리':'패배';
    text=`${u.name}: ${arg} / 봇: ${bot} → ${outcome}`;result={choice:arg,bot,outcome};
  }else if(key==='dice'){
    if(arg==='자동')arg='';
    if(arg&&!/^[1-6]$/.test(arg))fail('사용법: !주사위 또는 !주사위 1~6');const rolled=engine.int(1,6);
    text=`${u.name}님의 주사위: ${rolled}${arg?Number(arg)===rolled?' · 맞혔습니다!':' · 아쉽게 빗나갔어요.':''}`;result={rolled,guess:arg?Number(arg):null};
  }else{
    if(arg==='초기화'){delete u.numberGame;return '숫자맞히기를 초기화했습니다. !숫자맞히기 1~100으로 새로 시작하세요.';}
    if(!/^\d{1,3}$/.test(arg)||Number(arg)<1||Number(arg)>100)fail('사용법: !숫자맞히기 1~100 (7번 안에 맞히기) / !숫자맞히기 초기화');
    u.numberGame??={secret:engine.int(1,100),attempts:0};const game=u.numberGame,guess=Number(arg);game.attempts++;
    const solved=guess===game.secret,over=game.attempts>=7;
    text=solved?`${u.name}님 정답! ${game.secret} · ${game.attempts}번 만에 성공했습니다.`:over?`7번의 기회를 모두 사용했습니다. 정답은 ${game.secret}! 다음 입력부터 새 게임입니다.`:`${guess}보다 ${guess<game.secret?'큰':'작은'} 숫자입니다. (${game.attempts}/7회)`;
    result={guess,attempts:game.attempts,solved,over};if(solved||over)delete u.numberGame;
  }
  engine.store.log(r.id,u.id,`minigame-${key}`,result,now);return text;
}
