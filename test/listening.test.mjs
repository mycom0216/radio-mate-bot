import test from 'node:test';
import assert from 'node:assert/strict';
import {Store,Engine} from '../core.mjs';
import {Spoon} from '../spoon.mjs';
import {quizHint} from '../quiz.mjs';
test('quiz initials mask non-Hangul answers and keep hints within the chat limit',()=>{
 assert.equal(quizHint('안경'),'ㅇㄱ');assert.equal(quizHint('서울 특별시'),'ㅅㅇ ㅌㅂㅅ');assert.equal(quizHint('60분'),'○○ㅂ');assert.equal(quizHint('radio mate'),'○○○○○ ○○○○');
 const store=new Store();store.create('r','R');const engine=new Engine(store);
 try{store.transaction('r',r=>Object.assign(r.settings,{quiz:true,quizQuestions:[{id:'one',question:'문'.repeat(200),answers:['안경']}]}));
 const out=engine.handle('r',{id:'quiz',message:'!퀴즈',isDj:true,user:{id:'dj',nickname:'DJ'}});assert.match(out.text,/정답: ㅇㄱ \(초성\)/);assert.ok([...out.text].length<=200);assert.ok(!out.text.includes('안경'));
 }finally{store.db.close();}
});
test('listening rewards count consecutive snapshots once, cap per day and exclude disconnected gaps',()=>{
 const store=new Store();store.create('r','R');const engine=new Engine(store);let time=Date.parse('2026-11-17T02:00:00Z');const list=[{id:'u',nickname:'Listener'}];
 try{store.transaction('r',r=>{r.live=true;r.settings.listenDailyCap=1;});engine.listenerSnapshot('r',list,time);
 for(let i=0;i<5;i++){time+=60000;engine.listenerSnapshot('r',[...list,...list],time);}
 let u=store.load('r').users.u;assert.equal(u.tickets,1);assert.equal(u.listeningMs,300000);
 engine.listenerSnapshot('r',list,time);assert.equal(store.load('r').users.u.tickets,1);
 for(let i=0;i<5;i++){time+=60000;engine.listenerSnapshot('r',list,time);}assert.equal(store.load('r').users.u.tickets,1);
 engine.listenerSnapshot('r',[],time+=60000);engine.listenerSnapshot('r',list,time+=60000);assert.equal(store.load('r').users.u.listeningMs,600000);
 engine.listenerSnapshot('r',list,time+=600000);assert.equal(store.load('r').users.u.listeningMs,600000);
 time+=86400000;engine.listenerSnapshot('r',list,time);for(let i=0;i<5;i++)engine.listenerSnapshot('r',list,time+=60000);assert.equal(store.load('r').users.u.tickets,2);
 store.transaction('r',r=>{r.live=false;});engine.listenerSnapshot('r',list,time+=60000);assert.deepEqual(store.load('r').listenerSnapshot,{});
 }finally{store.db.close();}
});
test('listener polling follows cursors and resets accrual on permission failure',async t=>{
 const original=globalThis.fetch;t.after(()=>globalThis.fetch=original);const store=new Store();store.create('r','R');const engine=new Engine(store),spoon=new Spoon(store,engine,{});spoon.access=async()=> 'test-token';let calls=0;
 try{store.transaction('r',r=>r.live=true);globalThis.fetch=async url=>{calls++;assert.equal(new URL(url).searchParams.get('cursor'),calls===1?null:'next');return {ok:true,json:async()=>({listeners:[{id:String(calls),nickname:'Fan'}],nextCursor:calls===1?'next':null})};};
 await spoon.pollListeners('r');assert.equal(calls,2);assert.equal(Object.keys(store.load('r').listenerSnapshot).length,2);
 globalThis.fetch=async()=>({ok:false,status:403});await spoon.pollListeners('r');assert.deepEqual(store.load('r').listenerSnapshot,{});assert.match(store.load('r').listeningStatus,/listeners.read/);
 }finally{store.db.close();}
});
