// A DJ can opt into the operating profile without losing their previous settings.
const fields=['attendance','requests','listenRewards','listenMinutes','listenTickets','listenDailyCap','affinityNotices','quiz','autoQuizEnabled','autoQuizMinutes','introEnabled','likeGreetingEnabled'];
export function setAutomation(room,enabled,now=Date.now()){
 if(typeof enabled!=='boolean')throw Error('자동 운영 ON/OFF를 확인해주세요.');
 if(enabled){if(room.automation?.enabled)return false;room.automation={enabled:true,previous:Object.fromEntries(fields.map(key=>[key,room.settings[key]])),enabledAt:now};
  Object.assign(room.settings,{attendance:true,requests:true,listenRewards:true,listenMinutes:5,listenTickets:1,listenDailyCap:100,affinityNotices:true,introEnabled:true,likeGreetingEnabled:true});
  if(room.settings.quizQuestions?.length){room.settings.quiz=true;room.settings.autoQuizEnabled=true;room.settings.autoQuizMinutes=10;room.autoQuizDueAt=now;}room.automation.applied=Object.fromEntries(fields.map(key=>[key,room.settings[key]]));
 }else{if(!room.automation?.enabled)return false;for(const [key,value]of Object.entries(room.automation.previous||{}))if(fields.includes(key)&&value!==undefined&&room.settings[key]===room.automation.applied?.[key])room.settings[key]=value;room.automation={enabled:false,disabledAt:now};delete room.autoQuizDueAt;delete room.autoQuizPending;delete room.autoQuizRound;}
 room.settingsRevision=(room.settingsRevision||0)+1;return true;
}
