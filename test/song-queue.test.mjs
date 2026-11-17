import test from 'node:test';
import assert from 'node:assert/strict';
import {Store,Engine} from '../core.mjs';
import {applySongAction,touchQueue} from '../song-queue.mjs';
function room(){return {queueRevision:0,current:{id:'playing',title:'재생 중'},previous:null,songs:[{id:'one',user:'a',title:'첫 곡'},{id:'two',user:'b',title:'둘째 곡'},{id:'three',user:'a',title:'셋째 곡'}]};}

test('queue moves preserve the current song and reject stale, out-of-bounds and invalid operations',()=>{
 const r=room();applySongAction(r,{action:'move',id:'three',direction:-1,expectedQueueRevision:0});assert.deepEqual(r.songs.map(s=>s.id),['one','three','two']);assert.equal(r.current.id,'playing');assert.equal(r.queueRevision,1);
 const before=structuredClone(r);
 for(const b of [{action:'move',id:'one',direction:-1,expectedQueueRevision:1},{action:'move',id:'one',direction:8,expectedQueueRevision:1},{action:'move',id:'missing',direction:1,expectedQueueRevision:1}])assert.throws(()=>applySongAction(r,b));
 assert.throws(()=>applySongAction(r,{action:'move',id:'one',direction:1,expectedQueueRevision:0}),e=>e.status===409);
 assert.throws(()=>applySongAction(r,{action:'move',id:'one',direction:1}),e=>e.status===409);assert.deepEqual(r,before);
});

test('deletion undo restores exactly one entry at its former position, expires, and is invalidated by other changes',()=>{
 const r=room();applySongAction(r,{action:'remove',id:'two',expectedQueueRevision:0},1000);assert.equal(r.songs.length,2);assert.equal(r.songUndo.song.id,'two');
 applySongAction(r,{action:'undo',expectedQueueRevision:1},2000);assert.deepEqual(r.songs.map(s=>s.id),['one','two','three']);assert.equal(r.songUndo,undefined);assert.throws(()=>applySongAction(r,{action:'undo',expectedQueueRevision:2},2001),e=>e.status===409);
 applySongAction(r,{action:'remove',id:'two',expectedQueueRevision:2},3000);assert.throws(()=>applySongAction(r,{action:'undo',expectedQueueRevision:3},303001),e=>e.status===409);
 touchQueue(r);assert.throws(()=>applySongAction(r,{action:'undo',expectedQueueRevision:4},4000),e=>e.status===409);
});

test('two tabs cannot skip two songs using the same manual advance revision',()=>{
 const r=room(),request={action:'next',expectedQueueRevision:0,expectedCurrentId:'playing'};applySongAction(r,request);assert.equal(r.current.id,'one');assert.throws(()=>applySongAction(r,request),e=>e.status===409);assert.equal(r.current.id,'one');assert.deepEqual(r.songs.map(s=>s.id),['two','three']);
});

test('listener cancellation is owner-scoped, targets queued songs only, and replay never cancels twice',()=>{
 const s=new Store();try{
 s.create('r','R');s.create('other','O');let now=Date.now(),id=0;const e=new Engine(s,{now:()=>now});
 const say=(text,user='a',event)=>{now+=21000;return e.handle('r',{id:event||String(++id),message:text,user:{id:user,nickname:user}});};
 say('!내정보 생성');say('!내정보 생성','b');s.transaction('r',r=>Object.assign(r,room()));
 assert.match(say('!신청취소 2').text,/본인이/);assert.equal(s.load('r').songs.length,3);
 assert.match(say('!신청취소','a','cancel-1').text,/셋째 곡/);assert.equal(s.load('r').songs.length,2);
 assert.equal(say('!신청취소','a','cancel-1').duplicate,true);assert.equal(s.load('r').songs.length,2);
 assert.match(say('!신청취소 1').text,/첫 곡/);assert.equal(s.load('r').songs.length,1);assert.equal(s.load('r').current.id,'playing');
 assert.match(say('!신청취소').text,/취소할 대기/);assert.match(say('!신청취소 -1').text,/사용법/);assert.equal(s.load('r').users.a.exp,0);assert.equal(s.load('other').songs.length,0);
 }finally{s.db.close();}
});
