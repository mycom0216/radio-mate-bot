import test from 'node:test';
import assert from 'node:assert/strict';
import {Store,Engine} from '../core.mjs';
import {Outbox} from '../outbox.mjs';
import {Spoon} from '../spoon.mjs';
import {chatPage} from '../pagination.mjs';
import {VoiceInbox} from '../voice.mjs';
import {fullBackup,restoreBackup} from '../backup.mjs';
import {deleteRoom,deleteListener,expireVoice} from '../privacy.mjs';
import {mkdtempSync,readFileSync,writeFileSync,rmSync,existsSync,mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';

test('paged replies stay within 200 code points and expose all entries without flooding',()=>{
 const entries=Array.from({length:60},(_,i)=>`${i+1}. 팬${i} 💗 신청곡`);
 let combined='';let total;
 for(let i=1;i<=60;i++){const text=chatPage('목록',entries,String(i),'신청곡목록','빈 목록');assert.ok([...text].length<=200);if(text.includes('페이지를 입력'))break;combined+=text+'\n';total=i;}
 assert.ok(total>1);for(const line of entries)assert.ok(combined.includes(line),line);
 assert.match(chatPage('목록',entries,'0','목록','빈 목록'),/사용법/);
 assert.match(chatPage('목록',entries,'999','목록','빈 목록'),/페이지/);
 assert.equal(chatPage('목록',['짧은 목록'],'','목록','없음'),'짧은 목록');
});

test('reward and outbox commit together; replay never rewards or queues twice',()=>{
 const store=new Store();try{store.create('a','A');const e=new Engine(store);const ev={id:'p',user:{id:'u',nickname:'팬'},message:'!내정보 생성',delivery:true};
 e.handle('a',ev);assert.equal(new Outbox(store).list('a').length,1);assert.equal(e.handle('a',ev).duplicate,true);assert.equal(new Outbox(store).list('a').length,1);
 const event={...ev,id:'attendance',message:'!출석',isDj:true};e.handle('a',event);assert.equal(store.load('a').users.u.tickets,1);assert.equal(new Outbox(store).list('a').length,2);
 assert.equal(e.handle('a',event).duplicate,true);assert.equal(store.load('a').users.u.tickets,1);
 const previous=store.save.bind(store);store.save=()=>{throw Error('write failure');};assert.throws(()=>e.handle('a',{...ev,id:'broken',isDj:true,message:'!내정보'}),/write failure/);store.save=previous;
 assert.equal(store.db.prepare('SELECT 1 FROM outbox WHERE event_key=?').get('broken'),undefined);
 }finally{store.db.close();}
});

test('outbox retries only safe failures, survives restart, expires, scopes management and serializes sends',async()=>{
 const store=new Store();try{store.create('a','A');store.create('b','B');const q=new Outbox(store),now=Date.now();q.enqueue('a','1','hello',now);
 await q.flush('a',async()=>({kind:'retry'}),now);let row=q.list('a')[0];assert.equal(row.status,'pending');assert.equal(row.attempts,1);
 assert.ok(row.due>now);assert.equal(q.list('b').length,0);q.cancel('b',row.id);assert.equal(q.list('a')[0].status,'pending');
 const restarted=new Outbox(store);await restarted.flush('a',async()=>({kind:'ambiguous'}),now+6000);assert.equal(q.list('a')[0].status,'uncertain');let count=0;
 await restarted.flush('a',async()=>{count++;return {kind:'sent'};},now+7000);assert.equal(count,0);
 q.retry('b',row.id);assert.equal(q.list('a')[0].status,'uncertain');q.retry('a',row.id);
 let finish;const inFlight=q.flush('a',()=>new Promise(r=>finish=r),Date.now()+100);await q.flush('a',async()=>{count++;});assert.equal(count,0);finish({kind:'sent'});await inFlight;assert.equal(q.list('a').length,0);
 q.enqueue('a','old','expired',now-700000);await q.flush('a',async()=>{throw Error('should not send');},now);assert.equal(q.list('a')[0].status,'expired');
 q.enqueue('a','crashed','maybe sent',now);store.db.prepare("UPDATE outbox SET status='sending' WHERE event_key='crashed'").run();new Spoon(store,new Engine(store),{});assert.ok(q.list('a').some(x=>x.status==='uncertain'));
 }finally{store.db.close();}
});

test('opt-in item clock pauses offline, game-off and quiet intervals and resumes remaining time',()=>{
 const store=new Store();try{store.create('a','A');let now=1000000;const e=new Engine(store,{now:()=>now});e.handle('a',{id:'new',user:{id:'u'},message:'!내정보 생성'});
 store.transaction('a',r=>{r.settings.pauseItems=true;r.settings.fishing=true;r.live=true;r.users.u.buffs.exp=now+60000;e.syncBuffs(r);});
 now+=10000;store.transaction('a',r=>{e.syncBuffs(r);r.live=false;e.syncBuffs(r);});now+=3600000;
 store.transaction('a',r=>{e.reset(r);assert.equal(r.users.u.buffs.exp-now,50000);r.live=true;e.syncBuffs(r);assert.equal(r.users.u.buffPaused.exp,undefined);});
 now+=20000;store.transaction('a',r=>{e.reset(r);assert.equal(r.users.u.buffs.exp-now,30000);r.settings.quiet=true;e.syncBuffs(r);});now+=50000;
 store.transaction('a',r=>{e.reset(r);assert.equal(r.users.u.buffs.exp-now,30000);r.settings.quiet=false;r.settings.fishing=false;e.syncBuffs(r);});now+=50000;
 store.transaction('a',r=>{e.reset(r);assert.equal(r.users.u.buffs.exp-now,30000);r.settings.fishing=true;e.syncBuffs(r);});
 now+=31000;store.transaction('a',r=>{e.reset(r);assert.ok(r.users.u.buffs.exp<now);});
 }finally{store.db.close();}
});

test('encrypted full backup restores database and exact voice bytes, rejects bad key, overwrite and active server',()=>{
 const dir=mkdtempSync(join(tmpdir(),'radio-full-')),data=join(dir,'data'),voiceDir=join(data,'voice');mkdirSync(voiceDir,{recursive:true});
 const store=new Store(join(data,'studio.sqlite')),voice=new VoiceInbox(store.db,voiceDir);const id=randomUUID(),bytes=Buffer.from('voice file');
 try{
 store.create('a','A');store.db.prepare('INSERT INTO voice_cards(id,room,nickname,title,mime,bytes,created,request_id) VALUES(?,?,?,?,?,?,?,?)').run(id,'a','팬','제목','audio/webm',bytes.length,Date.now(),'backup-voice-001');writeFileSync(join(voiceDir,id),bytes);store.db.close();
 const archive=join(dir,'full.rmbak'),key='ab'.repeat(32);assert.equal(fullBackup(data,archive,key).files,2);assert.ok(!readFileSync(archive).includes(Buffer.from('팬')));
 assert.throws(()=>restoreBackup(archive,join(dir,'wrong'),'cd'.repeat(32)));assert.ok(!existsSync(join(dir,'wrong')));
 const restored=join(dir,'restored');restoreBackup(archive,restored,key);assert.deepEqual(readFileSync(join(restored,'voice',id)),bytes);const db=new Store(join(restored,'studio.sqlite'));assert.equal(db.load('a').name,'A');db.db.close();
 assert.throws(()=>restoreBackup(archive,restored,key),/새 폴더/);assert.throws(()=>fullBackup(data,archive,key),/EEXIST/);
 writeFileSync(join(data,'server.lock'),String(process.pid));assert.throws(()=>fullBackup(data,join(dir,'blocked.rmbak'),key),/종료/);
 }finally{try{store.db.close();}catch{}rmSync(dir,{recursive:true,force:true});}
});

test('listener/account erasure and voice retention remain room-scoped and keep reward dedup IDs',()=>{
 const dir=mkdtempSync(join(tmpdir(),'radio-privacy-')),s=new Store();const v=new VoiceInbox(s.db,dir);try{
 const e=new Engine(s);for(const room of ['a','b']){s.create(room,room);e.handle(room,{id:'original',user:{id:'u',nickname:'팬'},message:'!내정보 생성'});s.log(room,'u','test',{});new Outbox(s).enqueue(room,'o','팬 안내');v.setLink(room,'enable');}
 deleteListener(s,'a','u');assert.equal(s.load('a').users.u,undefined);assert.ok(s.load('b').users.u);assert.equal(s.logs('a').length,0);assert.equal(s.logs('b').length,1);
 assert.equal(e.handle('a',{id:'original',user:{id:'u'},message:'!내정보 생성'}).duplicate,true);
 const id=randomUUID();writeFileSync(join(dir,id),'voice');s.db.prepare('INSERT INTO voice_cards(id,room,nickname,title,mime,bytes,created,request_id) VALUES(?,?,?,?,?,?,?,?)').run(id,'b','팬','음성','audio/webm',5,Date.now()-5*86400000,'old-voice-0001');
 expireVoice(s,v,1);assert.equal(v.list('b').length,0);assert.equal(existsSync(join(dir,id)),false);
 deleteRoom(s,v,'a');assert.equal(s.load('a'),null);assert.ok(s.load('b'));assert.equal(new Outbox(s).list('b').length,1);assert.equal(v.link('a').token,null);
 }finally{s.db.close();rmSync(dir,{recursive:true,force:true});}
});

test('disconnect during token refresh cannot resurrect revoked local credentials',async()=>{
 const s=new Store();s.create('a','A');const spoon=new Spoon(s,new Engine(s),{SPOON_CLIENT_ID:'cid',SPOON_CLIENT_SECRET:'secret',TOKEN_KEY:'ab'.repeat(32)});
 spoon.saveToken('a',{access_token:'old',refresh_token:'refresh',expires_in:-1});
 const original=globalThis.fetch;let release;
 globalThis.fetch=async url=>{if(String(url).endsWith('/token'))return await new Promise(r=>release=()=>r(new Response(JSON.stringify({access_token:'new',refresh_token:'next',expires_in:3600}),{status:200})));return new Response('{}',{status:200});};
 try{
  const refreshing=spoon.access('a');const rejection=assert.rejects(refreshing,/해제/);await spoon.disconnect('a');release();await rejection;
  assert.equal(s.db.prepare('SELECT * FROM tokens WHERE room=?').get('a'),undefined);
 }finally{globalThis.fetch=original;s.db.close();}
});
