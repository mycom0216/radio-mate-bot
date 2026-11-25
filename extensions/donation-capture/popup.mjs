const $=selector=>document.querySelector(selector),status=$('#status');
async function request(message){const result=await chrome.runtime.sendMessage(message);if(!result?.ok)throw Error(result?.error||'확장 기능 응답을 확인해주세요.');return result;}
let editing=0,notice={text:'',until:0};
// 버튼 결과 안내: 새로고침(1.5초마다)이 곧바로 지우지 않도록 10초간 고정하고, 화면 밖이면 보이는 위치로 스크롤합니다.
function show(text){notice={text,until:Date.now()+10000};status.textContent=text;status.scrollIntoView({block:'nearest'});}
async function refresh(){try{const {binding,report,options,uploadReport,videoReport}=await request({type:'state'});$('#target').textContent=binding?'대상 DJ: '+binding.dj+' · '+binding.url:'아직 연결된 방송 탭이 없습니다.';status.textContent=Date.now()<notice.until?notice.text:(report?.text||'연결 대기');
 // 사용자가 방금 바꾼 체크 상태는 잠깐 덮어쓰지 않습니다.
 if(Date.now()>editing){$('#opt-local').checked=options.local;$('#opt-upload').checked=options.upload;$('#opt-video').checked=options.video;$('#opt-video-audio').checked=options.videoAudio;$('#video-seconds').value=String(options.videoSeconds);}
 $('#video-status').textContent=videoReport?.text||(options.video?'영상 녹화: 켜짐 · 후원이 오면 자동으로 녹화합니다.':'영상 녹화: 꺼짐');
 $('#upload-status').textContent=uploadReport?'서버 업로드: 성공 '+uploadReport.ok+'장'+(uploadReport.fail?' · 실패 '+uploadReport.fail+'장':'')+' · '+uploadReport.last:(options.upload?'서버 업로드: 대기':'서버 업로드: 꺼짐');}catch(error){show(error.message);}}
for(const id of ['opt-local','opt-upload','opt-video','opt-video-audio','video-seconds'])$('#'+id).onchange=async()=>{editing=Date.now()+3000;try{await request({type:'options',local:$('#opt-local').checked,upload:$('#opt-upload').checked,video:$('#opt-video').checked,videoAudio:$('#opt-video-audio').checked,videoSeconds:Number($('#video-seconds').value)});}catch(error){show(error.message);}await refresh();};
$('#video-test').onclick=async event=>{const button=event.currentTarget;button.disabled=true;try{await request({type:'video-test'});}catch(error){$('#video-status').textContent=error.message;}finally{setTimeout(()=>{button.disabled=false;},6000);}await refresh();};
$('#connect').onclick=async event=>{const button=event.currentTarget;button.disabled=true;show('연결 중입니다…');try{let config;try{config=JSON.parse($('#config').value);}catch{throw Error('연결 정보를 읽을 수 없습니다. 스튜디오의 「연결 정보 복사」로 복사한 글자 전체({ 로 시작해 } 로 끝남)를 그대로 붙여넣으세요.');}
  await request({type:'connect',config,confirmed:$('#confirmed').checked});$('#config').value='';show('연결되었습니다. 이제부터 수신하는 후원을 감지합니다.');await refresh();}catch(error){show(error.message);}finally{button.disabled=false;}};
for(const type of ['test','stop'])$('#'+type).onclick=async()=>{try{show(type==='test'?'5장 연속 테스트 중입니다… (약 5초)':'중지하는 중입니다…');await request({type});show(type==='test'?'테스트가 끝났습니다. 다운로드 폴더를 확인하세요.':'자동 캡처를 중지했습니다.');await refresh();}catch(error){show(error.message);}};
void refresh();setInterval(refresh,1500);
