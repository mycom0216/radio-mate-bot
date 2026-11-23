import {ORIGIN,liveUrl,captureMotion} from './policy.mjs';
let busy=false,lastCapture=0,manualTestEpoch=0;
const tabEpoch=new Map(),windowEpoch=new Map();
chrome.tabs.onActivated.addListener(({windowId})=>windowEpoch.set(windowId,(windowEpoch.get(windowId)||0)+1));
chrome.tabs.onUpdated.addListener((tabId,change)=>{if(change.url||change.status==='loading')tabEpoch.set(tabId,(tabEpoch.get(tabId)||0)+1);});
chrome.tabs.onRemoved.addListener(tabId=>tabEpoch.set(tabId,(tabEpoch.get(tabId)||0)+1));
void chrome.storage.local.setAccessLevel({accessLevel:'TRUSTED_CONTEXTS'});
const io={epoch:binding=>(tabEpoch.get(binding.tabId)||0)+':'+(windowEpoch.get(binding.windowId)||0),tab:id=>chrome.tabs.get(id),window:id=>chrome.windows.get(id),capture:async id=>{const wait=Math.max(0,550-(Date.now()-lastCapture));if(wait)await new Promise(resolve=>setTimeout(resolve,wait));lastCapture=Date.now();return chrome.tabs.captureVisibleTab(id,{format:'png'});},download:options=>chrome.downloads.download(options)};
const read=async()=>await chrome.storage.local.get(['binding','report','options','uploadReport']);
// 저장 방식: local=이 PC 다운로드 폴더에 저장, upload=라디오메이트 서버에 보관(DJ가 태블릿·폰에서도 내려받을 수 있음). 기본은 둘 다 켬.
const optionsOf=stored=>({local:true,upload:true,...(stored||{})});
// 서버 업로드: 한 장씩 차례로 보내고(연속 촬영을 막지 않도록 촬영과 따로), 네트워크 오류면 한 번 더 시도합니다.
let uploadChain=Promise.resolve();
async function uploadFrame({image,event,binding}){
 const send=async()=>{
  const blob=await (await fetch(image)).blob();let last='서버에 연결하지 못했습니다.';
  for(let attempt=0;attempt<2;attempt++){
   const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),20000);
   try{
    const response=await fetch(ORIGIN+'/api/screen-capture/upload',{method:'POST',headers:{Authorization:'Bearer '+binding.token,'Content-Type':'image/png','X-Capture-Event':String(event.id),'X-Capture-Frame':String(event.frame),'X-Capture-Amount':String(event.amount),'X-Capture-Time':String(event.time),'X-Capture-Nick':encodeURIComponent(event.nickname||'')},body:blob,credentials:'omit',cache:'no-store',signal:controller.signal});
    if(response.ok)return {ok:true};
    last=response.status===401?'연결이 만료·해제되어 서버에 올리지 못했습니다.':response.status===413?'이미지가 서버 허용 크기를 넘었습니다.':response.status===429?'업로드가 너무 많아 잠시 건너뜁니다.':response.status===503?'서버에 캡처 보관 폴더가 설정되어 있지 않습니다.':'서버 응답 오류 '+response.status;
    if([400,401,413,415,429,503].includes(response.status))return {ok:false,error:last};
   }catch(error){last=error.name==='AbortError'?'서버 업로드 시간이 초과되었습니다.':'서버에 연결하지 못했습니다.';}finally{clearTimeout(timer);}
  }
  return {ok:false,error:last};
 };
 const run=uploadChain.then(send,send);uploadChain=run.then(()=>{},()=>{});return run;
}
// 업로드 결과를 집계해 팝업에 보여 줍니다. (성공·실패 장수와 마지막 안내)
let uploadStats=Promise.resolve();
function trackUpload(promise){
 uploadStats=uploadStats.then(async()=>{
  const result=await promise.catch(error=>({ok:false,error:error.message})),{uploadReport}=await read(),base=uploadReport||{ok:0,fail:0};
  await chrome.storage.local.set({uploadReport:{ok:base.ok+(result.ok?1:0),fail:base.fail+(result.ok?0:1),last:result.ok?'서버에 보관했습니다.':result.error,at:Date.now()}});
 }).catch(()=>{});
}
const ioFor=(binding,options)=>({...io,local:options.local,upload:options.upload&&binding.token?uploadFrame:undefined});
async function settleDownload(id){try{const [download]=await chrome.downloads.search({id}),{report}=await read();if(report?.downloadId!==id)return;if(download?.state==='complete')await chrome.storage.local.set({report:{...report,text:'PNG 저장 완료: '+report.filename}});else if(download?.state==='interrupted')await chrome.storage.local.set({report:{...report,text:'PNG 저장 실패: '+(download.error||'다운로드 중단')}});}catch{}}
async function relay(binding){const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),8000);try{const response=await fetch(ORIGIN+'/api/screen-capture/events?after='+binding.cursor,{headers:{Authorization:'Bearer '+binding.token},credentials:'omit',cache:'no-store',signal:controller.signal});if(!response.ok)throw Object.assign(Error(response.status===401?'연결이 만료·해제되었습니다. DJ 관리 화면에서 새 연결 정보를 발급해주세요.':'서버 응답 오류 '+response.status),{status:response.status});return await response.json();}finally{clearTimeout(timer);}}
function installTicks(){
 if(window.__radiomateCaptureTicks)return;window.__radiomateCaptureTicks=true;
 async function tick(){if(!window.__radiomateCaptureTicks)return;try{if(!document.hidden){const result=await chrome.runtime.sendMessage({type:'capture-tick'});if(result?.stop){window.__radiomateCaptureTicks=false;return;}}}catch{window.__radiomateCaptureTicks=false;return;}setTimeout(tick,1000);}void tick();
}
async function attach(config){
 manualTestEpoch++;
 if(config?.origin!==ORIGIN||!/^[A-Za-z0-9_-]{43}$/.test(config.token||''))throw Error('DJ 화면에서 복사한 연결 정보 전체를 붙여넣으세요.');
 const [tab]=await chrome.tabs.query({active:true,currentWindow:true});if(!tab?.id||!liveUrl(tab.url))throw Error('먼저 PC 스푼 웹의 해당 DJ 방송 탭을 열어주세요.');
 const initial=await relay({token:config.token,cursor:0}),binding={instanceId:crypto.randomUUID(),origin:ORIGIN,token:config.token,tabId:tab.id,windowId:tab.windowId,spoonUrl:tab.url,dj:initial.dj,cursor:initial.cursor,expiresAt:initial.expiresAt};
 await chrome.storage.local.remove('uploadReport');
 await chrome.storage.local.set({binding,report:{text:'연결됨 · 이제부터 수신하는 후원을 감지합니다. 방송 탭을 보이는 상태로 유지하세요.'}});
 try{await chrome.scripting.executeScript({target:{tabId:tab.id},func:installTicks});}catch(error){await chrome.storage.local.remove('binding');throw error;}
 return {dj:binding.dj,url:binding.spoonUrl};
}
async function tick(sender){
 const {binding}=await read();if(!binding?.instanceId||sender.tab?.id!==binding.tabId)return {stop:true};if(busy)return {};
 busy=true;try{
  const data=await relay(binding);
  const active=async()=>(await read()).binding?.instanceId===binding.instanceId;
  if(!await active())return {stop:true};
  // Claim this batch before capturing so a worker restart cannot replay it.
  binding.cursor=Math.max(binding.cursor,data.cursor);await chrome.storage.local.set({binding});
  if(data.events.length){
   const wait=Math.max(0,550-(Date.now()-lastCapture));if(wait)await new Promise(resolve=>setTimeout(resolve,wait));
   const options=optionsOf((await read()).options);
   await captureMotion(data.events,binding,ioFor(binding,options),{active,onResult:async result=>{
    if(!await active())return;
    if(result.upload)trackUpload(result.upload);
    await chrome.storage.local.set({report:{kind:result.kind,reason:result.reason,frame:result.frame,downloadId:result.downloadId,filename:result.filename,triggerCount:result.triggerCount,text:result.reason||`후원 모션 연속 캡처 ${result.frame}/5 · ${result.downloadId!==undefined?'PNG 저장 요청':'캡처 완료'}${result.upload?' · 서버 업로드':''}${result.triggerCount>1?' · 동시 후원 '+result.triggerCount+'건':''}`,at:Date.now()}});
    if(result.downloadId!==undefined)await settleDownload(result.downloadId);
   }});
  }
  return {};
 }catch(error){if((await read()).binding?.instanceId!==binding.instanceId)return {stop:true};await chrome.storage.local.set({report:{text:error.message,at:Date.now()}});if(error.status===401){await chrome.storage.local.remove('binding');return {stop:true};}return {};}finally{busy=false;}
}
chrome.runtime.onMessage.addListener((message,sender,respond)=>{
 if(sender.id!==chrome.runtime.id)return;
 const popup=sender.url===chrome.runtime.getURL('popup.html');
 (async()=>{
  if(message.type==='capture-tick')return tick(sender);
  if(!popup)throw Error('허용되지 않은 요청입니다.');
  if(message.type==='state'){const {binding,report,options,uploadReport}=await read();return {binding:binding?{dj:binding.dj,url:binding.spoonUrl,expiresAt:binding.expiresAt}:null,report,options:optionsOf(options),uploadReport:uploadReport||null};}
  if(message.type==='options'){if(typeof message.local!=='boolean'||typeof message.upload!=='boolean')throw Error('저장 방식 설정이 올바르지 않습니다.');if(!message.local&&!message.upload)throw Error('이 PC 저장과 서버 업로드 중 하나는 켜 두어야 합니다.');await chrome.storage.local.set({options:{local:message.local,upload:message.upload}});return {};}
  if(message.type==='connect'){if(!message.confirmed)throw Error('대상 DJ 방송 탭인지 확인해주세요.');return attach(message.config);}
  if(message.type==='stop'){manualTestEpoch++;await chrome.storage.local.remove('binding');await chrome.storage.local.set({report:{text:'이 PC의 자동 캡처를 중지했습니다.'}});return {};}
  if(message.type==='test'){
   if(busy)throw Error('후원 화면 처리 중입니다. 잠시 후 다시 시도해주세요.');busy=true;
   try{
    let {binding}=await read();const epoch=++manualTestEpoch,linked=!!binding?.instanceId;
    if(!linked){
     const [tab]=await chrome.tabs.query({active:true,currentWindow:true});
     if(!tab?.id||!liveUrl(tab.url))throw Error('PC 스푼 웹의 실제 방송 탭에서 확장 아이콘을 눌러 테스트해주세요.');
     binding={tabId:tab.id,windowId:tab.windowId,spoonUrl:tab.url,dj:'수동테스트'};
    }
    const active=async()=>epoch===manualTestEpoch&&(linked?(await read()).binding?.instanceId===binding.instanceId:!(await read()).binding);
    const options=optionsOf((await read()).options);
    const results=await captureMotion([{id:'TEST-'+Date.now(),time:Date.now(),nickname:'캡처테스트',amount:0}],binding,ioFor(binding,options),{active,onResult:async result=>{
     if(!await active())return;
     if(result.upload)trackUpload(result.upload);
     await chrome.storage.local.set({report:{kind:result.kind,reason:result.reason,frame:result.frame,downloadId:result.downloadId,filename:result.filename,text:result.reason||('테스트 연속 캡처 '+result.frame+'/5 · '+(result.downloadId!==undefined?'PNG 저장 요청':'캡처 완료')+(result.upload?' · 서버 업로드':''))}});
     if(result.downloadId!==undefined)await settleDownload(result.downloadId);
    }});
    return {frames:results.filter(result=>['download-started','captured'].includes(result.kind)).length};
   }finally{busy=false;}
  }
  throw Error('요청을 확인해주세요.');
 })().then(result=>respond({ok:true,...result}),error=>respond({ok:false,error:error.message}));return true;
});
chrome.downloads.onChanged.addListener(async change=>{if(!change.state&&!change.error)return;const {report}=await read();if(report?.downloadId!==change.id)return;const state=change.state?.current;await chrome.storage.local.set({report:{...report,text:state==='complete'?'PNG 저장 완료: '+report.filename:change.error?'PNG 저장 실패: '+change.error.current:'PNG 다운로드 상태: '+state}});});
