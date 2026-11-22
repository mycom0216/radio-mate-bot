import test from 'node:test';
import assert from 'node:assert/strict';
import {ORIGIN} from '../extensions/donation-capture/policy.mjs';

test('extension worker routes manual tests and donation batches through mocked browser capture and download APIs',{timeout:15000},async()=>{
 const originalChrome=globalThis.chrome,originalFetch=globalThis.fetch,state={},downloads=[],captured=[];
 let listener,relayCalls=0;
 const eventSource=()=>({addListener(){}}),url='https://www.spooncast.net/kr/live/@test';
 let queryUrl=url;
 globalThis.chrome={
  tabs:{onActivated:eventSource(),onUpdated:eventSource(),onRemoved:eventSource(),query:async()=>[{id:1,windowId:2,url:queryUrl}],get:async()=>({id:1,windowId:2,url,active:true}),captureVisibleTab:async(windowId,options)=>{assert.equal(windowId,2);assert.equal(options.format,'png');captured.push(Date.now());return 'data:image/png;base64,MOCK_FRAME_'+captured.length;}},
  windows:{get:async()=>({state:'normal'})},
  storage:{local:{setAccessLevel:async()=>{},get:async()=>structuredClone(state),set:async update=>Object.assign(state,structuredClone(update)),remove:async key=>{delete state[key];}}},
  scripting:{executeScript:async()=>[]},
  downloads:{download:async options=>{downloads.push(options);return downloads.length;},search:async()=>[{state:'complete'}],onChanged:eventSource()},
  runtime:{id:'test-extension',getURL:path=>'chrome-extension://test-extension/'+path,onMessage:{addListener:handler=>{listener=handler;}}}
 };
 globalThis.fetch=async(request,options)=>{
  assert.ok(request.startsWith(ORIGIN+'/api/screen-capture/events?after='));assert.equal(options.credentials,'omit');assert.match(options.headers.Authorization,/^Bearer A{43}$/);
  relayCalls++;
  return {ok:true,json:async()=>({dj:'DJ',expiresAt:Date.now()+3600000,cursor:relayCalls===1?20:22,events:relayCalls===2?[{id:'event-a',sequence:21,time:Date.now(),nickname:'첫번째',amount:10},{id:'event-b',sequence:22,time:Date.now(),nickname:'두번째',amount:30}]:[]})};
 };
 try{
  await import('../extensions/donation-capture/worker.mjs');
  const send=(message,sender)=>new Promise(resolve=>listener(message,{id:'test-extension',...sender},resolve));
  assert.equal((await send({type:'test'},{tab:{id:1},url})).ok,false,'web content cannot request manual capture');
  queryUrl='https://www.spooncast.net/kr/live';
  assert.equal((await send({type:'test'},{url:chrome.runtime.getURL('popup.html')})).ok,false,'listing pages are not broadcast tabs');
  assert.equal(downloads.length,0);queryUrl=url;
  const manual=await send({type:'test'},{url:chrome.runtime.getURL('popup.html')});
  assert.equal(manual.ok,true);assert.equal(manual.frames,5);assert.equal(downloads.length,5);
  assert.equal(state.binding,undefined,'manual screenshot test does not grant automatic donation access');
  assert.equal(relayCalls,0,'manual screenshot test needs no DJ credential or relay request');
  downloads.length=0;captured.length=0;
  const connected=await send({type:'connect',confirmed:true,config:{origin:ORIGIN,token:'A'.repeat(43)}},{url:chrome.runtime.getURL('popup.html')});
  assert.equal(connected.ok,true);assert.equal(state.binding.cursor,20);assert.equal(downloads.length,0,'old events are baselined on attach');
  assert.equal((await send({type:'capture-tick'},{tab:{id:1}})).ok,true);
  assert.equal(downloads.length,5);assert.equal(state.binding.cursor,22);assert.match(state.report.text,/PNG 저장 완료/);assert.equal(state.report.triggerCount,2);
  downloads.forEach((item,index)=>{assert.equal(item.url,'data:image/png;base64,MOCK_FRAME_'+(index+1));assert.match(item.filename,new RegExp('_frame0'+(index+1)+'\\.png$'));assert.match(item.filename,/두번째_30spoon/);});
  for(let i=1;i<captured.length;i++)assert.ok(captured[i]-captured[i-1]>=550,'captures obey the Chrome quota');
  await send({type:'capture-tick'},{tab:{id:1}});assert.equal(downloads.length,5,'claimed donation cursor is not replayed');
  // Reattaching the same grant must invalidate in-flight work from the old tab.
  const previousInstance=state.binding.instanceId;let release,entered;
  const pending=new Promise(resolve=>{entered=resolve;});let first=true;
  globalThis.fetch=async()=>{if(first){first=false;entered();return await new Promise(resolve=>{release=()=>resolve({ok:true,json:async()=>({cursor:99,events:[]})});});}return {ok:true,json:async()=>({dj:'DJ',expiresAt:Date.now()+3600000,cursor:30,events:[]})};};
  const oldTick=send({type:'capture-tick'},{tab:{id:1}});await pending;
  await send({type:'connect',confirmed:true,config:{origin:ORIGIN,token:'A'.repeat(43)}},{url:chrome.runtime.getURL('popup.html')});
  assert.notEqual(state.binding.instanceId,previousInstance);release();assert.equal((await oldTick).stop,true);
  assert.equal(state.binding.cursor,30,'stale relay cannot overwrite a new connection using the same grant');
  assert.equal(downloads.length,5);
 }finally{globalThis.chrome=originalChrome;globalThis.fetch=originalFetch;}
});
