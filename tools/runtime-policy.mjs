import {copyFileSync,existsSync,mkdirSync,readFileSync} from 'node:fs';import {join,resolve} from 'node:path';import {parseEnv} from 'node:util';
export const restartDelay=count=>Math.min(300000,Math.max(2000,2000*2**Math.min(count,8)));
export function recoveryDecision({alive,healthy,failures=0,nextStartAt=0,now=Date.now()}){
 if(healthy)return {action:'keep',failures:0};
 const count=failures+1;if(now<nextStartAt)return {action:'wait',failures:count};
 return {action:!alive||count>=3?'restart':'wait',failures:count};
}
// 실행 중 계속 바뀌는 파일(상태·로그·PID·터널 주소 기록)을 둘 폴더입니다. OneDrive 같은 동기화 폴더 안에서는 이 파일들이 동기화와 겹쳐
// 교체에 실패하거나 계속 업로드될 수 있어, deploy/temporary.env의 RADIOMATE_STATE_DIR로 동기화되지 않는 로컬 폴더를 지정할 수 있습니다.
// 비워 두면 예전처럼 deploy 폴더를 씁니다. temporary.env·gateway-router.key·cloudflared.exe는 읽기만 하므로 항상 deploy에 둡니다.
export function stateDir(root,env=process.env){
 let value=String(env.RADIOMATE_STATE_DIR||'').trim();
 if(!value){try{value=String(parseEnv(readFileSync(join(root,'deploy','temporary.env'),'utf8')).RADIOMATE_STATE_DIR||'').trim();}catch{}}
 return value?resolve(root,value):join(root,'deploy');
}
// 상태 폴더를 만들고, 설정을 옮긴 첫 실행이면 옛 위치(deploy/automation.json)의 설정을 한 번만 복사해 옵니다. 이미 있으면 건드리지 않습니다.
export function prepareState(root,env=process.env){
 const dir=stateDir(root,env),legacy=join(root,'deploy','automation.json'),current=join(dir,'automation.json');
 mkdirSync(dir,{recursive:true});
 if(dir!==join(root,'deploy')&&!existsSync(current)&&existsSync(legacy))copyFileSync(legacy,current);
 return dir;
}
