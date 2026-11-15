import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
test('HTTP login, CSRF, settings, DJ grant, backup ownership and logout',{timeout:30000},async()=>{
  const data=mkdtempSync(join(tmpdir(),'spoon-studio-test-'));
  const proc=spawn(process.execPath,['server.mjs'],{cwd:new URL('..',import.meta.url),env:{...process.env,HOST:'127.0.0.1',PORT:'0',DATA_DIR:data,NODE_ENV:'development',SPOON_CLIENT_ID:'',SPOON_CLIENT_SECRET:''},stdio:['ignore','pipe','pipe']});
  try{
    const address=await new Promise((resolve,reject)=>{let text='';const timer=setTimeout(()=>reject(Error('server start timeout')),10000);proc.stdout.on('data',chunk=>{text+=chunk;const m=text.match(/http:\/\/127\.0\.0\.1:\d+/);if(m){clearTimeout(timer);resolve(m[0]);}});proc.on('exit',c=>{clearTimeout(timer);reject(Error(`server exited ${c}`));});});
    let res=await fetch(address+'/api/room');assert.equal(res.status,401);
    res=await fetch(address+'/');assert.equal(res.status,200);assert.match(await res.text(),/Spoon Studio/);
    assert.match(res.headers.get('content-security-policy'),/script-src 'self'/);
    res=await fetch(address+'/api/demo',{method:'POST'});assert.equal(res.status,200);const cookie=res.headers.get('set-cookie').split(';')[0],{csrf}=await res.json();
    const headers={'Content-Type':'application/json',Cookie:cookie,'X-CSRF-Token':csrf};
    const request=(path,body,h=headers)=>fetch(address+path,{method:'POST',headers:h,body:JSON.stringify(body)});
    res=await request('/api/test',{message:'!내정보 생성',user:'a',name:'A'});assert.equal(res.status,200);
    res=await fetch(address+'/api/room',{headers});let r=await res.json();assert.equal(r.users.a.name,'A');
    res=await request('/api/settings',{settings:r.settings},{...headers,'X-CSRF-Token':'wrong'});assert.equal(res.status,403);
    res=await request('/api/settings',{settings:r.settings},{...headers,Origin:'https://evil.example'});assert.equal(res.status,403);
    r.settings.cooldown=1;res=await request('/api/settings',{settings:r.settings,name:'테스트 라디오'});assert.equal(res.status,200);
    res=await request('/api/grant',{user:'a',kind:'pt',amount:50000,reason:'테스트'});assert.equal(res.status,200);
    res=await fetch(address+'/api/room',{headers});r=await res.json();assert.equal(r.users.a.pt,50000);assert.equal(r.users.a.daily.totalPt,0);
    res=await request('/api/backup',{});const backup=await res.json();assert.ok(backup.id);
    res=await request('/api/restore',{id:'not-a-backup'});assert.equal(res.status,400);
    res=await request('/api/restore',{id:backup.id});assert.equal(res.status,200);
    res=await request('/api/logout',{});assert.equal(res.status,200);
    res=await fetch(address+'/api/room',{headers});assert.equal(res.status,401);
  }finally{const exited=new Promise(resolve=>proc.once('exit',resolve));proc.kill();await exited;rmSync(data,{recursive:true,force:true});}
});
