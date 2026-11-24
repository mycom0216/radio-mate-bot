// 후원 순간 영상 녹화 전용 숨은 문서입니다. (MV3의 서비스 워커는 녹화를 직접 할 수 없어 이 문서가 대신합니다)
// 연결한 방송 탭의 화면(과 선택하면 소리)을 WebM으로 녹화하고, 이 PC 저장용 주소와 서버 업로드 결과를 확장의 워커에게 돌려줍니다.
import {ORIGIN} from './policy.mjs';
const MIME_TYPES=['video/webm;codecs=vp9,opus','video/webm;codecs=vp8,opus','video/webm;codecs=vp9','video/webm;codecs=vp8','video/webm'];
const MAX_UPLOAD=50*1024*1024,MAX_TOTAL_MS=60000;
let session=null;
const pickMime=()=>MIME_TYPES.find(type=>MediaRecorder.isTypeSupported(type))||'';
function schedule(current){
 clearTimeout(current.timer);
 current.timer=setTimeout(()=>{if(current.recorder.state!=='inactive')current.recorder.stop();},Math.max(0,current.endAt-Date.now()));
}
async function begin(message){
 const seconds=Math.max(3,Math.min(45,Number(message.seconds)||15));
 // 녹화 중에 다른 후원이 오면 새 녹화를 시작하지 않고 끝나는 시각만 늘립니다. (한 영상에 이어서 담김, 최대 60초)
 if(session){session.endAt=Math.min(session.startedAt+MAX_TOTAL_MS,Date.now()+seconds*1000);session.count++;schedule(session);return {extended:true};}
 const source={chromeMediaSource:'tab',chromeMediaSourceId:message.streamId};
 const stream=await navigator.mediaDevices.getUserMedia({audio:message.audio?{mandatory:source}:false,video:{mandatory:{...source,maxWidth:1280,maxHeight:720,maxFrameRate:30}}});
 // 탭 소리를 가져가면 그 탭이 조용해지므로, 같은 소리를 다시 스피커로 내보냅니다.
 let context=null;
 if(stream.getAudioTracks().length){context=new AudioContext();context.createMediaStreamSource(stream).connect(context.destination);}
 const mimeType=pickMime(),recorder=new MediaRecorder(stream,{...(mimeType?{mimeType}:{}),videoBitsPerSecond:1500000,audioBitsPerSecond:64000});
 const current={recorder,stream,context,chunks:[],startedAt:Date.now(),endAt:Date.now()+seconds*1000,count:1,timer:null,message};
 recorder.ondataavailable=event=>{if(event.data?.size)current.chunks.push(event.data);};
 recorder.onstop=()=>{void finish(current);};
 recorder.onerror=event=>{void finish(current,event?.error?.message||'녹화 중 오류가 났습니다.');};
 session=current;recorder.start(1000);schedule(current);
 return {};
}
async function upload(blob,event,target){
 if(!target)return {skipped:true};
 if(blob.size>MAX_UPLOAD)return {ok:false,error:'영상이 50MB를 넘어 서버에 올리지 못했습니다.'};
 try{
  const response=await fetch(target.origin+'/api/screen-capture/video',{method:'POST',headers:{Authorization:'Bearer '+target.token,'Content-Type':'video/webm','X-Capture-Event':String(event.id),'X-Capture-Amount':String(event.amount),'X-Capture-Time':String(event.time),'X-Capture-Nick':encodeURIComponent(event.nickname||'')},body:blob,credentials:'omit',cache:'no-store',signal:AbortSignal.timeout(180000)});
  if(response.ok)return {ok:true};
  return {ok:false,error:response.status===401?'연결이 만료·해제되어 서버에 올리지 못했습니다.':response.status===413?'영상이 서버 허용 크기를 넘었습니다.':response.status===429?'영상 업로드가 너무 많아 건너뜁니다.':response.status===503?'서버에 캡처 보관 폴더가 설정되어 있지 않습니다.':'서버 응답 오류 '+response.status};
 }catch(error){return {ok:false,error:error.name==='TimeoutError'?'서버 업로드 시간이 초과되었습니다.':'서버에 연결하지 못했습니다.'};}
}
async function finish(current,failure){
 if(session===current)session=null;
 clearTimeout(current.timer);
 for(const track of current.stream.getTracks())track.stop();
 try{await current.context?.close();}catch{/* 이미 닫힘 */}
 const {message}=current,seconds=Math.round((Date.now()-current.startedAt)/1000);
 try{
  if(failure||!current.chunks.length)throw Error(failure||'녹화된 영상이 없습니다.');
  const blob=new Blob(current.chunks,{type:'video/webm'}),uploaded=await upload(blob,message.event,message.upload);
  // 이 PC 저장용 주소: 워커가 다운로드한 뒤에도 잠시 두었다가 5분 뒤 정리합니다.
  let blobUrl=null;if(message.local){blobUrl=URL.createObjectURL(blob);const revoke=setTimeout(()=>URL.revokeObjectURL(blobUrl),300000);revoke?.unref?.();} // unref: Node 시험에서 이 5분 타이머가 프로세스 종료를 막지 않게 함(브라우저에서는 영향 없음)
  await chrome.runtime.sendMessage({type:'record-result',ok:true,seconds,bytes:blob.size,count:current.count,blobUrl,filename:message.filename,local:!!message.local,uploaded});
 }catch(error){await chrome.runtime.sendMessage({type:'record-result',ok:false,error:error.message,seconds});}
}
chrome.runtime.onMessage.addListener((message,sender,respond)=>{
 if(sender.id!==chrome.runtime.id||message?.target!=='offscreen')return;
 (async()=>{
  if(message.type==='record-start')return begin(message);
  throw Error('요청을 확인해주세요.');
 })().then(result=>respond({ok:true,...result}),error=>respond({ok:false,error:error.message}));
 return true;
});
