// Minimal Chrome DevTools Protocol driver for headless Edge (no dependencies; uses Node's built-in WebSocket and fetch).
import {spawn} from 'node:child_process';import {mkdtempSync,writeFileSync,mkdirSync} from 'node:fs';import {tmpdir} from 'node:os';import {join,dirname} from 'node:path';
const EDGE='C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
export class Browser{
 static async launch({port=9333,width=1440,height=900}={}){
  const dir=mkdtempSync(join(tmpdir(),'edge-cdp-'));
  const child=spawn(EDGE,['--headless=new','--remote-debugging-port='+port,'--user-data-dir='+dir,'--no-first-run','--no-default-browser-check','--disable-gpu','--hide-scrollbars','--force-color-profile=srgb','--window-size='+width+','+height,'about:blank'],{stdio:'ignore'});
  const browser=new Browser(child,port,dir);
  for(let i=0;i<80;i++){try{const list=await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();const page=list.find(t=>t.type==='page');if(page){await browser.attach(page.webSocketDebuggerUrl);return browser;}}catch{}await sleep(250);}
  child.kill();throw Error('Edge did not start');
 }
 constructor(child,port,dir){this.child=child;this.port=port;this.dir=dir;this.id=0;this.pending=new Map();this.listeners=[];}
 attach(url){return new Promise((resolve,reject)=>{this.ws=new WebSocket(url);this.ws.onopen=resolve;this.ws.onerror=reject;this.ws.onmessage=event=>{const msg=JSON.parse(event.data);if(msg.id&&this.pending.has(msg.id)){const {resolve,reject}=this.pending.get(msg.id);this.pending.delete(msg.id);msg.error?reject(Error(msg.error.message)):resolve(msg.result);}else for(const fn of this.listeners)fn(msg);};});}
 send(method,params={}){const id=++this.id;return new Promise((resolve,reject)=>{this.pending.set(id,{resolve,reject});this.ws.send(JSON.stringify({id,method,params}));});}
 async viewport(width,height,{mobile=false,scale=1}={}){await this.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:scale,mobile});await this.send('Emulation.setTouchEmulationEnabled',{enabled:mobile});}
 async go(url,wait=1200){await this.send('Page.enable');const loaded=new Promise(resolve=>{const fn=msg=>{if(msg.method==='Page.loadEventFired'){this.listeners=this.listeners.filter(x=>x!==fn);resolve();}};this.listeners.push(fn);setTimeout(resolve,15000);});await this.send('Page.navigate',{url});await loaded;await sleep(wait);}
 async eval(expression){const result=await this.send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(result.exceptionDetails)throw Error(result.exceptionDetails.exception?.description||result.exceptionDetails.text);return result.result.value;}
 async waitFor(selector,timeout=8000){const end=Date.now()+timeout;while(Date.now()<end){if(await this.eval(`!!document.querySelector(${JSON.stringify(selector)})`))return true;await sleep(150);}return false;}
 // 보이는 요소의 텍스트(부분 일치)로 클릭합니다.
 async clickText(text,selector='button,a,summary,[role=tab],[role=button],label'){return this.eval(`(()=>{const el=[...document.querySelectorAll(${JSON.stringify(selector)})].find(e=>e.offsetParent!==null&&e.textContent.replace(/\\s+/g,' ').includes(${JSON.stringify(text)}));if(!el)return false;el.scrollIntoView({block:'center'});el.click();return true;})()`);}
 async shot(path,{full=false}={}){mkdirSync(dirname(path),{recursive:true});let clip;if(full){const {contentSize}=await this.send('Page.getLayoutMetrics');clip={x:0,y:0,width:contentSize.width,height:Math.min(contentSize.height,6000),scale:1};}const {data}=await this.send('Page.captureScreenshot',{format:'png',captureBeyondViewport:full,...(clip?{clip}:{})});writeFileSync(path,Buffer.from(data,'base64'));return path;}
 async close(){try{await this.send('Browser.close');}catch{}try{this.ws.close();}catch{}this.child.kill();}
}
export {sleep};
