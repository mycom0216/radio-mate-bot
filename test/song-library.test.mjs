import test from 'node:test';
import assert from 'node:assert/strict';
import {savedSongVideo,rememberSongVideo} from '../song-library.mjs';
import {applySongAction} from '../song-queue.mjs';
import {Store,Engine} from '../core.mjs';

test('remembered title lookup tolerates spacing and case, stays room scoped and replaces old choices',()=>{
 const a={songs:[]},b={songs:[]};rememberSongVideo(a,{title:'MC몽 - 그래도 남자니까'},'BamMS6O4__g');
 assert.equal(savedSongVideo(a,'mc몽-그래도남자니까'),'BamMS6O4__g');assert.equal(savedSongVideo(b,'MC몽 - 그래도 남자니까'),null);
 rememberSongVideo(a,{title:'mc몽-그래도남자니까'},'M7lc1UVf-VE');assert.equal(a.songLibrary.length,1);assert.equal(savedSongVideo(a,'MC몽 - 그래도 남자니까'),'M7lc1UVf-VE');
 assert.throws(()=>rememberSongVideo(a,{title:'test'},'bad'),/영상 ID/);
});
test('already connected previous songs can be reused and title cache is bounded',()=>{
 const r={songs:[],previous:{title:'Artist - Song',videoId:'M7lc1UVf-VE'}};
 assert.equal(savedSongVideo(r,'artist song'),'M7lc1UVf-VE');
 for(let i=0;i<350;i++)rememberSongVideo(r,{title:'Song '+i},'M7lc1UVf-VE');
 assert.equal(r.songLibrary.length,300);assert.equal(savedSongVideo(r,'Song 0'),null);
});
test('play selected request preserves the rest of the queue and rejects stale selection',()=>{
 const r={current:{id:'playing'},songs:[{id:'a'},{id:'b'},{id:'c'}],queueRevision:4};
 applySongAction(r,{action:'select',id:'b',expectedQueueRevision:4,expectedCurrentId:'playing'});
 assert.equal(r.current.id,'b');assert.equal(r.previous.id,'playing');assert.deepEqual(r.songs.map(x=>x.id),['a','c']);
 assert.throws(()=>applySongAction(r,{action:'select',id:'a',expectedQueueRevision:4}),/변경/);
 assert.throws(()=>applySongAction(r,{action:'select',id:'missing',expectedQueueRevision:5}),/변경/);
 assert.throws(()=>applySongAction(r,{action:'select',id:'a'}),/최신/);
});

test('chat title-only requests reuse a previously linked video without a search key',()=>{
 const store=new Store();store.create('room','Room');const engine=new Engine(store);let seq=0;
 const say=message=>engine.handle('room',{id:'request-'+ ++seq,user:{id:'dj',nickname:'DJ'},isDj:true,message});
 try{
  assert.match(say('!신청곡 https://youtu.be/BamMS6O4__g MC몽 - 그래도 남자니까').text,/신청 완료/);
  store.transaction('room',r=>{r.songs=[];r.lastRequester=null;r.streak=0;});
  assert.match(say('!신청곡 mc몽-그래도남자니까').text,/https:\/\/youtu.be\/BamMS6O4__g/);
  assert.equal(store.load('room').songs[0].videoId,'BamMS6O4__g');
 }finally{store.db.close();}
});
