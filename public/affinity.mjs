export const affinityScore=user=>Math.floor((user.listeningMs||0)/60000)+(user.chatAffinityPoints||0);
export function creditChat(room,user,now){
 if(!room.live||!user)return false;const hour=Math.floor(now/3600000);
 if(user.chatAffinityHour===hour)return false;
 user.chatAffinityHour=hour;user.chatAffinityPoints=(user.chatAffinityPoints||0)+5;return true;
}
export const affinityRank=users=>Object.values(users).sort((a,b)=>affinityScore(b)-affinityScore(a)||b.exp-a.exp||a.id.localeCompare(b.id));
export function collectAffinityNotices(room,now){
 if(!room.live||room.settings.quiet||!room.settings.affinityNotices)return [];
 const notices=[];
 for(const id of Object.keys(room.listenerSnapshot||{})){
  const user=room.users[id];if(!user)continue;const total=affinityScore(user);
  if(!Number.isFinite(user.affinityNoticeAt)){user.affinityNoticeAt=now;user.affinityNoticeScore=total;continue;}
  if(now-user.affinityNoticeAt<300000||total<=(user.affinityNoticeScore||0))continue;
  const gain=total-(user.affinityNoticeScore||0);
  user.affinityNoticeAt=now;user.affinityNoticeScore=total;user.affinityLastNotifiedGain=gain;
  notices.push({user:id,name:user.name,gain,total});
 }
 return notices;
}

export function temperatureEvent(data,receivedAt=Date.now()){
 if(data?.type!=='JOIN'||typeof data.user?.id!=='string'||!data.user.id||data.user.id.length>100||!Object.hasOwn(data,'favoriteTemperature'))return null;
 const value=data.favoriteTemperature;if(value!==null&&(typeof value!=='number'||!Number.isFinite(value)||value<0))return null;
 const observedAt=Date.parse(data.time);if(!Number.isFinite(observedAt)||!Number.isFinite(receivedAt))return null;
 return {value,observedAt,receivedAt};
}
export function officialTemperature(user){
 const data=user?.spoonTemperature;if(!data||!Number.isFinite(data.observedAt)||!Number.isFinite(data.receivedAt)||!Number.isFinite(new Date(data.receivedAt).getTime()))return null;
 if(data.value!==null&&(typeof data.value!=='number'||!Number.isFinite(data.value)||data.value<0))return null;
 return data;
}
export function temperatureLabel(user){const data=officialTemperature(user);return !data?'미수신':data.value===null?'스푼 미제공':String(data.value)+'°';}
export function temperatureReceivedTime(user){const data=officialTemperature(user);return data?new Date(data.receivedAt).toLocaleString('ko-KR',{timeZone:'Asia/Seoul',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}):'';}
export function temperatureSummary(user){const data=officialTemperature(user);return '스푼 애청온도 '+temperatureLabel(user)+(data?' · 수신 '+temperatureReceivedTime(user)+' (입장값)':'');}
export function temperatureRank(users){
 const value=user=>{const data=officialTemperature(user);return data?.value??-Infinity;};
 return Object.values(users).sort((a,b)=>{const av=value(a),bv=value(b);return av===bv?a.id.localeCompare(b.id):av>bv?-1:1;});
}
