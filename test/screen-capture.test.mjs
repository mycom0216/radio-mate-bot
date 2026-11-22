import test from 'node:test';import assert from 'node:assert/strict';
import {Store} from '../core.mjs';import {ScreenCapture} from '../screen-capture.mjs';import {deleteListener} from '../privacy.mjs';
import {captureEvent,captureFilename,liveUrl,captureMotion,MOTION_OFFSETS} from '../extensions/donation-capture/policy.mjs';
const now=Date.parse('2026-11-22T03:00:00Z');
test('capture grants relay only their DJ donations, deduplicate events and revoke on renewal or expiry',t=>{
 const store=new Store();t.after(()=>store.db.close());for(const room of ['a','b']){store.create(room,room);store.db.prepare('INSERT INTO tokens VALUES(?,?)').run(room,'test-only');}
 let clock=now;const captures=new ScreenCapture(store,{now:()=>clock}),a=captures.issue('a'),b=captures.issue('b');
 assert.equal(captures.resolve(a.token),'a');assert.equal(captures.resolve(b.token),'b');assert.ok(!JSON.stringify(store.load('a')).includes(a.token));
 const frame={id:'one',data:{user:{id:'listener',nickname:'후원자'},amount:300,time:new Date(now).toISOString()}};
 assert.equal(captures.record('a',frame),true);assert.equal(captures.record('a',frame),false);assert.equal(captures.list('a').events[0].amount,300);assert.equal(captures.list('b').events.length,0);assert.equal(captures.list('a',1).events.length,0);assert.equal('userId' in captures.list('a').events[0],false);
 assert.equal(captures.record('a',{...frame,id:'zero',data:{...frame.data,amount:0}}),false);
 deleteListener(store,'a','listener');assert.equal(captures.list('a').events.length,0);
 captures.record('b',frame);clock+=120001;captures.prune();assert.equal(store.load('b').screenCapture.events.length,0,'expired trigger metadata must also be removed from storage');
 const renewed=captures.issue('a');assert.equal(captures.resolve(a.token),null);assert.equal(captures.resolve(renewed.token),'a');
 captures.revoke('a');assert.equal(captures.resolve(renewed.token),null);clock=b.expiresAt;assert.equal(captures.resolve(b.token),null);
});
test('old donations and disconnected accounts cannot trigger a new screenshot',t=>{
 const store=new Store();t.after(()=>store.db.close());store.create('r','R');const captures=new ScreenCapture(store,{now:()=>now});assert.throws(()=>captures.issue('r'),/먼저 연결/);
 store.db.prepare('INSERT INTO tokens VALUES(?,?)').run('r','test-only');const grant=captures.issue('r');
 assert.equal(captures.record('r',{id:'old',data:{user:{id:'u'},amount:3,time:new Date(now-120001).toISOString()}}),false);
 store.db.prepare('DELETE FROM tokens WHERE room=?').run('r');assert.equal(captures.resolve(grant.token),null);
});
const binding={tabId:1,windowId:2,spoonUrl:'https://www.spooncast.net/kr/live/123',dj:'DJ'};
const event={id:'event',nickname:'청취자',amount:300,time:now};
function fixture(tab={id:1,windowId:2,url:binding.spoonUrl,active:true},state='normal'){
 const calls={capture:0,downloads:[]},image='data:image/png;base64,ACTUAL_BROWSER_BYTES';
 return {calls,image,io:{tab:async()=>tab,window:async()=>({state}),capture:async()=>{calls.capture++;return image;},download:async options=>{calls.downloads.push(options);return 5;}}};
}
test('the exact browser screenshot is saved locally without generating or uploading an image',async()=>{
 const f=fixture(),result=await captureEvent(event,binding,f.io,()=>now);assert.equal(result.kind,'download-started');assert.equal(f.calls.capture,1);assert.equal(f.calls.downloads[0].url,f.image);assert.match(result.filename,/^RadioMate-Captures\/2026-11-22\//);assert.equal(f.calls.downloads[0].saveAs,false);
 assert.equal(liveUrl('https://evil.example/kr/live/123'),null);assert.equal(liveUrl('https://www.spooncast.net/kr/profile/123'),null);assert.equal(liveUrl('https://www.spooncast.net/kr/live'),null);assert.ok(!captureFilename({...event,nickname:'../../private'},'../DJ').includes('/../'));
});
test('wrong tabs, hidden broadcasts, minimized windows and stale events are never captured',async()=>{
 for(const [tab,state,time] of [[{id:99,windowId:2,url:binding.spoonUrl,active:true},'normal',now],[{id:1,windowId:2,url:binding.spoonUrl,active:false},'normal',now],[{id:1,windowId:2,url:binding.spoonUrl+'/other',active:true},'normal',now],[{id:1,windowId:2,url:binding.spoonUrl,active:true},'minimized',now],[{id:1,windowId:2,url:binding.spoonUrl,active:true},'normal',now-10001]]){
  const f=fixture(tab,state);assert.equal((await captureEvent({...event,time},binding,f.io,()=>now)).kind,'skipped');assert.equal(f.calls.capture,0);assert.equal(f.calls.downloads.length,0);
 }
});
test('navigation during capture discards the image rather than saving another page',async()=>{
 const f=fixture();let reads=0;f.io.tab=async()=>({id:1,windowId:2,url:++reads===1?binding.spoonUrl:'https://private.example',active:true});
 assert.equal((await captureEvent(event,binding,f.io,()=>now)).kind,'skipped');assert.equal(f.calls.capture,1);assert.equal(f.calls.downloads.length,0);
});
test('a tab switch away and back during capture is detected even if the final URL matches',async()=>{
 const f=fixture();let epoch=0;f.io.epoch=()=>epoch;f.io.capture=async()=>{epoch++;return f.image;};
 assert.equal((await captureEvent(event,binding,f.io,()=>now)).kind,'skipped');assert.equal(f.calls.downloads.length,0);
});

test('donation motion saves five distinct browser frames over four seconds',async()=>{
 const f=fixture(),times=[],reports=[];let clock=now;
 f.io.capture=async()=>{times.push(clock-now);return 'data:image/png;base64,FRAME'+times.length;};
 const results=await captureMotion([event],binding,f.io,{now:()=>clock,sleep:async ms=>{clock+=ms;},onResult:async result=>reports.push(result)});
 assert.deepEqual(times,[...MOTION_OFFSETS]);assert.equal(results.length,5);assert.equal(reports.length,5);
 assert.equal(new Set(f.calls.downloads.map(x=>x.filename)).size,5);
 f.calls.downloads.forEach((item,index)=>{assert.equal(item.url,'data:image/png;base64,FRAME'+(index+1));assert.match(item.filename,new RegExp('_frame0'+(index+1)+'\\.png$'));});
});
test('simultaneous donations share each screenshot without serially delaying their bursts',async()=>{
 const f=fixture();let clock=now;
 const results=await captureMotion([event,{...event,id:'two',nickname:'두번째'}],binding,f.io,{now:()=>clock,sleep:async ms=>{clock+=ms;}});
 assert.equal(f.calls.capture,5);assert.equal(results.every(x=>x.triggerCount===2),true);assert.match(results[0].filename,/두번째/);
});
test('switching tabs between motion frames stops the remaining burst even after switching back',async()=>{
 const f=fixture();let clock=now,epoch=0;f.io.epoch=()=>epoch;
 await captureMotion([event],binding,f.io,{now:()=>clock,sleep:async ms=>{clock+=ms;epoch+=2;}});
 assert.equal(f.calls.capture,1);assert.equal(f.calls.downloads.length,1);
});
test('stopping capture during browser acquisition prevents saving and all later motion frames',async()=>{
 const f=fixture();let enabled=true;f.io.capture=async()=>{f.calls.capture++;enabled=false;return f.image;};
 await captureMotion([event],binding,f.io,{now:()=>now,active:async()=>enabled});
 assert.equal(f.calls.capture,1);assert.equal(f.calls.downloads.length,0);
});
test('stale donations cannot start a motion burst and aged events stop mid-burst',async()=>{
 const f=fixture();let clock=now+9000;
 const results=await captureMotion([event],binding,f.io,{now:()=>clock,sleep:async ms=>{clock+=ms;}});
 assert.equal(f.calls.capture,2);assert.equal(results.at(-1).kind,'skipped');
 const old=fixture();await captureMotion([{...event,time:now-10001}],binding,old.io,{now:()=>now});assert.equal(old.calls.capture,0);
});
test('browser capture failure stops the motion burst instead of reporting successful saved frames',async()=>{
 const f=fixture();f.io.capture=async()=>{throw Error('capture denied');};
 const results=await captureMotion([event],binding,f.io,{now:()=>now});
 assert.equal(results.length,1);assert.equal(results[0].kind,'failed');assert.equal(results[0].reason,'capture denied');assert.equal(f.calls.downloads.length,0);
});
