export const ORIGIN='https://radiomate-mycom0216.gallanttamarind4.chatgpt.site';
export function liveUrl(value){try{const url=new URL(value);return url.protocol==='https:'&&['www.spooncast.net','spooncast.net'].includes(url.hostname)&&/^\/(kr|jp)\/live\/[^/]+\/?$/.test(url.pathname)?url.href:null;}catch{return null;}}
export function captureDecision(event,binding,tab,window,now=Date.now()){
 if(!liveUrl(tab?.url)||tab.id!==binding.tabId||tab.windowId!==binding.windowId||tab.url!==binding.spoonUrl||!tab.active||window?.state==='minimized')return '다른 탭·다른 방송이거나 창이 최소화되어 캡처하지 않았습니다.';
 if(!Number.isFinite(event?.time)||now-event.time>10000||event.time-now>5000)return '후원 시점에서 10초 이상 지나 실제 순간 캡처를 건너뛰었습니다.';
 return null;
}
const safe=value=>[...String(value).normalize('NFKC').replace(/[<>:"/\\|?*\u0000-\u001f]/g,'_').replace(/[. ]+$/g,'')].slice(0,35).join('')||'listener';
export function captureFilename(event,dj){const stamp=new Date(event.time+9*3600000).toISOString(),frame=Number.isInteger(event.frame)?`_frame${String(event.frame).padStart(2,'0')}`:'';return `RadioMate-Captures/${stamp.slice(0,10)}/${stamp.slice(11,19).replaceAll(':','')}_${safe(dj)}_${safe(event.nickname)}_${event.amount}spoon_${safe(event.id).slice(0,10)}${frame}.png`;}
export async function captureEvent(event,binding,io,now=Date.now){
 if(io.allowed&&!await io.allowed())return {kind:'skipped',reason:'캡처 연결이 중지·변경되었습니다.'};
 const epoch=io.epoch?.(binding);
 const tab=await io.tab(binding.tabId),window=await io.window(binding.windowId),reason=captureDecision(event,binding,tab,window,now());if(reason)return {kind:'skipped',reason};
 const image=await io.capture(binding.windowId);
 // Re-check after capture; never save a screenshot if navigation raced the request.
 const after=await io.tab(binding.tabId);if(captureDecision(event,binding,after,await io.window(binding.windowId),now())||io.epoch?.(binding)!==epoch||(io.allowed&&!await io.allowed()))return {kind:'skipped',reason:'캡처 도중 탭 상태나 연결이 바뀌어 이미지를 저장하지 않았습니다.'};
 if(typeof image!=='string'||!image.startsWith('data:image/png;base64,'))throw Error('브라우저가 PNG 화면을 반환하지 않았습니다.');
 const filename=captureFilename(event,binding.dj);
 // 이 PC에 저장(io.local이 false가 아닐 때)하고, 서버 업로드(io.upload)가 있으면 기다리지 않고 시작합니다.
 // (업로드가 오래 걸려도 1초 간격 연속 촬영이 늦어지지 않도록, 업로드 결과는 result.upload(Promise)로 따로 돌려줍니다)
 let downloadId;if(io.local!==false)downloadId=await io.download({url:image,filename,saveAs:false,conflictAction:'uniquify'});
 const result=downloadId===undefined?{kind:'captured',filename}:{kind:'download-started',downloadId,filename};
 if(io.upload)result.upload=io.upload({image,event,binding,filename});
 return result;
}

// Capture several real frames: donation SSE can arrive before the web animation renders.
// The caller supplies all newly received events together so overlapping donations do
// not wait for an earlier donation's entire burst. Each screenshot is acquired once.
export const MOTION_OFFSETS=Object.freeze([0,1000,2000,3000,4000]);
export async function captureMotion(events,binding,io,{now=Date.now,sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms)),active=async()=>true,onResult=async()=>{}}={}){
 const started=now(),epoch=io.epoch?.(binding),results=[];
 for(let index=0;index<MOTION_OFFSETS.length;index++){
  const wait=started+MOTION_OFFSETS[index]-now();if(wait>0)await sleep(wait);
  if(!await active()||io.epoch?.(binding)!==epoch)break;
  // Avoid collapsing delayed frames into a rapid burst after a stalled browser.
  if(now()-started-MOTION_OFFSETS[index]>1000)continue;
  const current=events.filter(event=>Number.isFinite(event.time)&&now()-event.time<=10000&&event.time-now()<=5000);
  if(!current.length){const result={kind:'skipped',reason:'후원 시점에서 10초 이상 지나 연속 캡처를 건너뛰었습니다.',frame:index+1};results.push(result);await onResult(result);break;}
  // One frame can contain several simultaneous donations. The filename names the
  // latest event; report records the number of triggers covered by that frame.
  let result;try{result=await captureEvent({...current.at(-1),frame:index+1},binding,{...io,allowed:active},now);}catch(error){result={kind:'failed',reason:error.message};}
  result={...result,frame:index+1,triggerCount:current.length};results.push(result);await onResult(result);
  if(!['download-started','captured'].includes(result.kind))break;
 }
 return results;
}
