// 명령어(!) 없이 건네는 말을 알아듣고, 대답할 때와 가만히 있을 때를 정하는 규칙 모음입니다.
// 외부 요청·DB 접근이 없는 순수 로직이며, 실제 답변은 core.mjs(Engine)가 lifestyle(AI·날씨·맛집)과 이어서 만듭니다.
import {foodTypes,cafeTypes} from './public/dining-guide.mjs';
import {koreaDate,shiftDate,weatherRange} from './weather-periods.mjs';

export const CHAT_MODES=['off','call','auto'];
export const DEFAULT_CHAT_NAME='메이트';
export const SESSION_MS=180000; // 봇이 답한 뒤 3분 동안은 "이어서 말하는 중"으로 봅니다.
export const SKIP='SKIP';

// NFKC는 ㅎㅇ·ㅂㅂ 같은 호환 자모를 다른 문자로 바꿔 버리므로, 전각 문자(！？)만 따로 반각으로 바꿉니다.
const halfWidth=text=>text.replace(/[！-～]/gu,ch=>String.fromCharCode(ch.charCodeAt(0)-0xFEE0)).replace(/　/gu,' ');
export const squash=text=>halfWidth(String(text??'').normalize('NFC')).replace(/\s+/gu,' ').trim();
const escapeRe=value=>value.replace(/[.*+?^${}()|[\]\\]/gu,'\\$&');
const randomIndex=(min,max)=>min+Math.floor(Math.random()*(max-min+1));

// ───────── 봇을 부르는 말 ─────────
// 설정한 이름 + 라디오메이트 · 라메. "룸메이트"처럼 다른 낱말의 일부는 부른 것으로 보지 않습니다.
export const botNames=settings=>[...new Set([settings?.chatName||DEFAULT_CHAT_NAME,'라디오메이트','라메'].map(name=>squash(name).toLowerCase()).filter(name=>[...name].length>=2))];
export function callsBot(text,names){
 if(!names?.length)return false;
 return new RegExp('(?<![가-힣a-z0-9])(?:'+names.map(escapeRe).join('|')+')','u').test(squash(text).toLowerCase());
}

// ───────── 말투 단서 ─────────
const RX={
 bye:/(?:안녕히\s*(?:계|가)|잘\s*자|굿\s*나잇|먼저\s*(?:갈게|가볼게|들어갈게|나갈게|자러)|가볼게|들어갈게|나갈게|이만\s*(?:가|갈|나)|퇴근|내일\s*(?:봐|또)|다음에\s*(?:봐|또)|자러\s*(?:갈|가)|바이바이|ㅂㅂ|빠이)/u,
 greeting:/(?:안녕(?!히)|안뇽|하이|헬로|할로|ㅎㅇ|방가|반가워|반갑|처음\s*(?:왔|와|뵙|인사)|왔어요|왔습니다|들어왔|굿\s*모닝|좋은\s*(?:아침|저녁|밤|하루)|하이루)/u,
 thanks:/(?:고마워|고맙|감사|땡큐|ㄱㅅ|thanks|thank\s*you)/u,
 identity:/(?:너\s*누구|넌\s*누구|누구세요|누구야|누구니|이름이?\s*(?:뭐|뭔)|이름\s*알려|정체가?\s*뭐|봇이야|봇이에요|사람이야|사람이에요|사람\s*맞|ai\s*야|로봇이야)/u,
 help:/(?:뭐\s*할\s*수|뭘\s*할\s*수|무슨\s*기능|기능\s*(?:뭐|알려)|도움말|사용법|명령어\s*(?:뭐|알려|없)|어떻게\s*써|뭐\s*시켜|뭐\s*물어|뭐가\s*가능)/u,
 howAreYou:/(?:뭐\s*해|뭐하|밥\s*(?:먹|드셨)|식사\s*(?:하|했)|잘\s*지냈|잘\s*있었|기분\s*어때|컨디션\s*어때|오늘\s*어땠)/u,
 emotion:/(?:심심|피곤|힘들|우울|슬퍼|슬프|외로|졸려|졸립|배고|행복|신나|기뻐|짜증|아파|아프|속상|보고\s*싶|그리워|떨려|무서|걱정|불안|스트레스|지쳤|지친|화나|억울)/u,
 address:/(?<![가-힣a-z0-9])(?:디제이|방장|봇|로봇|챗봇|에이아이)|(?<![a-z0-9])(?:dj|bot|ai)(?![a-z0-9])/u,
 question:/[?？]|(?:뭐야|뭐예요|뭐에요|뭔가요|뭐지|어때요?|어떄요?|어떻게|인가요|나요|까요|ㄹ까요?|할까요?|할래요?)/u,
};
export function cues(text){
 const t=squash(text).toLowerCase(),bye=RX.bye.test(t);
 return {bye,greeting:!bye&&RX.greeting.test(t),thanks:RX.thanks.test(t),identity:RX.identity.test(t),help:RX.help.test(t),howAreYou:RX.howAreYou.test(t),emotion:RX.emotion.test(t),address:RX.address.test(t),question:RX.question.test(t)};
}

