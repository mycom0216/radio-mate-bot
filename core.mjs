import {setAutomation} from './automation.mjs';
import {assistantRequest} from './lifestyle.mjs';
import {Conversation,squash,callsBot,botNames} from './converse.mjs';
import {diningQuery,diningPrompt,normalizeCommand} from './dining.mjs';
import {travelKinds,travelQuery,travelPrompt} from './travel.mjs';
import {DEFAULT_CHARGE_NOTICE,LEGACY_CHARGE_NOTICE,spoonChargeReply} from './public/spoon-charge.mjs';
import {touchQueue,applySongAction} from './song-queue.mjs';
import {rewardListening} from './listening.mjs';
import {parseTicketGrant,resolveTarget,cleanAccountAlias} from './targets.mjs';
import {deleteSongCommand} from './song-deletion.mjs';
import {affinityScore,affinityRank,creditChat,collectAffinityNotices} from './public/affinity.mjs';
import {temperatureEvent,officialTemperature,temperatureSummary} from './public/affinity.mjs';
import {savedSongVideo,rememberSongVideo} from './song-library.mjs';
import {chatPage} from './pagination.mjs';
import {Outbox} from './outbox.mjs';
import {LOTTERY_CHUNK,LOTTERY_RANKS,lotterySummary,lotterySummaryAsync,lotteryPrize,lotteryRewardTable} from './lottery.mjs';
import {playQuiz,plainQuizAnswer,activeQuizRound} from './quiz.mjs';
import {extraDefaults,normalizeExtras,validateExtras,keywordReply,keywordMatches,playMiniGame} from './extras.mjs';
import {parseSongRequest,songVideoId,groupKeeps,keepName,keepExpiryLabel} from './public/song-utils.mjs';
import { DatabaseSync } from 'node:sqlite';
import { randomInt, randomUUID,randomBytes,createHash } from 'node:crypto';
import { mkdirSync, renameSync, rmSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

export const LIMIT = { exp: 200000, fish: 200000, odd: 500000, total: 1000000 };
export const RARITIES = ['일반', '고급', '희귀', '영웅', '전설'];
const ranges = [[50,2000],[2050,5000],[5050,10000],[10050,50000],[50050,80000]];
export const ITEMS = [
  { id:'rare', name:'희귀 물고기 확률 UP', price:10000, minutes:20, enabled:true, stock:null },
  { id:'exp', name:'낚시 EXP 2배', price:20000, minutes:20, enabled:true, stock:null },
  { id:'odd', name:'홀 확률 UP', price:50000, minutes:20, enabled:true, stock:null },
];
export function defaults() {
  return {
    ...extraDefaults(),
    pauseItems:false, cooldown:20, responseGap:3, quiet:false, fishing:false, odd:false,
    roulette:false, rouletteRewards:[{id:'miss',name:'꽝',weight:1,miss:true}],
    spoonNotice:DEFAULT_CHARGE_NOTICE,
    introEnabled:true,introText:'🤖 방송 도우미 메이트예요! 신청곡·출석·게임을 돕고, 명령어 없이 말을 걸어도 대답해요 ♡ 명령어는 !도움말로 확인하세요.',
    likeGreetingEnabled:true,likeGreeting:'{name}님, 좋아요 감사합니다 ♥',
    attendance:true, requests:true, duplicateSongs:false, requestMax:10,
    expPerCast:60, miss:0, payout:'random', goldenPolicy:'pending',
    betMin:100, betMax:50000, levelStep:10000,
    notice:'하트를 눌러주세요 ♥', welcome:'{name}님, 어서 오세요!',
    // donation은 기본 감사 인사입니다. donationReactions에는 {"10": "하트 💖"}처럼 금액별 문구를 저장합니다.
    donation:'{name}님, {amount} 스푼 감사합니다!', donationReactions:{}, bannedWords:[],
    // 큰 후원 복권 전체 지급: 기본은 꺼짐. 켜면 후원 스푼이 기준 이상일 때 등록된 모든 청취자에게 복권을 지급합니다.
    donationTicketEnabled:false, donationTicketMin:100, donationTicketCount:1,
    // 복권 등수별 보상: 1등(3개 일치)은 EXP+PT, 2등(2개)은 EXP만, 3등(1개)은 PT만 줍니다. 값은 관리 화면에서 바꿀 수 있습니다.
    // 낚시 결과에 '누가 잡았는지' 표시하는 방식: both(닉네임+고유 ID) / nickname / id / off(표시 안 함)
    fishingWho:'both',
    // 화면 캡처 기준: 후원 한 건이 이 스푼 이상일 때만 확장 기능이 방송 화면을 캡처합니다. (기본 300스푼)
    screenCaptureMin:300,
    // DJ 랭킹(일라디·월라디): 스푼이 순위를 API로 알려 주지 않아 DJ가 직접 입력합니다. 빈 값(null)은 미등록입니다. 넥스트초이스 등급은 월라디 순위로 자동 계산합니다.
    // 날짜·월 표시(…Date/…Month)는 값을 입력한 때를 기록해, 오래된 값에 '(기준일)'을 붙이는 데 씁니다.
    djRankDaily:null, djRankDailyDate:'', djRankMonthly:null, djRankMonthlyMonth:'',
    // 지난달 월라디 순위: 새 달의 순위를 처음 입력하면 이전 달 값이 자동으로 옮겨 오고, !랭킹등록 지난달 85로 직접 넣을 수도 있습니다.
    djRankPrevMonthly:null, djRankPrevMonth:'',
    // 낚시 행운 보너스(%): 고급 이상 물고기(황금주사위 제외)의 가중치를 이만큼 늘려 PT가 큰 물고기가 더 자주 나오게 합니다. 0이면 보너스 없음.
    fishingLuck:100,
    // 후원 레벨 보상: 한 번에 기준 스푼 이상 후원한 청취자에게 '스푼 수 × 스푼당 EXP'를 줘서 레벨이 오르게 합니다.
    donationExpEnabled:true, donationExpMin:20, donationExpPerSpoon:20,
    // 후원자 복권 지급: 한 번에 기준 스푼 이상 후원한 '후원자 본인'에게 복권을 줍니다. (모든 청취자에게 주는 donationTicket*과는 별개입니다)
    donationDonorTicketEnabled:true, donationDonorTicketMin:10, donationDonorTicketCount:1,
    // 후원할 때마다 지급(기본 켜짐): 켜면 후원 스푼 수와 상관없이 DJ에게 후원할 때마다 후원자에게 복권을 줍니다. 끄면 위 기준 스푼 이상일 때만 줍니다.
    donationDonorTicketEvery:true,
    // 후원 대결: !대결로 참가한 사람들이 정해진 시간 동안 DJ에게 후원한 스푼 합계로 1·2·3등을 겨룹니다. 순위별 보상(PT·EXP)은 자동 지급하고,
    // 실제 스푼 선물(battleGiftSpoons, 0이면 안내 없음)은 봇이 옮길 수 없어서 채팅으로 안내만 합니다.
    battleEnabled:true, battleMinutes:5, battleGiftSpoons:10,
    // 팀 대결(청팀·백팀): 목표 스푼을 먼저 모은 팀이 이기고, 진 팀이 이긴 팀에 줄 스푼은 '선물 약속' 안내만 합니다. (0이면 안내 없음)
    battleTargetSpoons:100, battleTeamGiftSpoons:100,
    battleFirstPt:300, battleFirstExp:300, battleSecondPt:150, battleSecondExp:150, battleThirdPt:50, battleThirdExp:50,
    lotteryFirstExp:300, lotteryFirstPt:300, lotterySecondExp:150, lotterySecondPt:0, lotteryThirdExp:0, lotteryThirdPt:50,
    monthlyRank:'', monthlyRankMonth:'', playlistMode:false, playlistTitle:'플레이리스트 방송',
    fish:[
      ['붕어',0,35,10,40],['피라미',0,25,5,15],['잉어',1,20,30,100],
      ['붕어(희귀)',2,12,20,50],['참치',3,6,100,250],['황금잉어',4,1,40,100],
      ['황금주사위',4,1,5,10],
    ].map(([name,rarity,weight,minSize,maxSize],i)=>({id:`fish-${i}`,name,rarity,weight,minSize,maxSize,minPt:ranges[rarity][0],maxPt:ranges[rarity][1],golden:name==='황금주사위'})),
    items:structuredClone(ITEMS),
    announcements:[{id:'heart',enabled:false,minutes:10,text:'하트를 눌러주세요 ♥'}],
    pending:['기본 물고기·확률은 예시값','물고기 PT 무작위 지급은 임시값','황금주사위 한도 정책 미정: 보상 보류','복권 1장·독립 추첨은 임시값','베팅 100~50,000 PT·레벨당 10,000 EXP는 임시값'],
  };
}
export function dates(ms=Date.now()) {
  const day = new Date(ms+9*3600000).toISOString().slice(0,10);
  return {day,month:day.slice(0,7)};
}
// 넥스트초이스 등급(스푼 공식 안내 기준): 월간 DJ 순위 410위 이내에서 정해지고, 등급마다 필요한 방송일수·방송시간이 다릅니다.
// settle=정산 비율(%), payoutDays=환전 처리일(영업일), benefits=등급별 혜택입니다. (스푼 Choice DJ 안내 기준, 선정 결과는 매월 1일 오후 6~7시 사이 갱신)
export const CHOICE_TIERS=[
  {key:'top',name:'Top Choice',min:1,max:10,days:20,hours:45,settle:70,payoutDays:1,benefits:['라이브 시 스푼이 선정한 DJ 상단 번들 노출','시그니처 스티커','최초 선정 시 순금 명함 지급','1위 선정 시 순금 숟가락 지급','랭킹 부스터 10개','방송시간 연장 10개','고정매니저+3 30일','퀵메시지+3 30일']},
  {key:'star',name:'Star Choice',min:11,max:110,days:20,hours:45,settle:65,payoutDays:2,benefits:['라이브 시 스푼이 선정한 DJ 상단 번들 노출','방송시간 연장 5개','고정매니저+3 15일','퀵메시지+3 15일']},
  {key:'normal',name:'Normal Choice',min:111,max:410,days:15,hours:30,settle:60,payoutDays:2,benefits:['방송시간 연장 5개','고정매니저+3 7일','퀵메시지+3 7일']},
];
// 순위에 해당하는 등급을 돌려줍니다. 410위 밖이거나 순위가 없으면 null입니다.
export const choiceTier=rank=>Number.isSafeInteger(rank)&&rank>=1?CHOICE_TIERS.find(tier=>rank>=tier.min&&rank<=tier.max)||null:null;
// 한 단계 위 등급과, 거기까지 몇 등을 더 올라가야 하는지 돌려줍니다. 이미 Top Choice이거나 순위가 없으면 null입니다.
// 예) 45위(Star) → Top Choice까지 35등, 411위(선정권 밖) → Normal Choice까지 1등
export function choiceNext(rank){
  if(!Number.isSafeInteger(rank)||rank<1)return null;
  const current=choiceTier(rank),next=current?CHOICE_TIERS[CHOICE_TIERS.indexOf(current)-1]:CHOICE_TIERS.at(-1);
  return next?{tier:next,left:rank-next.max}:null;
}
const previousMonth=month=>{const [year,mon]=String(month).split('-').map(Number);return mon===1?`${year-1}-12`:`${year}-${String(mon-1).padStart(2,'0')}`;};
// DJ가 입력한 순위가 바뀌면 '언제 입력했는지'를 기록합니다. 오래된 값에는 답변에 (기준일)을 붙이기 위해서입니다.
// 웹 설정 저장과 채팅의 !랭킹등록이 같은 함수를 씁니다. prev는 바뀌기 전 설정, next는 바뀐 설정입니다.
export function stampDjRank(prev,next,ms=Date.now()){
  const {day,month}=dates(ms),changed=key=>next[key]!==prev[key];
  if(next.djRankDaily===null)next.djRankDailyDate='';else if(changed('djRankDaily')||!next.djRankDailyDate)next.djRankDailyDate=day;
  if(next.djRankMonthly===null)next.djRankMonthlyMonth='';
  else if(changed('djRankMonthly')||!next.djRankMonthlyMonth){
    // 새 달의 순위를 처음 입력하면, 이전 달에 입력해 둔 순위가 '지난달' 순위가 됩니다. (지난달 값을 직접 고쳤다면 그대로 둠)
    if(changed('djRankMonthly')&&!changed('djRankPrevMonthly')&&prev.djRankMonthly!==null&&prev.djRankMonthlyMonth&&prev.djRankMonthlyMonth!==month){next.djRankPrevMonthly=prev.djRankMonthly;next.djRankPrevMonth=prev.djRankMonthlyMonth;}
    next.djRankMonthlyMonth=month;
  }
  if(next.djRankPrevMonthly===null)next.djRankPrevMonth='';
  else if(!next.djRankPrevMonth||(changed('djRankPrevMonthly')&&next.djRankPrevMonth===prev.djRankPrevMonth))next.djRankPrevMonth=previousMonth(month);
  return next;
}
export function validateSettings(s) {
  // 이 기능이 생기기 전에 저장한 설정에는 메뉴판이 없으므로 빈 메뉴판부터 시작합니다.
  s.donationReactions??={};
  // 저장하거나 백업을 복원할 때도 채팅에서 등록할 때와 같은 개수, 금액, 문구 길이 제한을 확인합니다.
  if(!s.donationReactions||typeof s.donationReactions!=='object'||Array.isArray(s.donationReactions)||Object.keys(s.donationReactions).length>50||Object.entries(s.donationReactions).some(([amount,reaction])=>!validReactionAmount(amount)||typeof reaction!=='string'||!reaction.trim()||reaction.length>100||/[\r\n]/.test(reaction)))throw Error('메뉴판은 최대 50개이며, 각 항목은 양의 정수 스푼과 1~100자 한 줄 문구가 필요합니다.');
  // 큰 후원 복권 전체 지급 설정입니다. 이 기능이 생기기 전에 저장한 설정에는 없으므로 꺼진 상태로 시작합니다.
  s.donationTicketEnabled??=false;s.donationTicketMin??=100;s.donationTicketCount??=1;
  if(typeof s.donationTicketEnabled!=='boolean'||!Number.isSafeInteger(s.donationTicketMin)||s.donationTicketMin<1||s.donationTicketMin>100000000||!Number.isSafeInteger(s.donationTicketCount)||s.donationTicketCount<1||s.donationTicketCount>ALL_TICKET_GRANT_MAX)throw Error(`큰 후원 복권 지급은 켜기/끄기, 기준 스푼(1 이상 정수), 복권 수(1~${ALL_TICKET_GRANT_MAX}장 정수)로 설정하세요.`);
  // 낚시 결과 표시 방식은 정해진 네 가지 중 하나여야 합니다. 이전 설정에는 없으므로 기본값(닉네임+고유 ID)을 채웁니다.
  if(s.fishingWho===undefined)s.fishingWho='both';
  if(!['both','nickname','id','off'].includes(s.fishingWho))throw Error('낚시 결과 표시 방식은 닉네임+고유 ID, 닉네임만, 고유 ID만, 표시 안 함 중에서 고르세요.');
  // 후원 대결 설정: 켜기/끄기, 기본 시간(1~120분), 실제 스푼 선물 안내 수량(0~1000), 순위별 PT·EXP(0~1,000,000). 이전 설정에는 값이 없을 때만 기본값을 채웁니다.
  for(const [key,fallback] of [['battleEnabled',true],['battleMinutes',5],['battleGiftSpoons',10],['battleFirstPt',300],['battleFirstExp',300],['battleSecondPt',150],['battleSecondExp',150],['battleThirdPt',50],['battleThirdExp',50]])if(s[key]===undefined)s[key]=fallback;
  if(typeof s.battleEnabled!=='boolean'||!Number.isSafeInteger(s.battleMinutes)||s.battleMinutes<1||s.battleMinutes>120)throw Error('후원 대결은 켜기/끄기와 기본 시간(1~120분 정수)으로 설정하세요.');
  if(!Number.isSafeInteger(s.battleGiftSpoons)||s.battleGiftSpoons<0||s.battleGiftSpoons>1000)throw Error('후원 대결 스푼 선물 안내는 0~1000 사이의 정수로 입력하세요. (0이면 안내하지 않습니다)');
  for(const key of ['battleFirstPt','battleFirstExp','battleSecondPt','battleSecondExp','battleThirdPt','battleThirdExp'])if(!Number.isSafeInteger(s[key])||s[key]<0||s[key]>1000000)throw Error('후원 대결 순위 보상은 0~1,000,000 사이의 정수로 입력하세요.');
  // DJ 랭킹: 비어 있거나 0이면 미등록(null)으로 봅니다. 순위는 1~1,000,000의 정수입니다.
  for(const [key,label] of [['djRankDaily','일라디 순위'],['djRankMonthly','월라디 순위'],['djRankPrevMonthly','지난달 월라디 순위']]){
    if(s[key]===undefined||s[key]===0||s[key]==='')s[key]=null;
    if(s[key]!==null&&(!Number.isSafeInteger(s[key])||s[key]<1||s[key]>1000000))throw Error(`${label}은(는) 1~1,000,000 사이의 정수로 입력하거나 비워 두세요.`);
  }
  for(const key of ['djRankDailyDate','djRankMonthlyMonth','djRankPrevMonth']){
    if(s[key]===undefined)s[key]='';
    if(typeof s[key]!=='string'||s[key].length>10)throw Error('DJ 랭킹 기준 날짜 값이 올바르지 않습니다.');
  }
  // 팀 대결 목표 스푼(1~1,000,000)과 진 팀이 이긴 팀에 줄 선물 약속 스푼(0~100,000, 0이면 안내 없음)
  if(s.battleTargetSpoons===undefined)s.battleTargetSpoons=100;
  if(s.battleTeamGiftSpoons===undefined)s.battleTeamGiftSpoons=100;
  if(!Number.isSafeInteger(s.battleTargetSpoons)||s.battleTargetSpoons<1||s.battleTargetSpoons>1000000)throw Error('후원 팀 대결 목표 스푼은 1~1,000,000 사이의 정수로 입력하세요.');
  if(!Number.isSafeInteger(s.battleTeamGiftSpoons)||s.battleTeamGiftSpoons<0||s.battleTeamGiftSpoons>100000)throw Error('후원 팀 대결 선물 약속 스푼은 0~100,000 사이의 정수로 입력하세요. (0이면 안내하지 않습니다)');
  // 화면 캡처 기준 스푼(1 이상 정수). 이 기능이 생기기 전에 저장한 설정에는 없으므로 값이 없을 때만 기본값을 채웁니다.
  if(s.screenCaptureMin===undefined)s.screenCaptureMin=300;
  if(!Number.isSafeInteger(s.screenCaptureMin)||s.screenCaptureMin<1||s.screenCaptureMin>100000000)throw Error('화면 캡처 기준 스푼은 1 이상의 정수로 입력하세요.');
  // 낚시 행운 보너스(0~1000%)와 후원 레벨 보상 설정입니다. 이전 설정에는 없으므로 값이 없을 때만 기본값을 채웁니다.
  if(s.fishingLuck===undefined)s.fishingLuck=100;
  if(s.donationExpEnabled===undefined)s.donationExpEnabled=true;
  if(s.donationExpMin===undefined)s.donationExpMin=20;
  if(s.donationExpPerSpoon===undefined)s.donationExpPerSpoon=20;
  if(s.donationDonorTicketEnabled===undefined)s.donationDonorTicketEnabled=true;
  if(s.donationDonorTicketMin===undefined)s.donationDonorTicketMin=10;
  if(s.donationDonorTicketCount===undefined)s.donationDonorTicketCount=1;
  if(s.donationDonorTicketEvery===undefined)s.donationDonorTicketEvery=true;
  if(typeof s.donationDonorTicketEvery!=='boolean')throw Error('후원할 때마다 복권 지급 설정은 켬/끔이어야 합니다.');
  if(typeof s.donationDonorTicketEnabled!=='boolean'||!Number.isSafeInteger(s.donationDonorTicketMin)||s.donationDonorTicketMin<1||s.donationDonorTicketMin>100000000||!Number.isSafeInteger(s.donationDonorTicketCount)||s.donationDonorTicketCount<1||s.donationDonorTicketCount>ALL_TICKET_GRANT_MAX)throw Error(`후원자 복권 지급은 켜기/끄기, 기준 스푼(1 이상 정수), 복권 수(1~${ALL_TICKET_GRANT_MAX}장 정수)로 설정하세요.`);
  if(!Number.isSafeInteger(s.fishingLuck)||s.fishingLuck<0||s.fishingLuck>1000)throw Error('낚시 행운 보너스는 0~1000 사이의 정수(%)로 입력하세요.');
  if(typeof s.donationExpEnabled!=='boolean'||!Number.isSafeInteger(s.donationExpMin)||s.donationExpMin<1||s.donationExpMin>100000000||!Number.isSafeInteger(s.donationExpPerSpoon)||s.donationExpPerSpoon<1||s.donationExpPerSpoon>100000)throw Error('후원 레벨 보상은 켜기/끄기, 기준 스푼(1 이상 정수), 스푼당 EXP(1~100,000 정수)로 설정하세요.');
  // 복권 등수별 보상(EXP·PT)은 0~1,000,000 사이의 정수입니다. 이 기능이 생기기 전에 저장한 설정에는 기본값을 채웁니다.
  for(const [key,fallback] of [['lotteryFirstExp',300],['lotteryFirstPt',300],['lotterySecondExp',150],['lotterySecondPt',0],['lotteryThirdExp',0],['lotteryThirdPt',50]]){
    // 값이 아예 없을 때(이전 설정)만 기본값을 채웁니다. null이나 글자는 잘못된 값으로 거부합니다.
    if(s[key]===undefined)s[key]=fallback;
    if(!Number.isSafeInteger(s[key])||s[key]<0||s[key]>1000000)throw Error('복권 등수 보상은 0~1,000,000 사이의 정수로 입력하세요.');
  }
  validateExtras(s);s.pauseItems??=false;if(typeof s.pauseItems!=='boolean')throw Error('아이템 일시정지 설정을 확인하세요.');
  s.spoonNotice??=defaults().spoonNotice;if(typeof s.spoonNotice!=='string'||!s.spoonNotice.trim()||s.spoonNotice.length>200)throw Error('스푼 충전 안내는 1~200자로 입력하세요.');
  s.introEnabled??=true;s.introText??=defaults().introText;if(typeof s.introEnabled!=='boolean'||typeof s.introText!=='string'||!s.introText.trim()||s.introText.length>200)throw Error('프로그램 소개 문구는 1~200자로 입력하세요.');
  s.roulette??=false;s.rouletteRewards??=defaults().rouletteRewards;s.likeGreetingEnabled??=true;s.likeGreeting??=defaults().likeGreeting;
  if(typeof s.roulette!=='boolean'||typeof s.likeGreetingEnabled!=='boolean'||typeof s.likeGreeting!=='string'||!s.likeGreeting.trim()||s.likeGreeting.length>200)throw Error('룰렛·좋아요 인사 설정을 확인하세요.');
  if(!Array.isArray(s.rouletteRewards)||!s.rouletteRewards.length||s.rouletteRewards.length>30)throw Error('룰렛 항목은 1~30개로 설정하세요.');
  const rewardIds=new Set();for(const item of s.rouletteRewards){if(typeof item.id!=='string'||!item.id||rewardIds.has(item.id)||typeof item.name!=='string'||!item.name.trim()||item.name.length>100||!Number.isSafeInteger(item.weight)||item.weight<1||item.weight>100000||typeof item.miss!=='boolean')throw Error('룰렛 보상 이름·가중치·꽝 여부를 확인하세요.');rewardIds.add(item.id);}
  if(s.roulette&&!s.rouletteRewards.some(i=>!i.miss))throw Error('룰렛을 켜려면 당첨 보상을 하나 이상 등록하세요.');
  const integer=(v,min,max)=>Number.isSafeInteger(v)&&v>=min&&v<=max;
  for (const [k,min,max] of [['cooldown',1,3600],['responseGap',1,120],['requestMax',1,100],['expPerCast',60,60],['betMin',1,500000],['betMax',1,500000],['levelStep',1,100000000]])
    if(!integer(s[k],min,max)) throw Error(`${k}: ${min}~${max} 사이 정수가 필요합니다.`);
  if(s.betMin>s.betMax) throw Error('최소 베팅이 최대 베팅보다 큽니다.');
  if(!Number.isFinite(s.miss)||s.miss<0||s.miss>100) throw Error('꽝 확률은 0~100입니다.');
  if(!['random','fixed'].includes(s.payout)||!['pending','fishing','special'].includes(s.goldenPolicy)) throw Error('보상 정책이 잘못되었습니다.');
  for(const k of ['quiet','fishing','odd','attendance','requests','duplicateSongs','playlistMode']) if(typeof s[k]!=='boolean') throw Error(`${k}: ON/OFF 값이 필요합니다.`);
  for(const k of ['notice','welcome','donation','monthlyRank','monthlyRankMonth','playlistTitle']) if(typeof s[k]!=='string'||s[k].length>500) throw Error(`${k}: 500자 이하 문구가 필요합니다.`);
  if(!Array.isArray(s.fish)||!s.fish.length||s.fish.length>100) throw Error('물고기는 1~100종을 등록하세요.');
  const ids=new Set();
  for(const f of s.fish) {
    if(!f.id||ids.has(f.id)||typeof f.name!=='string'||!f.name.trim()||f.name.length>40) throw Error('물고기 ID·이름이 잘못되었습니다.');
    ids.add(f.id);
    if(!integer(f.rarity,0,4)||!Number.isFinite(f.weight)||f.weight<=0||f.weight>100000) throw Error('희귀도·가중치를 확인하세요.');
    for(const k of ['minPt','maxPt']) if(!integer(f[k],ranges[f.rarity][0],ranges[f.rarity][1])) throw Error(`${f.name}: 등급별 PT 범위를 벗어났습니다.`);
    if(f.minPt>f.maxPt||!integer(f.minSize,1,100000)||!integer(f.maxSize,f.minSize,100000)) throw Error('크기·보상 범위를 확인하세요.');
    if(f.golden&&f.rarity!==4) throw Error('황금주사위는 전설 등급이어야 합니다.');
  }
  if(!s.fish.some(f=>f.rarity>=2)||!s.fish.some(f=>f.rarity<2)) throw Error('확률 아이템을 위해 희귀 이상·미만 물고기가 각각 필요합니다.');
  if(!Array.isArray(s.items)||s.items.length!==3||new Set(s.items.map(i=>i.id)).size!==3) throw Error('상점 기본 상품 3종이 필요합니다.');
  for(const i of s.items) {
    if(i.stock===undefined)i.stock=null;
    if(!ITEMS.some(x=>x.id===i.id)||typeof i.name!=='string'||!i.name.trim()||i.name.length>40||!integer(i.price,1,100000000)||i.minutes!==20||typeof i.enabled!=='boolean'||i.stock!==null&&!integer(i.stock,0,1000000)) throw Error('상품 설정을 확인하세요.');
  }
  if(!Array.isArray(s.announcements)||s.announcements.length>30) throw Error('자동 안내는 최대 30개입니다.');
  const notices=new Set();
  for(const a of s.announcements) {
    if(typeof a.id!=='string'||notices.has(a.id)||!integer(a.minutes,1,1440)||typeof a.text!=='string'||!a.text.trim()||a.text.length>200||typeof a.enabled!=='boolean') throw Error('안내 ID·간격·문구를 확인하세요.');
    notices.add(a.id);
  }
  if(!Array.isArray(s.bannedWords)||s.bannedWords.length>100||s.bannedWords.some(x=>typeof x!=='string'||!x||x.length>40)) throw Error('금칙어 목록을 확인하세요.');
  s.pending=defaults().pending;
  return s;
}
const freshUser=(id,name,month)=>({id,name,month,exp:0,pt:0,tickets:0,attendance:'',daily:{day:'',fishExp:0,fishPt:0,oddPt:0,totalPt:0},bag:{},buffs:{},book:{},keeps:[],lastCommand:0});
const n=x=>Number(x).toLocaleString('ko-KR');
// 느낌표 뒤 첫 낱말이 이 목록에 있으면 진짜 명령어입니다. "!간호사"처럼 정답만 입력한 말과 구분하는 데 쓰며, 겹치면 명령어가 우선입니다.
const KNOWN_COMMANDS=['채팅방','전국날씨','날씨','맛집','카페','채팅','대화','내정보','출석','낚시','홀','짝','홀짝','복권','랭킹','랭킹조회','애청랭킹','경험치랭킹','애청지수','애청온도','온도','라디오메이트','봇호출','랭크','랭크조회','랭킹등록','랭크등록','초이스','초이스조회','초이스안내','초이스등급','초이스기준','방송기록','신청곡','신청취소','신청곡취소','신청곡목록','현재곡','다음곡','이전곡','재생','멈춤','삭제','도감','아이템','가방','버프','킵','룰렛','가위바위보','주사위','숫자맞히기','퀴즈','정답','보이스카드','스푼','도움말','공지','낚시정보'];
// 느낌표로 시작하는 말 중에서 메뉴판을 봇이 알아듣는 명령 목록에 넣습니다.
KNOWN_COMMANDS.push('메뉴판');
// 아래 설정은 해당 기능이 생기기 전에 저장된 방에는 없습니다. Store.load가 없는 값을 기본값으로 채워서,
// 웹 관리 화면에서 설정을 한 번 저장하기 전에도 기능이 정상 동작하게 합니다.
const NEW_SETTING_KEYS=['donationDonorTicketEvery','djRankDaily','djRankDailyDate','djRankMonthly','djRankMonthlyMonth','djRankPrevMonthly','djRankPrevMonth','battleTargetSpoons','battleTeamGiftSpoons','screenCaptureMin','fishingWho','fishingLuck','donationTicketEnabled','donationTicketMin','donationTicketCount','donationExpEnabled','donationExpMin','donationExpPerSpoon','donationDonorTicketEnabled','donationDonorTicketMin','donationDonorTicketCount','lotteryFirstExp','lotteryFirstPt','lotterySecondExp','lotterySecondPt','lotteryThirdExp','lotteryThirdPt','battleEnabled','battleMinutes','battleGiftSpoons','battleFirstPt','battleFirstExp','battleSecondPt','battleSecondExp','battleThirdPt','battleThirdExp'];
const COMMAND_WORDS=new Set([...KNOWN_COMMANDS,'자동운영','자동퀴즈','복권초기화','복권지급','계정연결','대결','조용','게임','구매','포기','취소']);
// 0, 음수, 소수는 받지 않습니다. 컴퓨터가 정확하게 기억할 수 있는 양의 정수만 허용합니다.
const validReactionAmount=amount=>/^[1-9]\d*$/.test(amount)&&Number.isSafeInteger(Number(amount));
export class Store {
  constructor(path=':memory:') {
    this.db=new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS outbox(id TEXT PRIMARY KEY,room TEXT NOT NULL,event_key TEXT NOT NULL,text TEXT NOT NULL,created INTEGER NOT NULL,due INTEGER NOT NULL,attempts INTEGER NOT NULL,status TEXT NOT NULL,UNIQUE(room,event_key));
      CREATE INDEX IF NOT EXISTS outbox_due ON outbox(room,status,due);
      CREATE TABLE IF NOT EXISTS rooms(id TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS events(room TEXT,id TEXT,result TEXT,PRIMARY KEY(room,id));
      CREATE TABLE IF NOT EXISTS audit(seq INTEGER PRIMARY KEY AUTOINCREMENT,room TEXT,time INTEGER,user TEXT,type TEXT,data TEXT);
      CREATE TABLE IF NOT EXISTS tokens(room TEXT PRIMARY KEY,data TEXT);
      CREATE TABLE IF NOT EXISTS backups(id TEXT PRIMARY KEY,room TEXT,time INTEGER,data TEXT);`);
  }
  ids(){return this.db.prepare('SELECT id FROM rooms').all().map(r=>r.id);}
  load(id){const row=this.db.prepare('SELECT data FROM rooms WHERE id=?').get(id);if(!row)return null;const room=JSON.parse(row.data);room.users=Object.assign(Object.create(null),room.users);normalizeExtras(room.settings);room.settings.pending=defaults().pending;room.settings.spoonNotice??=defaults().spoonNotice;if(room.settings.spoonNotice===LEGACY_CHARGE_NOTICE)room.settings.spoonNotice=DEFAULT_CHARGE_NOTICE;room.settings.introEnabled??=true;room.settings.introText??=defaults().introText;room.settings.roulette??=false;room.settings.rouletteRewards??=defaults().rouletteRewards;room.settings.likeGreetingEnabled??=true;room.settings.likeGreeting??=defaults().likeGreeting;const base=defaults();for(const key of NEW_SETTING_KEYS)if(room.settings[key]===undefined&&base[key]!==undefined)room.settings[key]=base[key];return room;}
  create(id,name) {
    if(!this.load(id))this.save({id,name,settings:defaults(),month:dates().month,users:{},songs:[],current:null,previous:null,lastRequester:null,streak:0,lastResponse:0,live:false,noticeTimes:{},achievers:[],special:[]});
    return this.load(id);
  }
  save(room){this.db.prepare('INSERT INTO rooms VALUES(?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data').run(room.id,JSON.stringify(room));}
  log(room,user,type,data,now=Date.now()){this.db.prepare('INSERT INTO audit(room,time,user,type,data) VALUES(?,?,?,?,?)').run(room,now,user,type,JSON.stringify(data));}
  transaction(id,fn){this.db.exec('BEGIN IMMEDIATE');try{const room=this.load(id);if(!room)throw Error('방송을 찾을 수 없습니다.');const result=fn(room);this.save(room);this.db.exec('COMMIT');return result;}catch(e){this.db.exec('ROLLBACK');throw e;}}
  backup(id){const r=this.load(id);if(!r)throw Error('방송이 없습니다.');const key=randomUUID();this.db.prepare('INSERT INTO backups VALUES(?,?,?,?)').run(key,id,Date.now(),JSON.stringify(r.settings));return key;}
  prune({eventsKeep=200000,auditDays=90,backupsKeep=50}={},now=Date.now()){
    for(const value of [eventsKeep,auditDays,backupsKeep])if(!Number.isSafeInteger(value)||value<1)throw Error('보관 한도는 양의 안전한 정수여야 합니다.');
    this.db.prepare("UPDATE outbox SET status='expired' WHERE status='pending' AND created<?").run(now-600000);
    this.db.prepare("DELETE FROM outbox WHERE status NOT IN ('pending','sending') AND created<?").run(now-7*86400000);
    const cutoff=now-auditDays*86400000;
    this.db.prepare('DELETE FROM audit WHERE time<?').run(cutoff);
    this.db.prepare('DELETE FROM events WHERE rowid NOT IN (SELECT rowid FROM events ORDER BY rowid DESC LIMIT ?)').run(eventsKeep);
    for(const id of this.ids()){
      const room=this.load(id);if(room.chat?.messages.some(m=>m.time<now-7*86400000)){room.chat.messages=room.chat.messages.filter(m=>m.time>=now-7*86400000);this.save(room);}
    }
    for(const {room} of this.db.prepare('SELECT DISTINCT room FROM backups').all())
      this.db.prepare('DELETE FROM backups WHERE room=? AND id NOT IN (SELECT id FROM backups WHERE room=? ORDER BY time DESC LIMIT ?)').run(room,room,backupsKeep);
  }
  snapshot(dir,{keep=7,now=Date.now()}={}){
    if(!Number.isSafeInteger(keep)||keep<1)throw Error('백업 보관 수는 양의 안전한 정수여야 합니다.');
    mkdirSync(dir,{recursive:true});
    const stamp=new Date(now+9*3600000).toISOString().slice(0,10),file=join(dir,`studio-${stamp}.sqlite`);
    const pending=join(dir,`.snapshot-${randomUUID()}.tmp`);
    try{
      this.db.exec(`VACUUM INTO '${pending.replaceAll("'","''")}'`);
      renameSync(pending,file);
    }finally{rmSync(pending,{force:true});}
    const old=readdirSync(dir).filter(f=>/^studio-\d{4}-\d{2}-\d{2}\.sqlite$/.test(f)).sort().reverse().slice(keep);
    for(const f of old)rmSync(join(dir,f),{force:true});
    return file;
  }
  logs(id){return this.db.prepare('SELECT * FROM audit WHERE room=? ORDER BY seq DESC LIMIT 200').all(id).map(r=>({...r,data:JSON.parse(r.data)}));}
}
export class Engine {
  constructor(store,{now=()=>Date.now(),int=(a,b)=>randomInt(a,b+1),region='kr',identityKey=randomBytes(32).toString('hex')}={}){this.store=store;this.now=now;this.int=int;this.region=region;this.identityKey=identityKey;this.diningPrompts=new Map();this.conversation=new Conversation({int});this.aiNotes=new Map();this.bulk=new Map();}
  deleteSong(r,event,input,scope,now){
    if(event.isDj!==true)fail('신청곡 삭제는 DJ 전용입니다. 본인 신청곡은 !신청취소를 사용하세요.');
    let result;try{result=deleteSongCommand(r,event.user.id,input,scope,now);}catch(error){fail(error.message);}
    if(result.stopped)r.playbackControl={id:randomUUID(),action:'pause',time:now};
    this.store.log(r.id,event.user.id,'song-delete-command',{input,scope:scope||'context',result:result.text},now);r.lastResponse=now;return {text:result.text};
  }
  listenerSnapshot(room,listeners,now=this.now()){
    this.store.transaction(room,r=>{this.reset(r);const rewards=rewardListening(r,listeners,now,(id,name)=>freshUser(id,name,dates(now).month));for(const reward of rewards)this.store.log(room,reward.user,'listening-reward',reward,now);
      const notices=collectAffinityNotices(r,now),header='라디오메이트 자체 애청지수 상승',footer='※ 스푼 공식 애청온도와 별개';let lines=[],batch=0;
      const flush=()=>{if(lines.length)new Outbox(this.store).enqueue(room,'affinity-notice:'+now+':'+batch++,[header,...lines,footer].join('\n'),now);lines=[];};
      for(const notice of notices){const line=[...notice.name].slice(0,14).join('')+'님 +'+notice.gain+'점 → '+notice.total+'점';if([header,...lines,line,footer].join('\n').length>200)flush();lines.push(line);this.store.log(room,notice.user,'affinity-notice',{gain:notice.gain,total:notice.total},now);}flush();r.listeningStatus='청취자 목록 확인 중 · 1분 간격으로 접속 시간을 추정합니다.';});
  }
  recordSpoonTemperature(room,data,now=this.now()){
    const snapshot=temperatureEvent(data,now);if(!snapshot)return false;let updated=false;
    this.store.transaction(room,r=>{
      const id=data.user.id,existing=Object.hasOwn(r.users,id)?r.users[id]:null,previous=officialTemperature(existing);
      if(previous&&snapshot.observedAt<=previous.observedAt)return;
      const user=existing||freshUser(id,data.user.nickname||'청취자',dates(now).month);
      user.spoonTemperature=snapshot;if(data.user.nickname)user.name=data.user.nickname;r.users[id]=user;updated=true;
    });return updated;
  }
  syncBuffs(r,now=this.now()){
    r.itemCheckedAt=now;
    for(const u of Object.values(r.users)){
      u.buffPaused??={};
      for(const item of r.settings.items){
        const paused=r.settings.pauseItems&&(r.id!=='demo'&&!r.demo&&!r.live||r.settings.quiet||!(item.id==='odd'?r.settings.odd:r.settings.fishing));
        const since=u.buffPaused[item.id];
        if(since!==undefined){const elapsed=Math.max(0,now-since);if(u.buffs[item.id]>since)u.buffs[item.id]=Math.min(Number.MAX_SAFE_INTEGER,u.buffs[item.id]+elapsed);}
        if(paused)u.buffPaused[item.id]=now;else delete u.buffPaused[item.id];
      }
    }
  }
  reset(r){
    this.syncBuffs(r);
    const {day,month}=dates(this.now());
    for(const u of Object.values(r.users)) {
      if(u.month!==month){u.pt=0;u.tickets=0;u.ticketRevision=(u.ticketRevision||0)+1;u.keeps=[];u.month=month;}
      if(u.daily.day!==day)u.daily={day,fishExp:0,fishPt:0,oddPt:0,totalPt:0};
    }
    if(r.month!==month){r.month=month;this.store.log(r.id,'system','monthly-reset',{month},this.now());}
  }
  credit(r,u,amount,source){
    let allowed=Math.min(amount,Math.max(0,LIMIT.total-u.daily.totalPt));
    if(source==='fish')allowed=Math.min(allowed,Math.max(0,LIMIT.fish-u.daily.fishPt));
    if(source==='odd')allowed=Math.min(allowed,Math.max(0,LIMIT.odd-u.daily.oddPt));
    if(!Number.isSafeInteger(u.pt+allowed))fail('포인트가 정확히 처리 가능한 정수 범위를 초과합니다.');
    u.pt+=allowed;u.daily.totalPt+=allowed;
    if(source==='fish')u.daily.fishPt+=allowed;
    if(source==='odd')u.daily.oddPt+=allowed;
    if(u.daily.totalPt===LIMIT.total&&!r.achievers.some(a=>a.day===u.daily.day&&a.user===u.id))r.achievers.push({day:u.daily.day,user:u.id,name:u.name,time:this.now()});
    this.store.log(r.id,u.id,'pt-reward',{source,requested:amount,paid:allowed},this.now());return allowed;
  }
  weighted(list){const total=list.reduce((s,f)=>s+f.weight,0);let pick=this.int(0,999999)/1000000*total;for(const f of list){pick-=f.weight;if(pick<0)return f;}return list.at(-1);}
  async handleAsync(roomId,event){
    const r=this.store.load(roomId),user=r?.users[event.user?.id],now=this.now();
    if(event.isDj===true&&/^!\s*재생\s*$/u.test(String(event.message||'').trim())&&this.searchSong){
      if(this.store.db.prepare('SELECT 1 FROM events WHERE room=? AND id=?').get(roomId,event.id))return {text:null,duplicate:true};
      const selected=r.songSelection,target=selected?.kind==='queue'?r.songs.find(song=>song.id===selected.id):selected?.kind==='previous'?r.previous:r.current||r.songs[0];
      if(target&&!songVideoId(target))try{
        const videoId=await this.searchSong(target.title);
        this.store.transaction(roomId,current=>{const song=[current.current,current.previous,...current.songs].find(song=>song?.id===target.id);if(song&&song.title===target.title&&!songVideoId(song)){song.videoId=videoId;rememberSongVideo(current,song,videoId);touchQueue(current);}});
      }catch{/* The request still works when search is unavailable; the player can retry. */}
    }
    const text=normalizeCommand(event.message),promptKey=JSON.stringify([roomId,event.user?.id]);
    // 정답만 입력해도 인정합니다: "간호사"처럼 그냥 입력하거나 "!간호사"처럼 느낌표만 붙여도 됩니다. 진행 중인 문제의 정답과 같은 말만 정답 처리하고(대기시간에 걸려 놓치지 않음),
    // 틀린 말이나 일반 대화에는 반응하지 않습니다. 느낌표를 붙인 말이 진짜 명령어·키워드 규칙·날씨/맛집 요청이면 그쪽이 우선입니다. DJ 본인도 진행 중인 문제의 정답과 똑같이 입력하면 인정합니다(봇 답변이 DJ 계정으로 되돌아와도 정답과 완전히 같은 말은 아니라 안전).
    if(r&&event.user?.id){
      const bang=text.startsWith('!'),word=bang?text.slice(1).trim().split(/\s+/u)[0]:'',listener=event.isDj!==true&&String(event.user.id)!==String(roomId);
      const answerLike=bang?!COMMAND_WORDS.has(word)&&!assistantRequest(text)&&!keywordMatches(r.settings,text):true;
      if(answerLike&&plainQuizAnswer(r,user,event.message,now)!==null)return this.handle(roomId,event,{plainQuiz:true,followup:true});
      // "!의사"처럼 느낌표를 붙인 틀린 한 낱말은, 본인이 !퀴즈로 받은 개인 문제가 진행 중일 때만 예전 "!정답 의사"와 같이 초성 힌트로 알려 줍니다(DJ 제외).
      // 모두 함께 푸는 자동 퀴즈 중이거나 일반 채팅의 틀린 말에는 답하지 않습니다(다른 봇용 명령어나 잡담에 끼어들지 않도록).
      if(answerLike&&bang&&listener&&word&&[...word].length<=20&&text.slice(1).trim()===word&&user?.quizRound&&activeQuizRound(r,user,now))return this.handle(roomId,{...event,message:'!정답 '+word});
    }
    const pending=this.diningPrompts.get(promptKey);
    for(const [key,value] of this.diningPrompts)if(value.expires<=now)this.diningPrompts.delete(key);
    let request=assistantRequest(text),followup=false,cancel=false,expired=false;
    // A region reply belongs only to the listener and room that opened the prompt.
    // DJ song deletion keeps priority over plain text while its own prompt is active.
    if(pending&&(!text.startsWith('!')||/^!\s*취소$/u.test(text))&&!(event.isDj&&r.songDeletePrompt?.actor===event.user?.id)){
      // 지역을 묻는 중에 "취소"뿐 아니라 "아니", "됐어요"처럼 말해도 그만둔 것으로 봅니다.
      request={kind:pending.kind,arg:[pending.arg,text].filter(Boolean).join(' ')};followup=true;cancel=/^!?(?:취소|아니(?:야|요)?|됐어(?:요)?|괜찮아(?:요)?|그만|패스)$/u.test(text);expired=pending.expires<=now;
    }
    if(request&&(['맛집','카페'].includes(request.kind)||travelKinds.has(request.kind))&&request.arg==='취소')cancel=true;
    if(request){
      if(this.store.db.prepare('SELECT 1 FROM events WHERE room=? AND id=?').get(roomId,event.id))return {text:null,duplicate:true};
      const bulk=this.bulkBlocked(roomId,event,now);
      // 스푼 채팅(delivery)은 응답 간격에 걸려도 버리지 않고 대기열로 보내므로, 대기열이 가득 찼을 때만 막습니다.
      const gapBlocked=event.delivery?this.replyQueueFull(roomId):now-r.lastResponse<r.settings.responseGap*1000;
      const blocked=r.settings.quiet||(!followup&&!event.isDj&&(gapBlocked||user&&now-user.lastCommand<r.settings.cooldown*1000))||bulk;
      let needsRegion;try{needsRegion=travelKinds.has(request.kind)?!travelQuery(request.arg,now).region:['맛집','카페'].includes(request.kind)&&!diningQuery(request.arg,request.kind).region;}catch(error){return this.handle(roomId,event,{assistantRequest:request,assistantText:error.message,promptKey});}
      let assistantText='',assistantMore=[];
      if(!blocked){
        if(cancel)assistantText='검색 지역 입력을 취소했어요.';
        else if(expired)assistantText='지역 입력 시간이 지났어요. !맛집추천 또는 !카페추천으로 다시 시작해주세요.';
        else if(needsRegion)assistantText=travelKinds.has(request.kind)?travelPrompt(request.kind):diningPrompt(request.kind);
        else try{[assistantText,...assistantMore]=await this.assistantParts(request,this.chatContext(roomId,event,r.settings));if(assistantMore.length)this.markBulk(roomId,event,now,r.settings.cooldown);}
        catch{assistantText='검색·대화 서비스를 연결하지 못했어요. 잠시 후 같은 명령을 다시 입력해주세요.';}
      }
      return this.handle(roomId,event,{assistantText,assistantMore,assistantRequest:request,followup,promptKey,needsRegion,cancel,expired,bulk});
    }
    // 명령어(!)가 아닌 말: 방 설정이 허락하면 사람처럼 알아듣고 대답합니다(청취자의 날씨·맛집 질문, 인사, 부름, 이어 말하기).
    // 대화 판단 중 어떤 오류가 나도 스푼 연결 루프가 끊기지 않도록 여기서 막고, 평소처럼 일반 채팅으로 처리합니다.
    if(!text.startsWith('!')){
      let natural=null;
      try{natural=await this.naturalReply(roomId,event,r,text,now);}catch(error){this.noteAiProblem(roomId,'natural-chat: '+error.message,now);}
      if(natural)return this.handle(roomId,event,natural);
    }
    const automatic=/^!\s*복권\s+자동\s*$/.test(String(event.message||'').trim());
    if(automatic&&user?.tickets>LOTTERY_CHUNK&&user.month===dates(now).month&&(event.isDj||now-r.lastResponse>=r.settings.responseGap*1000&&now-user.lastCommand>=r.settings.cooldown*1000)){
      if(this.store.db.prepare('SELECT 1 FROM events WHERE room=? AND id=?').get(roomId,event.id))return {text:null,duplicate:true};
      const count=user.tickets,ticketRevision=user.ticketRevision||0;if(!Number.isSafeInteger(count)||count<1)return this.handle(roomId,event);
      const counts=await lotterySummaryAsync(count,(min,max)=>this.int(min,max));
      return this.handle(roomId,event,{count,counts,ticketRevision});
    }
    return this.handle(roomId,event);
  }
  plainQuizEvent(r,event,now){const answer=plainQuizAnswer(r,r.users[event.user?.id],event.message,now);return answer===null?null:{...event,message:'!정답 '+answer};}
  // ───── 명령어 없는 대화 ─────
  chatContext(roomId,event,settings,extra={}){return {store:this.store,room:roomId,user:event.user?.id,channel:'spoon',nickname:event.user?.nickname,botName:settings.chatName,persona:settings.chatPersona,int:this.int,...extra};}
  async assistantParts(request,context){
    if(!this.lifestyle)return ['대화 도우미가 준비 중입니다.'];
    const parts=this.lifestyle.answerParts?await this.lifestyle.answerParts(request,context):[await this.lifestyle.answer(request,context)];
    return parts.length?parts:[''];
  }
  // 한 사람이 여러 쪽짜리 답(예: 이번주 지역별 날씨)을 연달아 요청해 채팅을 도배하지 못하게 합니다. DJ는 제외합니다.
  bulkBlocked(roomId,event,now){return event.isDj!==true&&(this.bulk.get(roomId+'|'+event.user?.id)??0)>now;}
  markBulk(roomId,event,now,seconds){if(this.bulk.size>=2000)this.bulk.delete(this.bulk.keys().next().value);this.bulk.set(roomId+'|'+event.user?.id,now+Math.max(30,seconds||0)*1000);}
  // 봇은 DJ 계정으로 채팅을 보내므로 자기 답변이 다시 들어올 수 있습니다. 방금 보낸 문구와 같으면 무시해 대화가 꼬리를 물지 않게 합니다.
  isBotEcho(roomId,text,now){
    const key=squash(text);
    return this.store.db.prepare("SELECT text FROM outbox WHERE room=? AND status IN ('sent','sending','uncertain') AND created>? ORDER BY created DESC LIMIT 30").all(roomId,now-180000).some(row=>squash(row.text)===key);
  }
  // AI 호출이 막혀도 채팅방에는 오류 문구를 흘리지 않고(규칙 기반 대답으로 대체), 이유만 운영 기록에 10분에 한 번 남깁니다.
  noteAiProblem(roomId,message,now){
    if(now-(this.aiNotes.get(roomId)??0)<600000)return;
    if(this.aiNotes.size>=500)this.aiNotes.delete(this.aiNotes.keys().next().value);
    this.aiNotes.set(roomId,now);
    try{this.store.log(roomId,'system','ai-chat-unavailable',{message:String(message||'').slice(0,120)},now);}catch{/* 기록 실패가 대화를 막지 않게 */}
  }
  // 대답할 말이면 {natural,assistantText,...}를, 가만히 있어야 하면 null을 돌려줍니다. 외부 호출(AI·날씨)은 DB 트랜잭션 밖에서 합니다.
  async naturalReply(roomId,event,r,text,now){
    const s=r?.settings,user=event.user?.id;
    if(!this.lifestyle||!s||!user||!text||s.chatMode==='off'||typeof event.id!=='string')return null;
    // DJ 본인과 봇이 DJ 계정으로 보낸 답변(되돌아온 것)에는 기본적으로 끼어들지 않습니다. (봇 답변이 DJ 계정으로 되돌아오기 때문에, 막지 않으면 봇이 자기 말에 계속 대답할 수 있음)
    // 다만 DJ가 봇 이름을 직접 부른 짧은 말(예: "라메야 안녕")에는 대답합니다. (설정 chatDjCall, 기본 켜짐) 이미 처리한 이벤트도 다시 AI를 부르지 않습니다.
    const fromDj=event.isDj===true||String(user)===String(roomId);
    if(fromDj&&!(s.chatDjCall&&[...text].length<=100&&callsBot(squash(text).toLowerCase(),botNames(s))))return null;
    if(this.isBotEcho(roomId,text,now))return null; // 방금 봇이 보낸 문구와 같으면(되돌아온 답변) 무시
    if(keywordMatches(s,text))return null; // DJ가 만든 키워드 응답이 우선
    // 스푼 채팅은 답장이 8개 이상 밀려 있으면 AI도 부르지 않고 건너뜁니다. (쓸모없는 호출과 도배 방지)
    if(event.delivery&&this.replyQueueFull(roomId))return null;
    if(this.store.db.prepare('SELECT 1 FROM events WHERE room=? AND id=?').get(roomId,event.id))return null;
    const plan=this.conversation.plan({roomId,event,settings:s,now,isRegion:token=>!!this.lifestyle.resolveRegion?.(token),lastResponse:event.delivery?0:r.lastResponse}); // 스푼 채팅은 응답 간격에 걸려도 대기열로 보내므로 간격 때문에 건너뛰지 않음
    if(!plan||plan.kind==='service'&&this.bulkBlocked(roomId,event,now))return null;
    const context=this.chatContext(roomId,event,s,{natural:true,mayskip:plan.mayskip,song:r.current?.title}),promptKey=JSON.stringify([roomId,user]);
    let parts,request={kind:'chat',arg:''},needsRegion=false;
    if(plan.kind==='service'){
      request=plan.request;needsRegion=['맛집','카페'].includes(request.kind)&&!diningQuery(request.arg,request.kind).region;
      if(needsRegion)parts=[`어느 지역 ${request.kind}${request.kind==='카페'?'를':'을'} 찾아볼까요? "광주 동명동"처럼 말해 주세요 ♡ (2분 안에 답해주세요)`];
      else try{parts=await this.assistantParts(request,context);}catch{parts=['지금은 알아오지 못했어요. 잠시 뒤에 다시 물어봐주세요 ♡'];}
      if(parts.length>1)this.markBulk(roomId,event,now,s.cooldown);
      if(this.lifestyle.ai?.configured)this.lifestyle.ai.remember?.(context,text,parts.join(' '));
    }else{
      const result=this.lifestyle.converse?await this.lifestyle.converse(plan.text,context):{text:null,reason:'unavailable'};
      if(result.reason==='skipped'){this.conversation.record(roomId,user,now,text,{open:false});return null;} // AI가 "내게 한 말이 아니다"라고 판단
      if(result.reason==='error')this.noteAiProblem(roomId,result.message,now);
      const reply=result.text||plan.fallback;if(!reply)return null;parts=[reply];
    }
    this.conversation.record(roomId,user,now,text);
    return {natural:true,trigger:plan.trigger,assistantRequest:request,assistantText:parts[0],assistantMore:parts.slice(1),promptKey,needsRegion};
  }
  naturalCommand(r,e,now,prepared){
    if(r.settings.quiet)return {text:null,suppressed:'quiet'};
    if(prepared.promptKey){
      this.diningPrompts.delete(prepared.promptKey);
      if(prepared.needsRegion){if(this.diningPrompts.size>=1000)this.diningPrompts.delete(this.diningPrompts.keys().next().value);this.diningPrompts.set(prepared.promptKey,{kind:prepared.assistantRequest.kind,arg:'',expires:now+120000});}
    }
    const [text,...more]=[prepared.assistantText,...(prepared.assistantMore||[])].map(part=>String(part||'').trim()).filter(Boolean);
    if(!text)return {text:null};
    r.lastResponse=now;
    this.store.log(r.id,e.user.id,'natural-chat',{trigger:prepared.trigger,kind:prepared.assistantRequest.kind},now);
    return {text:text.slice(0,200),...(more.length?{more:more.map(part=>part.slice(0,200))}:{})};
  }
  handle(roomId,event,preparedLottery=null){
    const now=this.now();
    return this.store.transaction(roomId,r=>{
      this.reset(r);
      if(!event.id||typeof event.id!=='string')throw Error('이벤트 ID가 필요합니다.');
      if(this.store.db.prepare('SELECT 1 FROM events WHERE room=? AND id=?').get(roomId,event.id))return {text:null,duplicate:true};
      if(Object.hasOwn(r.users,event.user?.id)){
        const actor=r.users[event.user.id];if(typeof event.user.nickname==='string'&&event.user.nickname.trim())actor.name=event.user.nickname;
        if(String(event.message||'').trim()&&creditChat(r,actor,now))this.store.log(r.id,actor.id,'affinity-chat',{points:5},now);
      }
      let result;const checkpoint=JSON.stringify(r);
      this.store.db.exec('SAVEPOINT command_effects');
      // 명령어 없이 입력한 정답은 트랜잭션 안에서 한 번 더 확인합니다(동시에 정답이 들어와 이미 끝난 문제라면 오류 문구 없이 조용히 넘어갑니다).
      const commandEvent=preparedLottery?.plainQuiz?this.plainQuizEvent(r,event,now):event;
      try{result=commandEvent?this.command(r,commandEvent,now,preparedLottery):{text:null,suppressed:'quiz-closed'};this.store.db.exec('RELEASE command_effects');}
      catch(e){
        if(!(e instanceof RuleError))throw e;
        const attempted=r.users[event.user?.id],commandTime=attempted?.lastCommand,commandName=attempted?.name;
        this.store.db.exec('ROLLBACK TO command_effects; RELEASE command_effects');
        for(const key of Object.keys(r))delete r[key];Object.assign(r,JSON.parse(checkpoint));
        r.users=Object.assign(Object.create(null),r.users);
        // Invalid attempts still obey the existing per-listener cooldown.
        const original=r.users[event.user?.id];if(original&&commandTime===now){original.lastCommand=now;original.name=commandName;}
        result={text:e.message};
      }
      this.syncBuffs(r,now);
      if(result.text&&!preparedLottery?.assistantRequest&&normalizeCommand(event.message).startsWith('!'))this.diningPrompts.delete(JSON.stringify([roomId,event.user?.id]));
      if(event.delivery&&result.text){const outbox=new Outbox(this.store);outbox.enqueue(roomId,event.id,result.text,now);result.more?.forEach((part,i)=>outbox.enqueue(roomId,event.id+':'+(i+2),part,now));}
      this.store.db.prepare('INSERT INTO events VALUES(?,?,?)').run(roomId,event.id,JSON.stringify(preparedLottery?.assistantRequest||assistantRequest(event.message)?{text:null,assistant:true}:result));
      // 여러 쪽 답변은 전송 큐가 쪽마다 따로 보내고, 테스트 화면처럼 큐를 안 쓰는 곳에는 한 덩어리로 돌려줍니다.
      if(result.more){const {more,...rest}=result;return {...rest,text:[result.text,...more].join('\n')};}
      return result;
    });
  }
  command(r,e,now,preparedLottery=null){
    const s=r.settings,text=normalizeCommand(e.message),request=preparedLottery?.assistantRequest||assistantRequest(text);
    if(preparedLottery?.natural)return this.naturalCommand(r,e,now,preparedLottery);
    if(!text.startsWith('!')&&!request){
      if(e.isDj&&r.songDeletePrompt?.actor===e.user?.id){
        if(r.songDeletePrompt.expires<=now){delete r.songDeletePrompt;return {text:'삭제 선택 시간이 지났습니다. !삭제로 새 목록을 열어주세요.'};}
        return this.deleteSong(r,e,text,undefined,now);
      }
      const out=keywordReply(r,e,now);if(out.text)this.store.log(r.id,e.user.id,'keyword-reply',{ruleId:out.ruleId},now);return out;
    }
    const bits=text.slice(1).trim().split(/\s+/);let cmd=bits.shift()||'';
    if(request)cmd=request.kind==='greeting'?'채팅':request.kind;
    if(cmd==='구매'){cmd='아이템';bits.unshift('구매');}
    if(cmd==='포기'){cmd='퀴즈';bits.unshift('포기');} // !포기 = !퀴즈 포기
    const arg=bits.join(' ');
    // 실제 스푼 채팅에서는 보낸 사람의 계정 ID를 방송 주인의 ID와 비교해 메뉴판을 편집할 DJ인지 확인합니다.
    // 실제 스푼 스트림(delivery)에서 온 메시지는 보낸 사람의 계정 ID가 방송 주인(r.id)과 같으면 DJ로 인정합니다. (!메뉴판·!복권지급·!대결 시작 등 모든 DJ 전용 명령)
    const dj=e.isDj===true||(e.delivery===true&&String(e.user?.id)===String(r.id));
    if(dj&&r.songDeletePrompt?.actor===e.user?.id&&!['삭제','이전곡','다음곡'].includes(cmd))delete r.songDeletePrompt;
    const answer=t=>{r.lastResponse=now;return {text:t};};
    if(cmd==='메뉴판'&&['추가','삭제'].includes(bits[0])){
      if(!dj)fail('메뉴판 편집은 DJ 전용입니다.');
      // 예를 들어 '추가 10 하트 리액션'을 받으면 할 일은 '추가', 금액은 '10', 문구는 '하트 리액션'입니다.
      const [action,amount,...words]=bits;
      const reaction=words.join(' ');
      if(!validReactionAmount(amount)||(action==='추가'?!reaction||reaction.length>100:words.length)){
        fail('사용법: !메뉴판 추가 10 하트 리액션 / !메뉴판 삭제 10 (문구 최대 100자)');
      }
      const reactions=s.donationReactions??={};
      const exists=Object.hasOwn(reactions,amount);
      // 없는 항목은 지울 수 없습니다. 이미 있는 금액의 문구를 바꾸면 항목 수는 늘지 않습니다.
      if(action==='삭제'&&!exists)return answer(`${amount}스푼에 등록된 리액션이 없습니다.`);
      if(action==='추가'&&!exists&&Object.keys(reactions).length>=50)fail('메뉴판에는 리액션을 최대 50개 등록할 수 있습니다.');
      // 잘못 바꿨을 때 돌아갈 수 있도록 편집하기 전에 현재 설정을 백업합니다.
      this.store.backup(r.id);
      if(action==='삭제')delete reactions[amount];
      else reactions[amount]=reaction;
      // 설정 버전을 올리면 이전 설정을 열어 둔 화면에서 방금 편집한 내용을 덮어쓰는 일을 막을 수 있습니다.
      r.settingsRevision=(r.settingsRevision||0)+1;
      // 나중에 확인할 수 있도록 누가 어떤 금액을 추가하거나 삭제했는지 기록합니다.
      this.store.log(r.id,e.user.id,'donation-menu-settings',{action,amount:Number(amount)},now);
      return answer(`${amount}스푼 리액션을 ${action==='삭제'?'삭제':exists?'수정':'등록'}했습니다.`);
    }
    if(cmd==='자동운영'){
      if(!dj)fail('자동 운영 설정은 DJ 전용입니다.');
      if(arg==='상태')return answer('자동 운영 '+(r.automation?.enabled?'ON':'OFF')+' · 퀴즈 '+(s.autoQuizEnabled?s.autoQuizMinutes+'분':'OFF')+' · 청취 복권 '+(s.listenRewards?s.listenMinutes+'분마다 '+s.listenTickets+'장':'OFF'));
      if(!['on','off'].includes(arg))fail('사용법: !자동운영 on / off / 상태');this.store.backup(r.id);setAutomation(r,arg==='on',now);return answer(arg==='on'?'자동 운영 ON · 퀴즈 10분 · 청취 복권 5분마다 1장 · 출석·인사·신청곡 접수':'자동 운영 OFF · 프로필 적용 전 설정을 복원했습니다.');
    }
    if(cmd==='자동퀴즈'){
      if(!dj)fail('자동 퀴즈 설정은 DJ 전용 명령어입니다.');
      if(arg==='상태')return answer('자동 퀴즈 '+(s.autoQuizEnabled?'ON':'OFF')+' · '+s.autoQuizMinutes+'분 간격 · '+(r.autoQuizRound?'문제 진행 중':'다음 출제 대기'));
      if(!/^(on(?: \d+)?|off)$/.test(arg))fail('사용법: !자동퀴즈 on [간격 분] / !자동퀴즈 off / !자동퀴즈 상태');
      const minutes=bits[1]===undefined?s.autoQuizMinutes:Number(bits[1]);
      if(!Number.isInteger(minutes)||minutes<1||minutes>1440)fail('자동 퀴즈 간격은 1~1440분입니다.');
      if(bits[0]==='on'&&!s.quizQuestions.length)fail('게임 설정에서 퀴즈 문제를 먼저 등록하세요.');
      s.autoQuizEnabled=bits[0]==='on';s.autoQuizMinutes=minutes;
      delete r.autoQuizPending;
      if(s.autoQuizEnabled){s.quiz=true;if(!r.autoQuizRound)r.autoQuizDueAt=now;}else{delete r.autoQuizRound;delete r.autoQuizDueAt;}
      r.settingsRevision=(r.settingsRevision||0)+1;
      this.store.log(r.id,e.user.id,'auto-quiz-settings',{enabled:s.autoQuizEnabled,minutes},now);
      return answer(s.autoQuizEnabled?'자동 퀴즈 ON · '+minutes+'분 간격 · 방송 중 다음 출제부터 자동으로 진행합니다.':'자동 퀴즈 OFF · 진행 중인 자동 문제도 종료했습니다.');
    }
    const ticketReset=cmd==='복권초기화'||cmd==='복권'&&bits[0]==='초기화';
    if(ticketReset){
      if(!dj)fail('복권 초기화는 DJ 전용 명령어입니다.');
      const targets=cmd==='복권초기화'?bits:bits.slice(1);
      if(!targets.length||targets.slice(1).some(target=>target.startsWith('@')))fail('사용법: !복권 초기화 닉네임 또는 !복권초기화 @고유ID (한 명만 지정)');
      const uid=this.target(r,targets.join(' ')),user=r.users[uid],previous=user.tickets;
      user.tickets=0;user.ticketRevision=(user.ticketRevision||0)+1;
      this.store.log(r.id,uid,'ticket-reset',{previous,balance:0,actor:e.user.id},now);
      return answer(`${user.name}님 복권 초기화 · ${n(previous)}장 → 0장 (EXP·PT 유지)`);
    }
    if(dj){
      if(cmd==='조용'){if(!['on','off'].includes(arg))fail('사용법: !조용 on/off');s.quiet=arg==='on';r.settingsRevision=(r.settingsRevision||0)+1;return answer(`조용 모드 ${arg.toUpperCase()}`);}
      // '!계정연결 닉네임 @스푼아이디' → 스푼 프로필에 보이는 @아이디를 그 청취자와 연결합니다.
      // 연결해 두면 이후 '!복권지급 @스푼아이디 3'처럼 아이디로 지급할 수 있습니다. (스푼 공식 API는 @아이디를 알려 주지 않아 DJ가 한 번 연결합니다.)
      if(cmd==='계정연결'){
        const idText=bits.at(-1)||'',nameText=bits.slice(0,-1).join(' ');
        // 마지막 낱말이 @로 시작하는 아이디여야 하고, 그 앞에는 대상 청취자의 닉네임(일부 가능)이나 고유 ID가 있어야 합니다.
        if(!nameText||!idText.startsWith('@')||idText.length<2)fail('사용법: !계정연결 닉네임 @스푼아이디 (예: !계정연결 콰앙 @kwaang)');
        const uid=this.target(r,nameText),user=r.users[uid];
        let alias;try{alias=cleanAccountAlias(r.users,user,idText);}catch(error){fail(error.message);}
        user.accountAlias=alias;
        this.store.log(r.id,'dj','identity-alias',{user:uid,hasEmail:!!user.emailAlias,hasAccount:true,actor:e.user.id},now);
        return answer(`${user.name}님에게 스푼 ID @${alias}를 연결했어요. 이제 !복권지급 @${alias} 3 처럼 아이디로 지급할 수 있어요.`);
      }
      if(cmd==='복권지급'){
        // '!복권지급 전체 3' → 등록된 모든 청취자에게 3장씩 지급합니다.
        // 수량을 빼먹은 '!복권지급 전체'는 실수로 전원에게 지급되지 않도록 사용법만 알려 줍니다.
        // 닉네임이 '전체'인 청취자는 '@전체'나 고유 ID로 지정하면 기존처럼 한 명에게만 지급됩니다.
        const everyone=/^전체(?:\s+([+-]?\d+))?$/u.exec(String(arg||'').trim());
        if(everyone){
          if(everyone[1]===undefined)fail('사용법: !복권지급 전체 수량 (예: !복권지급 전체 3)');
          const count=Number(everyone[1]);
          const people=this.grantTicketsToAll(r,count,user=>this.store.log(r.id,user.id,'ticket-grant',{count,actor:e.user.id,balance:user.tickets,all:true},now));
          return answer(`전체 ${n(people)}명에게 복권 ${n(count)}장씩 지급 · 총 ${n(people*count)}장`);
        }
        let parsed;try{parsed=parseTicketGrant(arg);}catch(error){fail(error.message);}
        const {target,countText}=parsed;
        if(!/^[+-]?\d+$/.test(countText))fail('복권 수량은 정수로 입력해주세요.');
        const count=Number(countText);if(!Number.isSafeInteger(count))fail('복권 수량이 정확히 처리 가능한 정수 범위를 초과합니다.');
        const uid=this.target(r,target),user=r.users[uid],next=user.tickets+count;
        if(next<0)fail(`보유 복권 ${n(user.tickets)}장보다 많이 회수할 수 없습니다.`);
        if(!Number.isSafeInteger(next))fail('복권 보유량이 처리 가능한 범위를 초과합니다.');
        user.tickets=next;if(count!==0)user.ticketRevision=(user.ticketRevision||0)+1;this.store.log(r.id,uid,'ticket-grant',{count,actor:e.user.id,balance:next},now);
        return answer(count===0?`${user.name}님 복권 수량 변경 없음 · 보유 ${n(next)}장`:`${user.name}님 복권 ${n(Math.abs(count))}장 ${count<0?'회수':'지급'} · 보유 ${n(next)}장`);
      }
    }
    if(['조용','복권지급','계정연결'].includes(cmd))fail('DJ 전용 명령어입니다.');
    // !대결: 참가·현황은 누구나, 시작·종료·취소는 DJ만 (자세한 규칙은 battleCommand)
    if(cmd==='대결')return this.battleCommand(r,e,bits,dj,now,answer);
    // DJ가 자기 방송의 순위·초이스 레벨을 채팅으로 입력합니다. (스푼이 순위를 API로 주지 않아 직접 입력)
    if(cmd==='랭킹등록'||cmd==='랭크등록'){
      if(!dj)fail('DJ 전용 명령어입니다.');
      return answer(this.registerDjRank(r,bits,now,e));
    }

    const gameToggle=['게임','낚시','홀짝'].includes(cmd)&&['on','off'].includes(arg),gameStatus=cmd==='게임'&&arg==='상태';
    if(gameToggle&&arg==='off'&&!dj)fail('게임을 끄는 OFF 명령은 DJ 전용입니다.');
    if(gameToggle||gameStatus){
      if(!e.user?.id)fail('청취자 식별 정보가 없습니다.');
      const actor=r.users[e.user.id];
      const wait=Math.max(0,r.lastResponse+s.responseGap*1000-now,actor?actor.lastCommand+s.cooldown*1000-now:0);
      if(!dj&&wait>0)return {text:null,suppressed:'cooldown',retryAfterMs:wait};
      if(actor){actor.name=e.user.nickname||actor.name;actor.lastCommand=now;}
      if(gameStatus)return answer(`낚시 ${s.fishing?'ON':'OFF'} / 홀짝 ${s.odd?'ON':'OFF'} / 가위바위보 ${s.rps?'ON':'OFF'} / 주사위 ${s.dice?'ON':'OFF'} / 숫자맞히기 ${s.numberGuess?'ON':'OFF'} / 퀴즈 ${s.quiz?'ON':'OFF'} / 조용 모드 ${s.quiet?'ON':'OFF'}`);
      if(cmd==='게임'||cmd==='낚시')s.fishing=arg==='on';if(cmd==='게임'||cmd==='홀짝')s.odd=arg==='on';
      if(cmd==='게임')for(const key of ['rps','dice','numberGuess','quiz'])s[key]=arg==='on'&&(key!=='quiz'||s.quizQuestions.length>0);
      r.settingsRevision=(r.settingsRevision||0)+1;
      this.store.log(r.id,e.user.id,'game-control',{command:cmd,enabled:arg==='on'},now);
      return answer(`${cmd} ${arg.toUpperCase()}${cmd==='게임'&&arg==='on'&&!s.quiz?' · 퀴즈는 문제를 등록한 후 켜 주세요.':''}${s.quiet?' · 조용 모드 중에는 게임 응답이 중지됩니다.':''}`);
    }

    if(s.quiet&&['낚시','홀','짝','홀짝','복권','룰렛','가위바위보','주사위','숫자맞히기','퀴즈','정답'].includes(cmd))return {text:null,suppressed:'quiet'};
    if(cmd==='낚시'&&!s.fishing||['홀','짝','홀짝'].includes(cmd)&&!s.odd)return {text:null,suppressed:'disabled'};
    // 스푼 채팅(delivery)은 응답 간격 안에 들어온 명령도 버리지 않고 대기열에서 차례로 보냅니다. (대기열이 가득 찼을 때만 건너뜀)
    if(!dj&&!preparedLottery?.followup&&(e.delivery?this.replyQueueFull(r.id):now-r.lastResponse<s.responseGap*1000))return {text:null,suppressed:'cooldown',retryAfterMs:Math.max(0,r.lastResponse+s.responseGap*1000-now)};
    const known=KNOWN_COMMANDS;
    if(!known.includes(cmd)&&!request){const out=keywordReply(r,e,now);if(out.text)this.store.log(r.id,e.user.id,'keyword-reply',{ruleId:out.ruleId},now);return out;}
    if(!e.user?.id)fail('청취자 식별 정보가 없습니다.');
    let u=r.users[e.user.id];
    const interactionKey=cmd==='킵'?'lastKeepCommand':['아이템','가방','버프'].includes(cmd)?'lastItemCommand':null;
    if(u&&!dj&&!preparedLottery?.followup&&!interactionKey&&now-u.lastCommand<s.cooldown*1000)return {text:null,suppressed:'cooldown',retryAfterMs:Math.max(u.lastCommand+s.cooldown*1000-now,r.lastResponse+s.responseGap*1000-now)};
    if(u&&!dj&&interactionKey&&now-(u[interactionKey]||0)<1000)return {text:null,suppressed:'cooldown',retryAfterMs:1000-(now-u[interactionKey])};
    if(cmd==='내정보'&&arg==='생성'){
      if(!u){u=freshUser(e.user.id,e.user.nickname||'청취자',dates(now).month);r.users[u.id]=u;this.reset(r);}
      u.lastCommand=now;return answer(`${u.name}님 프로필이 준비되었습니다. !출석으로 복권을 받으세요.`);
    }
    if(u){u.name=e.user.nickname||u.name;if(interactionKey)u[interactionKey]=now;else u.lastCommand=now;}
    if(request){
      if(s.quiet)return {text:null,suppressed:'quiet'};
      if(preparedLottery?.bulk)return {text:null,suppressed:'bulk'}; // 여러 쪽 답을 연달아 요청하는 도배는 조용히 넘김
      if(preparedLottery?.promptKey){
        this.diningPrompts.delete(preparedLottery.promptKey);
        if(preparedLottery.needsRegion&&!preparedLottery.cancel&&!preparedLottery.expired){
          if(this.diningPrompts.size>=1000)this.diningPrompts.delete(this.diningPrompts.keys().next().value);
          this.diningPrompts.set(preparedLottery.promptKey,{kind:request.kind,arg:request.arg,expires:now+120000});
        }
      }
      const reply=answer(String(preparedLottery?.assistantText||'대화 도우미를 다시 요청해주세요.').slice(0,200));
      if(preparedLottery?.assistantMore?.length)reply.more=preparedLottery.assistantMore.map(part=>String(part).slice(0,200));
      return reply;
    }
    if(cmd==='도움말')return answer(`시작 !내정보 (자동 생성) · !출석 | 신청곡 !신청곡 · !이전곡 · !현재곡 · !다음곡 · DJ !재생 !멈춤 !삭제 | 정보 !랭킹 · !킵 · !스푼 · !보이스카드 | 게임 !복권${s.fishing?' · !낚시':''}${s.odd?' · !홀/!짝':''}${s.roulette?' · !룰렛':''}${s.rps?' · !가위바위보':''}${s.dice?' · !주사위':''}${s.numberGuess?' · !숫자맞히기':''}${s.quiz?' · !퀴즈 → 정답만 입력 · !포기':''}`);
    if(cmd==='채팅방')return answer(r.chat?.enabled&&r.chat.token?`우리 방송 대화방 ♡ ${this.publicUrl}/chat/${r.chat.token} (스푼과 별도 채팅방)`:'DJ가 아직 앱 채팅방을 열지 않았습니다.');
    if(cmd==='보이스카드')return answer(r.voiceInboxUrl?`음성 보내기(링크를 눌러 녹음): ${r.voiceInboxUrl}\n휴대폰·PC에서 녹음·전송할 수 있습니다. 스푼 앱 내부 자동 녹음은 지원되지 않습니다.`:'DJ가 아직 음성메시지 접수를 열지 않았습니다.');
    if(cmd==='스푼')return answer(spoonChargeReply(s.spoonNotice,this.region));
    if(cmd==='애청온도'||cmd==='온도')return answer(temperatureSummary(r.users[e.user.id])+'\n'+(officialTemperature(r.users[e.user.id])?'마지막 입장 시 스푼이 제공한 값입니다. 이후 변동은 다음 입장 이벤트 수신 시 갱신됩니다.':'events.presence 권한과 봇 매니저 지정 후 입장 이벤트 수신 시 표시합니다.'));
    if(cmd==='공지')return answer(s.notice);
    if(cmd==='메뉴판'){
      // 2스푼이 10스푼보다 앞에 오도록 글자 순서가 아닌 금액 순서로 정렬합니다.
      const entries=Object.entries(s.donationReactions??{}).sort(([a],[b])=>Number(a)-Number(b));
      // 목록이 길면 여러 페이지로 나눕니다. '!메뉴판 2'를 입력하면 두 번째 페이지를 보여줍니다.
      return answer(chatPage('후원 메뉴판',entries.map(([amount,reaction])=>`${n(Number(amount))}스푼 · ${reaction}`),arg,cmd,'등록된 후원 리액션이 없습니다.'));
    }
    // DJ 전용 정보: 이 방송 DJ의 일라디·월라디 순위와 넥스트초이스 레벨 (!랭크·!랭킹조회·!랭크조회)
    if(['랭크','랭킹조회','랭크조회'].includes(cmd))return answer(this.djRankReply(r,now));
    // 이번 달 방송일수·방송시간과 넥스트초이스 등급별 기준 비교 (!초이스·!초이스조회·!방송기록)
    if(['초이스','초이스조회','방송기록'].includes(cmd))return answer(this.choiceReport(r,now));
    // 넥스트초이스(Choice DJ) 티어별 선정 순위·정산 비율·환전 처리일 안내 (!초이스안내·!초이스등급·!초이스기준)
    if(['초이스안내','초이스등급','초이스기준'].includes(cmd))return answer(this.choiceGuide());
    if(['랭킹','애청랭킹'].includes(cmd))return answer(chatPage('애청지수 순위',affinityRank(r.users).map((v,i)=>`${i+1}. ${[...v.name].slice(0,25).join('')} ${n(affinityScore(v))}점`),arg,'랭킹','등록된 청취자가 없습니다.'));
    if(cmd==='경험치랭킹')return answer(chatPage('경험치 순위',Object.values(r.users).sort((a,b)=>b.exp-a.exp||a.id.localeCompare(b.id)).map((v,i)=>`${i+1}. ${[...v.name].slice(0,25).join('')} ${n(v.exp)} EXP`),arg,cmd,'등록된 청취자가 없습니다.'));
    if(['라디오메이트','봇호출'].includes(cmd))return answer('라디오메이트 명령 수신 중입니다. 다른 DJ 방송 연결은 라디오메이트 공용 HTTPS 화면에서 해당 DJ 계정으로 스푼 연결에 동의해 주세요. 방송이 시작되면 봇이 자동 접속합니다.');
    if(cmd==='이전곡'){
      if(arg==='삭제'||arg.startsWith('삭제 '))return this.deleteSong(r,e,arg.slice(2).trim(),'previous',now);
      if(dj){delete r.songDeletePrompt;if(r.previous)r.songSelection={kind:'previous',id:r.previous.id,title:r.previous.title};else delete r.songSelection;}
      return answer(r.previous?`이전곡: ${r.previous.title}${dj?' · 선택됨. !재생으로 재생하세요.':''}`:'이전에 재생한 곡이 없습니다.');
    }
    if(cmd==='현재곡')return answer(r.current?`현재곡: ${r.current.title}`:'현재곡이 없습니다.');
    if(cmd==='다음곡'){
      if(arg==='삭제'||arg.startsWith('삭제 '))return this.deleteSong(r,e,arg.slice(2).trim(),'queue',now);
      if(dj){delete r.songDeletePrompt;if(r.songs[0])r.songSelection={kind:'queue',id:r.songs[0].id,title:r.songs[0].title};else delete r.songSelection;}
      return answer(r.songs[0]?`다음곡: ${r.songs[0].title}${dj?' · 선택됨. !재생으로 재생하세요.':''}`:'다음 신청곡이 없습니다.');
    }
    if(cmd==='신청곡목록'||cmd==='신청곡'&&!arg)return answer(chatPage('신청곡',r.songs.map((v,i)=>`${i+1}. ${[...v.title].slice(0,70).join('')} (${[...v.name].slice(0,20).join('')})`),arg,'신청곡목록','대기 중인 신청곡이 없습니다. !신청곡 가수 - 제목으로 신청하세요.'));
    if(cmd==='재생'||cmd==='멈춤'){
      if(!dj)fail('재생·멈춤은 DJ 전용 명령입니다.');
      if(arg)fail('사용법: !재생 또는 !멈춤');
      if(cmd==='재생'&&(r.current||r.songs.length||r.songSelection))applySongAction(r,{action:'start'},now);
      r.playbackControl={id:randomUUID(),action:cmd==='재생'?'play':'pause',time:now};
      r.playbackState=cmd==='재생'?'requested':'paused';
      this.store.log(r.id,e.user.id,'playback-control',{action:r.playbackControl.action},now);
      return answer(cmd==='멈춤'?'멈춤 요청을 보냈습니다. 연결된 휴대폰·PC 플레이어를 일시정지합니다.':`재생 요청: ${(r.current?.title||'새 신청곡 대기').slice(0,45)}${songVideoId(r.current)?'\nhttps://youtu.be/'+songVideoId(r.current):''}\n${this.publicUrl?'플레이어: '+this.publicUrl+'/player':'휴대폰·PC 플레이어에서 재생합니다.'}`);
    }
    if(cmd==='삭제'){
      return this.deleteSong(r,e,arg,undefined,now);
    }
    if(cmd==='아이템'&&bits[0]==='상점'&&!s.items.some(i=>i.enabled))return answer('판매 중인 아이템이 없습니다.');
    if(cmd==='아이템'&&bits[0]==='상점')return answer(chatPage('아이템 상점',[
      '구매: !구매 ID/번호/이름 · 사용: !아이템 사용 ID (20분)',
      ...s.items.flatMap((i,index)=>i.enabled?[`${index+1}. ${i.name.slice(0,28)} (${i.id}) ${n(i.price)} PT${i.stock===0?' · 품절':''}`]:[])
    ],bits.slice(1).join(' '),'아이템 상점','판매 중인 아이템이 없습니다.'));
    if(!u&&(cmd==='내정보'||cmd==='애청지수'||cmd==='킵'||cmd==='아이템'&&bits[0]==='구매'||cmd==='정답'&&r.autoQuizRound||dj)){
      u=freshUser(e.user.id,e.user.nickname||'청취자',dates(now).month);r.users[u.id]=u;this.reset(r);if(interactionKey)u[interactionKey]=now;else u.lastCommand=now;
    }
    if(!u)fail('먼저 !내정보 를 입력하면 프로필이 자동으로 만들어집니다.');
    const quiz=playQuiz(this,r,u,cmd,arg,now,fail);if(quiz!==null)return answer(quiz);
    const mini=playMiniGame(this,r,u,cmd,arg,now,fail);if(mini!==null)return answer(mini);
    const active=id=>u.buffPaused?.[id]===undefined&&(u.buffs[id]||0)>now;
    if(cmd==='애청지수')return answer(u.name+'님 라디오메이트 애청지수 '+affinityScore(u)+'점\n최근 집계 상승분 +'+(u.affinityLastNotifiedGain||0)+'점\n청취 '+Math.floor((u.listeningMs||0)/60000)+'분 · 채팅 기여 '+(u.chatAffinityPoints||0)+'점\n자체 지수이며 스푼 공식 애청온도와 별개입니다.');
    if(cmd==='내정보')return answer(`${u.name} · Lv.${Math.floor(u.exp/s.levelStep)+1}\n${n(u.exp)} EXP / ${n(u.pt)} PT / 복권 ${n(u.tickets)}장\n${temperatureSummary(u)}\n자체 애청지수 ${affinityScore(u)}점 · 청취 ${Math.floor((u.listeningMs||0)/60000)}분 · 채팅 ${u.chatAffinityPoints||0}점\n다음 레벨까지 ${n(s.levelStep-u.exp%s.levelStep)} EXP`);
    if(cmd==='출석'){
      if(!s.attendance)fail('출석 기능이 꺼져 있습니다.');if(u.attendance===dates(now).day)fail('오늘은 이미 출석했습니다.');
      if(!Number.isSafeInteger(u.tickets+20))fail('복권 보유량이 정확히 처리 가능한 정수 범위를 초과합니다.');
      u.attendance=dates(now).day;u.tickets+=20;u.ticketRevision=(u.ticketRevision||0)+1;this.store.log(r.id,u.id,'attendance',{tickets:20},now);return answer(`${u.name}님 출석! 복권 20장 지급`);
    }
    if(cmd==='복권'){
      const auto=bits.length===1&&bits[0]==='자동';
      if(!auto&&(bits.length!==3||bits.some(x=>!/^\d$/.test(x)||x==='0')||new Set(bits).size!==3))fail('사용법: !복권 자동 또는 !복권 3 6 9 (1~9 중 중복 없는 숫자 3개)');
      if(u.tickets<1)fail('복권이 부족합니다.');
      if(auto&&u.tickets>1){
        const used=u.tickets;if(!Number.isSafeInteger(used))fail('복권 보유 수량을 확인해주세요.');
        if(preparedLottery&&(preparedLottery.count!==used||preparedLottery.ticketRevision!==(u.ticketRevision||0)))fail('추첨 준비 중 복권 수량이 변경되었습니다. 수량은 차감하지 않았으니 다시 입력해주세요.');
        if(used>LOTTERY_CHUNK&&!preparedLottery)fail('대량 복권은 비동기 처리로 실행해주세요.');
        // 등수별 당첨 횟수에 설정한 보상(EXP·PT)을 곱해 총 보상을 계산합니다.
        const counts=preparedLottery?.counts||lotterySummary(used,(min,max)=>this.int(min,max)),{exp,pt}=lotteryPrize(counts,lotteryRewardTable(s));
        if(!Number.isSafeInteger(u.exp+exp))fail('경험치가 정확히 처리 가능한 정수 범위를 초과합니다. 복권은 차감하지 않았습니다.');
        if(!Number.isSafeInteger(u.pt+pt))fail('포인트가 정확히 처리 가능한 정수 범위를 초과합니다. 복권은 차감하지 않았습니다.');
        u.tickets=0;u.ticketRevision=(u.ticketRevision||0)+1;u.exp+=exp;u.pt+=pt;this.store.log(r.id,u.id,'lottery',{auto:true,used,counts,exp,pt,remaining:0},now);
        return answer(`자동 복권 ${n(used)}장 사용 · 1등(3개 일치) ${n(counts[3])}회 / 2등(2개) ${n(counts[2])}회 / 3등(1개) ${n(counts[1])}회 / 꽝 ${n(counts[0])}회 · ${prizeText(exp,pt)} · 남은 복권 0장`);
      }
      if(auto&&preparedLottery&&(preparedLottery.count!==u.tickets||preparedLottery.ticketRevision!==(u.ticketRevision||0)))fail('추첨 준비 중 복권 수량이 변경되었습니다. 다시 입력해주세요.');
      const pick=()=>{const pool=[1,2,3,4,5,6,7,8,9],numbers=[];for(let i=0;i<3;i++)numbers.push(pool.splice(this.int(0,pool.length-1),1)[0]);return numbers;};
      const selected=auto?pick():bits.map(Number),draw=pick();
      // 맞힌 개수(matches)로 등수를 정하고, 설정한 등수별 보상(EXP·PT)을 찾습니다.
      const matches=selected.filter(x=>draw.includes(x)).length,{exp,pt}=lotteryRewardTable(s)[matches];
      if(!Number.isSafeInteger(u.exp+exp))fail('경험치가 정확히 처리 가능한 정수 범위를 초과합니다. 복권은 차감하지 않았습니다.');
      if(!Number.isSafeInteger(u.pt+pt))fail('포인트가 정확히 처리 가능한 정수 범위를 초과합니다. 복권은 차감하지 않았습니다.');
      u.tickets--;u.ticketRevision=(u.ticketRevision||0)+1;u.exp+=exp;u.pt+=pt;
      this.store.log(r.id,u.id,'lottery',{draw,input:selected.map(String),auto,matches,rank:LOTTERY_RANKS[matches],exp,pt,used:1,remaining:u.tickets},now);
      return answer(`${auto?`자동 선택 ${selected.join(' ')} · `:''}당첨 숫자 ${draw.join(' ')} · ${matches}개 일치 · ${matches?`${LOTTERY_RANKS[matches]}! ${prizeText(exp,pt)}`:'꽝'}${auto?` · 1장 사용 · 남은 복권 ${n(u.tickets)}장`:''}`);
    }
    if(cmd==='낚시'){
      if(arg)fail('사용법: !낚시');
      // 결과 맨 앞에 붙일 '누가 잡았는지' 표시입니다. (설정 fishingWho: 닉네임+고유 ID / 닉네임 / 고유 ID / 표시 안 함)
      const fishWho=whoLabel(u,s.fishingWho);
      const exp=Math.min(LIMIT.exp-u.daily.fishExp,s.expPerCast*(active('exp')?2:1));
      if(!Number.isSafeInteger(u.exp+exp))fail('경험치가 정확히 처리 가능한 정수 범위를 초과합니다.');
      u.exp+=exp;u.daily.fishExp+=exp;
      if(this.int(1,10000)<=s.miss*100){this.store.log(r.id,u.id,'fishing-miss',{exp},now);return answer(`${fishWho?fishWho+' · ':''}이번엔 꽝! +${exp} EXP`);}
      let list=s.fish;
      if(active('rare')){const rare=this.int(1,100)<=70;list=list.filter(f=>(f.rarity>=2)===rare);}
      // 행운 보너스: 고급 이상 물고기(황금주사위 제외)의 가중치를 (1 + 행운%)배로 늘려서 뽑습니다.
      const luck=1+s.fishingLuck/100,odds=luck===1?list:list.map(x=>x.rarity>=1&&!x.golden?{...x,weight:x.weight*luck}:x);
      const f=this.weighted(odds),size=this.int(f.minSize,f.maxSize),base=s.payout==='fixed'?f.minPt:this.int(f.minPt,f.maxPt);
      const key=`${f.id}:${f.rarity}`;u.book[key]??={name:f.name,rarity:f.rarity,count:0};u.book[key].count++;
      let die=0,wanted=base,source='fish',paid=0,held=false;
      if(f.golden){die=this.int(1,6);wanted=base*die;if(s.goldenPolicy==='pending')held=true;else if(s.goldenPolicy==='special')source='golden';}
      if(held)r.special.push({id:randomUUID(),user:u.id,name:u.name,fish:f.name,day:dates(now).day,time:now,base,die,amount:wanted,status:'policy-pending'});
      else if(u.daily.fishPt>=LIMIT.fish&&f.rarity===4&&!f.golden)r.special.push({id:randomUUID(),user:u.id,name:u.name,fish:f.name,day:dates(now).day,time:now,amount:0,status:'pending'});
      else paid=this.credit(r,u,wanted,source);
      this.store.log(r.id,u.id,'fishing',{fish:f.name,rarity:f.rarity,size,exp,base,die,paid,held},now);
      return answer(`🎣 ${fishWho?fishWho+' · ':''}${f.name} (${RARITIES[f.rarity]}) ${size}cm\n+${exp} EXP · ${held?`🎲 ${base} × ${die} = ${wanted} PT (정책 미정·보류)`:`${die?`🎲 ${n(base)} × ${die} · `:''}+${n(paid)} PT`}`);
    }
    if(['홀','짝','홀짝'].includes(cmd)){
      let side=cmd,stakeText=arg;if(cmd==='홀짝'){[side,stakeText]=bits;}
      if(!['홀','짝'].includes(side))fail('사용법: !홀 20000 또는 !짝 20000');
      const stake=positive(stakeText,s.betMax);if(stake<s.betMin)fail(`최소 ${n(s.betMin)} PT부터 가능합니다.`);
      if(u.pt<stake)fail('보유 PT가 부족합니다.');
      if(stake>Math.min(LIMIT.odd-u.daily.oddPt,LIMIT.total-u.daily.totalPt))fail('남은 일일 당첨 이익 한도보다 큰 금액은 걸 수 없습니다.');
      u.pt-=stake;const rolled=this.int(1,100)<= (active('odd')?65:50)?'홀':'짝',win=rolled===side;
      if(win){u.pt+=stake;this.credit(r,u,stake,'odd');}
      this.store.log(r.id,u.id,'odd-even',{stake,side,rolled,win},now);return answer(`${rolled}! ${win?`성공 · 원금 포함 ${n(stake*2)} PT 반환`:`실패 · ${n(stake)} PT 차감`} / 잔액 ${n(u.pt)} PT`);
    }
    if(cmd==='낚시정보')return answer(`오늘 낚시 ${n(u.daily.fishExp)}/200,000 EXP · ${n(u.daily.fishPt)}/200,000 PT\n전체 획득 ${n(u.daily.totalPt)}/1,000,000 PT`);
    if(cmd==='도감')return answer(chatPage('도감',Object.values(u.book).map(b=>`${b.name} ×${b.count}`),arg,cmd,'아직 잡은 물고기가 없습니다.'));
    if(cmd==='룰렛'){
      if(arg)fail('사용법: !룰렛');
      if(!s.roulette)fail('룰렛이 꺼져 있습니다. DJ가 보상과 확률을 설정한 뒤 켜 주세요.');
      const reward=this.weighted(s.rouletteRewards);const name=reward.name.trim().normalize('NFC');
      if(reward.miss){u.keepHistory??=[];u.keepHistory.push({id:randomUUID(),text:name,kind:'miss',time:now,actor:u.id});}
      else u.keeps.push(name);
      this.store.log(r.id,u.id,'roulette',{name,miss:reward.miss},now);
      return answer(reward.miss?`${u.name}님 룰렛 결과: ${name} · 보유 킵에는 추가되지 않으며 사용내역에 기록했습니다.`:`${u.name}님 룰렛 당첨: ${name} · 킵에 자동 등록했습니다.`);
    }
    if(cmd==='킵'){
      if(bits[0]==='취소'){
        const selector=keepName(bits.slice(1).join(' '));
        const completed=[...(u.keepHistory||[])].filter(k=>k.kind==='used').reverse();
        const entry=!selector?completed.find(k=>dj||k.actor===u.id):/^[1-9]\d*$/.test(selector)?completed[Number(selector)-1]:completed.find(k=>keepName(k.text)===selector);
        if(!entry)fail('취소할 사용 완료 내역이 없습니다. !킵 완료로 확인하세요.');
        if(!dj&&entry.actor!==u.id)fail('DJ가 처리한 킵은 DJ에게 취소를 요청하세요.');
        if(dates(entry.time).month!==dates(now).month)fail('지난달 사용 내역은 월간 초기화 후 복원할 수 없습니다.');
        entry.kind='cancelled';entry.cancelledAt=now;entry.cancelledBy=u.id;
        u.keeps.push(keepName(entry.text));
        this.store.log(r.id,u.id,'keep-update',{action:'cancel-use',id:entry.id,text:entry.text,actor:u.id,source:'chat'},now);
        return answer(`${u.name}님 킵 사용 취소: ${entry.text}\n보유 킵 목록으로 1개를 돌려놓았습니다. !킵으로 확인하세요.`);
      }
      if(bits[0]==='사용'){
        const selector=keepName(bits.slice(1).join(' '));
        if(!selector)fail('사용법: !킵 사용 번호 또는 !킵 사용 보상명 · !킵으로 내 목록을 확인하세요.');
        const grouped=groupKeeps(u.keeps);
        const selected=/^[1-9]\d*$/.test(selector)?grouped[Number(selector)-1]:grouped.find(k=>k.name===selector);
        if(!selected)fail('내 보유 킵에서 해당 보상을 찾을 수 없습니다. !킵으로 현재 번호를 확인하세요.');
        const index=u.keeps.findIndex(k=>keepName(k)===selected.name);
        u.keeps.splice(index,1);u.keepHistory??=[];
        u.keepHistory.push({id:randomUUID(),text:selected.name,kind:'used',time:now,actor:u.id});
        this.store.log(r.id,u.id,'keep-update',{action:'use',text:selected.name,actor:u.id,source:'chat'},now);
        return answer(`${u.name}님 킵 사용 완료: ${selected.name} · 남은 수량 ${selected.count-1}개\n완료 내역으로 옮겼습니다. !킵 완료 · 되돌리기: !킵 취소`);
      }
      if(bits[0]==='완료')return answer(chatPage('킵 사용 완료', [...(u.keepHistory||[])].filter(k=>k.kind==='used').reverse().map((k,i)=>`${i+1}. ${k.text} · ${new Date(k.time).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'})}`),bits.slice(1).join(' '),'킵 완료','사용 완료한 킵이 없습니다.'));
      const expiry='유효: '+keepExpiryLabel(now);
      return answer(chatPage('보유 킵',u.keeps.length?[expiry,...groupKeeps(u.keeps).map((k,i)=>`${i+1}. ${k.name} ×${k.count}`)]:[],arg,cmd,`${expiry}\n보관 중인 킵이 없습니다.`));
    }
    if(cmd==='가방')return answer(s.items.map(i=>`${i.id}: ${i.name} ×${u.bag[i.id]||0}`).join('\n'));
    if(cmd==='버프')return answer(s.items.filter(i=>(u.buffs[i.id]||0)>now).map(i=>`${i.name}: ${Math.ceil((u.buffs[i.id]-now)/60000)}분 남음${u.buffPaused?.[i.id]!==undefined?' (일시정지)':''}`).join('\n')||'적용 중인 효과가 없습니다.');
    if(cmd==='아이템'){
      const action=bits[0],selector=keepName(bits.slice(1).join(' '));
      const matches=s.items.filter((i,index)=>i.id.toLowerCase()===selector.toLowerCase()||String(index+1)===selector||keepName(i.name)===selector);
      if(matches.length!==1)fail('아이템을 하나만 정확히 지정하세요. 예: !구매 rare / !아이템 구매 1 / !아이템 사용 exp');
      const item=matches[0];
      if(action==='구매'){
        if(!item.enabled)fail('판매 중지 상품입니다.');if(item.stock===0)fail('품절 상품입니다.');if(u.pt<item.price)fail(`포인트가 부족합니다. 필요 ${n(item.price)} PT / 보유 ${n(u.pt)} PT`);
        if(!Number.isSafeInteger((u.bag[item.id]||0)+1))fail('아이템 보유량을 더 늘릴 수 없습니다.');
        u.pt-=item.price;if(item.stock!==null&&item.stock!==undefined){item.stock--;r.settingsRevision=(r.settingsRevision||0)+1;}u.bag[item.id]=(u.bag[item.id]||0)+1;this.store.log(r.id,u.id,'purchase',{item:item.id,price:item.price},now);return answer(`${item.name} 구매 완료 · ${n(item.price)} PT 차감\n잔액 ${n(u.pt)} PT · 가방 ${u.bag[item.id]}개\n사용: !아이템 사용 ${item.id}`);
      }
      if(action==='사용'){
        if(!(u.bag[item.id]>0))fail('보유 아이템이 없습니다.');if(item.id==='odd'?!s.odd:!s.fishing)fail('관련 게임이 꺼져 있습니다.');
        if(item.id==='exp'&&u.daily.fishExp>=LIMIT.exp)fail('오늘 낚시 EXP 한도에 도달했습니다.');
        u.bag[item.id]--;u.buffs[item.id]=Math.max(now,u.buffs[item.id]||0)+20*60000;this.store.log(r.id,u.id,'item-use',{item:item.id,until:u.buffs[item.id]},now);return answer(`${item.name} 20분 적용! 같은 효과는 시간이 연장됩니다.`);
      }
      fail('사용법: !아이템 구매 번호 / !아이템 사용 번호');
    }
    if(cmd==='신청취소'||cmd==='신청곡취소'){
      let index;
      if(!arg){index=r.songs.findLastIndex(x=>x.user===u.id);}
      else{if(!/^[1-9]\d*$/.test(arg)||!Number.isSafeInteger(Number(arg)))fail('사용법: !신청취소 또는 !신청취소 대기열번호');index=Number(arg)-1;}
      const song=r.songs[index];if(!song)fail('취소할 대기 신청곡이 없습니다. 현재 재생 중인 곡은 취소할 수 없습니다.');
      if(song.user!==u.id)fail('본인이 신청한 대기곡만 취소할 수 있습니다.');
      touchQueue(r);r.songs.splice(index,1);this.store.log(r.id,u.id,'song-cancel',{songId:song.id,title:song.title},now);return answer('신청 취소: '+song.title);
    }
    if(cmd==='신청곡'){

      if(!s.requests)fail('신청곡 접수가 닫혀 있습니다.');
      if(!arg||arg.length>500)fail('사용법: !신청곡 YouTube링크 [곡 제목] 또는 가수 - 제목');
      let song;try{song=parseSongRequest(arg);}catch(e){fail(e.message);}
      song.videoId||=savedSongVideo(r,song.title);
      if(song.title.length>150)fail('곡 제목은 150자 이내로 입력하세요.');
      if(r.lastRequester===u.id&&r.streak>=2)fail('연속 신청은 최대 2곡입니다. 다른 분의 신청 후 다시 신청해주세요.');
      if(r.songs.filter(x=>x.user===u.id).length>=s.requestMax)fail('1인당 대기열 한도에 도달했습니다.');
      if(!s.duplicateSongs&&[r.current,...r.songs].some(x=>x&&(x.title.toLowerCase()===song.title.toLowerCase()||song.videoId&&songVideoId(x)===song.videoId)))fail('이미 등록된 곡입니다.');
      if(song.videoId)rememberSongVideo(r,song,song.videoId);
      r.streak=r.lastRequester===u.id?r.streak+1:1;r.lastRequester=u.id;touchQueue(r);r.songs.push({id:randomUUID(),user:u.id,name:u.name,...song});return answer(`신청 완료: ${song.title.slice(0,65)} · 대기 ${r.songs.length}번째. 열린 재생 기기의 자동재생 설정에 따라 순서대로 재생됩니다.${song.videoId?' https://youtu.be/'+song.videoId:''}`);
    }
    return {text:null};
  }
  likeGreeting(roomId,event,{commit=true}={}){
    const now=this.now(),r=this.store.load(roomId),s=r?.settings,user=event.user;
    if(!r||!s.likeGreetingEnabled||s.quiet||!event.id||!user?.id||event.type!=='FREE'||event.combo!==null||!Number.isFinite(event.totalAmount)||event.totalAmount<=0)return {text:null};
    const eventId=`like:${event.id}`;
    if(this.store.db.prepare('SELECT 1 FROM events WHERE room=? AND id=?').get(roomId,eventId))return {text:null};
    const last=r.likeGreetings&&Object.hasOwn(r.likeGreetings,user.id)?r.likeGreetings[user.id]:undefined;if(last!==undefined&&now-last<600000)return {text:null};
    if(now-r.lastResponse<s.responseGap*1000)return {text:null};
    const result={text:s.likeGreeting.replaceAll('{name}',user.nickname||'청취자').replaceAll('{amount}',String(event.totalAmount)),receipt:{id:eventId,user:user.id,time:now}};
    if(commit)this.recordLike(roomId,result.receipt);return result;
  }
  recordLike(roomId,receipt){
    this.store.transaction(roomId,r=>{if(this.store.db.prepare('SELECT 1 FROM events WHERE room=? AND id=?').get(roomId,receipt.id))return;
      r.likeGreetings??={};Object.defineProperty(r.likeGreetings,receipt.user,{value:receipt.time,enumerable:true,writable:true,configurable:true});r.lastResponse=receipt.time;
      this.store.db.prepare('INSERT INTO events VALUES(?,?,?)').run(roomId,receipt.id,JSON.stringify({greeted:true}));
      this.store.log(roomId,receipt.user,'like-greeting',{},receipt.time);
    });
  }
  target(r,target){
    try{return resolveTarget(r.users,target,{identityKey:this.identityKey,room:r.id});}
    catch(error){
      // 아직 프로필이 없어도 최근 채팅·후원으로 본 청취자라면 닉네임 일부만으로 찾아 프로필을 만들어 줍니다.
      if(/일치하는 청취자가 없습니다/u.test(error.message)){const id=this.seenTarget(r,target);if(id!==null)return id;}
      fail(error.message);
    }
  }
  // 최근에 채팅·후원한 청취자 중에서 찾습니다. 한 명으로 정해지면 프로필을 만들어 그 고유 ID를 돌려주고, 아니면 null입니다.
  seenTarget(r,target){
    const pool=Object.entries(r.seen||{}).filter(([id])=>!r.users[id]).map(([id,seen])=>({id,name:seen.name}));
    if(!pool.length)return null;
    try{
      const id=resolveTarget(Object.fromEntries(pool.map(user=>[user.id,user])),target,{}),found=pool.find(user=>user.id===id);
      r.users[id]=freshUser(id,found.name,dates(this.now()).month);
      return id;
    }catch(error){
      // 최근 본 청취자 중에 여러 명이 겹치면 '없다'가 아니라 겹친다는 안내를 그대로 보여 줍니다.
      if(/여러 명과 일치|중복됩니다/u.test(error.message))fail(error.message);
      return null;
    }
  }
  // 채팅·후원으로 본 청취자의 고유 ID와 닉네임을 기억합니다. (프로필이 없어도 !복권지급 닉네임 으로 지급할 수 있도록)
  // 같은 사람은 10분에 한 번만 기록하고, 방당 최근 300명까지만 보관하며, 방 주인(DJ) 본인은 제외합니다.
  noteSeen(roomId,user,now=this.now()){
    const id=user?.id,name=String(user?.nickname||'').trim().slice(0,40);
    if(id===undefined||id===null||String(id)===''||!name||String(id)===String(roomId))return;
    this.seenAt??=new Map();
    const key=roomId+'|'+id,last=this.seenAt.get(key);
    if(last&&now-last<600000)return;
    this.seenAt.set(key,now);if(this.seenAt.size>5000)this.seenAt.delete(this.seenAt.keys().next().value);
    if(!this.store.load(roomId))return;
    this.store.transaction(roomId,r=>{
      r.seen??={};r.seen[String(id)]={name,at:now};
      const ids=Object.keys(r.seen);
      if(ids.length>300)for(const old of ids.sort((a,b)=>r.seen[a].at-r.seen[b].at).slice(0,ids.length-300))delete r.seen[old];
    });
  }
  // 후원 알림 한 건을 처리합니다. 실제 방송(spoon.mjs)과 로컬 테스트의 '모의 후원'이 같은 코드를 써서, 모의 시험이 실제 동작과 같도록 합니다.
  // 순서: 후원 대결 합산 → 감사 인사(메뉴판 문구가 있으면 그 문구) → 후원 레벨·후원자 복권 보상 → 큰 후원 전체 복권.
  // 채팅으로 보낼 메시지 목록([{key,text}])을 돌려줍니다. key는 같은 후원이 다시 들어와도 한 번만 보내기 위한 구별값입니다.
  // id가 없는 후원 알림은 내용 전체(data)로 같은 후원을 구별합니다.
  processDonation(roomId,{id,data}){
    const room=this.store.load(roomId);
    if(!room)return {messages:[],battleCounted:false};
    const s=room.settings,hash=createHash('sha256').update(id||JSON.stringify(data)).digest('hex'),event={id:hash,amount:data.amount,user:data.user},messages=[];
    // 후원 대결 중이면 참가자의 후원 스푼을 합산합니다. (참가 후의 후원만, 같은 후원은 한 번만)
    const battle=this.battleDonationDetail(roomId,event),battleCounted=battle.counted;
    // 후원 금액 10을 메뉴판의 '10' 항목에서 찾고, 없으면 기본 감사 인사를 씁니다. 후원자 이름을 모르면 '청취자'라고 부릅니다.
    const amount=String(data.amount),name=data.user?.nickname||'청취자',reactions=s.donationReactions??{};
    const template=Object.hasOwn(reactions,amount)?reactions[amount]:s.donation;
    if(template)messages.push({key:'donation:'+hash,text:template.replace(/\{name\}|\{amount\}/g,token=>token==='{name}'?name:amount)});
    // 후원 레벨 보상과 후원자 복권은 한 메시지(둘째 줄)로 묶습니다.
    const reward=[this.donationLevelUp(roomId,event).text,this.donationDonorTickets(roomId,event).text].filter(Boolean).join('\n');
    if(reward)messages.push({key:'donation-reward:'+hash,text:reward});
    // 큰 후원이면 등록된 모든 청취자에게 복권을 지급합니다. (설정에서 켠 경우에만)
    const bonus=this.donationTicketsToAll(roomId,event);
    if(bonus.text)messages.push({key:'donation-tickets:'+hash,text:bonus.text});
    // 이 후원으로 팀 대결의 승부가 났다면 결과 발표를 맨 끝에 붙입니다.
    if(battle.ended)messages.push({key:'battle-end:'+battle.ended.id,text:battle.ended.text});
    return {messages,battleCounted,battleEnded:!!battle.ended};
  }
  // 한 번에 기준 스푼 이상 후원한 청취자에게 EXP를 주어 레벨이 오르게 합니다. (설정에서 켠 경우에만 동작합니다.)
  // event: { id: 후원을 구별하는 값, amount: 후원 스푼 수, user: 후원자 { id, nickname } }
  // 받는 EXP = 후원 스푼 수 × 스푼당 EXP. 같은 후원 알림이 다시 들어와도 한 번만 지급하고, 지급했을 때만 안내 문구를 돌려줍니다.
  donationLevelUp(roomId,event){
    const none={text:null};
    const room=this.store.load(roomId),s=room?.settings;
    if(!room||!s.donationExpEnabled)return none;
    const amount=Number(event.amount),uid=event.user?.id;
    // 후원 스푼이 기준보다 적거나, 후원자를 알 수 없으면 아무것도 하지 않습니다.
    if(!event.id||uid===undefined||uid===null||String(uid)===''||!Number.isSafeInteger(amount)||amount<s.donationExpMin)return none;
    const exp=amount*s.donationExpPerSpoon,eventId=`donation-exp:${event.id}`,now=this.now();
    if(!Number.isSafeInteger(exp))return none;
    let result=null;
    try{
      this.store.transaction(roomId,r=>{
        // 이미 처리한 후원이면 다시 지급하지 않습니다.
        if(this.store.db.prepare('SELECT 1 FROM events WHERE room=? AND id=?').get(roomId,eventId))return;
        this.reset(r);
        const id=String(uid),nickname=typeof event.user.nickname==='string'&&event.user.nickname.trim()?event.user.nickname:'';
        // 아직 프로필이 없는 후원자는 프로필을 만들어서 EXP를 받게 합니다.
        let u=r.users[id];
        if(!u){u=freshUser(id,nickname||'청취자',dates(now).month);r.users[id]=u;}
        else if(nickname)u.name=nickname;
        if(!Number.isSafeInteger(u.exp+exp))fail('경험치가 정확히 처리 가능한 정수 범위를 초과합니다.');
        const levelBefore=Math.floor(u.exp/r.settings.levelStep)+1;
        u.exp+=exp;
        const levelAfter=Math.floor(u.exp/r.settings.levelStep)+1;
        this.store.log(roomId,id,'donation-exp',{amount,exp,balance:u.exp,levelBefore,levelAfter},now);
        this.store.db.prepare('INSERT INTO events VALUES(?,?,?)').run(roomId,eventId,JSON.stringify({donationExp:true}));
        result={name:[...u.name].slice(0,20).join(''),levelBefore,levelAfter,toNext:r.settings.levelStep-(u.exp%r.settings.levelStep)};
      });
    }catch(error){
      // 후원 처리 전체를 막지 않도록 기록만 남기고 넘어갑니다.
      this.store.log(roomId,'system','donation-exp-failed',{message:error.message},now);
      return none;
    }
    if(!result)return none;
    const head=`${result.name}님 ${n(amount)}스푼 후원! +${n(exp)} EXP`;
    return {text:result.levelAfter>result.levelBefore?`🆙 ${head} · Lv.${result.levelBefore} → Lv.${result.levelAfter} 레벨 업!`:`✨ ${head} · Lv.${result.levelAfter} (다음 레벨까지 ${n(result.toNext)} EXP)`,exp,levelBefore:result.levelBefore,levelAfter:result.levelAfter};
  }
  // 방송 채팅 답장 대기열에 보내지 못한 메시지가 이미 8개 이상 쌓였는지 확인합니다.
  // 스푼 채팅의 명령은 '응답 간격(기본 3초)' 안에 들어와도 버리지 않고 대기열에 쌓아 간격을 지키며 차례로 보내는데,
  // 한꺼번에 몰려 너무 많이 밀리면(8개 이상) 새 명령은 잠시 무시해 도배를 막습니다.
  replyQueueFull(roomId){
    // 1분이 넘은 오래된 항목은 세지 않습니다. (보내다 멈춘 항목 때문에 새 명령이 계속 막히는 일을 방지)
    return this.store.db.prepare("SELECT COUNT(*) n FROM outbox WHERE room=? AND status IN ('pending','sending') AND created>?").get(roomId,this.now()-60000).n>=8;
  }
  // ── DJ 랭킹 · 넥스트초이스 등급 ──
  // 이 방송 DJ의 일라디(일간)·월라디(월간) 순위와 넥스트초이스 등급을 한 번에 보여 줍니다. (방마다 따로 저장되므로 그 DJ 것만 나옵니다)
  // 등급은 월라디 순위로 자동 계산합니다: 1~10위 Top Choice · 11~110위 Star Choice · 111~410위 Normal Choice · 411위 이후는 선정권 밖.
  // 순서: 일라디 → 월라디 → 이전(지난달) 등급 → 현재 등급 → 다음 등급까지 남은 등수
  djRankReply(r,now){
    const s=r.settings,{day,month}=dates(now),monthLabel=value=>`${Number(String(value).slice(5))}월`;
    const name=[...String(r.name||'방송')].slice(0,20).join('');
    const daily=s.djRankDaily===null?'미등록':`${n(s.djRankDaily)}위${s.djRankDailyDate&&s.djRankDailyDate!==day?`(${s.djRankDailyDate.slice(5)} 기준)`:''}`;
    // 예전 !랭크의 '이번 달 넥스트초이스' 직접 입력 문구가 있으면 월라디 칸에 대신 보여 줍니다.
    const legacy=s.djRankMonthly===null&&s.monthlyRank&&s.monthlyRankMonth===month?s.monthlyRank:null;
    const stale=s.djRankMonthly!==null&&!!s.djRankMonthlyMonth&&s.djRankMonthlyMonth!==month;
    const monthly=s.djRankMonthly!==null?`${n(s.djRankMonthly)}위${stale?`(${monthLabel(s.djRankMonthlyMonth)} 기준)`:''}`:legacy??'미등록';
    const tierName=rank=>rank===null?'미등록':choiceTier(rank)?.name||'선정권 밖';
    const current=s.djRankMonthly===null?'미등록':`${tierName(s.djRankMonthly)}${stale?`(${monthLabel(s.djRankMonthlyMonth)} 기준)`:''}`;
    let next;
    if(s.djRankMonthly===null)next='다음 등급은 월라디 순위를 입력하면 계산해요';
    else if(stale)next='다음 등급까지는 이번 달 월라디 순위를 입력하면 계산해요';
    else{const step=choiceNext(s.djRankMonthly);next=step?`다음 ${step.tier.name}까지 ${n(step.left)}등 남음`:'최고 등급(Top Choice)이에요';}
    return `📻 ${name} 랭킹\n일라디 ${daily} · 월라디 ${monthly}\n초이스 이전 ${tierName(s.djRankPrevMonthly)} → 현재 ${current} → ${next}`;
  }
  // DJ 전용 !랭킹등록: 일라디·월라디·지난달 월라디 순위를 입력합니다. 입력한 값은 설정에 저장되고 !랭킹조회로 보여 줍니다.
  //   !랭킹등록 일 12 · !랭킹등록 월 45 · !랭킹등록 지난달 85 · !랭킹등록 초기화
  registerDjRank(r,bits,now,e){
    const s=r.settings,prev={...s},kind=bits[0];
    const usage='사용법: !랭킹등록 일 12 · !랭킹등록 월 45 · !랭킹등록 지난달 85 · !랭킹등록 초기화 (등급은 월라디 순위로 자동 계산)';
    const num=value=>{const text=String(value);if(!/^\d{1,7}$/.test(text)||Number(text)<1||Number(text)>1000000)fail(usage);return Number(text);};
    if(kind==='초기화'){
      if(bits.length!==1)fail(usage);
      for(const key of ['djRankDaily','djRankMonthly','djRankPrevMonthly'])s[key]=null;
    }else if(['일','일라디','일간'].includes(kind)){
      if(bits.length!==2)fail(usage);s.djRankDaily=num(bits[1]);
    }else if(['월','월라디','월간'].includes(kind)){
      if(bits.length!==2)fail(usage);s.djRankMonthly=num(bits[1]);
    }else if(['지난달','전월','저번달'].includes(kind)){
      if(bits.length!==2)fail(usage);s.djRankPrevMonthly=num(bits[1]);
    }else fail(usage);
    stampDjRank(prev,s,now);
    r.settingsRevision=(r.settingsRevision||0)+1;
    this.store.log(r.id,e.user.id,'dj-rank-update',{kind},now);
    return this.djRankReply(r,now);
  }
  // ── 방송일수·방송시간 집계 (넥스트초이스 활동 기준) ──
  // 봇이 방송에 연결돼 있던 시간만 셉니다. 스푼의 공식 기록이 아니라 참고용입니다.
  // 5분 이상 이어진 방송만 더하고(2분 안에 끊겼다 다시 연결되면 한 방송으로 봄), 방송을 시작한 날(한국 시간) 기준으로 1시간 이상 방송한 날을 1일로 셉니다.
  liveStart(r,now){
    const session=r.liveSession;
    if(session&&(session.open||now-session.last<=120000)){session.open=true;session.touched=now;return;}
    this.liveFlush(r,now,true);
    r.liveSession={start:now,last:now,touched:now,open:true};
  }
  // 방송 연결이 끊기면 세션을 닫습니다. 확인 신호가 오래 끊겼다면(서버 중단 등) 마지막 확인 시각+3분까지만 인정합니다.
  liveEnd(r,now){
    const session=r.liveSession;if(!session?.open)return;
    session.open=false;session.last=Math.min(now,session.touched+180000);
  }
  // 점검 때마다 호출: 진행 중인 방송에 '확인 신호'를 남기고, 닫힌 지 2분이 지난 세션을 집계에 더합니다.
  liveMaintain(r,now){
    const session=r.liveSession;if(!session)return;
    if(session.open&&r.live)session.touched=now;
    else if(session.open&&!r.live)this.liveEnd(r,now);
    this.liveFlush(r,now);
  }
  liveFlush(r,now,force=false){
    const session=r.liveSession;if(!session||session.open)return;
    if(!force&&now-session.last<=120000)return;
    delete r.liveSession;this.addLiveMinutes(r,session.start,session.last);
  }
  // start~end 방송 시간을 달별 집계에 더합니다. 5분 미만은 더하지 않고, 최근 3개월만 보관합니다.
  // 스푼의 집계 기준대로 방송 데이터는 **방송을 시작한 날(한국 시간)**의 기록입니다. 자정을 넘겨 끝나도 시작한 날로 세고,
  // 달을 넘겨도 시작한 달로 셉니다. (예: 1월 31일 23:50 시작 ~ 2월 1일 00:10 종료 → 1월 31일 20분)
  addLiveMinutes(r,start,end){
    if(!(end-start>=300000))return;
    r.liveStats??={};
    const day=dates(start).day,bucket=(r.liveStats[day.slice(0,7)]??={days:{}});
    bucket.days[day]=(bucket.days[day]||0)+(end-start)/60000;
    for(const old of Object.keys(r.liveStats).sort().slice(0,-3))delete r.liveStats[old];
  }
  // 이번 달 집계: 방송일수(하루 60분 이상인 날 수)와 방송 분. 진행 중이거나 아직 정산 전인 세션도 포함해서 계산합니다.
  liveSummary(r,now){
    const month=dates(now).month,temp={liveStats:structuredClone(r.liveStats||{})},session=r.liveSession;
    if(session)this.addLiveMinutes(temp,session.start,session.open?now:session.last);
    const days=temp.liveStats[month]?.days||{},minutes=Object.values(days).reduce((sum,value)=>sum+value,0);
    return {days:Object.values(days).filter(value=>value>=60).length,minutes};
  }
  // !초이스안내: Choice DJ 3단계 티어의 선정 순위·정산 비율·환전 처리일을 한 메시지로 안내합니다. (혜택 목록은 웹 관리 화면에서 확인)
  choiceGuide(){
    return `🏅 Choice DJ 티어 (선정 결과는 매월 1일 오후 6~7시 갱신)\n${CHOICE_TIERS.map(tier=>`${tier.name} ${tier.min}~${tier.max}위 · 정산 ${tier.settle}% · 환전 ${tier.payoutDays}영업일`).join('\n')}`;
  }
  // !초이스: 이번 달 방송일수·시간을 넥스트초이스 등급별 기준(Normal 15일·30시간, Top·Star 20일·45시간)과 비교해 보여 줍니다.
  choiceReport(r,now){
    const sum=this.liveSummary(r,now),hours=(minutes,round)=>`${round(minutes/6)/10}시간`;
    const name=[...String(r.name||'방송')].slice(0,20).join('');
    const left=tier=>{const dayLeft=Math.max(0,tier.days-sum.days),minuteLeft=Math.max(0,tier.hours*60-sum.minutes);return dayLeft===0&&minuteLeft===0?'✅ 달성':`${dayLeft}일·${hours(minuteLeft,Math.ceil)} 남음`;};
    const [top,,normal]=CHOICE_TIERS;
    return `📊 ${name} 이번 달 방송 ${sum.days}일 · ${hours(sum.minutes,Math.floor)}\nNormal Choice(${normal.days}일·${normal.hours}시간) ${left(normal)}\nTop·Star Choice(${top.days}일·${top.hours}시간) ${left(top)}\n※ 봇이 연결된 동안만 집계해 공식 기록과 다를 수 있어요`;
  }
  // ── 후원 대결 ──
  // 대결 상태는 방 데이터의 r.battle에 저장합니다: { id, status:'open', startedAt, endsAt, participants:{ 청취자ID:{ name, joinedAt, total, lastAt } } }
  // 끝난 대결은 r.battle을 지우고 요약만 r.lastBattle에 남깁니다.
  // 후원 스푼이 1 이상인 참가자를 많이 후원한 순서로 정렬합니다. 합계가 같으면 그 합계에 먼저 도달한 사람이 앞섭니다.
  battleRanking(battle){
    return Object.entries(battle.participants).map(([id,p])=>({id,name:p.name,total:p.total,lastAt:p.lastAt,joinedAt:p.joinedAt}))
      .filter(p=>p.total>0).sort((a,b)=>b.total-a.total||a.lastAt-b.lastAt||a.joinedAt-b.joinedAt);
  }
  // 대결을 끝내고 순위별 보상(PT·EXP)을 지급합니다. 후원한 참가자가 2명 미만이면 무효 처리하고 보상은 주지 않습니다.
  finishBattle(r,now){
    // 팀 대결은 팀 결과로 끝냅니다. (직접 종료하면 목표에 먼저 닿은 팀이 없으므로 승부 없음)
    if(r.battle.mode==='team')return this.finishTeamBattle(r,now,null);
    const b=r.battle,s=r.settings,ranking=this.battleRanking(b),participants=Object.keys(b.participants).length;
    delete r.battle;
    const short=name=>[...String(name||'청취자')].slice(0,7).join('');
    if(ranking.length<2){
      r.lastBattle={id:b.id,endedAt:now,participants,void:true,ranking:ranking.map(x=>({id:x.id,name:x.name,total:x.total}))};
      this.store.log(r.id,'system','battle-result',{battle:b.id,participants,void:true},now);
      return {id:b.id,text:'⚔️ 후원 대결 종료 · 후원한 참가자가 2명 미만이라 무효예요 (보상 없음)'};
    }
    const rewards=[[s.battleFirstPt,s.battleFirstExp],[s.battleSecondPt,s.battleSecondExp],[s.battleThirdPt,s.battleThirdExp]];
    const parts=ranking.slice(0,3).map((entry,i)=>{
      const u=r.users[entry.id];let [pt,exp]=rewards[i];
      // 보유량이 정수 범위를 넘는 경우에는 그 사람의 보상만 건너뜁니다.
      if(!u||!Number.isSafeInteger(u.pt+pt)||!Number.isSafeInteger(u.exp+exp)){pt=0;exp=0;}else{u.pt+=pt;u.exp+=exp;}
      this.store.log(r.id,entry.id,'battle',{battle:b.id,rank:i+1,total:entry.total,pt,exp},now);
      const prize=`${pt>0?`+${n(pt)}PT`:''}${exp>0?`+${n(exp)}EXP`:''}`;
      return `${i+1}등 ${short(entry.name)} ${n(entry.total)}스푼${prize?' '+prize:''}`;
    });
    r.lastBattle={id:b.id,endedAt:now,participants,ranking:ranking.slice(0,3).map(x=>({id:x.id,name:x.name,total:x.total}))};
    this.store.log(r.id,'system','battle-result',{battle:b.id,participants,winners:ranking.slice(0,3).map(x=>x.id)},now);
    // 실제 스푼 선물은 봇이 옮길 수 없으므로 안내만 합니다. (수량이 0이면 안내하지 않습니다)
    const gift=s.battleGiftSpoons>0?`\n🎁 선물 약속: 1등 외 참가자는 1등에게 ${n(s.battleGiftSpoons)}스푼 (직접 전달)`:'';
    return {id:b.id,text:`🏆 대결 결과 ${parts.join(' · ')}${gift}`,winners:ranking.slice(0,3).map(x=>x.id)};
  }
  // ── 팀 대결(청팀·백팀) ──
  // 팀별 후원 스푼 합계와 인원수. participants의 team 값('blue'=청팀, 'white'=백팀)으로 셉니다.
  teamStats(battle){
    const stats={blue:{total:0,count:0},white:{total:0,count:0}};
    for(const member of Object.values(battle.participants)){const side=stats[member.team];if(side){side.total+=member.total;side.count++;}}
    return stats;
  }
  // 팀 대결을 끝냅니다. winner가 'blue'·'white'이면 그 팀이 먼저 목표 스푼에 닿은 것이고, null이면 승부 없음입니다.
  // 승리 팀에서 후원한 참가자에게는 1등 보상(PT·EXP)을 주고, 진 팀이 이긴 팀에 줄 스푼은 봇이 옮길 수 없어 '선물 약속' 안내만 합니다.
  finishTeamBattle(r,now,winner){
    const b=r.battle,s=r.settings,stats=this.teamStats(b),label={blue:'청팀',white:'백팀'};
    delete r.battle;
    const participants=Object.keys(b.participants).length;
    r.lastBattle={id:b.id,mode:'team',endedAt:now,participants,target:b.target,winner,blue:stats.blue.total,white:stats.white.total};
    if(!winner){
      this.store.log(r.id,'system','battle-result',{battle:b.id,mode:'team',participants,winner:null,blue:stats.blue.total,white:stats.white.total},now);
      return {id:b.id,text:`⚔️ 팀 대결 종료 · ${n(b.target)}스푼에 먼저 닿은 팀이 없어요 (청팀 ${n(stats.blue.total)} · 백팀 ${n(stats.white.total)}) · 보상 없음`};
    }
    let rewarded=0;
    for(const [id,member] of Object.entries(b.participants)){
      if(member.team!==winner||member.total<1)continue;
      const u=r.users[id];let pt=s.battleFirstPt,exp=s.battleFirstExp;
      // 보유량이 정수 범위를 넘는 경우에는 그 사람의 보상만 건너뜁니다.
      if(!u||!Number.isSafeInteger(u.pt+pt)||!Number.isSafeInteger(u.exp+exp)){pt=0;exp=0;}else{u.pt+=pt;u.exp+=exp;}
      this.store.log(r.id,id,'battle',{battle:b.id,mode:'team',team:winner,rank:1,total:member.total,pt,exp},now);
      rewarded++;
    }
    this.store.log(r.id,'system','battle-result',{battle:b.id,mode:'team',participants,winner,blue:stats.blue.total,white:stats.white.total,rewarded},now);
    const prize=`${s.battleFirstPt>0?`+${n(s.battleFirstPt)}PT`:''}${s.battleFirstExp>0?`+${n(s.battleFirstExp)}EXP`:''}`;
    const reward=rewarded&&prize?`\n승리 팀 후원자 ${n(rewarded)}명 ${prize}`:'';
    const gift=s.battleTeamGiftSpoons>0?`\n🎁 선물 약속: 진 팀이 이긴 팀에 ${n(s.battleTeamGiftSpoons)}스푼 (직접 전달·이긴 팀끼리 나눠 가져요)`:'';
    return {id:b.id,text:`🏆 ${label[winner]} 승리! 먼저 ${n(b.target)}스푼 달성 (청팀 ${n(stats.blue.total)} · 백팀 ${n(stats.white.total)})${reward}${gift}`,winner};
  }
  // 시간이 다 된 대결을 끝냅니다. (스케줄 점검에서 주기적으로 호출합니다) 끝낸 경우 결과를, 아니면 null을 돌려줍니다.
  battleTick(r,now){
    if(r.battle?.status==='open'&&now>=r.battle.endsAt)return this.finishBattle(r,now);
    return null;
  }
  // 후원 알림이 들어오면, 후원자가 진행 중인 대결의 참가자일 때만 후원 스푼을 합산합니다.
  // 참가한 뒤의 후원만 합산하고, 같은 후원 알림은 한 번만 반영합니다. 합산했으면 true를 돌려줍니다.
  battleDonation(roomId,event){return this.battleDonationDetail(roomId,event).counted;}
  // 합산했는지(counted)와, 이 후원으로 팀 대결이 끝났다면 그 결과(ended)를 함께 돌려줍니다.
  // 팀 대결은 팀 합계가 목표 스푼 이상이 되고 양 팀에 1명 이상 있을 때 그 팀이 바로 이깁니다.
  battleDonationDetail(roomId,event){
    const none={counted:false,ended:null};
    const room=this.store.load(roomId);
    if(!room||!room.settings.battleEnabled||room.battle?.status!=='open')return none;
    const amount=Number(event.amount),uid=event.user?.id;
    if(!event.id||uid===undefined||uid===null||String(uid)===''||!Number.isSafeInteger(amount)||amount<1)return none;
    const eventId=`battle-donation:${event.id}`,now=this.now();
    let counted=false,ended=null;
    this.store.transaction(roomId,r=>{
      const b=r.battle;
      if(!b||b.status!=='open'||now>=b.endsAt)return;
      const p=b.participants[String(uid)];
      if(!p||this.store.db.prepare('SELECT 1 FROM events WHERE room=? AND id=?').get(roomId,eventId)||!Number.isSafeInteger(p.total+amount))return;
      p.total+=amount;p.lastAt=now;p.donations=(p.donations||0)+1;
      this.store.db.prepare('INSERT INTO events VALUES(?,?,?)').run(roomId,eventId,JSON.stringify({battleDonation:true}));
      counted=true;
      if(b.mode==='team'){
        const stats=this.teamStats(b);
        if(stats[p.team].total>=b.target&&stats.blue.count>0&&stats.white.count>0)ended=this.finishTeamBattle(r,now,p.team);
      }
    });
    return {counted,ended};
  }
  // '!대결' 명령 처리
  //  - 팀 대결(기본): DJ가 !대결 시작 [분] [목표스푼]으로 열고, 청취자가 !대결 청 / !대결 백으로 팀을 골라 참가합니다.
  //    참가한 뒤 DJ에게 후원한 스푼이 팀 합계에 더해지고, 목표 스푼(기본 100)에 먼저 닿은 팀이 이깁니다.
  //  - 개인 대결: !대결 개인 시작 [분]으로 열고, 참가는 !대결, 후원 합계가 큰 순서로 1·2·3등을 정합니다.
  //  - !대결 현황은 누구나, !대결 종료·취소는 DJ 전용입니다.
  battleCommand(r,e,bits,dj,now,answer){
    const s=r.settings;
    let sub=bits[0]||'',solo=false;
    // '!대결 개인 시작 5'처럼 앞에 '개인'이 붙으면 개인 대결 명령으로 봅니다.
    if(sub==='개인'){solo=true;bits=bits.slice(1);sub=bits[0]||'';}
    if(!s.battleEnabled)fail('후원 대결이 꺼져 있습니다. DJ 관리 화면의 게임 설정에서 켤 수 있어요.');
    const short=name=>[...String(name||'청취자')].slice(0,7).join('');
    const left=b=>`${Math.max(1,Math.ceil((b.endsAt-now)/60000))}분`;
    const labels={blue:'청팀',white:'백팀'};
    // 팀 이름 낱말을 청팀('blue')·백팀('white')으로 바꿉니다. 모르는 낱말이면 null입니다.
    const teamOf=word=>{const w=String(word||'').replace(/팀$/u,'').toLowerCase();return ['청','파랑','파란','블루','blue'].includes(w)?'blue':['백','흰','하양','화이트','white'].includes(w)?'white':null;};
    // 시간이 지났지만 아직 종료 처리되지 않은 대결은 곧 끝나므로 참가·후원을 받지 않습니다.
    const open=r.battle?.status==='open'&&now<r.battle.endsAt?r.battle:null;
    const usage='사용법: !대결 청 / !대결 백 (팀 선택) · !대결 현황 · DJ: !대결 시작 5 · !대결 종료 · !대결 취소 · !대결 개인 시작 5';
    if(['시작','종료','취소'].includes(sub)){
      if(!dj)fail('대결 시작·종료·취소는 DJ 전용입니다.');
      if(sub==='시작'){
        if(r.battle?.status==='open')fail('이미 진행 중인 대결이 있어요. !대결 종료 또는 !대결 취소 후 다시 시작하세요.');
        const minutes=bits[1]===undefined?s.battleMinutes:Number(bits[1]);
        if(!Number.isSafeInteger(minutes)||minutes<1||minutes>120)fail(`사용법: !대결 시작 5 (1~120분, 분을 생략하면 설정값 ${s.battleMinutes}분) · 목표 스푼: !대결 시작 5 100`);
        if(solo){
          r.battle={id:`battle-${now}`,status:'open',mode:'solo',startedAt:now,endsAt:now+minutes*60000,participants:{}};
          this.store.log(r.id,e.user.id,'battle-start',{minutes,mode:'solo'},now);
          return answer(`⚔️ 후원 대결 시작! ${minutes}분 · 참가는 !대결 · 참가 후 DJ에게 후원한 스푼 합계로 1·2·3등을 정해요`);
        }
        const target=bits[2]===undefined?s.battleTargetSpoons:Number(bits[2]);
        if(!Number.isSafeInteger(target)||target<1||target>1000000)fail(`목표 스푼은 1~1,000,000 사이의 정수로 입력하세요. 예: !대결 시작 5 100 (생략하면 설정값 ${n(s.battleTargetSpoons)}스푼)`);
        r.battle={id:`battle-${now}`,status:'open',mode:'team',startedAt:now,endsAt:now+minutes*60000,target,participants:{}};
        this.store.log(r.id,e.user.id,'battle-start',{minutes,mode:'team',target},now);
        return answer(`⚔️ 청팀 vs 백팀 대결 시작! ${n(target)}스푼을 먼저 모으는 팀이 승리 · ${minutes}분 · 팀 선택: !대결 청 / !대결 백`);
      }
      if(r.battle?.status!=='open')fail('진행 중인 대결이 없습니다.');
      if(sub==='취소'){
        this.store.log(r.id,e.user.id,'battle-cancel',{battle:r.battle.id},now);
        delete r.battle;
        return answer('⚔️ 후원 대결을 취소했어요. 보상은 지급하지 않습니다.');
      }
      return answer(this.finishBattle(r,now).text);
    }
    // 현황: 진행 중이면 현재 상황, 아니면 마지막 대결 결과를 보여 줍니다. DJ가 !대결만 입력해도 현황을 보여 줍니다.
    if(sub==='현황'||sub==='순위'||(dj&&!sub)){
      if(!open){
        const last=r.lastBattle;
        if(r.battle?.status==='open')return answer('⚔️ 대결 시간이 끝나 곧 결과를 발표해요.');
        if(!last)return answer('⚔️ 진행 중인 대결이 없어요. DJ가 !대결 시작으로 열 수 있어요.');
        if(last.mode==='team')return answer(`⚔️ 진행 중인 대결이 없어요 · 지난 팀 대결 ${last.winner?`${labels[last.winner]} 승리`:'승부 없음'} (청팀 ${n(last.blue)} · 백팀 ${n(last.white)} / 목표 ${n(last.target)}스푼)`);
        return answer(`⚔️ 진행 중인 대결이 없어요 · 지난 대결 ${last.void?'무효':last.ranking.map((x,i)=>`${i+1}등 ${short(x.name)} ${n(x.total)}스푼`).join(' · ')}`);
      }
      if(open.mode==='team'){
        const st=this.teamStats(open);
        return answer(`⚔️ 팀 대결 진행 중 · 청팀 ${n(st.blue.total)}/${n(open.target)}스푼(${n(st.blue.count)}명) vs 백팀 ${n(st.white.total)}/${n(open.target)}스푼(${n(st.white.count)}명) · 남은 ${left(open)}`);
      }
      const ranking=this.battleRanking(open),count=Object.keys(open.participants).length;
      return answer(`⚔️ 대결 진행 중 · 남은 ${left(open)} · 참가 ${n(count)}명${ranking.length?' · '+ranking.slice(0,3).map((x,i)=>`${i+1}위 ${short(x.name)} ${n(x.total)}스푼`).join(' / '):' · 아직 후원 없음'}`);
    }
    const team=teamOf(sub);
    if(sub&&!team)fail(usage);
    // 참가: 프로필이 없으면 만들고, 한 사람은 한 번만 참가합니다. DJ는 참가할 수 없습니다.
    if(!open)fail(r.battle?.status==='open'?'대결 시간이 끝나 곧 결과를 발표해요.':'진행 중인 대결이 없어요. DJ가 !대결 시작으로 열 수 있어요.');
    if(dj&&team)fail('DJ는 대결에 참가할 수 없어요. !대결 현황으로 확인하세요.');
    const id=String(e.user.id);
    let u=r.users[id];
    if(!u){u=freshUser(id,e.user.nickname||'청취자',dates(now).month);r.users[id]=u;}
    const joined=open.participants[id];
    if(open.mode==='team'){
      if(solo)fail('이번 대결은 팀전이에요. !대결 청 / !대결 백으로 팀을 골라 주세요.');
      if(!team)return answer('⚔️ 팀 대결에 참가하려면 !대결 청 또는 !대결 백으로 팀을 골라 주세요.');
      if(joined){
        if(joined.team===team)return answer(`${short(u.name)}님은 이미 ${labels[team]}이에요 · 현재 ${n(joined.total)}스푼`);
        if(joined.total>0)fail('이미 후원한 뒤에는 팀을 바꿀 수 없어요.');
        joined.team=team; // 아직 후원하지 않았다면 팀을 바꿀 수 있습니다.
      }else{
        if(Object.keys(open.participants).length>=100)fail('참가자가 가득 찼어요. (최대 100명)');
        open.participants[id]={name:u.name,joinedAt:now,total:0,lastAt:0,team};
      }
      const st=this.teamStats(open);
      // 한 팀이 혼자 목표를 넘겨 둔 상태에서 상대 팀에 첫 참가자가 생기면 바로 승부가 납니다.
      const winner=st.blue.count>0&&st.white.count>0?['blue','white'].find(side=>st[side].total>=open.target):null;
      if(winner)return answer(this.finishTeamBattle(r,now,winner).text);
      return answer(`⚔️ ${short(u.name)}님 ${labels[team]} 참가! 청팀 ${n(st.blue.count)}명 · 백팀 ${n(st.white.count)}명 · ${n(open.target)}스푼 먼저 모으는 팀 승리 · 남은 ${left(open)}`);
    }
    if(team)fail('이번 대결은 개인전이에요. !대결 로 참가하세요.');
    if(joined)return answer(`${short(u.name)}님은 이미 참가 중이에요 · 현재 ${n(joined.total)}스푼`);
    if(Object.keys(open.participants).length>=100)fail('참가자가 가득 찼어요. (최대 100명)');
    open.participants[id]={name:u.name,joinedAt:now,total:0,lastAt:0};
    return answer(`⚔️ ${short(u.name)}님 대결 참가! (참가 ${n(Object.keys(open.participants).length)}명) 지금부터 DJ에게 후원한 스푼이 합산돼요 · 남은 ${left(open)}`);
  }
  // 한 번에 기준 스푼(기본 10) 이상 후원한 '후원자 본인'에게 복권을 지급합니다. (설정에서 켠 경우에만 동작합니다.)
  // event: { id: 후원을 구별하는 값, amount: 후원 스푼 수, user: 후원자 { id, nickname } }
  // 같은 후원 알림이 다시 들어와도 한 번만 지급하고, 지급했을 때만 안내 문구를 돌려줍니다.
  donationDonorTickets(roomId,event){
    const none={text:null};
    const room=this.store.load(roomId),s=room?.settings;
    if(!room||!s.donationDonorTicketEnabled)return none;
    const amount=Number(event.amount),uid=event.user?.id;
    // 후원 스푼이 기준보다 적거나, 후원자를 알 수 없으면 아무것도 하지 않습니다.
    // '후원할 때마다' 지급이 켜져 있으면 1스푼 후원도 대상이고, 꺼져 있으면 기준 스푼 이상일 때만 지급합니다.
    const minimum=s.donationDonorTicketEvery?1:s.donationDonorTicketMin;
    if(!event.id||uid===undefined||uid===null||String(uid)===''||!Number.isSafeInteger(amount)||amount<minimum)return none;
    const count=s.donationDonorTicketCount,eventId=`donation-donor-ticket:${event.id}`,now=this.now();
    let result=null;
    try{
      this.store.transaction(roomId,r=>{
        // 이미 처리한 후원이면 다시 지급하지 않습니다.
        if(this.store.db.prepare('SELECT 1 FROM events WHERE room=? AND id=?').get(roomId,eventId))return;
        this.reset(r);
        const id=String(uid),nickname=typeof event.user.nickname==='string'&&event.user.nickname.trim()?event.user.nickname:'';
        // 아직 프로필이 없는 후원자는 프로필을 만들어서 복권을 받게 합니다.
        let u=r.users[id];
        if(!u){u=freshUser(id,nickname||'청취자',dates(now).month);r.users[id]=u;}
        else if(nickname)u.name=nickname;
        if(!Number.isSafeInteger(u.tickets+count))fail('복권 보유량이 처리 가능한 범위를 초과합니다.');
        u.tickets+=count;u.ticketRevision=(u.ticketRevision||0)+1;
        this.store.log(roomId,id,'ticket-grant',{count,balance:u.tickets,source:'donation',donor:true,amount},now);
        this.store.db.prepare('INSERT INTO events VALUES(?,?,?)').run(roomId,eventId,JSON.stringify({donationDonorTicket:true}));
        result={name:[...u.name].slice(0,20).join(''),balance:u.tickets};
      });
    }catch(error){
      // 후원 처리 전체를 막지 않도록 기록만 남기고 넘어갑니다.
      this.store.log(roomId,'system','donation-donor-ticket-failed',{message:error.message},now);
      return none;
    }
    if(!result)return none;
    return {text:`🎟️ ${result.name}님 ${n(amount)}스푼 후원! 복권 ${n(count)}장 지급 (보유 ${n(result.balance)}장)`,count,balance:result.balance};
  }
  // 큰 후원이 들어오면 등록된 모든 청취자에게 복권을 지급합니다. (설정에서 켠 경우에만 동작합니다.)
  // event: { id: 후원을 구별하는 값, amount: 후원 스푼 수, user: 후원자 }
  // 같은 후원 알림이 다시 들어와도 한 번만 지급하고, 지급했을 때만 채팅에 보낼 안내 문구를 돌려줍니다.
  donationTicketsToAll(roomId,event){
    const none={text:null};
    const room=this.store.load(roomId),s=room?.settings;
    if(!room||!s.donationTicketEnabled)return none;
    const amount=Number(event.amount);
    // 후원 스푼이 기준보다 적으면 아무것도 하지 않습니다.
    if(!event.id||!Number.isSafeInteger(amount)||amount<s.donationTicketMin)return none;
    const eventId=`donation-tickets:${event.id}`,count=s.donationTicketCount;
    let people=0;
    try{
      this.store.transaction(roomId,r=>{
        // 이미 처리한 후원이면 다시 지급하지 않습니다.
        if(this.store.db.prepare('SELECT 1 FROM events WHERE room=? AND id=?').get(roomId,eventId))return;
        people=this.grantTicketsToAll(r,count,user=>this.store.log(roomId,user.id,'ticket-grant',{count,balance:user.tickets,all:true,source:'donation',amount},this.now()));
        // 지급이 끝난 뒤에 '처리함' 표시를 남깁니다. 지급 중 오류가 나면 표시도 지급도 모두 취소됩니다.
        this.store.db.prepare('INSERT INTO events VALUES(?,?,?)').run(roomId,eventId,JSON.stringify({donationTickets:true}));
      });
    }catch(error){
      // 청취자가 없거나 보유 한도를 넘는 경우 등: 후원 처리 전체를 막지 않도록 기록만 남기고 넘어갑니다.
      this.store.log(roomId,'system','donation-tickets-failed',{message:error.message},this.now());
      return none;
    }
    if(!people)return none;
    const name=[...String(event.user?.nickname||'청취자')].slice(0,20).join('');
    return {text:`🎉 ${name}님의 ${n(amount)}스푼 후원! 모든 청취자 ${n(people)}명에게 복권 ${n(count)}장씩 지급했어요 🎟️`,people};
  }
  // 방에 등록된 모든 청취자에게 복권을 같은 수만큼 지급합니다. (채팅 명령과 웹 관리 화면이 함께 사용합니다.)
  // - count: 한 사람에게 줄 복권 수. 실수 방지를 위해 1~1,000장의 양의 정수만 허용합니다(회수는 지원하지 않습니다).
  // - record: 지급이 끝난 청취자마다 한 번씩 호출됩니다. 호출한 쪽이 자기 방식으로 기록(로그)을 남기는 데 씁니다.
  // 한 명이라도 보유량 한도를 넘으면 아무에게도 지급하지 않고 오류를 냅니다. 지급한 인원 수를 돌려줍니다.
  grantTicketsToAll(r,count,record){
    if(!Number.isSafeInteger(count)||count<1||count>ALL_TICKET_GRANT_MAX)fail(`전체 지급은 1~${n(ALL_TICKET_GRANT_MAX)}장 사이의 양의 정수만 가능합니다.`);
    // 달이 바뀌었으면 월간 초기화를 먼저 반영해야 지급한 복권이 바로 사라지지 않습니다.
    this.reset(r);
    const users=Object.values(r.users);
    if(!users.length)fail('지급할 청취자가 없습니다. 청취자가 !내정보를 입력하면 등록됩니다.');
    if(users.some(user=>!Number.isSafeInteger(user.tickets+count)))fail('복권 보유량이 처리 가능한 범위를 넘는 청취자가 있어 아무에게도 지급하지 않았습니다.');
    for(const user of users){
      user.tickets+=count;
      user.ticketRevision=(user.ticketRevision||0)+1;
      record(user);
    }
    return users.length;
  }
}
// 전체 지급 때 한 사람에게 줄 수 있는 복권 수의 상한입니다. (한 번에 너무 많이 주는 실수를 막습니다.)
const ALL_TICKET_GRANT_MAX=1000;
class RuleError extends Error {}
function fail(message){throw new RuleError(message);}
// 낚시 결과에 붙일 '누가 잡았는지' 표시를 만듭니다. 닉네임은 길면 14자까지만 보여 줍니다.
// mode: 'both' → 닉네임(@고유ID) / 'nickname' → 닉네임 / 'id' → @고유ID / 'off' → 표시 안 함(빈 글자)
function whoLabel(u,mode='both'){
  const nickname=[...String(u.name||'청취자')].slice(0,14).join('');
  if(mode==='off')return '';
  if(mode==='nickname')return nickname;
  if(mode==='id')return `@${u.id}`;
  return `${nickname}(@${u.id})`;
}
// 복권 보상 안내 문구입니다. 예: '+300 EXP +300 PT' / EXP·PT 모두 0이면 '보상 없음'
function prizeText(exp,pt){
  const parts=[];
  if(exp>0)parts.push(`+${n(exp)} EXP`);
  if(pt>0)parts.push(`+${n(pt)} PT`);
  return parts.join(' ')||'보상 없음';
}
function positive(text,max){if(!/^[1-9]\d*$/.test(String(text)))fail('양의 정수를 입력해주세요.');const v=Number(text);if(!Number.isSafeInteger(v)||v>max)fail(`최대 ${n(max)}까지 가능합니다.`);return v;}

