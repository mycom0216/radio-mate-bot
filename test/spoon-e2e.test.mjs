import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { apiBase, spoonRegion } from '../spoon.mjs';

test('region selects the matching Spoon API host and rejects unknown regions', () => {
  assert.equal(apiBase({}), 'https://kr-openapi.spooncast.net');
  assert.equal(apiBase({ SPOON_REGION: 'JP' }), 'https://jp-openapi.spooncast.net');
  assert.equal(apiBase({ SPOON_REGION: 'jp', SPOON_API_BASE: 'http://x/', NODE_ENV: 'production' }), 'https://jp-openapi.spooncast.net');
  assert.equal(apiBase({ SPOON_API_BASE: 'http://127.0.0.1:1/' }), 'http://127.0.0.1:1');
  assert.throws(() => spoonRegion({ SPOON_REGION: 'us' }), /kr 또는 jp/);
});

test('OAuth login, SSE chat event and chat reply work end to end against a mock Spoon API', { timeout: 45000 }, async () => {
  const seen = { token: [], chat: [], me: 0, events: 0, revoked: [] };
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
    // a replayed OAuth state must be refused
    res = await fetch(`${address}/oauth/callback?code=abc&state=${state}`, { redirect: 'manual', headers: { Cookie: oauthCookie } });
    assert.equal(res.status, 400);
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
