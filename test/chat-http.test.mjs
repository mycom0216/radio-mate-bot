import test from 'node:test';import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';import {mkdtempSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';import {randomUUID} from 'node:crypto';
import {Store} from '../core.mjs';import {RoomChat} from '../chat-room.mjs';
test('public chat serves guests safely, enforces same-origin submission and does not expose management data',{timeout:20000},async()=>{
 const dir=mkdtempSync(join(tmpdir(),'radio-chat-http-')),seed=new Store(join(dir,'studio.sqlite'));seed.create('broadcast','테스트 방송');seed.create('other','다른 방송');const token=new RoomChat(seed).link('broadcast','enable');seed.db.close();
 const proc=spawn(process.execPath,['server.mjs'],{cwd:new URL('..',import.meta.url),env:{...process.env,HOST:'127.0.0.1',PORT:'0',DATA_DIR:dir,NODE_ENV:'development',PUBLIC_URL:'http://localhost:4310',SPOON_CLIENT_ID:'',SPOON_CLIENT_SECRET:''},stdio:['ignore','pipe','pipe']});
 try{
  const address=await new Promise((resolve,reject)=>{let text='';const timer=setTimeout(()=>reject(Error('start timeout')),5000);proc.stdout.on('data',chunk=>{text+=chunk;const match=text.match(/http:\/\/127\.0\.0\.1:\d+/);if(match){clearTimeout(timer);resolve(match[0]);}});proc.once('exit',code=>{clearTimeout(timer);reject(Error('server exited '+code));});});
  let res=await fetch(address+'/chat/'+token);assert.equal(res.status,200);assert.match(await res.text(),/community.mjs/);
  const endpoint=address+'/api/chat-public/'+token,message={id:randomUUID(),name:'<script>DJ</script>',text:'안녕 <img src=x>',role:'dj'};
  res=await fetch(endpoint,{method:'POST',headers:{Origin:'https://evil.example','Content-Type':'application/json'},body:JSON.stringify(message)});assert.equal(res.status,403);
  res=await fetch(endpoint,{method:'POST',headers:{Origin:'http://localhost:4310','Content-Type':'application/json'},body:JSON.stringify(message)});assert.equal(res.status,200);
  res=await fetch(endpoint);const data=await res.json();assert.equal(data.messages.length,1);assert.equal(data.messages[0].role,'guest');assert.equal(data.messages[0].text,message.text);assert.equal(data.messages[0].actor,undefined);assert.equal(data.token,undefined);assert.equal(data.users,undefined);
  res=await fetch(address+'/api/chat');assert.equal(res.status,401);
 }finally{if(proc.exitCode===null){const done=new Promise(resolve=>proc.once('exit',resolve));proc.kill();await done;}rmSync(dir,{recursive:true,force:true});}
});
