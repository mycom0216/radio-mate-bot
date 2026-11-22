import {requestJSON} from './request-json.mjs';
import {callToken,portableCallUrl,watchConnection,copyCallUrl} from './invite-tools.mjs';
const account=document.querySelector('#invite-account'),status=document.querySelector('#invite-status'),button=document.querySelector('#invite-summon'),authorize=document.querySelector('#invite-authorize'),copy=document.querySelector('#invite-copy'),linkBox=document.querySelector('#invite-link');
const token=callToken(location.pathname);
const codeEntry=/^\/call\/?$/.test(location.pathname);
document.querySelector('#device-code-panel').hidden=!codeEntry;
if(!token){document.querySelector('#invite-title').textContent=codeEntry?'다른 기기 호출 코드 입력':'DJ 최초 연결';document.querySelector('#invite-help').textContent=codeEntry?'이미 연결된 DJ에게 받은 코드가 있을 때만 입력하세요. 처음 연결하는 DJ는 아래 최초 연결 버튼을 사용하세요.':'처음 사용하는 DJ는 코드 없이 아래 최초 DJ 연결 버튼을 누르세요. 스푼에서 방송하는 본인 계정으로 로그인하고 동의한 뒤 이 화면으로 돌아옵니다.';}
let session,checking=false;
const request=(path,data)=>requestJSON(path,data,{csrf:session?.csrf||''});
const endpoint=token?'/api/bot-call-public/'+token:'/api/reconnect';
function show(state){account.textContent=(state.dj?'연결 대상: '+state.dj+' · ':'')+(state.connected?'봇이 방송에 연결되었습니다.':state.state||'방송 연결을 기다리고 있습니다.');}
async function check(){if(document.hidden||checking)return;checking=true;try{if(!token&&!session){await initialize();return;}if(token){show(await request(endpoint));button.hidden=false;document.querySelector('#invite-device-code').hidden=false;}else if(session?.loggedIn&&!session.testing){const room=await request('/api/room');show({connected:room.live,state:room.connection});account.textContent=`현재 DJ: ${room.name} · ${account.textContent}`;}}catch(error){status.textContent=error.message;}finally{checking=false;}}
async function initialize(){try{
  button.hidden=true;copy.hidden=true;document.querySelector('#invite-device-code').hidden=true;authorize.hidden=false;
  if(token){
    document.querySelector('#invite-title').textContent='이 방송에 봇 호출';
    document.querySelector('#invite-help').textContent='이 링크는 이미 동의한 DJ 방송의 봇 연결만 재시도합니다. 스푼 앱을 열거나 다시 로그인할 필요가 없습니다.';
    authorize.hidden=true;button.textContent='이 방송에 봇 호출';
    show(await request(endpoint));button.hidden=false;document.querySelector('#invite-device-code').hidden=false;
  }else{
    session=await request('/api/session');
    if(!session.configured){account.textContent='서버의 스푼 연결 설정을 확인해야 합니다.';authorize.hidden=true;}
    else if(session.loggedIn&&!session.testing){button.hidden=false;copy.hidden=false;document.querySelector('#invite-device-code').hidden=false;authorize.textContent='다른 DJ 계정으로 연결 · 동의하기';if(!codeEntry){document.querySelector('#invite-title').textContent='방송 연결 확인';document.querySelector('#invite-help').textContent='현재 로그인한 DJ와 아래 연결 상태를 확인하세요. 다른 DJ 방송은 그 DJ 계정으로 별도 동의해야 합니다.';}await check();}
    else account.textContent='최초 연결은 방송하는 DJ 본인 계정으로 동의해주세요. 다른 기기의 로그인창은 이 최초 동의 절차입니다.';
  }
}catch(error){status.textContent=error.message;}}
await initialize();watchConnection(check);
button.onclick=async()=>{button.disabled=true;status.textContent='연결을 확인하고 있습니다…';try{const result=await request(endpoint,{});status.textContent=result.preview?'테스트 공간입니다. 실제 방송에는 호출되지 않습니다.':result.connected?'봇이 방송에 연결되어 있습니다.':'요청을 접수했습니다. 연결 상태가 방송 연결됨으로 바뀌는지 확인해주세요.';await check();}catch(error){status.textContent=error.message;}finally{button.disabled=false;}};
copy.onclick=async()=>{copy.disabled=true;try{const result=await request('/api/bot-call-link',{});status.textContent=await copyCallUrl(result.url,linkBox)?'다음 방송에도 로그인 없이 호출할 전용 링크를 복사했습니다.':'아래 주소를 길게 눌러 복사해 보관하세요.';}catch(error){status.textContent=error.message;}finally{copy.disabled=false;}};
document.querySelector('#invite-copy-guide').onclick=async()=>{status.textContent=await copyCallUrl(portableCallUrl(location),linkBox)?'다른 기기에서 열 수 있는 주소를 복사했습니다.':'아래 주소를 길게 눌러 복사한 뒤 다른 기기의 브라우저 주소창에 붙여넣으세요.';};
document.querySelector('#invite-share').onclick=async()=>{const url=token?portableCallUrl(location):linkBox.value||portableCallUrl(location);if(navigator.share)try{await navigator.share({title:'라디오메이트 방송 봇 호출',url});return;}catch(error){if(error.name==='AbortError')return;}status.textContent=await copyCallUrl(url,linkBox)?'다른 기기에서 열 주소를 복사했습니다.':'아래 주소를 길게 눌러 복사하세요.';};
document.querySelector('#invite-refresh').onclick=async()=>{status.textContent='';await initialize();await check();};
document.querySelector('#device-code-form').onsubmit=async event=>{event.preventDefault();const submit=event.currentTarget.querySelector('button');submit.disabled=true;try{const result=await request('/api/bot-call-code',{code:document.querySelector('#device-code').value});location.assign(result.url);}catch(error){status.textContent=error.message;status.scrollIntoView({block:'nearest'});}finally{submit.disabled=false;}};
document.querySelector('#invite-device-code').onclick=async event=>{const control=event.currentTarget;control.disabled=true;try{let target=endpoint;if(!token){const result=await request('/api/bot-call-link',{});target='/api/bot-call-public/'+new URL(result.url).pathname.split('/').at(-1);}const result=await request(target,{action:'device-code'}),code=result.code.slice(0,5)+'-'+result.code.slice(5);status.textContent=`${result.dj} 전용 호출 코드: ${code} · ${new Date(result.expiresAt).toLocaleTimeString('ko-KR',{hour:'2-digit',minute:'2-digit'})}까지 · 다른 기기에서 ${location.origin}/call 을 직접 열고 입력하세요.`;}catch(error){status.textContent=error.message;}finally{control.disabled=false;}};
