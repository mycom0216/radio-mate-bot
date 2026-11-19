import {readFileSync,writeFileSync,existsSync,openSync,closeSync,statSync,renameSync,mkdirSync,unlinkSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';import {fileURLToPath} from 'node:url';import {parseEnv} from 'node:util';import {spawn,execFileSync} from 'node:child_process';import {createHmac} from 'node:crypto';import {recoveryDecision,restartDelay} from './runtime-policy.mjs';
const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),'..'),DEPLOY=join(ROOT,'deploy'),CONFIG=join(DEPLOY,'automation.json'),PID=join(DEPLOY,'automation.pid'),STATUS=join(DEPLOY,'automation-status.json');
const readJSON=path=>{try{return JSON.parse(readFileSync(path,'utf8'));}catch{return null;}};
function save(path,data){if(path===CONFIG&&readJSON(CONFIG)?.enabled===false)data.enabled=false;writeFileSync(path+'.tmp',JSON.stringify(data,null,2),{mode:0o600});renameSync(path+'.tmp',path);}
function alive(pid){try{if(!Number.isSafeInteger(pid)||pid<1)return false;process.kill(pid,0);return true;}catch{return false;}}
function info(pid){if(!alive(pid))return null;try{return JSON.parse(execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',`Get-CimInstance Win32_Process -Filter 'ProcessId=${pid}' | Select-Object Name,ExecutablePath,CommandLine | ConvertTo-Json -Compress`],{encoding:'utf8',windowsHide:true,timeout:10000}).trim());}catch{return null;}}
// 'ours'(이 프로젝트의 프로세스) · 'foreign'(다른 프로그램: 재부팅 뒤 PID 재사용 등) · 'unknown'(정보를 읽지 못함) · 'gone'
function ownership(pid,kind){const p=info(pid);if(!p)return alive(pid)?'unknown':'gone';const mine=kind==='server'?p.Name==='node.exe'&&/env-file=deploy[\\/]temporary\.env/.test(p.CommandLine||'')&&/server\.mjs/.test(p.CommandLine||''):kind==='manager'?p.Name==='node.exe'&&String(p.CommandLine).includes('managed-runtime.mjs'):p.Name==='cloudflared.exe'&&String(p.ExecutablePath).toLowerCase()===join(DEPLOY,'cloudflared.exe').toLowerCase();return mine?'ours':'foreign';}
const owned=(pid,kind)=>ownership(pid,kind)==='ours';
async function healthy(url){try{const r=await fetch(url,{signal:AbortSignal.timeout(5000)});return r.ok&&(await r.json()).ok===true;}catch{return false;}}
export async function publishRoute(config,key,fetcher=fetch){
 const timestamp=Date.now(),sequence=Math.max(timestamp,(config.sequence||0)+1),body=JSON.stringify({origin:config.tunnelOrigin,sequence});
 const signature=createHmac('sha256',key).update(timestamp+'\n'+body).digest('hex');const r=await fetcher(config.gatewayUrl+'/__radiomate/route',{method:'POST',headers:{'Content-Type':'application/json','x-radiomate-time':String(timestamp),'x-radiomate-signature':signature},body,signal:AbortSignal.timeout(15000)});
 if(!r.ok)throw Error('route-update-failed');config.sequence=sequence;return true;
}
// cloudflared 출력에서 가장 최근의 터널 주소를 찾습니다(api.trycloudflare.com은 제외).
export function findTunnelOrigin(text){return [...String(text).matchAll(/https:\/\/[a-z0-9-]+\.trycloudflare\.com(?![\w-]|\.[a-z0-9])/g)].map(x=>x[0]).filter(x=>new URL(x).hostname!=='api.trycloudflare.com').at(-1)||'';}
// 작업 스케줄러가 실행하는 진입점입니다. 관리자가 없으면 콘솔 없는 별도 프로세스(--daemon)로 띄우고 바로 끝납니다.
// 관리자가 숨은 콘솔에 매여 있으면 콘솔이 닫힐 때 함께 죽기 때문에, 서버·터널과 같이 분리해서 실행합니다.
async function launch(){
 if(process.platform!=='win32')throw Error('이 자동 실행 관리자는 Windows 전용입니다.');
 if(readJSON(CONFIG)?.enabled===false)return;
 const previous=Number(readFileSync(PID,{encoding:'utf8',flag:'a+'}).trim());if(alive(previous)&&ownership(previous,'manager')!=='foreign')return;
 const errorLog=join(DEPLOY,'automation-error.log');if(existsSync(errorLog)&&statSync(errorLog).size>262144)renameSync(errorLog,errorLog+'.previous');
 const err=openSync(errorLog,'a');const child=spawn(process.execPath,[fileURLToPath(import.meta.url),'--daemon'],{cwd:ROOT,windowsHide:true,detached:true,stdio:['ignore',err,err]});child.unref();closeSync(err);
}
async function main(){
 if(process.platform!=='win32')throw Error('이 자동 실행 관리자는 Windows 전용입니다.');
 const previous=Number(readFileSync(PID,{encoding:'utf8',flag:'a+'}).trim());if(alive(previous)&&ownership(previous,'manager')!=='foreign')return; // 같은 번호를 다른 프로그램이 쓰고 있으면(재부팅 뒤 PID 재사용) 낡은 기록으로 봅니다.
 const lock=join(DEPLOY,'automation.lock');let handle;try{handle=openSync(lock,'wx');}catch(error){if(error.code!=='EEXIST')throw error;const owner=Number(readFileSync(lock,'utf8'));if(alive(owner)&&ownership(owner,'manager')!=='foreign')return;unlinkSync(lock);handle=openSync(lock,'wx');}writeFileSync(handle,String(process.pid));closeSync(handle);process.on('exit',()=>{try{if(readFileSync(lock,'utf8')===String(process.pid))unlinkSync(lock);}catch{}});
 writeFileSync(PID,String(process.pid));let config=readJSON(CONFIG);if(config?.enabled===false)return;if(!config?.gatewayUrl?.startsWith('https://'))throw Error('고정 주소 설정이 필요합니다.');
 const key=readFileSync(join(DEPLOY,'gateway-router.key'),'utf8').trim();let stopping=false,timer,busy=false,tunnelLog=null;
 let envStamp=statSync(join(DEPLOY,'temporary.env')).mtimeMs,serverPid=Number(readFileSync(join(DEPLOY,'public.pid'),{encoding:'utf8',flag:'a+'}).trim()),tunnelPid=Number(config.tunnelPid||0),serverFailures=0,tunnelFailures=0,serverStarts=0,tunnelStarts=0,nextServer=0,nextTunnel=0,routeDirty=true,lastPublished=0;
 const state={enabled:true,startedAt:Date.now(),gatewayUrl:config.gatewayUrl,localHealthy:false,tunnelHealthy:false,gatewayHealthy:false,serverRestarts:0,tunnelRestarts:0,lastError:null};
 const log=(type)=>{const file=join(DEPLOY,'automation.log');if(existsSync(file)&&statSync(file).size>1048576)renameSync(file,file+'.previous');writeFileSync(file,new Date().toISOString()+' '+type+'\n',{flag:'a',mode:0o600});};
 function startServer(){const out=openSync(join(DEPLOY,'public-out.log'),'a'),err=openSync(join(DEPLOY,'public-error.log'),'a');const child=spawn(process.execPath,['--env-file=deploy/temporary.env','server.mjs'],{cwd:ROOT,env:{...process.env,...parseEnv(readFileSync(join(DEPLOY,'temporary.env'),'utf8'))},windowsHide:true,detached:true,stdio:['ignore',out,err]});child.unref();closeSync(out);closeSync(err);child.on('error',()=>{state.lastError='server-start-failed';});serverPid=child.pid||0;writeFileSync(join(DEPLOY,'public.pid'),String(serverPid));state.serverRestarts++;log('server-started');}
 // 터널 주소는 로그 파일에서 읽습니다. 파이프로 읽으면 관리자가 죽을 때 cloudflared의 출력 파이프도 끊깁니다.
 function scanTunnel(){if(!tunnelLog)return;try{const origin=findTunnelOrigin(readFileSync(tunnelLog.file).subarray(tunnelLog.offset).toString('utf8'));if(origin&&config.tunnelOrigin!==origin){config.tunnelOrigin=origin;routeDirty=true;save(CONFIG,config);log('tunnel-address-updated');}}catch{}}
 function startTunnel(){const port=Number(parseEnv(readFileSync(join(DEPLOY,'temporary.env'),'utf8')).PORT||4395);const logFile=join(DEPLOY,'tunnel-out.log');if(existsSync(logFile)&&statSync(logFile).size>1048576)renameSync(logFile,logFile+'.previous');const fd=openSync(logFile,'a'),offset=statSync(logFile).size,startedAt=Date.now();const child=spawn(join(DEPLOY,'cloudflared.exe'),['tunnel','--no-autoupdate','--url','http://127.0.0.1:'+port],{cwd:ROOT,windowsHide:true,detached:true,stdio:['ignore',fd,fd]});closeSync(fd);child.unref();tunnelPid=child.pid||0;config.tunnelPid=tunnelPid;config.tunnelOrigin='';state.tunnelRestarts++;log('tunnel-started');tunnelLog={file:logFile,offset};const poll=setInterval(()=>{scanTunnel();if(Date.now()-startedAt>120000)clearInterval(poll);},2000);poll.unref();child.on('error',()=>{state.lastError='tunnel-start-failed';});save(CONFIG,config);}
 async function tick(){if(stopping||busy)return;if(readJSON(CONFIG)?.enabled===false){stopChildren();stop();return;}busy=true;try{scanTunnel();
  const settings=parseEnv(readFileSync(join(DEPLOY,'temporary.env'),'utf8')),local='http://127.0.0.1:'+(settings.PORT||4395),now=Date.now(),stamp=statSync(join(DEPLOY,'temporary.env')).mtimeMs;
  if(stamp!==envStamp){envStamp=stamp;if(owned(serverPid,'server'))process.kill(serverPid);serverPid=0;nextServer=0;log('configuration-reload');}
  state.localHealthy=await healthy(local+'/health');let decision=recoveryDecision({alive:alive(serverPid),healthy:state.localHealthy,failures:serverFailures,nextStartAt:nextServer,now});serverFailures=decision.failures;
  if(decision.action==='restart'){const who=alive(serverPid)?ownership(serverPid,'server'):'gone';if(who==='unknown'){state.lastError='server-owner-unknown';return;}if(who==='ours')process.kill(serverPid);startServer();nextServer=now+restartDelay(serverStarts++);state.localHealthy=false;}
  if(state.localHealthy)serverStarts=0;
  state.tunnelHealthy=state.localHealthy&&!!config.tunnelOrigin&&await healthy(config.tunnelOrigin+'/health');
  decision=recoveryDecision({alive:alive(tunnelPid),healthy:!state.localHealthy||state.tunnelHealthy,failures:tunnelFailures,nextStartAt:nextTunnel,now});tunnelFailures=decision.failures;
  if(state.localHealthy&&decision.action==='restart'){const who=alive(tunnelPid)?ownership(tunnelPid,'tunnel'):'gone';if(who==='unknown'){state.lastError='tunnel-owner-unknown';return;}if(who==='ours')process.kill(tunnelPid);startTunnel();nextTunnel=now+Math.max(30000,restartDelay(tunnelStarts++));state.tunnelHealthy=false;}
  if(state.tunnelHealthy){tunnelStarts=0;if(routeDirty||now-lastPublished>300000){await publishRoute(config,key);save(CONFIG,config);lastPublished=now;routeDirty=false;}state.gatewayHealthy=await healthy(config.gatewayUrl+'/health');if(!state.gatewayHealthy)routeDirty=true;}
  if(state.localHealthy&&state.tunnelHealthy&&state.gatewayHealthy)state.lastError=null;
 }catch{state.lastError='connection-recovery-pending';}finally{state.checkedAt=Date.now();save(STATUS,state);busy=false;if(!stopping)timer=setTimeout(tick,15000);}}
 // 서버·터널은 관리자와 별개 프로세스라, 자동 실행을 해제할 때만 함께 종료합니다.
 function stopChildren(){for(const [pid,kind] of [[serverPid,'server'],[tunnelPid,'tunnel']])try{if(owned(pid,kind))process.kill(pid);}catch{}}
 function stop(){stopping=true;clearTimeout(timer);state.enabled=false;save(STATUS,state);process.exit(0);}
 process.on('SIGINT',stop);process.on('SIGTERM',stop);
 // 숨김 콘솔이 닫히면(SIGHUP) 아무 기록 없이 죽던 문제: 이유를 남기고 비정상 종료 코드로 끝냅니다.
 process.on('SIGHUP',()=>{log('manager-signal:SIGHUP');process.exit(1);});process.on('SIGBREAK',()=>{log('manager-signal:SIGBREAK');process.exit(1);});process.on('exit',code=>{try{log('manager-exit:'+code);}catch{}});process.on('uncaughtException',()=>{log('manager-error');process.exit(1);});log('manager-started');await tick();
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))(process.argv.includes('--daemon')?main():launch()).catch(()=>{console.error(new Date().toISOString()+' 자동 실행 설정 또는 실행 중인 관리자를 확인해주세요.');process.exitCode=1;});
