const $=selector=>document.querySelector(selector),status=$('#status');
async function request(message){const result=await chrome.runtime.sendMessage(message);if(!result?.ok)throw Error(result?.error||'확장 기능 응답을 확인해주세요.');return result;}
let editing=0;
async function refresh(){try{const {binding,report,options,uploadReport,videoReport}=await request({type:'state'});$('#target').textContent=binding?'대상 DJ: '+binding.dj+' · '+binding.url:'아직 연결된 방송 탭이 없습니다.';status.textContent=report?.text||'연결 대기';
 // 사용자가 방금 바꾼 체크 상태는 잠깐 덮어쓰지 않습니다.
 if(Date.now()>editing){$('#opt-local').checked=options.local;$('#opt-upload').checked=options.upload;$('#opt-video').checked=options.video;$('#opt-video-audio').checked=options.videoAudio;$('#video-seconds').value=String(options.videoSeconds);}
 $('#video-status').textContent=videoReport?.text||(options.video?'영상 녹화: 켜짐 · 후원이 오면 자동으로 녹화합니다.':'영상 녹화: 꺼짐');
 $('#upload-status').textContent=uploadReport?'서버 업로드: 성공 '+uploadReport.ok+'장'+(uploadReport.fail?' · 실패 '+uploadReport.fail+'장':'')+' · '+uploadReport.last:(options.upload?'서버 업로드: 대기':'서버 업로드: 꺼짐');}catch(error){status.textContent=error.message;}}
for(const id of ['opt-local','opt-upload','opt-video','opt-video-audio','video-seconds'])$('#'+id).onchange=async()=>{editing=Date.now()+3000;try{await request({type:'options',local:$('#opt-local').checked,upload:$('#opt-upload').checked,video:$('#opt-video').checked,videoAudio:$('#opt-video-audio').checked,videoSeconds:Number($('#video-seconds').value)});}catch(error){status.textContent=error.message;}await refresh();};
$('#video-test').onclick=async event=>{const button=event.currentTarget;button.disabled=true;try{await request({type:'video-test'});}catch(error){$('#video-status').textContent=error.message;}finally{setTimeout(()=>{button.disabled=false;},6000);}await refresh();};
$('#connect').onclick=async event=>{const button=event.currentTarget;button.disabled=true;try{await request({type:'connect',config:JSON.parse($('#config').value),confirmed:$('#confirmed').checked});$('#config').value='';await refresh();}catch(error){status.textContent=error.message;}finally{button.disabled=false;}};
for(const type of ['test','stop'])$('#'+type).onclick=async()=>{try{await request({type});await refresh();}catch(error){status.textContent=error.message;}};
void refresh();setInterval(refresh,1500);
