import test from 'node:test';import assert from 'node:assert/strict';import {mkdtempSync,rmSync} from 'node:fs';import {join} from 'node:path';import {tmpdir} from 'node:os';import {spawn} from 'node:child_process';import {PublicSandbox} from '../sandbox.mjs';import {Store} from '../core.mjs';
test('public previews isolate visitors, contain no real credentials, expire and enforce capacity',()=>{
 const dir=mkdtempSync(join(tmpdir(),'radio-preview-'));let now=Date.now();const p=new PublicSandbox(dir,{now:()=>now,limit:2});try{
 const a=p.create(),b=p.create(),{store,engine,spoon}=p.services;assert.equal(spoon.configured(),false);assert.equal(store.db.prepare('SELECT COUNT(*) n FROM tokens').get().n,0);
 engine.handle(a,{id:'create',message:'!내정보 생성',user:{id:'u',nickname:'테스트'}});assert.ok(store.load(a).users.u);assert.equal(Object.keys(store.load(b).users).length,0);assert.throws(()=>p.create(),e=>e.status===503);
 now+=3600001;p.expire();assert.equal(store.load(a),null);assert.equal(store.load(b),null);assert.ok(p.create());
 }finally{p.close();rmSync(dir,{recursive:true,force:true});}
});
test('production opt-in exposes isolated test button/session and never writes demo users to live database',{timeout:20000},async()=>{
 const dir=mkdtempSync(join(tmpdir(),'radio-preview-http-'));const proc=spawn(process.execPath,['server.mjs'],{cwd:new URL('..',import.meta.url),env:{...process.env,HOST:'127.0.0.1',PORT:'0',DATA_DIR:dir,NODE_ENV:'production',PUBLIC_URL:'https://radio.example.com',TOKEN_KEY:'ab'.repeat(32),PUBLIC_DEMO:'true',SPOON_CLIENT_ID:'',SPOON_CLIENT_SECRET:''},stdio:['ignore','pipe','pipe']});
 try{
 const address=await new Promise((resolve,reject)=>{let out='';const timer=setTimeout(()=>reject(Error('timeout')),10000);proc.stdout.on('data',c=>{out+=c;const m=out.match(/http:\/\/127\.0\.0\.1:\d+/);if(m){clearTimeout(timer);resolve(m[0]);}});proc.once('exit',c=>reject(Error('server exited '+c)));});
 let r=await fetch(address+'/api/session');const info=await r.json();assert.equal(info.demo,true);assert.equal(info.publicDemo,true);
 const login=async()=>{const res=await fetch(address+'/api/demo',{method:'POST'});assert.equal(res.status,200);const cookie=res.headers.get('set-cookie');assert.match(cookie,/Secure/);return {cookie:cookie.split(';')[0],csrf:(await res.json()).csrf};};
 const a=await login(),b=await login();assert.notEqual(a.cookie,b.cookie);
 const headers=x=>({Cookie:x.cookie,'X-CSRF-Token':x.csrf,'Content-Type':'application/json'});
 r=await fetch(address+'/api/test',{method:'POST',headers:headers(a),body:JSON.stringify({message:'!내정보 생성',user:'u',name:'나만의 테스트'})});assert.equal(r.status,200);assert.match((await r.json()).text,/준비/);
 const room=async x=>(await(await fetch(address+'/api/room',{headers:headers(x)})).json());assert.equal((await room(a)).id,'demo');assert.ok((await room(a)).users.u);assert.equal(Object.keys((await room(b)).users).length,0);
 r=await fetch(address+'/api/test',{method:'POST',headers:{...headers(a),'X-CSRF-Token':b.csrf},body:JSON.stringify({message:'!내정보 생성',user:'bad'})});assert.equal(r.status,403);
 r=await fetch(address+'/api/voice-link',{method:'POST',headers:headers(a),body:JSON.stringify({action:'enable'})});assert.equal(r.status,400);
 r=await fetch(address+'/api/logout',{method:'POST',headers:headers(a),body:'{}'});assert.equal(r.status,200);r=await fetch(address+'/api/room',{headers:headers(a)});assert.equal(r.status,401);
 assert.equal(Object.keys((await room(b)).users).length,0);
 }finally{const done=new Promise(r=>proc.once('exit',r));proc.kill();await done;const store=new Store(join(dir,'studio.sqlite'));try{assert.equal(store.ids().length,0);}finally{store.db.close();}rmSync(dir,{recursive:true,force:true});}
});
