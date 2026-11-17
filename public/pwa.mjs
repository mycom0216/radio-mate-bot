const install=document.querySelector('#app-install'),status=document.querySelector('#app-install-status'),connection=document.querySelector('#app-connection');
let prompt;
const standalone=()=>matchMedia('(display-mode: standalone)').matches||navigator.standalone===true;
function update(){status.textContent=standalone()?'홈 화면 웹앱으로 사용 중':'홈 화면에 추가해 앱처럼 열어보세요';install.hidden=!prompt||standalone();}
addEventListener('beforeinstallprompt',event=>{event.preventDefault();prompt=event;update();});
addEventListener('appinstalled',()=>{prompt=null;update();});
install.addEventListener('click',async()=>{
  if(!prompt)return;const current=prompt;prompt=null;update();
  try{await current.prompt();await current.userChoice;}catch{status.textContent='브라우저 메뉴에서 홈 화면에 추가를 선택해 주세요.';}
});
function network(){connection.hidden=navigator.onLine;connection.textContent='인터넷 연결이 끊겼어요. 연결 후 다시 시도해 주세요.';}
addEventListener('online',network);addEventListener('offline',network);network();update();
if('serviceWorker'in navigator&&isSecureContext){
  navigator.serviceWorker.register('/sw.js',{scope:'/'}).catch(()=>{status.textContent='웹앱 준비를 마치지 못했어요. 인터넷 연결 후 다시 열어주세요.';});
}
