import {createServer} from 'node:net';
import {spawn} from 'node:child_process';
import {mkdtempSync,writeFileSync,readFileSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
const dir=mkdtempSync(join(tmpdir(),'radio-ui-'));
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const reservation=createServer();await new Promise(r=>reservation.listen(0,'127.0.0.1',r));const reservedPort=reservation.address().port;await new Promise(r=>reservation.close(r));
const server=spawn(process.execPath,['server.mjs'],{env:{...process.env,PORT:String(reservedPort),PUBLIC_URL:'http://127.0.0.1:'+reservedPort,HOST:'127.0.0.1',NODE_ENV:'development',DATA_DIR:join(dir,'data'),SPOON_CLIENT_ID:'',SPOON_CLIENT_SECRET:''},stdio:['ignore','pipe','pipe']});
let browser,ws;
try{
 const address=await new Promise((resolve,reject)=>{let text='';const timer=setTimeout(()=>reject(Error('server start timeout')),10000);server.stdout.on('data',c=>{text+=c;const m=text.match(/http:\/\/127\.0\.0\.1:\d+/);if(m){clearTimeout(timer);resolve(m[0]);}});});
 const profile=join(dir,'edge');
 browser=spawn('C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',['--headless=new','--remote-debugging-port=0','--user-data-dir='+profile,'--hide-scrollbars','about:blank'],{stdio:'ignore'});
 const portFile=join(profile,'DevToolsActivePort');for(let i=0;i<50&&!existsSync(portFile);i++)await sleep(200);
 const port=readFileSync(portFile,'utf8').split('\n')[0];
 const target=(await(await fetch(`http://127.0.0.1:${port}/json`)).json()).find(x=>x.type==='page');
 ws=new WebSocket(target.webSocketDebuggerUrl);await new Promise(r=>ws.onopen=r);
 let id=0;const pending=new Map(),errors=[];
 ws.onmessage=e=>{const msg=JSON.parse(e.data);if(msg.id){pending.get(msg.id)?.(msg.result);pending.delete(msg.id);}if(msg.method==='Runtime.exceptionThrown')errors.push(msg.params.exceptionDetails.text+': '+msg.params.exceptionDetails.exception?.description);};
 const send=(method,params={})=>new Promise(r=>{const n=++id;pending.set(n,r);ws.send(JSON.stringify({id:n,method,params}));});
 const ev=async expression=>{const result=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(result.exceptionDetails)throw Error(result.exceptionDetails.text);return result.result?.value;};
 await send('Page.enable');await send('Runtime.enable');
 await send('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
 await send('Page.navigate',{url:address});await sleep(1000);
 // Use same-origin loopback for login and save actions.
 await ev("document.getElementById('demo-login').click()");await sleep(1000);
 await ev("document.querySelector('nav [data-page=settings]').click()");await sleep(700);
 const checks=[];
 for(const width of [1440,390]){
   await send('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:width<800});await sleep(400);
   const state=await ev("({width:innerWidth,overflow:document.documentElement.scrollWidth>innerWidth,operations:document.body.innerText.includes('전송 대기열'),pauseSwitch:!!document.querySelector('[data-setting=pauseItems]'),brokenImages:[...document.images].filter(i=>!i.complete||i.naturalWidth===0).map(i=>i.src)})");
   checks.push(state);
   const image=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:true,clip:{x:0,y:0,width,height:width<800?2800:1800,scale:1}});
   writeFileSync(`output/operations-review/settings-${width}.png`,Buffer.from(image.data,'base64'));
 }
 const toggleResult=await ev("(async()=>{document.querySelector('[data-setting=pauseItems]').click();document.querySelector('[data-action=save]').click();await new Promise(r=>setTimeout(r,600));return (await(await fetch('/api/room')).json()).settings.pauseItems})()");
 checks.push({pauseSettingSaved:toggleResult});
 writeFileSync('output/operations-review/checks.json',JSON.stringify({checks,errors},null,2));console.log(JSON.stringify({checks,errors}));
 if(errors.length||checks.some(c=>c.overflow||c.brokenImages?.length||c.operations===false||c.pauseSwitch===false)||!toggleResult)throw Error('UI review failed');
}finally{ws?.close();browser?.kill();server.kill();}
