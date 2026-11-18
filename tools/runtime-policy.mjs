export const restartDelay=count=>Math.min(300000,Math.max(2000,2000*2**Math.min(count,8)));
export function recoveryDecision({alive,healthy,failures=0,nextStartAt=0,now=Date.now()}){
 if(healthy)return {action:'keep',failures:0};
 const count=failures+1;if(now<nextStartAt)return {action:'wait',failures:count};
 return {action:!alive||count>=3?'restart':'wait',failures:count};
}