// ───────── AI 없이도 하는 말동무 ─────────
export const fallbackChat='음, 그건 제가 잘 모르겠어요 ㅎㅎ 대신 "서울 날씨"나 "광주 맛집 추천"처럼 물어보면 알려드릴 수 있어요 ♡';
const dayPart=hour=>hour>=5&&hour<11?'morning':hour>=11&&hour<18?'day':hour>=18&&hour<23?'evening':'night';
const GREETINGS={
 morning:['{who} 좋은 아침이에요~ 오늘도 힘차게 시작해봐요 ♡','{who} 안녕하세요! 아침부터 와주셔서 반가워요 ㅎㅎ','굿모닝이에요 {who}! 오늘 하루도 잘 부탁해요 ♡'],
 day:['{who} 안녕하세요~ 반가워요! 오늘 하루는 어때요? ♡','어서 와요 {who}! 편하게 놀다 가세요 ㅎㅎ','{who} 반가워요~ 오늘 기분은 어때요?'],
 evening:['{who} 안녕하세요~ 오늘도 수고 많았어요 ♡','어서 와요 {who}! 오늘 하루는 어땠어요?','{who} 반가워요~ 저녁에 만나니 더 좋네요 ㅎㅎ'],
 night:['{who} 안녕하세요~ 이 밤에 와줘서 반가워요 ♡','어서 와요 {who}! 편안한 밤 보내고 있나요?','{who} 반가워요~ 밤엔 역시 라디오죠 ㅎㅎ'],
};
const THANKS=['별말씀을요~ 도움이 됐다니 저도 기뻐요 ♡','언제든 편하게 말 걸어줘요 ㅎㅎ','에이~ 이 정도쯤이야요! 또 필요하면 불러줘요 ♡'];
const BYES=['{who} 살펴 가세요~ 오늘도 함께해서 즐거웠어요 ♡','푹 쉬세요 {who}! 다음에 또 만나요 ㅎㅎ','잘 가요~ 와줘서 고마웠어요 ♡'];
const NIGHT_BYES=['잘 자요 {who}~ 좋은 꿈 꿔요 ♡','{who} 푹 자고 내일 또 만나요 ㅎㅎ','편안한 밤 보내요~ 내일도 기다릴게요 ♡'];
const HOW=['저는 방송 들으면서 기다리고 있었어요 ㅎㅎ 오늘은 어떻게 지냈어요?','저야 늘 여기 있죠~ 오늘 하루는 어땠어요?'];
const COMFORT=['그랬군요… 제가 옆에서 같이 있을게요 ♡','에고, 마음이 쓰였겠어요. 여기서 편하게 얘기해도 돼요 ㅎㅎ','{who} 오늘 고생 많았어요. 잠깐 쉬어가도 괜찮아요 ♡'];
// 규칙으로 답할 수 있는 말(인사·고마움·작별·소개·기능 문의 등)에만 대답하고, 모르는 말은 null입니다. emotion은 AI가 없을 때의 위로 한마디까지 허용합니다.
export function smallTalk(text,{name='',botName=DEFAULT_CHAT_NAME,hour=12,int=randomIndex,emotion=false}={}){
 const t=squash(text).toLowerCase();if(!t)return null;
 const who=name?[...String(name)].slice(0,12).join('')+'님':'',pick=list=>list[int(0,list.length-1)];
 const say=template=>template.replaceAll('{who}',who).replace(/\s+/gu,' ').replace(/\s+([!~?,.])/gu,'$1').trim();
 const c=cues(t);
 if(c.bye)return say(pick(hour>=22||hour<5?NIGHT_BYES:BYES));
 if(c.thanks)return say(pick(THANKS));
 if(c.identity)return `저는 ${botName}예요! DJ님 방송에서 수다도 떨고 날씨·맛집도 알려주는 채팅 친구(봇)예요 ♡`;
 if(c.help)return '저랑은 편하게 수다 떨면 돼요 ㅎㅎ "서울 날씨", "이번주 전국날씨", "광주 맛집 추천"처럼 말해도 알려드려요 ♡ 게임·신청곡은 !도움말';
 if(c.howAreYou)return say(pick(HOW));
 if(c.greeting&&[...t].length<=30)return say(pick(GREETINGS[dayPart(hour)]));
 if(emotion&&c.emotion)return say(pick(COMFORT));
 return null;
}

