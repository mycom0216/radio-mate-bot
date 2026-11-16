import {setImmediate as yieldTurn} from 'node:timers/promises';
export const LOTTERY_CHUNK=10000;
// Two independent 3-number selections from 1..9 have 84 equiprobable
// comparisons: 20 miss, 45 one-match, 18 two-match and 1 three-match.
export function addLotteryOutcome(counts,roll){counts[roll===0?3:roll<=18?2:roll<=63?1:0]++;}
export function lotterySummary(count,int){const counts=[0,0,0,0];for(let i=0;i<count;i++)addLotteryOutcome(counts,int(0,83));return counts;}
// Sample category counts instead of running trillions of individual draws.
// Recursive binomial sampling via beta order statistics: Devroye (1986), p.537.
// https://www.cs.fsu.edu/~mascagni/Devroye.pdf
// Gamma sampler: Marsaglia & Tsang (2000), doi:10.1145/358407.358414.
function gamma(shape,random){
  const d=shape-1/3,c=1/Math.sqrt(9*d);
  for(let attempt=0;attempt<128;attempt++){
    const x=Math.sqrt(-2*Math.log(random()))*Math.cos(2*Math.PI*random()),w=c*x;
    if(w<=-1)continue;
    const v=(1+w)**3,u=random();
    const correction=3*(Math.log1p(w)-w)-3*w*w-w*w*w;
    if(u<1-.0331*x**4||Math.log(u)<.5*x*x+d*correction)return d*v;
  }
  throw Error('추첨 난수 생성에 실패했습니다. 복권은 차감하지 않았습니다.');
}
export function binomial(n,p,random){
  let result=0,sign=1;
  for(let step=0;step<128;step++){
    if(p>.5){result+=sign*n;sign=-sign;p=1-p;}
    if(n===0||p<=0)return result;
    if(n*p<16){
      const logFailure=Math.log1p(-p);let position=0,successes=0;
      while(true){position+=Math.floor(Math.log(random())/logFailure)+1;if(position>n)return result+sign*successes;successes++;}
    }
    const pivot=Math.floor((n+1)*p),a=gamma(pivot,random),b=gamma(n-pivot+1,random),y=a/(a+b);
    if(y<=p){result+=sign*pivot;n-=pivot;p=(p-y)/(1-y);}
    else{n=pivot-1;p/=y;}
  }
  throw Error('추첨 계산에 실패했습니다. 복권은 차감하지 않았습니다.');
}
export function aggregateLottery(count,int){
  const random=()=>(int(0,67108863)*67108864+int(0,67108863)+.5)/4503599627370496;
  const counts=[0,0,0,0],weights=[20,45,18,1];let remaining=count,total=84;
  for(let i=0;i<3;i++){counts[i]=binomial(remaining,weights[i]/total,random);remaining-=counts[i];total-=weights[i];}
  counts[3]=remaining;return counts;
}
export async function lotterySummaryAsync(count,int){
  if(count>100000){await yieldTurn();return aggregateLottery(count,int);}
  const counts=[0,0,0,0];for(let i=0;i<count;i++){addLotteryOutcome(counts,int(0,83));if((i+1)%LOTTERY_CHUNK===0)await yieldTurn();}return counts;
}
export const lotteryExp=counts=>counts[1]*50+counts[2]*150+counts[3]*300;
