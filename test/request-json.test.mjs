import test from 'node:test';
import assert from 'node:assert/strict';
import {requestJSON} from '../public/request-json.mjs';

test('timeout remains active while a response body stalls after headers arrive',async()=>{
 await assert.rejects(()=>requestJSON('/api/room',undefined,{timeoutMs:10,fetchImpl:async(_path,{signal})=>new Response(new ReadableStream({start(controller){signal.addEventListener('abort',()=>controller.error(new DOMException('aborted','AbortError')));}}),{headers:{'Content-Type':'application/json'}})}),/시간이 초과/);
});

test('requests work without AbortSignal.timeout and still abort slow connections',async()=>{
 const original=AbortSignal.timeout;AbortSignal.timeout=undefined;
 try{
  assert.deepEqual(await requestJSON('/api/session',undefined,{fetchImpl:async(_path,options)=>{assert.equal(options.cache,'no-store');assert.equal(options.credentials,'same-origin');return Response.json({ok:true});}}),{ok:true});
  await assert.rejects(()=>requestJSON('/api/room',undefined,{timeoutMs:5,fetchImpl:async(_path,{signal})=>new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(new DOMException('aborted','AbortError'))))}),/시간이 초과/);
 }finally{AbortSignal.timeout=original;}
});
test('JSON requests preserve conflict errors and expose session expiry without retrying mutations',async()=>{
 let calls=0,expired=0;
 const fetchImpl=async(path,options)=>{calls++;assert.equal(options.method,'POST');assert.equal(options.headers['X-CSRF-Token'],'csrf');assert.ok(options.signal instanceof AbortSignal);return new Response(JSON.stringify({error:'설정 버전 충돌'}),{status:409});};
 await assert.rejects(()=>requestJSON('/api/settings',{settings:{}},{csrf:'csrf',fetchImpl}),e=>e.status===409&&e.message==='설정 버전 충돌');assert.equal(calls,1);
 await assert.rejects(()=>requestJSON('/api/room',undefined,{fetchImpl:async()=>new Response('{"error":"로그인 필요"}',{status:401}),onUnauthorized:()=>expired++}),/로그인 필요/);assert.equal(expired,1);
});
test('timeouts and failed connections keep mutation outcomes explicit and never retry',async()=>{
 for(const error of [new DOMException('timeout','TimeoutError'),new TypeError('Failed to fetch')]){
  let count=0;await assert.rejects(()=>requestJSON('/api/grant',{amount:50},{fetchImpl:async()=>{count++;throw error;}}),/기록/);assert.equal(count,1);
 }
});
test('non-JSON gateway failures are readable and successful JSON is returned',async()=>{
 await assert.rejects(()=>requestJSON('/api/room',undefined,{fetchImpl:async()=>new Response('Bad gateway',{status:502})}),/응답을 읽지 못했습니다/);
 assert.deepEqual(await requestJSON('/api/room',undefined,{fetchImpl:async()=>Response.json({ok:true})}),{ok:true});
});
test('session expiry remains visible even when a proxy returns a non-JSON 401',async()=>{
 let expired=0;await assert.rejects(()=>requestJSON('/api/room',undefined,{fetchImpl:async()=>new Response('<html>Sign in</html>',{status:401}),onUnauthorized:()=>expired++}),e=>e.status===401);assert.equal(expired,1);
});
