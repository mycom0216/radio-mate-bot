import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// 실제 server.mjs를 띄우고 가짜 스푼 API로 연결해, 청취자의 일반 문장이 SSE → 대화 판단 → 채팅 전송까지 이어지는지 확인합니다.
// OpenAI 키가 없어도 인사에는 기본 대답을 하고, DJ 본인·혼잣말에는 끼어들지 않으며, 오류 문구는 채팅방에 흘리지 않아야 합니다.
test('plain chat gets a natural reply through the real SSE loop, without an AI key, without echoing and without noise', { timeout: 60000 }, async () => {
  const seen = { chat: [] };
  const send = (res, id, user, message, extra = {}) => res.write(`id: ${id}\nevent: chat\ndata: ${JSON.stringify({ user, message, sentTime: Date.now(), ...extra })}\n\n`);
  const mock = createServer((req, res) => {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      if (req.url === '/v1/oauth/token') { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ access_token: 'AT', token_type: 'Bearer', expires_in: 3600, refresh_token: 'RT', scope: 'me.read events.chat chat.send' })); }
      else if (req.url === '/v1/me') { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ userId: 'dj-natural-1' })); }
      else if (req.url === '/v1/live/events') {
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        res.write(': hello\n\n');
        setTimeout(() => send(res, 'n1', { id: 'u1', nickname: '청취자' }, '안녕하세요'), 500);
        setTimeout(() => send(res, 'n2', { id: 'dj-natural-1', nickname: 'DJ' }, '안녕하세요', { isDj: true }), 1500); // DJ 본인(봇 답변이 되돌아오는 경우 포함)
        setTimeout(() => send(res, 'n3', { id: 'u2', nickname: '다른청취자' }, '오늘 노래 정말 좋네요'), 2500);        // 청취자끼리의 혼잣말
        setTimeout(() => send(res, 'n4', { id: 'u3', nickname: '조용한청취자' }, '고마워요 메이트'), 5500);            // 봇을 부른 말은 대답(직전 답변과 방 응답 간격 3초를 넘겨서)
      } else if (req.url === '/v1/live/chat') { seen.chat.push(JSON.parse(body).message); res.writeHead(204); res.end(); }
      else { res.writeHead(404); res.end(); }
    });
  });
  await new Promise(r => mock.listen(0, '127.0.0.1', r));
  const data = mkdtempSync(join(tmpdir(), 'natural-chat-e2e-'));
  const proc = spawn(process.execPath, ['server.mjs'], {
    cwd: new URL('..', import.meta.url),
    env: { ...process.env, HOST: '127.0.0.1', PORT: '0', DATA_DIR: data, NODE_ENV: 'development', PUBLIC_URL: 'http://localhost:4310', SPOON_REGION: 'jp', SPOON_CLIENT_ID: 'cid', SPOON_CLIENT_SECRET: 'secret', TOKEN_KEY: 'cd'.repeat(32), SPOON_API_BASE: `http://127.0.0.1:${mock.address().port}`, OPENAI_API_KEY: '', NAVER_CLIENT_ID: '', NAVER_CLIENT_SECRET: '' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  try {
    const address = await new Promise((resolve, reject) => {
      let text = ''; const timer = setTimeout(() => reject(Error('server start timeout')), 10000);
      proc.stdout.on('data', c => { text += c; const m = text.match(/http:\/\/127\.0\.0\.1:\d+/); if (m) { clearTimeout(timer); resolve(m[0]); } });
      proc.on('exit', code => reject(Error('server exited ' + code)));
    });
    let res = await fetch(address + '/oauth/start', { redirect: 'manual' });
    const state = new URL(res.headers.get('location')).searchParams.get('state'), oauthCookie = res.headers.get('set-cookie').split(';')[0];
    res = await fetch(`${address}/oauth/callback?code=abc&state=${state}`, { redirect: 'manual', headers: { Cookie: oauthCookie } });
    assert.equal(res.status, 302);
    for (let i = 0; i < 80 && seen.chat.length < 2; i++) await new Promise(r => setTimeout(r, 250));
    await new Promise(r => setTimeout(r, 4000)); // 더 이상 엉뚱한 대답이 나가지 않는지 기다려 봅니다.
    assert.equal(seen.chat.length, 2, `대답은 청취자의 인사와 봇을 부른 말, 두 번만 나가야 합니다: ${JSON.stringify(seen.chat)}`);
    assert.match(seen.chat[0], /청취자님/);        // 첫 인사에 닉네임을 넣어 사람처럼 대답
    assert.match(seen.chat[1], /별말씀|언제든|이 정도쯤이야/);   // 고마움 표현에는 기본 대답(서버가 여러 문구 중 하나를 무작위로 고름)
    for (const message of seen.chat) {
      assert.ok(!/OpenAI|API 키|한도|오류|명령/.test(message), `채팅방에 설정·오류 문구가 보이면 안 됩니다: ${message}`);
      assert.ok([...message].length <= 200);
    }
  } finally {
    const exited = new Promise(r => proc.once('exit', r));
    proc.kill();
    await Promise.race([exited, new Promise(r => setTimeout(r, 3000))]);
    mock.close();
    mock.closeAllConnections?.();
    try { rmSync(data, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch {}
  }
});

test('the demo chat window and the settings API support free talk, with validation', { timeout: 40000 }, async () => {
  const data = mkdtempSync(join(tmpdir(), 'natural-chat-http-'));
  const proc = spawn(process.execPath, ['server.mjs'], {
    cwd: new URL('..', import.meta.url),
    env: { ...process.env, HOST: '127.0.0.1', PORT: '0', DATA_DIR: data, NODE_ENV: 'development', SPOON_CLIENT_ID: '', SPOON_CLIENT_SECRET: '', OPENAI_API_KEY: '', NAVER_CLIENT_ID: '', NAVER_CLIENT_SECRET: '' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  try {
    const address = await new Promise((resolve, reject) => {
      let text = ''; const timer = setTimeout(() => reject(Error('server start timeout')), 10000);
      proc.stdout.on('data', c => { text += c; const m = text.match(/http:\/\/127\.0\.0\.1:\d+/); if (m) { clearTimeout(timer); resolve(m[0]); } });
      proc.on('exit', c => { clearTimeout(timer); reject(Error(`server exited ${c}`)); });
    });
    let res = await fetch(address + '/api/demo', { method: 'POST' });
    const cookie = res.headers.get('set-cookie').split(';')[0], { csrf } = await res.json();
    const headers = { 'Content-Type': 'application/json', Cookie: cookie, 'X-CSRF-Token': csrf };
    const post = (path, body) => fetch(address + path, { method: 'POST', headers, body: JSON.stringify(body) });
    const room = async () => (await fetch(address + '/api/room', { headers })).json();
    // 기본값은 자유 대화입니다. 청취자가 명령어 없이 인사하면 닉네임을 넣어 대답합니다.
    let current = await room();
    assert.equal(current.settings.chatMode, 'auto');assert.equal(current.settings.chatName, '메이트');
    res = await post('/api/test', { message: '안녕하세요', user: 'listener-a', name: '민수' });
    assert.equal(res.status, 200);assert.match((await res.json()).text, /민수님/);
    res = await post('/api/test', { message: '오늘 노래 좋네요', user: 'listener-b', name: '지영' });
    assert.equal(res.status, 200);assert.equal((await res.json()).text, null); // 혼잣말에는 끼어들지 않음
    // DJ 권한으로 말하면(자기 방 채팅) 봇이 끼어들지 않습니다.
    res = await post('/api/test', { message: '안녕하세요', user: 'dj', name: 'DJ', dj: true });
    assert.equal((await res.json()).text, null);
    // 잘못된 설정은 거절하고, 올바른 설정은 저장되어 바로 반영됩니다. (방 전체 응답 간격은 1초로 줄여 테스트 시간을 아낍니다.)
    const settings = { ...structuredClone(current.settings), responseGap: 1 };
    res = await post('/api/settings', { settings: { ...settings, chatMode: 'loud' }, expectedRevision: current.settingsRevision || 0 });assert.equal(res.status, 400);
    res = await post('/api/settings', { settings: { ...settings, chatName: '메 이 트' }, expectedRevision: current.settingsRevision || 0 });assert.equal(res.status, 400);
    res = await post('/api/settings', { settings: { ...settings, chatMode: 'call', chatName: '봄이', chatPersona: '장난기 많은 막내처럼' }, expectedRevision: current.settingsRevision || 0 });assert.equal(res.status, 200);
    current = await room();
    assert.deepEqual([current.settings.chatMode, current.settings.chatName, current.settings.chatPersona], ['call', '봄이', '장난기 많은 막내처럼']);
    const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
    await pause(1200);
    res = await post('/api/test', { message: '안녕하세요', user: 'listener-c', name: '철수' });assert.equal((await res.json()).text, null); // 부르면 대답 모드
    res = await post('/api/test', { message: '봄이야 안녕', user: 'listener-c', name: '철수' });assert.match((await res.json()).text, /철수님/);
    res = await post('/api/settings', { settings: { ...current.settings, chatMode: 'off' }, expectedRevision: current.settingsRevision });assert.equal(res.status, 200);
    await pause(1200);
    res = await post('/api/test', { message: '봄이야 안녕', user: 'listener-d', name: '영희' });assert.equal((await res.json()).text, null);
    // 설정 화면은 새 항목을 담은 자동채팅 메뉴를 제공합니다.
    res = await fetch(address + '/extra-ui.mjs');assert.equal(res.status, 200);assert.match(await res.text(), /청취자와 명령어 없이 대화/);
  } finally {
    const exited = new Promise(r => proc.once('exit', r));
    proc.kill();
    await Promise.race([exited, new Promise(r => setTimeout(r, 3000))]);
    try { rmSync(data, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch {}
  }
});
