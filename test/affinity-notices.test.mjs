import test from 'node:test';
import assert from 'node:assert/strict';
import {Store,Engine} from '../core.mjs';

function fixture(t){
 const store=new Store();t.after(()=>store.db.close());store.create('r','R');let now=Date.parse('2026-11-18T10:00:00+09:00');
 const engine=new Engine(store,{now:()=>now});store.transaction('r',r=>{r.live=true;r.settings.listenDailyCap=1;});
 return {store,engine,get now(){return now;},advance:ms=>now+=ms,snapshot:list=>engine.listenerSnapshot('r',list,now),messages:()=>store.db.prepare('SELECT text FROM outbox WHERE room=?').all('r').map(x=>x.text)};
}

test('five minute notice shows listening and hourly chat gains and total without duplicate rewards or notices',t=>{
 const f=fixture(t),list=[{id:'u',nickname:'콰앙'}];f.snapshot(list);
 f.engine.handle('r',{id:'chat',message:'안녕하세요',user:{id:'u',nickname:'콰앙'}});
 for(let i=0;i<4;i++){f.advance(60000);f.snapshot(list);}assert.equal(f.messages().length,0);
 f.advance(60000);f.snapshot(list);assert.equal(f.messages().length,1);assert.match(f.messages()[0],/콰앙님 \+10° → 10°/);assert.match(f.messages()[0],/스푼 공식 애청온도와 별개/);
 f.snapshot(list);assert.equal(f.messages().length,1);assert.equal(f.store.load('r').users.u.tickets,1);
 for(let i=0;i<5;i++){f.advance(60000);f.snapshot(list);}assert.equal(f.store.load('r').users.u.tickets,1);assert.match(f.messages()[1],/\+5° → 15°/);
 f.advance(3100);const query=f.engine.handle('r',{id:'query',message:'!애청지수',user:{id:'u',nickname:'콰앙'},isDj:true});assert.match(query.text,/애청지수 15°/);assert.match(query.text,/최근 집계 상승분 \+5°/);
});

test('quiet, disabled and offline states do not send notices or credit connection gaps',t=>{
 const f=fixture(t),list=[{id:'u',nickname:'팬'}];f.snapshot(list);
 f.store.transaction('r',r=>r.settings.quiet=true);
 for(let i=0;i<5;i++){f.advance(60000);f.snapshot(list);}assert.equal(f.messages().length,0);
 f.store.transaction('r',r=>{r.settings.quiet=false;r.settings.affinityNotices=false;});f.advance(60000);f.snapshot(list);assert.equal(f.messages().length,0);
 f.store.transaction('r',r=>{r.settings.affinityNotices=true;r.live=false;});f.advance(600000);f.snapshot(list);assert.equal(f.messages().length,0);assert.equal(f.store.load('r').users.u.listeningMs,360000);
});

test('many long Unicode nicknames are batched within Spoon limits while preserving every listener increase',t=>{
 const f=fixture(t),list=Array.from({length:25},(_,i)=>({id:'u'+i,nickname:'💖'.repeat(20)+i}));f.snapshot(list);
 for(let i=0;i<5;i++){f.advance(60000);f.snapshot([...list,...list]);}
 const messages=f.messages();assert.ok(messages.length>1);assert.ok(messages.length<25);
 for(const message of messages)assert.ok(message.length<=200);
 assert.equal(messages.join('\n').match(/\+5° → 5°/g).length,25);
 f.snapshot(list);assert.equal(f.messages().length,messages.length);
});
