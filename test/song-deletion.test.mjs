import test from 'node:test';
import assert from 'node:assert/strict';
import {Store,Engine} from '../core.mjs';
import {applySongAction} from '../song-queue.mjs';
function fixture(){const store=new Store();store.create('r','R');let time=Date.now(),seq=0;const engine=new Engine(store,{now:()=>time});
 const say=(message,actor='dj',isDj=true,id)=>engine.handle('r',{id:id||String(++seq),message,isDj,user:{id:actor,nickname:actor}});
 const song=(id,title)=>({id,title,user:'listener',name:'Listener'});
 store.transaction('r',r=>{r.songs=[song('a','탑현 - 첫 노래'),song('b','아이유 - 둘째 노래'),song('c','MC몽 - 셋째 노래')];});
 return {store,say,load:()=>store.load('r'),advance:ms=>time+=ms,close:()=>store.db.close()};}
test('delete prompts number from 1, consume plain numeric replies, clear state and renumber after deletion',()=>{
 const f=fixture();try{
  assert.match(f.say('!삭제').text,/1\. 탑현/);assert.equal(f.load().songs.length,3);
  assert.match(f.say('1','dj',true,'delete-once').text,/신청곡 삭제: 탑현/);assert.deepEqual(f.load().songs.map(s=>s.id),['b','c']);assert.equal(f.load().songDeletePrompt,undefined);
  assert.equal(f.say('1','dj',true,'delete-once').duplicate,true);assert.equal(f.say('1').text,null);assert.equal(f.load().songs.length,2);
  assert.match(f.say('!삭제').text,/1\. 아이유/);assert.match(f.say('!삭제 2').text,/MC몽/);assert.deepEqual(f.load().songs.map(s=>s.id),['b']);
 }finally{f.close();}
});
test('previous deletion by artist removes every archived reference and never reappears on navigation',()=>{
 const f=fixture();try{
  f.say('!재생');f.say('!다음곡');f.say('!재생');f.say('!이전곡');
  assert.match(f.say('!삭제').text,/이전곡·완료.*1\. 탑현/);
  assert.match(f.say('1').text,/신청곡 삭제: 탑현/);assert.equal(f.load().previous,null);assert.equal(f.load().songSelection,undefined);
  assert.match(f.say('!이전곡').text,/없습니다/);assert.equal(f.load().songHistory.some(s=>s.id==='a'),false);
  f.say('!다음곡');f.say('!재생');assert.match(f.say('!이전곡 삭제').text,/아이유/);assert.match(f.say('아이유').text,/신청곡 삭제/);assert.equal(f.load().previous,null);
 }finally{f.close();}
});
test('next deletion accepts artist or title while ambiguous matches require a number',()=>{
 const f=fixture();try{
  assert.match(f.say('!다음곡 삭제').text,/신청 대기/);assert.match(f.say('탑현').text,/신청곡 삭제/);
  assert.match(f.say('!다음곡 삭제 둘째 노래').text,/아이유/);assert.deepEqual(f.load().songs.map(s=>s.id),['c']);
  f.store.transaction('r',r=>r.songs.push({id:'d',title:'MC몽 - 다른 곡',name:'Fan'}));
  assert.match(f.say('!다음곡 삭제 MC몽').text,/여러 곡/);assert.equal(f.load().songs.length,2);
  assert.match(f.say('!삭제 2').text,/다른 곡/);assert.equal(f.load().songs[0].id,'c');
 }finally{f.close();}
});
test('pending deletion is DJ scoped, expires, supports cancellation and cannot delete a shifted index',()=>{
 const f=fixture();try{
  assert.match(f.say('!삭제','listener',false).text,/DJ 전용/);f.say('!삭제');
  assert.equal(f.say('1','another',false).text,null);assert.equal(f.load().songs.length,3);
  f.store.transaction('r',r=>r.songs.unshift({id:'new',title:'새로 들어온 곡',name:'Fan'}));
  assert.match(f.say('1').text,/목록이 변경/);assert.equal(f.load().songs.length,4);
  assert.match(f.say('!삭제 취소').text,/취소/);assert.equal(f.say('1').text,null);
  f.say('!삭제');f.advance(120001);assert.match(f.say('1').text,/시간이 지났/);assert.equal(f.load().songs.length,4);
 }finally{f.close();}
});
test('purging a replayed current song removes queue duplicates, saved video, undo and previous selection',()=>{
 const f=fixture();try{
  f.store.transaction('r',r=>{const song={id:'played',title:'지울 곡',videoId:'pg25CSvNrEE'};r.current=song;r.previous=song;r.songHistory=[{...song,completedAt:Date.now()}];r.songs.push({...song,id:'duplicate'});r.songLibrary=[song];r.songSelection={kind:'previous',id:song.id};r.songUndo={song};});
  assert.match(f.say('!이전곡 삭제 지울 곡').text,/신청곡 삭제/);const r=f.load();
  assert.equal(r.current,null);assert.equal(r.previous,null);assert.deepEqual(r.songHistory,[]);assert.deepEqual(r.songLibrary,[]);assert.equal(r.songUndo,undefined);assert.equal(r.playbackControl.action,'pause');assert.equal(r.songs.some(s=>s.id==='duplicate'),false);
  assert.throws(()=>applySongAction(r,{action:'undo',expectedQueueRevision:r.queueRevision}),/되돌릴 수/);
 }finally{f.close();}
});
