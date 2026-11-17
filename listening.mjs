// Consecutive listener snapshots estimate presence; gaps and offline time never accrue.
export function rewardListening(room,listeners,now,createUser){
 const settings=room.settings,previous=room.listenerSnapshot||{},next={};
 if(!room.live||!settings.listenRewards){room.listenerSnapshot={};return [];}
 const day=new Date(now+9*3600000).toISOString().slice(0,10),rewards=[];
 for(const listener of listeners){
  if(!listener||typeof listener.id!=='string'||!listener.id||Object.hasOwn(next,listener.id))continue;
  const id=listener.id;next[id]=now;
  const u=room.users[id]||(room.users[id]=createUser(id,listener.nickname||'청취자'));
  u.name=listener.nickname||u.name;
  const delta=now-previous[id];if(!Number.isFinite(delta)||delta<=0||delta>90000)continue;
  u.listeningMs=(u.listeningMs||0)+delta;u.listenProgress=(u.listenProgress||0)+delta;
  if(u.listenDay!==day){u.listenDay=day;u.listenPaid=0;}
  const interval=settings.listenMinutes*60000,periods=Math.floor(u.listenProgress/interval);u.listenProgress%=interval;
  const amount=Math.min(periods*settings.listenTickets,Math.max(0,settings.listenDailyCap-(u.listenPaid||0)));
  if(amount&&Number.isSafeInteger(u.tickets+amount)){u.tickets+=amount;u.ticketRevision=(u.ticketRevision||0)+1;u.listenPaid=(u.listenPaid||0)+amount;rewards.push({user:id,amount,balance:u.tickets});}
 }
 room.listenerSnapshot=next;return rewards;
}
