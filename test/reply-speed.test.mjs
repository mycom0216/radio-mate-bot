// 봇 응답 속도: 짧은 시간에 들어온 명령을 버리지 않고 차례로 보내는지, 쌓인 메시지를 5초씩 미루지 않고 간격만 지켜 이어서 보내는지 검사합니다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Engine, Store } from '../core.mjs';
import { Outbox } from '../outbox.mjs';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

test('전송 대기열: 기본은 한 번에 1개, max를 주면 쌓인 메시지를 이어서 보내고 실패하면 멈춥니다', async () => {
  const store = new Store(), outbox = new Outbox(store);
  store.create('r', '방');
  for (const n of [1, 2, 3, 4]) outbox.enqueue('r', 'k' + n, '메시지' + n, Date.now() - 1000);
  const sent = [];
  await outbox.flush('r', async text => { sent.push(text); return { kind: 'sent' }; });
  assert.deepEqual(sent, ['메시지1'], '기본값은 예전처럼 1개만');
  await outbox.flush('r', async text => { sent.push(text); return { kind: 'sent' }; }, Date.now(), { max: 8 });
  assert.deepEqual(sent, ['메시지1', '메시지2', '메시지3', '메시지4'], '남은 것을 순서대로 모두');
  // 중간에 '미룸'이 나오면 그 자리에서 멈추고, 나머지는 대기열에 그대로 남습니다.
  for (const n of [5, 6, 7]) outbox.enqueue('r', 'k' + n, '메시지' + n, Date.now() - 1000);
  const second = [];
  await outbox.flush('r', async text => { second.push(text); return second.length === 2 ? { kind: 'deferred' } : { kind: 'sent' }; }, Date.now(), { max: 8 });
  assert.deepEqual(second, ['메시지5', '메시지6']);
  assert.deepEqual(outbox.list('r').map(row => row.text).sort(), ['메시지6', '메시지7'], '보내지 못한 것은 그대로 대기열에 남음');
});

test('스푼 채팅 명령은 응답 간격 안에 들어와도 버리지 않고 대기열에 쌓고, 8개 이상 밀리면 잠시 건너뜁니다', async () => {
  const store = new Store();
  let time = Date.now();
  const engine = new Engine(store, { now: () => time, int: a => a });
  store.create('r', '방');
  const say = (id, message, delivery = true) => engine.handleAsync('r', { id: 'e' + id + message + time, user: { id: 'u' + id, nickname: '청취자' + id }, message, delivery });
  const first = await say(1, '!내정보 생성');
  time += 500; // 응답 간격(3초) 안
  const second = await say(2, '!내정보 생성');
  assert.ok(first.text && second.text, '둘 다 답이 만들어져야 합니다');
  assert.equal(new Outbox(store).list('r').length, 2, '둘 다 전송 대기열에 쌓임');
  // 스푼 채팅이 아닌 호출(화면 테스트 등)은 예전처럼 응답 간격 안에서 건너뜁니다.
  time += 500;
  const local = await say(3, '!내정보 생성', false);
  assert.equal(local.text, null);
  // 대기열이 8개가 되면 새 명령은 잠시 건너뜁니다.
  for (let i = 4; i <= 9; i++) { time += 500; await say(i, '!내정보 생성'); }
  assert.equal(new Outbox(store).list('r').length, 8);
  time += 500;
  const dropped = await say(10, '!내정보 생성');
  assert.equal(dropped.text, null);
  assert.equal(dropped.suppressed, 'cooldown');
  // 대기열이 비면 다시 받습니다.
  store.db.prepare("UPDATE outbox SET status='sent' WHERE room='r'").run();
  time += 500;
  assert.ok((await say(11, '!내정보 생성')).text);
});

