const $=selector=>document.querySelector(selector),status=$('#status');
async function request(message){const result=await chrome.runtime.sendMessage(message);if(!result?.ok)throw Error(result?.error||'확장 기능 응답을 확인해주세요.');return result;}
async function refresh(){try{const {binding,report}=await request({type:'state'});$('#target').textContent=binding?'대상 DJ: '+binding.dj+' · '+binding.url:'아직 연결된 방송 탭이 없습니다.';status.textContent=report?.text||'연결 대기';}catch(error){status.textContent=error.message;}}
$('#connect').onclick=async event=>{const button=event.currentTarget;button.disabled=true;try{await request({type:'connect',config:JSON.parse($('#config').value),confirmed:$('#confirmed').checked});$('#config').value='';await refresh();}catch(error){status.textContent=error.message;}finally{button.disabled=false;}};
for(const type of ['test','stop'])$('#'+type).onclick=async()=>{try{await request({type});await refresh();}catch(error){status.textContent=error.message;}};
void refresh();setInterval(refresh,1500);
