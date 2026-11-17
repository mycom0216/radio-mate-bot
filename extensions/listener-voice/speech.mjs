import {speechError} from './shared.mjs';
export class ListenerSpeech {
 constructor({Recognition,onDraft,onStatus,onDone}){Object.assign(this,{Recognition,onDraft,onStatus,onDone});this.active=null;}
 start(){
  if(this.active)return;const r=new this.Recognition();this.active=r;let final='',failed=false;const processed=new Set();
  r.lang='ko-KR';r.continuous=false;r.interimResults=true;
  r.onresult=e=>{if(this.active!==r)return;let interim='';for(let i=e.resultIndex;i<e.results.length;i++){const result=e.results[i];if(result.isFinal){if(!processed.has(i)){processed.add(i);final+=(final?' ':'')+result[0].transcript.trim();}}else interim+=result[0].transcript;}this.onDraft([final,interim].filter(Boolean).join(' '));};
  r.onerror=e=>{if(this.active!==r)return;failed=true;this.onStatus(speechError(e.error));};
  r.onend=()=>{if(this.active!==r)return;this.active=null;if(!failed&&final.trim())this.onDone(final.trim());else if(!failed)this.onStatus('인식된 문장이 없습니다. 말하기를 다시 눌러 주세요.');};
  try{r.start();this.onStatus('듣고 있어요. 한 문장을 말씀해 주세요.');}catch(error){this.active=null;this.onStatus('음성 인식을 시작하지 못했습니다. 마이크와 브라우저 지원을 확인해 주세요.');}
 }
 cancel(){const r=this.active;this.active=null;if(r){r.onresult=null;r.onend=null;r.onerror=null;r.abort();}this.onStatus('음성 입력을 취소했습니다.');}
 get listening(){return !!this.active;}
}