test('실제 흐름: 명령 3개가 동시에 와도 모두 답하고, 후원 안내는 한 간격 뒤에 바로 이어서 나갑니다', { timeout: 60000 }, async () => {
  const chats = []; let stream;
  const emit = (id, event, data) => stream.write(`id: ${id}\nevent: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  const mock = createServer((req, res) => {
    let body = ''; req.on('data', c => body += c);
    req.on('end', () => {
      if (req.url === '/v1/oauth/token') { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ access_token: 'AT', token_type: 'Bearer', expires_in: 3600, refresh_token: 'RT', scope: 'me.read events.chat chat.send' })); }
      else if (req.url === '/v1/oauth/revoke') { res.writeHead(200); res.end('{}'); }
      else if (req.url === '/v1/me') { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ userId: 'dj-speed' })); }
      else if (req.url === '/v1/live/events') { stream = res; res.writeHead(200, { 'Content-Type': 'text/event-stream' }); res.write(': hello\n\n'); setTimeout(() => emit('e1', 'chat', { user: { id: 'u1', nickname: '첫청취자' }, message: '!내정보 생성', sentTime: Date.now() }), 300); }
      else if (req.url === '/v1/live/chat') { chats.push({ t: Date.now(), text: JSON.parse(body).message }); res.writeHead(204); res.end(); }
      else { res.writeHead(404); res.end(); }
    });
  });
  await new Promise(resolve => mock.listen(0, '127.0.0.1', resolve));
  const data = mkdtempSync(join(tmpdir(), 'reply-speed-'));
  const proc = spawn(process.execPath, ['server.mjs'], { cwd: new URL('..', import.meta.url), env: { ...process.env, HOST: '127.0.0.1', PORT: '0', DATA_DIR: data, NODE_ENV: 'development', PUBLIC_URL: 'http://localhost:4310', SPOON_REGION: 'jp', SPOON_CLIENT_ID: 'cid', SPOON_CLIENT_SECRET: 'secret', TOKEN_KEY: 'ab'.repeat(32), SPOON_API_BASE: `http://127.0.0.1:${mock.address().port}` }, stdio: ['ignore', 'pipe', 'pipe'] });
  try {
    const address = await new Promise((resolve, reject) => { let out = ''; const timer = setTimeout(() => reject(Error('서버 시작 시간 초과')), 15000); proc.stdout.on('data', c => { out += c; const m = out.match(/http:\/\/127\.0\.0\.1:\d+/); if (m) { clearTimeout(timer); resolve(m[0]); } }); proc.once('exit', code => reject(Error('서버가 종료됨 ' + code))); });
    let res = await fetch(address + '/oauth/start', { redirect: 'manual' });
    const state = new URL(res.headers.get('location')).searchParams.get('state'), oauthCookie = res.headers.get('set-cookie').split(';')[0];
    res = await fetch(`${address}/oauth/callback?code=abc&state=${state}`, { redirect: 'manual', headers: { Cookie: oauthCookie } });
    const session = res.headers.get('set-cookie').split(';')[0];
    for (let i = 0; i < 80 && !chats.length; i++) await sleep(250);
    assert.equal(chats.length, 1, '첫 명령에 답해야 합니다');
    // 응답 간격을 1초로 줄여 시험 시간을 아낍니다.
    const info = await (await fetch(address + '/api/session', { headers: { Cookie: session } })).json();
    const headers = { Cookie: session, 'X-CSRF-Token': info.csrf, 'Content-Type': 'application/json' };
    const room = await (await fetch(address + '/api/room', { headers })).json();
    res = await fetch(address + '/api/settings', { method: 'POST', headers, body: JSON.stringify({ settings: { ...room.settings, responseGap: 1, cooldown: 1, chatTalk: 'lively' }, expectedRevision: room.settingsRevision || 0, name: room.name }) });
    assert.equal(res.status, 200);
    await sleep(1300);
    // 1) 서로 다른 청취자 3명이 거의 동시에 명령 → 예전에는 1개만 답하고 나머지는 버려졌습니다.
    chats.length = 0; const start = Date.now();
    for (const [i, id] of ['u2', 'u3', 'u4'].entries()) emit('c' + i, 'chat', { user: { id, nickname: '청취자' + id }, message: '!내정보 생성', sentTime: Date.now() });
    for (let i = 0; i < 100 && chats.length < 3; i++) await sleep(100);
    assert.equal(chats.length, 3, '3개 모두 답해야 합니다');
    const gaps = chats.map((c, i) => i ? c.t - chats[i - 1].t : c.t - start);
    assert.ok(gaps.slice(1).every(gap => gap >= 900), `메시지 사이 간격(1초)을 지켜야 합니다: ${gaps}`);
    assert.ok(chats[2].t - start < 5000, `3개 모두 5초 안에 도착해야 합니다: ${chats[2].t - start}ms`);
    // 2) 후원 1건 → 감사 인사 + 후원 보상이 한 간격 뒤에 이어서 (예전에는 5초 이상 미뤄짐)
    await sleep(1300); chats.length = 0; const donated = Date.now();
    emit('d1', 'donation', { user: { id: 'u2', nickname: '청취자u2' }, amount: 100, time: new Date().toISOString() });
    for (let i = 0; i < 80 && chats.length < 2; i++) await sleep(100);
    assert.equal(chats.length, 2, '감사 인사와 후원 보상 두 개');
    assert.ok(chats[1].t - donated < 3500, `후원 보상 안내는 한 간격 뒤에 바로 나가야 합니다: ${chats[1].t - donated}ms`);
    assert.match(chats[1].text, /후원! (복권 1장 지급|\+2,000 EXP)|복권 1장 지급/);
    // 방송에 연결되면 방송 시간 집계 세션이 열리고, 웹 방 정보에 이번 달 집계가 내려갑니다. (공식 기록이 아닌 봇 연결 기준)
    const live = await (await fetch(address + '/api/room', { headers })).json();
    assert.equal(live.liveSession?.open, true, '방송 연결 중에는 세션이 열려 있어야 함');
    assert.deepEqual(Object.keys(live.choiceProgress).sort(), ['days', 'minutes']);
    // 3) 프로필 없이 채팅만 한 청취자에게 DJ가 닉네임 일부로 복권 지급 (@·고유 ID 입력 없음)
    await sleep(1300); chats.length = 0;
    emit('v1', 'chat', { user: { id: 'viewer-9', nickname: '🌙구경꾼ღ' }, message: 'ㅋㅋ 오늘 방송 좋네요', sentTime: Date.now() });
    await sleep(400);
    emit('g1', 'chat', { user: { id: 'dj-speed', nickname: 'DJ' }, message: '!복권지급 구경꾼 2', sentTime: Date.now() });
    for (let i = 0; i < 80 && !chats.some(c => /구경꾼.*복권 2장 지급/.test(c.text)); i++) await sleep(100);
    assert.ok(chats.some(c => /🌙구경꾼ღ님 복권 2장 지급 · 보유 2장/.test(c.text)), JSON.stringify(chats.map(c => c.text)));
    // 4) DJ 본인 계정의 채팅: 이름 없이 인사해도(기본 설정) 대답합니다. 단, 봇이 방금 보낸 메시지가 DJ 계정으로 되돌아오는 것일 수 있어 4초 안의 채팅은 건너뜁니다.
    await sleep(4500); chats.length = 0;
    emit('dj-call', 'chat', { user: { id: 'dj-speed', nickname: 'DJ' }, message: '안녕하세요', sentTime: Date.now() });
    for (let i = 0; i < 60 && !chats.length; i++) await sleep(100);
    assert.equal(chats.length, 1, 'DJ 본인의 평범한 인사에도 대답');
    assert.match(chats[0].text, /DJ님/, '인사 문구는 시간대(아침·낮·저녁·밤)와 무작위로 바뀌지만 모두 닉네임을 부름');
    // 봇의 답변이 DJ 계정으로 되돌아와도 다시 대답하지 않습니다.
    emit('dj-echo', 'chat', { user: { id: 'dj-speed', nickname: 'DJ' }, message: chats[0].text, sentTime: Date.now() });
    await sleep(1800);
    assert.equal(chats.length, 1, '되돌아온 봇 답변에는 대답하지 않음');
  } finally {
    const done = proc.exitCode === null ? new Promise(resolve => proc.once('exit', resolve)) : Promise.resolve();
    proc.kill(); await done; mock.close(); rmSync(data, { recursive: true, force: true });
  }
});
