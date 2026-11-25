// 캡처가 안 될 때 이유를 알 수 있게 하는 진단과, 후원 알림 모양이 달라도 캡처 대상이 되도록 한 보강을 검사합니다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import vm from 'node:vm';
import { Store } from '../core.mjs';
import { ScreenCapture } from '../screen-capture.mjs';

const NOW = Date.parse('2026-11-23T12:00:00+09:00');
function setup() {
  const store = new Store();
  let clock = NOW;
  const captures = new ScreenCapture(store, { now: () => clock });
  store.create('a', 'A');
  const gift = (data, id) => ({ id, data: { user: { id: 'u1', nickname: '후원자' }, amount: 350, time: new Date(NOW).toISOString(), ...data } });
  const connect = () => { store.db.prepare('INSERT INTO tokens(room,data) VALUES(?,?)').run('a', 'x'); return captures.issue('a'); };
  return { store, captures, gift, connect, advance: ms => { clock += ms; }, last: () => captures.diagnostics('a').lastDonation };
}

test('연결 전에는 not-connected로, 연결 후에는 후원마다 결과(기록·기준 미만·중복)를 남깁니다', () => {
  const f = setup();
  assert.equal(f.captures.record('a', f.gift({}, 'g0')), false);
  assert.deepEqual(f.last(), { at: NOW, amount: 350, nickname: '후원자', result: 'not-connected', min: 200 });
  assert.equal(f.captures.diagnostics('a').enabled, false); assert.equal(f.captures.diagnostics('a').lastPollAt, null);
  f.connect();
  assert.equal(f.captures.record('a', f.gift({}, 'g1')), true); assert.equal(f.last().result, 'recorded');
  assert.equal(f.captures.record('a', f.gift({}, 'g1')), false); assert.equal(f.last().result, 'duplicate');
  assert.equal(f.captures.record('a', f.gift({ amount: 199 }, 'g2')), false);
  assert.deepEqual(f.last(), { at: NOW, amount: 199, nickname: '후원자', result: 'below-min', min: 200 });
  assert.equal(f.captures.record('a', f.gift({ amount: 200 }, 'g3')), true, '정확히 기준 스푼도 대상');
});

test('후원자·스푼 수를 읽을 수 없거나 시각이 크게 어긋나면 이유와 함께 건너뜁니다', () => {
  const f = setup(); f.connect();
  for (const [data, result] of [[{ user: {} }, 'bad-user'], [{ user: { id: '' } }, 'bad-user'], [{ user: null }, 'bad-user'], [{ user: { id: {} } }, 'bad-user'], [{ amount: 0 }, 'bad-amount'], [{ amount: 1.5 }, 'bad-amount'], [{ amount: 'abc' }, 'bad-amount'], [{ amount: undefined }, 'bad-amount'], [{ time: new Date(NOW - 10 * 60000).toISOString() }, 'stale'], [{ time: new Date(NOW + 10 * 60000).toISOString() }, 'stale']]) {
    assert.equal(f.captures.record('a', f.gift(data, 'x' + result + JSON.stringify(data))), false, JSON.stringify(data));
    assert.equal(f.last().result, result, JSON.stringify(data));
  }
  assert.equal(f.captures.list('a').events.length, 0);
});

test('후원 알림의 모양이 달라도 대상이 됩니다: 시각 필드 이름·초 단위·시각 없음, 숫자 ID, 숫자 문자열 스푼', () => {
  const f = setup(); f.connect();
  const ok = (data, id) => { assert.equal(f.captures.record('a', f.gift(data, id)), true, id); return f.captures.list('a').events.at(-1); };
  assert.equal(ok({ time: undefined, sentTime: new Date(NOW - 2000).toISOString() }, 'sent').time, NOW - 2000);
  assert.equal(ok({ time: undefined, createdAt: Math.floor((NOW - 3000) / 1000) }, 'sec').time, Math.floor((NOW - 3000) / 1000) * 1000, '초 단위 시각은 밀리초로');
  assert.equal(ok({ time: undefined, timestamp: NOW - 4000 }, 'ms').time, NOW - 4000);
  assert.equal(ok({ time: undefined }, 'none').time, NOW, '시각 정보가 없으면 서버가 받은 시각을 사용');
  assert.equal(ok({ time: 'not a date', sentTime: '' }, 'junk').time, NOW, '읽을 수 없는 값도 서버가 받은 시각');
  assert.equal(ok({ user: { id: 12345, nickname: '숫자ID' } }, 'num').nickname, '숫자ID');
  assert.equal(ok({ amount: '350' }, 'str').amount, 350);
  // 시각이 있는데 오래되었으면(재연결 때 다시 온 옛 후원) 여전히 건너뜀
  assert.equal(f.captures.record('a', f.gift({ time: new Date(NOW - 600000).toISOString() }, 'old')), false); assert.equal(f.last().result, 'stale');
  // 후원자 ID는 서버 안에서만 쓰고 확장에는 내보내지 않음
  assert.ok(f.captures.list('a').events.every(event => !('userId' in event)));
});

