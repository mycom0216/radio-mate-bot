import test from 'node:test';
import assert from 'node:assert/strict';
import {YouTubeSearch} from '../youtube-search.mjs';
import {Playback} from '../public/playback.mjs';
import {audioRange} from '../voice.mjs';

test('official search coalesces requests, caches and does not put key in URL',async()=>{
 let calls=0;const search=new YouTubeSearch({key:'private-test-key',fetcher:async(url,options)=>{
  calls++;assert.ok(!url.includes('private-test-key'));assert.equal(options.headers['X-Goog-Api-Key'],'private-test-key');
  assert.equal(new URL(url).searchParams.get('videoEmbeddable'),'true');
  return {ok:true,json:async()=>({items:[{id:{videoId:'M7lc1UVf-VE'}}]})};
 }});
 assert.deepEqual(await Promise.all([search.find('가수 - 제목'),search.find('가수 - 제목')]),['M7lc1UVf-VE','M7lc1UVf-VE']);
 await search.find('가수 - 제목');assert.equal(calls,1);
 await assert.rejects(new YouTubeSearch().find('제목'),/YOUTUBE_API_KEY/);
 await assert.rejects(new YouTubeSearch({key:'x',fetcher:async()=>({ok:false,status:403})}).find('제목'),/한도/);
});
test('title request resolves before playback; a paused lookup cannot start video',async()=>{
 const song={id:'a',title:'MC몽 - 그래도 남자니까'};let loaded=[],resolve;
 const p=new Playback({api:()=>new Promise(r=>resolve=r),load:async id=>loaded.push(id),pause:()=>{},onRoom:()=>{},onStatus:()=>{}});
 let task=p.start({current:song,songs:[]});p.stop();resolve({room:{current:{...song,videoId:'M7lc1UVf-VE'}}});await task;assert.equal(loaded.length,0);
 task=p.start({current:song,songs:[]});resolve({room:{current:{...song,videoId:'M7lc1UVf-VE'}}});await task;assert.deepEqual(loaded,['M7lc1UVf-VE']);
});
test('armed empty player starts a newly arrived request',async()=>{
 let loaded=[];const song={id:'new',videoId:'M7lc1UVf-VE'};
 const p=new Playback({api:async()=>({room:{current:song,songs:[]}}),load:async id=>loaded.push(id),pause:()=>{},onRoom:()=>{},onStatus:()=>{}});
 await p.start({current:null,songs:[]});assert.equal(p.running,true);
 await p.sync({current:null,songs:[song]});assert.deepEqual(loaded,['M7lc1UVf-VE']);
});
test('voice byte ranges support Safari probing and reject invalid requests',()=>{
 assert.deepEqual(audioRange('bytes=0-1',60),{start:0,end:1});
 assert.deepEqual(audioRange('bytes=-10',60),{start:50,end:59});
 for(const value of ['bytes=-0','bytes=60-','bytes=4-2','bytes=0-1,4-5','bytes=-'])assert.equal(audioRange(value,60),null);
});

test('replacing a video on the same request reloads it and deleting current pauses old audio',async()=>{
 const loaded=[];let pauses=0;
 const p=new Playback({api:async()=>{throw Error('unexpected API call');},load:async id=>loaded.push(id),pause:()=>pauses++,onRoom:()=>{},onStatus:()=>{}});
 await p.start({current:{id:'same-song',videoId:'M7lc1UVf-VE'},songs:[]});
 await p.sync({current:{id:'same-song',videoId:'dQw4w9WgXcQ'},songs:[]});
 assert.deepEqual(loaded,['M7lc1UVf-VE','dQw4w9WgXcQ']);
 await p.sync({current:null,songs:[]});assert.equal(pauses,1);assert.equal(p.running,true);
 await p.sync({current:null,songs:[]});assert.equal(pauses,1);
});
