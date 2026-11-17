import test from 'node:test';
import assert from 'node:assert/strict';
import {Store,Engine,validateSettings,defaults} from '../core.mjs';
import {youtubeId,parseSongRequest,groupKeeps} from '../public/song-utils.mjs';
import {Playback} from '../public/playback.mjs';
import {Spoon} from '../spoon.mjs';
function setup(){
  const store=new Store();store.create('a','A');store.create('b','B');let time=Date.parse('2026-11-16T00:00:00Z'),draw=0,n=0;
  const engine=new Engine(store,{now:()=>time,int:(min,max)=>Math.min(max,Math.max(min,draw))});
  const say=(message,room='a')=>{time+=21000;return engine.handle(room,{id:`e-${++n}`,message,user:{id:'u',nickname:'팬'}});};
  const like=(id='like-1',user='u',extra={})=>engine.likeGreeting('a',{id,user:{id:user,nickname:'팬'},type:'FREE',combo:null,totalAmount:1,...extra});
  return {store,engine,say,like,advance:ms=>time+=ms,draw:value=>draw=value};
}
test('previous song is read only, accepts old rooms and stays isolated',()=>{
  const f=setup();assert.match(f.say('!이전곡').text,/없습니다/);
  f.store.transaction('a',r=>{r.previous={id:'old',title:'이전 음악'};r.current={id:'now',title:'현재 음악'};r.songs=[{id:'next',title:'다음 음악'}];});
  assert.equal(f.say('!이전곡').text,'이전곡: 이전 음악');
  const r=f.store.load('a');assert.equal(r.current.id,'now');assert.equal(r.songs[0].id,'next');
  assert.match(f.say('!이전곡','b').text,/없습니다/);f.store.db.close();
});
test('YouTube requests normalize supported URLs and reject lookalike hosts',()=>{
  for(const url of ['https://youtu.be/M7lc1UVf-VE','https://www.youtube.com/watch?v=M7lc1UVf-VE&list=x','https://m.youtube.com/shorts/M7lc1UVf-VE'])assert.equal(youtubeId(url),'M7lc1UVf-VE');
  for(const url of ['https://youtube.com.evil.test/watch?v=M7lc1UVf-VE','javascript:alert(1)','http://youtu.be/M7lc1UVf-VE','https://user@youtu.be/M7lc1UVf-VE','https://youtu.be/invalid'])assert.equal(youtubeId(url),null);
  assert.deepEqual(parseSongRequest('곡 제목 https://youtu.be/M7lc1UVf-VE'),{title:'곡 제목',videoId:'M7lc1UVf-VE'});
  assert.throws(()=>parseSongRequest('https://evil.test/video'));const f=setup();f.say('!내정보 생성');f.say('!신청곡 https://youtu.be/M7lc1UVf-VE');
  assert.equal(f.store.load('a').songs[0].videoId,'M7lc1UVf-VE');assert.match(f.say('!신청곡 다른 제목 https://www.youtube.com/watch?v=M7lc1UVf-VE').text,/이미 등록/);f.store.db.close();
});
test('roulette wins become grouped keeps; misses only enter history; event replay cannot pay twice',()=>{
  const f=setup();f.say('!내정보 생성');assert.match(f.say('!룰렛').text,/꺼져/);
  const settings=defaults();settings.roulette=true;assert.throws(()=>validateSettings(settings),/당첨 보상/);
  settings.rouletteRewards=[{id:'win',name:'노래',weight:1,miss:false},{id:'miss',name:'꽝',weight:1,miss:true}];validateSettings(settings);f.store.transaction('a',r=>r.settings=settings);
  f.draw(0);f.say('!룰렛');f.say('!룰렛');assert.equal(f.say('!킵').text,'1. 노래 ×2');
  f.draw(999999);f.say('!룰렛');let u=f.store.load('a').users.u;assert.deepEqual(u.keeps,['노래','노래']);assert.equal(u.keepHistory.length,1);assert.equal(u.keepHistory[0].kind,'miss');
  f.advance(21000);const event={id:'replay',message:'!룰렛',user:{id:'u',nickname:'팬'}};f.engine.handle('a',event);f.engine.handle('a',event);u=f.store.load('a').users.u;assert.equal(u.keepHistory.length,2);
  f.advance(32*86400000);f.say('!내정보');u=f.store.load('a').users.u;assert.deepEqual(u.keeps,[]);assert.equal(u.keepHistory.length,2);f.store.db.close();
});
test('keep grouping preserves quantity and normalizes legacy spacing without deleting data',()=>{
  assert.deepEqual(groupKeeps([' 노래 ','노래','춤']),[{name:'노래',count:2},{name:'춤',count:1}]);
});
test('spoon recharge guidance returns the configurable message and observes command cooldown',()=>{
  const f=setup();assert.match(f.say('!스푼').text,/billing\.spooncast\.net/);f.say('!내정보 생성');
  f.store.transaction('a',r=>r.settings.spoonNotice='/스푼 할인 조건을 확인하세요.');
  assert.match(f.say('!스푼').text,/^\/스푼 할인 조건을 확인하세요\./);
  const out=f.engine.handle('a',{id:'fast-spoon',message:'!스푼',user:{id:'u',nickname:'팬'}});assert.equal(out.text,null);f.store.db.close();
});
test('like greeting enforces 10 minute per ID interval, global gap, event dedup and quiet mode',()=>{
  const f=setup();assert.ok(f.like().text);assert.equal(f.like('l2').text,null);f.advance(3000);assert.ok(f.like('other','other').text);
  f.advance(596999);assert.equal(f.like('l3').text,null);f.advance(1);assert.ok(f.like('l4').text);
  f.advance(600000);assert.equal(f.like('l4').text,null); // replay still rejected after cooldown
  f.store.transaction('a',r=>r.settings.quiet=true);assert.equal(f.like('l5').text,null);
  f.store.transaction('a',r=>r.settings.quiet=false);assert.equal(f.like('paid','u',{type:'PAID'}).text,null);assert.equal(f.like('zero','u',{totalAmount:0}).text,null);
  assert.equal(Object.keys(f.store.load('a').users).length,0);f.store.db.close();
});
test('an unsent like greeting does not consume the viewer cooldown; receipt survives store reload',()=>{
  const f=setup(),event={id:'unsent',user:{id:'u',nickname:'팬'},type:'FREE',combo:null,totalAmount:1};
  const candidate=f.engine.likeGreeting('a',event,{commit:false});assert.ok(candidate.text);assert.equal(f.store.load('a').likeGreetings,undefined);
  f.engine.recordLike('a',candidate.receipt);const restarted=new Engine(f.store,{now:()=>candidate.receipt.time+3000});assert.equal(restarted.likeGreeting('a',{...event,id:'new'}).text,null);f.store.db.close();
});
test('playback advances on ended once, respects auto off, and never skips unplayable entries',async()=>{
  let room={current:{id:'a',videoId:'M7lc1UVf-VE'},songs:[{id:'b',videoId:'dQw4w9WgXcQ'}]},calls=0,loads=[];
  const p=new Playback({api:async(path,b)=>{calls++;assert.equal(b.expectedCurrentId,room.current.id);room={...room,previous:room.current,current:b.advance?room.songs.shift()||null:null};return {room};},load:async id=>loads.push(id),pause:()=>{},onRoom:()=>{},onStatus:()=>{}});
  await p.start(room);const ended=p.ended('a');await p.ended('a');await ended;assert.equal(calls,1);assert.deepEqual(loads,['M7lc1UVf-VE','dQw4w9WgXcQ']);await p.ended('a');assert.equal(calls,1);
  p.auto=false;await p.ended('b');assert.equal(calls,2);assert.equal(p.running,false);
  await p.start({current:{id:'text',title:'링크 없는 곡'},songs:[]});assert.equal(p.running,false);assert.equal(calls,2);
});
test('pause during an in-flight ended request prevents starting the next video',async()=>{
  let resolve,loads=0;const room={current:{id:'a',videoId:'M7lc1UVf-VE'}};
  const p=new Playback({api:()=>new Promise(r=>resolve=r),load:async()=>loads++,pause:()=>{},onRoom:()=>{},onStatus:()=>{}});
  await p.start(room);const ended=p.ended('a');p.stop();resolve({room:{current:{id:'b',videoId:'dQw4w9WgXcQ'}}});await ended;assert.equal(loads,1);assert.equal(p.running,false);
});
test('program introduction sends only when live and due, pauses in quiet mode and retries failed sends',async()=>{
  const f=setup(),spoon=new Spoon(f.store,f.engine,{});let messages=[],success=true;
  spoon.send=async(room,message)=>{messages.push(message);return success;};
  const due=Date.now()-1;
  f.store.transaction('a',r=>{r.live=false;r.introDueAt=due;});await spoon.tick();assert.equal(messages.length,0);
  f.store.transaction('a',r=>{r.live=true;r.settings.quiet=true;});await spoon.tick();assert.equal(messages.length,0);
  f.store.transaction('a',r=>r.settings.quiet=false);success=false;await spoon.tick();assert.equal(messages.length,1);assert.equal(f.store.load('a').introDueAt,due);
  success=true;await spoon.tick();assert.equal(messages.length,2);assert.match(messages[1],/Spoon Studio/);assert.ok(f.store.load('a').introDueAt>=Date.now()+599000);
  await spoon.tick();assert.equal(messages.length,2);f.store.db.close();
});
test('overlapping scheduler ticks cannot send two program introductions',async()=>{
  const f=setup(),spoon=new Spoon(f.store,f.engine,{});let resolve,count=0;
  f.store.transaction('a',r=>{r.live=true;r.introDueAt=Date.now()-1;});
  spoon.send=()=>{count++;return new Promise(r=>resolve=r);};const first=spoon.tick();await spoon.tick();assert.equal(count,1);resolve(true);await first;f.store.db.close();
});
