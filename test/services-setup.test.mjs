import test from 'node:test';import assert from 'node:assert/strict';import {spawn} from 'node:child_process';
test('local setup accepts browser-origin forms without weakening CSRF or exposing credentials',{timeout:10000},async()=>{
 const proc=spawn(process.execPath,['tools/configure-services.mjs'],{cwd:new URL('..',import.meta.url),env:{...process.env,SERVICES_SETUP_PORT:'0'},stdio:['ignore','pipe','pipe']});
 try{
  const origin=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('start timeout')),5000);proc.stdout.on('data',chunk=>{const match=String(chunk).match(/http:\/\/127\.0\.0\.1:\d+/);if(match){clearTimeout(timer);resolve(match[0]);}});proc.once('exit',()=>{clearTimeout(timer);reject(Error('setup exited'));});});
  let res=await fetch(origin);assert.equal(res.headers.get('referrer-policy'),'same-origin');const html=await res.text(),csrf=/name="csrf" value="([a-f0-9]+)"/.exec(html)[1];
  res=await fetch(origin+'/save',{method:'POST',headers:{Origin:origin,'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({csrf})});assert.equal(res.status,400);assert.match(await res.text(),/설정할 키를 입력/);
  res=await fetch(origin+'/save',{method:'POST',headers:{Origin:'null','Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({csrf})});assert.equal(res.status,400);assert.match(await res.text(),/허용되지 않은 요청/);
  res=await fetch(origin+'/save',{method:'POST',headers:{Origin:origin,'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({csrf:'wrong'})});assert.equal(res.status,400);assert.match(await res.text(),/새로고침/);
 }finally{if(proc.exitCode===null){const done=new Promise(resolve=>proc.once('exit',resolve));proc.kill();await done;}}
});
