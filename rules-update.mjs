import {defaultQuizQuestions} from './quiz.mjs';
export const RULES_VERSION=4;
const oldDefaults=new Map([
 ['capital',['대한민국의 수도는 어디일까요?',['서울','서울특별시']]],['week',['일주일은 모두 며칠일까요?',['7','7일','칠일']]],['planet',['우리가 살고 있는 행성의 이름은?',['지구']]],['triangle',['삼각형의 변은 몇 개일까요?',['3','3개','세개']]],['hour',['한 시간은 몇 분일까요?',['60','60분','육십분']]],['rainbow',['흔히 무지개를 몇 가지 색으로 표현할까요?',['7','7가지','7색','일곱가지']]],['seasons',['봄 다음에 오는 계절은 무엇일까요?',['여름']]],['hangeul',['한글을 창제한 조선의 왕은 누구일까요?',['세종','세종대왕']]],['sum',['12와 8을 더하면 얼마일까요?',['20','이십']]],['freeze',['표준 대기압에서 순수한 물이 어는 온도는 섭씨 몇 도일까요?',['0','0도','영도']]]
]);
export function updateRequestedRules(room){
 if((room.rulesVersion||0)>=RULES_VERSION)return false;
 const settings=room.settings,existing=(settings.quizQuestions||[]).filter(question=>question.category||question.meaning||JSON.stringify(oldDefaults.get(question.id))!==JSON.stringify([question.question,question.answers])),ids=new Set(existing.map(question=>question.id)),newQuestions=defaultQuizQuestions().filter(question=>!ids.has(question.id));
 Object.assign(settings,{listenRewards:true,listenMinutes:5,listenTickets:1,listenDailyCap:100,quizMinutes:30,quizTickets:1,quizExpChance:50});
 if(settings.spoonNotice==='스푼을 더 할인된 금액으로 저렴하게 충전할 수 있습니다.')settings.spoonNotice='공식 웹 충전은 결제 방식에 따라 더 저렴할 수 있습니다.';
 settings.quizQuestions=[...newQuestions.slice(0,Math.max(0,100-existing.length)),...existing].slice(0,100);
 room.rulesVersion=RULES_VERSION;room.settingsRevision=(room.settingsRevision||0)+1;return true;
}
