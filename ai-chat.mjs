import {createHash} from 'node:crypto';
export class AIChat{
 constructor({key='',model='gpt-4.1-mini',fetcher=fetch,now=Date.now,dailyLimit=100}={}){Object.assign(this,{key,model,fetcher,now,dailyLimit});this.histories=new Map();this.last=new Map();this.pending=new Set();this.globalUsage={day:'',count:0};}
 get configured(){return !!this.key;}
 scope({room,user,channel}){return createHash('sha256').update(JSON.stringify([room,user,channel])).digest('hex');}
 history(context){const h=this.histories.get(this.scope(context));return h&&h.expires>this.now()?h.messages:[];}
 reset(context){const key=this.scope(context);if(this.pending.has(key))throw Error('답변이 끝난 뒤 대화를 초기화해주세요.');this.histories.delete(key);}
 async answer(text,context){
  text=String(text||'').trim();if(!text||text.length>1000)throw Error('AI 질문은 1~1000자로 입력해주세요.');
  if(context.store.load(context.room)?.demo)throw Error('공개 테스트에서는 실제 AI를 호출하지 않습니다. DJ 계정으로 연결 후 이용해주세요.');
  if(!this.configured)throw Error('운영 PC에서 OpenAI API 키를 입력하면 자유로운 AI 대화를 사용할 수 있습니다.');
  const key=this.scope(context),now=this.now(),day=new Date(now+32400000).toISOString().slice(0,10);
  if(this.pending.has(key))throw Error('이전 질문에 답하고 있어요. 잠시만 기다려주세요.');
  if(this.pending.size>=4)throw Error('대화가 많아 잠시 쉬고 있어요. 조금 뒤에 다시 물어봐주세요.');
  if(now-(this.last.get(key)??-Infinity)<10000)throw Error('AI 질문은 10초 간격으로 보내주세요.');
  if(this.globalUsage.day!==day)this.globalUsage={day,count:0};if(this.globalUsage.count>=1000)throw Error('오늘 서버 AI 호출 한도에 도달했습니다.');
  context.store.transaction(context.room,r=>{if(r.aiUsage?.day!==day)r.aiUsage={day,count:0};if(r.aiUsage.count>=this.dailyLimit)throw Error('오늘 이 방송의 AI 호출 한도에 도달했습니다. 내일 다시 이용해주세요.');r.aiUsage.count++;});
  this.globalUsage.count++;this.last.set(key,now);this.pending.add(key);
  try{
   const messages=this.history(context);const input=[...messages,{role:'user',content:text}];
   let response;try{response=await this.fetcher('https://api.openai.com/v1/responses',{method:'POST',headers:{Authorization:'Bearer '+this.key,'Content-Type':'application/json'},signal:AbortSignal.timeout(25000),body:JSON.stringify({model:this.model,store:false,max_output_tokens:context.channel==='spoon'?180:500,instructions:'당신은 라디오메이트의 다정한 한국어 대화 친구입니다. 사용자의 질문과 이야기, 고민에 자연스럽고 유용하게 대화하세요. 실시간 검색이나 앱 제어 권한은 없습니다. 없는 최신 정보나 수행하지 않은 작업을 꾸며내지 마세요. 개인정보나 인증키를 요구하지 마세요. '+(context.channel==='spoon'?'방송 채팅용으로 160자 이내 짧게 답하세요.':'간결한 일반 텍스트로 답하세요.'),input})});}catch{throw Error('AI 연결 시간이 초과되었거나 연결하지 못했습니다. 잠시 후 다시 시도해주세요.');}
   if(!response.ok)throw Error(response.status===401?'OpenAI API 키를 확인해주세요.':response.status===429?'OpenAI 사용 한도·크레딧을 확인하거나 잠시 후 다시 시도해주세요.':'AI 서비스 오류입니다. 잠시 후 다시 시도해주세요.');
   const data=await response.json();const output=(data.output||[]).filter(x=>x.type==='message').flatMap(x=>x.content||[]).filter(x=>x.type==='output_text').map(x=>x.text).join('\n').trim();
   if(!output)throw Error('AI 답변을 받지 못했습니다. 질문을 바꿔 다시 시도해주세요.');
   const answer=output.slice(0,context.channel==='spoon'?180:2000);
   for(const [id,h]of this.histories)if(h.expires<=now)this.histories.delete(id);if(this.histories.size>=500)this.histories.delete(this.histories.keys().next().value);
   if(this.last.size>=2000)this.last.delete(this.last.keys().next().value);
   this.histories.set(key,{expires:now+1800000,messages:[...input,{role:'assistant',content:answer}].slice(-12)});return answer;
  }finally{this.pending.delete(key);}
 }
}
