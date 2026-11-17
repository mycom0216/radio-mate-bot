import test from 'node:test';
import assert from 'node:assert/strict';
import {Store,Engine} from '../core.mjs';

test('DJ can create and view their own profile and play without a registration dead end',()=>{
 const store=new Store();store.create('room','DJ');store.create('other','Other');
 let now=Date.now(),seq=0;
 const engine=new Engine(store,{now:()=>now,int:(a)=>a});
 const say=message=>{now+=21000;return engine.handle('room',{id:`dj-${++seq}`,user:{id:'host',nickname:'방송 DJ'},isDj:true,message});};
 try{
  assert.match(say('!내정보').text,/방송 DJ.*Lv\./s);
  assert.match(say('!내정보 생성').text,/프로필이 준비/);
  assert.match(say('!내정보').text,/방송 DJ.*Lv\./s);
  assert.match(say('!출석').text,/복권 20장 지급/);
  const before=store.load('room').users.host;
  say('!내정보 생성');const after=store.load('room').users.host;
  assert.equal(after.tickets,before.tickets);assert.equal(after.exp,before.exp);assert.equal(after.attendance,before.attendance);
  store.transaction('room',r=>{r.settings.fishing=true;});
  const response=say('!낚시').text;
  assert.ok(response&&!response.includes('먼저 !내정보'));assert.equal(store.load('other').users.host,undefined);
 }finally{store.db.close();}
});

test('first DJ fishing command creates a profile and ordinary info lookup does too',()=>{
 const store=new Store();store.create('room','DJ');const engine=new Engine(store,{int:a=>a});
 try{
  store.transaction('room',r=>{r.settings.fishing=true;});
  const response=engine.handle('room',{id:'first-fish',user:{id:'host',nickname:'DJ'},isDj:true,message:'!낚시'});
  assert.ok(response.text&&!response.text.includes('먼저 !내정보'));assert.ok(store.load('room').users.host);
  store.transaction('room',r=>{r.lastResponse=0;});
  const info=engine.handle('room',{id:'first-info',user:{id:'listener',nickname:'청취자'},message:'!내정보'});
  assert.match(info.text,/청취자.*Lv\./s);assert.equal(store.load('room').users.listener.tickets,0);
 }finally{store.db.close();}
});
