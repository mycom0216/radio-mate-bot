import test from 'node:test';
import assert from 'node:assert/strict';
import {AndroidAuth} from '../android-auth.mjs';
test('Android handoff requires the original verifier and is single use',()=>{
  const a=new AndroidAuth(),v='a'.repeat(43),challenge=AndroidAuth.challenge(v),code=a.issue('dj-room',challenge);
  assert.throws(()=>a.redeem(code,'b'.repeat(43)));
  assert.equal(a.redeem(code,v),'dj-room');assert.throws(()=>a.redeem(code,v));
});
test('Android handoff expires and bounds outstanding codes',()=>{
  let now=10;const a=new AndroidAuth({now:()=>now,lifetime:50,limit:1}),v='a'.repeat(43),c=AndroidAuth.challenge(v),code=a.issue('room',c);
  assert.throws(()=>a.issue('room',c));now=61;assert.throws(()=>a.redeem(code,v));assert.doesNotThrow(()=>a.issue('room',c));
  assert.throws(()=>a.issue('room','bad'));assert.throws(()=>a.redeem('bad',v));
});