// ───────── 명령어 없이 하는 날씨·맛집·카페 질문 ─────────
const KEYWORDS=['전국날씨','초미세먼지','미세먼지','기상특보','맛집추천','추천맛집','카페추천','추천카페','알려주세요','추천해주세요','알려줄래','알려줘','추천해줘','이번주','다음주','옷차림','시간별','브리핑','대한민국','우리나라','지역별','시도별','날씨','기온','우산','일출','일몰','특보','맛집','카페','오늘','내일','모레','글피'];
const SPLIT=new RegExp('('+KEYWORDS.map(escapeRe).join('|')+')','gu');
const PERIODS=new Set(['이번주','다음주','오늘','내일','현재','지금']);
const MARKERS=new Set(['전국','전국날씨','대한민국','한국','우리나라','전체','전지역','각','각지역','지역','지역별','시도별','도별','지방별','전부','모든','모두']);
const WEATHER_NOUNS=new Set(['전국날씨','날씨','기온','온도','우산','옷차림','일출','일몰','미세먼지','초미세먼지','먼지','특보','기상특보','브리핑','시간별','시간대별','어제']);
const MODE_WORDS=new Set(['우산','옷차림','일출','일몰','미세먼지','초미세먼지','먼지','특보','기상특보','브리핑','시간별','시간대별','어제']);
const DINING_NOUNS=new Set(['맛집','맛집추천','추천맛집','카페','카페추천','추천카페']);
const CUES=new Set(['알려줘','알려줄래','알려주세요','알려줘요','알려','알려봐','말해줘','말해봐','보여줘','보여주세요','궁금','궁금해','궁금해요','어때','어때요','어떄','어떄요','어떻게','어떨까','어떨까요','어떤가요','추천','추천해줘','추천해주세요','추천해줄래','추천해','해줘','해주세요','줘','주세요','부탁','부탁해','부탁해요','있어','있나요','있을까','있을까요','올까','올까요','오나','오나요','오려나','오니','내려','뭐야','뭔가요','뭐지','몇','얼마','어디','어디야','좋을까','좋을까요','먹지','먹을까','갈까','ㄱㄱ','뭐','뭘','좀','확인','확인해줘','챙겨야','돼','될까','되나','되나요','필요해','필요할까','필요한가요','필요']);
const RAIN_VERBS=new Set(['와','와요','올까','올까요','오나','오나요','오려나','오니','옴','올지','내려','내리나','내릴까','오냐']);
const PARTICLES=/^(?:은|는|이|가|도|을|를|만|의|에|엔|에서|으로|로|랑|이랑|하고|과|와|요|야|이야|인데|인가|인가요|이에요|예요)$/u;
const STRIP=/(?:에서|에는|으로|은|는|이|가|도|을|를|만|의|에|엔|로)$/u;
const MEALS=new Set(['아침','점심','저녁']);
const LOCAL=/^[가-힣]{1,8}(?:동|구|시|군|읍|면|리|역|로|길|거리|시장|대학교|해수욕장)$/u;
// 날씨 서비스가 모르는 시간 표현(주말·지난주·올해 등)은 엉뚱한 날씨를 답하지 않도록 아예 다루지 않습니다. 낱말로 쪼개기 전에 원문에서 찾습니다.
const UNSUPPORTED_TIME=/(?:이번|다음)\s*주말|주말|지난\s*주|그제|그저께|올해|내년|이번\s*달|다음\s*달/u;
// 모레·글피는 날씨 서비스가 날짜로만 알아듣습니다. 이번 주를 넘어가면 다음 주 범위로 안내합니다.
const dayToken=(offset,now)=>{const date=shiftDate(koreaDate(now),offset);return weatherRange('thisWeek',now).dates.includes(date)?date:'다음주 '+date;};
// 반환: {kind:'날씨'|'전국날씨'|'맛집'|'카페', arg} — 기존 !명령어와 같은 형식이라 lifestyle.answer에 그대로 넣을 수 있습니다. 애매하면 null(=보통 대화로 넘김).
// 규칙: ① 날씨·맛집 같은 핵심 낱말이 있고 ② 알려줘·어때·? 같은 부탁/질문 표시가 있거나 군더더기 없는 명사구(예: "이번주 전국날씨")여야 합니다. "오늘 날씨 좋다" 같은 혼잣말은 건드리지 않습니다.
export function naturalRequest(message,{isRegion=()=>false,now=Date.now()}={}){
 const original=squash(message);if(!original||original.startsWith('!')||[...original].length>60)return null;
 const asked=/[?？]/u.test(original);
 const text=original.toLowerCase().replace(/이번\s*주/gu,'이번주').replace(/다음\s*주/gu,'다음주').replace(/[?？!！.,，。~〜…·ㆍ"'“”‘’()（）[\]{}<>♡♥❤]|[\u{1F300}-\u{1FAFF}]/gu,' ').replace(SPLIT,' $1 ');
 const tokens=text.split(/\s+/u).filter(Boolean);if(!tokens.length||tokens.length>12)return null;
 const period=[],kept=[],unknown=[];let weather=false,dining='',mode='',marker=false,cue=false,rainWord=false,rainVerb=false;
 for(const token of tokens){
  const base=token.replace(STRIP,'');
  if(PERIODS.has(token)){period.push(token==='지금'?'현재':token);continue;}
  if(token==='모레'||token==='글피'){period.push(dayToken(token==='모레'?2:3,now));continue;}
  if(/^[월화수목금토일]요일$/u.test(token)){period.push(token);continue;}
  if(MARKERS.has(token)||MARKERS.has(base)){marker=true;if(token==='전국날씨')weather=true;continue;}
  if(WEATHER_NOUNS.has(token)){weather=true;if(MODE_WORDS.has(token))mode=token;continue;}
  if(DINING_NOUNS.has(token)){dining=token.includes('카페')?'카페':'맛집';continue;}
  if(token==='비'||token==='눈'){rainWord=true;continue;}
  if(RAIN_VERBS.has(token)){rainVerb=true;continue;}
  if(CUES.has(token)||CUES.has(base)){cue=true;continue;}
  if(PARTICLES.test(token))continue;
  if(isRegion(token)){kept.push(token);continue;}
  if(base&&isRegion(base)){kept.push(base);continue;}
  if(MEALS.has(token)||foodTypes.includes(token)||cafeTypes.includes(token)||LOCAL.test(token)){kept.push(token);continue;}
  if(RX.emotion.test(token))continue; // "배고파 맛집 추천해줘"의 "배고파"는 지역이 아니라 기분 표현입니다.
  unknown.push(token);
 }
 const hasCue=cue||asked;
 if(rainWord&&rainVerb&&hasCue){weather=true;mode||='우산';} // "비 와요!"처럼 부탁 표시가 없는 말은 혼잣말로 봅니다.
 if(/(?:뭐|뭘)\s*입|옷\s*(?:뭐|어떻게)/u.test(text)){weather=true;mode||='옷차림';}
 if(dining){
  if(weather||unknown.length>1||kept.length+unknown.length>(hasCue?4:3))return null;
  return {kind:dining,arg:[...kept,...unknown].join(' ')};
 }
 if(!weather||UNSUPPORTED_TIME.test(original))return null;
 // 날씨는 지역을 정확히 알아들어야 하므로 모르는 낱말이 있으면(부탁 표시가 있어도 하나까지만) 혼잣말로 보고 넘깁니다.
 const strange=unknown.length+kept.filter(word=>!isRegion(word)).length;
 if(strange>(hasCue?1:0))return null;
 const regions=kept.filter(word=>isRegion(word));
 return {kind:marker&&!regions.length?'전국날씨':'날씨',arg:[...period,...regions,mode].filter(Boolean).join(' ')};
}

// ───────── 언제 끼어들까 ─────────
// 방 단위 설정(chatMode)에 따라 부르는 말·이어 말하기·인사·질문·감정 표현에 답하고, 청취자끼리의 수다에는 끼어들지 않습니다.
// 메모리 상태만 가집니다(재시작하면 초기화). 한 사람이나 한 방이 대화를 독점해 채팅이 도배되지 않도록 횟수도 제한합니다.
export class Conversation{
 constructor({int=randomIndex}={}){this.int=int;this.sessions=new Map();this.logs=new Map();this.rooms=new Map();this.texts=new Map();}
 inSession(room,user,now){return (this.sessions.get(room+'|'+user)??0)>now;}
 allow(room,user,now,{fast=false}={}){
  const key=room+'|'+user,mine=(this.logs.get(key)||[]).filter(time=>time>now-300000),theirs=(this.rooms.get(room)||[]).filter(time=>time>now-300000);
  if(mine.length&&now-mine.at(-1)<(fast?4000:8000))return false;
  return mine.length<12&&theirs.length<30; // 5분 안에 한 사람 12번 · 한 방 30번까지
 }
 // open=false는 AI가 끼어들지 않기로 한 경우입니다. 횟수·같은 말 도배는 세지만 "이어 말하기" 시간은 열지 않습니다.
 record(room,user,now,text='',{open=true}={}){
  const key=room+'|'+user;
  this.logs.set(key,[...(this.logs.get(key)||[]).filter(time=>time>now-300000),now]);this.rooms.set(room,[...(this.rooms.get(room)||[]).filter(time=>time>now-300000),now]);
  if(open)this.sessions.set(key,now+SESSION_MS);if(text)this.texts.set(key,{text,time:now});
  for(const map of [this.logs,this.sessions,this.texts])if(map.size>2000)map.delete(map.keys().next().value);
  if(this.rooms.size>500)this.rooms.delete(this.rooms.keys().next().value);
 }
 // 반환: null(가만히 있기) 또는 {kind:'service'|'chat', request, text, trigger, mayskip, fallback}
 plan({roomId,event,settings,now,names=botNames(settings),isRegion=()=>false,lastResponse=0}){
  const mode=settings?.chatMode??'auto';
  if(mode==='off'||settings?.quiet)return null;
  const user=event.user?.id;if(!user)return null;
  const text=squash(event.message);
  if(!text||text.startsWith('!')||[...text].length>200||/https?:\/\//iu.test(text))return null;
  const lower=text.toLowerCase();
  if(!/[가-힣a-z0-9]/iu.test(lower)&&!/^(?:ㅎㅇ|ㅂㅂ|ㄱㅅ)/u.test(lower))return null; // ㅋㅋ·ㅠㅠ·이모티콘만 있는 반응에는 답하지 않음
  const repeated=this.texts.get(roomId+'|'+user);if(repeated&&repeated.text===text&&now-repeated.time<60000)return null; // 같은 말 도배 방지
  if(lastResponse&&now-lastResponse<(settings?.responseGap??3)*1000)return null; // 방금 다른 답이 나갔으면 겹치지 않게
  const called=callsBot(lower,names),session=this.inSession(roomId,user,now);
  if(/^@\S+/u.test(text)&&!called)return null; // 다른 사람을 지목한 말
  const service=naturalRequest(text,{isRegion,now}),c=cues(text);
  const social=c.bye||c.thanks||c.identity||c.help||c.howAreYou||(c.greeting&&[...text].length<=30);
  const guess=c.question||c.emotion||c.address;
  const trigger=called?'call':session?'session':service?'service':social?'social':guess?'guess':null;
  if(!trigger)return null;
  if(mode==='call'&&trigger!=='call'&&trigger!=='session')return null;
  if(!this.allow(roomId,user,now,{fast:trigger!=='guess'&&trigger!=='social'}))return null;
  const wantsService=!!service&&(mode==='auto'||called||session);
  return {kind:wantsService?'service':'chat',request:wantsService?service:null,text,trigger,
   // 직접 부르지 않았는데 질문·감정 표현만 보고 끼어드는 경우에는 AI가 "내게 한 말이 아니다"라고 판단하면 SKIP으로 입을 다물 수 있습니다.
   mayskip:trigger==='guess',
   fallback:smallTalk(text,{name:event.user.nickname,botName:settings?.chatName||DEFAULT_CHAT_NAME,hour:new Date(now+32400000).getUTCHours(),int:this.int,emotion:true})};
 }
}
