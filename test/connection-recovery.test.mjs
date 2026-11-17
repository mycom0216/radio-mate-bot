import test from 'node:test';
import assert from 'node:assert/strict';
import {Store,Engine} from '../core.mjs';
import {Spoon,seal,unseal} from '../spoon.mjs';
const KEY='11'.repeat(32);
function fixture(){const store=new Store();store.create('room','검증 방송');const spoon=new Spoon(store,new Engine(store),{TOKEN_KEY:KEY});return {store,spoon};}
function expired(store){store.db.prepare('INSERT INTO tokens VALUES(?,?)').run('room',seal({access_token:'old-access',refresh_token:'old-refresh',expiresAt:0},KEY));}
test('a delayed old refresh cannot replace tokens saved by a new connection',async()=>{
 const {store,spoon}=fixture();try{
  expired(store);let finish;spoon.tokenRequest=()=>new Promise(resolve=>finish=resolve);
  const old=spoon.access('room');spoon.saveToken('room',{access_token:'new-access',refresh_token:'new-refresh',expires_in:3600});
  finish({access_token:'stale-access',refresh_token:'stale-refresh',expires_in:3600});
  assert.equal(await old,'new-access');assert.equal(await spoon.access('room'),'new-access');
  const saved=unseal(store.db.prepare('SELECT data FROM tokens WHERE room=?').get('room').data,KEY);assert.equal(saved.refresh_token,'new-refresh');
 }finally{store.db.close();}
});
test('a failed old refresh uses a newly authorized token without reverting the new connection',async()=>{
 const {store,spoon}=fixture();try{
  expired(store);let fail;spoon.tokenRequest=()=>new Promise((resolve,reject)=>fail=reject);
  const old=spoon.access('room');spoon.saveToken('room',{access_token:'new-access',refresh_token:'new-refresh'});fail(Error('old refresh expired'));
  assert.equal(await old,'new-access');assert.equal(await spoon.access('room'),'new-access');
 }finally{store.db.close();}
});
test('a send waiting on authentication is cancelled by stop even if a new broadcast becomes live',async t=>{
 const {store,spoon}=fixture();try{
  store.transaction('room',r=>r.live=true);let finish,calls=0;spoon.access=()=>new Promise(resolve=>finish=resolve);
  t.mock.method(globalThis,'fetch',async()=>{calls++;return new Response(null,{status:204});});
  const send=spoon.send('room','이전 방송의 응답');spoon.stop('room');store.transaction('room',r=>r.live=true);finish('token');
  assert.equal(await send,false);assert.equal(calls,0);
 }finally{store.db.close();}
});
test('chat network failure does not throw out of the SSE loop or change live state',async t=>{
 const {store,spoon}=fixture();try{
  store.transaction('room',r=>r.live=true);spoon.access=async()=> 'token';
  t.mock.method(globalThis,'fetch',async()=>{throw Error('temporary network failure');});
  assert.equal(await spoon.send('room','테스트'),false);assert.equal(store.load('room').live,true);
  assert.equal(store.logs('room').filter(l=>l.type==='chat-send-failed').length,1);
 }finally{store.db.close();}
});
