import {ListenerSpeech} from './speech.mjs';
import {listenerRoom,appendTranscript} from './shared.mjs';
const $=id=>document.getElementById(id),params=new URLSearchParams(location.search),tabId=Number(params.get('tab')),room=params.get('room');
const extension=!!globalThis.chrome?.runtime?.id,Recognition=globalThis.SpeechRecognition||globalThis.webkitSpeechRecognition;
let selected=false,busy=false,requestId=crypto.randomUUID(),lastInserted='',closed=false;
const status=text=>{$('status').textContent=text;update();};
function update(){const listening=!!speech?.listening;$('pick').disabled=busy||listening||!extension||!listenerRoom(room);$('speak').disabled=busy||listening||!Recognition||!selected;$('cancel').disabled=!listening;$('insert').disabled=busy||listening||!selected||!$('draft').value.trim();$('copy').disabled=!$('draft').value.trim();$('draft').readOnly=busy||listening;$('count').textContent=`${$('draft').value.length} / 200`;}
async function bridge(action,extra={}){const result=await chrome.tabs.sendMessage(tabId,{namespace:'radio-mate-listener',room,action,...extra});if(!result?.ok)throw Error(result?.error||'연결을 확인하지 못했습니다.');return result;}
async function connection(){if(!extension||!listenerRoom(room))return;try{const result=await bridge('status');selected=result.selected;$('connection').textContent=selected?'채팅 입력창이 연결됐어요.':result.picking?'방송 화면의 채팅 입력창을 눌러 주세요.':'아직 연결되지 않았어요. 입력창 선택을 눌러 주세요.';}catch{selected=false;$('connection').textContent='방송 연결이 끊겼습니다. 방송에서 확장 버튼을 다시 눌러 주세요.';}update();}
async function insert(){
 if(busy||!selected||speech?.listening)return;const text=$('draft').value.trim();if(!text)return;
 if(text===lastInserted){status('이미 넣은 문장입니다. 다음 문장을 말하거나 글을 수정해 주세요.');return;}
 busy=true;update();try{appendTranscript('',text);await bridge('insert',{text,requestId});lastInserted=text;status('방송 채팅 입력창에 넣었어요. 내용 확인 후 스푼에서 전송해 주세요.');}catch(error){status(error.message||'입력하지 못했습니다. 문장을 복사해 붙여넣어 주세요.');}finally{busy=false;update();}
}
const speech=Recognition?new ListenerSpeech({Recognition,onDraft:text=>{$('draft').value=text;requestId=crypto.randomUUID();update();},onStatus:status,onDone:text=>{$('draft').value=text;requestId=crypto.randomUUID();lastInserted='';update();if($('automatic').checked)void insert();else status('인식이 끝났어요. 문장을 확인하고 입력창에 넣기를 눌러 주세요.');}}):null;
$('pick').onclick=async()=>{try{await bridge('pick');await chrome.tabs.update(tabId,{active:true});status('스푼 방송 화면의 채팅 입력창을 눌러 주세요.');}catch{status('방송에서 확장 버튼을 다시 눌러 주세요.');}};
$('speak').onclick=async()=>{if(busy||!selected)return;busy=true;update();try{const stream=await navigator.mediaDevices.getUserMedia({audio:true});stream.getTracks().forEach(t=>t.stop());if(!closed){$('draft').value='';lastInserted='';requestId=crypto.randomUUID();speech.start();}}catch{status('마이크 사용을 허용하지 않았거나 장치를 찾지 못했습니다. 브라우저 권한을 확인해 주세요.');}finally{busy=false;update();}};
$('cancel').onclick=()=>speech?.cancel();$('insert').onclick=()=>void insert();
$('draft').oninput=()=>{requestId=crypto.randomUUID();lastInserted='';update();};
$('copy').onclick=async()=>{try{await navigator.clipboard.writeText($('draft').value);status('문장을 복사했어요. 스푼 채팅창에 붙여넣어 주세요.');}catch{status('복사하지 못했습니다. 문장을 직접 선택해 복사해 주세요.');}};
window.addEventListener('pagehide',()=>{closed=true;speech?.cancel();clearInterval(poll);});
$('target').textContent=listenerRoom(room)?`연결할 방송: ${room}`:params.get('error')||'설치 전 화면 미리보기입니다. 확장 프로그램을 설치한 뒤 스푼 방송에서 실행하세요.';
status(!extension?'확장 프로그램으로 열어야 방송 입력창과 연결됩니다.':!Recognition?'이 브라우저는 음성 인식을 지원하지 않습니다. 문장 입력·복사는 사용할 수 있습니다.':'입력창을 연결한 뒤 말하기를 눌러 주세요.');
const poll=setInterval(()=>void connection(),1500);void connection();update();
