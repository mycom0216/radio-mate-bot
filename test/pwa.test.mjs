import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {PlaybackPosition} from '../public/playback-position.mjs';
import {Playback} from '../public/playback.mjs';

test('resume position survives reload but is isolated by room, song, video and expiry',()=>{
  const values=new Map(),storage=()=>({getItem:k=>values.get(k),setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)});
  let id='dj-one',now=1000;
  const options={storage,room:()=>id,now:()=>now};
  new PlaybackPosition(options).write('song1','video1',123.9);
  const restored=new PlaybackPosition(options);
  assert.equal(restored.read('song1','video1'),123);
  assert.equal(restored.read('song2','video1'),0);
  assert.equal(restored.read('song1','video2'),0);
  id='dj-two';assert.equal(restored.read('song1','video1'),0);
  id='dj-one';now+=12*3600000+1;assert.equal(restored.read('song1','video1'),0);
  now=1000;restored.clear();assert.equal(restored.read('song1','video1'),0);
  values.set('radiomate-position:dj-one','broken');assert.equal(restored.read('song1','video1'),0);
  const blocked=new PlaybackPosition({storage:()=>{throw Error('private storage blocked');},room:()=>id});
  assert.doesNotThrow(()=>blocked.write('song1','video1',12));assert.equal(blocked.read('song1','video1'),0);
});

test('remote play cannot start or advance a queue in a hidden page',async()=>{
  let apiCalls=0,loads=0,pauses=0,visible=false;
  const player=new Playback({api:async()=>{apiCalls++;},load:async()=>loads++,pause:()=>pauses++,onRoom:()=>{},onStatus:()=>{},mayPlay:()=>visible});
  const room={current:{id:'one',videoId:'M7lc1UVf-VE'},songs:[],playbackControl:{id:'command',time:Date.now(),action:'play'}};
  await player.syncControl(room);assert.equal(apiCalls,0);assert.equal(loads,0);assert.equal(player.running,false);
  visible=true;await player.start(room);assert.equal(loads,1);
  visible=false;await player.sync(room);assert.equal(player.running,false);assert.equal(pauses,1);
});

test('service worker caches only public offline assets and never intercepts authenticated routes',async()=>{
  const handlers={},origin='https://radio.example';let cacheWrites=[];
  const self={location:{origin},clients:{claim:async()=>{}},addEventListener:(name,fn)=>handlers[name]=fn};
  runInNewContext(readFileSync(new URL('../public/sw.js',import.meta.url),'utf8'),{
    self,URL,caches:{open:async()=>({addAll:async paths=>cacheWrites.push(...paths)}),match:async path=>'cached:'+path,keys:async()=>[]},fetch:async()=>{throw Error('offline');}
  });
  let install;handlers.install({waitUntil:p=>install=p});await install;
  assert.deepEqual(cacheWrites,['/offline.html','/pwa.css','/app-icon.svg']);
  const request=(path,mode='navigate',method='GET')=>{
    let result;handlers.fetch({request:{url:origin+path,mode,method},respondWith:p=>result=p});return result;
  };
  for(const path of ['/api/room','/api/session','/api/voice-audio?id=1','/oauth/callback?code=secret','/voice/private','/v/private','/?secret=1'])assert.equal(request(path),undefined,path);
  assert.equal(request('/api/song','cors','POST'),undefined);
  assert.equal(await request('/player'),'cached:/offline.html');
  assert.equal(await request('/app-icon.svg','cors'),'cached:/app-icon.svg');
});

test('new queued request starts without a chat play command but explicit stop remains stopped',async()=>{
 const song={id:'request',title:'신청곡',videoId:'M7lc1UVf-VE'},calls=[],loaded=[];let current;
 const player=new Playback({api:async(path,body)=>{calls.push(body);current=song;return {room:{current,songs:[]}};},load:async id=>loaded.push(id),pause:()=>{},onRoom:()=>{},onStatus:()=>{}});
 await player.receive({songs:[]});assert.equal(calls.length,0);
 await player.receive({songs:[song]});assert.equal(calls.length,1);assert.equal(calls[0].action,'start');assert.deepEqual(loaded,['M7lc1UVf-VE']);
 await player.receive({current,songs:[]});assert.equal(calls.length,1);
 player.stop();await player.receive({songs:[song]});assert.equal(calls.length,1);
 await player.start({current,songs:[]});assert.equal(loaded.length,2);
});

test('automatic reception cannot override a paused server, selected previous track or hidden page',async()=>{
 let visible=true,starts=0;
 const player=new Playback({api:async()=>{starts++;throw Error('must not start');},load:()=>{},pause:()=>{},onRoom:()=>{},onStatus:()=>{},mayPlay:()=>visible});
 const song={id:'new',videoId:'M7lc1UVf-VE'};
 await player.receive({songs:[song],playbackState:'paused'});
 await player.receive({songs:[song],songSelection:{id:'previous'}});
 visible=false;await player.receive({songs:[song]});assert.equal(starts,0);
});
