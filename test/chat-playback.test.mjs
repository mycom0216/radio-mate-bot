import test from 'node:test';
import assert from 'node:assert/strict';
import {Store,Engine} from '../core.mjs';
import {Playback} from '../public/playback.mjs';

test('song requests appear in next/list and DJ chat controls preserve the paused current song',()=>{
 const store=new Store();store.create('r','R');let now=Date.now(),seq=0;const engine=new Engine(store,{now:()=>now});
 const say=(message,isDj=true,id)=>{now+=21000;return engine.handle('r',{id:id||String(++seq),message,isDj,user:{id:isDj?'dj':'listener',nickname:'Test'}});};
 try{
  assert.match(say('!신청곡 탑현 - 나에게그대만이').text,/대기 1번째/);
  assert.match(say('!다음곡').text,/탑현/);assert.match(say('!신청곡').text,/탑현/);
  assert.match(say('!재생',false).text,/DJ 전용/);assert.equal(store.load('r').current,null);
  say('!재생',true,'play-once');let r=store.load('r');assert.match(r.current.title,/탑현/);assert.equal(r.songs.length,0);assert.equal(r.previous,null);const control=r.playbackControl.id;
  assert.equal(say('!재생',true,'play-once').duplicate,true);assert.equal(store.load('r').playbackControl.id,control);
  say('!멈춤');r=store.load('r');assert.equal(r.playbackControl.action,'pause');assert.match(r.current.title,/탑현/);
  assert.match(say('!이전곡').text,/재생한 곡이 없습니다/);
 }finally{store.db.close();}
});

test('browser consumes each recent DJ control once and ignores expired controls',async()=>{
 let loads=0,pauses=0;const p=new Playback({api:async()=>{throw Error('unexpected API');},load:async()=>loads++,pause:()=>pauses++,onRoom:()=>{},onStatus:()=>{}});
 const room={current:{id:'one',videoId:'pg25CSvNrEE'},songs:[],playbackControl:{id:'play',action:'play',time:Date.now()}};
 await p.sync(room);await p.sync(room);assert.equal(loads,1);assert.equal(p.running,true);
 room.playbackControl={id:'pause',action:'pause',time:Date.now()};await p.sync(room);await p.sync(room);assert.equal(pauses,1);assert.equal(p.running,false);
 room.playbackControl={id:'stale',action:'play',time:Date.now()-61000};await p.sync(room);assert.equal(loads,1);
 room.playbackControl={id:'resume',action:'play',time:Date.now()};await p.sync(room);assert.equal(loads,2);
});

test('DJ selects next/previous, plays that selection and deletes queued songs without losing history',()=>{
 const store=new Store();store.create('r','R');const engine=new Engine(store);let seq=0;
 const say=message=>engine.handle('r',{id:String(++seq),message,isDj:true,user:{id:'dj',nickname:'DJ'}});
 try{
  say('!신청곡 첫 곡');say('!신청곡 둘째 곡');say('!재생');const first=store.load('r').current.id;
  say('!다음곡');assert.equal(store.load('r').songSelection.title,'둘째 곡');assert.equal(store.load('r').current.id,first);
  say('!재생');assert.equal(store.load('r').current.title,'둘째 곡');assert.equal(store.load('r').songs.length,0);assert.equal(store.load('r').songHistory[0].id,first);
  say('!이전곡');say('!재생');assert.equal(store.load('r').current.id,first);assert.equal(store.load('r').songHistory[0].title,'둘째 곡');
  store.transaction('r',r=>{r.lastRequester=null;r.streak=0;});say('!신청곡 삭제할 곡');say('!다음곡');assert.match(say('!삭제').text,/신청곡 삭제/);assert.equal(store.load('r').songs.length,0);assert.equal(store.load('r').current.id,first);assert.ok(store.load('r').songUndo);
 }finally{store.db.close();}
});
