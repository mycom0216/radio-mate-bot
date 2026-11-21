import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { apiBase, spoonRegion } from '../spoon.mjs';
import {AndroidAuth} from '../android-auth.mjs';

test('region selects the matching Spoon API host and rejects unknown regions', () => {
  assert.equal(apiBase({}), 'https://kr-openapi.spooncast.net');
  assert.equal(apiBase({ SPOON_REGION: 'JP' }), 'https://jp-openapi.spooncast.net');
  assert.equal(apiBase({ SPOON_REGION: 'jp', SPOON_API_BASE: 'http://x/', NODE_ENV: 'production' }), 'https://jp-openapi.spooncast.net');
  assert.equal(apiBase({ SPOON_API_BASE: 'http://127.0.0.1:1/' }), 'http://127.0.0.1:1');
  assert.throws(() => spoonRegion({ SPOON_REGION: 'us' }), /kr 또는 jp/);
});

test('OAuth login, SSE chat event and chat reply work end to end against a mock Spoon API', { timeout: 45000 }, async () => {
  const seen = { token: [], chat: [], me: 0, events: 0, revoked: [] };
  let stream;
  const emit = (id, event, data) => stream.write(`id: ${id}\nevent: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  const chat = (id, user, message) => emit(id, 'chat', {user, message, sentTime:Date.now()});
  async function expectReply(index, pattern) {
    for(let i=0;i<60&&seen.chat.length<=index;i++)await new Promise(r=>setTimeout(r,100));
    assert.match(seen.chat[index]??'',pattern);
  }
  const waitForSendGap = () => new Promise(resolve => setTimeout(resolve,3100));
  const mock = createServer((req, res) => {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      if (req.url === '/v1/oauth/token') {
        seen.token.push({ auth: req.headers.authorization, body });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ access_token: 'AT', token_type: 'Bearer', expires_in: 3600, refresh_token: 'RT', scope: 'me.read events.chat chat.send' }));
      } else if(req.url==='/v1/oauth/revoke'){seen.revoked.push(body);res.writeHead(200);res.end('{}');
      } else if (req.url === '/v1/me') {
        seen.me++;
        assert.equal(req.headers.authorization, 'Bearer AT');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ userId: 'dj-e2e-12345' }));
      } else if (req.url === '/v1/live/events') {
        seen.events++;
        stream=res;
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        res.write(': hello\n\n');
        setTimeout(() => res.write(`id: e1\nevent: chat\ndata: ${JSON.stringify({ user: { id: 'u1', nickname: '청취자' }, message: '!내정보 생성', sentTime: Date.now() })}\n\n`), 500);
      } else if (req.url === '/v1/live/chat') {
        seen.chat.push(JSON.parse(body).message);
        res.writeHead(204); res.end();
      } else { res.writeHead(404); res.end(); }
    });
  });
  await new Promise(r => mock.listen(0, '127.0.0.1', r));
  const data = mkdtempSync(join(tmpdir(), 'spoon-e2e-'));
  const proc = spawn(process.execPath, ['server.mjs'], {
    cwd: new URL('..', import.meta.url),
    env: { ...process.env, HOST: '127.0.0.1', PORT: '0', DATA_DIR: data, NODE_ENV: 'development', PUBLIC_URL: 'http://localhost:4310', SPOON_REGION: 'jp', SPOON_CLIENT_ID: 'cid', SPOON_CLIENT_SECRET: 'secret', TOKEN_KEY: 'ab'.repeat(32), SPOON_API_BASE: `http://127.0.0.1:${mock.address().port}` },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  try {
    const address = await new Promise((resolve, reject) => {
      let text = ''; const timer = setTimeout(() => reject(Error('server start timeout')), 10000);
      proc.stdout.on('data', c => { text += c; const m = text.match(/http:\/\/127\.0\.0\.1:\d+/); if (m) { clearTimeout(timer); resolve(m[0]); } });
      proc.on('exit', code => reject(Error('server exited ' + code)));
    });
    let res = await fetch(address + '/oauth/start', { redirect: 'manual' });
    assert.equal(res.status, 302);
    const location = new URL(res.headers.get('location'));
    assert.equal(location.pathname, '/jp/oauth/authorize');
    assert.equal(location.searchParams.get('client_id'), 'cid');
    assert.equal(location.searchParams.get('redirect_uri'), 'http://localhost:4310/oauth/callback');
    assert.match(location.searchParams.get('scope'), /chat\.send/);
    const state = location.searchParams.get('state');
    const oauthCookie = res.headers.get('set-cookie').split(';')[0];
    res = await fetch(`${address}/oauth/callback?code=abc&state=${state}`, { redirect: 'manual', headers: { Cookie: oauthCookie } });
    assert.equal(res.status, 302);
    const session = res.headers.get('set-cookie').split(';')[0];
    assert.equal(seen.token.length, 1);
    assert.equal(seen.token[0].auth, 'Basic ' + Buffer.from('cid:secret').toString('base64'));
    assert.match(seen.token[0].body, /grant_type=authorization_code/);
    assert.match(seen.token[0].body, /code=abc/);
    for (let i = 0; i < 60 && !seen.chat.length; i++) await new Promise(r => setTimeout(r, 250));
    assert.equal(seen.events, 1);
    assert.equal(seen.chat.length, 1, 'bot should answer the chat command through /v1/live/chat');
    res = await fetch(address + '/api/room', { headers: { Cookie: session } });
    const room = await res.json();
    assert.equal(res.status, 200);
    assert.equal(room.users.u1.name, '청취자');
    assert.equal(room.connection, '방송 연결됨');
    const dj={id:'dj-e2e-12345',nickname:'DJ'};
    const listener={id:'u2',nickname:'후원자'};
    await waitForSendGap();
    chat('menu-denied',listener,'!메뉴판 추가 10 잘못된 문구');
    await expectReply(1,/DJ 전용/);
    await waitForSendGap();
    chat('menu-add',dj,'!메뉴판 추가 10 하트 💖 {name}님 {amount}스푼');
    await expectReply(2,/10스푼 리액션을 등록/);
    await waitForSendGap();
    chat('menu-list',listener,'!메뉴판');
    await expectReply(3,/10스푼 · 하트 💖/);
    await waitForSendGap();
    emit('gift-10','donation',{user:listener,amount:10});
    await expectReply(4,/^하트 💖 후원자님 10스푼$/);
    await waitForSendGap();
    chat('menu-delete',dj,'!메뉴판 삭제 10');
    await expectReply(5,/10스푼 리액션을 삭제/);
    await waitForSendGap();
    emit('gift-after-delete','donation',{user:listener,amount:10});
    await expectReply(6,/^후원자님, 10 스푼 감사합니다!$/);
    // a replayed OAuth state must be refused
    res = await fetch(`${address}/oauth/callback?code=abc&state=${state}`, { redirect: 'manual', headers: { Cookie: oauthCookie } });
    assert.equal(res.status, 400);
    // Native app login: external-browser OAuth -> short-lived code -> WebView cookie.
    const verifier='v'.repeat(43),challenge=AndroidAuth.challenge(verifier);
    res=await fetch(address+'/oauth/start?app_challenge=bad',{redirect:'manual'});assert.equal(res.status,400);
    res=await fetch(address+'/oauth/start?app_challenge='+challenge,{redirect:'manual'});
    const appLocation=new URL(res.headers.get('location')),appState=appLocation.searchParams.get('state'),appCookie=res.headers.get('set-cookie').split(';')[0];
    res=await fetch(`${address}/oauth/callback?code=app-code&state=${appState}`,{redirect:'manual',headers:{Cookie:appCookie}});
    assert.equal(res.status,200);assert.equal(res.headers.get('referrer-policy'),'no-referrer');
    assert.equal(res.headers.get('set-cookie'),null,'browser must not receive the native session');
    const appCode=(await res.text()).match(/radiomate:\/\/auth\?code=([A-Za-z0-9_-]{43})/)[1];
    const exchange=(v,extra={})=>fetch(address+'/api/android/exchange',{method:'POST',headers:{'Content-Type':'application/json',...extra},body:JSON.stringify({code:appCode,verifier:v})});
    assert.equal((await exchange(verifier,{Origin:'https://untrusted.example'})).status,403);
    assert.equal((await exchange('x'.repeat(43))).status,400);
    res=await exchange(verifier);assert.equal(res.status,200);
    const appSession=res.headers.get('set-cookie');assert.match(appSession,/HttpOnly/);assert.match(appSession,/SameSite=Lax/);
    res=await fetch(address+'/api/room',{headers:{Cookie:appSession.split(';')[0]}});assert.equal(res.status,200);assert.equal((await res.json()).id,room.id);
    assert.equal((await exchange(verifier)).status,400,'one-time code cannot be replayed');
    const headers={Cookie:session,'Content-Type':'application/json','X-CSRF-Token':(await (await fetch(address+'/api/session',{headers:{Cookie:session}})).json()).csrf};
    res=await fetch(address+'/api/account-delete',{method:'POST',headers,body:JSON.stringify({confirm:'wrong'})});assert.equal(res.status,400);
    res=await fetch(address+'/api/account-delete',{method:'POST',headers,body:JSON.stringify({confirm:'방송 데이터 영구 삭제'})});assert.equal(res.status,200);assert.equal((await res.json()).revoked,true);assert.match(seen.revoked[0],/token=RT/);
    res=await fetch(address+'/api/room',{headers:{Cookie:session}});assert.equal(res.status,401);
  } finally {
    const exited = new Promise(r => proc.once('exit', r));
    proc.kill();
    await Promise.race([exited, new Promise(r => setTimeout(r, 3000))]);
    mock.close();
    mock.closeAllConnections?.();
    try { rmSync(data, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch {}
  }
});
