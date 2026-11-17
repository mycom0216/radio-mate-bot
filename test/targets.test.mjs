import test from 'node:test';
import assert from 'node:assert/strict';
import {Store,Engine} from '../core.mjs';
test('ticket grants resolve registered nicknames with spaces, invisible characters and optional quotes',()=>{
 const store=new Store();store.create('r','R');const engine=new Engine(store);let seq=0;
 const say=(message,id='dj',name='DJ',isDj=true)=>engine.handle('r',{id:String(++seq),message,user:{id,nickname:name},isDj});
 try{
  say('!내정보','fan','별빛 라디오\u200b');
  assert.match(say('!복권지급 별빛 라디오 3').text,/3장 지급/);assert.equal(store.load('r').users.fan.tickets,3);
  assert.match(say('!복권지급 "별빛 라디오"').text,/1장 지급/);
  assert.match(say('!복권지급 @별빛 라디오 -2').text,/2장 회수/);assert.equal(store.load('r').users.fan.tickets,2);
  assert.match(say('!복권 초기화 별빛 라디오').text,/초기화/);assert.equal(store.load('r').users.fan.tickets,0);
  say('!내정보','latin','Ｓｐｏｏｎ');assert.match(say('!복권지급 spoon 2').text,/2장 지급/);
  assert.match(say('!복권지급 @별빛 3').text,/3장 지급/);assert.equal(store.load('r').users.fan.tickets,3);
  assert.match(say('!복권지급 @poo 2').text,/2장 지급/);assert.equal(store.load('r').users.latin.tickets,4);
  say('닉네임을 바꿨어요','latin','새이름');assert.match(say('!복권지급 @새이 1').text,/1장 지급/);assert.equal(store.load('r').users.latin.tickets,5);
 }finally{store.db.close();}
});
test('duplicate and unknown names never change balances and duplicate candidates expose exact targets',()=>{
 const store=new Store();store.create('r','R');store.create('other','Other');const engine=new Engine(store);let seq=0;
 const say=(message,id='dj',name='DJ',room='r')=>engine.handle(room,{id:String(++seq),message,user:{id,nickname:name},isDj:true});
 try{
  say('!내정보','one','별빛');say('!내정보','two','별빛');say('!내정보','third','다른 방송','other');
  const result=say('!복권지급 별빛 5');assert.match(result.text,/중복/);assert.match(result.text,/@one/);assert.match(result.text,/@two/);
  assert.equal(store.load('r').users.one.tickets,0);assert.equal(store.load('r').users.two.tickets,0);
  assert.match(say('!복권지급 @별 5').text,/여러 명/);assert.equal(store.load('r').users.one.tickets,0);
  assert.match(say('!복권지급 없는사람 5').text,/일치하는 청취자가 없습니다/);
  assert.match(say('!복권지급 다른 방송 5').text,/일치하는 청취자가 없습니다/);
  assert.match(say('!복권지급 @two 5').text,/5장 지급/);assert.equal(store.load('r').users.two.tickets,5);
 }finally{store.db.close();}
});
