import test from 'node:test';
import assert from 'node:assert/strict';
import {BotCall} from '../bot-call.mjs';

test('device codes expire, stay bound to one authorized DJ and stop working on rotation or disconnection',()=>{
 let now=1000;const rooms=new Map([['a',{name:'DJ A',botCall:{token:'a'.repeat(43)}}],['b',{name:'DJ B',botCall:{token:'b'.repeat(43)}}]]),authorized=new Set(['a','b']);
 const store={ids:()=>[...rooms.keys()],load:id=>rooms.get(id),transaction:(id,fn)=>fn(rooms.get(id)),db:{prepare:()=>({get:id=>authorized.has(id)?{}:undefined})}};
 const calls=new BotCall(store,{status:new Map()},{now:()=>now});
 const a=calls.deviceCode('a'),b=calls.deviceCode('b');assert.match(a.code,/^[2-9A-HJ-NP-Z]{10}$/);assert.notEqual(a.code,b.code);assert.equal(a.dj,'DJ A');
 assert.equal(calls.resolveCode(a.code.toLowerCase().slice(0,5)+'-'+a.code.toLowerCase().slice(5)),'a'.repeat(43));assert.equal(calls.resolveCode(b.code),'b'.repeat(43));
 assert.equal(calls.deviceCode('a').code,a.code,'one DJ reuses a code within its lifetime');
 now=a.expiresAt;assert.equal(calls.resolveCode(a.code),null);const renewed=calls.deviceCode('a');assert.notEqual(renewed.code,a.code);
 calls.issue('a',{rotate:true});assert.equal(calls.resolveCode(renewed.code),null);
 const replacement=calls.deviceCode('a');authorized.delete('a');assert.equal(calls.resolveCode(replacement.code),null);assert.throws(()=>calls.deviceCode('a'),/DJ 연결/);
 assert.equal(calls.resolveCode('invalid'),null);
});
