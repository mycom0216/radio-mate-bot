import {decorateStudio} from './studio-icons.mjs';
decorateStudio();
const $=id=>document.getElementById(id),token=location.pathname.split('/').at(-1),endpoint=`/api/voice-public/${token}`,maxBytes=8*1024*1024;
let clip=null,clipUrl=null,requestId=null,recorder=null,stream=null,timer=null,stopTimer=null,sending=false,sent=false,recording=false,recordAttempt=0;
const status=text=>$('voice-status').textContent=text;
function controls(){
  $('record-start').disabled=recording||sending||!navigator.mediaDevices?.getUserMedia||!globalThis.MediaRecorder;
  $('record-stop').disabled=!recording;$('voice-file').disabled=recording||sending;
  $('voice-send').disabled=recording||sending||!clip||sent;
}
function stopTracks(){clearInterval(timer);clearTimeout(stopTimer);stream?.getTracks().forEach(track=>track.stop());stream=null;}
function preview(blob,label){
  if(clipUrl)URL.revokeObjectURL(clipUrl);clip=null;clipUrl=null;$('voice-preview').hidden=true;
  if(!blob.size||blob.size>maxBytes){status('음성이 비어 있거나 8MB를 초과했습니다.');controls();return;}
 clip=blob;clipUrl=URL.createObjectURL(blob);requestId=crypto.randomUUID();sent=false;
  $('voice-audio').src=clipUrl;$('voice-preview').hidden=false;$('voice-file-info').textContent=`${label} · ${(blob.size/1024/1024).toFixed(2)} MB`;status('미리 듣고 확인한 뒤 전송해 주세요.');controls();
}
$('voice-file').onchange=()=>{const file=$('voice-file').files[0];if(file)preview(file,file.name);};
$('voice-audio').onerror=()=>{clip=null;status('이 브라우저에서 재생할 수 없는 파일입니다. 다른 음성 파일을 선택해 주세요.');controls();};
$('record-start').onclick=async()=>{
  if(recording||sending)return;const attempt=++recordAttempt;recording=true;controls();status('마이크 권한을 확인하고 있습니다…');
  try{
    const granted=await navigator.mediaDevices.getUserMedia({audio:true});if(attempt!==recordAttempt){granted.getTracks().forEach(track=>track.stop());return;}stream=granted;
    const mime=['audio/webm;codecs=opus','audio/mp4','audio/ogg;codecs=opus'].find(type=>MediaRecorder.isTypeSupported(type));
    recorder=new MediaRecorder(stream,mime?{mimeType:mime}:undefined);const activeRecorder=recorder;let failed=false;const chunks=[];let size=0;const started=Date.now();
    recorder.ondataavailable=e=>{if(e.data.size){chunks.push(e.data);size+=e.data.size;if(size>maxBytes&&recorder.state==='recording')recorder.stop();}};
    recorder.onstop=()=>{recording=false;stopTracks();$('record-time').textContent='';if(!failed)preview(new Blob(chunks,{type:activeRecorder.mimeType}),'녹음한 음성');controls();};
    recorder.onerror=()=>{failed=true;recording=false;stopTracks();status('녹음 중 오류가 발생했습니다. 파일 선택으로도 보낼 수 있습니다.');controls();};
    recorder.start(1000);controls();status('녹음 중입니다. 최대 60초 후 자동으로 중지합니다.');
    timer=setInterval(()=>$('record-time').textContent=`${Math.min(60,Math.floor((Date.now()-started)/1000))} / 60초`,250);
    stopTimer=setTimeout(()=>{if(recorder.state==='recording')recorder.stop();},60000);
  }catch(error){if(attempt!==recordAttempt)return;recording=false;stopTracks();status(error.name==='NotAllowedError'?'마이크 사용이 허용되지 않았습니다. 음성 파일을 선택해 보낼 수 있습니다.':'녹음을 시작하지 못했습니다. 마이크와 HTTPS 연결을 확인하거나 파일을 선택하세요.');controls();}
};
$('record-stop').onclick=()=>{if(recorder?.state==='recording'){recorder.stop();$('record-stop').disabled=true;}else{recordAttempt++;recording=false;status('녹음 요청을 취소했습니다. 파일 선택으로도 보낼 수 있습니다.');controls();}};
$('voice-form').onsubmit=async event=>{
  event.preventDefault();if(!clip||sending||sent||recording)return;sending=true;controls();status('DJ 수신함으로 전송 중입니다…');
  try{
    const form=event.currentTarget,res=await fetch(endpoint,{method:'POST',headers:{'Content-Type':clip.type||'application/octet-stream','X-Voice-Name':encodeURIComponent(form.elements.namedItem('nickname').value.trim()),'X-Voice-Title':encodeURIComponent(form.elements.namedItem('title').value.trim()),'X-Voice-Request':requestId},body:clip,signal:AbortSignal.timeout(60000)});
    const data=await res.json();if(!res.ok)throw Error(data.error||'전송하지 못했습니다.');sent=true;status('DJ 수신함에 도착했습니다! 스푼 앱 보이스카드함이 아닌 이 프로그램에서 DJ가 확인합니다.');
  }catch(error){status(`${error.message||'전송 중 오류가 발생했습니다.'} 다시 전송을 누르면 중복 접수를 확인합니다.`);}finally{sending=false;controls();}
};
window.addEventListener('pagehide',()=>{recordAttempt++;if(recorder?.state==='recording')recorder.stop();stopTracks();if(clipUrl)URL.revokeObjectURL(clipUrl);});
try{
  const res=await fetch(endpoint),data=await res.json();if(!res.ok)throw Error(data.error);
  $('voice-heading').textContent=`${data.name}에게 음성 보내기`;$('voice-intro').textContent='팬 등록 없이 보낼 수 있는 별도 음성메시지 접수함입니다.';$('voice-form').hidden=false;controls();
  if(!navigator.mediaDevices?.getUserMedia||!globalThis.MediaRecorder)status('이 환경에서는 직접 녹음을 사용할 수 없습니다. 음성 파일을 선택해 보내세요.');
}catch(error){$('voice-intro').textContent='현재 접수할 수 없습니다.';status(error.message||'접수 링크를 확인해 주세요.');}
