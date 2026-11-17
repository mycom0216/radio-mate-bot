export const affinityScore=user=>Math.floor((user.listeningMs||0)/60000)+(user.chatAffinityPoints||0);
export function creditChat(room,user,now){
 if(!room.live||!user)return false;const hour=Math.floor(now/3600000);
 if(user.chatAffinityHour===hour)return false;
 user.chatAffinityHour=hour;user.chatAffinityPoints=(user.chatAffinityPoints||0)+5;return true;
}
export const affinityRank=users=>Object.values(users).sort((a,b)=>affinityScore(b)-affinityScore(a)||b.exp-a.exp||a.id.localeCompare(b.id));
