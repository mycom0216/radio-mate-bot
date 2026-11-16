import test from 'node:test';
import assert from 'node:assert/strict';
import {levelProgress,commandWait,suppressionMessage,parseTestHistory} from '../public/studio-state.mjs';
test('level progress handles level boundaries and large safe balances',()=>{
  assert.deepEqual(levelProgress(100,100),{level:2,current:0,required:100,remaining:100,percent:0});
  assert.equal(levelProgress(199,100).remaining,1);assert.equal(levelProgress(199,100).percent,99);
  assert.ok(Number.isSafeInteger(levelProgress(Number.MAX_SAFE_INTEGER,10000).level));
  assert.throws(()=>levelProgress(-1,100));assert.throws(()=>levelProgress(1,0));
});
test('readiness uses both cooldown clocks, rounds up, and permits DJ testing',()=>{
  const room={users:{u:{lastCommand:10000}},lastResponse:29000,settings:{cooldown:20,responseGap:3}};
  assert.equal(commandWait(room,'u',false,30000),2);assert.equal(commandWait(room,'guest',false,30001),2);
  assert.equal(commandWait(room,'u',true,30000),0);assert.equal(commandWait(room,'u',false,32000),0);
  assert.equal(commandWait(room,'constructor',false,32000),0);
  assert.match(suppressionMessage({suppressed:'cooldown',retryAfterMs:19001}),/20초/);
  assert.match(suppressionMessage({suppressed:'quiet'}),/조용 모드/);
  assert.match(suppressionMessage({suppressed:'disabled'}),/청취자도/);
});
test('saved test history tolerates malformed data and bounds restored input',()=>{
  assert.equal(parseTestHistory('bad'),null);assert.equal(parseTestHistory('null'),null);
  const result=parseTestHistory(JSON.stringify({chats:[null,...Array.from({length:101},()=>({text:'x'.repeat(3000),bot:'true'}))],identity:{user:'u',name:'팬',dj:false}}));
  assert.equal(result.chats.length,100);assert.equal(result.chats[0].text.length,2000);assert.equal(result.chats[0].bot,false);assert.equal(result.identity.dj,false);
});