test('확장이 서버에 접속하면 마지막 접속 시각이 기록되고, 서버에 보관된 캡처 장수도 진단에 포함됩니다', () => {
  const f = setup(); f.connect();
  assert.equal(f.captures.diagnostics('a').lastPollAt, null);
  f.advance(5000); f.captures.list('a');
  const diagnostics = f.captures.diagnostics('a');
  assert.equal(diagnostics.lastPollAt, NOW + 5000); assert.equal(diagnostics.enabled, true); assert.deepEqual(diagnostics.stored, { count: 0, bytes: 0 });
  assert.equal(f.captures.diagnostics('other').lastDonation, null);
});

test('관리 화면의 연결 상태 표시: 연결 중·끊김·만료와 마지막 후원의 판단 이유를 보여 줍니다', () => {
  const source = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  const start = source.indexOf('function captureStatusHtml(status,now){'), end = source.indexOf('// 서버에 보관된 캡처 목록을 후원 한 건씩');
  assert.ok(start >= 0 && end > start);
  const context = { esc: value => String(value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]), num: value => Number(value).toLocaleString('en-US') };
  vm.createContext(context); vm.runInContext(`${source.slice(start, end)}\nthis.render=captureStatusHtml;`, context);
  const now = 1_000_000_000_000, render = status => context.render(status, now), base = { enabled: true, stored: { count: 5, bytes: 1 }, lastPollAt: now - 3000, lastDonation: { at: now - 65000, amount: 350, nickname: '후원자', result: 'recorded', min: 300 } };
  assert.equal(render(null), '');
  let html = render(base);
  assert.ok(html.includes('연결 중 (방금 확인)') && html.includes('1분 전 · 후원자 · 350스푼 → 캡처 대상으로 기록됨') && html.includes('서버에 보관된 캡처 5장'));
  html = render({ ...base, lastPollAt: now - 5 * 60000 });
  assert.ok(html.includes('5분 전부터 확인하지 않았습니다') && html.includes('방송 탭에서 다시 연결'));
  // 접속 기록이 한 번도 없으면 원인을 차례로 확인하는 체크리스트를 보여 줍니다.
  const never = render({ ...base, lastPollAt: null });
  assert.ok(never.includes('아직 서버에 접속하지 않았습니다'));
  for (const hint of ['PC의 Chrome', '휴대폰 스푼 앱 화면은 캡처할 수 없습니다', '1.3.0', 'chrome://extensions', '「현재 방송 탭 연결」', '다른 탭·창에 가려지지 않고 화면에 보이는지', '다른 창</b>에 띄워 두세요', '서버를 다시 시작하면 접속 기록이 지워져', '상태·목록 새로고침']) assert.ok(never.includes(hint), hint);
  assert.equal((never.match(/<li>/g) || []).length, 4, '확인 항목 4개');
  assert.ok(!render({ ...base, lastPollAt: now - 3000 }).includes('<ol'), '연결 중일 때는 체크리스트를 보여 주지 않음');
  assert.ok(!render({ ...base, enabled: false, lastPollAt: null }).includes('<ol'), '연결 정보가 없을 때는 발급 안내만');
  assert.ok(render({ ...base, lastPollAt: now - 5 * 60000 }).includes('다른 탭·창에 가려졌거나'), '접속이 끊긴 경우에도 가려짐을 원인으로 안내');
  assert.ok(render({ ...base, enabled: false }).includes('캡처 연결이 없거나 만료되었습니다'));
  assert.ok(render({ ...base, lastDonation: { ...base.lastDonation, result: 'below-min', amount: 20, min: 200 } }).includes('20스푼 → 기준(200스푼)에 못 미쳐 캡처하지 않음'));
  for (const [result, text] of [['not-connected', '연결 정보를 다시 발급'], ['bad-user', '후원자 정보가 없어'], ['bad-amount', '스푼 수를 읽지 못해'], ['stale', '2분 넘게 어긋나'], ['duplicate', '이미 기록된 후원']]) assert.ok(render({ ...base, lastDonation: { ...base.lastDonation, result } }).includes(text), result);
  assert.ok(render({ ...base, lastDonation: null }).includes('서버를 다시 시작한 뒤 받은 후원이 없습니다'));
  assert.ok(render({ ...base, lastDonation: { ...base.lastDonation, nickname: '<b>x</b>' } }).includes('&lt;b&gt;x&lt;/b&gt;'), '닉네임 이스케이프');
});

