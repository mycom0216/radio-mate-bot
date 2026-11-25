// 예전에는 1만 장이 넘으면 비동기로 나눠 추첨했지만, 합산(이항 분포 표본추출) 방식은 복권이 몇 장이든 0.1ms 안에 같은 확률 분포로 계산되므로
// 이제 어디서든 바로(동기) 추첨합니다. LOTTERY_CHUNK는 "큰 수량"을 가리키는 값으로 시험에서만 씁니다.
export const LOTTERY_CHUNK=10000;
// 이 수량까지는 한 장씩 실제로 추첨(0.7ms 안팎)하고, 넘으면 합산 방식으로 한 번에 계산합니다.
export const LOTTERY_EXACT_MAX=1000;
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
// 복권 count장의 등수별 당첨 횟수 [꽝,3등,2등,1등]를 바로 돌려줍니다. 비동기가 필요 없습니다.
export function drawLottery(count,int){return count>LOTTERY_EXACT_MAX?aggregateLottery(count,int):lotterySummary(count,int);}
// 복권 등수: 숫자 3개 중 맞힌 개수가 3개면 1등, 2개면 2등, 1개면 3등, 0개면 꽝입니다. (배열 번호 = 맞힌 개수)
export const LOTTERY_RANKS=['꽝','3등','2등','1등'];
// 설정(s)에 저장된 등수별 EXP·PT 보상을 '맞힌 개수'로 찾을 수 있는 표로 바꿉니다.
export const lotteryRewardTable=s=>[
  {exp:0,pt:0},
  {exp:s.lotteryThirdExp,pt:s.lotteryThirdPt},
  {exp:s.lotterySecondExp,pt:s.lotterySecondPt},
  {exp:s.lotteryFirstExp,pt:s.lotteryFirstPt},
];
// 등수별 당첨 횟수(counts)에 보상 표를 곱해 총 EXP와 PT를 계산합니다.
export function lotteryPrize(counts,table){
  let exp=0,pt=0;
  for(let matches=1;matches<=3;matches++){exp+=counts[matches]*table[matches].exp;pt+=counts[matches]*table[matches].pt;}
  return {exp,pt};
}
