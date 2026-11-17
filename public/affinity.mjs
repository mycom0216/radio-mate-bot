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