test('실제 서버: 후원 알림에 time이 없어도 sentTime만 있어도 캡처 대상이 되고, 관리 화면 정보에 연결 상태가 나타납니다', { timeout: 40000 }, async () => {
  let stream;
  const mock = createServer(async (req, res) => { let body = ''; for await (const part of req) body += part; if (req.url === '/v1/oauth/token') res.end(JSON.stringify({ access_token: 'AT', refresh_token: 'RT', expires_in: 3600 })); else if (req.url === '/v1/me') res.end(JSON.stringify({ userId: 'diag-dj' })); else if (req.url === '/v1/live/events') { stream = res; res.writeHead(200, { 'Content-Type': 'text/event-stream' }); res.write(': connected\n\n'); } else { res.writeHead(204); res.end(); } });
  await new Promise(resolve => mock.listen(0, '127.0.0.1', resolve));
  const data = mkdtempSync(join(tmpdir(), 'capture-diag-'));
  const proc = spawn(process.execPath, ['server.mjs'], { cwd: new URL('..', import.meta.url), env: { ...process.env, HOST: '127.0.0.1', PORT: '0', DATA_DIR: data, NODE_ENV: 'development', PUBLIC_URL: 'http://localhost:4310', SPOON_CLIENT_ID: 'test', SPOON_CLIENT_SECRET: 'test', TOKEN_KEY: 'ab'.repeat(32), SPOON_API_BASE: `http://127.0.0.1:${mock.address().port}` }, stdio: ['ignore', 'pipe', 'pipe'] });
  try {
    const origin = await new Promise((resolve, reject) => { let out = ''; const timer = setTimeout(() => reject(Error('서버 시작 시간 초과')), 15000); proc.stdout.on('data', c => { out += c; const m = out.match(/http:\/\/127\.0\.0\.1:\d+/); if (m) { clearTimeout(timer); resolve(m[0]); } }); proc.once('exit', code => reject(Error('서버가 종료됨 ' + code))); });
    let response = await fetch(origin + '/oauth/start', { redirect: 'manual' });
    const state = new URL(response.headers.get('location')).searchParams.get('state'), oauthCookie = response.headers.get('set-cookie').split(';')[0];
    response = await fetch(`${origin}/oauth/callback?state=${state}&code=test`, { redirect: 'manual', headers: { Cookie: oauthCookie } });
    const Cookie = response.headers.get('set-cookie').split(';')[0], session = await (await fetch(origin + '/api/session', { headers: { Cookie } })).json();
    const headers = { Cookie, 'Content-Type': 'application/json', 'X-CSRF-Token': session.csrf };
    const roomInfo = async () => (await (await fetch(origin + '/api/room', { headers })).json()).captureStatus;
    assert.equal((await roomInfo()).enabled, false);
    const grant = await (await fetch(origin + '/api/screen-capture', { method: 'POST', headers, body: '{"action":"issue"}' })).json(), relay = { Authorization: 'Bearer ' + grant.token };
    for (let i = 0; i < 40 && !stream; i++) await new Promise(resolve => setTimeout(resolve, 50));
    assert.ok(stream);
    let info = await roomInfo(); assert.equal(info.enabled, true); assert.equal(info.lastPollAt, null); assert.equal(info.lastDonation, null);
    // 1) 기준 미만 후원: 이유가 남음
    stream.write('id: small\nevent: donation\ndata: ' + JSON.stringify({ user: { id: 'u', nickname: '작은후원' }, amount: 20, sentTime: Date.now() }) + '\n\n');
    for (let i = 0; i < 40 && !(await roomInfo()).lastDonation; i++) await new Promise(resolve => setTimeout(resolve, 50));
    info = await roomInfo(); assert.deepEqual([info.lastDonation.result, info.lastDonation.amount, info.lastDonation.nickname, info.lastDonation.min], ['below-min', 20, '작은후원', 200]);
    // 2) 350스푼, time 필드 없이 sentTime(밀리초)만 있는 알림 → 캡처 대상
    stream.write('id: big\nevent: donation\ndata: ' + JSON.stringify({ user: { id: 'u2', nickname: '큰후원' }, amount: 350, sentTime: Date.now() }) + '\n\n');
    let events = []; for (let i = 0; i < 60 && !events.length; i++) { events = (await (await fetch(origin + '/api/screen-capture/events', { headers: relay })).json()).events; await new Promise(resolve => setTimeout(resolve, 50)); }
    assert.equal(events.length, 1); assert.equal(events[0].amount, 350); assert.equal(events[0].nickname, '큰후원');
    info = await roomInfo(); assert.equal(info.lastDonation.result, 'recorded'); assert.ok(info.lastPollAt > Date.now() - 20000, '확장 접속 시각이 기록됨');
    // 3) 시각 정보가 전혀 없는 알림도 대상
    stream.write('id: notime\nevent: donation\ndata: ' + JSON.stringify({ user: { id: 'u3', nickname: '시각없음' }, amount: 500 }) + '\n\n');
    events = []; for (let i = 0; i < 60 && !events.length; i++) { events = (await (await fetch(origin + '/api/screen-capture/events?after=' + 1, { headers: relay })).json()).events; await new Promise(resolve => setTimeout(resolve, 50)); }
    assert.equal(events.length, 1); assert.equal(events[0].nickname, '시각없음'); assert.ok(Math.abs(events[0].time - Date.now()) < 15000, '서버가 받은 시각으로 대체');
  } finally { const exited = new Promise(resolve => proc.once('exit', resolve)); proc.kill(); await exited; stream?.destroy(); mock.closeAllConnections(); await new Promise(resolve => mock.close(resolve)); rmSync(data, { recursive: true, force: true }); }
});
