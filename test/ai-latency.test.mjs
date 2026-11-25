// AI 답을 기다리는 동안에도 다른 채팅·후원·명령이 줄을 서지 않고 바로 처리되는지 검사합니다. (가짜 스푼 서버 + 2.5초 걸리는 가짜 OpenAI 서버)
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

test('자유 대화의 AI 답(2.5초)을 기다리는 동안 후원 감사 인사와 명령 답이 바로 나갑니다', { timeout: 60000 }, async () => {
  const chats = []; let stream; const aiCalls = [];
  const emit = (id, event, data) => stream.write(`id: ${id}\nevent: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  const spoon = createServer((req, res) => {
    let body = ''; req.on('data', c => body += c);
    req.on('end', () => {
      if (req.url === '/v1/oauth/token') { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ access_token: 'AT', token_type: 'Bearer', expires_in: 3600, refresh_token: 'RT', scope: 'me.read events.chat chat.send' })); }
      else if (req.url === '/v1/oauth/revoke') { res.writeHead(200); res.end('{}'); }
      else if (req.url === '/v1/me') { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ userId: 'dj-latency' })); }
      else if (req.url === '/v1/live/events') { stream = res; res.writeHead(200, { 'Content-Type': 'text/event-stream' }); res.write(': hello\n\n'); setTimeout(() => emit('e1', 'chat', { user: { id: 'u1', nickname: '첫청취자' }, message: '!내정보 생성', sentTime: Date.now() }), 300); }
      else if (req.url === '/v1/live/chat') { chats.push({ t: Date.now(), text: JSON.parse(body).message }); res.writeHead(204); res.end(); }
      else { res.writeHead(404); res.end(); }
    });
  });
  // 가짜 OpenAI: 일부러 2.5초 늦게 답합니다. (AI가 느린 상황)
  const openai = createServer((req, res) => {
    let body = ''; req.on('data', c => body += c);
    req.on('end', () => { aiCalls.push({ t: Date.now(), url: req.url, body: JSON.parse(body || '{}') }); setTimeout(() => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ output: [{ type: 'message', content: [{ type: 'output_text', text: 'AI 대답이에요' }] }] })); }, 2500); });
  });
  await new Promise(resolve => spoon.listen(0, '127.0.0.1', resolve)); await new Promise(resolve => openai.listen(0, '127.0.0.1', resolve));
  const data = mkdtempSync(join(tmpdir(), 'ai-latency-'));
  const proc = spawn(process.execPath, ['server.mjs'], { cwd: new URL('..', import.meta.url), env: { ...process.env, HOST: '127.0.0.1', PORT: '0', DATA_DIR: data, NODE_ENV: 'development', PUBLIC_URL: 'http://localhost:4310', SPOON_REGION: 'jp', SPOON_CLIENT_ID: 'cid', SPOON_CLIENT_SECRET: 'secret', TOKEN_KEY: 'ab'.repeat(32), SPOON_API_BASE: `http://127.0.0.1:${spoon.address().port}`, OPENAI_API_KEY: 'test-key', OPENAI_API_BASE: `http://127.0.0.1:${openai.address().port}` }, stdio: ['ignore', 'pipe', 'pipe'] });
  try {
    const address = await new Promise((resolve, reject) => { let out = ''; const timer = setTimeout(() => reject(Error('서버 시작 시간 초과')), 15000); proc.stdout.on('data', c => { out += c; const m = out.match(/http:\/\/127\.0\.0\.1:\d+/); if (m) { clearTimeout(timer); resolve(m[0]); } }); proc.once('exit', code => reject(Error('서버가 종료됨 ' + code))); });
    let res = await fetch(address + '/oauth/start', { redirect: 'manual' });
    const state = new URL(res.headers.get('location')).searchParams.get('state'), oauthCookie = res.headers.get('set-cookie').split(';')[0];
    res = await fetch(`${address}/oauth/callback?code=abc&state=${state}`, { redirect: 'manual', headers: { Cookie: oauthCookie } });
    const session = res.headers.get('set-cookie').split(';')[0];
    for (let i = 0; i < 80 && !chats.length; i++) await sleep(250);
    assert.equal(chats.length, 1);
    const info = await (await fetch(address + '/api/session', { headers: { Cookie: session } })).json();
    const headers = { Cookie: session, 'X-CSRF-Token': info.csrf, 'Content-Type': 'application/json' };
    const room = await (await fetch(address + '/api/room', { headers })).json();
    res = await fetch(address + '/api/settings', { method: 'POST', headers, body: JSON.stringify({ settings: { ...room.settings, responseGap: 1, cooldown: 1, chatTalk: 'lively' }, expectedRevision: room.settingsRevision || 0, name: room.name }) });
    assert.equal(res.status, 200);
    await sleep(1500); chats.length = 0;

    // 1) 평범한 말 → AI(2.5초) 호출. 곧바로 후원과 명령이 이어집니다.
    const start = Date.now();
    emit('n1', 'chat', { user: { id: 'a1', nickname: '수다쟁이' }, message: '오늘 저는 집에서 푹 쉬었어요', sentTime: Date.now() });
    await sleep(400);
    emit('d1', 'donation', { user: { id: 'a2', nickname: '후원자' }, amount: 30, time: new Date().toISOString() });
    emit('c1', 'chat', { user: { id: 'a3', nickname: '명령러' }, message: '!내정보 생성', sentTime: Date.now() });
    for (let i = 0; i < 80 && chats.length < 4; i++) await sleep(100);
    const at = pattern => { const hit = chats.find(c => pattern.test(c.text)); return hit && hit.t - start; };
    const thanks = at(/후원자님, 30 스푼 감사합니다/), command = at(/명령러님 프로필이 준비/), ai = at(/AI 대답이에요/);
    if (process.env.LATENCY_REPORT) console.log(`LATENCY 후원 감사 인사 ${thanks}ms · 명령 답 ${command}ms · AI 답 ${ai}ms`);
    assert.ok(aiCalls.length >= 1 && aiCalls[0].url === '/v1/responses', 'AI는 설정한 주소로 호출됨');
    assert.ok(thanks !== undefined && command !== undefined && ai !== undefined, JSON.stringify(chats.map(c => [c.t - start, c.text])));
    assert.ok(ai >= 2400, `AI 답은 2.5초 뒤에 도착해야 합니다: ${ai}ms`);
    assert.ok(thanks < 1800, `후원 감사 인사가 AI 답을 기다리지 않고 바로 나가야 합니다: ${thanks}ms`);
    // 명령 답은 AI 답(2.5초 + 전송 대기열)보다 먼저 나가야 합니다. (예전 방식이면 AI를 기다려 AI 답보다 늦게 나감) 절대 시간(2500ms)이 아니라 순서로 비교해 PC 속도 차이로 흔들리지 않게 합니다.
    assert.ok(command < ai, `명령 답이 AI 답보다 먼저 나가야 합니다: 명령 ${command}ms / AI ${ai}ms`);
    // 2) 자유 대화에 걸린 시간이 운영 기록에 남습니다.
    const after = await (await fetch(address + '/api/room', { headers })).json();
    const log = after.logs.find(entry => entry.type === 'natural-chat');
    assert.ok(log && log.data.aiMs >= 2400 && log.data.aiMs < 6000, JSON.stringify(log));
  } finally {
    const done = proc.exitCode === null ? new Promise(resolve => proc.once('exit', resolve)) : Promise.resolve();
    proc.kill(); await done; spoon.close(); openai.close(); rmSync(data, { recursive: true, force: true });
  }
});

test('AI 설정: 주소·추론 설정은 선택이고, 자유 대화는 최근 대화만 보냅니다', async () => {
  const { AIChat } = await import('../ai-chat.mjs');
  const { Store } = await import('../core.mjs');
  const store = new Store(); store.create('r', '방');
  const calls = [];
  const fetcher = async (url, init) => { calls.push({ url, body: JSON.parse(init.body) }); return { ok: true, json: async () => ({ output: [{ type: 'message', content: [{ type: 'output_text', text: '답' }] }] }) }; };
  let now = Date.now();
  const ai = new AIChat({ key: 'k', fetcher, now: () => now });
  const context = { store, room: 'r', user: 'u', channel: 'spoon', natural: true, nickname: '가', int: a => a };
  for (let i = 0; i < 8; i++) { now += 20000; await ai.answer('말 ' + i, context); }
  assert.equal(calls[0].url, 'https://api.openai.com/v1/responses');
  assert.ok(calls.every(c => !('reasoning' in c.body)), '기본은 추론 설정을 보내지 않음');
  assert.equal(calls.at(-1).body.input.length, 7, '자유 대화는 최근 6개 + 새 질문만 보냄');
  assert.equal(calls.at(-1).body.input.at(-1).content, '말 7');
  const tuned = new AIChat({ key: 'k', fetcher, now: () => now, baseUrl: 'http://127.0.0.1:9/', effort: 'low' });
  now += 20000; await tuned.answer('안녕', { ...context, user: 'v' });
  assert.equal(calls.at(-1).url, 'http://127.0.0.1:9/v1/responses');
  assert.deepEqual(calls.at(-1).body.reasoning, { effort: 'low' });
});
